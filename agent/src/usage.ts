import { ownerDate } from "./clock.js";
import { getSetting, setSetting } from "./db.js";
import { runtimeConfig } from "./runtimeConfig.js";

type Usage = {
  date: string;
  ticks: number;
  calls: number;
  tokens: number;
  chats: number;
  searches: number;
  reads: number;
  builds: number;
};

export type Caps = {
  ticks: number;
  calls: number;
  tokens: number;
};

const USAGE_KEY = "usage";

function localDate(): string {
  return ownerDate(new Date());
}

export function caps(): Caps {
  const config = runtimeConfig();
  return { ticks: config.dailyTickCap, calls: config.dailyCallCap, tokens: config.dailyTokenCap };
}

export function usageSnapshot(): { calls: number; reads: number; searches: number; builds: number; ticks: number } {
  const usage = loadUsage();
  return {
    calls: usage.calls,
    reads: usage.reads,
    searches: usage.searches,
    builds: usage.builds,
    ticks: usage.ticks,
  };
}

function loadUsage(): Usage {
  const today = localDate();
  const empty: Usage = {
    date: today,
    ticks: 0,
    calls: 0,
    tokens: 0,
    chats: 0,
    searches: 0,
    reads: 0,
    builds: 0,
  };
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
      builds: numberOrZero(parsed.builds),
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
  return runtimeConfig().dailyChatCap;
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
  return runtimeConfig().webCallsPerTick;
}

export function searchCap(): number {
  return runtimeConfig().dailySearchCap;
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
  return runtimeConfig().dailyReadCap;
}

export function readsLeft(): boolean {
  return loadUsage().reads < readCap();
}

export function noteRead(): void {
  const usage = loadUsage();
  usage.reads += 1;
  saveUsage(usage);
}

export function buildCap(): number {
  return runtimeConfig().dailyBuildCap;
}

export function buildsLeft(): boolean {
  return loadUsage().builds < buildCap();
}

export function noteBuild(): void {
  const usage = loadUsage();
  usage.builds += 1;
  saveUsage(usage);
}

export function noteTokens(count: number): void {
  if (!Number.isFinite(count) || count <= 0) return;
  const usage = loadUsage();
  usage.tokens += Math.ceil(count);
  saveUsage(usage);
}
