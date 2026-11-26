import { lookup } from "node:dns/promises";

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type FetchedImage = {
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  data: string;
  url: string;
};

const READ_BYTES = 1_500_000;
const IMAGE_BYTES_DEFAULT = 5_000_000;
const WORD_CAP_DEFAULT = 6_000;
const TIMEOUT_DEFAULT = 10_000;
const MAX_REDIRECTS = 4;

type SearchProvider = (query: string, key: string) => Promise<SearchHit[]>;

const SEARCH_PROVIDERS: Record<string, SearchProvider> = {
  tavily: tavilySearch,
};

function limit(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function redact(text: string): string {
  let out = text;
  for (const key of [process.env.SEARCH_API_KEY, process.env.LLM_API_KEY]) {
    if (key) out = out.split(key).join("[redacted]");
  }
  return out;
}

export function webContent(text: string): string {
  const safe = text.replace(/<\/\s*web_content\s*>/gi, "< /web_content>");
  return `<web_content>\n${safe}\n</web_content>`;
}

export function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, "");
  } catch {
    return raw;
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inV4(ip: number, base: string, bits: number): boolean {
  const start = ipv4ToInt(base);
  if (start === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (start & mask);
}

function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = lower.startsWith("::ffff:") ? lower.slice(7) : lower;
  const v4 = ipv4ToInt(mapped);
  if (v4 !== null) {
    return (
      inV4(v4, "0.0.0.0", 8) ||
      inV4(v4, "10.0.0.0", 8) ||
      inV4(v4, "127.0.0.0", 8) ||
      inV4(v4, "169.254.0.0", 16) ||
      inV4(v4, "172.16.0.0", 12) ||
      inV4(v4, "192.168.0.0", 16)
    );
  }
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  return false;
}

function isIpLiteral(host: string): boolean {
  return ipv4ToInt(host) !== null || host.includes(":");
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https addresses can be opened.");
  }
  if (url.username || url.password) throw new Error("Addresses with a login are blocked.");
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    throw new Error("That address is blocked.");
  }
  if (isIpLiteral(host)) {
    if (isPrivateAddress(host)) throw new Error("That address is blocked.");
    return;
  }
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("That address could not be resolved.");
  }
  if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("That address is blocked.");
  }
}

async function fetchGet(raw: string, accept: string, maxBytes: number): Promise<{
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}> {
  const signal = AbortSignal.timeout(limit("READ_TIMEOUT_MS", TIMEOUT_DEFAULT));
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = new URL(current);
    await assertPublic(url);
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal,
      headers: {
        Accept: accept,
        "User-Agent": "PipsWorld/0.1 (read-only)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("The page redirected without a destination.");
      if (hop === MAX_REDIRECTS) throw new Error("The page redirected too many times.");
      current = new URL(location, url).toString();
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const advertised = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(advertised) && advertised > maxBytes) {
      await response.body?.cancel();
      throw new Error("That file is too large.");
    }
    const body = await readLimited(response, maxBytes);
    return { url: url.toString(), status: response.status, contentType, body };
  }
  throw new Error("The page redirected too many times.");
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("That file is too large.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (match, digits: string) => {
      const code = Number(digits);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    })
    .replace(/&#x([0-9a-f]+);/gi, (match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
    });
}

function readableText(html: string): { title: string; text: string } {
  const title = decodeEntities(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, " ") ?? "",
  )
    .replace(/\s+/g, " ")
    .trim();
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");
  const main = stripped.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i);
  const source = main?.[2] ?? stripped;
  const text = decodeEntities(
    source
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { title, text };
}

function capWords(text: string): { text: string; trimmed: boolean; max: number } {
  const max = limit("READ_PAGE_WORDS", WORD_CAP_DEFAULT);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return { text: words.join(" "), trimmed: false, max };
  return { text: words.slice(0, max).join(" "), trimmed: true, max };
}

async function tavilySearch(query: string, key: string): Promise<SearchHit[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    signal: AbortSignal.timeout(limit("READ_TIMEOUT_MS", TIMEOUT_DEFAULT)),
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      search_depth: "basic",
      include_answer: false,
    }),
  });
  if (!response.ok) throw new Error(`Search returned HTTP ${response.status}.`);
  const payload = (await response.json()) as { results?: unknown };
  if (!Array.isArray(payload.results)) return [];
  const hits: SearchHit[] = [];
  for (const item of payload.results) {
    if (!item || typeof item !== "object") continue;
    const row = item as { title?: unknown; url?: unknown; content?: unknown };
    if (typeof row.url !== "string" || !row.url.trim()) continue;
    const title = typeof row.title === "string" && row.title.trim() ? row.title.trim() : row.url;
    const snippet = typeof row.content === "string" ? row.content.trim().slice(0, 400) : "";
    hits.push({ title, url: row.url.trim(), snippet });
    if (hits.length === 5) break;
  }
  return hits;
}

export async function openableUrl(raw: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That URL is not valid.");
  }
  await assertPublic(url);
  return url.toString();
}

export async function webSearch(query: string): Promise<SearchHit[]> {
  const name = (process.env.SEARCH_API || "tavily").trim().toLowerCase();
  const provider = SEARCH_PROVIDERS[name];
  if (!provider) throw new Error(`Search provider "${name}" is not set up.`);
  const key = process.env.SEARCH_API_KEY?.trim() ?? "";
  if (!key) throw new Error("Search is not configured.");
  try {
    return await provider(query, key);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed.";
    throw new Error(redact(message));
  }
}

export function formatSearch(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) {
    return webContent(`Search for: ${query}\nNo results.`);
  }
  const lines = hits.map((hit, index) =>
    [`${index + 1}. ${hit.title}`, hit.url, hit.snippet].filter(Boolean).join("\n"),
  );
  return webContent(`Search for: ${query}\n\n${lines.join("\n\n")}`);
}

export async function readPage(raw: string): Promise<{ url: string; text: string }> {
  let page: { url: string; status: number; contentType: string; body: Buffer };
  try {
    page = await fetchGet(raw, "text/html,application/xhtml+xml,text/plain;q=0.9", READ_BYTES);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The page could not be read.";
    throw new Error(redact(message));
  }
  if (page.status < 200 || page.status >= 300) {
    throw new Error(`The page returned HTTP ${page.status}.`);
  }
  if (/^\s*image\//i.test(page.contentType)) {
    throw new Error("That URL is an image. view_image can look at it.");
  }
  const { title, text } = readableText(page.body.toString("utf8"));
  if (!text) throw new Error("The page had no readable text.");
  const capped = capWords(text);
  const note = capped.trimmed ? `\n\n[Truncated to the first ${capped.max} words.]` : "";
  const heading = [page.url, title].filter(Boolean).join("\n");
  return {
    url: page.url,
    text: webContent(`${heading}\n\n${capped.text}${note}`),
  };
}

function sniffImage(bytes: Buffer): FetchedImage["mediaType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= png.length && bytes.subarray(0, png.length).equals(png)) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function viewImage(raw: string): Promise<FetchedImage> {
  const maxBytes = limit("VIEW_IMAGE_MAX_BYTES", IMAGE_BYTES_DEFAULT);
  let page: { url: string; status: number; contentType: string; body: Buffer };
  try {
    page = await fetchGet(raw, "image/jpeg,image/png,image/webp", maxBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image could not be fetched.";
    throw new Error(redact(message));
  }
  if (page.status < 200 || page.status >= 300) {
    throw new Error(`The image returned HTTP ${page.status}.`);
  }
  const mediaType = sniffImage(page.body);
  if (!mediaType) throw new Error("That file is not a jpeg, png, or webp image.");
  return { mediaType, data: page.body.toString("base64"), url: page.url };
}
