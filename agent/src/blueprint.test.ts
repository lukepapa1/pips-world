import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { STARTER_BLUEPRINTS, liveSpec, resolveSpec, validateBlueprint, type BlueprintRecord } from "@pips/shared";

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../shared/blueprint.schema.json");

function primitive(overrides: Record<string, unknown> = {}) {
  return {
    shape: "box",
    size: [0.4, 0.4, 0.4],
    position: [0, 0.2, 0],
    rotation: [0, 0, 0],
    colour: "#88aa66",
    ...overrides,
  };
}

test("schema allows only the four primitives and at most 60", () => {
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8")) as {
    properties: { primitives: { maxItems: number } };
    $defs: { primitive: { properties: { shape: { enum: string[] } } } };
  };
  assert.equal(schema.properties.primitives.maxItems, 60);
  assert.deepEqual(schema.$defs.primitive.properties.shape.enum, ["box", "cylinder", "cone", "sphere"]);
});

test("starter blueprints are valid data", () => {
  assert.equal(STARTER_BLUEPRINTS.length, 10);
  for (const item of STARTER_BLUEPRINTS) {
    const checked = validateBlueprint(item.spec);
    assert.equal("error" in checked, false, `${item.name} ${"error" in checked ? checked.error : ""}`);
  }
});

function errorOf(value: unknown): string {
  const checked = validateBlueprint(value);
  return "error" in checked ? checked.error : "";
}

test("validator rejects code, unknown shapes, overflow, and bad colour", () => {
  assert.match(errorOf("function(){}"), /JSON object/);
  assert.match(errorOf({ primitives: [primitive({ shape: "mesh" })] }), /shape/);
  assert.match(errorOf({ primitives: [primitive({ colour: "green" })] }), /colour/);
  assert.match(errorOf({ primitives: [primitive()], script: "alert(1)" }), /Unknown field/);
  const many = { primitives: Array.from({ length: 61 }, () => primitive()) };
  assert.match(errorOf(many), /60/);
  assert.match(errorOf({ primitives: [primitive({ size: [9, 0.2, 0.2] })] }), /size/);
});

test("height scales the tree and canopy_layers hides the upper cone", () => {
  const spec = {
    behaviour: "sway" as const,
    parameters: { height: 2, canopy_layers: 1 },
    primitives: [
      primitive({ shape: "cylinder", size: [0.2, 1, 0.2], position: [0, 0.5, 0], colour: "#6d4c34" }),
      primitive({ shape: "cone", size: [0.8, 0.8, 0.8], position: [0, 1.6, 0], colour: "#2f5a34", foliage: true, layer: 2 }),
    ],
  };
  const checked = validateBlueprint(spec);
  assert.ok("spec" in checked);
  const resolved = resolveSpec(checked.spec);
  assert.equal(resolved.primitives.length, 1);
  assert.equal(resolved.primitives[0]?.size[1], 2);
  assert.equal(resolved.primitives[0]?.position[1], 1);
});

test("live version is the highest live row, not a newer draft", () => {
  const spec = STARTER_BLUEPRINTS[0]?.spec;
  assert.ok(spec);
  const records: BlueprintRecord[] = [
    { name: "tree", version: 1, spec, status: "live", createdBy: "world", createdAt: "2020-01-01T00:00:00.000Z" },
    { name: "tree", version: 2, spec, status: "pending", createdBy: "pip", createdAt: "2026-11-27T00:00:00.000Z" },
  ];
  assert.equal(liveSpec(records, "tree")?.version, 1);
});

test("publishing, approval, and rollback keep one live version", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pips-blueprints-"));
  process.env.DATA_DIR = dir;
  const db = await import("./db.js");
  const blueprints = await import("./blueprints.js");
  db.openDatabase();
  try {
    const seeded = db.liveBlueprint("tree");
    assert.equal(seeded?.version, 1);
    assert.equal(seeded?.status, "live");
    const objects = db.listWorldObjects().filter((object) => object.type === "tree");
    assert.ok(objects.length > 0);
    assert.equal(objects[0]?.blueprint, "tree");

    process.env.BLUEPRINT_APPROVAL = "1";
    const { loadRuntimeConfig } = await import("./runtimeConfig.js");
    loadRuntimeConfig();
    const waiting = blueprints.designBlueprint("tree", { ...seeded?.spec, parameters: { height: 1.2, canopy_layers: 1 } }, 1);
    assert.match(waiting.result, /waiting/);
    assert.equal(db.liveBlueprint("tree")?.version, 1);
    assert.equal(db.latestBlueprint("tree")?.status, "pending");

    const approved = blueprints.approveBlueprint("tree", 2, 1);
    assert.equal(approved, null);
    assert.equal(db.liveBlueprint("tree")?.version, 2);

    const rolled = blueprints.rollbackBlueprint("tree", 1, 1);
    assert.equal(rolled, null);
    assert.equal(db.liveBlueprint("tree")?.version, 1);
    assert.equal(db.blueprintNamed("tree", 2)?.status, "archived");

    const houses = blueprints.designBlueprint("home", seeded?.spec, 1);
    assert.match(houses.result, /houses/);
  } finally {
    db.closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.BLUEPRINT_APPROVAL;
    const { loadRuntimeConfig: restoreConfig } = await import("./runtimeConfig.js");
    restoreConfig();
  }
});
