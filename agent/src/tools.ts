import { randomUUID } from "node:crypto";
import { BUILDING_NAMES, isBuildingId, type BrowseTool, type WorldEvent } from "@pips/shared";
import { lastMoveTarget, makeEvent, saveEvents } from "./db.js";
import { broadcast } from "./hub.js";
import type { LookImage, ToolSpec } from "./llm.js";
import { readMemory, writeMemory } from "./memory.js";
import { noteRead, noteSearch, readCap, readsLeft, searchCap, searchesLeft, webCallsPerTick } from "./usage.js";
import { domainOf, formatSearch, openableUrl, readPage, viewImage, webContent, webSearch } from "./web.js";
import { runBuild } from "./build.js";

const TEXT_MAX = 4000;
const FILE_MAX = 12_000;

const PLACE_SCHEMA = {
  type: "object",
  properties: {
    place: {
      type: "string",
      enum: ["home", "library", "workshop", "gallery", "mailbox"],
      description: "Where to go.",
    },
  },
  required: ["place"],
};

const TEXT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "The full text to save." },
  },
  required: ["text"],
};

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "What to look up." },
  },
  required: ["query"],
};

const URL_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", description: "An http or https URL." },
  },
  required: ["url"],
};

export const PIP_TOOLS: ToolSpec[] = [
  {
    name: "move_to",
    description: "Walk to a place in the village: home, library, workshop, gallery, or mailbox.",
    parameters: PLACE_SCHEMA,
    required: ["place"],
  },
  {
    name: "web_search",
    description: "Search the public web. Returns the top 5 results with title, url, and snippet.",
    parameters: QUERY_SCHEMA,
    required: ["query"],
  },
  {
    name: "read_page",
    description: "Read the text of a public http or https page. Read-only: no logins, forms, or changes.",
    parameters: URL_SCHEMA,
    required: ["url"],
  },
  {
    name: "view_image",
    description: "Look at a public jpeg, png, or webp image.",
    parameters: URL_SCHEMA,
    required: ["url"],
  },
  {
    name: "write_diary",
    description: "Save this hour's diary entry in your own words. Call this at the end of every hour.",
    parameters: TEXT_SCHEMA,
    required: ["text"],
  },
  {
    name: "write_journal",
    description: "Save a journal entry. Used at the end of a day to reflect on that day's diary.",
    parameters: TEXT_SCHEMA,
    required: ["text"],
  },
  {
    name: "update_identity",
    description: "Replace identity.md with the full text you want to keep. You write this file yourself.",
    parameters: TEXT_SCHEMA,
    required: ["text"],
  },
  {
    name: "update_interests",
    description:
      "Replace interests.md with the full text you want to keep. You write this file yourself.",
    parameters: TEXT_SCHEMA,
    required: ["text"],
  },
  {
    name: "build",
    description:
      "Add, move, or remove something you placed in the village. Types: bench, garden_bed, shelf, lamp, tree, flower_patch, fence, path_tile. x and z are metres from the centre. rotation is radians. Pass id when moving or removing one of several. You cannot move or remove the houses or the trees that were already here.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "move", "remove"], description: "What to do." },
        type: {
          type: "string",
          enum: ["bench", "garden_bed", "shelf", "lamp", "tree", "flower_patch", "fence", "path_tile"],
          description: "What kind of object.",
        },
        x: { type: "number", description: "Metres east of the centre." },
        z: { type: "number", description: "Metres north of the centre." },
        rotation: { type: "number", description: "Rotation in radians. Optional." },
        style: { type: "string", description: "A short style note. Optional." },
        id: { type: "string", description: "Id of an object you placed, for move or remove." },
      },
      required: ["action", "type", "x", "z"],
    },
    required: ["action", "type", "x", "z"],
  },
];

export const DIARY_TOOL = PIP_TOOLS.filter((tool) => tool.name === "write_diary");
export const JOURNAL_TOOL = PIP_TOOLS.filter((tool) => tool.name === "write_journal");

export type ToolFlags = {
  wroteDiary: boolean;
  wroteJournal: boolean;
  webCalls: number;
};

export type ToolOutcome = {
  result: string;
  kind: string | null;
  image?: LookImage;
};

function publish(event: WorldEvent): void {
  saveEvents([event]);
  broadcast({ type: "event", event });
}

function textOf(args: Record<string, unknown>, max: number): { text: string; note: string } | { error: string } {
  const raw = args.text;
  if (typeof raw !== "string" || raw.trim() === "") return { error: "text is empty." };
  const text = raw.trim();
  if (text.length <= max) return { text, note: "" };
  return { text: text.slice(0, max), note: ` Saved the first ${max} characters.` };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tick: number,
  flags: ToolFlags,
): Promise<ToolOutcome> {
  switch (name) {
    case "move_to":
      return moveTo(args, tick);
    case "web_search":
      return runSearch(args, tick, flags);
    case "read_page":
      return runRead(args, tick, flags);
    case "view_image":
      return runView(args, tick, flags);
    case "write_diary":
      return writeDiary(args, tick, flags);
    case "write_journal":
      return writeJournal(args, tick, flags);
    case "update_identity":
      return updateFile("identity.md", args);
    case "update_interests":
      return updateFile("interests.md", args);
    case "build":
      return runBuild(args, tick);
    default:
      return { result: "Unknown tool.", kind: null };
  }
}

function beginWeb(flags: ToolFlags): string | null {
  if (flags.webCalls >= webCallsPerTick()) return "The web call limit for this hour is used up.";
  flags.webCalls += 1;
  return null;
}

function logBrowse(tool: BrowseTool, url: string, query: string | null, tick: number): void {
  publish(
    makeEvent<Extract<WorldEvent, { kind: "browse" }>>("browse", { tool, url, query }, tick),
  );
}

function showBrowsing(domain: string | null): void {
  broadcast({ type: "browsing", domain });
}

async function runSearch(
  args: Record<string, unknown>,
  tick: number,
  flags: ToolFlags,
): Promise<ToolOutcome> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { result: "query is empty.", kind: null };
  if (query.length > 300) return { result: "query is too long.", kind: null };
  const blocked = beginWeb(flags);
  if (blocked) return { result: blocked, kind: null };
  if (!searchesLeft()) {
    return { result: `The day's search limit (${searchCap()}) is used up.`, kind: null };
  }
  noteSearch();
  try {
    const hits = await webSearch(query);
    const url = hits[0]?.url ?? "";
    logBrowse("web_search", url, query, tick);
    return { result: formatSearch(query, hits), kind: "browse" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed.";
    logBrowse("web_search", "", query, tick);
    return { result: message, kind: "browse" };
  }
}

async function runRead(
  args: Record<string, unknown>,
  tick: number,
  flags: ToolFlags,
): Promise<ToolOutcome> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return { result: "url is empty.", kind: null };
  if (url.length > 2000) return { result: "url is too long.", kind: null };
  const blocked = beginWeb(flags);
  if (blocked) return { result: blocked, kind: null };
  let safe: string;
  try {
    safe = await openableUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "That address is blocked.";
    logBrowse("read_page", url, null, tick);
    return { result: message, kind: "browse" };
  }
  if (!readsLeft()) {
    return { result: `The day's page reading limit (${readCap()}) is used up.`, kind: null };
  }
  noteRead();
  showBrowsing(domainOf(safe));
  try {
    const page = await readPage(safe);
    logBrowse("read_page", page.url, null, tick);
    return { result: page.text, kind: "browse" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The page could not be read.";
    logBrowse("read_page", url, null, tick);
    return { result: message, kind: "browse" };
  } finally {
    showBrowsing(null);
  }
}

async function runView(
  args: Record<string, unknown>,
  tick: number,
  flags: ToolFlags,
): Promise<ToolOutcome> {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url) return { result: "url is empty.", kind: null };
  if (url.length > 2000) return { result: "url is too long.", kind: null };
  const blocked = beginWeb(flags);
  if (blocked) return { result: blocked, kind: null };
  let safe: string;
  try {
    safe = await openableUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "That address is blocked.";
    logBrowse("view_image", url, null, tick);
    return { result: message, kind: "browse" };
  }
  showBrowsing(domainOf(safe));
  try {
    const image = await viewImage(safe);
    logBrowse("view_image", image.url, null, tick);
    return {
      result: webContent(`Image from ${image.url}\nType: ${image.mediaType}\nThe image is attached for you to look at.`),
      kind: "browse",
      image: { mediaType: image.mediaType, data: image.data, url: image.url },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The image could not be fetched.";
    logBrowse("view_image", url, null, tick);
    return { result: message, kind: "browse" };
  } finally {
    showBrowsing(null);
  }
}

function moveTo(args: Record<string, unknown>, tick: number): ToolOutcome {
  const place = args.place;
  if (!isBuildingId(place)) {
    return {
      result: "place must be one of: home, library, workshop, gallery, mailbox.",
      kind: null,
    };
  }
  const from = lastMoveTarget();
  if (from === place) {
    return { result: `You are already at ${BUILDING_NAMES[place]}.`, kind: null };
  }
  publish(
    makeEvent<Extract<WorldEvent, { kind: "move" }>>("move", { from, to: place }, tick),
  );
  const fromName = from ? BUILDING_NAMES[from] : null;
  const toName = BUILDING_NAMES[place];
  const result = fromName ? `You walked from ${fromName} to ${toName}.` : `You walked to ${toName}.`;
  return { result, kind: "move" };
}

function writeDiary(args: Record<string, unknown>, tick: number, flags: ToolFlags): ToolOutcome {
  const parsed = textOf(args, TEXT_MAX);
  if ("error" in parsed) return { result: parsed.error, kind: null };
  publish(
    makeEvent<Extract<WorldEvent, { kind: "diary" }>>(
      "diary",
      { entryId: randomUUID(), body: parsed.text },
      tick,
    ),
  );
  flags.wroteDiary = true;
  return { result: `Diary saved.${parsed.note}`, kind: "diary" };
}

function writeJournal(args: Record<string, unknown>, tick: number, flags: ToolFlags): ToolOutcome {
  const parsed = textOf(args, TEXT_MAX);
  if ("error" in parsed) return { result: parsed.error, kind: null };
  publish(
    makeEvent<Extract<WorldEvent, { kind: "journal" }>>(
      "journal",
      { entryId: randomUUID(), body: parsed.text },
      tick,
    ),
  );
  flags.wroteJournal = true;
  return { result: `Journal saved.${parsed.note}`, kind: "journal" };
}

function updateFile(file: "identity.md" | "interests.md", args: Record<string, unknown>): ToolOutcome {
  const parsed = textOf(args, FILE_MAX);
  if ("error" in parsed) return { result: parsed.error, kind: null };
  writeMemory(file, parsed.text);
  const label = file === "identity.md" ? "Identity" : "Interests";
  return { result: `${label} file replaced.${parsed.note}`, kind: file === "identity.md" ? "identity" : "interests" };
}

export function memorySnapshot(file: "identity.md" | "interests.md" | "projects.md"): string {
  const text = readMemory(file).trim();
  return text || "(empty)";
}
