import { DateTime } from "luxon";
import { type Season, type SeasonPreview, type WorldState } from "@pips/shared";
import {
  formatClockHours,
  periodAt,
  readClockConfig,
  seasonForMonth,
  seasonMode,
  seasonMonths,
  villageClock,
  type SunMarks,
} from "./clock.js";
import {
  getSetting,
  lastRecordedSeason,
  recordSeasonChange,
  setSetting,
} from "./db.js";
import { broadcast } from "./hub.js";
import { currentTick } from "./tickState.js";

const ORDER: Season[] = ["spring", "summer", "autumn", "winter"];

const DAYLIGHT: Record<Season, { sunrise: number; sunset: number; noonElevation: number }> = {
  spring: { sunrise: 6.2, sunset: 18.4, noonElevation: 1.02 },
  summer: { sunrise: 5.2, sunset: 20.3, noonElevation: 1.22 },
  autumn: { sunrise: 6.7, sunset: 17.5, noonElevation: 0.68 },
  winter: { sunrise: 7.5, sunset: 16.9, noonElevation: 0.4 },
};

type Calendar = {
  season: Season;
  nextSeason: Season;
  blend: number;
};

export function nextSeason(season: Season): Season {
  return ORDER[(ORDER.indexOf(season) + 1) % ORDER.length] ?? "summer";
}

function hemisphere(): "north" | "south" {
  return process.env.SEASON_HEMISPHERE === "north" ? "north" : "south";
}

function mode(): "real" | "accelerated" {
  return seasonMode();
}

function seasonLengthDays(): number {
  const value = Number(process.env.SEASON_LENGTH_DAYS);
  return Number.isFinite(value) && value > 0 ? value : 3;
}

function blendFor(progress: number): number {
  if (progress <= 0.92) return 0;
  return Math.min(1, (progress - 0.92) / 0.08);
}

function realCalendar(now: Date): Calendar {
  const zone = readClockConfig().zone;
  const dt = DateTime.fromJSDate(now, { zone });
  const monthIndex = dt.month - 1;
  const hemi = hemisphere();
  const months = seasonMonths(hemi);
  const season = seasonForMonth(monthIndex, hemi);
  const startMonth =
    season === "summer" && hemi === "south"
      ? 11
      : season === "winter" && hemi === "north"
        ? 11
        : months.findIndex((name) => name === season);
  let startYear = dt.year;
  if (startMonth === 11 && monthIndex < 6) startYear -= 1;
  const start = DateTime.fromObject({ year: startYear, month: startMonth + 1, day: 1 }, { zone });
  const end = start.plus({ months: 3 });
  const span = end.toMillis() - start.toMillis();
  const progress = span > 0 ? (dt.toMillis() - start.toMillis()) / span : 0;
  return { season, nextSeason: nextSeason(season), blend: blendFor(progress) };
}

function acceleratedCalendar(now: Date): Calendar {
  const length = seasonLengthDays();
  const days = (now.getTime() - Date.UTC(2024, 0, 1)) / 86_400_000;
  const index = Math.floor(days / length);
  const progress = days / length - index;
  const order = hemisphere() === "north"
    ? (["winter", "spring", "summer", "autumn"] as const)
    : (["summer", "autumn", "winter", "spring"] as const);
  const slot = ((index % 4) + 4) % 4;
  const season = order[slot] ?? "summer";
  const next = order[(slot + 1) % 4] ?? nextSeason(season);
  return { season, nextSeason: next, blend: blendFor(progress) };
}

export function calendarSeason(now = new Date()): Calendar {
  return mode() === "accelerated" ? acceleratedCalendar(now) : realCalendar(now);
}

function previewSetting(): SeasonPreview {
  return "auto";
}

function daylight(season: Season, next: Season, blend: number) {
  const from = DAYLIGHT[season];
  const to = DAYLIGHT[next];
  return {
    sunrise: from.sunrise + (to.sunrise - from.sunrise) * blend,
    sunset: from.sunset + (to.sunset - from.sunset) * blend,
    noonElevation: from.noonElevation + (to.noonElevation - from.noonElevation) * blend,
  };
}

function lightFrom(season: Season, next: Season, blend: number, clock: ReturnType<typeof villageClock>): SunMarks {
  if (clock.validSun) return clock;
  const table = daylight(season, next, blend);
  const marks: SunMarks = {
    dawn: table.sunrise - 0.45,
    sunrise: table.sunrise,
    solarNoon: (table.sunrise + table.sunset) / 2,
    sunset: table.sunset,
    dusk: table.sunset + 0.45,
    noonElevation: table.noonElevation,
    validSun: false,
  };
  return marks;
}

/** The season and clock the world is showing. A future tick can read this. */
export function currentWorldState(now = new Date()): WorldState {
  const clock = villageClock(now);
  const calendar = calendarSeason(now);
  const preview = previewSetting();
  const season = preview === "auto" ? calendar.season : preview;
  const next = preview === "auto" ? calendar.nextSeason : nextSeason(season);
  const blend = preview === "auto" ? calendar.blend : 0;
  const light = lightFrom(season, next, blend, clock);
  return {
    season,
    nextSeason: next,
    blend,
    timeOfDay: clock.timeOfDay,
    sunrise: light.sunrise,
    sunset: light.sunset,
    noonElevation: light.noonElevation,
    date: clock.date,
    time: clock.time,
    period: clock.validSun ? clock.period : periodAt(clock.hours, light),
    zone: clock.zone,
    zoneName: clock.zoneName,
    preview,
    sampledAt: now.toISOString(),
  };
}

export function setSeasonPreview(_season: SeasonPreview): void {
  setSetting("season_preview", "auto");
  publishWorldState(true);
}

let timer: NodeJS.Timeout | undefined;
let lastKey = "";

function stateKey(state: WorldState): string {
  const minute = Math.floor(state.timeOfDay * 24 * 30);
  return [
    state.season,
    state.nextSeason,
    state.preview,
    state.blend.toFixed(2),
    state.sunrise.toFixed(2),
    state.sunset.toFixed(2),
    minute,
  ].join("|");
}

function publishWorldState(force = false): void {
  const calendar = calendarSeason();
  const recorded = lastRecordedSeason();
  if (recorded !== calendar.season) {
    const event = recordSeasonChange(recorded, calendar.season, Math.max(0, currentTick()));
    broadcast({ type: "event", event });
    console.log(`Season changed to ${calendar.season}.`);
  }
  const state = currentWorldState();
  const key = stateKey(state);
  if (!force && key === lastKey) return;
  lastKey = key;
  broadcast({ type: "world_state", state });
}

export function startSeasonClock(): void {
  if (getSetting("season_preview") !== "auto") setSetting("season_preview", "auto");
  publishWorldState(true);
  timer = setInterval(() => publishWorldState(false), 10_000);
  const clock = villageClock();
  console.log(
    `Seasons: ${mode()}, hemisphere ${hemisphere()}${mode() === "accelerated" ? `, every ${seasonLengthDays()} days` : ""}. Village clock ${clock.zone} (${clock.zoneName}). Sunrise ${formatClockHours(clock.sunrise)}, sunset ${formatClockHours(clock.sunset)}.`,
  );
}

export function stopSeasonClock(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
