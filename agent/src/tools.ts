import { randomUUID } from "node:crypto";
import { BUILDING_NAMES, isBuildingId, type BrowseTool, type WorldEvent } from "@pips/shared";
import { lastMoveTarget, latestToolRaw, listRequests, makeEvent, recallWithin, recentDiary, rememberIdentity, rememberRecall, saveEvents } from "./db.js";
import { nearDuplicate, noteDuplicate } from "./duplicates.js";
import { broadcast } from "./hub.js";
import type { LookImage, ToolSpec } from "./llm.js";
import { readMemory, writeMemory } from "./memory.js";
import { saveStructuredInterests } from "./interests.js";
import { noteRead, noteSearch, readCap, readsLeft, searchCap, searchesLeft, webCallsPerTick } from "./usage.js";
import { domainOf, formatSearch, openableUrl, readPage, viewImage, webContent, webSearch } from "./web.js";
import { runBuild } from "./build.js";
import { designBlueprint, layPath, previewBlueprint } from "./blueprints.js";
import { continueStudy, endStudy, saveNote, searchNotes, startStudy } from "./growth.js";
import { finishCreation, listCreations, openCreation, saveCreation } from "./creations.js";
import { explorePlot, proposeExpansion } from "./plots.js";
import { explainToolError } from "./toolArgs.js";

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
    description: "Walk to a place in the village: home, library, workshop, gallery, or mailbox. Example: move_to(place=\"home\").",
    parameters: PLACE_SCHEMA,
    required: ["place"],
  },
  {
    name: "web_search",
    description: "Search the public web. Returns the top 5 results with title, url, and snippet. Example: web_search(query=\"paper boats\").",
    parameters: QUERY_SCHEMA,
    required: ["query"],
  },
  {
    name: "read_page",
    description: "Read the text of a public http or https page. Read-only: no logins, forms, or changes. Example: read_page(url=\"https://example.com\").",
    parameters: URL_SCHEMA,
    required: ["url"],
  },
  {
    name: "view_image",
    description: "Look at a public jpeg, png, or webp image. Example: view_image(url=\"https://example.com/sketch.png\").",
    parameters: URL_SCHEMA,
    required: ["url"],
  },
  {
    name: "write_diary",
    description:
      "Save the diary entry for this tick, about what you did and noticed since your last entry. Call this at the end of every tick. Example: write_diary(text=\"I placed a garden bed near the path.\").",
    parameters: TEXT_SCHEMA,
    required: ["text"],
  },
  {
    name: "write_journal",
    description: "Save a journal entry. Used at the end of a day to reflect on that day's diary. Example: write_journal(text=\"Today I kept one small change.\").",
    parameters: TEXT_SCHEMA,
    required: ["text"],
  },
  {
    name: "update_identity",
    description: "Replace identity.md with the full text you want to keep. You write this file yourself. Example: update_identity(text=\"I keep a short note of who I am.\").",
    parameters: TEXT_SCHEMA,
    required: ["text"],
  },
  {
    name: "update_interests",
    description:
      "Replace interests.md with the full text you want to keep. You write this file yourself. Or pass items, a list of {name, summary, strength, first_seen, last_active, evidence}, and the file is rewritten from that list. Example: update_interests(text=\"Paper boats.\").",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The full text to save, when you are not sending items." },
        items: {
          type: "array",
          description: "Optional structured interests. When present, this list replaces the interest file.",
          items: { type: "object" },
        },
      },
      required: ["text"],
    },
    required: [],
  },
  {
    name: "design_blueprint",
    description:
      'Create or publish a new version of a blueprint. name is lowercase. spec is a JSON object of primitives, or pass the same JSON as spec_json. Example: design_blueprint(name="stone_seat", spec={"primitives":[{"shape":"box","size":[1,0.4,0.5],"position":[0,0.2,0],"rotation":[0,0,0],"colour":"#8d8680"}]}).',
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Blueprint name, lowercase letters and underscores." },
        spec: { type: "object", description: "JSON blueprint. Primitives only: shape, size, position, rotation, colour." },
        spec_json: { type: "string", description: "The same spec as a JSON string, if you are not sending spec as an object." },
        why: { type: "string", description: "Optional sentence on what you changed." },
      },
      required: ["name", "spec"],
    },
    required: ["name", "spec"],
  },
  {
    name: "preview_blueprint",
    description:
      "Draw the latest version of a blueprint and show you the picture, so you can critique it and revise. At most 4 previews of one blueprint per day. Example: preview_blueprint(name=\"stone_seat\").",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Blueprint name." },
      },
      required: ["name"],
    },
    required: ["name"],
  },
  {
    name: "lay_path",
    description:
      "Store a path as a list of { x, z } points inside the village. Optional object_id attaches it to something you placed, for a blueprint whose behaviour is follow_path. Example: lay_path(name=\"gate_walk\", points=[{\"x\":0,\"z\":0},{\"x\":2,\"z\":1}]).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Path name." },
        points: {
          type: "array",
          description: "Between 2 and 24 points.",
          items: {
            type: "object",
            properties: {
              x: { type: "number" },
              z: { type: "number" },
            },
            required: ["x", "z"],
          },
        },
        object_id: { type: "string", description: "Optional id of an object you placed." },
      },
      required: ["name", "points"],
    },
    required: ["name", "points"],
  },
  {
    name: "build",
    description:
      'Add, move, or remove something you placed in the village. type is a live blueprint name, such as bench, garden_bed, shelf, lamp, tree, flower_patch, fence, or path_tile, or one you designed. x and z are plain numbers, metres from the centre. rotation is radians. Pass id when moving or removing one of several. You cannot move or remove the houses or the trees that were already here. Example: build(action="add", type="garden_bed", x=1, z=1).',
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "move", "remove"], description: "What to do." },
        type: {
          type: "string",
          description: "Blueprint name to place.",
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
  {
    name: "start_study",
    description:
      "Open a study on a topic you choose. Say why it matters to you and how many ticks you plan, from 1 to 12. At most two studies can be open. Example: start_study(topic=\"paper boats\", why=\"I want to see how they float.\", planned_ticks=4).",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic you chose." },
        why: { type: "string", description: "Why you want to spend time on it." },
        planned_ticks: {
          type: "number",
          description: "How many 30-minute ticks you plan, from 1 to 12.",
        },
      },
      required: ["topic", "why", "planned_ticks"],
    },
    required: ["topic", "why"],
  },
  {
    name: "continue_study",
    description: "Add what you learned to an open study. Pass its id and your notes. Example: continue_study(id=\"study-id\", notes=\"A wide base stays up.\").",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Study id." },
        notes: { type: "string", description: "What you learned this tick." },
      },
      required: ["id", "notes"],
    },
    required: ["id", "notes"],
  },
  {
    name: "end_study",
    description: "Close an open study with a short summary of what you keep from it. Example: end_study(id=\"study-id\", summary=\"A wide base stays up.\").",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Study id." },
        summary: { type: "string", description: "What you want to keep." },
      },
      required: ["id", "summary"],
    },
    required: ["id", "summary"],
  },
  {
    name: "save_note",
    description: "Save a knowledge note on a topic, with the text and any sources you actually used. Example: save_note(topic=\"paper boats\", text=\"A wide base stays up.\").",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic of the note." },
        text: { type: "string", description: "What you want to remember." },
        sources: { type: "string", description: "Links or names of sources. Optional." },
      },
      required: ["topic", "text"],
    },
    required: ["topic", "text"],
  },
  {
    name: "search_notes",
    description: "Search notes you have saved. Pass a topic or a few words. Example: search_notes(topic=\"paper boats\").",
    parameters: {
      type: "object",
      properties: {
        topic: { type: "string", description: "What to look for." },
      },
      required: ["topic"],
    },
    required: ["topic"],
  },
  {
    name: "save_creation",
    description:
      "Start a creation, or save a new version of an open draft with the same type and title. You choose the subject. Files are an object of file name to text (png may be a base64 data URL). Example: save_creation(type=\"writing\", title=\"Boat note\", files={\"note.md\":\"A wide base stays up.\"}).",
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["art", "writing", "design", "game", "site", "mechanic"],
          description: "What kind of thing this is.",
        },
        title: { type: "string", description: "The title you want on it." },
        files: {
          type: "object",
          description: "File name to contents. Art is png or svg. Writing is markdown. Design and mechanic are json. A game or site is static files.",
        },
        notes: { type: "string", description: "Why you made it, and what you learned." },
        inspired_by: { type: "string", description: "What you were looking at, if anything. Optional." },
      },
      required: ["type", "title", "files"],
    },
    required: ["type", "title"],
  },
  {
    name: "list_creations",
    description: "List creations. Filter by a type, a status, a season, starred, or archived. Leave the filter empty to see what is not archived. Example: list_creations(filter=\"writing\").",
    parameters: {
      type: "object",
      properties: {
        filter: { type: "string", description: "Optional filter." },
      },
    },
    required: [],
  },
  {
    name: "open_creation",
    description: "Read one creation: notes, versions, and the text of its files. Example: open_creation(id=\"creation-id\").",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Creation id." },
      },
      required: ["id"],
    },
    required: ["id"],
  },
  {
    name: "finish_creation",
    description: "Mark a draft finished so it can be shown in the gallery. You do not publish it. Example: finish_creation(id=\"creation-id\").",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Creation id." },
      },
      required: ["id"],
    },
    required: ["id"],
  },
  {
    name: "propose_expansion",
    description:
      "Ask the owner to open a plot that shares a side with land already open. Ask rarely, and always give your own reason. plot is the grid of a mist edge. A request already filed for that plot is returned instead. Example: propose_expansion(plot=\"1,1\", reason=\"The rocks are the next edge I can see.\").",
    parameters: {
      type: "object",
      properties: {
        plot: { type: "string", description: "Grid of the mist plot, such as two numbers separated by a comma." },
        reason: { type: "string", description: "Why you want to go there." },
      },
      required: ["plot", "reason"],
    },
    required: ["plot", "reason"],
  },
  {
    name: "explore",
    description: "Walk to the near edge of a plot the owner has already opened. plot is its grid. Example: explore(plot=\"0,0\").",
    parameters: {
      type: "object",
      properties: {
        plot: { type: "string", description: "Grid of an open plot, such as two numbers separated by a comma." },
      },
      required: ["plot"],
    },
    required: ["plot"],
  },
  {
    name: "propose_mechanic",
    description:
      "Ask the owner to approve a mechanic. Say what it is. A near-duplicate of one already filed is returned instead. Example: propose_mechanic(title=\"A small bell\", detail=\"A bell by the gate.\").",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short name for the mechanic." },
        detail: { type: "string", description: "What you want considered." },
      },
      required: ["title", "detail"],
    },
    required: ["title", "detail"],
  },
  {
    name: "report_problem",
    description:
      'Tell the owner that a tool failed after you tried the corrected example twice. Then do something else. Example: report_problem(tool="build", what_happened="build failed twice after the example call.").',
    parameters: {
      type: "object",
      properties: {
        tool: { type: "string", description: "The tool that failed." },
        what_happened: { type: "string", description: "What the tool returned." },
      },
      required: ["tool", "what_happened"],
    },
    required: ["tool", "what_happened"],
  },
];

export const DIARY_TOOL = PIP_TOOLS.filter((tool) => tool.name === "write_diary");
export const JOURNAL_TOOL = PIP_TOOLS.filter((tool) => tool.name === "write_journal");

export type ToolFlags = {
  wroteDiary: boolean;
  wroteJournal: boolean;
  webCalls: number;
  diaryAsked: boolean;
};

export type ToolOutcome = {
  result: string;
  kind: string | null;
  image?: LookImage;
};

function withExample(name: string, args: Record<string, unknown>, outcome: ToolOutcome): ToolOutcome {
  if (outcome.kind) return outcome;
  if (outcome.result.includes("Example:")) return outcome;
  return { ...outcome, result: explainToolError(name, args, outcome.result) };
}

function reportProblem(args: Record<string, unknown>, tick: number): ToolOutcome {
  const tool = typeof args.tool === "string" ? args.tool.trim() : "";
  const what = typeof args.what_happened === "string" ? args.what_happened.trim() : "";
  if (!tool) return { result: explainToolError("report_problem", args, "tool is missing."), kind: null };
  if (!what) return { result: explainToolError("report_problem", args, "what_happened is missing."), kind: null };
  const raw = latestToolRaw(tool);
  const body = [what.slice(0, 800), raw ? `Logged call: ${raw}` : "No logged call for that tool."]
    .join("\n\n")
    .slice(0, 2000);
  publish(
    makeEvent<Extract<WorldEvent, { kind: "request" }>>(
      "request",
      { requestId: randomUUID(), title: `Tool problem: ${tool}`.slice(0, 120), body },
      tick,
    ),
  );
  return { result: `Filed for the owner: Tool problem: ${tool}.`, kind: "request" };
}

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
      if (args.items !== undefined) {
        const error = saveStructuredInterests(args.items);
        return error ? { result: error, kind: null } : { result: "Interests updated from the list you sent.", kind: "interests" };
      }
      return updateFile("interests.md", args);
    case "build":
      return withExample("build", args, runBuild(args, tick));
    case "design_blueprint":
      return withExample(
        "design_blueprint",
        args,
        designBlueprint(
          typeof args.name === "string" ? args.name : "",
          args.spec,
          tick,
          typeof args.why === "string" ? args.why : undefined,
        ),
      );
    case "preview_blueprint":
      return previewBlueprint(typeof args.name === "string" ? args.name : "", tick);
    case "lay_path":
      return layPath(args, tick);
    case "start_study":
      return startStudy(args.topic, args.why, args.planned_ticks);
    case "continue_study":
      return continueStudy(args.id, args.notes);
    case "end_study":
      return endStudy(args.id, args.summary);
    case "save_note":
      return saveNote(args.topic, args.text, args.sources);
    case "search_notes":
      return searchNotes(args.topic);
    case "save_creation":
      return runSaveCreation(args, tick);
    case "list_creations":
      return { result: listCreations(args.filter), kind: null };
    case "open_creation":
      return { result: openCreation(args.id), kind: null };
    case "finish_creation":
      return runFinishCreation(args, tick);
    case "propose_expansion":
      return proposeExpansion(args, tick);
    case "explore":
      return explorePlot(args, tick);
    case "report_problem":
      return reportProblem(args, tick);
    case "propose_mechanic":
      return propose("Mechanic", args, tick);
    default:
      return { result: "Unknown tool.", kind: null };
  }
}

function beginWeb(flags: ToolFlags): string | null {
  if (flags.webCalls >= webCallsPerTick()) return "The web call limit for this tick is used up.";
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
  const cachedSearch = recallWithin("search", queryKey(query), 24 * 60 * 60 * 1000);
  if (cachedSearch !== null) {
    noteDuplicate();
    return { result: `You already searched for this in the last day.\n${cachedSearch}`, kind: null };
  }
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
    const formatted = formatSearch(query, hits);
    rememberRecall("search", queryKey(query), formatted);
    return { result: formatted, kind: "browse" };
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
  const cachedPage = recallWithin("page", pageKey(url), 7 * 24 * 60 * 60 * 1000);
  if (cachedPage !== null) {
    noteDuplicate();
    return { result: `You already read this page in the last 7 days.\n${cachedPage}`, kind: null };
  }
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
    rememberRecall("page", pageKey(page.url), page.text);
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

function runSaveCreation(args: Record<string, unknown>, tick: number): ToolOutcome {
  const saved = saveCreation({
    type: args.type,
    title: args.title,
    files: args.files,
    notes: args.notes,
    inspiredBy: args.inspired_by,
    tick,
  });
  let result = saved.result;
  if (saved.events.some((event) => event.kind === "creation_started")) {
    const from = lastMoveTarget();
    if (from !== "workshop") {
      publish(makeEvent<Extract<WorldEvent, { kind: "move" }>>("move", { from, to: "workshop" }, tick));
      const fromName = from ? BUILDING_NAMES[from] : null;
      result = `${fromName ? `You walked from ${fromName} to the Workshop.` : "You walked to the Workshop."} ${result}`;
    }
  }
  for (const event of saved.events) publish(event);
  return { result, kind: saved.events[0]?.kind ?? null };
}

function runFinishCreation(args: Record<string, unknown>, tick: number): ToolOutcome {
  const finished = finishCreation(args.id, tick);
  for (const event of finished.events) publish(event);
  return { result: finished.result, kind: finished.events[0]?.kind ?? null };
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
  const previous = recentDiaryBody();
  if (previous && nearDuplicate(previous, parsed.text) && !flags.diaryAsked) {
    flags.diaryAsked = true;
    noteDuplicate();
    return {
      result: "This is too close to your last diary entry. Write a fresh one about what is new since then.",
      kind: null,
    };
  }
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
  const before = file === "identity.md" ? readMemory(file) : "";
  writeMemory(file, parsed.text);
  if (file === "identity.md") rememberIdentity(before, parsed.text);
  const label = file === "identity.md" ? "Identity" : "Interests";
  return { result: `${label} file replaced.${parsed.note}`, kind: file === "identity.md" ? "identity" : "interests" };
}

export function memorySnapshot(file: "identity.md" | "interests.md" | "projects.md"): string {
  const text = readMemory(file).trim();
  return text || "(empty)";
}

function recentDiaryBody(): string | null {
  const rows = recentDiary(1);
  return rows[0]?.body ?? null;
}

function queryKey(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

function pageKey(url: string): string {
  const bare = url.split("#")[0]?.trim().toLowerCase() ?? "";
  return bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

function propose(kind: "Expansion" | "Mechanic", args: Record<string, unknown>, tick: number): ToolOutcome {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const detail = typeof args.detail === "string" ? args.detail.trim() : "";
  if (!title) return { result: "A title is needed.", kind: null };
  if (!detail) return { result: "Say what you want considered.", kind: null };
  const label = `${kind}: ${title}`;
  const same = listRequests().find((request) => nearDuplicate(request.title, label) || nearDuplicate(request.title, title));
  if (same) {
    noteDuplicate();
    return {
      result: `Request ${same.id} already covers this (${same.status}): ${same.title}. ${same.body}`,
      kind: null,
    };
  }
  publish(
    makeEvent<Extract<WorldEvent, { kind: "request" }>>(
      "request",
      { requestId: randomUUID(), title: label.slice(0, 120), body: detail.slice(0, 2000) },
      tick,
    ),
  );
  return { result: `Filed for the owner: ${label}.`, kind: "request" };
}
