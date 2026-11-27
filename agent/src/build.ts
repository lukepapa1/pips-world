import { randomUUID } from "node:crypto";
import {
  footprintOf,
  footprintOfSpec,
  insideWorld,
  isBlueprintName,
  overlaps,
  type WorldEvent,
  type WorldObject,
} from "@pips/shared";
import {
  deleteWorldObject,
  insertWorldObject,
  listWorldObjects,
  liveBlueprint,
  makeEvent,
  saveEvents,
  updateWorldObject,
} from "./db.js";
import { broadcast } from "./hub.js";
import type { ToolOutcome } from "./tools.js";
import { buildCap, buildsLeft, noteBuild } from "./usage.js";

function numberOf(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function styleOf(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 40);
}

function label(type: string): string {
  return type.replaceAll("_", " ");
}

function publish(event: WorldEvent): void {
  saveEvents([event]);
  broadcast({ type: "event", event });
  broadcast({ type: "world_objects", objects: listWorldObjects() });
}

function radiusOf(object: Pick<WorldObject, "type" | "blueprint">): number {
  if (object.blueprint && isBlueprintName(object.blueprint)) {
    const live = liveBlueprint(object.blueprint);
    if (live) return footprintOfSpec(live.spec);
  }
  return footprintOf(object.type);
}

function findPlaced(
  objects: WorldObject[],
  id: unknown,
  type: string,
  x: number,
  z: number,
): WorldObject | string {
  if (typeof id === "string" && id.trim() !== "") {
    const row = objects.find((object) => object.id === id.trim());
    if (!row) return "No object with that id.";
    if (row.createdBy !== "pip") return "The houses and the trees that were already here stay where they are.";
    if (row.type !== type) return "That object is a different type.";
    return row;
  }
  const matches = objects.filter((object) => object.createdBy === "pip" && object.type === type);
  if (matches.length === 0) return `You have not placed a ${label(type)}.`;
  if (matches.length === 1) {
    const only = matches[0];
    return only ?? `You have not placed a ${label(type)}.`;
  }
  const ranked = matches
    .map((object) => ({ object, distance: Math.hypot(object.x - x, object.z - z) }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = ranked[0];
  const next = ranked[1];
  if (nearest && next && nearest.distance + 0.4 < next.distance) return nearest.object;
  return `There is more than one ${label(type)}. Pass the id of the one you mean.`;
}

export function runBuild(args: Record<string, unknown>, tick: number): ToolOutcome {
  const action = args.action;
  if (action !== "add" && action !== "move" && action !== "remove") {
    return { result: "action must be add, move, or remove.", kind: null };
  }
  if (typeof args.type !== "string" || !isBlueprintName(args.type) || !liveBlueprint(args.type)) {
    return { result: "That is not something you can build.", kind: null };
  }
  const type = args.type;
  const x = numberOf(args.x);
  const z = numberOf(args.z);
  if (x === null || z === null) return { result: "x and z must be numbers.", kind: null };
  const rotation = args.rotation === undefined || args.rotation === null ? 0 : numberOf(args.rotation);
  if (rotation === null) return { result: "rotation must be a number.", kind: null };
  const style = styleOf(args.style);
  if (!buildsLeft()) {
    return { result: `The day's build limit is ${buildCap()}. Try again tomorrow.`, kind: null };
  }

  const objects = listWorldObjects();
  if (action === "add") return addObject(objects, type, x, z, rotation, style, tick);

  const target = findPlaced(objects, args.id, type, x, z);
  if (typeof target === "string") return { result: target, kind: null };
  if (action === "remove") return removeObject(target, tick);
  return moveObject(objects, target, x, z, rotation, style, tick);
}

function addObject(
  objects: WorldObject[],
  type: string,
  x: number,
  z: number,
  rotation: number,
  style: string,
  tick: number,
): ToolOutcome {
  const radius = radiusOf({ type, blueprint: type });
  if (!insideWorld(x, z, type, radius)) return { result: "That spot is outside the village.", kind: null };
  if (objects.some((object) => overlaps({ x, z, type }, object, radius, radiusOf(object)))) {
    return { result: "That spot overlaps something already there.", kind: null };
  }
  const row: WorldObject = {
    id: randomUUID(),
    type,
    x,
    z,
    rotation,
    style,
    blueprint: type,
    path: null,
    createdBy: "pip",
    createdAt: new Date().toISOString(),
  };
  insertWorldObject(row);
  noteBuild();
  publish(makeEvent("build", { action: "add", objectId: row.id, type, x, z, rotation, style }, tick));
  return { result: `Placed a ${label(type)} (${row.id}) at ${x}, ${z}.`, kind: "build" };
}

function moveObject(
  objects: WorldObject[],
  target: WorldObject,
  x: number,
  z: number,
  rotation: number,
  style: string,
  tick: number,
): ToolOutcome {
  if (target.createdBy !== "pip") {
    return { result: "The houses and the trees that were already here stay where they are.", kind: null };
  }
  const radius = radiusOf(target);
  if (!insideWorld(x, z, target.type, radius)) return { result: "That spot is outside the village.", kind: null };
  const blocked = objects.some(
    (object) => object.id !== target.id && overlaps({ x, z, type: target.type }, object, radius, radiusOf(object)),
  );
  if (blocked) return { result: "That spot overlaps something already there.", kind: null };
  const nextStyle = style === "" ? target.style : style;
  updateWorldObject({ ...target, x, z, rotation, style: nextStyle });
  noteBuild();
  publish(
    makeEvent(
      "build",
      { action: "move", objectId: target.id, type: target.type, x, z, rotation, style: nextStyle },
      tick,
    ),
  );
  return { result: `Moved the ${label(target.type)} (${target.id}) to ${x}, ${z}.`, kind: "build" };
}

function removeObject(target: WorldObject, tick: number): ToolOutcome {
  if (target.createdBy !== "pip") {
    return { result: "The houses and the trees that were already here stay where they are.", kind: null };
  }
  deleteWorldObject(target.id);
  noteBuild();
  publish(
    makeEvent(
      "build",
      {
        action: "remove",
        objectId: target.id,
        type: target.type,
        x: target.x,
        z: target.z,
        rotation: target.rotation,
        style: target.style,
      },
      tick,
    ),
  );
  return { result: `Removed the ${label(target.type)} (${target.id}).`, kind: "build" };
}
