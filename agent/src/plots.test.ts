import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { terrainSample, type Terrain } from "@pips/shared";

test("neighbouring plots share a height at the edge", () => {
  const types = new Map<string, Terrain>([
    ["0,0", "meadow"],
    ["1,0", "hills"],
  ]);
  const typeOf = (gridX: number, gridZ: number) => types.get(`${gridX},${gridZ}`) ?? null;
  const left = terrainSample(12, 0, typeOf);
  const right = terrainSample(12, 0, typeOf);
  assert.equal(left.height, right.height);
  const insideMeadow = terrainSample(0, 0, typeOf);
  const insideHills = terrainSample(24, 0, typeOf);
  const edge = left.height;
  const low = Math.min(insideMeadow.height, insideHills.height) - 0.2;
  const high = Math.max(insideMeadow.height, insideHills.height) + 0.2;
  assert.ok(edge >= low && edge <= high);
});

test("a plot opens only beside open land, once a week, and a reset keeps the village", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pips-plots-"));
  process.env.DATA_DIR = dir;
  process.env.EXPANSION_PER_WEEK = "1";
  process.env.MAX_PLOTS = "16";
  const db = await import("./db.js");
  const tools = await import("./tools.js");
  const plots = await import("./plots.js");
  const build = await import("./build.js");
  db.openDatabase();
  try {
    const seeded = db.listPlots();
    assert.equal(seeded.filter((plot) => plot.status === "unlocked").length, 5);
    assert.ok(seeded.some((plot) => plot.status === "mist"));

    const flags = { wroteDiary: false, wroteJournal: false, webCalls: 0, diaryAsked: false };
    const far = await tools.executeTool("propose_expansion", { plot: "3,0", reason: "Too far." }, 1, flags);
    assert.match(far.result, /not waiting/);

    const proposal = await tools.executeTool(
      "propose_expansion",
      { plot: "1,1", reason: "I want to hear what the trees do." },
      2,
      flags,
    );
    assert.match(proposal.result, /Filed/);
    const request = db.listRequests().find((row) => row.title.startsWith("Explore"));
    assert.ok(request);
    assert.equal(plots.expansionBlock(request.id, "approved"), null);
    const decision = db.decideRequest(request.id, "approved", 3);
    assert.ok(decision);
    const opened = plots.applyExpansionDecision(request.id, "approved", 3);
    assert.equal(opened?.kind, "plot");
    if (opened?.kind === "plot") assert.equal(opened.payload.action, "unlocked");
    const land = db.listPlots().find((plot) => plot.gridX === 1 && plot.gridZ === 1);
    assert.equal(land?.status, "unlocked");

    const mist = await build.runBuild({ action: "add", type: "bench", x: 40, z: 0 }, 4);
    assert.match(mist.result, /not on open land/);
    const home = await build.runBuild({ action: "add", type: "bench", x: 1, z: 1 }, 5);
    assert.match(home.result, /Placed/);

    const again = await tools.executeTool(
      "propose_expansion",
      { plot: "2,0", reason: "Further along." },
      6,
      flags,
    );
    assert.match(again.result, /week/);

    const walk = await tools.executeTool("explore", { plot: "1,1" }, 7, flags);
    assert.match(walk.result, /Walking/);

    db.resetLaunchPlots();
    const restored = db.listPlots();
    assert.equal(restored.filter((plot) => plot.status === "unlocked").length, 5);
    assert.equal(restored.find((plot) => plot.gridX === 1 && plot.gridZ === 1)?.status, "mist");
    assert.equal(db.listWorldObjects().some((object) => object.x === 40), false);
  } finally {
    db.closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
