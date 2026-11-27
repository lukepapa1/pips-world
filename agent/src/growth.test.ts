import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DateTime } from "luxon";
import { validate } from "node-cron";
import { clockSlot, currentSlotId, daySlots, decideTick, paceCron, slotsInDay, tickInterval } from "./growth.js";
import { loadRuntimeConfig, tickCron } from "./runtimeConfig.js";

const ZONE = "Australia/Melbourne";

function parts(isoUtc: string): { hour: number; minute: number } {
  const dt = DateTime.fromISO(isoUtc, { zone: "utc" }).setZone(ZONE);
  return { hour: dt.hour, minute: dt.minute };
}

test("ticks land on :00 and :30 inside the awake window", () => {
  loadRuntimeConfig();
  assert.equal(tickInterval(), 30);
  assert.equal(tickCron(), "0,30 * * * *");
  assert.equal(paceCron(), "0,30 * * * *");
  assert.equal(validate(paceCron()), true);
  assert.equal(slotsInDay(7, 23, 30), 32);
  const slots = daySlots(7, 23, 30);
  assert.equal(slots[0]?.time, "07:00");
  assert.equal(slots.at(-1)?.time, "22:30");
  assert.equal(slots.every((slot) => slot.time.endsWith(":00") || slot.time.endsWith(":30")), true);
  assert.equal(slots.some((slot) => slot.time.endsWith(":15")), false);
  assert.equal(clockSlot(7, 0, 30), true);
  assert.equal(clockSlot(7, 15, 30), false);
  assert.equal(clockSlot(22, 30, 30), true);
  assert.equal(slotsInDay(0, 24, 30), 48);
});

test("27 November 2026 in Melbourne sleeps outside 07:00–23:00", () => {
  const morning = parts("2026-11-26T20:00:00.000Z");
  const before = parts("2026-11-26T19:30:00.000Z");
  const evening = parts("2026-11-27T11:00:00.000Z");
  const half = parts("2026-11-27T11:30:00.000Z");
  const asleep = parts("2026-11-27T12:00:00.000Z");
  assert.deepEqual(morning, { hour: 7, minute: 0 });
  assert.equal(decideTick(before.hour, before.minute, 30, 7, 23, 0, 500).action, "sleep");
  const wake = decideTick(morning.hour, morning.minute, 30, 7, 23, 0, 500);
  assert.equal(wake.action, "run");
  assert.equal(wake.morning, true);
  assert.equal(wake.slotsToday, 32);
  assert.equal(wake.callShare, 15);
  assert.equal(decideTick(evening.hour, evening.minute, 30, 7, 23, 0, 500).action, "run");
  assert.equal(decideTick(half.hour, half.minute, 30, 7, 23, 0, 500).action, "run");
  assert.equal(decideTick(asleep.hour, asleep.minute, 30, 7, 23, 0, 500).action, "sleep");
  const slot = currentSlotId(new Date("2026-11-27T11:30:00.000Z"));
  assert.equal(slot, "2026-11-27 22:30");
  assert.match(currentSlotId(new Date("2026-11-27T11:14:00.000Z")), /22:00$/);
});

test("a tick is skipped when its share of the daily call cap is zero", () => {
  const blocked = decideTick(8, 0, 30, 7, 23, 500, 500);
  assert.equal(blocked.action, "skip");
  const tightMorning = decideTick(7, 0, 30, 7, 23, 499, 500);
  assert.equal(tightMorning.action, "run");
  assert.equal(tightMorning.callShare, 1);
  const later = decideTick(12, 0, 30, 7, 23, 499, 500);
  assert.equal(later.action, "skip");
  assert.equal(decideTick(7, 0, 30, 7, 23, 0, 500).callShare, 15);
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
