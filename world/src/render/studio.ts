import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { CreationView } from "@pips/shared";

function material(color: string, rough = 0.86): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough });
}

function box(
  width: number,
  height: number,
  depth: number,
  color: string,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function addStudioFurniture(workshop: THREE.Group): void {
  const bench = new THREE.Group();
  bench.name = "workbench";
  bench.add(box(0.92, 0.08, 0.48, "#d7bf93", 0.55, 0.62, 1.28));
  for (const [x, z] of [
    [0.18, 1.1],
    [0.92, 1.1],
    [0.18, 1.46],
    [0.92, 1.46],
  ] as const) {
    bench.add(box(0.07, 0.58, 0.07, "#7a4a2c", x, 0.3, z));
  }
  workshop.add(bench);

  const easel = new THREE.Group();
  easel.name = "easel";
  easel.add(box(0.05, 0.95, 0.05, "#6b4126", -0.78, 0.5, 1.2));
  easel.add(box(0.05, 0.95, 0.05, "#6b4126", -0.4, 0.5, 1.2));
  easel.add(box(0.48, 0.05, 0.05, "#6b4126", -0.59, 0.98, 1.2));
  easel.add(box(0.05, 0.7, 0.05, "#6b4126", -0.59, 0.4, 1.42));
  workshop.add(easel);

  const shelves = new THREE.Group();
  shelves.name = "shelves";
  shelves.add(box(0.72, 0.05, 0.24, "#b98a58", 1.05, 0.58, 0.42));
  shelves.add(box(0.72, 0.05, 0.24, "#b98a58", 1.05, 0.98, 0.42));
  shelves.add(box(0.05, 0.72, 0.05, "#7a4a2c", 0.72, 0.72, 0.34));
  shelves.add(box(0.05, 0.72, 0.05, "#7a4a2c", 1.38, 0.72, 0.34));
  workshop.add(shelves);

  const tag = document.createElement("div");
  tag.className = "sign";
  tag.textContent = "Studio";
  const label = new CSS2DObject(tag);
  label.position.set(-5, 1.6, -0.4);
  workshop.add(label);
}

function clear(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const item of materials) {
        if (item instanceof THREE.MeshStandardMaterial && item.map) item.map.dispose();
        item.dispose();
      }
    });
  }
}

function paint(url: string, mesh: THREE.Mesh): void {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f7f1e6";
    ctx.fillRect(0, 0, 256, 256);
    const scale = Math.min(256 / image.width, 256 / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const current = mesh.material;
    if (current instanceof THREE.MeshStandardMaterial) {
      current.map = texture;
      current.needsUpdate = true;
    }
  };
  image.src = url;
}

function workPiece(item: CreationView): THREE.Group {
  const group = new THREE.Group();
  group.userData.creationId = item.id;
  const thumb = item.versions.at(-1)?.thumbnailUrl ?? null;
  if (item.type === "art") {
    const canvas = box(0.46, 0.56, 0.03, "#f7f1e6", 0, 0, 0);
    group.add(canvas);
    if (thumb) paint(thumb, canvas);
    return group;
  }
  if (item.type === "writing") {
    group.add(box(0.34, 0.02, 0.42, "#f4efe4", 0, 0, 0));
    group.add(box(0.32, 0.02, 0.4, "#fffaf2", 0.02, 0.03, 0.02));
    group.add(box(0.3, 0.02, 0.38, "#efe6d4", -0.02, 0.06, -0.02));
    return group;
  }
  if (item.type === "game" || item.type === "site") {
    group.add(box(0.28, 0.42, 0.22, "#3d4a62", 0, 0.16, 0));
    const screen = box(0.2, 0.16, 0.02, "#d7ecff", 0, 0.28, 0.12);
    group.add(screen);
    if (thumb) paint(thumb, screen);
    return group;
  }
  group.add(box(0.22, 0.16, 0.22, "#c47a4a", 0, 0.08, 0));
  group.add(box(0.12, 0.18, 0.12, "#e6d3a1", 0.04, 0.24, 0.02));
  return group;
}

function displayPiece(item: CreationView): THREE.Group {
  const group = new THREE.Group();
  group.userData.creationId = item.id;
  const thumb = item.versions.at(-1)?.thumbnailUrl ?? null;
  if (item.type === "art") {
    group.add(box(0.34, 0.4, 0.03, "#efe8dc", 0, 0.28, 0));
    const canvas = box(0.26, 0.3, 0.02, "#f7f1e6", 0, 0.28, 0.02);
    group.add(canvas);
    if (thumb) paint(thumb, canvas);
    return group;
  }
  if (item.type === "writing") {
    group.add(box(0.34, 0.04, 0.16, "#8d5a34", 0, 0.16, 0));
    group.add(box(0.05, 0.16, 0.12, "#9c3b3b", -0.08, 0.26, 0));
    group.add(box(0.05, 0.18, 0.12, "#355c7d", 0, 0.27, 0));
    group.add(box(0.05, 0.15, 0.12, "#3d6b45", 0.08, 0.25, 0));
    return group;
  }
  if (item.type === "game") {
    group.add(box(0.22, 0.36, 0.18, "#2f3b52", 0, 0.22, 0));
    const screen = box(0.14, 0.12, 0.02, "#d7ecff", 0, 0.32, 0.09);
    group.add(screen);
    if (thumb) paint(thumb, screen);
    return group;
  }
  if (item.type === "design") {
    group.add(box(0.22, 0.08, 0.22, "#d9d0c3", 0, 0.08, 0));
    group.add(box(0.12, 0.16, 0.12, "#7f9a62", 0, 0.2, 0));
    return group;
  }
  if (item.type === "site") {
    group.add(box(0.2, 0.28, 0.12, "#efe8dc", 0, 0.18, 0));
    const screen = box(0.14, 0.12, 0.02, "#f7f1e6", 0, 0.24, 0.06);
    group.add(screen);
    if (thumb) paint(thumb, screen);
    return group;
  }
  group.add(box(0.18, 0.1, 0.18, "#8d6a45", 0, 0.08, 0));
  group.add(box(0.08, 0.14, 0.08, "#c4553a", 0, 0.2, 0));
  return group;
}

let studioKey = "";
let galleryKey = "";

export function syncStudio(parent: THREE.Group, drafts: CreationView[]): void {
  const key = drafts.map((item) => `${item.id}:${item.updatedAt}:${item.versions.length}`).join("|");
  if (key === studioKey) return;
  studioKey = key;
  clear(parent);
  const [main, ...rest] = drafts;
  if (!main) return;
  const piece = workPiece(main);
  if (main.type === "art") piece.position.set(-0.59, 0.72, 1.22);
  else if (main.type === "writing") piece.position.set(0.55, 0.68, 1.28);
  else piece.position.set(0.55, 0.66, 1.28);
  const tag = document.createElement("div");
  tag.className = "sign";
  tag.textContent = `Pip is making: ${main.title}`;
  const label = new CSS2DObject(tag);
  label.position.set(0, 0.48, 0);
  piece.add(label);
  parent.add(piece);
  rest.slice(0, 3).forEach((item, index) => {
    const small = workPiece(item);
    small.scale.setScalar(0.45);
    small.position.set(0.78 + index * 0.18, 1.08, 0.42);
    parent.add(small);
  });
}

export function syncGallery(parent: THREE.Group, items: CreationView[]): void {
  const key = items.map((item) => `${item.id}:${item.updatedAt}:${item.favourite ? 1 : 0}`).join("|");
  if (key === galleryKey) return;
  galleryKey = key;
  clear(parent);
  items.forEach((item, index) => {
    const piece = displayPiece(item);
    const column = index % 4;
    const row = Math.floor(index / 4);
    piece.position.set(-0.75 + column * 0.5, 0.72 + (row % 3) * 0.48, -1.28);
    piece.rotation.y = Math.PI;
    piece.scale.setScalar(row < 3 ? 1 : 0.7);
    parent.add(piece);
  });
}
