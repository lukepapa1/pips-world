/** Metres from the centre. Objects must sit fully inside this circle. */
export const WORLD_RADIUS = 14.5;

export const VILLAGE_RADIUS = 7.15;

export const BUILDING_SLOTS = {
  home: 0,
  mailbox: 1,
  gallery: 2,
  workshop: 3,
  library: 4,
} as const;

/** Types Pip can add. The houses are already in the village. */
export const BUILDABLE = [
  "bench",
  "garden_bed",
  "shelf",
  "lamp",
  "tree",
  "flower_patch",
  "fence",
  "path_tile",
] as const;

export type BuildableType = (typeof BUILDABLE)[number];

export type PlaceType = keyof typeof BUILDING_SLOTS | BuildableType;

export type BuildAction = "add" | "move" | "remove";

export type WorldObject = {
  id: string;
  type: string;
  x: number;
  z: number;
  rotation: number;
  style: string;
  /** Blueprint name. Null for the houses, which stay hand-built. */
  blueprint: string | null;
  /** Named path used when the blueprint behaviour is follow_path. */
  path: string | null;
  createdBy: "world" | "pip";
  createdAt: string;
};

const FOOTPRINT: Record<PlaceType, number> = {
  home: 1.55,
  library: 1.55,
  workshop: 1.55,
  gallery: 1.55,
  mailbox: 1.15,
  bench: 0.7,
  garden_bed: 0.8,
  shelf: 0.45,
  lamp: 0.35,
  tree: 0.85,
  flower_patch: 0.7,
  fence: 0.9,
  path_tile: 0.4,
};

export function buildingAngle(slot: number): number {
  return Math.PI / 2 - (slot * 2 * Math.PI) / 5;
}

export function isBuildable(type: string): type is BuildableType {
  return (BUILDABLE as readonly string[]).includes(type);
}

export function isPlaceType(type: string): type is PlaceType {
  return type in FOOTPRINT;
}

export function footprintOf(type: string): number {
  if (isPlaceType(type)) return FOOTPRINT[type];
  return 0.8;
}

export function insideWorld(x: number, z: number, type: string, radius = footprintOf(type)): boolean {
  return Math.hypot(x, z) + radius <= WORLD_RADIUS;
}

export function overlaps(
  a: { x: number; z: number; type: string },
  b: { x: number; z: number; type: string },
  radiusA = footprintOf(a.type),
  radiusB = footprintOf(b.type),
): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) < radiusA + radiusB - 0.05;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED_AT = "2020-01-01T00:00:00.000Z";

/** Houses and the ring of trees, in the same places the village used to draw them. */
export function starterObjects(): WorldObject[] {
  const buildings = (Object.keys(BUILDING_SLOTS) as (keyof typeof BUILDING_SLOTS)[]).map((type) => {
    const angle = buildingAngle(BUILDING_SLOTS[type]);
    const x = Math.cos(angle) * VILLAGE_RADIUS;
    const z = Math.sin(angle) * VILLAGE_RADIUS;
    return {
      id: `seed-${type}`,
      type,
      x: round2(x),
      z: round2(z),
      rotation: Math.atan2(-x, -z),
      style: "",
      blueprint: null,
      path: null,
      createdBy: "world" as const,
      createdAt: SEED_AT,
    };
  });

  const rng = mulberry32(17);
  const trees: WorldObject[] = [];
  const specs: { x: number; z: number; rotation: number; scale: number; round: boolean }[] = [];
  for (let i = 0; i < 22; i += 1) {
    const angle = (i / 22) * Math.PI * 2 + (rng() - 0.5) * 0.28;
    const radius = 12.15 + rng() * 2.35;
    const round = rng() > 0.45;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const rotation = rng() * Math.PI * 2;
    const scale = 0.78 + rng() * 0.65;
    rng();
    specs.push({ x, z, rotation, scale, round });
  }
  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    if (!spec) continue;
    const slot = Math.floor(rng() * 3);
    const crown = spec.round ? "round" : "cone";
    trees.push({
      id: `seed-tree-${i}`,
      type: "tree",
      x: round2(spec.x),
      z: round2(spec.z),
      rotation: spec.rotation,
      style: `${crown}:${spec.scale.toFixed(3)}:${slot}`,
      blueprint: "tree",
      path: null,
      createdBy: "world",
      createdAt: SEED_AT,
    });
  }
  return [...buildings, ...trees];
}

export function isWorldObject(value: unknown): value is WorldObject {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<WorldObject>;
  if (typeof row.id !== "string" || typeof row.type !== "string") return false;
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(row.type)) return false;
  if (typeof row.x !== "number" || typeof row.z !== "number") return false;
  if (typeof row.rotation !== "number" || typeof row.style !== "string") return false;
  if (!(row.blueprint === null || (typeof row.blueprint === "string" && /^[a-z][a-z0-9_]{0,31}$/.test(row.blueprint)))) {
    return false;
  }
  if (!(row.path === null || (typeof row.path === "string" && /^[a-z][a-z0-9_]{0,31}$/.test(row.path)))) return false;
  if (row.createdBy !== "world" && row.createdBy !== "pip") return false;
  if (typeof row.createdAt !== "string") return false;
  return true;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
