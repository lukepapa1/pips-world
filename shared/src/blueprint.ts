export const PRIMITIVES = ["box", "cylinder", "cone", "sphere"] as const;
export const BEHAVIOURS = ["sway", "follow_path"] as const;

export const MAX_PRIMITIVES = 60;
export const MAX_PARAMETERS = 8;
export const SIZE_MIN = 0.02;
export const SIZE_MAX = 4;
export const POSITION_LIMIT = 4;
export const ROTATION_LIMIT = 6.3;
export const PARAMETER_MIN = -8;
export const PARAMETER_MAX = 12;

export type PrimitiveShape = (typeof PRIMITIVES)[number];
export type BlueprintBehaviour = (typeof BEHAVIOURS)[number];

export type Vec3 = [number, number, number];

export type BlueprintPrimitive = {
  shape: PrimitiveShape;
  size: Vec3;
  position: Vec3;
  rotation: Vec3;
  colour: string;
  foliage?: boolean;
  emissive?: boolean;
  layer?: number;
};

export type BlueprintSpec = {
  primitives: BlueprintPrimitive[];
  parameters?: Record<string, number>;
  behaviour?: BlueprintBehaviour;
};

export type BlueprintStatus = "live" | "pending" | "archived";

export type BlueprintRecord = {
  name: string;
  version: number;
  spec: BlueprintSpec;
  status: BlueprintStatus;
  createdBy: "world" | "pip";
  createdAt: string;
};

export type PathPoint = { x: number; z: number };

export type PathRecord = {
  name: string;
  points: PathPoint[];
};

const NAME = /^[a-z][a-z0-9_]{0,31}$/;
const PARAM = /^[a-z][a-z0-9_]{0,20}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const PRIMITIVE_KEYS = new Set(["shape", "size", "position", "rotation", "colour", "foliage", "emissive", "layer"]);
const SPEC_KEYS = new Set(["primitives", "parameters", "behaviour"]);

export function isBlueprintName(value: string): boolean {
  return NAME.test(value);
}

export function validateBlueprint(value: unknown): { spec: BlueprintSpec } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "A blueprint is a JSON object, not code." };
  }
  const spec = value as Record<string, unknown>;
  for (const key of Object.keys(spec)) {
    if (!SPEC_KEYS.has(key)) return { error: `Unknown field "${key}".` };
  }
  if (!Array.isArray(spec.primitives)) return { error: "primitives must be a list." };
  if (spec.primitives.length < 1) return { error: "A blueprint needs at least one primitive." };
  if (spec.primitives.length > MAX_PRIMITIVES) {
    return { error: `Too many primitives (${spec.primitives.length}). The maximum is ${MAX_PRIMITIVES}.` };
  }
  const primitives: BlueprintPrimitive[] = [];
  for (let index = 0; index < spec.primitives.length; index += 1) {
    const parsed = parsePrimitive(spec.primitives[index], index);
    if ("error" in parsed) return parsed;
    primitives.push(parsed.primitive);
  }
  let parameters: Record<string, number> | undefined;
  if (spec.parameters !== undefined) {
    const parsed = parseParameters(spec.parameters);
    if ("error" in parsed) return parsed;
    parameters = parsed.parameters;
  }
  let behaviour: BlueprintBehaviour | undefined;
  if (spec.behaviour !== undefined) {
    if (spec.behaviour !== "sway" && spec.behaviour !== "follow_path") {
      return { error: "behaviour must be sway or follow_path." };
    }
    behaviour = spec.behaviour;
  }
  const result: BlueprintSpec = { primitives };
  if (parameters && Object.keys(parameters).length > 0) result.parameters = parameters;
  if (behaviour) result.behaviour = behaviour;
  return { spec: result };
}

function parsePrimitive(value: unknown, index: number): { primitive: BlueprintPrimitive } | { error: string } {
  const where = `primitives[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: `${where} must be an object.` };
  }
  const row = value as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!PRIMITIVE_KEYS.has(key)) return { error: `${where} has unknown field "${key}".` };
  }
  if (!PRIMITIVES.includes(row.shape as PrimitiveShape)) {
    return { error: `${where}.shape must be box, cylinder, cone, or sphere.` };
  }
  const size = triple(row.size, `${where}.size`, SIZE_MIN, SIZE_MAX);
  if ("error" in size) return size;
  const position = triple(row.position, `${where}.position`, -POSITION_LIMIT, POSITION_LIMIT);
  if ("error" in position) return position;
  const rotation = triple(row.rotation, `${where}.rotation`, -ROTATION_LIMIT, ROTATION_LIMIT);
  if ("error" in rotation) return rotation;
  if (typeof row.colour !== "string" || !COLOUR.test(row.colour)) {
    return { error: `${where}.colour must be a #rrggbb colour.` };
  }
  const primitive: BlueprintPrimitive = {
    shape: row.shape as PrimitiveShape,
    size: size.triple,
    position: position.triple,
    rotation: rotation.triple,
    colour: row.colour.toLowerCase(),
  };
  if (row.foliage !== undefined) {
    if (typeof row.foliage !== "boolean") return { error: `${where}.foliage must be true or false.` };
    primitive.foliage = row.foliage;
  }
  if (row.emissive !== undefined) {
    if (typeof row.emissive !== "boolean") return { error: `${where}.emissive must be true or false.` };
    primitive.emissive = row.emissive;
  }
  if (row.layer !== undefined) {
    if (typeof row.layer !== "number" || !Number.isInteger(row.layer) || row.layer < 1 || row.layer > 8) {
      return { error: `${where}.layer must be a whole number from 1 to 8.` };
    }
    primitive.layer = row.layer;
  }
  return { primitive };
}

function parseParameters(value: unknown): { parameters: Record<string, number> } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "parameters must be an object of numbers." };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_PARAMETERS) return { error: `At most ${MAX_PARAMETERS} parameters.` };
  const parameters: Record<string, number> = {};
  for (const [key, raw] of entries) {
    if (!PARAM.test(key)) return { error: `Parameter name "${key}" is not allowed.` };
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < PARAMETER_MIN || raw > PARAMETER_MAX) {
      return { error: `Parameter ${key} must be a number from ${PARAMETER_MIN} to ${PARAMETER_MAX}.` };
    }
    parameters[key] = raw;
  }
  return { parameters };
}

function triple(
  value: unknown,
  where: string,
  min: number,
  max: number,
): { triple: Vec3 } | { error: string } {
  if (!Array.isArray(value) || value.length !== 3) return { error: `${where} must be three numbers.` };
  const numbers: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item) || item < min || item > max) {
      return { error: `${where} values must be numbers from ${min} to ${max}.` };
    }
    numbers.push(item);
  }
  return { triple: [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0] };
}

export function styleParameters(style: string): Record<string, number> {
  if (!style.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(style) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const parameters: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!PARAM.test(key) || typeof value !== "number" || !Number.isFinite(value)) continue;
      if (value < PARAMETER_MIN || value > PARAMETER_MAX) continue;
      parameters[key] = value;
    }
    return parameters;
  } catch {
    return {};
  }
}

/** Applies height and canopy_layers. Other parameters stay on the spec for the behaviour. */
export function resolveSpec(spec: BlueprintSpec, style = ""): BlueprintSpec {
  const parameters = { ...spec.parameters, ...styleParameters(style) };
  const layers = parameters.canopy_layers;
  const height = parameters.height;
  const scale = height === undefined ? 1 : Math.min(4, Math.max(0.2, height));
  const primitives = spec.primitives
    .filter((primitive) => layers === undefined || primitive.layer === undefined || primitive.layer <= layers)
    .map((primitive) => {
      if (scale === 1) return primitive;
      const size: Vec3 = [primitive.size[0], primitive.size[1] * scale, primitive.size[2]];
      const position: Vec3 = [primitive.position[0], primitive.position[1] * scale, primitive.position[2]];
      return { ...primitive, size, position };
    });
  return { ...spec, parameters, primitives };
}

export function footprintOfSpec(spec: BlueprintSpec): number {
  let reach = 0.35;
  for (const primitive of spec.primitives) {
    const radius = Math.hypot(primitive.position[0], primitive.position[2]) + Math.max(primitive.size[0], primitive.size[2]) / 2;
    if (radius > reach) reach = radius;
  }
  return Math.min(2.2, Math.max(0.3, Math.round(reach * 100) / 100));
}

export function isBlueprintRecord(value: unknown): value is BlueprintRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<BlueprintRecord>;
  if (typeof row.name !== "string" || !isBlueprintName(row.name)) return false;
  if (typeof row.version !== "number" || !Number.isInteger(row.version) || row.version < 1) return false;
  if (row.status !== "live" && row.status !== "pending" && row.status !== "archived") return false;
  if (row.createdBy !== "world" && row.createdBy !== "pip") return false;
  if (typeof row.createdAt !== "string") return false;
  return "spec" in row && validateBlueprint(row.spec).hasOwnProperty("spec");
}

export function isPathRecord(value: unknown): value is PathRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PathRecord>;
  if (typeof row.name !== "string" || !isBlueprintName(row.name)) return false;
  if (!Array.isArray(row.points) || row.points.length < 2) return false;
  return row.points.every(
    (point) =>
      !!point &&
      typeof point === "object" &&
      typeof (point as PathPoint).x === "number" &&
      typeof (point as PathPoint).z === "number",
  );
}

export function liveSpec(records: BlueprintRecord[], name: string): { version: number; spec: BlueprintSpec } | null {
  const live = records
    .filter((record) => record.name === name && record.status === "live")
    .sort((a, b) => b.version - a.version)[0];
  if (!live) return null;
  return { version: live.version, spec: live.spec };
}
