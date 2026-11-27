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
  type WorldObject,
  isDigestRow,
  isPlaceType,
  isWorldObject,
  starterObjects,
  STARTER_BLUEPRINTS,
  BUILDABLE,
  isBlueprintName,
  isBlueprintRecord,
  validateBlueprint,
  type BlueprintRecord,
  type BlueprintStatus,
  type PathRecord,
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
        'move', 'diary', 'journal', 'request', 'request_decision', 'pause', 'resume', 'season_change', 'chat', 'browse', 'build', 'blueprint', 'creation_started', 'creation_updated', 'creation_finished'
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

    CREATE TABLE IF NOT EXISTS world_objects (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      x REAL NOT NULL,
      z REAL NOT NULL,
      rotation REAL NOT NULL,
      style TEXT NOT NULL,
      created_by TEXT NOT NULL CHECK (created_by IN ('world', 'pip')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blueprints (
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      spec TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('live', 'pending', 'archived')),
      created_by TEXT NOT NULL CHECK (created_by IN ('world', 'pip')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (name, version)
    );

    CREATE TABLE IF NOT EXISTS paths (
      name TEXT PRIMARY KEY,
      points TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS study_plans (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      why TEXT NOT NULL,
      planned_ticks INTEGER NOT NULL,
      ticks_done INTEGER NOT NULL,
      notes TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'done')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      body TEXT NOT NULL,
      sources TEXT NOT NULL,
      created_at TEXT NOT NULL,
      touched_at TEXT NOT NULL,
      prompted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_notes_touched ON notes(touched_at);

    CREATE TABLE IF NOT EXISTS creations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('art', 'writing', 'design', 'game', 'site', 'mechanic')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      pip_notes TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'finished', 'published')),
      season TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      favourite INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      inspired_by TEXT NOT NULL DEFAULT '',
      diary_ids TEXT NOT NULL DEFAULT '[]',
      domains TEXT NOT NULL DEFAULT '[]',
      source_tick INTEGER
    );

    CREATE TABLE IF NOT EXISTS creation_versions (
      creation_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      files_path TEXT NOT NULL,
      thumbnail_path TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (creation_id, version),
      FOREIGN KEY (creation_id) REFERENCES creations(id)
    );

    CREATE TABLE IF NOT EXISTS interests (
      name TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      strength INTEGER NOT NULL,
      first_seen TEXT NOT NULL,
      last_active TEXT NOT NULL,
      diary_ids TEXT NOT NULL,
      domains TEXT NOT NULL,
      creation_ids TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS identity_versions (
      version INTEGER PRIMARY KEY,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blueprint_notes (
      name TEXT NOT NULL,
      version INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (name, version)
    );
  `);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('paused', '0')
     ON CONFLICT(key) DO NOTHING`,
  ).run();
  widenEventKinds();
  ensureObjectColumns();
  seedWorld();
  seedBlueprints();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('blueprint_approval', '0')
     ON CONFLICT(key) DO NOTHING`,
  ).run();
  db.prepare(
    `INSERT INTO settings (key, value) VALUES
       ('growth_pace', 'calm'),
       ('awake_start', '7'),
       ('awake_end', '23'),
       ('creations_public', '0')
     ON CONFLICT(key) DO NOTHING`,
  ).run();
}

function widenEventKinds(): void {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'events'`).get() as
    | { sql: string }
    | undefined;
  if (!row || row.sql.includes("'creation_finished'")) return;
  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE events_next (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN (
          'move', 'diary', 'journal', 'request', 'request_decision', 'pause', 'resume', 'season_change', 'chat', 'browse', 'build', 'blueprint', 'creation_started', 'creation_updated', 'creation_finished'
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
      attachDiaryToCreations(event.tick, event.payload.entryId);
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
    case "build":
    case "blueprint":
    case "creation_started":
    case "creation_updated":
    case "creation_finished":
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

type ObjectSql = {
  id: string;
  type: string;
  x: number;
  z: number;
  rotation: number;
  style: string;
  blueprint: string | null;
  path: string | null;
  created_by: string;
  created_at: string;
};

function mapObject(row: ObjectSql): WorldObject | null {
  if (!isBlueprintName(row.type) && !isPlaceType(row.type)) return null;
  if (row.created_by !== "world" && row.created_by !== "pip") return null;
  const blueprint = row.blueprint && isBlueprintName(row.blueprint) ? row.blueprint : null;
  const path = row.path && isBlueprintName(row.path) ? row.path : null;
  const object: WorldObject = {
    id: row.id,
    type: row.type,
    x: row.x,
    z: row.z,
    rotation: row.rotation,
    style: row.style,
    blueprint,
    path,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
  if (!isWorldObject(object)) return null;
  return object;
}

function ensureObjectColumns(): void {
  const columns = db.prepare(`PRAGMA table_info(world_objects)`).all() as { name: string }[];
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("blueprint")) db.exec(`ALTER TABLE world_objects ADD COLUMN blueprint TEXT`);
  if (!names.has("path")) db.exec(`ALTER TABLE world_objects ADD COLUMN path TEXT`);
  const catalogue = BUILDABLE.map((type) => `'${type}'`).join(", ");
  db.exec(`UPDATE world_objects SET blueprint = type WHERE blueprint IS NULL AND type IN (${catalogue})`);
}

function seedBlueprints(): void {
  const exists = db.prepare(`SELECT 1 AS ok FROM blueprints WHERE name = ? LIMIT 1`);
  const insert = db.prepare(
    `INSERT INTO blueprints (name, version, spec, status, created_by, created_at)
     VALUES (?, 1, ?, 'live', 'world', ?)`,
  );
  const tx = db.transaction(() => {
    for (const item of STARTER_BLUEPRINTS) {
      const checked = validateBlueprint(item.spec);
      if ("error" in checked) throw new Error(checked.error);
      if (exists.get(item.name)) continue;
      insert.run(item.name, JSON.stringify(checked.spec), "2020-01-01T00:00:00.000Z");
    }
  });
  tx();
}

function seedWorld(): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM world_objects`).get() as { n: number };
  if (count.n > 0) return;
  const insert = db.prepare(
    `INSERT INTO world_objects (id, type, x, z, rotation, style, blueprint, path, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const object of starterObjects()) {
      insert.run(
        object.id,
        object.type,
        object.x,
        object.z,
        object.rotation,
        object.style,
        object.blueprint,
        object.path,
        object.createdBy,
        object.createdAt,
      );
    }
  });
  tx();
}

export function listWorldObjects(): WorldObject[] {
  const rows = db
    .prepare(
      `SELECT id, type, x, z, rotation, style, blueprint, path, created_by, created_at FROM world_objects ORDER BY created_at, id`,
    )
    .all() as ObjectSql[];
  return rows.flatMap((row) => {
    const object = mapObject(row);
    return object ? [object] : [];
  });
}

export function insertWorldObject(object: WorldObject): void {
  db.prepare(
    `INSERT INTO world_objects (id, type, x, z, rotation, style, blueprint, path, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    object.id,
    object.type,
    object.x,
    object.z,
    object.rotation,
    object.style,
    object.blueprint,
    object.path,
    object.createdBy,
    object.createdAt,
  );
}

export function updateWorldObject(object: WorldObject): void {
  db.prepare(
    `UPDATE world_objects SET x = ?, z = ?, rotation = ?, style = ?, blueprint = ?, path = ? WHERE id = ?`,
  ).run(object.x, object.z, object.rotation, object.style, object.blueprint, object.path, object.id);
}

export function deleteWorldObject(id: string): void {
  db.prepare(`DELETE FROM world_objects WHERE id = ?`).run(id);
}

export function blueprintApprovalRequired(): boolean {
  return getSetting("blueprint_approval") === "1";
}

export function setBlueprintApproval(required: boolean): void {
  setSetting("blueprint_approval", required ? "1" : "0");
}

type BlueprintSql = {
  name: string;
  version: number;
  spec: string;
  status: string;
  created_by: string;
  created_at: string;
};

function mapBlueprint(row: BlueprintSql): BlueprintRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.spec);
  } catch {
    return null;
  }
  const checked = validateBlueprint(parsed);
  if ("error" in checked) return null;
  if (row.status !== "live" && row.status !== "pending" && row.status !== "archived") return null;
  if (row.created_by !== "world" && row.created_by !== "pip") return null;
  const record: BlueprintRecord = {
    name: row.name,
    version: row.version,
    spec: checked.spec,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
  return isBlueprintRecord(record) ? record : null;
}

export function listBlueprints(): BlueprintRecord[] {
  const rows = db
    .prepare(
      `SELECT name, version, spec, status, created_by, created_at FROM blueprints ORDER BY name, version`,
    )
    .all() as BlueprintSql[];
  return rows.flatMap((row) => {
    const record = mapBlueprint(row);
    return record ? [record] : [];
  });
}

export function blueprintNamed(name: string, version: number): BlueprintRecord | null {
  const row = db
    .prepare(
      `SELECT name, version, spec, status, created_by, created_at FROM blueprints WHERE name = ? AND version = ?`,
    )
    .get(name, version) as BlueprintSql | undefined;
  return row ? mapBlueprint(row) : null;
}

export function latestBlueprint(name: string): BlueprintRecord | null {
  const row = db
    .prepare(
      `SELECT name, version, spec, status, created_by, created_at FROM blueprints
       WHERE name = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(name) as BlueprintSql | undefined;
  return row ? mapBlueprint(row) : null;
}

export function liveBlueprint(name: string): BlueprintRecord | null {
  const row = db
    .prepare(
      `SELECT name, version, spec, status, created_by, created_at FROM blueprints
       WHERE name = ? AND status = 'live' ORDER BY version DESC LIMIT 1`,
    )
    .get(name) as BlueprintSql | undefined;
  return row ? mapBlueprint(row) : null;
}

export function insertBlueprint(
  name: string,
  version: number,
  spec: string,
  status: BlueprintStatus,
  createdBy: "world" | "pip",
  createdAt: string,
): void {
  db.prepare(
    `INSERT INTO blueprints (name, version, spec, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(name, version, spec, status, createdBy, createdAt);
}

export function archiveLiveBlueprint(name: string): void {
  db.prepare(`UPDATE blueprints SET status = 'archived' WHERE name = ? AND status = 'live'`).run(name);
}

export function setBlueprintStatus(name: string, version: number, status: BlueprintStatus): void {
  db.prepare(`UPDATE blueprints SET status = ? WHERE name = ? AND version = ?`).run(status, name, version);
}

export function listPaths(): PathRecord[] {
  const rows = db.prepare(`SELECT name, points FROM paths ORDER BY name`).all() as { name: string; points: string }[];
  const paths: PathRecord[] = [];
  for (const row of rows) {
    if (!isBlueprintName(row.name)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.points);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const points = parsed.flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const rowPoint = point as { x?: unknown; z?: unknown };
      if (typeof rowPoint.x !== "number" || typeof rowPoint.z !== "number") return [];
      return [{ x: rowPoint.x, z: rowPoint.z }];
    });
    if (points.length >= 2) paths.push({ name: row.name, points });
  }
  return paths;
}

export function savePath(name: string, points: { x: number; z: number }[]): void {
  db.prepare(
    `INSERT INTO paths (name, points, created_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET points = excluded.points, created_at = excluded.created_at`,
  ).run(name, JSON.stringify(points), new Date().toISOString());
}

export type StudyRow = {
  id: string;
  topic: string;
  why: string;
  plannedTicks: number;
  ticksDone: number;
  notes: string;
  status: "active" | "done";
  createdAt: string;
  updatedAt: string;
};

type StudySql = {
  id: string;
  topic: string;
  why: string;
  planned_ticks: number;
  ticks_done: number;
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function mapStudy(row: StudySql): StudyRow | null {
  if (row.status !== "active" && row.status !== "done") return null;
  return {
    id: row.id,
    topic: row.topic,
    why: row.why,
    plannedTicks: row.planned_ticks,
    ticksDone: row.ticks_done,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listStudies(): StudyRow[] {
  const rows = db
    .prepare(
      `SELECT id, topic, why, planned_ticks, ticks_done, notes, status, created_at, updated_at
       FROM study_plans ORDER BY updated_at DESC`,
    )
    .all() as StudySql[];
  return rows.flatMap((row) => {
    const mapped = mapStudy(row);
    return mapped ? [mapped] : [];
  });
}

export function activeStudyCount(): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM study_plans WHERE status = 'active'`).get() as { n: number };
  return row.n;
}

export function insertStudy(row: StudyRow): void {
  db.prepare(
    `INSERT INTO study_plans (id, topic, why, planned_ticks, ticks_done, notes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.topic, row.why, row.plannedTicks, row.ticksDone, row.notes, row.status, row.createdAt, row.updatedAt);
}

export function saveStudy(row: StudyRow): void {
  db.prepare(
    `UPDATE study_plans SET notes = ?, ticks_done = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(row.notes, row.ticksDone, row.status, row.updatedAt, row.id);
}

export type NoteRow = {
  id: string;
  topic: string;
  body: string;
  sources: string;
  createdAt: string;
  touchedAt: string;
  promptedAt: string | null;
};

export function insertNote(row: NoteRow): void {
  db.prepare(
    `INSERT INTO notes (id, topic, body, sources, created_at, touched_at, prompted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.topic, row.body, row.sources, row.createdAt, row.touchedAt, row.promptedAt);
  db.prepare(`UPDATE notes SET touched_at = ? WHERE lower(topic) = lower(?)`).run(row.touchedAt, row.topic);
}

export function countNotes(): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM notes`).get() as { n: number };
  return row.n;
}

export function searchNoteRows(topic: string): NoteRow[] {
  const like = `%${topic.slice(0, 80).replaceAll("%", "").replaceAll("_", "")}%`;
  const rows = db
    .prepare(
      `SELECT id, topic, body, sources, created_at, touched_at, prompted_at FROM notes
       WHERE topic LIKE ? OR body LIKE ? ORDER BY touched_at DESC LIMIT 8`,
    )
    .all(like, like) as NoteSql[];
  return rows.map(mapNote);
}

type NoteSql = {
  id: string;
  topic: string;
  body: string;
  sources: string;
  created_at: string;
  touched_at: string;
  prompted_at: string | null;
};

function mapNote(row: NoteSql): NoteRow {
  return {
    id: row.id,
    topic: row.topic,
    body: row.body,
    sources: row.sources,
    createdAt: row.created_at,
    touchedAt: row.touched_at,
    promptedAt: row.prompted_at,
  };
}

export function notesMatchingTopics(topics: string[]): NoteRow[] {
  if (topics.length === 0) return [];
  const rows = db
    .prepare(`SELECT id, topic, body, sources, created_at, touched_at, prompted_at FROM notes ORDER BY touched_at DESC LIMIT 40`)
    .all() as NoteSql[];
  const wanted = topics.map((topic) => topic.toLowerCase());
  return rows
    .map(mapNote)
    .filter((note) => {
      const topic = note.topic.toLowerCase();
      return wanted.some((item) => topic.includes(item) || item.includes(topic));
    })
    .slice(0, 5);
}

export function staleNotes(untouchedBefore: string, promptedBefore: string): NoteRow[] {
  const rows = db
    .prepare(
      `SELECT id, topic, body, sources, created_at, touched_at, prompted_at FROM notes
       WHERE touched_at <= ? AND (prompted_at IS NULL OR prompted_at <= ?)
       ORDER BY touched_at ASC LIMIT 3`,
    )
    .all(untouchedBefore, promptedBefore) as NoteSql[];
  return rows.map(mapNote);
}

export function markNotesPrompted(ids: string[], at: string): void {
  if (ids.length === 0) return;
  const statement = db.prepare(`UPDATE notes SET prompted_at = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const id of ids) statement.run(at, id);
  });
  tx();
}

export function noteTopicsSince(iso: string): string[] {
  const rows = db.prepare(`SELECT DISTINCT topic FROM notes WHERE created_at >= ?`).all(iso) as { topic: string }[];
  return rows.map((row) => row.topic);
}

export function studyTopicsSince(iso: string): string[] {
  const rows = db.prepare(`SELECT DISTINCT topic FROM study_plans WHERE updated_at >= ?`).all(iso) as { topic: string }[];
  return rows.map((row) => row.topic);
}

export function browseQueriesSince(iso: string): string[] {
  const rows = db
    .prepare(`SELECT payload FROM events WHERE kind = 'browse' AND created_at >= ? ORDER BY created_at DESC`)
    .all(iso) as { payload: string }[];
  const queries: string[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as { query?: unknown };
      if (typeof payload.query === "string" && payload.query.trim()) queries.push(payload.query.trim());
    } catch {
      continue;
    }
  }
  return queries;
}

export function diaryBetween(startIso: string, endIso: string): { tick: number; body: string }[] {
  return db
    .prepare(`SELECT tick, body FROM diary WHERE created_at >= ? AND created_at < ? ORDER BY created_at`)
    .all(startIso, endIso) as { tick: number; body: string }[];
}

export type CreationRow = {
  id: string;
  type: string;
  title: string;
  description: string;
  pipNotes: string;
  status: string;
  season: string;
  createdAt: string;
  updatedAt: string;
  favourite: boolean;
  archived: boolean;
  inspiredBy: string;
  diaryIds: string[];
  domains: string[];
  sourceTick: number | null;
};

export type CreationVersionRow = {
  creationId: string;
  version: number;
  filesPath: string;
  thumbnailPath: string | null;
  createdAt: string;
};

type CreationSql = {
  id: string;
  type: string;
  title: string;
  description: string;
  pip_notes: string;
  status: string;
  season: string;
  created_at: string;
  updated_at: string;
  favourite: number;
  archived: number;
  inspired_by: string;
  diary_ids: string;
  domains: string;
  source_tick: number | null;
};

function jsonList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function mapCreation(row: CreationSql): CreationRow {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    pipNotes: row.pip_notes,
    status: row.status,
    season: row.season,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    favourite: row.favourite === 1,
    archived: row.archived === 1,
    inspiredBy: row.inspired_by,
    diaryIds: jsonList(row.diary_ids),
    domains: jsonList(row.domains),
    sourceTick: row.source_tick,
  };
}

const CREATION_SELECT = `SELECT id, type, title, description, pip_notes, status, season, created_at, updated_at, favourite, archived, inspired_by, diary_ids, domains, source_tick FROM creations`;

export function listCreationRows(): CreationRow[] {
  const rows = db.prepare(`${CREATION_SELECT} ORDER BY updated_at DESC`).all() as CreationSql[];
  return rows.map(mapCreation);
}

export function creationRow(id: string): CreationRow | null {
  const row = db.prepare(`${CREATION_SELECT} WHERE id = ?`).get(id) as CreationSql | undefined;
  return row ? mapCreation(row) : null;
}

export function findOpenDraft(type: string, title: string): CreationRow | null {
  const row = db
    .prepare(
      `${CREATION_SELECT} WHERE type = ? AND lower(title) = lower(?) AND status = 'draft' AND archived = 0 ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(type, title) as CreationSql | undefined;
  return row ? mapCreation(row) : null;
}

export function insertCreation(row: CreationRow): void {
  db.prepare(
    `INSERT INTO creations (
      id, type, title, description, pip_notes, status, season, created_at, updated_at,
      favourite, archived, inspired_by, diary_ids, domains, source_tick
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.type,
    row.title,
    row.description,
    row.pipNotes,
    row.status,
    row.season,
    row.createdAt,
    row.updatedAt,
    row.favourite ? 1 : 0,
    row.archived ? 1 : 0,
    row.inspiredBy,
    JSON.stringify(row.diaryIds),
    JSON.stringify(row.domains),
    row.sourceTick,
  );
}

export function saveCreationRow(row: CreationRow): void {
  db.prepare(
    `UPDATE creations SET
      description = ?, pip_notes = ?, status = ?, updated_at = ?, favourite = ?, archived = ?,
      inspired_by = ?, diary_ids = ?, domains = ?, source_tick = ?
     WHERE id = ?`,
  ).run(
    row.description,
    row.pipNotes,
    row.status,
    row.updatedAt,
    row.favourite ? 1 : 0,
    row.archived ? 1 : 0,
    row.inspiredBy,
    JSON.stringify(row.diaryIds),
    JSON.stringify(row.domains),
    row.sourceTick,
    row.id,
  );
}

export function listVersionRows(creationId: string): CreationVersionRow[] {
  const rows = db
    .prepare(
      `SELECT creation_id, version, files_path, thumbnail_path, created_at FROM creation_versions WHERE creation_id = ? ORDER BY version ASC`,
    )
    .all(creationId) as {
    creation_id: string;
    version: number;
    files_path: string;
    thumbnail_path: string | null;
    created_at: string;
  }[];
  return rows.map((row) => ({
    creationId: row.creation_id,
    version: row.version,
    filesPath: row.files_path,
    thumbnailPath: row.thumbnail_path,
    createdAt: row.created_at,
  }));
}

export function insertVersion(row: CreationVersionRow): void {
  db.prepare(
    `INSERT INTO creation_versions (creation_id, version, files_path, thumbnail_path, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(row.creationId, row.version, row.filesPath, row.thumbnailPath, row.createdAt);
}

export function attachDiaryToCreations(tick: number, diaryId: string): void {
  const rows = db.prepare(`SELECT id, diary_ids FROM creations WHERE source_tick = ?`).all(tick) as {
    id: string;
    diary_ids: string;
  }[];
  for (const row of rows) {
    const ids = jsonList(row.diary_ids);
    if (ids.includes(diaryId)) continue;
    ids.push(diaryId);
    db.prepare(`UPDATE creations SET diary_ids = ? WHERE id = ?`).run(JSON.stringify(ids), row.id);
  }
}

export function diaryIdForTick(tick: number): string | null {
  const row = db.prepare(`SELECT id FROM diary WHERE tick = ? ORDER BY created_at DESC LIMIT 1`).get(tick) as
    | { id: string }
    | undefined;
  return row?.id ?? null;
}

export function browseUrlsForTick(tick: number): string[] {
  const rows = db.prepare(`SELECT payload FROM events WHERE kind = 'browse' AND tick = ?`).all(tick) as {
    payload: string;
  }[];
  const urls: string[] = [];
  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload) as { url?: unknown };
      if (typeof payload.url === "string" && payload.url.trim()) urls.push(payload.url.trim());
    } catch {
      continue;
    }
  }
  return urls;
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

export type InterestRecord = {
  name: string;
  summary: string;
  strength: number;
  firstSeen: string;
  lastActive: string;
  diaryIds: string[];
  domains: string[];
  creationIds: string[];
};

export function replaceInterests(rows: InterestRecord[]): void {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM interests`).run();
    const insert = db.prepare(
      `INSERT INTO interests (name, summary, strength, first_seen, last_active, diary_ids, domains, creation_ids, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      insert.run(
        row.name,
        row.summary,
        row.strength,
        row.firstSeen,
        row.lastActive,
        JSON.stringify(row.diaryIds),
        JSON.stringify(row.domains),
        JSON.stringify(row.creationIds),
        now,
      );
    }
  });
  tx();
}

export function listInterestRecords(): InterestRecord[] {
  const rows = db
    .prepare(
      `SELECT name, summary, strength, first_seen, last_active, diary_ids, domains, creation_ids FROM interests ORDER BY name`,
    )
    .all() as {
    name: string;
    summary: string;
    strength: number;
    first_seen: string;
    last_active: string;
    diary_ids: string;
    domains: string;
    creation_ids: string;
  }[];
  return rows.map((row) => ({
    name: row.name,
    summary: row.summary,
    strength: row.strength,
    firstSeen: row.first_seen,
    lastActive: row.last_active,
    diaryIds: jsonList(row.diary_ids),
    domains: jsonList(row.domains),
    creationIds: jsonList(row.creation_ids),
  }));
}

export function rememberIdentity(before: string, next: string): void {
  const count = db.prepare(`SELECT COUNT(*) AS n FROM identity_versions`).get() as { n: number };
  const latest = db.prepare(`SELECT body FROM identity_versions ORDER BY version DESC LIMIT 1`).get() as
    | { body: string }
    | undefined;
  const insert = db.prepare(`INSERT INTO identity_versions (version, body, created_at) VALUES (?, ?, ?)`);
  const now = new Date().toISOString();
  if (count.n === 0 && before.trim() && before.trim() !== next.trim()) {
    insert.run(1, before.endsWith("\n") ? before : `${before}\n`, now);
  }
  if (latest && latest.body.trim() === next.trim()) return;
  const version = (db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM identity_versions`).get() as { v: number }).v + 1;
  insert.run(version, next.endsWith("\n") ? next : `${next}\n`, now);
}

export function listIdentityVersions(): { version: number; body: string; createdAt: string }[] {
  const rows = db
    .prepare(`SELECT version, body, created_at FROM identity_versions ORDER BY version DESC`)
    .all() as { version: number; body: string; created_at: string }[];
  return rows.map((row) => ({ version: row.version, body: row.body, createdAt: row.created_at }));
}

export function saveBlueprintNote(name: string, version: number, body: string): void {
  db.prepare(
    `INSERT INTO blueprint_notes (name, version, body) VALUES (?, ?, ?)
     ON CONFLICT(name, version) DO UPDATE SET body = excluded.body`,
  ).run(name, version, body);
}

export function listBlueprintNotes(): { name: string; version: number; body: string }[] {
  return db.prepare(`SELECT name, version, body FROM blueprint_notes`).all() as {
    name: string;
    version: number;
    body: string;
  }[];
}

export function overviewFacts(): {
  daysAlive: number;
  ticks: number;
  diary: number;
  builds: number;
  creations: number;
  pagesRead: number;
  activity: { day: number; count: number }[];
} {
  const days = db.prepare(`SELECT COUNT(DISTINCT day) AS n FROM events`).get() as { n: number };
  const ticks = db.prepare(`SELECT COALESCE(MAX(tick), 0) AS n FROM events`).get() as { n: number };
  const diary = db.prepare(`SELECT COUNT(*) AS n FROM diary`).get() as { n: number };
  const builds = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = 'build'`).get() as { n: number };
  const creations = db.prepare(`SELECT COUNT(*) AS n FROM creations WHERE archived = 0`).get() as { n: number };
  const reads = db
    .prepare(`SELECT COUNT(*) AS n FROM events WHERE kind = 'browse' AND json_extract(payload, '$.tool') = 'read_page'`)
    .get() as { n: number };
  const activity = db
    .prepare(`SELECT day, COUNT(*) AS n FROM events GROUP BY day ORDER BY day DESC LIMIT 14`)
    .all() as { day: number; n: number }[];
  return {
    daysAlive: days.n,
    ticks: ticks.n,
    diary: diary.n,
    builds: builds.n,
    creations: creations.n,
    pagesRead: reads.n,
    activity: activity.map((row) => ({ day: row.day, count: row.n })).reverse(),
  };
}
