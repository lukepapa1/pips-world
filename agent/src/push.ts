import {
  listPushSubscriptions,
  pushPrefs,
  savePushPrefs,
  savePushSubscription,
  type PushKind,
  type PushPrefs,
} from "./db.js";
import { digestLink, notifyOwner, vapidPublicKey } from "./notify.js";

const KINDS: PushKind[] = ["digest", "request", "project", "quiet"];

export type PushResponse = { status: number; body: unknown };

function isHttpsEndpoint(value: string): boolean {
  if (value.length < 12 || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function prefsPatch(value: unknown): Partial<PushPrefs> | null {
  if (!value || typeof value !== "object") return null;
  const patch: Partial<PushPrefs> = {};
  const raw = value as Partial<Record<PushKind, unknown>>;
  for (const kind of KINDS) {
    if (raw[kind] === undefined) continue;
    if (typeof raw[kind] !== "boolean") return null;
    patch[kind] = raw[kind];
  }
  return patch;
}

export async function handlePush(method: string, pathname: string, raw: string): Promise<PushResponse | null> {
  if (method === "GET" && pathname === "/api/push") {
    return { status: 200, body: { ok: true, publicKey: vapidPublicKey(), prefs: pushPrefs() } };
  }
  if (method === "POST" && pathname === "/api/push/settings") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 400, body: { ok: false, message: "Could not read those switches." } };
    }
    const patch = prefsPatch(parsed);
    if (!patch) return { status: 400, body: { ok: false, message: "Could not read those switches." } };
    return { status: 200, body: { ok: true, prefs: savePushPrefs(patch) } };
  }
  if (method === "POST" && pathname === "/api/push/subscribe") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 400, body: { ok: false, message: "Could not read that subscription." } };
    }
    const body = parsed as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
    const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
    if (!isHttpsEndpoint(endpoint) || p256dh.length < 8 || p256dh.length > 256 || auth.length < 8 || auth.length > 256) {
      return { status: 400, body: { ok: false, message: "That subscription is not usable." } };
    }
    if (!vapidPublicKey()) {
      return { status: 503, body: { ok: false, message: "Web push is not configured." } };
    }
    savePushSubscription({ endpoint, p256dh, auth });
    console.log("Push subscription saved.");
    return { status: 200, body: { ok: true } };
  }
  if (method === "POST" && pathname === "/api/push/test") {
    if (!vapidPublicKey()) {
      return { status: 503, body: { ok: false, message: "Web push is not configured." } };
    }
    if (listPushSubscriptions().length === 0) {
      return { status: 409, body: { ok: false, message: "Turn on notifications on this device first." } };
    }
    const channels = await notifyOwner("test", {
      title: "Pip",
      body: "This is a test notification.",
      url: digestLink(),
    });
    if (!channels.includes("webpush")) {
      return { status: 502, body: { ok: false, message: "The test did not reach this device." } };
    }
    return { status: 200, body: { ok: true, message: "Test notification sent." } };
  }
  return null;
}
