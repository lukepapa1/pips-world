import { BUILDINGS, isBlueprintName, resolveSpec, validateBlueprint, WORLD_RADIUS, type BlueprintSpec, type PathPoint } from "@pips/shared";
import { ownerDate } from "./clock.js";
import {
  archiveLiveBlueprint,
  blueprintApprovalRequired,
  blueprintNamed,
  getSetting,
  insertBlueprint,
  latestBlueprint,
  listBlueprints,
  listPaths,
  listWorldObjects,
  liveBlueprint,
  makeEvent,
  saveBlueprintNote,
  saveEvents,
  savePath,
  setBlueprintApproval,
  setBlueprintStatus,
  setSetting,
  updateWorldObject,
} from "./db.js";
import { broadcast } from "./hub.js";
import { captureBlueprint } from "./preview.js";
import type { ToolOutcome } from "./tools.js";

const PREVIEW_CAP = 4;
const PREVIEW_KEY = "blueprint_previews";

const HOUSES = new Set<string>(BUILDINGS);

function publishBlueprints(): void {
  broadcast({
    type: "blueprints",
    blueprints: listBlueprints(),
    blueprintApproval: blueprintApprovalRequired(),
  });
}

function publishPaths(): void {
  broadcast({ type: "paths", paths: listPaths() });
}

function publishObjects(): void {
  broadcast({ type: "world_objects", objects: listWorldObjects() });
}

function logBlueprint(
  action: "design" | "preview" | "rollback" | "approve",
  name: string,
  version: number,
  status: "live" | "pending" | "archived",
  tick: number,
): void {
  const event = makeEvent("blueprint", { action, name, version, status }, tick);
  saveEvents([event]);
  broadcast({ type: "event", event });
}

export function designBlueprint(name: string, raw: unknown, tick: number, why?: string): ToolOutcome {
  const specInput = typeof raw === "string" ? parseJson(raw) : raw;
  if (typeof raw === "string" && specInput === undefined) {
    return { result: "spec must be JSON, not code.", kind: null };
  }
  if (!isBlueprintName(name)) return { result: "Name the blueprint with lowercase letters and underscores.", kind: null };
  if (HOUSES.has(name)) return { result: "The houses already have their own shape.", kind: null };
  const checked = validateBlueprint(specInput);
  if ("error" in checked) return { result: checked.error, kind: null };
  const previous = latestBlueprint(name);
  const version = (previous?.version ?? 0) + 1;
  const approval = blueprintApprovalRequired();
  const status = approval ? "pending" : "live";
  if (!approval) archiveLiveBlueprint(name);
  insertBlueprint(name, version, JSON.stringify(checked.spec), status, "pip", new Date().toISOString());
  const note = typeof why === "string" ? why.trim().slice(0, 500) : "";
  if (note) saveBlueprintNote(name, version, note);
  logBlueprint("design", name, version, status, tick);
  publishBlueprints();
  if (approval) {
    return {
      result: `${name} version ${version} is waiting for approval. The live version is unchanged. You can preview_blueprint to look at it.`,
      kind: "blueprint",
    };
  }
  return {
    result: `${name} version ${version} is live. Every object using ${name} now uses this version.`,
    kind: "blueprint",
  };
}

export function approveBlueprint(name: string, version: number, tick: number): string | null {
  const row = blueprintNamed(name, version);
  if (!row || row.status !== "pending") return "That version is not waiting.";
  archiveLiveBlueprint(name);
  setBlueprintStatus(name, version, "live");
  logBlueprint("approve", name, version, "live", tick);
  publishBlueprints();
  return null;
}

export function rollbackBlueprint(name: string, version: number, tick: number): string | null {
  const row = blueprintNamed(name, version);
  if (!row) return "That version does not exist.";
  if (row.status === "live") return "That version is already live.";
  archiveLiveBlueprint(name);
  setBlueprintStatus(name, version, "live");
  logBlueprint("rollback", name, version, "live", tick);
  publishBlueprints();
  return null;
}

export function setApproval(required: boolean): void {
  setBlueprintApproval(required);
  publishBlueprints();
}

export function layPath(args: Record<string, unknown>, tick: number): ToolOutcome {
  if (typeof args.name !== "string" || !isBlueprintName(args.name)) {
    return { result: "Name the path with lowercase letters and underscores.", kind: null };
  }
  const points = parsePoints(args.points);
  if ("error" in points) return { result: points.error, kind: null };
  savePath(args.name, points.points);
  if (typeof args.object_id === "string" && args.object_id.trim()) {
    const object = listWorldObjects().find((row) => row.id === args.object_id);
    if (!object) return { result: "No object with that id.", kind: null };
    if (object.createdBy !== "pip") {
      return { result: "The houses and the trees that were already here stay where they are.", kind: null };
    }
    updateWorldObject({ ...object, path: args.name });
    publishObjects();
  }
  publishPaths();
  console.log(`Tick ${tick} lay_path ${args.name} (${points.points.length} points).`);
  return {
    result: `Path ${args.name} has ${points.points.length} points. A blueprint with behaviour follow_path can ride it when an object you placed has that path.`,
    kind: null,
  };
}

function parsePoints(value: unknown): { points: PathPoint[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "points must be a list of { x, z }." };
  if (value.length < 2 || value.length > 24) return { error: "A path needs between 2 and 24 points." };
  const points: PathPoint[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { error: "Each point needs x and z." };
    const point = item as { x?: unknown; z?: unknown };
    if (typeof point.x !== "number" || typeof point.z !== "number") return { error: "Each point needs numeric x and z." };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return { error: "Each point needs numeric x and z." };
    if (Math.hypot(point.x, point.z) > WORLD_RADIUS) return { error: "A point sits outside the village." };
    points.push({ x: Math.round(point.x * 100) / 100, z: Math.round(point.z * 100) / 100 });
  }
  return { points };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

type PreviewStore = { date: string; counts: Record<string, number> };

function previewStore(): PreviewStore {
  const today = ownerDate(new Date());
  const raw = getSetting(PREVIEW_KEY);
  if (!raw) return { date: today, counts: {} };
  try {
    const parsed = JSON.parse(raw) as PreviewStore;
    if (!parsed || parsed.date !== today || typeof parsed.counts !== "object") return { date: today, counts: {} };
    return parsed;
  } catch {
    return { date: today, counts: {} };
  }
}

export async function previewBlueprint(name: string, tick: number): Promise<ToolOutcome> {
  if (!isBlueprintName(name)) return { result: "Name the blueprint with lowercase letters and underscores.", kind: null };
  const row = latestBlueprint(name);
  if (!row) return { result: `There is no blueprint named ${name}.`, kind: null };
  const store = previewStore();
  const used = store.counts[name] ?? 0;
  if (used >= PREVIEW_CAP) {
    return { result: `${name} has already been previewed ${PREVIEW_CAP} times today.`, kind: null };
  }
  const port = Number(process.env.PORT) || 3001;
  let png: Buffer;
  try {
    png = await captureBlueprint(port, name);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview failed.";
    console.error(`Blueprint preview failed: ${message}`);
    return { result: "The preview could not be drawn. Try again in a moment.", kind: null };
  }
  store.counts[name] = used + 1;
  setSetting(PREVIEW_KEY, JSON.stringify(store));
  logBlueprint("preview", name, row.version, row.status, tick);
  return {
    result: `Preview of ${name} version ${row.version}. ${store.counts[name]} of ${PREVIEW_CAP} previews today. The picture is attached.`,
    kind: "blueprint",
    image: {
      mediaType: "image/png",
      data: png.toString("base64"),
      url: `blueprint:${name}@${row.version}`,
    },
  };
}

export function latestPreviewBody(name: string): { name: string; version: number; spec: BlueprintSpec } | null {
  const row = latestBlueprint(name);
  if (!row) return null;
  return { name: row.name, version: row.version, spec: resolveSpec(row.spec) };
}
