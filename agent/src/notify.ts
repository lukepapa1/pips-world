import { createRequire } from "node:module";
import {
  deletePushSubscription,
  listPushSubscriptions,
  pushEnabled,
  type PushKind,
} from "./db.js";
import { redactSecrets } from "./env.js";

const require = createRequire(import.meta.url);
const webpush = require("web-push") as {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { TTL?: number },
  ): Promise<unknown>;
  generateVAPIDKeys(): { publicKey: string; privateKey: string };
};

export type DigestNotice = {
  headline: string;
  url: string;
};

export type OwnerNotice = {
  title: string;
  body: string;
  url: string;
};

let vapidReady: boolean | null = null;

export function vapidPublicKey(): string | null {
  const key = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  return key || null;
}

function vapidConfigured(): boolean {
  if (vapidReady !== null) return vapidReady;
  const pub = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
  const priv = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
  if (!pub || !priv) {
    vapidReady = false;
    return false;
  }
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:owner@pips.world";
  webpush.setVapidDetails(subject, pub, priv);
  vapidReady = true;
  return true;
}

function worldUrl(): string {
  const raw = process.env.WORLD_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "http://localhost:5173";
}

function headerText(value: string): string {
  const clipped = value.replace(/\s+/g, " ").trim().slice(0, 180);
  if (/^[\x20-\x7e]*$/.test(clipped)) return clipped;
  return `=?UTF-8?B?${Buffer.from(clipped, "utf8").toString("base64")}?=`;
}

function ntfyEndpoint(): string | null {
  const topic = process.env.NTFY_TOPIC?.trim();
  if (!topic) return null;
  if (/^https?:\/\//i.test(topic)) {
    const url = new URL(topic);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("NTFY_TOPIC must be an http or https link.");
    }
    const name = url.pathname.split("/").filter(Boolean).pop();
    if (!name) throw new Error("NTFY_TOPIC link has no topic.");
    return `${url.origin}/${encodeURIComponent(name)}`;
  }
  const server = process.env.NTFY_SERVER?.trim() || "https://ntfy.sh";
  const base = new URL(server);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new Error("NTFY_SERVER must be an http or https address.");
  }
  const root = `${base.origin}${base.pathname.replace(/\/$/, "")}/`;
  return new URL(encodeURIComponent(topic), root).toString();
}

async function sendWebPush(notice: OwnerNotice): Promise<number> {
  if (!vapidConfigured()) return 0;
  const subs = listPushSubscriptions();
  if (subs.length === 0) return 0;
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: notice.title, body: notice.body, url: notice.url }),
          { TTL: 60 * 60 },
        );
        sent += 1;
      } catch (error) {
        const status =
          typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
        if (status === 404 || status === 410) deletePushSubscription(sub.endpoint);
        const message = error instanceof Error ? error.message : "Push failed.";
        console.error(redactSecrets(`Web push failed: ${message}`));
      }
    }),
  );
  return sent;
}

async function sendNtfy(notice: OwnerNotice): Promise<void> {
  const endpoint = ntfyEndpoint();
  if (!endpoint) return;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Title: headerText(notice.title),
      Click: notice.url,
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: `${notice.title}\n\n${notice.body}\n\n${notice.url}`,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ntfy responded ${response.status}.`);
}

export function digestLink(): string {
  return worldUrl();
}

export async function notifyOwner(kind: PushKind | "test", notice: OwnerNotice): Promise<string[]> {
  if (kind !== "test" && !pushEnabled(kind)) {
    console.log(`${kind} notification is off.`);
    return [];
  }
  const sent: string[] = [];
  const pushed = await sendWebPush(notice);
  if (pushed > 0) {
    sent.push("webpush");
    console.log(`${notice.title} sent via web push.`);
  }
  if (kind !== "test" && pushed === 0 && process.env.NTFY_TOPIC?.trim()) {
    try {
      await sendNtfy(notice);
      sent.push("ntfy");
      console.log(`${notice.title} sent via ntfy.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notify failed.";
      console.error(redactSecrets(`Notify failed (ntfy): ${message}`));
    }
  }
  if (sent.length === 0 && kind !== "test") {
    console.log(`${notice.title} saved. No notify channel is configured.`);
  }
  return sent;
}

export async function notifyDigest(notice: DigestNotice): Promise<string[]> {
  return notifyOwner("digest", {
    title: notice.headline,
    body: "The day's digest is ready.",
    url: notice.url,
  });
}
