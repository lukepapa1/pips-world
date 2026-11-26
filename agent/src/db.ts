import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  dayFromTick,
  isBuildingId,
  isSeason,
  type BuildingId,
  type ChatMessage,
  type ChatRole,
  type DiaryRow,
  type DigestRow,
  type DigestSections,
  type JournalRow,
  type RequestRow,
  type Season,
  type WorldEvent,
  isDigestRow,
} from "@pips/shared";
import { sqliteFile } from "./env.js";

let db: Database.Database;

export function databasePath(): string {
  return sqliteFile();
}

export function rememberTick(at: string): void {
  setSetting("last_tick_at", at);
}

export function lastTickAt(): string | null {
  return getSetting("last_tick_at");
}

export function openDatabase(): void {
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 3000");
  migrate();
}

export function closeDatabase(): void {
  if (!db) return;
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN (
        'move', 'diary', 'journal', 'request', 'request_decision', 'pause', 'resume', 'season_change', 'chat', 'browse'
      )),
      tick INTEGER NOT NULL,
      day INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      payload TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_events_tick ON events(tick);

    CREATE TABLE IF NOT EXISTS diary (
      id TEXT PRIMARY KEY,
      day INTEGER NOT NULL,
      tick INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    );

    CREATE TABLE IF NOT EXISTS journal (
      id TEXT PRIMARY KEY,
      day INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
      created_at TEXT NOT NULL,
      decided_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'pip')),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chats_session ON chats(session_id, created_at);

    CREATE TABLE IF NOT EXISTS chat_summaries (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS digests (
      id TEXT PRIMARY KEY,
      day INTEGER NOT NULL UNIQUE,
      headline TEXT NOT NULL,
      sections TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('paused', '0')
     ON CONFLICT(key) DO NOTHING`,
  ).run();
  widenEventKinds();
}

function widenEventKinds(): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'`).get() as
    | { sql: string }
    | undefined;
  if (!row || row.sql.includes("'browse'")) return;
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE events_next (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN (
          'move', 'diary', 'journal', 'request', 'request_decision', 'pause', 'resume', 'season_change', 'chat', 'browse'
        )),
        tick INTEGER NOT NULL,
        day INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      INSERT INTO events_next (id, kind, tick, day, created_at, payload)
        SELECT id, kind, tick, day, created_at, payload FROM events;
      DROP TABLE events;
      ALTER TABLE events_next RENAME TO events;
      CREATE INDEX IF NOT EXISTS idx_events_tick ON events(tick);
    `);
  });
  tx();
}

type EventSql = {
  id: string;
  kind: WorldEvent["kind"];
  tick: number;
  day: number;
  created_at: string;
  payload: string;
};

function mapEvent(row: EventSql): WorldEvent {
  return {
    id: row.id,
    kind: row.kind,
    tick: row.tick,
    day: row.day,
    createdAt: row.created_at,
    payload: JSON.parse(row.payload),
  } as WorldEvent;
}

export function listEvents(): WorldEvent[] {
  const rows = db
    .prepare(`SELECT id, kind, tick, day, created_at, payload FROM events ORDER BY rowid ASC`)
    .all() as EventSql[];
  return rows.map(mapEvent);
}

export function maxTick(): number {
  const row = db.prepare(`SELECT COALESCE(MAX(tick), 0) AS tick FROM events`).get() as {
    tick: number;
  };
  return row.tick;
}

export function lastMoveTarget(): BuildingId | null {
  const row = db
    .prepare(
      `SELECT payload FROM events WHERE kind = 'move' ORDER BY rowid DESC LIMIT 1`,
    )
    .get() as { payload: string } | undefined;
  if (!row) return null;
  const payload = JSON.parse(row.payload) as { to?: unknown };
  return isBuildingId(payload.to) ? payload.to : null;
}

function mapDiary(row: {
  id: string;
  day: number;
  tick: number;
  body: string;
  created_at: string;
  read_at: string | null;
}): DiaryRow {
  return {
    id: row.id,
    day: row.day,
    tick: row.tick,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}

export function recentDiary(limit: number): DiaryRow[] {
  const rows = db
    .prepare(
      `SELECT id, day, tick, body, created_at, read_at FROM diary
       ORDER BY tick DESC, rowid DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    day: number;
    tick: number;
    body: string;
    created_at: string;
    read_at: string | null;
  }>;
  return rows.map(mapDiary).reverse();
}

export function diaryFromTick(fromTick: number, toTick: number): DiaryRow[] {
  const rows = db
    .prepare(
      `SELECT id, day, tick, body, created_at, read_at FROM diary
       WHERE tick >= ? AND tick <= ?
       ORDER BY tick ASC, rowid ASC`,
    )
    .all(fromTick, toTick) as Array<{
    id: string;
    day: number;
    tick: number;
    body: string;
    created_at: string;
    read_at: string | null;
  }>;
  return rows.map(mapDiary);
}

export function latestJournal(): JournalRow | null {
  const row = db
    .prepare(
      `SELECT id, day, body, created_at FROM journal
       ORDER BY day DESC, created_at DESC LIMIT 1`,
    )
    .get() as { id: string; day: number; body: string; created_at: string } | undefined;
  if (!row) return null;
  return { id: row.id, day: row.day, body: row.body, createdAt: row.created_at };
}

export function listDiary(): DiaryRow[] {
  const rows = db
    .prepare(
      `SELECT id, day, tick, body, created_at, read_at FROM diary
       ORDER BY day DESC, tick DESC, created_at DESC`,
    )
    .all() as Array<{
    id: string;
    day: number;
    tick: number;
    body: string;
    created_at: string;
    read_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    day: row.day,
    tick: row.tick,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
  }));
}

export function diaryForDay(day: number): DiaryRow[] {
  const rows = db
    .prepare(
      `SELECT id, day, tick, body, created_at, read_at FROM diary
       WHERE day = ?
       ORDER BY tick ASC, rowid ASC`,
    )
    .all(day) as Array<{
    id: string;
    day: number;
    tick: number;
    body: string;
    created_at: string;
    read_at: string | null;
  }>;
  return rows.map(mapDiary);
}

export function journalForDay(day: number): JournalRow | null {
  const row = db
    .prepare(
      `SELECT id, day, body, created_at FROM journal
       WHERE day = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(day) as { id: string; day: number; body: string; created_at: string } | undefined;
  if (!row) return null;
  return { id: row.id, day: row.day, body: row.body, createdAt: row.created_at };
}

export function eventsForDay(day: number): WorldEvent[] {
  const rows = db
    .prepare(
      `SELECT id, kind, tick, day, created_at, payload FROM events
       WHERE day = ?
       ORDER BY rowid ASC`,
    )
    .all(day) as EventSql[];
  return rows.map(mapEvent);
}

export function latestSourceDay(): number | null {
  const journal = db.prepare(`SELECT MAX(day) AS day FROM journal`).get() as { day: number | null };
  const diary = db.prepare(`SELECT MAX(day) AS day FROM diary`).get() as { day: number | null };
  const day = Math.max(journal.day ?? 0, diary.day ?? 0);
  return day > 0 ? day : null;
}

function mapDigest(row: {
  id: string;
  day: number;
  headline: string;
  sections: string;
  created_at: string;
  read_at: string | null;
}): DigestRow | null {
  let sections: unknown;
  try {
    sections = JSON.parse(row.sections);
  } catch {
    return null;
  }
  const digest: DigestRow = {
    id: row.id,
    day: row.day,
    headline: row.headline,
    sections: sections as DigestSections,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
  return isDigestRow(digest) ? digest : null;
}

export function listDigests(): DigestRow[] {
  const rows = db
    .prepare(
      `SELECT id, day, headline, sections, created_at, read_at FROM digests
       ORDER BY day DESC`,
    )
    .all() as Array<{
    id: string;
    day: number;
    headline: string;
    sections: string;
    created_at: string;
    read_at: string | null;
  }>;
  return rows.flatMap((row) => {
    const digest = mapDigest(row);
    return digest ? [digest] : [];
  });
}

export function digestForDay(day: number): DigestRow | null {
  const row = db
    .prepare(
      `SELECT id, day, headline, sections, created_at, read_at FROM digests WHERE day = ?`,
    )
    .get(day) as
    | {
        id: string;
        day: number;
        headline: string;
        sections: string;
        created_at: string;
        read_at: string | null;
      }
    | undefined;
  return row ? mapDigest(row) : null;
}

export function saveDigest(digest: DigestRow): DigestRow {
  db.prepare(
    `INSERT INTO digests (id, day, headline, sections, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, NULL)
     ON CONFLICT(day) DO UPDATE SET
       id = excluded.id,
       headline = excluded.headline,
       sections = excluded.sections,
       created_at = excluded.created_at,
       read_at = NULL`,
  ).run(digest.id, digest.day, digest.headline, JSON.stringify(digest.sections), digest.createdAt);
  return { ...digest, readAt: null };
}

export function markDigestRead(id: string): { id: string; readAt: string } | null {
  const existing = db.prepare(`SELECT id, read_at FROM digests WHERE id = ?`).get(id) as
    | { id: string; read_at: string | null }
    | undefined;
  if (!existing) return null;
  if (existing.read_at) return { id: existing.id, readAt: existing.read_at };
  const readAt = new Date().toISOString();
  db.prepare(`UPDATE digests SET read_at = ? WHERE id = ? AND read_at IS NULL`).run(readAt, id);
  return { id, readAt };
}

export function listJournal(): JournalRow[] {
  const rows = db
    .prepare(
      `SELECT id, day, body, created_at FROM journal ORDER BY day DESC, created_at DESC`,
    )
    .all() as Array<{ id: string; day: number; body: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    day: row.day,
    body: row.body,
    createdAt: row.created_at,
  }));
}

export function listRequests(): RequestRow[] {
  const rows = db
    .prepare(
      `SELECT id, title, body, status, created_at, decided_at FROM requests
       ORDER BY created_at DESC`,
    )
    .all() as Array<{
    id: string;
    title: string;
    body: string;
    status: RequestRow["status"];
    created_at: string;
    decided_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }));
}

export function countPending(): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM requests WHERE status = 'pending'`)
    .get() as { n: number };
  return row.n;
}

export function isPaused(): boolean {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'paused'`).get() as
    | { value: string }
    | undefined;
  return row?.value === "1";
}

export function getSetting(key: string): string | null {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export type PushKind = "digest" | "request" | "project" | "quiet";

export type PushPrefs = Record<PushKind, boolean>;

const PUSH_KINDS: PushKind[] = ["digest", "request", "project", "quiet"];

export function pushPrefs(): PushPrefs {
  const prefs: PushPrefs = { digest: true, request: true, project: true, quiet: true };
  const raw = getSetting("push_prefs");
  if (!raw) return prefs;
  try {
    const parsed = JSON.parse(raw) as Partial<PushPrefs>;
    for (const kind of PUSH_KINDS) {
      if (typeof parsed[kind] === "boolean") prefs[kind] = parsed[kind];
    }
  } catch {
    return prefs;
  }
  return prefs;
}

export function pushEnabled(kind: PushKind): boolean {
  return pushPrefs()[kind];
}

export function savePushPrefs(patch: Partial<PushPrefs>): PushPrefs {
  const prefs = pushPrefs();
  for (const kind of PUSH_KINDS) {
    if (typeof patch[kind] === "boolean") prefs[kind] = patch[kind];
  }
  setSetting("push_prefs", JSON.stringify(prefs));
  return prefs;
}

export type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

export function listPushSubscriptions(): PushSubscriptionRow[] {
  return db
    .prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at`)
    .all() as PushSubscriptionRow[];
}

export function savePushSubscription(row: PushSubscriptionRow): void {
  db.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(randomUUID(), row.endpoint, row.p256dh, row.auth, new Date().toISOString());
}

export function deletePushSubscription(endpoint: string): void {
  db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).run(endpoint);
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function lastRecordedSeason(): Season | null {
  const row = db
    .prepare(`SELECT payload FROM events WHERE kind = 'season_change' ORDER BY rowid DESC LIMIT 1`)
    .get() as { payload: string } | undefined;
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as { to?: unknown };
    return isSeason(payload.to) ? payload.to : null;
  } catch {
    return null;
  }
}

export function makeEvent<T extends WorldEvent>(
  kind: T["kind"],
  payload: T["payload"],
  tick: number,
): T {
  return {
    id: randomUUID(),
    kind,
    tick,
    day: dayFromTick(tick),
    createdAt: new Date().toISOString(),
    payload,
  } as T;
}

function persist(event: WorldEvent): void {
  db.prepare(
    `INSERT INTO events (id, kind, tick, day, created_at, payload)
     VALUES (@id, @kind, @tick, @day, @createdAt, @payload)`,
  ).run({
    id: event.id,
    kind: event.kind,
    tick: event.tick,
    day: event.day,
    createdAt: event.createdAt,
    payload: JSON.stringify(event.payload),
  });

  switch (event.kind) {
    case "diary":
      db.prepare(
        `INSERT INTO diary (id, day, tick, body, created_at, read_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      ).run(event.payload.entryId, event.day, event.tick, event.payload.body, event.createdAt);
      break;
    case "journal":
      db.prepare(
        `INSERT INTO journal (id, day, body, created_at) VALUES (?, ?, ?, ?)`,
      ).run(event.payload.entryId, event.day, event.payload.body, event.createdAt);
      break;
    case "request":
      db.prepare(
        `INSERT INTO requests (id, title, body, status, created_at, decided_at)
         VALUES (?, ?, ?, 'pending', ?, NULL)`,
      ).run(event.payload.requestId, event.payload.title, event.payload.body, event.createdAt);
      break;
    case "request_decision":
      db.prepare(
        `UPDATE requests SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
      ).run(event.payload.decision, event.createdAt, event.payload.requestId);
      break;
    case "pause":
      db.prepare(`UPDATE settings SET value = '1' WHERE key = 'paused'`).run();
      break;
    case "resume":
      db.prepare(`UPDATE settings SET value = '0' WHERE key = 'paused'`).run();
      break;
    case "move":
    case "season_change":
    case "chat":
    case "browse":
      break;
  }
}

export function saveEvents(events: WorldEvent[]): void {
  const tx = db.transaction(() => {
    for (const event of events) persist(event);
  });
  tx();
  for (const event of events) {
    if (event.kind !== "request") continue;
    const title = event.payload.title;
    queueMicrotask(() => {
      void import("./notify.js").then(({ digestLink, notifyOwner }) =>
        notifyOwner("request", {
          title: "New request in the mailbox",
          body: title,
          url: digestLink(),
        }),
      );
    });
  }
}

export function decideRequest(
  requestId: string,
  decision: "approved" | "denied",
  tick: number,
): WorldEvent | null {
  const existing = db
    .prepare(`SELECT id, title, status FROM requests WHERE id = ?`)
    .get(requestId) as { id: string; title: string; status: string } | undefined;
  if (!existing || existing.status !== "pending") return null;

  const event = makeEvent<Extract<WorldEvent, { kind: "request_decision" }>>(
    "request_decision",
    { requestId, decision, title: existing.title },
    tick,
  );

  let written = false;
  const tx = db.transaction(() => {
    const row = db
      .prepare(`SELECT status FROM requests WHERE id = ?`)
      .get(requestId) as { status: string } | undefined;
    if (!row || row.status !== "pending") return;
    persist(event);
    written = true;
  });
  tx();
  return written ? event : null;
}

export function setPausedFlag(paused: boolean, tick: number): WorldEvent | null {
  if (isPaused() === paused) return null;
  const event = paused
    ? makeEvent<Extract<WorldEvent, { kind: "pause" }>>("pause", { paused: true }, tick)
    : makeEvent<Extract<WorldEvent, { kind: "resume" }>>("resume", { paused: false }, tick);
  saveEvents([event]);
  return event;
}

export function recordSeasonChange(from: Season | null, to: Season, tick: number): WorldEvent {
  const event = makeEvent<Extract<WorldEvent, { kind: "season_change" }>>(
    "season_change",
    { from, to },
    tick,
  );
  saveEvents([event]);
  return event;
}

const TICK_LOCK = "tick_lock";
const TICK_LOCK_MS = 10 * 60 * 1000;

export function acquireTickLock(): boolean {
  const now = Date.now();
  let acquired = false;
  const run = db.transaction(() => {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(TICK_LOCK) as
      | { value: string }
      | undefined;
    const heldAt = row ? Number(row.value) : 0;
    if (Number.isFinite(heldAt) && heldAt > 0 && now - heldAt < TICK_LOCK_MS) return;
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(TICK_LOCK, String(now));
    acquired = true;
  });
  run.immediate();
  return acquired;
}

export function releaseTickLock(): void {
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(TICK_LOCK);
}

type ChatSql = {
  id: string;
  session_id: string;
  role: ChatRole;
  text: string;
  created_at: string;
};

function mapChat(row: ChatSql): ChatMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    text: row.text,
    createdAt: row.created_at,
  };
}

export function insertChat(sessionId: string, role: ChatRole, text: string): ChatMessage {
  const row: ChatSql = {
    id: randomUUID(),
    session_id: sessionId,
    role,
    text,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO chats (id, session_id, role, text, created_at)
     VALUES (@id, @session_id, @role, @text, @created_at)`,
  ).run(row);
  return mapChat(row);
}

export function listChat(sessionId: string): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, text, created_at FROM chats
       WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .all(sessionId) as ChatSql[];
  return rows.map(mapChat);
}

export function recentChat(sessionId: string, limit: number): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, text, created_at FROM chats
       WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(sessionId, limit) as ChatSql[];
  return rows.map(mapChat).reverse();
}

export function latestPipReply(): string | null {
  const row = db
    .prepare(
      `SELECT text FROM chats WHERE role = 'pip' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get() as { text: string } | undefined;
  return row?.text ?? null;
}

export function idleChatSessions(idleBefore: string): string[] {
  const rows = db
    .prepare(
      `SELECT session_id, MAX(created_at) AS last_at FROM chats GROUP BY session_id`,
    )
    .all() as Array<{ session_id: string; last_at: string }>;
  return rows.filter((row) => row.last_at <= idleBefore).map((row) => row.session_id);
}

export function chatSince(sessionId: string, after: string | null): ChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, role, text, created_at FROM chats
       WHERE session_id = ? AND (? IS NULL OR created_at > ?)
       ORDER BY created_at ASC, rowid ASC`,
    )
    .all(sessionId, after, after) as ChatSql[];
  return rows.map(mapChat);
}

export function latestSummaryAt(sessionId: string): string | null {
  const row = db
    .prepare(
      `SELECT created_at FROM chat_summaries WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(sessionId) as { created_at: string } | undefined;
  return row?.created_at ?? null;
}

export function insertChatSummary(sessionId: string, text: string): void {
  db.prepare(
    `INSERT INTO chat_summaries (id, session_id, text, created_at, seen_at)
     VALUES (?, ?, ?, ?, NULL)`,
  ).run(randomUUID(), sessionId, text, new Date().toISOString());
}

export function consumeUnseenChatSummaries(): string {
  const rows = db
    .prepare(
      `SELECT id, text FROM chat_summaries WHERE seen_at IS NULL ORDER BY created_at ASC`,
    )
    .all() as Array<{ id: string; text: string }>;
  if (rows.length === 0) return "";
  const seenAt = new Date().toISOString();
  const mark = db.prepare(`UPDATE chat_summaries SET seen_at = ? WHERE id = ?`);
  for (const row of rows) mark.run(seenAt, row.id);
  return rows.map((row) => row.text).join("\n\n");
}

export function markAllDiaryRead(): string | null {
  const pending = db.prepare(`SELECT COUNT(*) AS n FROM diary WHERE read_at IS NULL`).get() as {
    n: number;
  };
  if (pending.n === 0) return null;
  const readAt = new Date().toISOString();
  db.prepare(`UPDATE diary SET read_at = ? WHERE read_at IS NULL`).run(readAt);
  return readAt;
}
