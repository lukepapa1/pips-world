import {
  isBlueprintRecord,
  isDigestRow,
  isPathRecord,
  isWorldEvent,
  isWorldObject,
  isWorldState,
  type BlueprintRecord,
  type ClientMessage,
  type DigestRow,
  type PathRecord,
  type ServerMessage,
  type WorldEvent,
} from "@pips/shared";
import {
  applyEvent,
  loadSnapshot,
  markDigestReadLocal,
  markDiaryRead,
  setBlueprints,
  setBrowsing,
  setCreations,
  setGrowth,
  setConnected,
  setPaths,
  setWorldObjects,
  setWorldState,
  upsertDigest,
} from "./state";

let active: WebSocket | null = null;
let haveSnapshot = false;
let queue: WorldEvent[] = [];
let digestQueue: DigestRow[] = [];
let objectQueue: ServerMessage | null = null;
let blueprintQueue: { blueprints: BlueprintRecord[]; blueprintApproval: boolean } | null = null;
let pathQueue: PathRecord[] | null = null;
let reconnectTimer = 0;

export function send(message: ClientMessage): boolean {
  if (!active || active.readyState !== WebSocket.OPEN) return false;
  active.send(JSON.stringify(message));
  return true;
}

export function connect(): void {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = 0;
  }
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/ws`);
  active = socket;
  haveSnapshot = false;
  queue = [];
  digestQueue = [];
  objectQueue = null;
  setConnected(false);

  socket.addEventListener("open", () => {
    if (active === socket) setConnected(true);
  });

  socket.addEventListener("message", (ev) => {
    if (active !== socket) return;
    let message: ServerMessage;
    try {
      message = JSON.parse(String(ev.data)) as ServerMessage;
    } catch {
      return;
    }
    if (message.type === "snapshot") {
      loadSnapshot(message);
      haveSnapshot = true;
      const pending = queue;
      queue = [];
      for (const event of pending) applyEvent(event);
      const pendingDigests = digestQueue;
      digestQueue = [];
      for (const digest of pendingDigests) upsertDigest(digest);
      if (objectQueue?.type === "world_objects") setWorldObjects(objectQueue.objects.filter(isWorldObject));
      objectQueue = null;
      if (blueprintQueue) setBlueprints(blueprintQueue.blueprints, blueprintQueue.blueprintApproval);
      blueprintQueue = null;
      if (pathQueue) setPaths(pathQueue);
      pathQueue = null;
      return;
    }
    if (message.type === "blueprints") {
      const blueprints = message.blueprints.filter(isBlueprintRecord);
      if (!haveSnapshot) blueprintQueue = { blueprints, blueprintApproval: message.blueprintApproval };
      else setBlueprints(blueprints, message.blueprintApproval);
      return;
    }
    if (message.type === "growth") {
      setGrowth(message.growth);
      return;
    }
    if (message.type === "creations") {
      setCreations(message.creations);
      return;
    }
    if (message.type === "paths") {
      const paths = message.paths.filter(isPathRecord);
      if (!haveSnapshot) pathQueue = paths;
      else setPaths(paths);
      return;
    }
    if (message.type === "world_objects") {
      const objects = message.objects.filter(isWorldObject);
      if (!haveSnapshot) objectQueue = { type: "world_objects", objects };
      else setWorldObjects(objects);
      return;
    }
    if (message.type === "digest") {
      if (!isDigestRow(message.digest)) return;
      if (!haveSnapshot) digestQueue.push(message.digest);
      else upsertDigest(message.digest);
      return;
    }
    if (message.type === "digest_read") {
      markDigestReadLocal(message.id, message.readAt);
      return;
    }
    if (message.type === "event") {
      if (!isWorldEvent(message.event)) return;
      if (!haveSnapshot) queue.push(message.event);
      else applyEvent(message.event);
      return;
    }
    if (message.type === "world_state") {
      if (isWorldState(message.state)) setWorldState(message.state);
      return;
    }
    if (message.type === "diary_read") {
      markDiaryRead(message.readAt);
      return;
    }
    if (message.type === "browsing") {
      setBrowsing(message.domain);
      return;
    }
    if (message.type === "error") {
      window.dispatchEvent(new CustomEvent("pips-error", { detail: message.message }));
    }
  });

  socket.addEventListener("close", () => {
    if (active !== socket) return;
    active = null;
    haveSnapshot = false;
    setConnected(false);
    reconnectTimer = window.setTimeout(connect, 1500);
  });
}
