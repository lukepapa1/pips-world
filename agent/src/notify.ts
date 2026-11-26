export type DigestNotice = {
  headline: string;
  url: string;
};

export type Notifier = {
  id: string;
  send(notice: DigestNotice): Promise<void>;
};

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

function ntfyNotifier(): Notifier | null {
  if (!process.env.NTFY_TOPIC?.trim()) return null;
  return {
    id: "ntfy",
    async send(notice) {
      const endpoint = ntfyEndpoint();
      if (!endpoint) return;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Title: headerText(notice.headline),
          Click: notice.url,
          "Content-Type": "text/plain; charset=utf-8",
        },
        body: `${notice.headline}\n\n${notice.url}`,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`ntfy responded ${response.status}.`);
    },
  };
}

// Telegram can be added as another Notifier when a bot token and chat id are configured.
export function configuredNotifiers(): Notifier[] {
  const ntfy = ntfyNotifier();
  return ntfy ? [ntfy] : [];
}

export function digestLink(): string {
  return worldUrl();
}

export async function notifyDigest(notice: DigestNotice): Promise<string[]> {
  const channels = configuredNotifiers();
  if (channels.length === 0) {
    console.log("Digest saved. No notify channel is configured.");
    return [];
  }
  const sent: string[] = [];
  for (const channel of channels) {
    try {
      await channel.send(notice);
      sent.push(channel.id);
      console.log(`Digest sent via ${channel.id}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notify failed.";
      console.error(`Digest notify failed (${channel.id}): ${message}`);
    }
  }
  return sent;
}
