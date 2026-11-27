import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DateTime } from "luxon";
import { validate } from "node-cron";
import { daySlots, decideTick, intervalMinutes, paceCron, slotsInDay } from "./growth.js";

const ZONE = "Australia/Melbourne";

function parts(isoUtc: string): { hour: number; minute: number } {
  const dt = DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(ZONE);
  return { hour: dt.hour, minute: dt.minute };
}

test("calm, active, and fast split an awake day into even slots", () => {
  assert.equal(intervalMinutes("calm"), 60);
  assert.equal(intervalMinutes("active"), 30);
  assert.equal(intervalMinutes("fast"), 15);
  assert.equal(slotsInDay(7, 23, "calm"), 16);
  assert.equal(slotsInDay(7, 23, "active"), 32);
  assert.equal(slotsInDay(7, 23, "fast"), 64);
  assert.equal(daySlots(7, 23, "calm")[0]?.time, "07:00");
  assert.equal(daySlots(7, 23, "calm")[0]?.morning, true);
  assert.equal(daySlots(7, 23, "calm").at(-1)?.time, "22:00");
  assert.equal(daySlots(7, 23, "fast").at(-1)?.time, "22:45");
  assert.equal(validate(paceCron("calm")), true);
  assert.equal(validate(paceCron("active")), true);
  assert.equal(validate(paceCron("fast")), true);
});

test("27 November 2026 in Melbourne sleeps outside 07:00–23:00 and wakes with a short tick", () => {
  const morning = parts("2026-11-26T20:00:00.000Z");
  const before = parts("2026-11-26T19:30:00.000Z");
  const evening = parts("2026-11-27T11:00:00.000Z");
  const lateFast = parts("2026-11-27T11:45:00.000Z");
  const asleep = parts("2026-11-27T12:00:00.000Z");
  assert.deepEqual(morning, { hour: 7, minute: 0 });
  assert.equal(decideTick(before.hour, before.minute, "calm", 7, 23, 0, 500).action, "sleep");
  const wake = decideTick(morning.hour, morning.minute, "calm", 7, 23, 0, 500);
  assert.equal(wake.action, "run");
  assert.equal(wake.morning, true);
  assert.equal(wake.slotsToday, 16);
  assert.equal(wake.callShare, 31);
  assert.equal(decideTick(evening.hour, evening.minute, "calm", 7, 23, 0, 500).action, "run");
  assert.equal(decideTick(lateFast.hour, lateFast.minute, "fast", 7, 23, 0, 500).action, "run");
  assert.equal(decideTick(asleep.hour, asleep.minute, "fast", 7, 23, 0, 500).action, "sleep");
});

test("a tick is skipped when its share of the daily call cap is zero", () => {
  const blocked = decideTick(8, 0, "fast", 7, 23, 500, 500);
  assert.equal(blocked.action, "skip");
  const tightMorning = decideTick(7, 0, "fast", 7, 23, 499, 500);
  assert.equal(tightMorning.action, "run");
  assert.equal(tightMorning.callShare, 1);
  const later = decideTick(8, 0, "fast", 7, 23, 499, 500);
  assert.equal(later.action, "skip");
  assert.equal(decideTick(7, 0, "fast", 7, 23, 0, 500).callShare, 7);
  assert.equal(decideTick(7, 0, "active", 7, 23, 0, 500).callShare, 15);
});

test("studies, notes, and the page-read cap", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pips-growth-"));
  process.env.DATA_DIR = dir;
  const db = await import("./db.js");
  const growth = await import("./growth.js");
  db.openDatabase();
  try {
    assert.equal(growth.startStudy("boats", "I want to know why they float.", 4).result.includes("is open"), true);
    assert.equal(growth.startStudy("paper", "Another question.", 2).result.includes("2 of 2"), true);
    assert.match(growth.startStudy("third", "Too many.", 1).result, /Two studies/);
    const open = db.listStudies().find((row) => row.topic === "boats");
    assert.ok(open);
    assert.match(growth.continueStudy(open.id, "A wide base helps.").result, /1 ticks noted/);
    assert.match(growth.endStudy(open.id, "I might come back to this.").result, /closed/);
    assert.equal(db.listStudies().find((row) => row.id === open.id)?.status, "done");

    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    db.insertNote({
      id: "oldnote",
      topic: "boats",
      body: "A paper boat can float.",
      sources: "a page I read",
      createdAt: old,
      touchedAt: old,
      promptedAt: null,
    });
    const first = growth.growthContext(false);
    assert.match(first, /quiet for 7 days/);
    assert.match(first, /paper boat/);
    const second = growth.growthContext(false);
    assert.equal(second.includes("quiet for 7 days"), false);
    assert.match(growth.searchNotes("boat").result, /paper boat/);
    assert.equal((await import("./usage.js")).readCap(), 200);
  } finally {
    db.closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  }
});
