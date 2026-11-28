export const BUILDING_TEMPLATES = ["cottage", "workshop", "barn", "tower", "pavilion", "stall"] as const;
export const WALL_STYLES = ["plaster", "timber", "stone", "board"] as const;
export const ROOF_STYLES = ["gable", "hip", "shed", "flat"] as const;
export const DOOR_SIDES = ["front", "back", "left", "right"] as const;
export const SLOT_KINDS = [
  "wall_frame",
  "plinth",
  "shelf",
  "bookcase",
  "desk",
  "easel",
  "workbench",
  "table",
  "bed",
  "screen",
  "floor_item",
] as const;

export const MAX_BUILDING_SIZE = 8;
export const MAX_SLOTS = 30;

export type BuildingTemplate = (typeof BUILDING_TEMPLATES)[number];
export type WallStyle = (typeof WALL_STYLES)[number];
export type RoofStyle = (typeof ROOF_STYLES)[number];
export type DoorSide = (typeof DOOR_SIDES)[number];
export type SlotKind = (typeof SLOT_KINDS)[number];

export type BuildingSlot = {
  id: string;
  kind: SlotKind;
  position: [number, number, number];
  size: [number, number, number];
  accepts: string[];
};

export type BuildingBody = {
  kind: "building";
  template: BuildingTemplate;
  footprint: { width: number; depth: number };
  floors: 1 | 2;
  wall: { style: WallStyle; colour: string };
  roof: { style: RoofStyle; colour: string };
  door: { side: DoorSide; position: number };
  windows: { side: DoorSide; position: number; floor: 1 | 2 }[];
  chimney: boolean;
  skylight: boolean;
  sign: string;
  interior: BuildingSlot[];
};

export type BuildingParams = {
  size?: number;
  wall_colour?: string;
  roof_colour?: string;
  roof_style?: RoofStyle;
  window_count?: number;
  door_side?: DoorSide;
  chimney?: boolean;
  interior?: string;
};

const COLOUR = /^#[0-9a-fA-F]{6}$/;

const BASE: Record<
  BuildingTemplate,
  { width: number; depth: number; floors: 1 | 2; wall: WallStyle; wallColour: string; roof: RoofStyle; roofColour: string; chimney: boolean; skylight: boolean; windows: number }
> = {
  cottage: { width: 3.2, depth: 2.6, floors: 1, wall: "plaster", wallColour: "#f3efe6", roof: "gable", roofColour: "#8d4a3a", chimney: true, skylight: false, windows: 4 },
  workshop: { width: 5.4, depth: 4.0, floors: 1, wall: "timber", wallColour: "#c4a574", roof: "gable", roofColour: "#9a4530", chimney: true, skylight: true, windows: 4 },
  barn: { width: 4.8, depth: 3.4, floors: 1, wall: "board", wallColour: "#a86b3c", roof: "gable", roofColour: "#6d4034", chimney: false, skylight: false, windows: 2 },
  tower: { width: 2.6, depth: 2.4, floors: 2, wall: "stone", wallColour: "#d5d0c6", roof: "gable", roofColour: "#6e5a78", chimney: false, skylight: true, windows: 6 },
  pavilion: { width: 5.2, depth: 4.2, floors: 1, wall: "plaster", wallColour: "#f7f4ee", roof: "hip", roofColour: "#e7dccb", chimney: false, skylight: true, windows: 6 },
  stall: { width: 2.2, depth: 1.9, floors: 1, wall: "board", wallColour: "#f0d7c4", roof: "gable", roofColour: "#8d4a3a", chimney: false, skylight: false, windows: 2 },
};

const ACCEPTS: Record<SlotKind, string[]> = {
  wall_frame: ["art"],
  plinth: ["design", "art"],
  shelf: ["art", "writing", "design"],
  bookcase: ["writing"],
  desk: ["writing"],
  easel: ["art"],
  workbench: ["mechanic", "design", "site"],
  table: ["art", "writing", "design"],
  bed: ["art"],
  screen: ["game", "site"],
  floor_item: ["art", "design", "mechanic"],
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function colourOf(value: unknown, fallback: string): string {
  return typeof value === "string" && COLOUR.test(value.trim()) ? value.trim() : fallback;
}

function sideOf(value: unknown, fallback: DoorSide): DoorSide {
  return DOOR_SIDES.includes(value as DoorSide) ? (value as DoorSide) : fallback;
}

function slot(id: string, kind: SlotKind, position: [number, number, number], size: [number, number, number]): BuildingSlot {
  return { id, kind, position, size, accepts: [...ACCEPTS[kind]] };
}

function presetSlots(template: BuildingTemplate, width: number, depth: number): BuildingSlot[] {
  const x = width * 0.28;
  const z = depth * 0.22;
  if (template === "workshop") {
    return [
      slot("easel-1", "easel", [0.35, 0, 0.35], [0.7, 1.15, 0.45]),
      slot("bench-1", "workbench", [width * 0.22, 0, -depth * 0.18], [1.3, 0.75, 0.6]),
      slot("desk-1", "desk", [-width * 0.22, 0, 0.1], [0.9, 0.72, 0.5]),
      slot("shelf-1", "shelf", [-x, 0.9, -z], [0.7, 0.8, 0.28]),
    ];
  }
  if (template === "pavilion") {
    return [
      slot("frame-1", "wall_frame", [-x, 1.15, -depth * 0.36], [0.7, 0.55, 0.06]),
      slot("frame-2", "wall_frame", [0, 1.15, -depth * 0.36], [0.7, 0.55, 0.06]),
      slot("frame-3", "wall_frame", [x, 1.15, -depth * 0.36], [0.7, 0.55, 0.06]),
      slot("plinth-1", "plinth", [-width * 0.22, 0, 0.15], [0.4, 0.7, 0.4]),
      slot("plinth-2", "plinth", [width * 0.22, 0, 0.15], [0.4, 0.7, 0.4]),
      slot("screen-1", "screen", [width * 0.3, 0, -0.2], [0.55, 0.9, 0.4]),
      slot("books-1", "bookcase", [-width * 0.32, 0, -0.15], [0.7, 1.2, 0.28]),
    ];
  }
  if (template === "tower") {
    return [
      slot("books-1", "bookcase", [-width * 0.22, 0, -depth * 0.16], [0.55, 1.35, 0.28]),
      slot("desk-1", "desk", [width * 0.12, 0, 0.15], [0.7, 0.72, 0.45]),
      slot("shelf-1", "shelf", [0, 1.15, -depth * 0.28], [0.6, 0.5, 0.22]),
    ];
  }
  if (template === "barn") {
    return [
      slot("table-1", "table", [0, 0, 0], [1.2, 0.7, 0.6]),
      slot("shelf-1", "shelf", [-x, 0.9, -z], [0.8, 0.7, 0.28]),
      slot("plinth-1", "plinth", [x, 0, 0.2], [0.4, 0.65, 0.4]),
      slot("floor-1", "floor_item", [-x, 0, 0.3], [0.4, 0.4, 0.4]),
    ];
  }
  if (template === "stall") {
    return [
      slot("desk-1", "desk", [0, 0, -0.05], [0.7, 0.7, 0.4]),
      slot("shelf-1", "shelf", [0, 1.0, -depth * 0.28], [0.6, 0.4, 0.2]),
    ];
  }
  return [
    slot("bed-1", "bed", [-width * 0.18, 0, -depth * 0.12], [0.9, 0.4, 1.3]),
    slot("table-1", "table", [width * 0.2, 0, 0.15], [0.7, 0.55, 0.5]),
    slot("shelf-1", "shelf", [0, 1.05, -depth * 0.32], [0.7, 0.55, 0.22]),
    slot("floor-1", "floor_item", [width * 0.22, 0, -0.15], [0.35, 0.35, 0.35]),
  ];
}

function windowsFor(count: number, floors: 1 | 2, door: DoorSide): BuildingBody["windows"] {
  const total = clamp(Math.round(count), 0, 8);
  const made: BuildingBody["windows"] = [];
  for (const position of [-0.72, 0.72]) {
    if (made.length >= total) break;
    made.push({ side: door, position, floor: 1 });
  }
  if (floors === 2 && made.length < total) made.push({ side: door, position: 0, floor: 2 });
  const others: DoorSide[] = ["left", "right", "back", "front"].filter((side) => side !== door);
  let index = 0;
  while (made.length < total && index < 12) {
    const side = others[index % others.length] ?? "left";
    made.push({ side, position: index % 2 === 0 ? -0.45 : 0.45, floor: floors === 2 && index % 4 === 3 ? 2 : 1 });
    index += 1;
  }
  return made;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pullInside(slotRow: BuildingSlot, width: number, depth: number, floors: 1 | 2): BuildingSlot {
  const halfW = width / 2 - 0.25;
  const halfD = depth / 2 - 0.25;
  const maxY = floors * 1.45;
  const size: [number, number, number] = [
    clamp(slotRow.size[0], 0.15, Math.min(1.6, width - 0.4)),
    clamp(slotRow.size[1], 0.15, 1.6),
    clamp(slotRow.size[2], 0.05, Math.min(1.6, depth - 0.4)),
  ];
  const position: [number, number, number] = [
    clamp(slotRow.position[0], -halfW, halfW),
    clamp(slotRow.position[1], 0, maxY),
    clamp(slotRow.position[2], -halfD, halfD),
  ];
  return { ...slotRow, size, position };
}

export function isBuildingTemplate(value: unknown): value is BuildingTemplate {
  return typeof value === "string" && (BUILDING_TEMPLATES as readonly string[]).includes(value);
}

export function activitySlot(spec: BuildingBody): BuildingSlot | undefined {
  const order: SlotKind[] = ["easel", "desk", "workbench", "bed", "table"];
  for (const kind of order) {
    const found = spec.interior.find((item) => item.kind === kind);
    if (found) return found;
  }
  return spec.interior[0];
}

/** A point just outside the door, in building-local metres. Front is +z. */
export function doorPad(spec: BuildingBody): { x: number; z: number } {
  const along = spec.door.position;
  const width = spec.footprint.width;
  const depth = spec.footprint.depth;
  const x = along * (width / 2 - 0.55);
  const z = depth / 2 - 0.2;
  if (spec.door.side === "front") return { x, z: depth / 2 + 0.85 };
  if (spec.door.side === "back") return { x: -x, z: -(depth / 2 + 0.85) };
  if (spec.door.side === "left") return { x: -(width / 2 + 0.85), z: along * (depth / 2 - 0.4) };
  return { x: width / 2 + 0.85, z: along * (depth / 2 - 0.4) };
}

export function approachOf(spec: BuildingBody, x: number, z: number, rotation: number): { x: number; z: number } {
  const pad = doorPad(spec);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return { x: x + pad.x * cos + pad.z * sin, z: z - pad.x * sin + pad.z * cos };
}

/** Rotation that aims the front door back toward the village path. */
export function rotationTowardOrigin(x: number, z: number): number {
  return Math.atan2(-x, -z);
}

export function fromTemplate(
  template: BuildingTemplate,
  params: BuildingParams = {},
  overrides?: unknown,
  sign = "",
): { spec: BuildingBody; notes: string[] } {
  const base = BASE[template];
  const notes: string[] = [];
  let size = typeof params.size === "number" && Number.isFinite(params.size) ? params.size : 1;
  if (size < 0.75 || size > 1.35) {
    notes.push("Size was brought back between 0.75 and 1.35.");
    size = clamp(size, 0.75, 1.35);
  }
  let width = base.width * size;
  let depth = base.depth * size;
  if (width > MAX_BUILDING_SIZE || depth > MAX_BUILDING_SIZE) {
    notes.push("The footprint was reduced to the maximum size.");
    const scale = MAX_BUILDING_SIZE / Math.max(width, depth);
    width *= scale;
    depth *= scale;
  }
  const floors = base.floors;
  const roofStyle = ROOF_STYLES.includes(params.roof_style as RoofStyle) ? (params.roof_style as RoofStyle) : base.roof;
  const doorSide = sideOf(params.door_side, "front");
  const windowCount = typeof params.window_count === "number" ? params.window_count : base.windows;
  if (windowCount < 0 || windowCount > 8) notes.push("Window count was limited to 8.");
  const chimney = typeof params.chimney === "boolean" ? params.chimney : base.chimney;
  const preset = params.interior && params.interior !== template ? params.interior : template;
  const slotTemplate = isBuildingTemplate(preset) ? preset : template;
  if (params.interior && !isBuildingTemplate(params.interior)) notes.push("Unknown interior preset. The template's rooms were used.");
  let interior = presetSlots(slotTemplate, width, depth);
  if (Array.isArray(overrides) && overrides.length > 0) interior = readSlots(overrides, interior);
  const draft: BuildingBody = {
    kind: "building",
    template,
    footprint: { width, depth },
    floors,
    wall: { style: base.wall, colour: colourOf(params.wall_colour, base.wallColour) },
    roof: { style: roofStyle, colour: colourOf(params.roof_colour, base.roofColour) },
    door: { side: doorSide, position: 0 },
    windows: windowsFor(windowCount, floors, doorSide),
    chimney,
    skylight: base.skylight || template === "pavilion" || template === "tower",
    sign: sign.trim().slice(0, 24),
    interior,
  };
  return settleBuilding(draft, notes);
}

function readSlots(raw: unknown[], fallback: BuildingSlot[]): BuildingSlot[] {
  const made: BuildingSlot[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row || !SLOT_KINDS.includes(row.kind as SlotKind)) continue;
    const kind = row.kind as SlotKind;
    const position = triple(row.position) ?? [0, 0, 0];
    const size = triple(row.size) ?? [0.5, 0.5, 0.4];
    const accepts = Array.isArray(row.accepts)
      ? row.accepts.filter((entry): entry is string => typeof entry === "string").slice(0, 6)
      : [...ACCEPTS[kind]];
    made.push({
      id: typeof row.id === "string" && row.id.trim() ? row.id.trim().slice(0, 24) : `${kind}-${made.length + 1}`,
      kind,
      position,
      size,
      accepts: accepts.length > 0 ? accepts : [...ACCEPTS[kind]],
    });
  }
  return made.length > 0 ? made : fallback;
}

function triple(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length < 3) return null;
  const numbers = value.slice(0, 3).map((item) => (typeof item === "number" ? item : Number(item)));
  if (numbers.some((item) => !Number.isFinite(item))) return null;
  return [numbers[0] ?? 0, numbers[1] ?? 0, numbers[2] ?? 0];
}

export function settleBuilding(raw: unknown, notes: string[] = []): { spec: BuildingBody; notes: string[] } {
  const row = asRecord(raw);
  const template = isBuildingTemplate(row?.template) ? row.template : "cottage";
  if (row && row.template !== undefined && !isBuildingTemplate(row.template)) notes.push("Unknown template. A cottage was used.");
  const base = BASE[template];
  const footprint = asRecord(row?.footprint);
  let width = typeof footprint?.width === "number" ? footprint.width : base.width;
  let depth = typeof footprint?.depth === "number" ? footprint.depth : base.depth;
  if (width < 1.6 || depth < 1.4 || width > MAX_BUILDING_SIZE || depth > MAX_BUILDING_SIZE) {
    notes.push("Footprint was clamped to a size that fits the village.");
    width = clamp(width, 1.6, MAX_BUILDING_SIZE);
    depth = clamp(depth, 1.4, MAX_BUILDING_SIZE);
  }
  const floors: 1 | 2 = row?.floors === 2 ? 2 : 1;
  if (row?.floors !== undefined && row.floors !== 1 && row.floors !== 2) notes.push("Floors were set to 1 or 2.");
  const wall = asRecord(row?.wall);
  const roof = asRecord(row?.roof);
  const door = asRecord(row?.door);
  let doorPos = typeof door?.position === "number" ? door.position : 0;
  if (doorPos < -0.65 || doorPos > 0.65) {
    notes.push("The door was moved back onto the wall.");
    doorPos = clamp(doorPos, -0.65, 0.65);
  }
  const doorSide = sideOf(door?.side, "front");
  let interior = Array.isArray(row?.interior) ? readSlots(row.interior, presetSlots(template, width, depth)) : presetSlots(template, width, depth);
  if (interior.length > MAX_SLOTS) {
    notes.push(`Only the first ${MAX_SLOTS} slots were kept.`);
    interior = interior.slice(0, MAX_SLOTS);
  }
  interior = interior.map((item) => pullInside(item, width, depth, floors));
  const seen = new Set<string>();
  interior = interior.map((item, index) => {
    let id = item.id;
    if (seen.has(id)) id = `${item.kind}-${index + 1}`;
    seen.add(id);
    return { ...item, id };
  });
  const windows = Array.isArray(row?.windows)
    ? row.windows
        .map((item) => {
          const win = asRecord(item);
          if (!win) return null;
          const floor: 1 | 2 = win.floor === 2 && floors === 2 ? 2 : 1;
          return { side: sideOf(win.side, "left"), position: clamp(typeof win.position === "number" ? win.position : 0, -0.8, 0.8), floor };
        })
        .filter((item): item is BuildingBody["windows"][number] => item !== null)
        .slice(0, 8)
    : windowsFor(base.windows, floors, doorSide);
  const spec: BuildingBody = {
    kind: "building",
    template,
    footprint: { width: Math.round(width * 100) / 100, depth: Math.round(depth * 100) / 100 },
    floors,
    wall: {
      style: WALL_STYLES.includes(wall?.style as WallStyle) ? (wall?.style as WallStyle) : base.wall,
      colour: colourOf(wall?.colour, base.wallColour),
    },
    roof: {
      style: ROOF_STYLES.includes(roof?.style as RoofStyle) ? (roof?.style as RoofStyle) : base.roof,
      colour: colourOf(roof?.colour, base.roofColour),
    },
    door: { side: doorSide, position: Math.round(doorPos * 100) / 100 },
    windows,
    chimney: row?.chimney === true || (row?.chimney === undefined && base.chimney),
    skylight: row?.skylight === true || (row?.skylight === undefined && base.skylight),
    sign: typeof row?.sign === "string" ? row.sign.trim().slice(0, 24) : "",
    interior,
  };
  const pad = doorPad(spec);
  const outside =
    Math.abs(pad.x) > spec.footprint.width / 2 + 0.2 || Math.abs(pad.z) > spec.footprint.depth / 2 + 0.2;
  if (!outside) {
    notes.push("The door was moved to the front so a path can reach it.");
    spec.door = { side: "front", position: 0 };
  }
  return { spec, notes };
}

export function buildingBlueprint(body: BuildingBody) {
  return {
    primitives: [
      {
        shape: "box" as const,
        size: [0.04, 0.04, 0.04] as [number, number, number],
        position: [0, 0.02, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        colour: body.wall.colour,
      },
    ],
    building: body,
  };
}

const VILLAGE: Record<"home" | "library" | "workshop" | "gallery" | "mailbox", { template: BuildingTemplate; sign: string; params: BuildingParams }> = {
  home: { template: "cottage", sign: "Home", params: { wall_colour: "#f4efe4", roof_colour: "#8d4a3a", roof_style: "gable", window_count: 4, door_side: "front", chimney: true } },
  library: { template: "tower", sign: "Library", params: { wall_colour: "#d9d3c7", roof_colour: "#6e5a78", roof_style: "gable", window_count: 6, door_side: "front", chimney: false } },
  workshop: { template: "workshop", sign: "Studio", params: { wall_colour: "#c4956a", roof_colour: "#9a4530", roof_style: "gable", window_count: 4, door_side: "front", chimney: true } },
  gallery: { template: "pavilion", sign: "Gallery", params: { wall_colour: "#f7f4ee", roof_colour: "#e4d7c4", roof_style: "hip", window_count: 6, door_side: "front", chimney: false } },
  mailbox: { template: "stall", sign: "Mailbox", params: { wall_colour: "#f0d7c4", roof_colour: "#a33b32", roof_style: "gable", window_count: 2, door_side: "front", chimney: false } },
};

export function villageBuilding(which: keyof typeof VILLAGE): BuildingBody {
  const item = VILLAGE[which];
  return fromTemplate(item.template, item.params, undefined, item.sign).spec;
}

export type PlacementItem = {
  id: string;
  type: string;
  status: string;
  favourite: boolean;
  archived: boolean;
};

export function autoAssign(
  spec: BuildingBody,
  buildingName: string,
  items: PlacementItem[],
  taken: Set<string>,
  usedSlots: Set<string>,
): { creationId: string; slot: string }[] {
  const name = buildingName.toLowerCase();
  const pool = items.filter((item) => !item.archived && !taken.has(item.id));
  const wanted = pool.filter((item) => {
    if (name === "gallery") return item.status === "finished" || item.status === "published";
    if (name === "studio" || name === "workshop") return item.status === "draft";
    if (name === "home") return item.favourite && item.status !== "draft";
    if (name === "library" || name === "mailbox") return false;
    return item.status !== "draft";
  });
  const placed: { creationId: string; slot: string }[] = [];
  const used = new Set(usedSlots);
  for (const item of wanted) {
    const fit = spec.interior.find((entry) => !used.has(entry.id) && entry.accepts.includes(item.type));
    if (!fit) continue;
    used.add(fit.id);
    taken.add(item.id);
    placed.push({ creationId: item.id, slot: fit.id });
  }
  return placed;
}
