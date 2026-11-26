import { DateTime, Settings } from "luxon";
import { getPosition, getTimes } from "suncalc";
import type { DayPeriod, Season } from "@pips/shared";

export const DEFAULT_ZONE = "Australia/Melbourne";
export const DEFAULT_LAT = -37.8136;
export const DEFAULT_LON = 144.9631;

const SOUTH: readonly Season[] = [
  "summer",
  "summer",
  "autumn",
  "autumn",
  "autumn",
  "winter",
  "winter",
  "winter",
  "spring",
  "spring",
  "spring",
  "summer",
];

const NORTH: readonly Season[] = [
  "winter",
  "winter",
  "spring",
  "spring",
  "spring",
  "summer",
  "summer",
  "summer",
  "autumn",
  "autumn",
  "autumn",
  "winter",
];

export type ClockConfig = {
  zone: string;
  lat: number;
  lon: number;
  dayStartHour: number;
  digestHour: number;
  hemisphere: "north" | "south";
};

export type SunMarks = {
  dawn: number;
  sunrise: number;
  solarNoon: number;
  sunset: number;
  dusk: number;
  noonElevation: number;
  validSun: boolean;
};

export type VillageClock = SunMarks & {
  date: string;
  time: string;
  hours: number;
  timeOfDay: number;
  period: DayPeriod;
  ownerDate: string;
  zone: string;
  zoneName: string;
};

function zoneIsValid(zone: string): boolean {
  return DateTime.now().setZone(zone).isValid;
}

function hourSetting(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return fallback;
  return parsed;
}

function coordSetting(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function readClockConfig(env: NodeJS.ProcessEnv = process.env): ClockConfig {
  const requested = env.OWNER_TIMEZONE?.trim() || DEFAULT_ZONE;
  return {
    zone: zoneIsValid(requested) ? requested : DEFAULT_ZONE,
    lat: coordSetting(env.WORLD_LAT, DEFAULT_LAT, -90, 90),
    lon: coordSetting(env.WORLD_LON, DEFAULT_LON, -180, 180),
    dayStartHour: hourSetting(env.DAY_START_HOUR, 4),
    digestHour: hourSetting(env.DIGEST_HOUR, 20),
    hemisphere: env.SEASON_HEMISPHERE === "north" ? "north" : "south",
  };
}

export function seasonMode(env: NodeJS.ProcessEnv = process.env): "real" | "accelerated" {
  return env.SEASON_MODE === "accelerated" ? "accelerated" : "real";
}

/** Sets the process zone. Server logic still passes the IANA name into luxon. */
export function applyOwnerTimezone(): string {
  const requested = process.env.OWNER_TIMEZONE?.trim() ?? "";
  const zone = readClockConfig().zone;
  if (requested && zone !== requested) {
    console.warn(`OWNER_TIMEZONE "${requested}" is not a known IANA zone. Using ${zone}.`);
  }
  process.env.TZ = zone;
  Settings.defaultZone = zone;
  return zone;
}

export function seasonMonths(hemisphere: "north" | "south"): readonly Season[] {
  return hemisphere === "north" ? NORTH : SOUTH;
}

export function seasonForMonth(monthIndex: number, hemisphere: "north" | "south"): Season {
  return seasonMonths(hemisphere)[monthIndex] ?? "spring";
}

export function periodAt(hours: number, marks: SunMarks): DayPeriod {
  const h = ((hours % 24) + 24) % 24;
  if (marks.sunset >= 24 && marks.sunrise <= 0) {
    return h < marks.solarNoon ? "morning" : "afternoon";
  }
  if (marks.sunrise === marks.sunset) return "night";
  if (h >= marks.dawn && h < marks.sunrise) return "dawn";
  if (h >= marks.sunrise && h < marks.solarNoon) return "morning";
  if (h >= marks.solarNoon && h < marks.sunset) return "afternoon";
  if (h >= marks.sunset && h < marks.dusk) return "dusk";
  return "night";
}

function localHours(date: Date | null | undefined, zone: string): number | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const local = DateTime.fromJSDate(date, { zone });
  if (!local.isValid) return null;
  return local.hour + local.minute / 60 + local.second / 3600 + local.millisecond / 3_600_000;
}

function shortZoneName(instant: Date, zone: string): string {
  try {
    const name = new Intl.DateTimeFormat("en-AU", {
      timeZone: zone,
      timeZoneName: "short",
    })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value;
    if (name) return name;
  } catch {
    // The zone was checked before this call.
  }
  return DateTime.fromJSDate(instant, { zone }).toFormat("ZZZZ");
}

/** Sun times for the civil day of `instant` in the owner zone. Elevation is radians. */
export function sunMarks(instant: Date, config: ClockConfig = readClockConfig()): SunMarks {
  const dt = DateTime.fromJSDate(instant, { zone: config.zone });
  const noon = DateTime.fromObject(
    { year: dt.year, month: dt.month, day: dt.day, hour: 12 },
    { zone: config.zone },
  );
  const times = getTimes(noon.toJSDate(), config.lat, config.lon, 0, noon.offset);
  const sunrise = localHours(times.sunrise, config.zone);
  const sunset = localHours(times.sunset, config.zone);
  const solarNoon = localHours(times.solarNoon, config.zone) ?? 12;
  const altitude = getPosition(times.solarNoon, config.lat, config.lon).altitude;
  const noonElevation = (altitude * Math.PI) / 180;
  if (times.alwaysUp) {
    return { dawn: 0, sunrise: 0, solarNoon, sunset: 24, dusk: 24, noonElevation, validSun: true };
  }
  if (times.alwaysDown || sunrise === null || sunset === null) {
    return {
      dawn: 12,
      sunrise: 12,
      solarNoon: 12,
      sunset: 12,
      dusk: 12,
      noonElevation: times.alwaysDown ? noonElevation : 0,
      validSun: false,
    };
  }
  return {
    dawn: localHours(times.dawn, config.zone) ?? sunrise - 0.45,
    sunrise,
    solarNoon,
    sunset,
    dusk: localHours(times.dusk, config.zone) ?? sunset + 0.45,
    noonElevation,
    validSun: true,
  };
}

export function ownerDate(instant: Date, config: ClockConfig = readClockConfig()): string {
  let dt = DateTime.fromJSDate(instant, { zone: config.zone });
  if (dt.hour < config.dayStartHour) dt = dt.minus({ days: 1 });
  return dt.toISODate() ?? "";
}

export function villageClock(instant = new Date(), config: ClockConfig = readClockConfig()): VillageClock {
  const dt = DateTime.fromJSDate(instant, { zone: config.zone });
  const marks = sunMarks(instant, config);
  const hours = dt.hour + dt.minute / 60 + dt.second / 3600 + dt.millisecond / 3_600_000;
  return {
    ...marks,
    date: dt.toISODate() ?? "",
    time: dt.toFormat("HH:mm"),
    hours,
    timeOfDay: hours / 24,
    period: periodAt(hours, marks),
    ownerDate: ownerDate(instant, config),
    zone: config.zone,
    zoneName: shortZoneName(instant, config.zone),
  };
}

export function dateLabel(isoDate: string, zone: string): string {
  const dt = DateTime.fromISO(isoDate, { zone });
  if (!dt.isValid) return isoDate;
  return dt.toFormat("cccc d LLLL yyyy");
}

export function formatClockHours(hours: number): string {
  const wrapped = ((hours % 24) + 24) % 24;
  let hour = Math.floor(wrapped);
  let minute = Math.round((wrapped - hour) * 60);
  if (minute === 60) {
    hour = (hour + 1) % 24;
    minute = 0;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function sinceLastTick(at: string | null, now = new Date()): string {
  if (!at) return "There has not been a tick yet.";
  const then = Date.parse(at);
  if (Number.isNaN(then)) return "There has not been a tick yet.";
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60_000));
  if (minutes < 1) return "The last tick was under a minute ago.";
  if (minutes < 60) return `The last tick was ${minutes} minute${minutes === 1 ? "" : "s"} ago.`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = `${hours} hour${hours === 1 ? "" : "s"}`;
  if (rest === 0) return `The last tick was ${hourLabel} ago.`;
  return `The last tick was ${hourLabel} ${rest} minute${rest === 1 ? "" : "s"} ago.`;
}

/** True once the evening send time has passed, including the late night before the day starts. */
export function shouldSendDigest(instant: Date, config: ClockConfig = readClockConfig()): boolean {
  const dt = DateTime.fromJSDate(instant, { zone: config.zone });
  if (dt.hour < config.dayStartHour) return true;
  return dt.hour >= config.digestHour;
}

export function isWeeklySlot(instant: Date, config: ClockConfig = readClockConfig()): boolean {
  const dt = DateTime.fromJSDate(instant, { zone: config.zone });
  return dt.weekday === 7 && dt.hour === config.digestHour && dt.minute === 0;
}

export function dayBoundaryCron(hour: number): string {
  return `0 ${hour} * * *`;
}

export function digestCron(hour: number): string {
  return `0 ${hour} * * *`;
}

export function weeklyCron(hour: number): string {
  return `0 ${hour} * * 0`;
}
