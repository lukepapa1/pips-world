import {
  isBlueprintRecord,
  isBuildingId,
  isPathRecord,
  isPlotRecord,
  isWorldEvent,
  isWorldObject,
  isWorldState,
  type BlueprintRecord,
  type BuildingId,
  type DiaryRow,
  type DigestRow,
  type JournalRow,
  type CreationsLibrary,
  type GrowthView,
  type PathRecord,
  type PlotRecord,
  type RequestRow,
  type SnapshotMessage,
  type WorldEvent,
  type WorldObject,
  type WorldState,
} from "@pips/shared";

export type Placement = "none" | "walk" | "jump";

export type Wander = { x: number; z: number };

export type ClientState = {
  events: WorldEvent[];
  diary: DiaryRow[];
  journal: JournalRow[];
  requests: RequestRow[];
  digests: DigestRow[];
  paused: boolean;
  tick: number;
  day: number;
  pipAt: BuildingId | null;
  connected: boolean;
  placement: Placement;
  world: WorldState | null;
  browsing: string | null;
  objects: WorldObject[];
  blueprints: BlueprintRecord[];
  paths: PathRecord[];
  blueprintApproval: boolean;
  growth: GrowthView | null;
  creations: CreationsLibrary | null;
  plots: PlotRecord[];
  wander: Wander | null;
};

const listeners = new Set<(state: ClientState) => void>();

let state: ClientState = {
  events: [],
  diary: [],
  journal: [],
  requests: [],
  digests: [],
  paused: false,
  tick: 0,
  day: 1,
  pipAt: null,
  connected: false,
  placement: "none",
  world: null,
  browsing: null,
  objects: [],
  blueprints: [],
  paths: [],
  blueprintApproval: false,
  growth: null,
  creations: null,
  plots: [],
  wander: null,
};

export function getState(): ClientState {
  return state;
}

export function subscribe(listener: (state: ClientState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: ClientState): void {
  state = next;
  for (const listener of listeners) listener(state);
  if (state === next && next.placement !== "none") {
    state = { ...state, placement: "none" };
  }
}

function pipAtFrom(events: WorldEvent[]): BuildingId | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === "move" && isBuildingId(event.payload.to)) return event.payload.to;
    if (event?.kind === "plot" && event.payload.action === "explored") return null;
  }
  return null;
}

function wanderFrom(events: WorldEvent[]): Wander | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === "move") return null;
    if (event?.kind === "plot" && event.payload.action === "explored") {
      return { x: event.payload.x, z: event.payload.z };
    }
  }
  return null;
}

export function loadSnapshot(message: SnapshotMessage): void {
  const events = message.events.filter(isWorldEvent);
  commit({
    ...state,
    events,
    diary: message.diary,
    journal: message.journal,
    requests: message.requests,
    digests: message.digests ?? [],
    paused: message.paused,
    tick: message.tick,
    day: message.day,
    pipAt: pipAtFrom(events),
    connected: true,
    placement: "jump",
    world: isWorldState(message.world) ? message.world : state.world,
    browsing: null,
    objects: Array.isArray(message.objects) ? message.objects.filter(isWorldObject) : state.objects,
    blueprints: Array.isArray(message.blueprints) ? message.blueprints.filter(isBlueprintRecord) : [],
    paths: Array.isArray(message.paths) ? message.paths.filter(isPathRecord) : [],
    blueprintApproval: message.blueprintApproval === true,
    growth: message.growth ?? state.growth,
    creations: message.creations ?? state.creations,
    plots: Array.isArray(message.plots) ? message.plots.filter(isPlotRecord) : state.plots,
    wander: wanderFrom(events),
  });
}

export function setCreations(creations: CreationsLibrary): void {
  commit({ ...state, creations, placement: "none" });
}

export function setGrowth(growth: GrowthView): void {
  commit({ ...state, growth, placement: "none" });
}

export function setBlueprints(blueprints: BlueprintRecord[], blueprintApproval: boolean): void {
  commit({
    ...state,
    blueprints: blueprints.filter(isBlueprintRecord),
    blueprintApproval,
    placement: "none",
  });
}

export function setPaths(paths: PathRecord[]): void {
  commit({ ...state, paths: paths.filter(isPathRecord), placement: "none" });
}

export function setPlots(plots: PlotRecord[]): void {
  commit({ ...state, plots: plots.filter(isPlotRecord), placement: "none" });
}

export function setWorldObjects(objects: WorldObject[]): void {
  commit({ ...state, objects: objects.filter(isWorldObject), placement: "none" });
}

export function applyEvent(event: WorldEvent): void {
  if (state.events.some((existing) => existing.id === event.id)) return;

  let diary = state.diary;
  let journal = state.journal;
  let requests = state.requests;
  let paused = state.paused;
  let pipAt = state.pipAt;
  let wander = state.wander;
  let placement: Placement = "none";

  switch (event.kind) {
    case "move":
      if (isBuildingId(event.payload.to)) pipAt = event.payload.to;
      wander = null;
      placement = "walk";
      break;
    case "diary":
      diary = [
        {
          id: event.payload.entryId,
          day: event.day,
          tick: event.tick,
          body: event.payload.body,
          createdAt: event.createdAt,
          readAt: null,
        },
        ...diary.filter((entry) => entry.id !== event.payload.entryId),
      ];
      break;
    case "journal":
      journal = [
        {
          id: event.payload.entryId,
          day: event.day,
          body: event.payload.body,
          createdAt: event.createdAt,
        },
        ...journal.filter((entry) => entry.id !== event.payload.entryId),
      ];
      break;
    case "request":
      requests = [
        {
          id: event.payload.requestId,
          title: event.payload.title,
          body: event.payload.body,
          status: "pending",
          createdAt: event.createdAt,
          decidedAt: null,
        },
        ...requests.filter((request) => request.id !== event.payload.requestId),
      ];
      break;
    case "request_decision":
      requests = requests.map((request) =>
        request.id === event.payload.requestId
          ? { ...request, status: event.payload.decision, decidedAt: event.createdAt }
          : request,
      );
      break;
    case "pause":
      paused = true;
      break;
    case "resume":
      paused = false;
      break;
    case "season_change":
    case "chat":
    case "browse":
    case "build":
    case "blueprint":
    case "creation_started":
    case "creation_updated":
    case "creation_finished":
      break;
    case "plot":
      if (event.payload.action === "explored") {
        wander = { x: event.payload.x, z: event.payload.z };
        placement = "walk";
      }
      break;
  }

  commit({
    ...state,
    events: [...state.events, event],
    diary,
    journal,
    requests,
    paused,
    pipAt,
    wander,
    placement,
    tick: Math.max(state.tick, event.tick),
    day: event.tick >= state.tick ? event.day : state.day,
    connected: true,
  });
}

export function setWorldState(world: WorldState): void {
  commit({ ...state, world, placement: "none" });
}

export function markDiaryRead(readAt: string): void {
  commit({
    ...state,
    placement: "none",
    diary: state.diary.map((entry) => (entry.readAt ? entry : { ...entry, readAt })),
  });
}

export function upsertDigest(digest: DigestRow): void {
  const digests = [
    digest,
    ...state.digests.filter((existing) => existing.id !== digest.id && existing.day !== digest.day),
  ].sort((a, b) => b.day - a.day);
  commit({ ...state, digests, placement: "none" });
}

export function markDigestReadLocal(id: string, readAt: string): void {
  commit({
    ...state,
    placement: "none",
    digests: state.digests.map((digest) => (digest.id === id ? { ...digest, readAt } : digest)),
  });
}

export function setBrowsing(domain: string | null): void {
  if (state.browsing === domain) return;
  commit({ ...state, browsing: domain, placement: "none" });
}

export function setConnected(connected: boolean): void {
  if (state.connected === connected) return;
  commit({ ...state, connected, placement: "none" });
}

export function unreadDiaryCount(current: ClientState = state): number {
  return current.diary.reduce((count, entry) => count + (entry.readAt ? 0 : 1), 0);
}

export function unreadDigestCount(current: ClientState = state): number {
  return current.digests.reduce((count, digest) => count + (digest.readAt ? 0 : 1), 0);
}

export function pendingRequestCount(current: ClientState = state): number {
  return current.requests.reduce(
    (count, request) => count + (request.status === "pending" ? 1 : 0),
    0,
  );
}
