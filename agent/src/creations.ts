import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  galleryPicks,
  isCreationType,
  type CreationFileInfo,
  type CreationStatus,
  type CreationType,
  type CreationView,
  type CreationVersionView,
  type CreationsLibrary,
  type WorldEvent,
} from "@pips/shared";
import { calendarSeason } from "./season.js";
import {
  browseUrlsForTick,
  creationRow,
  diaryIdForTick,
  findOpenDraft,
  getSetting,
  insertCreation,
  insertVersion,
  listCreationRows,
  listVersionRows,
  makeEvent,
  saveCreationRow,
  setSetting,
  type CreationRow,
  type CreationVersionRow,
} from "./db.js";
import { dataDir } from "./env.js";
import { broadcast } from "./hub.js";

const DEFAULT_BUDGET = 2 * 1024 * 1024 * 1024;
const DEFAULT_MAX = 32 * 1024 * 1024;
const MAX_FILES = 12;
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;

const EXTENSIONS: Record<CreationType, string[]> = {
  art: [".png", ".svg"],
  writing: [".md"],
  design: [".json"],
  game: [".html", ".css", ".js", ".svg", ".png", ".json", ".txt"],
  site: [".html", ".css", ".js", ".svg", ".png", ".json", ".txt", ".md"],
  mechanic: [".json"],
};

const TEXT_EXT = new Set([".md", ".svg", ".json", ".html", ".css", ".js", ".txt"]);

export type StoredFile = { name: string; data: Buffer };

export function creationsRoot(): string {
  return path.join(dataDir(), "creations");
}

function versionDir(id: string, version: number): string {
  return path.join(creationsRoot(), id, `v${version}`);
}

function readBytes(key: string, fallback: number): number {
  const raw = getSetting(key);
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function storageBudget(): number {
  const fromEnv = Number(process.env.STORAGE_BUDGET_MB);
  const fallback = Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv * 1024 * 1024) : DEFAULT_BUDGET;
  return readBytes("storage_budget_bytes", fallback);
}

export function creationMaxBytes(): number {
  const fromEnv = Number(process.env.CREATION_MAX_MB);
  const fallback = Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv * 1024 * 1024) : DEFAULT_MAX;
  return readBytes("creation_max_bytes", fallback);
}

export function publicCreationsEnabled(): boolean {
  return getSetting("creations_public") === "1";
}

export function setPublicCreations(enabled: boolean): void {
  setSetting("creations_public", enabled ? "1" : "0");
  publishLibrary();
}

export function setStorageBudgetMb(megabytes: number): string | null {
  if (!Number.isFinite(megabytes) || megabytes < 64 || megabytes > 20000) {
    return "The storage budget needs to be between 64 MB and 20000 MB.";
  }
  setSetting("storage_budget_bytes", String(Math.floor(megabytes * 1024 * 1024)));
  publishLibrary();
  return null;
}

export function setCreationMaxMb(megabytes: number): string | null {
  if (!Number.isFinite(megabytes) || megabytes < 1 || megabytes > 512) {
    return "The size limit for one creation needs to be between 1 MB and 512 MB.";
  }
  setSetting("creation_max_bytes", String(Math.floor(megabytes * 1024 * 1024)));
  publishLibrary();
  return null;
}

function dirBytes(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) total += dirBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

export function storageUsed(): number {
  return dirBytes(creationsRoot());
}

function creationBytes(id: string): number {
  return dirBytes(path.join(creationsRoot(), id));
}

function hostOf(value: string): string | null {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./, "").slice(0, 120);
  } catch {
    return null;
  }
}

function domainsFrom(text: string, urls: string[]): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)]+/gi)) {
    const host = hostOf(match[0] ?? "");
    if (host) found.add(host);
  }
  for (const url of urls) {
    const host = hostOf(url);
    if (host) found.add(host);
  }
  return [...found].slice(0, 12);
}

function decodeFile(type: CreationType, name: string, content: string): StoredFile | string {
  if (!NAME_OK.test(name)) return `“${name}” is not a safe file name.`;
  const ext = path.extname(name).toLowerCase();
  if (!EXTENSIONS[type].includes(ext)) return `${type} files use ${EXTENSIONS[type].join(", ")}.`;
  let data: Buffer;
  if (ext === ".png") {
    const marker = "base64,";
    const at = content.indexOf(marker);
    const raw = at >= 0 ? content.slice(at + marker.length) : content.trim();
    data = Buffer.from(raw.replace(/\s/g, ""), "base64");
    if (data.length < 8 || data[0] !== 0x89 || data[1] !== 0x50) return `${name} is not a png.`;
  } else {
    if (content.includes("\0")) return `${name} needs to be text.`;
    data = Buffer.from(content, "utf8");
  }
  if (data.length === 0) return `${name} is empty.`;
  return { name, data };
}

export function filesFrom(type: CreationType, value: unknown): StoredFile[] | string {
  let record = value;
  if (typeof record === "string") {
    try {
      record = JSON.parse(record) as unknown;
    } catch {
      return "files need to be an object of file name to contents.";
    }
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return "files need to be an object of file name to contents.";
  }
  const entries = Object.entries(record as Record<string, unknown>);
  if (entries.length === 0) return "A creation needs at least one file.";
  if (entries.length > MAX_FILES) return `A version can hold ${MAX_FILES} files.`;
  const files: StoredFile[] = [];
  for (const [name, content] of entries) {
    if (typeof content !== "string") return `${name} needs text contents, or a base64 png.`;
    if (content.length > 12_000_000) return `${name} is too large to accept.`;
    const file = decodeFile(type, name, content);
    if (typeof file === "string") return file;
    files.push(file);
  }
  return files;
}

function writeVersion(id: string, version: number, type: CreationType, title: string, files: StoredFile[]): CreationVersionRow {
  const dir = versionDir(id, version);
  fs.mkdirSync(dir, { recursive: true });
  for (const file of files) fs.writeFileSync(path.join(dir, file.name), file.data);
  const image = files.find((file) => file.name.endsWith(".png") || file.name.endsWith(".svg"));
  let thumbnail = image?.name ?? null;
  if (!thumbnail) {
    thumbnail = "_thumb.svg";
    const label = title.replace(/[<>&"]/g, "").slice(0, 40);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f4efe6"/><text x="128" y="120" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#3d342c">${type}</text><text x="128" y="148" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#6b5b4b">${label}</text></svg>`;
    fs.writeFileSync(path.join(dir, thumbnail), svg);
  }
  const now = new Date().toISOString();
  const relative = path.relative(dataDir(), dir);
  const row: CreationVersionRow = {
    creationId: id,
    version,
    filesPath: relative,
    thumbnailPath: thumbnail,
    createdAt: now,
  };
  insertVersion(row);
  return row;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function mergeNotes(existing: string, notes: string, version: number): string {
  const line = notes.trim();
  if (!line) return existing;
  const next = existing ? `${existing}\n\nv${version}: ${line}` : line;
  return next.length <= 8000 ? next : next.slice(next.length - 8000);
}

function storageLine(extra = 0): string {
  const used = storageUsed();
  const budget = storageBudget();
  const ratio = budget > 0 ? (used + extra) / budget : 0;
  const percent = Math.round(ratio * 100);
  if (ratio >= 0.8) return ` Storage is at ${percent}% of the ${Math.round(budget / (1024 * 1024))} MB budget.`;
  return "";
}

export function saveCreation(args: {
  type: unknown;
  title: unknown;
  files: unknown;
  notes: unknown;
  inspiredBy: unknown;
  tick: number;
}): { result: string; events: WorldEvent[] } {
  if (!isCreationType(args.type)) {
    return { result: "type must be art, writing, design, game, site, or mechanic.", events: [] };
  }
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title || title.length > 80) return { result: "A title needs 1 to 80 characters.", events: [] };
  const notes = typeof args.notes === "string" ? clip(args.notes, 4000) : "";
  const inspired = typeof args.inspiredBy === "string" ? clip(args.inspiredBy, 1000) : "";
  const files = filesFrom(args.type, args.files);
  if (typeof files === "string") return { result: files, events: [] };
  const incoming = files.reduce((sum, file) => sum + file.data.length, 0);
  const budget = storageBudget();
  const used = storageUsed();
  if (used + incoming > budget) {
    return { result: "That would go past the storage budget. Finish or leave this for later.", events: [] };
  }
  const existing = findOpenDraft(args.type, title);
  if (existing && creationBytes(existing.id) + incoming > creationMaxBytes()) {
    return { result: "That version would pass the size limit for this creation.", events: [] };
  }
  if (!existing && incoming > creationMaxBytes()) {
    return { result: "That is larger than the size limit for one creation.", events: [] };
  }
  const now = new Date().toISOString();
  const diaryId = diaryIdForTick(args.tick);
  const domains = domainsFrom(`${inspired}\n${notes}`, browseUrlsForTick(args.tick));
  if (!existing) {
    const id = randomUUID().replaceAll("-", "").slice(0, 12);
    const row: CreationRow = {
      id,
      type: args.type,
      title,
      description: clip(notes, 200),
      pipNotes: notes,
      status: "draft",
      season: calendarSeason().season,
      createdAt: now,
      updatedAt: now,
      favourite: false,
      archived: false,
      inspiredBy: inspired,
      diaryIds: diaryId ? [diaryId] : [],
      domains,
      sourceTick: args.tick,
    };
    insertCreation(row);
    const version = writeVersion(id, 1, args.type, title, files);
    const events: WorldEvent[] = [
      makeEvent("creation_started", { creationId: id, type: args.type, title, version: version.version }, args.tick),
    ];
    publishLibrary();
    return {
      result: `Creation ${id} is started: ${title}. Version 1 is in the studio.${storageLine()}`,
      events,
    };
  }
  const versionNumber = listVersionRows(existing.id).length + 1;
  writeVersion(existing.id, versionNumber, args.type, title, files);
  const mergedDomains = [...new Set([...existing.domains, ...domains])].slice(0, 12);
  const diaryIds = diaryId && !existing.diaryIds.includes(diaryId) ? [...existing.diaryIds, diaryId] : existing.diaryIds;
  saveCreationRow({
    ...existing,
    description: existing.description || clip(notes, 200),
    pipNotes: mergeNotes(existing.pipNotes, notes, versionNumber),
    inspiredBy: inspired || existing.inspiredBy,
    domains: mergedDomains,
    diaryIds,
    updatedAt: now,
    sourceTick: args.tick,
  });
  publishLibrary();
  return {
    result: `Creation ${existing.id} version ${versionNumber} is saved: ${title}.${storageLine()}`,
    events: [
      makeEvent(
        "creation_updated",
        { creationId: existing.id, type: args.type, title, version: versionNumber },
        args.tick,
      ),
    ],
  };
}

export function finishCreation(id: unknown, tick: number): { result: string; events: WorldEvent[] } {
  if (typeof id !== "string" || !id.trim()) return { result: "Pass the creation id.", events: [] };
  const row = creationRow(id.trim());
  if (!row) return { result: "No creation with that id.", events: [] };
  if (row.archived) return { result: "That creation is archived.", events: [] };
  if (row.status !== "draft") return { result: "That creation is already finished.", events: [] };
  const version = listVersionRows(row.id).at(-1)?.version ?? 1;
  saveCreationRow({ ...row, status: "finished", updatedAt: new Date().toISOString(), sourceTick: tick });
  publishLibrary();
  return {
    result: `Creation ${row.id} is finished: ${row.title}. It can be shown in the gallery.`,
    events: [makeEvent("creation_finished", { creationId: row.id, type: row.type, title: row.title, version }, tick)],
  };
}

export function listCreations(filter: unknown): string {
  const wanted = typeof filter === "string" ? filter.trim().toLowerCase() : "";
  let rows = listCreationRows().filter((row) => !row.archived);
  if (wanted === "archived") rows = listCreationRows().filter((row) => row.archived);
  else if (wanted === "starred" || wanted === "favourite") rows = rows.filter((row) => row.favourite);
  else if (wanted) rows = rows.filter((row) => row.type === wanted || row.status === wanted || row.season === wanted);
  if (rows.length === 0) return wanted ? `No creations match ${wanted}.` : "No creations yet.";
  return rows
    .slice(0, 20)
    .map((row) => `${row.id} ${row.status} ${row.type} “${row.title}” (${row.season})`)
    .join("\n");
}

function readTextPreview(dir: string, name: string): string | null {
  const ext = path.extname(name).toLowerCase();
  if (!TEXT_EXT.has(ext) || name.startsWith("_")) return null;
  const full = path.join(dir, name);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8").slice(0, 1500);
}

export function openCreation(id: unknown): string {
  if (typeof id !== "string" || !id.trim()) return "Pass the creation id.";
  const row = creationRow(id.trim());
  if (!row) return "No creation with that id.";
  const versions = listVersionRows(row.id);
  const lines = [
    `${row.id} ${row.status} ${row.type}: ${row.title}`,
    row.pipNotes ? `Notes: ${row.pipNotes}` : "Notes: none yet.",
    row.inspiredBy ? `Inspired by: ${row.inspiredBy}` : "",
    row.domains.length ? `Domains: ${row.domains.join(", ")}` : "",
    row.diaryIds.length ? `Diary entries: ${row.diaryIds.join(", ")}` : "",
  ].filter(Boolean);
  for (const version of versions) {
    const dir = path.resolve(dataDir(), version.filesPath);
    const names = userFiles(dir);
    lines.push(`Version ${version.version}: ${names.join(", ") || "no files"}`);
    for (const name of names) {
      const preview = readTextPreview(dir, name);
      if (preview) lines.push(`--- ${name}\n${preview}`);
    }
  }
  return lines.join("\n");
}

function userFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => NAME_OK.test(name) && !name.startsWith("_") && fs.statSync(path.join(dir, name)).isFile());
}

function fileInfos(dir: string): CreationFileInfo[] {
  return userFiles(dir).map((name) => ({ name, bytes: fs.statSync(path.join(dir, name)).size }));
}

function toView(row: CreationRow): CreationView {
  const versions: CreationVersionView[] = listVersionRows(row.id).map((version) => {
    const dir = path.resolve(dataDir(), version.filesPath);
    const thumb = version.thumbnailPath;
    return {
      version: version.version,
      createdAt: version.createdAt,
      thumbnailUrl: thumb ? `/creations/${row.id}/v/${version.version}/${encodeURIComponent(thumb)}` : null,
      files: fileInfos(dir),
    };
  });
  return {
    id: row.id,
    type: row.type as CreationType,
    title: row.title,
    description: row.description,
    pipNotes: row.pipNotes,
    status: row.status as CreationStatus,
    season: row.season,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    favourite: row.favourite,
    archived: row.archived,
    inspiredBy: row.inspiredBy,
    diaryIds: row.diaryIds,
    domains: row.domains,
    versions,
  };
}

export function libraryView(): CreationsLibrary {
  return {
    items: listCreationRows().map(toView),
    usedBytes: storageUsed(),
    budgetBytes: storageBudget(),
    maxCreationBytes: creationMaxBytes(),
    publicEnabled: publicCreationsEnabled(),
  };
}

export function publishLibrary(): void {
  broadcast({ type: "creations", creations: libraryView() });
}

export function archiveCreation(id: string): string | null {
  const row = creationRow(id);
  if (!row) return "No creation with that id.";
  if (row.archived) return null;
  saveCreationRow({ ...row, archived: true, updatedAt: new Date().toISOString() });
  publishLibrary();
  return null;
}

export function starCreation(id: string, favourite: boolean): string | null {
  const row = creationRow(id);
  if (!row) return "No creation with that id.";
  saveCreationRow({ ...row, favourite, updatedAt: row.updatedAt });
  publishLibrary();
  return null;
}

export function publishCreation(id: string): string | null {
  const row = creationRow(id);
  if (!row) return "No creation with that id.";
  if (row.archived) return "Archived creations stay in the library.";
  if (row.status === "draft") return "Finish it before marking it public.";
  saveCreationRow({ ...row, status: "published", updatedAt: new Date().toISOString() });
  publishLibrary();
  return null;
}

export function unpublishCreation(id: string): string | null {
  const row = creationRow(id);
  if (!row) return "No creation with that id.";
  if (row.status !== "published") return null;
  saveCreationRow({ ...row, status: "finished", updatedAt: new Date().toISOString() });
  publishLibrary();
  return null;
}

export function creationContext(): string {
  const items = listCreationRows().filter((row) => !row.archived);
  const drafts = items.filter((row) => row.status === "draft");
  const lines = ["Studio:"];
  if (drafts.length === 0) lines.push("Open drafts: none.");
  else {
    lines.push("Open drafts:");
    for (const row of drafts.slice(0, 6)) {
      const version = listVersionRows(row.id).length;
      lines.push(`- ${row.id} ${row.type} “${row.title}”, version ${version}.`);
    }
  }
  lines.push("You choose what to make. You can save a version, finish a draft, or leave it.");
  return lines.join("\n");
}

export function resolveCreationFile(
  id: string,
  version: number,
  fileName: string,
  publishedOnly: boolean,
): { file: string; downloadName: string } | null {
  if (!/^[a-f0-9]{8,36}$/.test(id) || !Number.isInteger(version) || version < 1) return null;
  const row = creationRow(id);
  if (!row) return null;
  if (publishedOnly && (row.status !== "published" || row.archived || !publicCreationsEnabled())) return null;
  const safe = path.basename(fileName);
  if (!NAME_OK.test(safe) && safe !== "_thumb.svg") return null;
  const stored = listVersionRows(id).find((item) => item.version === version);
  if (!stored) return null;
  const dir = path.resolve(dataDir(), stored.filesPath);
  const file = path.resolve(dir, safe);
  if (file !== dir && !file.startsWith(dir + path.sep)) return null;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return { file, downloadName: safe };
}

export function zipVersion(id: string, version: number): Buffer | null {
  const stored = listVersionRows(id).find((item) => item.version === version);
  const row = creationRow(id);
  if (!stored || !row) return null;
  const dir = path.resolve(dataDir(), stored.filesPath);
  const files = userFiles(dir).map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) }));
  if (files.length === 0) return null;
  return zipStored(files);
}

export function publicPage(): string | null {
  if (!publicCreationsEnabled()) return null;
  const items = galleryPicks(libraryView().items).filter((item) => item.status === "published");
  const cards = items
    .map((item) => {
      const thumb = item.versions.at(-1)?.thumbnailUrl;
      const src = thumb ? thumb.replace("/creations/", "/public/creations/") : "";
      const image = src ? `<img src="${escapeHtml(src)}" alt="">` : "";
      return `<article>${image}<h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.type)} · ${escapeHtml(item.season)}</p><p>${escapeHtml(item.description)}</p></article>`;
    })
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pip's creations</title><style>:root{color-scheme:light;--ink:#2a241c;--ink-soft:#5c5146;--paper:#f6f0e4;--paper-raised:#fffaf3;--line:#e4d5c0;--sky:#b7d4ea;--shadow:0 12px 32px rgba(48,32,16,.14)}@media (prefers-color-scheme:dark){:root{color-scheme:dark;--ink:#f6f0e4;--ink-soft:#d4c6b4;--paper:#241e18;--paper-raised:#322922;--line:#4a3d32;--sky:#1c2830;--shadow:0 12px 32px rgba(0,0,0,.35)}}body{margin:0;min-height:100dvh;background:var(--sky);color:var(--ink);font:16px/1.45 "Source Sans 3","Avenir Next",sans-serif;padding:32px 16px}main{max-width:960px;margin:0 auto}h1{font-family:Nunito,"Avenir Next",sans-serif;font-size:28px;line-height:1.2;margin:0 0 16px}p{color:var(--ink-soft)}article{display:inline-block;width:14rem;vertical-align:top;margin:0 16px 16px 0;padding:16px;background:var(--paper-raised);border-radius:12px;box-shadow:var(--shadow)}img{width:100%;border-radius:8px;background:var(--paper)}</style></head><body><main><p>AI-made</p><h1>Finished creations</h1>${cards || "<p>Nothing is public yet.</p>"}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(20, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    parts.push(local, file.data);
    const cen = Buffer.alloc(46 + name.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(file.data.length, 20);
    cen.writeUInt32LE(file.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    name.copy(cen, 46);
    central.push(cen);
    offset += local.length + file.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
}
