import type { BlueprintSpec } from "./blueprint.js";

const zero: [number, number, number] = [0, 0, 0];

function box(
  size: [number, number, number],
  position: [number, number, number],
  colour: string,
): BlueprintSpec["primitives"][number] {
  return { shape: "box", size, position, rotation: zero, colour };
}

function cylinder(
  size: [number, number, number],
  position: [number, number, number],
  colour: string,
  extra: Partial<BlueprintSpec["primitives"][number]> = {},
): BlueprintSpec["primitives"][number] {
  return { shape: "cylinder", size, position, rotation: zero, colour, ...extra };
}

function cone(
  size: [number, number, number],
  position: [number, number, number],
  colour: string,
  extra: Partial<BlueprintSpec["primitives"][number]> = {},
): BlueprintSpec["primitives"][number] {
  return { shape: "cone", size, position, rotation: zero, colour, ...extra };
}

function sphere(
  size: [number, number, number],
  position: [number, number, number],
  colour: string,
  extra: Partial<BlueprintSpec["primitives"][number]> = {},
): BlueprintSpec["primitives"][number] {
  return { shape: "sphere", size, position, rotation: zero, colour, ...extra };
}

/** The starter pieces, as data. Version 1 of each name. */
export const STARTER_BLUEPRINTS: { name: string; spec: BlueprintSpec }[] = [
  {
    name: "tree",
    spec: {
      behaviour: "sway",
      parameters: { height: 1, canopy_layers: 1 },
      primitives: [
        cylinder([0.18, 0.72, 0.22], [0, 0.36, 0], "#6d4c34"),
        sphere([1.24, 1.02, 1.24], [0, 1.05, 0], "#3f6d3c", { foliage: true, layer: 1 }),
        sphere([0.76, 0.7, 0.76], [0.28, 0.82, 0.1], "#4e8248", { foliage: true, layer: 1 }),
      ],
    },
  },
  {
    name: "bench",
    spec: {
      primitives: [
        box([1.05, 0.07, 0.34], [0, 0.42, 0], "#8b5a32"),
        box([1.05, 0.42, 0.05], [0, 0.64, -0.14], "#8b5a32"),
        box([0.06, 0.4, 0.06], [-0.42, 0.2, 0.1], "#5c3b24"),
        box([0.06, 0.4, 0.06], [-0.42, 0.2, -0.1], "#5c3b24"),
        box([0.06, 0.4, 0.06], [0.42, 0.2, 0.1], "#5c3b24"),
        box([0.06, 0.4, 0.06], [0.42, 0.2, -0.1], "#5c3b24"),
      ],
    },
  },
  {
    name: "garden_bed",
    spec: {
      primitives: [
        box([1.15, 0.22, 0.72], [0, 0.11, 0], "#9a6a3a"),
        box([1.0, 0.08, 0.56], [0, 0.22, 0], "#5a3d28"),
        cylinder([0.04, 0.16, 0.04], [-0.28, 0.32, 0], "#3f7a3c", { foliage: true }),
        sphere([0.16, 0.16, 0.16], [-0.28, 0.44, 0], "#3f7a3c", { foliage: true }),
        cylinder([0.04, 0.16, 0.04], [0, 0.32, 0], "#3f7a3c", { foliage: true }),
        sphere([0.16, 0.16, 0.16], [0, 0.44, 0], "#3f7a3c", { foliage: true }),
        cylinder([0.04, 0.16, 0.04], [0.28, 0.32, 0], "#3f7a3c", { foliage: true }),
        sphere([0.16, 0.16, 0.16], [0.28, 0.44, 0], "#3f7a3c", { foliage: true }),
      ],
    },
  },
  {
    name: "shelf",
    spec: {
      primitives: [
        box([0.06, 0.9, 0.28], [-0.32, 0.45, 0], "#6b4630"),
        box([0.06, 0.9, 0.28], [0.32, 0.45, 0], "#6b4630"),
        box([0.7, 0.04, 0.28], [0, 0.12, 0], "#6b4630"),
        box([0.7, 0.04, 0.28], [0, 0.42, 0], "#6b4630"),
        box([0.7, 0.04, 0.28], [0, 0.72, 0], "#6b4630"),
        box([0.08, 0.2, 0.18], [-0.16, 0.24, 0], "#7c2e2a"),
        box([0.07, 0.18, 0.16], [0.02, 0.53, 0], "#2f4d6b"),
        box([0.05, 0.16, 0.14], [0.16, 0.22, 0], "#f4efe4"),
      ],
    },
  },
  {
    name: "lamp",
    spec: {
      primitives: [
        cylinder([0.1, 1.15, 0.12], [0, 0.58, 0], "#3e332c"),
        sphere([0.18, 0.18, 0.18], [0, 1.22, 0], "#ffd7a1", { emissive: true }),
        cone([0.32, 0.12, 0.32], [0, 1.36, 0], "#3e332c"),
      ],
    },
  },
  {
    name: "flower_patch",
    spec: {
      primitives: [
        cylinder([0.84, 0.06, 0.92], [0, 0.03, 0], "#6b4a32"),
        cylinder([0.028, 0.1, 0.028], [0, 0.1, 0], "#3e6b38"),
        sphere([0.12, 0.12, 0.12], [0, 0.18, 0], "#e07a5f"),
        cylinder([0.028, 0.1, 0.028], [0.18, 0.1, 0.1], "#3e6b38"),
        sphere([0.12, 0.12, 0.12], [0.18, 0.18, 0.1], "#f2cc8f"),
        cylinder([0.028, 0.1, 0.028], [-0.16, 0.1, 0.12], "#3e6b38"),
        sphere([0.12, 0.12, 0.12], [-0.16, 0.18, 0.12], "#f7f3ea"),
        cylinder([0.028, 0.1, 0.028], [0.08, 0.1, -0.16], "#3e6b38"),
        sphere([0.12, 0.12, 0.12], [0.08, 0.18, -0.16], "#e7a0bf"),
        cylinder([0.028, 0.1, 0.028], [-0.14, 0.1, -0.1], "#3e6b38"),
        sphere([0.12, 0.12, 0.12], [-0.14, 0.18, -0.1], "#f0a36b"),
      ],
    },
  },
  {
    name: "fence",
    spec: {
      primitives: [
        box([0.06, 0.62, 0.06], [-0.62, 0.31, 0], "#b08968"),
        box([0.06, 0.62, 0.06], [0.62, 0.31, 0], "#b08968"),
        box([1.3, 0.05, 0.04], [0, 0.48, 0], "#b08968"),
        box([1.3, 0.05, 0.04], [0, 0.28, 0], "#b08968"),
      ],
    },
  },
  {
    name: "path_tile",
    spec: {
      primitives: [box([0.72, 0.05, 0.72], [0, 0.025, 0], "#d9d1c3")],
    },
  },
];
