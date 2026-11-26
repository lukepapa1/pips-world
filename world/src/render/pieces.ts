import * as THREE from "three";
import type { BuildableType } from "@pips/shared";

function mat(
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0, ...extra });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const item = new THREE.Mesh(geometry, material);
  item.position.set(x, y, z);
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function parseTree(style: string): { crown: "round" | "cone"; scale: number; slot: number } {
  const [crown, scaleRaw, slotRaw] = style.split(":");
  const scale = Number(scaleRaw);
  const slot = Number(slotRaw);
  return {
    crown: crown === "cone" ? "cone" : "round",
    scale: Number.isFinite(scale) && scale > 0.2 && scale < 3 ? scale : 1,
    slot: Number.isFinite(slot) ? Math.max(0, Math.min(2, Math.floor(slot))) : 0,
  };
}

function makeTree(style: string): THREE.Group {
  const spec = parseTree(style);
  const group = new THREE.Group();
  const trunk = mat("#6d4c34", { roughness: 0.95 });
  group.add(mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.72, 6), trunk, 0, 0.36, 0));
  const greens = ["#3f6d3c", "#4e8248", "#2f5a34"];
  const leaf = mat(greens[spec.slot] ?? "#3f6d3c", { roughness: 0.95, flatShading: true });
  const leaves: THREE.Mesh[] = [];
  if (spec.crown === "round") {
    const canopy = mesh(new THREE.IcosahedronGeometry(0.62, 0), leaf, 0, 1.05, 0);
    canopy.scale.set(1, 0.82, 1);
    const side = mesh(new THREE.IcosahedronGeometry(0.38, 0), leaf, 0.28, 0.82, 0.1);
    leaves.push(canopy, side);
  } else {
    leaves.push(
      mesh(new THREE.ConeGeometry(0.62, 0.95, 7), leaf, 0, 1.05, 0),
      mesh(new THREE.ConeGeometry(0.42, 0.75, 7), leaf, 0, 1.62, 0),
    );
  }
  for (const part of leaves) {
    part.userData.leafSlot = spec.slot;
    group.add(part);
  }
  group.scale.setScalar(spec.scale);
  group.userData.leaves = leaves;
  group.userData.seed = spec.slot * 2.1 + spec.scale;
  return group;
}

function makeBench(): THREE.Group {
  const group = new THREE.Group();
  const wood = mat("#8b5a32", { roughness: 0.8 });
  const dark = mat("#5c3b24", { roughness: 0.86 });
  group.add(mesh(new THREE.BoxGeometry(1.05, 0.07, 0.34), wood, 0, 0.42, 0));
  group.add(mesh(new THREE.BoxGeometry(1.05, 0.42, 0.05), wood, 0, 0.64, -0.14));
  for (const x of [-0.42, 0.42]) {
    group.add(mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), dark, x, 0.2, 0.1));
    group.add(mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), dark, x, 0.2, -0.1));
  }
  return group;
}

function makeGarden(): THREE.Group {
  const group = new THREE.Group();
  const wood = mat("#9a6a3a", { roughness: 0.84 });
  const soil = mat("#5a3d28", { roughness: 1 });
  const leaf = mat("#3f7a3c", { roughness: 0.8 });
  group.add(mesh(new THREE.BoxGeometry(1.15, 0.22, 0.72), wood, 0, 0.11, 0));
  group.add(mesh(new THREE.BoxGeometry(1.0, 0.08, 0.56), soil, 0, 0.22, 0));
  for (const x of [-0.28, 0, 0.28]) {
    group.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 5), leaf, x, 0.32, 0));
    group.add(mesh(new THREE.SphereGeometry(0.08, 7, 6), leaf, x, 0.44, 0));
  }
  return group;
}

function makeShelf(): THREE.Group {
  const group = new THREE.Group();
  const wood = mat("#6b4630", { roughness: 0.82 });
  const page = mat("#f4efe4", { roughness: 0.9 });
  group.add(mesh(new THREE.BoxGeometry(0.06, 0.9, 0.28), wood, -0.32, 0.45, 0));
  group.add(mesh(new THREE.BoxGeometry(0.06, 0.9, 0.28), wood, 0.32, 0.45, 0));
  for (const y of [0.12, 0.42, 0.72]) {
    group.add(mesh(new THREE.BoxGeometry(0.7, 0.04, 0.28), wood, 0, y, 0));
  }
  group.add(mesh(new THREE.BoxGeometry(0.08, 0.2, 0.18), mat("#7c2e2a"), -0.16, 0.24, 0));
  group.add(mesh(new THREE.BoxGeometry(0.07, 0.18, 0.16), mat("#2f4d6b"), 0.02, 0.53, 0));
  group.add(mesh(new THREE.BoxGeometry(0.05, 0.16, 0.14), page, 0.16, 0.22, 0));
  return group;
}

function makeLamp(): THREE.Group {
  const group = new THREE.Group();
  const post = mat("#3e332c", { roughness: 0.9 });
  const bulbMat = mat("#ffd7a1", { emissive: "#ffb15a", emissiveIntensity: 0.2, roughness: 0.35 });
  group.add(mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.15, 6), post, 0, 0.58, 0));
  const bulb = mesh(new THREE.SphereGeometry(0.09, 10, 8), bulbMat, 0, 1.22, 0);
  bulb.name = "bulb";
  group.add(bulb);
  group.add(mesh(new THREE.ConeGeometry(0.16, 0.12, 8), post, 0, 1.36, 0));
  return group;
}

function makeFlowers(): THREE.Group {
  const group = new THREE.Group();
  const dirt = mat("#6b4a32", { roughness: 1 });
  const stem = mat("#3e6b38", { roughness: 0.9 });
  const petals = ["#e07a5f", "#f2cc8f", "#f7f3ea", "#e7a0bf", "#f0a36b"];
  group.add(mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.06, 10), dirt, 0, 0.03, 0));
  const spots: [number, number][] = [
    [0, 0],
    [0.18, 0.1],
    [-0.16, 0.12],
    [0.08, -0.16],
    [-0.14, -0.1],
  ];
  spots.forEach(([x, z], index) => {
    group.add(mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.1, 4), stem, x, 0.1, z));
    group.add(mesh(new THREE.IcosahedronGeometry(0.06, 0), mat(petals[index] ?? "#e07a5f"), x, 0.18, z));
  });
  return group;
}

function makeFence(): THREE.Group {
  const group = new THREE.Group();
  const wood = mat("#b08968", { roughness: 0.86 });
  group.add(mesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), wood, -0.62, 0.31, 0));
  group.add(mesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), wood, 0.62, 0.31, 0));
  group.add(mesh(new THREE.BoxGeometry(1.3, 0.05, 0.04), wood, 0, 0.48, 0));
  group.add(mesh(new THREE.BoxGeometry(1.3, 0.05, 0.04), wood, 0, 0.28, 0));
  return group;
}

function makePath(): THREE.Group {
  const group = new THREE.Group();
  const stone = mat("#d9d1c3", { roughness: 0.95 });
  const tile = mesh(new THREE.BoxGeometry(0.72, 0.05, 0.72), stone, 0, 0.025, 0);
  tile.castShadow = false;
  group.add(tile);
  return group;
}

export function makePiece(type: BuildableType, style: string): THREE.Group {
  const group =
    type === "tree"
      ? makeTree(style)
      : type === "bench"
        ? makeBench()
        : type === "garden_bed"
          ? makeGarden()
          : type === "shelf"
            ? makeShelf()
            : type === "lamp"
              ? makeLamp()
              : type === "flower_patch"
                ? makeFlowers()
                : type === "fence"
                  ? makeFence()
                  : makePath();
  group.userData.piece = type;
  group.userData.style = style;
  return group;
}
