import { getSetting, setSetting } from "./db.js";

type Usage = {
  date: string;
  ticks: number;
  calls: number;
  tokens: number;
  chats: number;
  searches: number;
  reads: number;
};

export type Caps = {
  ticks: number;
  calls: number;
  tokens: number;
};

const USAGE_KEY = "usage";

function localDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function capNumber(envName: string, settingKey: string, fallback: number): number {
  const raw = process.env[envName];
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  const stored = getSetting(settingKey);
  if (stored !== null) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  return fallback;
}

export function caps(): Caps {
  const resolved = {
    ticks: capNumber("DAILY_TICK_CAP", "daily_tick_cap", 48),
    calls: capNumber("DAILY_CALL_CAP", "daily_call_cap", 500),
    tokens: capNumber("DAILY_TOKEN_CAP", "daily_token_cap", 500_000),
  };
  setSetting("daily_tick_cap", String(resolved.ticks));
  setSetting("daily_call_cap", String(resolved.calls));
  setSetting("daily_token_cap", String(resolved.tokens));
  return resolved;
}

function loadUsage(): Usage {
  const today = localDate();
  const empty: Usage = { date: today, ticks: 0, calls: 0, tokens: 0, chats: 0, searches: 0, reads: 0 };
  const raw = getSetting(USAGE_KEY);
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<Usage>;
    if (parsed.date !== today) return empty;
    return {
      date: today,
      ticks: numberOrZero(parsed.ticks),
      calls: numberOrZero(parsed.calls),
      tokens: numberOrZero(parsed.tokens),
      chats: numberOrZero(parsed.chats),
      searches: numberOrZero(parsed.searches),
      reads: numberOrZero(parsed.reads),
    };
  } catch {
    return empty;
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function saveUsage(usage: Usage): void {
  setSetting(USAGE_KEY, JSON.stringify(usage));
}

export function ticksLeft(): boolean {
  return loadUsage().ticks < caps().ticks;
}

export function callsLeft(): boolean {
  return loadUsage().calls < caps().calls;
}

export function callsToday(): number {
  return loadUsage().calls;
}

export function tokensLeft(): boolean {
  return loadUsage().tokens < caps().tokens;
}

export function noteTick(): void {
  const usage = loadUsage();
  usage.ticks += 1;
  saveUsage(usage);
}

export function noteCall(): void {
  const usage = loadUsage();
  usage.calls += 1;
  saveUsage(usage);
}

export function chatCap(): number {
  const cap = capNumber("DAILY_CHAT_CAP", "daily_chat_cap", 100);
  setSetting("daily_chat_cap", String(cap));
  return cap;
}

export function chatsLeft(): boolean {
  return loadUsage().chats < chatCap();
}

export function noteChat(): void {
  const usage = loadUsage();
  usage.chats += 1;
  saveUsage(usage);
}

export function webCallsPerTick(): number {
  const raw = process.env.WEB_CALLS_PER_TICK;
  if (raw === undefined || raw.trim() === "") return 10;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 10;
  return Math.floor(parsed);
}

export function searchCap(): number {
  const cap = capNumber("DAILY_SEARCH_CAP", "daily_search_cap", 30);
  setSetting("daily_search_cap", String(cap));
  return cap;
}

export function searchesLeft(): boolean {
  return loadUsage().searches < searchCap();
}

export function noteSearch(): void {
  const usage = loadUsage();
  usage.searches += 1;
  saveUsage(usage);
}

export function readCap(): number {
  const cap = capNumber("DAILY_READ_CAP", "daily_read_cap", 100);
  setSetting("daily_read_cap", String(cap));
  return cap;
}

export function readsLeft(): boolean {
  return loadUsage().reads < readCap();
}

export function noteRead(): void {
  const usage = loadUsage();
  usage.reads += 1;
  saveUsage(usage);
}

export function noteTokens(count: number): void {
  if (!Number.isFinite(count) || count <= 0) return;
  const usage = loadUsage();
  usage.tokens += Math.ceil(count);
  saveUsage(usage);
}
