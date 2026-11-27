export type AlertFlags = {
  digest: boolean;
  request: boolean;
  project: boolean;
  quiet: boolean;
};

export type RuntimeConfig = {
  tickIntervalMinutes: number;
  awakeStart: number;
  awakeEnd: number;
  blueprintApproval: boolean;
  creationsPublic: boolean;
  storageBudgetBytes: number;
  creationMaxBytes: number;
  alerts: AlertFlags;
  dailyTickCap: number;
  dailyCallCap: number;
  dailyTokenCap: number;
  dailySearchCap: number;
  dailyReadCap: number;
  dailyBuildCap: number;
  dailyChatCap: number;
  webCallsPerTick: number;
};

const CLOCK_MINUTES = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60];

let frozen: RuntimeConfig | null = null;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function positiveEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function flag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

function clockEnv(name: string, fallback: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const match = /^(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isInteger(hour) || minute !== 0 || hour < 0 || hour > max) return fallback;
  return hour;
}

function clockMinutes(raw: number): number {
  if (CLOCK_MINUTES.includes(raw)) return raw;
  return 30;
}

export function loadRuntimeConfig(): RuntimeConfig {
  let awakeStart = clockEnv("AWAKE_START", 7, 23);
  let awakeEnd = clockEnv("AWAKE_END", 23, 24);
  if (awakeEnd <= awakeStart) {
    awakeStart = 7;
    awakeEnd = 23;
  }
  frozen = {
    tickIntervalMinutes: clockMinutes(intEnv("TICK_INTERVAL_MINUTES", 30, 1, 60)),
    awakeStart,
    awakeEnd,
    blueprintApproval: flag("BLUEPRINT_APPROVAL", false),
    creationsPublic: flag("CREATIONS_PUBLIC", false),
    storageBudgetBytes: Math.floor(positiveEnv("STORAGE_BUDGET_MB", 2048) * 1024 * 1024),
    creationMaxBytes: Math.floor(positiveEnv("CREATION_MAX_MB", 32) * 1024 * 1024),
    alerts: {
      digest: flag("ALERT_DIGEST", true),
      request: flag("ALERT_REQUEST", true),
      project: flag("ALERT_PROJECT", true),
      quiet: flag("ALERT_QUIET", true),
    },
    dailyTickCap: intEnv("DAILY_TICK_CAP", 48, 0, 100_000),
    dailyCallCap: intEnv("DAILY_CALL_CAP", 500, 0, 1_000_000),
    dailyTokenCap: intEnv("DAILY_TOKEN_CAP", 500_000, 0, 100_000_000),
    dailySearchCap: intEnv("DAILY_SEARCH_CAP", 30, 0, 100_000),
    dailyReadCap: intEnv("DAILY_READ_CAP", 200, 0, 100_000),
    dailyBuildCap: intEnv("DAILY_BUILD_CAP", 3, 0, 100_000),
    dailyChatCap: intEnv("DAILY_CHAT_CAP", 100, 0, 100_000),
    webCallsPerTick: intEnv("WEB_CALLS_PER_TICK", 10, 0, 1000),
  };
  return frozen;
}

export function runtimeConfig(): RuntimeConfig {
  return frozen ?? loadRuntimeConfig();
}

export function tickCron(interval = runtimeConfig().tickIntervalMinutes): string {
  if (interval >= 60) return "0 * * * *";
  const minutes: number[] = [];
  for (let minute = 0; minute < 60; minute += interval) minutes.push(minute);
  return `${minutes.join(",")} * * * *`;
}
