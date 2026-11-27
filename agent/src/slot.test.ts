import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { similarity } from "./duplicates.js";

test("a slot that already started is not run again after a restart", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pips-slot-"));
  process.env.DATA_DIR = dir;
  const db = await import("./db.js");
  db.openDatabase();
  const slot = "2026-11-27 22:30";
  assert.equal(db.claimSlot(slot), "claimed");
  db.closeDatabase();
  db.openDatabase();
  assert.equal(db.claimSlot(slot), "running");
  assert.equal(db.slotStatus(slot), "running");
  db.finishSlot(slot, "done");
  assert.equal(db.claimSlot(slot), "done");
  db.closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("near-duplicate diary, notes, studies, creations, and builds are rejected once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pips-dup-"));
  process.env.DATA_DIR = dir;
  const db = await import("./db.js");
  const growth = await import("./growth.js");
  const creations = await import("./creations.js");
  const build = await import("./build.js");
  const tools = await import("./tools.js");
  db.openDatabase();
  try {
    const first = "I watched the light move across the path and wrote down the colour of the leaves.";
    const copy = "I watched the light move across the path and wrote down the colour of the leaves.";
    assert.ok(similarity(first, copy) >= 0.85);
    const flags = { wroteDiary: false, wroteJournal: false, webCalls: 0, diaryAsked: false };
    db.saveEvents([
      db.makeEvent("diary", { entryId: "entry-1", body: first }, 1),
    ]);
    const rejected = await tools.executeTool("write_diary", { text: copy }, 2, flags);
    assert.match(rejected.result, /fresh one/);
    assert.equal(flags.wroteDiary, false);
    const accepted = await tools.executeTool(
      "write_diary",
      { text: "The second note is about the sound of the gate, which I had not written before." },
      2,
      flags,
    );
    assert.match(accepted.result, /Diary saved/);
    assert.equal(db.listDiary().length, 2);

    const note = growth.saveNote("paper boats", "A wide base keeps a paper boat above the water.", "");
    assert.match(note.result, /Note saved/);
    const again = growth.saveNote("paper boats", "A wide base keeps a paper boat above the water.", "");
    assert.match(again.result, /already says this/);
    assert.equal(db.countNotes(), 1);

    const study = growth.startStudy("paper boats", "I want to see how they float.", 4);
    assert.match(study.result, /is open/);
    const repeatStudy = growth.startStudy("paper boats", "The same question again.", 4);
    assert.match(repeatStudy.result, /already covers/);
    assert.equal(db.listStudies().length, 1);

    const made = creations.saveCreation({
      type: "writing",
      title: "Boat note",
      files: { "note.md": "first" },
      notes: "How a paper boat sits on water.",
      inspiredBy: "",
      tick: 3,
    });
    assert.match(made.result, /is started/);
    const twin = creations.saveCreation({
      type: "writing",
      title: "Boat note",
      files: { "note.md": "same" },
      notes: "How a paper boat sits on water.",
      inspiredBy: "",
      tick: 4,
    });
    assert.match(twin.result, /already has this/);
    assert.equal(db.listCreationRows().length, 1);

    const placed = build.runBuild({ action: "add", type: "bench", x: 1, z: 1 }, 5);
    assert.match(placed.result, /Placed/);
    const placedAgain = build.runBuild({ action: "add", type: "bench", x: 1.2, z: 1.1 }, 6);
    assert.match(placedAgain.result, /already there/);
    assert.equal(db.listWorldObjects().filter((object) => object.createdBy === "pip" && object.type === "bench").length, 1);

    const proposal = await tools.executeTool(
      "propose_expansion",
      { plot: "1,1", reason: "Somewhere quiet to sit and listen." },
      7,
      flags,
    );
    assert.match(proposal.result, /Filed/);
    const proposalAgain = await tools.executeTool(
      "propose_expansion",
      { plot: "1,1", reason: "The same quiet spot." },
      8,
      flags,
    );
    assert.match(proposalAgain.result, /already covers/);
    assert.equal(db.listRequests().length, 1);
  } finally {
    db.closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
