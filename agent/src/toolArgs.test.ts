import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const BUILD_RAW = '{"action":"add","type":"garden_bed","x":1,"z":1}';
const DESIGN_RAW =
  '{"spec":{"primitives":[{"type":"box","colour":"gray","size":{"z":0.5,"x":1,"y":0.5},"position":{"x":0,"y":0,"z":0}}]},"name":"stone_seat"}';

const FORBIDDEN = ["$ref", "oneOf", "anyOf", "additionalProperties", "default", "nullable"];

test("tool schemas stay flat and every description has an example", async () => {
  const { PIP_TOOLS } = await import("./tools.js");
  for (const tool of PIP_TOOLS) {
    assert.match(tool.description, /Example:/, tool.name);
    walk(tool.parameters, tool.name);
  }
  const build = PIP_TOOLS.find((tool) => tool.name === "build");
  const design = PIP_TOOLS.find((tool) => tool.name === "design_blueprint");
  const props = (build?.parameters as { properties: Record<string, { type?: string }> }).properties;
  assert.equal(props.x?.type, "number");
  assert.equal(props.z?.type, "number");
  const designProps = (design?.parameters as { properties: Record<string, { type?: string }> }).properties;
  assert.equal(designProps.spec?.type, "object");
  assert.equal(designProps.spec_json?.type, "string");
});

test("build and design accept the shapes the model returned, plus the aliases", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pips-tools-"));
  process.env.DATA_DIR = dir;
  process.env.DAILY_BUILD_CAP = "20";
  delete process.env.BLUEPRINT_APPROVAL;
  const db = await import("./db.js");
  const tools = await import("./tools.js");
  const args = await import("./toolArgs.js");
  const loop = await import("./loop.js");
  db.openDatabase();
  const flags = { wroteDiary: false, wroteJournal: false, webCalls: 0, diaryAsked: false };
  const build = tools.PIP_TOOLS.find((tool) => tool.name === "build");
  const design = tools.PIP_TOOLS.find((tool) => tool.name === "design_blueprint");
  assert.ok(build);
  assert.ok(design);

  const placed = await run(tools, args, build, BUILD_RAW, flags);
  assert.match(placed.result, /Placed a garden bed/);
  console.log(`build: ${placed.result}`);

  const designed = await run(tools, args, design, DESIGN_RAW, flags);
  assert.match(designed.result, /stone_seat version \d+ is live/);
  console.log(`design_blueprint: ${designed.result}`);

  const strings = await run(tools, args, build, { action: "add", type: "bench", x: "-2", z: "-3" }, flags);
  assert.match(strings.result, /Placed a bench/);

  const position = await run(
    tools,
    args,
    build,
    { action: "add", type: "lamp", position: { x: 3, z: 3 } },
    flags,
  );
  assert.match(position.result, /Placed a lamp/);

  const pair = await run(tools, args, build, { action: "add", type: "shelf", position: [2, -4] }, flags);
  assert.match(pair.result, /Placed a shelf/);

  const fenced = [
    "```json",
    '{"primitives":[{"shape":"box","size":[1,0.4,0.5],"position":[0,0.2,0],"rotation":[0,0,0],"colour":"#8d8680",}]}',
    "```",
  ].join("\n");
  const fromJson = await run(tools, args, design, { name: "low_wall", spec_json: fenced }, flags);
  assert.match(fromJson.result, /low_wall version \d+ is live/);

  const missing = args.acceptToolCall(build, { action: "add", type: "garden_bed" });
  assert.ok("error" in missing);
  assert.match(missing.error, /Received/);
  assert.match(missing.error, /x is missing/);
  assert.match(missing.error, /Example: build\(action="add", type="garden_bed", x=1, z=1\)/);

  db.recordToolCall({
    model: "gemini-3.1-flash-lite",
    tool: "build",
    raw: BUILD_RAW,
    parsed: { action: "add", type: "garden_bed", x: 1, z: 1 },
    error: missing.error,
    day: 1,
  });
  assert.equal(db.toolFailureCount(), 1);
  const logged = db.recentToolFailures(10);
  assert.equal(logged[0]?.tool, "build");
  assert.match(logged[0]?.argumentsRaw ?? "", /garden_bed/);
  assert.match(logged[0]?.model ?? "", /gemini-3.1-flash-lite/);

  const reported = await tools.executeTool(
    "report_problem",
    { tool: "build", what_happened: "build failed twice after the example call." },
    1,
    flags,
  );
  assert.match(reported.result, /Filed for the owner: Tool problem: build/);
  const request = db.listRequests().find((row) => row.title === "Tool problem: build");
  assert.ok(request);
  assert.match(request.body, /garden_bed/);
  assert.match(request.body, /build failed twice/);

  const lines = (await import("./status.js")).statusLines();
  assert.ok(lines.some((line) => line.includes("Tool errors: 1")));
  assert.ok(lines.some((line) => line.startsWith("Tool failure build:")));

  const overview = (await import("./overview.js")).overviewPayload(false);
  assert.equal(overview.stats.toolErrors, 1);
  assert.equal(overview.stats.toolFailures.length, 1);

  const notice = loop.toolFixNotice();
  assert.equal(notice, "The build and design tools had a bug that has now been fixed. You can try them again.");
  assert.equal(loop.toolFixNotice(), "");

  db.closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function run(
  tools: typeof import("./tools.js"),
  args: typeof import("./toolArgs.js"),
  spec: import("./llm.js").ToolSpec,
  raw: unknown,
  flags: import("./tools.js").ToolFlags,
) {
  const accepted = args.acceptToolCall(spec, raw);
  assert.equal("error" in accepted, false, "error" in accepted ? accepted.error : "");
  if ("error" in accepted) throw new Error(accepted.error);
  return tools.executeTool(spec.name, accepted.args, 1, flags);
}

function walk(value: unknown, at: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${at}[${index}]`));
    return;
  }
  const row = value as Record<string, unknown>;
  for (const key of FORBIDDEN) {
    assert.equal(key in row, false, `${at} uses ${key}`);
  }
  for (const [key, child] of Object.entries(row)) walk(child, `${at}.${key}`);
}
