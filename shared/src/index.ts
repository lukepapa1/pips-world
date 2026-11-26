import type { BuildAction, BuildableType, WorldObject } from "./objects.js";

export type { BuildAction, BuildableType, PlaceType, WorldObject } from "./objects.js";
export {
  BUILDABLE,
  BUILDING_SLOTS,
  VILLAGE_RADIUS,
  WORLD_RADIUS,
  buildingAngle,
  footprintOf,
  insideWorld,
  isBuildable,
  isPlaceType,
  isWorldObject,
  overlaps,
  starterObjects,
} from "./objects.js";

export const BUILDINGS = ["home", "library", "workshop", "gallery", "mailbox"] as const;

export type BuildingId = (typeof BUILDINGS)[number];

export const TICKS_PER_DAY = 24;

export const BUILDING_NAMES: Record<BuildingId, string> = {
  home: "Home",
  library: "Library",
  workshop: "Workshop",
  gallery: "Gallery",
  mailbox: "Mailbox",
};

export function isBuildingId(value: unknown): value is BuildingId {
  return typeof value === "string" && (BUILDINGS as readonly string[]).includes(value);
}

export function dayFromTick(tick: number): number {
  if (tick <= 0) return 1;
  return Math.floor((tick - 1) / TICKS_PER_DAY) + 1;
}

export function hourFromTick(tick: number): number {
  if (tick <= 0) return 0;
  return ((tick - 1) % TICKS_PER_DAY) + 1;
}

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;

export type Season = (typeof SEASONS)[number];

export type SeasonPreview = Season | "auto";

export const DAY_PERIODS = ["dawn", "morning", "afternoon", "dusk", "night"] as const;

export type DayPeriod = (typeof DAY_PERIODS)[number];

export type WorldState = {
  season: Season;
  nextSeason: Season;
  /** 0 is fully `season`, 1 is fully `nextSeason`. */
  blend: number;
  /** 0 at local midnight, 1 at the next midnight. */
  timeOfDay: number;
  /** Fractional local hours of sunrise and sunset. */
  sunrise: number;
  sunset: number;
  /** Peak sun height in radians at solar noon. */
  noonElevation: number;
  /** Civil date in the village timezone, YYYY-MM-DD. */
  date: string;
  /** Village clock, HH:mm. */
  time: string;
  period: DayPeriod;
  /** IANA zone, such as Australia/Melbourne. */
  zone: string;
  /** Short name, such as AEDT. */
  zoneName: string;
  preview: SeasonPreview;
  sampledAt: string;
};

export function isSeason(value: unknown): value is Season {
  return typeof value === "string" && (SEASONS as readonly string[]).includes(value);
}

export function isDayPeriod(value: unknown): value is DayPeriod {
  return typeof value === "string" && (DAY_PERIODS as readonly string[]).includes(value);
}

export function isWorldState(value: unknown): value is WorldState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<WorldState>;
  return (
    isSeason(state.season) &&
    isSeason(state.nextSeason) &&
    typeof state.blend === "number" &&
    typeof state.timeOfDay === "number" &&
    typeof state.sunrise === "number" &&
    typeof state.sunset === "number" &&
    typeof state.noonElevation === "number" &&
    typeof state.date === "string" &&
    typeof state.time === "string" &&
    isDayPeriod(state.period) &&
    typeof state.zone === "string" &&
    state.zone.length > 0 &&
    typeof state.zoneName === "string" &&
    (state.preview === "auto" || isSeason(state.preview)) &&
    typeof state.sampledAt === "string"
  );
}

export type RequestStatus = "pending" | "approved" | "denied";

export type DiaryRow = {
  id: string;
  day: number;
  tick: number;
  body: string;
  createdAt: string;
  readAt: string | null;
};

export type JournalRow = {
  id: string;
  day: number;
  body: string;
  createdAt: string;
};

export type RequestRow = {
  id: string;
  title: string;
  body: string;
  status: RequestStatus;
  createdAt: string;
  decidedAt: string | null;
};

type EventBase = {
  id: string;
  tick: number;
  day: number;
  createdAt: string;
};

export type WorldEvent =
  | (EventBase & {
      kind: "move";
      payload: { from: BuildingId | null; to: BuildingId };
    })
  | (EventBase & {
      kind: "diary";
      payload: { entryId: string; body: string };
    })
  | (EventBase & {
      kind: "journal";
      payload: { entryId: string; body: string };
    })
  | (EventBase & {
      kind: "request";
      payload: { requestId: string; title: string; body: string };
    })
  | (EventBase & {
      kind: "request_decision";
      payload: {
        requestId: string;
        decision: "approved" | "denied";
        title: string;
      };
    })
  | (EventBase & { kind: "pause"; payload: { paused: true } })
  | (EventBase & { kind: "resume"; payload: { paused: false } })
  | (EventBase & {
      kind: "season_change";
      payload: { from: Season | null; to: Season };
    })
  | (EventBase & {
      kind: "chat";
      payload: { sessionId: string };
    })
  | (EventBase & {
      kind: "browse";
      payload: { tool: BrowseTool; url: string; query: string | null };
    })
  | (EventBase & {
      kind: "build";
      payload: {
        action: BuildAction;
        objectId: string;
        type: BuildableType;
        x: number;
        z: number;
        rotation: number;
        style: string;
      };
    });

export type BrowseTool = "web_search" | "read_page" | "view_image";

export type ChatRole = "owner" | "pip";

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatRole;
  text: string;
  createdAt: string;
};

export type DigestItem = {
  text: string;
  url: string | null;
};

export type DigestSections = {
  built: DigestItem[];
  learnt: DigestItem[];
  made: DigestItem[];
  wants: DigestItem[];
};

export type DigestRow = {
  id: string;
  day: number;
  headline: string;
  sections: DigestSections;
  createdAt: string;
  readAt: string | null;
};

const DIGEST_SECTIONS = ["built", "learnt", "made", "wants"] as const;

function isDigestItem(value: unknown): value is DigestItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DigestItem>;
  return typeof item.text === "string" && (item.url === null || typeof item.url === "string");
}

export function isDigestRow(value: unknown): value is DigestRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DigestRow>;
  if (typeof row.id !== "string" || typeof row.day !== "number") return false;
  if (typeof row.headline !== "string" || typeof row.createdAt !== "string") return false;
  if (!(row.readAt === null || typeof row.readAt === "string")) return false;
  if (!row.sections || typeof row.sections !== "object") return false;
  const sections = row.sections as Partial<DigestSections>;
  return DIGEST_SECTIONS.every(
    (key) => Array.isArray(sections[key]) && sections[key].every(isDigestItem),
  );
}

export type SnapshotMessage = {
  type: "snapshot";
  events: WorldEvent[];
  diary: DiaryRow[];
  journal: JournalRow[];
  requests: RequestRow[];
  digests: DigestRow[];
  paused: boolean;
  tick: number;
  day: number;
  world: WorldState;
  objects: WorldObject[];
};

export type ServerMessage =
  | SnapshotMessage
  | { type: "event"; event: WorldEvent }
  | { type: "world_state"; state: WorldState }
  | { type: "diary_read"; readAt: string }
  | { type: "digest"; digest: DigestRow }
  | { type: "digest_read"; id: string; readAt: string }
  | { type: "browsing"; domain: string | null }
  | { type: "world_objects"; objects: WorldObject[] }
  | { type: "error"; message: string };

export type ClientMessage =
  | { type: "decide_request"; requestId: string; decision: "approved" | "denied" }
  | { type: "set_paused"; paused: boolean }
  | { type: "mark_diary_read" }
  | { type: "mark_digest_read"; id: string }
  | { type: "set_season_preview"; season: SeasonPreview };

const EVENT_KINDS = new Set([
  "move",
  "diary",
  "journal",
  "request",
  "request_decision",
  "pause",
  "resume",
  "season_change",
  "chat",
  "browse",
  "build",
]);

export function isWorldEvent(value: unknown): value is WorldEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<WorldEvent>;
  if (typeof event.id !== "string" || typeof event.kind !== "string") return false;
  if (!EVENT_KINDS.has(event.kind)) return false;
  if (typeof event.tick !== "number" || typeof event.day !== "number") return false;
  if (typeof event.createdAt !== "string") return false;
  if (!event.payload || typeof event.payload !== "object") return false;
  return true;
}
