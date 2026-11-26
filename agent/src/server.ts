import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, type RawData } from "ws";
import type { ClientMessage, SeasonPreview, SnapshotMessage } from "@pips/shared";
import { isSeason } from "@pips/shared";
import {
  authRequired,
  authorized,
  checkPassword,
  clearCookie,
  clientAddress,
  loginPage,
  sessionCookie,
} from "./auth.js";
import { lastTickAt } from "./db.js";
import { redactSecrets, worldDistDir } from "./env.js";
import {
  decideRequest,
  isPaused,
  listDiary,
  listDigests,
  listEvents,
  listJournal,
  listRequests,
  markAllDiaryRead,
  markDigestRead,
  maxTick,
  setPausedFlag,
} from "./db.js";
import { dayFromTick } from "@pips/shared";
import { chatEnabled, chatHistory, replyToChat } from "./chat.js";
import { demoMode } from "./env.js";
import { addSocket, broadcast, removeSocket } from "./hub.js";
import { generateDailyDigest, resolveDigestDay } from "./digest.js";
import { handlePush } from "./push.js";
import { tickInProgress, runAgentTick } from "./loop.js";
import { currentWorldState, setSeasonPreview } from "./season.js";
import { currentTick } from "./tickState.js";

function snapshot(): SnapshotMessage {
  const tick = Math.max(currentTick(), maxTick());
  return {
    type: "snapshot",
    events: listEvents(),
    diary: listDiary(),
    journal: listJournal(),
    requests: listRequests(),
    digests: listDigests(),
    paused: isPaused(),
    tick,
    day: dayFromTick(tick),
    world: currentWorldState(),
  };
}

function textOf(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > 8_000) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const message = value as {
    type?: unknown;
    requestId?: unknown;
    decision?: unknown;
    paused?: unknown;
    season?: unknown;
    id?: unknown;
  };
  if (message.type === "mark_diary_read") return { type: "mark_diary_read" };
  if (message.type === "mark_digest_read" && typeof message.id === "string" && message.id.trim()) {
    return { type: "mark_digest_read", id: message.id };
  }
  if (message.type === "set_season_preview" && isPreview(message.season)) {
    return { type: "set_season_preview", season: message.season };
  }
  if (message.type === "set_paused" && typeof message.paused === "boolean") {
    return { type: "set_paused", paused: message.paused };
  }
  if (
    message.type === "decide_request" &&
    typeof message.requestId === "string" &&
    (message.decision === "approved" || message.decision === "denied")
  ) {
    return {
      type: "decide_request",
      requestId: message.requestId,
      decision: message.decision,
    };
  }
  return null;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 20_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isLocal(req: http.IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isPreview(value: unknown): value is SeasonPreview {
  return value === "auto" || isSeason(value);
}

function pathnameOf(url: string | undefined): string {
  if (!url) return "/";
  try {
    return new URL(url, "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

const FILE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(html);
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function loggedOut(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(303, { Location: "/login", "set-cookie": clearCookie(req) });
  res.end();
}

async function postedPassword(req: http.IncomingMessage): Promise<string> {
  const raw = await readBody(req);
  const type = req.headers["content-type"] ?? "";
  if (type.includes("application/json")) {
    const body = JSON.parse(raw) as { password?: unknown };
    return typeof body.password === "string" ? body.password : "";
  }
  return new URLSearchParams(raw).get("password") ?? "";
}

function serveWorld(pathname: string, res: http.ServerResponse): boolean {
  const root = worldDistDir();
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("Forbidden");
    return true;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const cache =
    ext === ".html" || file.endsWith("sw.js") || ext === ".webmanifest" ? "no-store" : "public, max-age=86400";
  res.writeHead(200, {
    "content-type": FILE_TYPES[ext] ?? "application/octet-stream",
    "cache-control": cache,
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

function publicAsset(pathname: string): boolean {
  return (
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/offline.html" ||
    pathname.startsWith("/icons/")
  );
}

function operatorRoute(method: string | undefined, pathname: string): boolean {
  return method === "POST" && (pathname === "/api/tick" || pathname === "/api/digest");
}

export function startServer(): http.Server {
  const port = Number(process.env.PORT) || 3001;
  const server = http.createServer((req, res) => {
    const pathname = pathnameOf(req.url);
    if (req.method === "GET" && pathname === "/health") {
      sendJson(res, 200, { ok: true, lastTickAt: lastTickAt() });
      return;
    }
    if (pathname === "/login" && (req.method === "GET" || req.method === "POST")) {
      if (!authRequired()) {
        sendHtml(res, 200, loginPage("off"));
        return;
      }
      if (req.method === "GET") {
        if (authorized(req)) {
          res.writeHead(303, { Location: "/" });
          res.end();
          return;
        }
        sendHtml(res, 200, loginPage("form"));
        return;
      }
      postedPassword(req)
        .then((password) => {
          const result = checkPassword(password, clientAddress(req));
          if (result === "ok") {
            res.writeHead(303, { Location: "/", "set-cookie": sessionCookie(req) });
            res.end();
            console.log("Owner logged in.");
            return;
          }
          if (result === "limited") {
            console.log("Login rate limited.");
            sendHtml(res, 429, loginPage("limited"));
            return;
          }
          console.log("Login failed.");
          sendHtml(res, 401, loginPage("bad"));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Login failed.";
          console.error(redactSecrets(`Login failed: ${message}`));
          sendHtml(res, 400, loginPage("bad"));
        });
      return;
    }
    if (req.method === "POST" && pathname === "/logout") {
      loggedOut(req, res);
      return;
    }
    if (authRequired() && !operatorRoute(req.method, pathname) && !authorized(req) && !publicAsset(pathname)) {
      if (pathname === "/") {
        sendHtml(res, 200, loginPage("form"));
        return;
      }
      sendJson(res, 401, { ok: false, message: "Login required." });
      return;
    }
    if (req.method === "GET" && pathname === "/api/health") {
      const snap = snapshot();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          tick: snap.tick,
          day: snap.day,
          paused: snap.paused,
          events: snap.events.length,
          season: snap.world.season,
          preview: snap.world.preview,
          mode: demoMode() ? "demo" : "agent",
          chat: chatEnabled(),
        }),
      );
      return;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/chat")) {
      const session = new URL(req.url, "http://127.0.0.1").searchParams.get("session");
      const history = chatHistory(session);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(history));
      return;
    }
    if (req.method === "POST" && req.url === "/api/chat") {
      readBody(req)
        .then((raw) => {
          const body = JSON.parse(raw) as { sessionId?: unknown; text?: unknown };
          const text = typeof body.text === "string" ? body.text : "";
          return replyToChat(body.sessionId, text);
        })
        .then((result) => {
          res.writeHead(result.status, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Chat failed.";
          console.error(redactSecrets(`Chat failed: ${message}`));
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Could not read that message." }));
        });
      return;
    }
    if (req.method === "POST" && req.url === "/api/digest") {
      if (!isLocal(req)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Local only");
        return;
      }
      if (tickInProgress()) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "A tick is already running." }));
        return;
      }
      readBody(req)
        .then((raw) => {
          let requested: number | undefined;
          if (raw.trim()) {
            const body = JSON.parse(raw) as { day?: unknown };
            if (body.day !== undefined) {
              if (typeof body.day !== "number") throw new Error("Day must be a number.");
              requested = body.day;
            }
          }
          const day = resolveDigestDay(requested);
          return generateDailyDigest(day, true).then((result) => ({ day, result }));
        })
        .then(({ day, result }) => {
          if (result) broadcast({ type: "digest", digest: result.digest });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, day, digest: result?.digest ?? null, channels: result?.channels ?? [] }));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Digest failed.";
          console.error(redactSecrets(`Digest failed: ${message}`));
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, message }));
        });
      return;
    }
    if (req.method === "POST" && req.url === "/api/tick") {
      if (!isLocal(req)) {
        res.writeHead(403, { "content-type": "text/plain" });
        res.end("Local only");
        return;
      }
      if (demoMode()) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "DEMO_MODE is on. Unset it to run a real tick." }));
        return;
      }
      runAgentTick()
        .then((result) => {
          res.writeHead(result.ok ? 200 : 409, { "content-type": "application/json" });
          res.end(JSON.stringify(result));
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Tick failed.";
          console.error(redactSecrets(`Tick failed: ${message}`));
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, message: "Tick failed." }));
        });
      return;
    }
    if (pathname.startsWith("/api/push")) {
      const method = req.method ?? "GET";
      const incoming = method === "GET" || method === "HEAD" ? Promise.resolve("") : readBody(req);
      incoming
        .then((raw) => handlePush(method, pathname, raw))
        .then((result) => {
          if (!result) {
            res.writeHead(404, { "content-type": "text/plain" });
            res.end("Not found");
            return;
          }
          sendJson(res, result.status, result.body);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : "Push failed.";
          console.error(redactSecrets(`Push failed: ${message}`));
          sendJson(res, 400, { ok: false, message: "Could not read that." });
        });
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && serveWorld(pathname, res)) return;
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (pathnameOf(req.url) !== "/ws") {
      socket.destroy();
      return;
    }
    if (authRequired() && !authorized(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
  wss.on("connection", (socket) => {
    addSocket(socket);
    socket.send(JSON.stringify(snapshot()));

    socket.on("message", (data) => {
      const message = parseClientMessage(textOf(data));
      if (!message) return;

      if (message.type === "mark_diary_read") {
        const readAt = markAllDiaryRead();
        if (readAt) broadcast({ type: "diary_read", readAt });
        return;
      }

      if (message.type === "mark_digest_read") {
        const marked = markDigestRead(message.id);
        if (marked) broadcast({ type: "digest_read", id: marked.id, readAt: marked.readAt });
        return;
      }

      if (message.type === "set_season_preview") {
        setSeasonPreview(message.season);
        return;
      }

      const tick = Math.max(currentTick(), maxTick());
      if (message.type === "set_paused") {
        const event = setPausedFlag(message.paused, tick);
        if (event) {
          broadcast({ type: "event", event });
          console.log(message.paused ? "PAUSED flag set." : "PAUSED flag cleared.");
        }
        return;
      }

      const event = decideRequest(message.requestId, message.decision, tick);
      if (!event) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "That request is no longer pending.",
          }),
        );
        return;
      }
      broadcast({ type: "event", event });
      console.log(`Request ${message.decision}: ${message.requestId}`);
    });

    socket.on("close", () => removeSocket(socket));
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`Agent listening on http://localhost:${port}`);
    console.log(`WebSocket at ws://localhost:${port}/ws`);
  });

  return server;
}
