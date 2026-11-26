import assert from "node:assert/strict";
import test from "node:test";
import { DateTime } from "luxon";
import { validate } from "node-cron";
import {
  applyOwnerTimezone,
  dayBoundaryCron,
  digestCron,
  isWeeklySlot,
  ownerDate,
  readClockConfig,
  seasonForMonth,
  seasonMode,
  shouldSendDigest,
  sinceLastTick,
  villageClock,
  weeklyCron,
  type ClockConfig,
} from "./clock.js";

const zone = "Australia/Melbourne";

function melbourne(): ClockConfig {
  return readClockConfig({} as NodeJS.ProcessEnv);
}

function at(year: number, month: number, day: number, hour: number, minute = 0): Date {
  return DateTime.fromObject({ year, month, day, hour, minute }, { zone }).toJSDate();
}

test("defaults to Melbourne and keeps accelerated season behind the switch", () => {
  const config = melbourne();
  assert.equal(config.zone, "Australia/Melbourne");
  assert.equal(config.lat, -37.8136);
  assert.equal(config.lon, 144.9631);
  assert.equal(config.dayStartHour, 4);
  assert.equal(config.digestHour, 20);
  assert.equal(seasonMode({} as NodeJS.ProcessEnv), "real");
  assert.equal(seasonMode({ SEASON_MODE: "accelerated" } as NodeJS.ProcessEnv), "accelerated");
  assert.equal(readClockConfig({ OWNER_TIMEZONE: "Not/AZone" } as NodeJS.ProcessEnv).zone, zone);
});

test("27 November 2026 in Melbourne: dawn, morning, dusk, and midnight", () => {
  const config = melbourne();
  const noon = villageClock(at(2026, 11, 27, 12), config);
  assert.ok(Math.abs(noon.sunrise - (5 + 53 / 60)) < 0.02, `sunrise ${noon.sunrise}`);
  assert.ok(Math.abs(noon.sunset - (20 + 22 / 60)) < 0.02, `sunset ${noon.sunset}`);
  assert.ok(noon.noonElevation > 1 && noon.noonElevation < 1.5, `noon ${noon.noonElevation}`);
  assert.equal(noon.zoneName, "AEDT");
  assert.equal(seasonForMonth(10, "south"), "spring");

  const dawnAt = DateTime.fromObject({ year: 2026, month: 11, day: 27 }, { zone }).plus({
    hours: noon.dawn + 5 / 60,
  });
  assert.equal(villageClock(dawnAt.toJSDate(), config).period, "dawn");

  const duskAt = DateTime.fromObject({ year: 2026, month: 11, day: 27 }, { zone }).plus({
    hours: noon.sunset + 5 / 60,
  });
  assert.equal(villageClock(duskAt.toJSDate(), config).period, "dusk");

  const midnight = villageClock(at(2026, 11, 27, 0, 30), config);
  assert.equal(midnight.period, "night");
  assert.equal(midnight.date, "2026-11-27");
  assert.equal(midnight.ownerDate, "2026-11-26");
  assert.equal(villageClock(at(2026, 11, 27, 9, 29), config).period, "morning");
});

test("the day starts at 04:00 local, so late night belongs to the previous day", () => {
  const config = melbourne();
  assert.equal(ownerDate(at(2026, 11, 27, 3, 30), config), "2026-11-26");
  assert.equal(ownerDate(at(2026, 11, 27, 4, 0), config), "2026-11-27");
  assert.equal(villageClock(at(2026, 11, 27, 3, 30), config).period, "night");
});

test("daylight saving skips the spring gap and repeats the autumn hour", () => {
  const config = melbourne();
  const before = villageClock(new Date("2026-10-03T15:30:00.000Z"), config);
  const after = villageClock(new Date("2026-10-03T16:30:00.000Z"), config);
  assert.equal(before.date, "2026-10-04");
  assert.equal(before.time, "01:30");
  assert.equal(before.zoneName, "AEST");
  assert.equal(before.ownerDate, "2026-10-03");
  assert.equal(after.time, "03:30");
  assert.equal(after.zoneName, "AEDT");
  assert.equal(after.ownerDate, "2026-10-03");
  const gap = DateTime.fromObject({ year: 2026, month: 10, day: 4, hour: 2, minute: 30 }, { zone });
  assert.equal(gap.toFormat("HH:mm"), "03:30");
  assert.equal(gap.offset, 660);

  const first = villageClock(new Date("2026-04-04T15:30:00.000Z"), config);
  const second = villageClock(new Date("2026-04-04T16:30:00.000Z"), config);
  assert.equal(first.date, "2026-04-05");
  assert.equal(second.date, "2026-04-05");
  assert.equal(first.time, "02:30");
  assert.equal(second.time, "02:30");
  assert.equal(first.zoneName, "AEDT");
  assert.equal(second.zoneName, "AEST");
  assert.equal(first.ownerDate, "2026-04-04");
  assert.equal(second.ownerDate, "2026-04-04");
  assert.equal(first.period, "night");
  assert.equal(second.period, "night");
});

test("a UTC instant on 1 March is still summer in February and autumn in Melbourne", () => {
  const config = melbourne();
  const clock = villageClock(new Date("2026-02-28T14:30:00.000Z"), config);
  assert.equal(clock.date, "2026-03-01");
  assert.equal(clock.time, "01:30");
  assert.equal(seasonForMonth(1, "south"), "summer");
  assert.equal(seasonForMonth(2, "south"), "autumn");
});

test("digest waits until 20:00, and the weekly slot is Sunday evening in Melbourne", () => {
  const config = melbourne();
  assert.equal(shouldSendDigest(at(2026, 11, 27, 15), config), false);
  assert.equal(shouldSendDigest(at(2026, 11, 27, 20), config), true);
  assert.equal(shouldSendDigest(at(2026, 11, 27, 3, 30), config), true);
  assert.equal(shouldSendDigest(at(2026, 11, 27, 4), config), false);
  assert.equal(dayBoundaryCron(4), "0 4 * * *");
  assert.equal(digestCron(20), "0 20 * * *");
  assert.equal(weeklyCron(20), "0 20 * * 0");
  assert.equal(validate(dayBoundaryCron(4)), true);
  assert.equal(validate(digestCron(20)), true);
  assert.equal(validate(weeklyCron(20)), true);

  const sunday = DateTime.fromObject({ year: 2026, month: 11, day: 29, hour: 20 }, { zone });
  assert.equal(sunday.weekday, 7);
  assert.equal(isWeeklySlot(sunday.toJSDate(), config), true);
  assert.equal(isWeeklySlot(new Date("2026-11-29T20:00:00.000Z"), config), false);
});

test("time since the last tick is measured from the UTC timestamp", () => {
  const now = new Date("2026-11-27T00:00:00.000Z");
  assert.equal(sinceLastTick(null, now), "There has not been a tick yet.");
  assert.equal(sinceLastTick("2026-11-26T23:18:00.000Z", now), "The last tick was 42 minutes ago.");
  assert.equal(sinceLastTick("2026-11-26T22:00:00.000Z", now), "The last tick was 2 hours ago.");
});

test("applyOwnerTimezone sets the process zone", () => {
  const previous = process.env.TZ;
  const saved = process.env.OWNER_TIMEZONE;
  delete process.env.OWNER_TIMEZONE;
  try {
    assert.equal(applyOwnerTimezone(), zone);
    assert.equal(process.env.TZ, zone);
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
    if (saved === undefined) delete process.env.OWNER_TIMEZONE;
    else process.env.OWNER_TIMEZONE = saved;
  }
});
