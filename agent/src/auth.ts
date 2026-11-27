import crypto from "node:crypto";
import type http from "node:http";
import tls from "node:tls";

const COOKIE = "pips_session";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type Attempts = { failures: number; until: number };

const attempts = new Map<string, Attempts>();

export function ownerPassword(): string {
  return process.env.OWNER_PASSWORD?.trim() ?? "";
}

export function authRequired(): boolean {
  return ownerPassword().length >= 8;
}

function sameSecret(left: string, right: string): boolean {
  const a = crypto.createHash("sha256").update(left).digest();
  const b = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

function sign(expiry: number): string {
  const body = String(expiry);
  const mac = crypto.createHmac("sha256", ownerPassword()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function validToken(token: string): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", ownerPassword()).update(body).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
  const expiry = Number(body);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export function clientAddress(req: http.IncomingMessage): string {
  const address = req.socket.remoteAddress ?? "unknown";
  return address.replace(/^::ffff:/, "");
}

function readCookie(req: http.IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== COOKIE) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function authorized(req: http.IncomingMessage): boolean {
  if (!authRequired()) return true;
  const token = readCookie(req);
  return Boolean(token && validToken(token));
}

function secureCookie(req: http.IncomingMessage): boolean {
  if (req.socket instanceof tls.TLSSocket && req.socket.encrypted) return true;
  const forwarded = req.headers["x-forwarded-proto"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return value?.split(",")[0]?.trim() === "https";
}

function cookieHeader(req: http.IncomingMessage, token: string, maxAge: number): string {
  // Path=/ and SameSite=Lax keep the session in the installed app.
  const secure = secureCookie(req) ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export function sessionCookie(req: http.IncomingMessage): string {
  return cookieHeader(req, sign(Date.now() + SESSION_MS), Math.floor(SESSION_MS / 1000));
}

export function clearCookie(req: http.IncomingMessage): string {
  return cookieHeader(req, "", 0);
}

function recordFailure(address: string): void {
  const now = Date.now();
  const current = attempts.get(address);
  if (!current || current.until <= now) {
    attempts.set(address, { failures: 1, until: now + WINDOW_MS });
    return;
  }
  current.failures += 1;
}

export function loginLimited(address: string): boolean {
  const current = attempts.get(address);
  if (!current) return false;
  if (current.until <= Date.now()) {
    attempts.delete(address);
    return false;
  }
  return current.failures >= MAX_FAILURES;
}

export type LoginResult = "ok" | "bad" | "limited" | "unconfigured";

export function checkPassword(password: string, address: string): LoginResult {
  if (!authRequired()) return "unconfigured";
  if (loginLimited(address)) return "limited";
  if (!sameSecret(password, ownerPassword())) {
    recordFailure(address);
    if (loginLimited(address)) return "limited";
    return "bad";
  }
  attempts.delete(address);
  return "ok";
}

export function loginPage(state: "form" | "bad" | "limited" | "off"): string {
  const note =
    state === "bad"
      ? "That password was not right."
      : state === "limited"
        ? "Too many attempts. Wait a few minutes and try again."
        : state === "off"
          ? "No owner password is set, so this computer is not asking you to log in."
          : "This world is private.";
  const form =
    state === "off"
      ? `<p><a href="/">Back to the world</a></p>`
      : `<form method="post" action="/login">
          <label for="password">Password</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required />
          <button type="submit">Enter</button>
        </form>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#b7d4ea" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Pip" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icons/icon-192.png" />
  <title>Pip's World</title>
  <style>
    :root { color-scheme: light; --ink: #2a241c; --ink-soft: #5c5146; --paper: #f6f0e4; --paper-raised: #fffaf3; --line: #e4d5c0; --moss: #2f6b4f; --moss-ink: #f7f4ee; --navy: #2c455c; --sky: #b7d4ea; --shadow: 0 12px 32px rgba(48, 32, 16, 0.14); }
    @media (prefers-color-scheme: dark) { :root { color-scheme: dark; --ink: #f6f0e4; --ink-soft: #d4c6b4; --paper: #241e18; --paper-raised: #322922; --line: #4a3d32; --moss: #7dba98; --moss-ink: #1a241c; --navy: #b7d4ea; --sky: #1c2830; --shadow: 0 12px 32px rgba(0, 0, 0, 0.35); } }
    body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; background: var(--sky); color: var(--ink); font-family: "Source Sans 3", "Avenir Next", "Segoe UI", sans-serif; font-size: 16px; line-height: 1.45; padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
    main { width: min(360px, calc(100% - 32px)); background: var(--paper); border-radius: 22px; padding: 32px 24px; box-shadow: var(--shadow); }
    h1 { font-family: Nunito, "Avenir Next", sans-serif; font-size: 28px; font-weight: 700; line-height: 1.2; margin: 0 0 8px; }
    p { margin: 0 0 16px; color: var(--ink-soft); }
    label { display: block; font-family: Nunito, "Avenir Next", sans-serif; font-size: 14px; font-weight: 600; margin-bottom: 8px; }
    input { width: 100%; box-sizing: border-box; min-height: 44px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; background: var(--paper-raised); color: var(--ink); font: inherit; }
    button { margin-top: 16px; min-height: 44px; border: 0; border-radius: 999px; padding: 8px 18px; background: var(--moss); color: var(--moss-ink); font-family: Nunito, "Avenir Next", sans-serif; font-size: 16px; font-weight: 700; cursor: pointer; }
    a { color: var(--navy); }
  </style>
</head>
<body>
  <main>
    <h1>Pip's World</h1>
    <p>${note}</p>
    ${form}
  </main>
  <script>
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
  </script>
</body>
</html>`;
}
