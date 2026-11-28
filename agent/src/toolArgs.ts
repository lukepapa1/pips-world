import type { ToolSpec } from "./llm.js";

const EXAMPLES: Record<string, string> = {
  build: 'build(action="add", type="garden_bed", x=1, z=1)',
  design_blueprint:
    'design_blueprint(name="stone_seat", spec={"primitives":[{"shape":"box","size":[1,0.4,0.5],"position":[0,0.2,0],"rotation":[0,0,0],"colour":"#8d8680"}]})',
  report_problem: 'report_problem(tool="build", what_happened="build failed twice after the example call.")',
};

const NAMED_COLOURS: Record<string, string> = {
  gray: "#8d8680",
  grey: "#8d8680",
};

export type AcceptedCall = {
  args: Record<string, unknown>;
  rawText: string;
};

export type RejectedArguments = {
  error: string;
  args: Record<string, unknown>;
  rawText: string;
};

function preview(value: unknown): string {
  let text = "";
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text.length <= 400) return text;
  return `${text.slice(0, 400)}…`;
}

export function toolExample(name: string): string {
  return EXAMPLES[name] ?? `${name}(...)`;
}

export function explainToolError(name: string, received: unknown, problem: string): string {
  return `${problem} Received ${preview(received)}. Expected the fields in the tool definition. Example: ${toolExample(name)}`;
}

function looseJson(text: string): unknown {
  let body = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(body);
  if (fenced?.[1]) body = fenced[1].trim();
  body = body.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(body);
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function propertyType(spec: ToolSpec, key: string): string | undefined {
  const parameters = spec.parameters as { properties?: Record<string, { type?: unknown }> };
  const type = parameters.properties?.[key]?.type;
  return typeof type === "string" ? type : undefined;
}

function readXZ(args: Record<string, unknown>): { x: number; z: number } | null {
  const directX = numberOf(args.x);
  const directZ = numberOf(args.z);
  if (directX !== null && directZ !== null) return { x: directX, z: directZ };
  const position = args.position ?? args.coords ?? args.coordinates;
  if (Array.isArray(position)) {
    const x = numberOf(position[0]);
    const z = numberOf(position.length >= 3 ? position[2] : position[1]);
    if (x !== null && z !== null) return { x, z };
  }
  const record = asRecord(position);
  if (record) {
    const x = numberOf(record.x);
    const z = numberOf(record.z);
    if (x !== null && z !== null) return { x, z };
  }
  return null;
}

function asVec3(value: unknown): [number, number, number] | null {
  if (Array.isArray(value)) {
    const x = numberOf(value[0]);
    const y = numberOf(value[1]);
    const z = numberOf(value[2]);
    if (x === null || y === null || z === null) return null;
    return [x, y, z];
  }
  const record = asRecord(value);
  if (!record) return null;
  const x = numberOf(record.x);
  const y = numberOf(record.y);
  const z = numberOf(record.z);
  if (x === null || y === null || z === null) return null;
  return [x, y, z];
}

function coercePrimitive(value: unknown): unknown {
  const row = asRecord(value);
  if (!row) return value;
  const next: Record<string, unknown> = { ...row };
  if (next.shape === undefined && typeof next.type === "string") {
    next.shape = next.type;
    delete next.type;
  }
  for (const key of ["size", "position", "rotation"] as const) {
    const vec = asVec3(next[key]);
    if (vec) next[key] = vec;
  }
  if (next.rotation === undefined) next.rotation = [0, 0, 0];
  if (typeof next.colour === "string" && !next.colour.trim().startsWith("#")) {
    const named = NAMED_COLOURS[next.colour.trim().toLowerCase()];
    if (named) next.colour = named;
  }
  return next;
}

function coerceSpec(value: unknown): unknown {
  let spec = value;
  if (typeof spec === "string") {
    try {
      spec = looseJson(spec);
    } catch {
      return value;
    }
  }
  const record = asRecord(spec);
  if (!record || !Array.isArray(record.primitives)) return spec;
  return { ...record, primitives: record.primitives.map(coercePrimitive) };
}

function coerceNumbers(spec: ToolSpec, args: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...args };
  const parameters = spec.parameters as { properties?: Record<string, { type?: unknown }> };
  for (const [key, schema] of Object.entries(parameters.properties ?? {})) {
    if (schema.type === "number") {
      const parsed = numberOf(next[key]);
      if (parsed !== null) next[key] = parsed;
    }
    if ((schema.type === "object" || schema.type === "array") && typeof next[key] === "string") {
      const parsed = looseJson(next[key]);
      if (parsed !== null && typeof parsed === "object") next[key] = parsed;
    }
  }
  return next;
}

export function normalizeToolArgs(spec: ToolSpec, args: Record<string, unknown>): Record<string, unknown> {
  let next = coerceNumbers(spec, args);
  if (spec.name === "build" || spec.name === "move_to") {
    const point = readXZ(next);
    if (point) next = { ...next, x: point.x, z: point.z };
    const rotation = numberOf(next.rotation);
    if (rotation !== null) next = { ...next, rotation };
  }
  if (spec.name === "design_blueprint") {
    const raw = next.spec !== undefined ? next.spec : next.spec_json;
    if (raw !== undefined) next = { ...next, spec: coerceSpec(raw) };
  }
  if (spec.name === "lay_path" && Array.isArray(next.points)) {
    next = {
      ...next,
      points: next.points.map((point) => {
        const record = asRecord(point);
        if (!record) return point;
        const x = numberOf(record.x);
        const z = numberOf(record.z);
        return x === null || z === null ? point : { ...record, x, z };
      }),
    };
  }
  return next;
}

function present(value: unknown, type: string | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "object") return typeof value === "object" && !Array.isArray(value);
  if (type === "array") return Array.isArray(value);
  if (type === "boolean") return typeof value === "boolean";
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

export function acceptToolCall(spec: ToolSpec, raw: unknown): AcceptedCall | RejectedArguments {
  const rawText = typeof raw === "string" ? raw : preview(raw);
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) parsed = {};
    else {
      try {
        parsed = looseJson(raw);
      } catch {
        const args = {};
        return {
          error: explainToolError(spec.name, rawText, "The arguments were not JSON."),
          args,
          rawText,
        };
      }
    }
  }
  const record = asRecord(parsed);
  if (!record) {
    return {
      error: explainToolError(spec.name, rawText, "The arguments were not an object."),
      args: {},
      rawText,
    };
  }
  const args = normalizeToolArgs(spec, record);
  for (const key of spec.required) {
    if (present(args[key], propertyType(spec, key))) continue;
    const received = key in args ? `${key}=${preview(args[key])}` : `${key} was not included`;
    return {
      error: explainToolError(spec.name, args, `${key} is missing (${received}).`),
      args,
      rawText,
    };
  }
  return { args, rawText };
}
