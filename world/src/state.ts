import {
  isBuildingId,
  isWorldEvent,
  isWorldState,
  type BuildingId,
  type DiaryRow,
  type DigestRow,
  type JournalRow,
  type RequestRow,
  type SnapshotMessage,
  type WorldEvent,
  type WorldState,
} from "@pips/shared";

export type Placement = "none" | "walk" | "jump";

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
  });
}

export function applyEvent(event: WorldEvent): void {
  if (state.events.some((existing) => existing.id === event.id)) return;

  let diary = state.diary;
  let journal = state.journal;
  let requests = state.requests;
  let paused = state.paused;
  let pipAt = state.pipAt;
  let placement: Placement = "none";

  switch (event.kind) {
    case "move":
      if (isBuildingId(event.payload.to)) pipAt = event.payload.to;
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
