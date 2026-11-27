export const PLOT_SIZE = 24;

export const TERRAINS = ["meadow", "forest", "beach", "hills", "wetland", "lake", "rocky"] as const;

export type Terrain = (typeof TERRAINS)[number];

export const PLOT_STATUSES = ["mist", "proposed", "unlocked"] as const;

export type PlotStatus = (typeof PLOT_STATUSES)[number];

export type PlotRecord = {
  id: string;
  gridX: number;
  gridZ: number;
  type: Terrain;
  seed: number;
  status: PlotStatus;
  unlockedAt: string | null;
  name: string;
  notes: string;
};

/** The plots the current village already sits on. (0,0) is centred on the green. */
export const STARTING_PLOTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const BAND = 2.5;

const AMP: Record<Terrain, number> = {
  meadow: 0.16,
  forest: 0.34,
  beach: 0.07,
  hills: 0.9,
  wetland: 0.12,
  lake: 0.08,
  rocky: 1.15,
};

const BASE: Record<Terrain, number> = {
  meadow: 0,
  forest: 0.04,
  beach: -0.02,
  hills: 0.12,
  wetland: -0.05,
  lake: -0.04,
  rocky: 0.06,
};

const RGB: Record<Terrain, [number, number, number]> = {
  meadow: [0.49, 0.6, 0.33],
  forest: [0.25, 0.42, 0.24],
  beach: [0.89, 0.82, 0.66],
  hills: [0.54, 0.6, 0.42],
  wetland: [0.36, 0.48, 0.38],
  lake: [0.42, 0.63, 0.72],
  rocky: [0.54, 0.51, 0.47],
};

export function isStartingPlot(gridX: number, gridZ: number): boolean {
  return STARTING_PLOTS.some(([x, z]) => x === gridX && z === gridZ);
}

export function plotId(gridX: number, gridZ: number): string {
  return `plot_${gridX}_${gridZ}`;
}

export function plotIndex(worldX: number, worldZ: number): { gridX: number; gridZ: number } {
  return {
    gridX: Math.floor((worldX + PLOT_SIZE / 2) / PLOT_SIZE),
    gridZ: Math.floor((worldZ + PLOT_SIZE / 2) / PLOT_SIZE),
  };
}

export function plotBounds(gridX: number, gridZ: number): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  const half = PLOT_SIZE / 2;
  const cx = gridX * PLOT_SIZE;
  const cz = gridZ * PLOT_SIZE;
  return { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
}

export function plotCenter(gridX: number, gridZ: number): { x: number; z: number } {
  return { x: gridX * PLOT_SIZE, z: gridZ * PLOT_SIZE };
}

export function plotNeighbors(gridX: number, gridZ: number): Array<[number, number]> {
  return [
    [gridX + 1, gridZ],
    [gridX - 1, gridZ],
    [gridX, gridZ + 1],
    [gridX, gridZ - 1],
  ];
}

export function parsePlotArg(value: unknown): { gridX: number; gridZ: number } | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase().replace(/^plot_/, "");
  const match = /^(-?\d+)\s*[,_ ]\s*(-?\d+)$/.exec(text);
  if (!match) return null;
  return { gridX: Number(match[1]), gridZ: Number(match[2]) };
}

export function plotSeed(gridX: number, gridZ: number): number {
  let hash = Math.imul(gridX + 17, 374761393) ^ Math.imul(gridZ + 91, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function terrainOf(seed: number): Terrain {
  return TERRAINS[seed % TERRAINS.length] ?? "meadow";
}

export function compassName(gridX: number, gridZ: number): string {
  const north = gridZ > 0 ? "north" : gridZ < 0 ? "south" : "";
  const east = gridX > 0 ? "east" : gridX < 0 ? "west" : "";
  if (north && east) return `${north}-${east}`;
  return north || east || "nearby";
}

export function landWord(type: Terrain): string {
  switch (type) {
    case "forest":
      return "woods";
    case "beach":
      return "shore";
    case "hills":
      return "hills";
    case "wetland":
      return "wetland";
    case "lake":
      return "lake";
    case "rocky":
      return "rocks";
    default:
      return "meadow";
  }
}

export function placeName(gridX: number, gridZ: number, type: Terrain): string {
  if (isStartingPlot(gridX, gridZ)) return "Village";
  return `The ${compassName(gridX, gridZ)} ${landWord(type)}`;
}

export function exploreTitle(gridX: number, gridZ: number, type: Terrain): string {
  return `Explore the ${compassName(gridX, gridZ)} ${landWord(type)}?`;
}

/** A point just inside the plot, on the side nearest the village green. */
export function approachPoint(gridX: number, gridZ: number): { x: number; z: number } {
  const bounds = plotBounds(gridX, gridZ);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const x = Math.min(bounds.maxX, Math.max(bounds.minX, 0));
  const z = Math.min(bounds.maxZ, Math.max(bounds.minZ, 0));
  const dx = cx - x;
  const dz = cz - z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: x + (dx / len) * 3, z: z + (dz / len) * 3 };
}

export function footprintInside(
  gridX: number,
  gridZ: number,
  x: number,
  z: number,
  radius: number,
): boolean {
  const bounds = plotBounds(gridX, gridZ);
  return (
    x - radius >= bounds.minX - 0.02 &&
    x + radius <= bounds.maxX + 0.02 &&
    z - radius >= bounds.minZ - 0.02 &&
    z + radius <= bounds.maxZ + 0.02
  );
}

export function isPlotRecord(value: unknown): value is PlotRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<PlotRecord>;
  return (
    typeof row.id === "string" &&
    typeof row.gridX === "number" &&
    typeof row.gridZ === "number" &&
    typeof row.type === "string" &&
    (TERRAINS as readonly string[]).includes(row.type) &&
    typeof row.seed === "number" &&
    (PLOT_STATUSES as readonly string[]).includes(row.status ?? "") &&
    (row.unlockedAt === null || typeof row.unlockedAt === "string") &&
    typeof row.name === "string" &&
    typeof row.notes === "string"
  );
}

function hash01(ix: number, iz: number): number {
  let hash = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const a = hash01(x0, z0);
  const b = hash01(x0 + 1, z0);
  const c = hash01(x0, z0 + 1);
  const d = hash01(x0 + 1, z0 + 1);
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

function cellWeight(worldX: number, worldZ: number, gridX: number, gridZ: number): number {
  const center = plotCenter(gridX, gridZ);
  const half = PLOT_SIZE / 2;
  const ex = half - Math.abs(worldX - center.x);
  const ez = half - Math.abs(worldZ - center.z);
  if (ex < -BAND || ez < -BAND) return 0;
  if (ex < 0 || ez < 0) {
    const dist = Math.hypot(Math.max(0, -ex), Math.max(0, -ez));
    if (dist > BAND) return 0;
    return 0.5 * (1 - dist / BAND);
  }
  const edge = Math.min(ex, ez);
  if (edge >= BAND) return 1;
  return 0.5 + 0.5 * (edge / BAND);
}

export type TerrainSample = { height: number; r: number; g: number; b: number };

/** Height and colour from world position, so a shared edge matches from both plots. */
export function terrainSample(
  worldX: number,
  worldZ: number,
  typeOf: (gridX: number, gridZ: number) => Terrain | null,
): TerrainSample {
  const here = plotIndex(worldX, worldZ);
  let weightSum = 0;
  let amp = 0;
  let base = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let gridX = here.gridX - 1; gridX <= here.gridX + 1; gridX += 1) {
    for (let gridZ = here.gridZ - 1; gridZ <= here.gridZ + 1; gridZ += 1) {
      const weight = cellWeight(worldX, worldZ, gridX, gridZ);
      if (weight <= 0) continue;
      const type = typeOf(gridX, gridZ) ?? "meadow";
      const rgb = RGB[type];
      let plotBase = BASE[type];
      if (type === "lake") {
        const center = plotCenter(gridX, gridZ);
        const dist = Math.hypot(worldX - center.x, worldZ - center.z) / (PLOT_SIZE / 2);
        plotBase -= (1 - Math.min(1, Math.max(0, dist))) ** 2 * 0.55;
      }
      amp += AMP[type] * weight;
      base += plotBase * weight;
      r += rgb[0] * weight;
      g += rgb[1] * weight;
      b += rgb[2] * weight;
      weightSum += weight;
    }
  }
  if (weightSum <= 0) weightSum = 1;
  const noise = valueNoise(worldX * 0.08, worldZ * 0.08) * 0.65 + valueNoise(worldX * 0.17, worldZ * 0.17) * 0.35;
  return {
    height: base / weightSum + (noise - 0.5) * 2 * (amp / weightSum),
    r: r / weightSum,
    g: g / weightSum,
    b: b / weightSum,
  };
}
