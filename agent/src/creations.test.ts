import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { galleryPicks, type CreationView } from "@pips/shared";

function view(id: string, status: CreationView["status"], updatedAt: string, favourite = false): CreationView {
  return {
    id,
    type: "art",
    title: id,
    description: "",
    pipNotes: "",
    status,
    season: "spring",
    createdAt: updatedAt,
    updatedAt,
    favourite,
    archived: false,
    inspiredBy: "",
    diaryIds: [],
    domains: [],
    versions: [],
  };
}

test("the gallery shows starred and newest finished work, and at most 40", () => {
  const items = [
    view("old", "finished", "2026-01-01T00:00:00.000Z"),
    view("new", "finished", "2026-06-01T00:00:00.000Z"),
    view("star", "published", "2026-02-01T00:00:00.000Z", true),
    view("draft", "draft", "2026-07-01T00:00:00.000Z", true),
  ];
  for (let index = 0; index < 45; index += 1) {
    items.push(view(`n${index}`, "finished", `2026-03-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`));
  }
  const picks = galleryPicks(items);
  assert.equal(picks.length, 40);
  assert.equal(picks[0]?.id, "star");
  assert.equal(picks.some((item) => item.id === "draft"), false);
  assert.equal(picks.some((item) => item.id === "new"), true);
});

test("a creation can gain a version, finish, and be archived without deleting its files", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pips-creations-"));
  process.env.DATA_DIR = dir;
  const db = await import("./db.js");
  const creations = await import("./creations.js");
  db.openDatabase();
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#88aa66"/></svg>`;
    const started = creations.saveCreation({
      type: "art",
      title: "Sample sketch",
      files: { "sketch.svg": svg },
      notes: "A first mark.",
      inspiredBy: "https://example.com/windows",
      tick: 3,
    });
    assert.match(started.result, /is started/);
    assert.equal(started.events[0]?.kind, "creation_started");
    const id = started.events[0]?.kind === "creation_started" ? started.events[0].payload.creationId : "";
    const again = creations.saveCreation({
      type: "art",
      title: "Sample sketch",
      files: { "sketch.svg": svg.replace("#88aa66", "#355c7d") },
      notes: "A second pass.",
      inspiredBy: "",
      tick: 4,
    });
    assert.match(again.result, /version 2/);
    assert.match(creations.openCreation(id), /second pass/);
    assert.match(creations.openCreation(id), /example.com/);
    const finished = creations.finishCreation(id, 4);
    assert.equal(finished.events[0]?.kind, "creation_finished");
    const folder = path.join(dir, "creations", id, "v1", "sketch.svg");
    assert.equal(fs.existsSync(folder), true);
    assert.equal(creations.archiveCreation(id), null);
    assert.equal(fs.existsSync(folder), true);
    assert.equal(creations.libraryView().items.find((item) => item.id === id)?.archived, true);
    assert.equal(galleryPicks(creations.libraryView().items).some((item) => item.id === id), false);
    process.env.CREATION_MAX_MB = String(40 / (1024 * 1024));
    const { loadRuntimeConfig } = await import("./runtimeConfig.js");
    loadRuntimeConfig();
    const tooBig = creations.saveCreation({
      type: "writing",
      title: "Too big",
      files: { "note.md": "x".repeat(80) },
      notes: "",
      inspiredBy: "",
      tick: 5,
    });
    assert.match(tooBig.result, /size limit/);
    assert.equal(creations.publicPage(), null);
    creations.publishCreation(id);
    process.env.CREATIONS_PUBLIC = "1";
    const { loadRuntimeConfig: reloadPublic } = await import("./runtimeConfig.js");
    reloadPublic();
    const page = creations.publicPage() ?? "";
    assert.equal(page.includes("Sample sketch"), false);
    const other = creations.saveCreation({
      type: "writing",
      title: "A page",
      files: { "page.md": "hello" },
      notes: "words",
      inspiredBy: "",
      tick: 6,
    });
    const writingId = other.events[0]?.kind === "creation_started" ? other.events[0].payload.creationId : "";
    creations.finishCreation(writingId, 6);
    creations.publishCreation(writingId);
    assert.match(creations.publicPage() ?? "", /A page/);
    assert.equal((creations.publicPage() ?? "").includes("Sample sketch"), false);
    const zip = creations.zipVersion(writingId, 1);
    assert.ok(zip && zip.length > 30);
  } finally {
    delete process.env.CREATION_MAX_MB;
    delete process.env.CREATIONS_PUBLIC;
    const { loadRuntimeConfig: restoreConfig } = await import("./runtimeConfig.js");
    restoreConfig();
    db.closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
  }
});
