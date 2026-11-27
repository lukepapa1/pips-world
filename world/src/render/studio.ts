import * as THREE from "three";
import type { CreationView } from "@pips/shared";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function paperTexture(sketch: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the studio canvas.");
  ctx.fillStyle = "#f6f0e4";
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "#e4d5c0";
  ctx.lineWidth = 8;
  ctx.strokeRect(14, 14, 228, 228);
  if (sketch) {
    ctx.strokeStyle = "#5c4636";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(54, 176);
    ctx.quadraticCurveTo(96, 118, 132, 154);
    ctx.quadraticCurveTo(168, 96, 206, 132);
    ctx.moveTo(78, 86);
    ctx.lineTo(78, 168);
    ctx.moveTo(156, 78);
    ctx.arc(156, 78, 18, 0, Math.PI * 2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const blankSketch = paperTexture(true);

function clear(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const item of materials) {
        if (item instanceof THREE.MeshStandardMaterial && item.map && item.map !== blankSketch) item.map.dispose();
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
      if (current.map && current.map !== blankSketch) current.map.dispose();
      current.map = texture;
      current.needsUpdate = true;
    }
  };
  image.src = url;
}

function setMap(mesh: THREE.Mesh, texture: THREE.Texture): void {
  const current = mesh.material;
  if (!(current instanceof THREE.MeshStandardMaterial)) return;
  if (current.map && current.map !== blankSketch && current.map !== texture) current.map.dispose();
  current.map = texture;
  current.needsUpdate = true;
}

type WorkMode = "art" | "design" | "writing" | "screen" | "mechanic" | null;

const fx = {
  root: null as THREE.Group | null,
  mode: null as WorkMode,
  art: null as THREE.Group | null,
  design: null as THREE.Group | null,
  writing: null as THREE.Group | null,
  screen: null as THREE.Group | null,
  screenMat: null as THREE.MeshStandardMaterial | null,
  mechanic: null as THREE.Group | null,
  brush: null as THREE.Object3D | null,
  dabs: [] as THREE.Object3D[],
  sheets: [] as THREE.Object3D[],
  pages: [] as THREE.Object3D[],
  gears: [] as THREE.Object3D[],
};

function showMode(mode: WorkMode): void {
  fx.mode = mode;
  if (fx.art) fx.art.visible = mode === "art";
  if (fx.design) fx.design.visible = mode === "design";
  if (fx.writing) fx.writing.visible = mode === "writing";
  if (fx.screen) fx.screen.visible = mode === "screen";
  if (fx.mechanic) fx.mechanic.visible = mode === "mechanic";
  if (fx.root) fx.root.visible = mode !== null;
}

function modeOf(type: string): WorkMode {
  if (type === "art") return "art";
  if (type === "design") return "design";
  if (type === "writing") return "writing";
  if (type === "game" || type === "site") return "screen";
  if (type === "mechanic") return "mechanic";
  return null;
}

function buildEffects(): THREE.Group {
  const root = new THREE.Group();
  root.name = "studio-fx";

  const art = new THREE.Group();
  art.name = "fx-art";
  const brush = new THREE.Group();
  brush.add(box(0.05, 0.22, 0.04, "#6b4126", 0, 0.08, 0));
  brush.add(box(0.07, 0.05, 0.05, "#c23b3b", 0, -0.04, 0));
  brush.position.set(-0.05, 0.9, 1.12);
  art.add(brush);
  fx.brush = brush;
  const dabColours = ["#c23b3b", "#2f5f9a", "#e2b33a", "#3d7a4a"];
  dabColours.forEach((colour, index) => {
    const dab = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), material(colour, 0.55));
    dab.position.set(-0.28 + index * 0.14, 0.78 + (index % 2) * 0.12, 1.08);
    art.add(dab);
    fx.dabs.push(dab);
  });
  root.add(art);
  fx.art = art;

  const design = new THREE.Group();
  design.name = "fx-design";
  for (let index = 0; index < 3; index += 1) {
    const sheet = box(0.28, 0.01, 0.36, index === 1 ? "#d5e4f5" : "#f7f4ee", 1.15 + index * 0.08, 1.05, -0.05);
    sheet.rotation.y = -0.4 + index * 0.35;
    design.add(sheet);
    fx.sheets.push(sheet);
  }
  root.add(design);
  fx.design = design;

  const writing = new THREE.Group();
  writing.name = "fx-writing";
  const left = box(0.22, 0.012, 0.3, "#f4efe4", 1.15, 0.8, -0.15);
  const right = box(0.22, 0.012, 0.3, "#fffaf2", 1.4, 0.8, -0.15);
  writing.add(left, right);
  fx.pages.push(left, right);
  root.add(writing);
  fx.writing = writing;

  const screen = new THREE.Group();
  screen.name = "fx-screen";
  screen.add(box(0.34, 0.24, 0.04, "#2c3a4e", 1.45, 0.95, 0.05));
  const glow = new THREE.MeshStandardMaterial({
    color: "#d7ecff",
    emissive: "#9fd0ff",
    emissiveIntensity: 0.4,
    roughness: 0.35,
  });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.02), glow);
  glass.position.set(1.45, 0.95, 0.08);
  screen.add(glass);
  fx.screenMat = glow;
  root.add(screen);
  fx.screen = screen;

  const mechanic = new THREE.Group();
  mechanic.name = "fx-mechanic";
  const gearMat = material("#c47a4a", 0.45);
  for (const [x, scale] of [
    [1.2, 1],
    [1.48, 0.72],
  ] as const) {
    const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * scale, 0.1 * scale, 0.04, 8), gearMat);
    gear.position.set(x, 0.86, -0.05);
    mechanic.add(gear);
    fx.gears.push(gear);
  }
  root.add(mechanic);
  fx.mechanic = mechanic;

  showMode(null);
  fx.root = root;
  return root;
}

function ensureStudio(parent: THREE.Group): THREE.Mesh {
  const found = parent.getObjectByName("studio-canvas");
  const canvas = found instanceof THREE.Mesh ? found : box(0.42, 0.52, 0.03, "#f6f0e4", -0.17, 0.86, 1.02);
  if (!(found instanceof THREE.Mesh)) {
    canvas.name = "studio-canvas";
    setMap(canvas, blankSketch);
    parent.add(canvas);
  }
  if (!parent.getObjectByName("studio-fx")) parent.add(buildEffects());
  let extras = parent.getObjectByName("studio-extras");
  if (!(extras instanceof THREE.Group)) {
    extras = new THREE.Group();
    extras.name = "studio-extras";
    parent.add(extras);
  }
  return canvas;
}

export function updateStudioFx(time: number): void {
  if (!fx.root || !fx.mode || reduceMotion) return;
  if (fx.mode === "art" && fx.brush) {
    fx.brush.position.x = -0.22 + Math.sin(time * 2.4) * 0.16;
    fx.brush.position.y = 0.78 + Math.cos(time * 1.8) * 0.1;
    fx.dabs.forEach((dab, index) => {
      const pulse = (Math.sin(time * 3.1 + index * 1.3) + 1) / 2;
      dab.scale.setScalar(0.35 + pulse);
      dab.position.z = 1.06 + pulse * 0.03;
    });
  } else if (fx.mode === "design") {
    fx.sheets.forEach((sheet, index) => {
      sheet.position.y = 1.02 + Math.sin(time * 1.4 + index) * 0.08;
      sheet.rotation.y = -0.5 + index * 0.4 + Math.sin(time * 0.8 + index) * 0.15;
    });
  } else if (fx.mode === "writing") {
    const flip = Math.sin(time * 2.2);
    const page = fx.pages[1];
    if (page) page.rotation.y = flip > 0 ? flip * 0.9 : 0;
  } else if (fx.mode === "screen" && fx.screenMat) {
    fx.screenMat.emissiveIntensity = 0.35 + (Math.sin(time * 3) + 1) * 0.35;
  } else if (fx.mode === "mechanic") {
    fx.gears.forEach((gear, index) => {
      gear.rotation.y = time * (index === 0 ? 1.6 : -2.1);
    });
  }
}

let studioKey = "";
let galleryKey = "";
const galleryAim = new THREE.Vector3(-1.35, 0.9, -1.55);

function displayPiece(item: CreationView): THREE.Group {
  const group = new THREE.Group();
  group.userData.creationId = item.id;
  const thumb = item.versions.at(-1)?.thumbnailUrl ?? null;
  if (item.type === "art") {
    group.add(box(0.42, 0.5, 0.04, "#efe8dc", 0, 0, 0));
    const canvas = box(0.32, 0.38, 0.02, "#f7f1e6", 0, 0, 0.03);
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
    group.add(box(0.28, 0.42, 0.2, "#2f3b52", 0, 0.24, 0));
    const screen = box(0.18, 0.14, 0.02, "#d7ecff", 0, 0.34, 0.1);
    group.add(screen);
    if (thumb) paint(thumb, screen);
    return group;
  }
  if (item.type === "design") {
    group.add(box(0.28, 0.08, 0.28, "#d9d0c3", 0, 0.08, 0));
    group.add(box(0.14, 0.18, 0.14, "#7f9a62", 0, 0.22, 0));
    return group;
  }
  if (item.type === "site") {
    group.add(box(0.24, 0.32, 0.14, "#efe8dc", 0, 0.2, 0));
    const screen = box(0.16, 0.14, 0.02, "#f7f1e6", 0, 0.26, 0.08);
    group.add(screen);
    if (thumb) paint(thumb, screen);
    return group;
  }
  group.add(box(0.22, 0.1, 0.22, "#8d6a45", 0, 0.08, 0));
  group.add(box(0.1, 0.16, 0.1, "#c4553a", 0, 0.22, 0));
  return group;
}

const GALLERY_SLOTS: [number, number, number][] = [
  [-1.35, 0.85, -1.55],
  [0.2, 0.85, -1.55],
  [1.35, 0.55, -1.5],
  [-1.55, 0.72, -0.15],
  [0.15, 0.55, -0.35],
  [1.55, 0.62, 0.15],
  [-0.55, 0.35, 0.15],
  [0.85, 1.15, -1.55],
];

export function syncStudio(parent: THREE.Group, drafts: CreationView[]): void {
  const canvas = ensureStudio(parent);
  const key = drafts.map((item) => `${item.id}:${item.updatedAt}:${item.versions.length}`).join("|");
  if (key === studioKey) return;
  studioKey = key;
  const extras = parent.getObjectByName("studio-extras");
  if (extras instanceof THREE.Group) clear(extras);
  const [main, ...rest] = drafts;
  if (!main) {
    delete canvas.userData.creationId;
    setMap(canvas, blankSketch);
    showMode(null);
    return;
  }
  canvas.userData.creationId = main.id;
  const thumb = main.versions.at(-1)?.thumbnailUrl ?? null;
  if (thumb) paint(thumb, canvas);
  else setMap(canvas, blankSketch);
  showMode(modeOf(main.type));
  if (!(extras instanceof THREE.Group)) return;
  rest.slice(0, 3).forEach((item, index) => {
    const card = box(0.16, 0.2, 0.02, "#f6f0e4", -1.85 + index * 0.2, 1.38, -1.9);
    card.userData.creationId = item.id;
    const url = item.versions.at(-1)?.thumbnailUrl ?? null;
    if (url) paint(url, card);
    else setMap(card, blankSketch);
    extras.add(card);
  });
}

export function syncGallery(parent: THREE.Group, items: CreationView[]): THREE.Vector3 {
  const key = items.map((item) => `${item.id}:${item.updatedAt}:${item.favourite ? 1 : 0}`).join("|");
  if (key !== galleryKey) {
    galleryKey = key;
    clear(parent);
    items.forEach((item, index) => {
      const piece = displayPiece(item);
      const slot = GALLERY_SLOTS[index % GALLERY_SLOTS.length] ?? GALLERY_SLOTS[0];
      const stack = Math.floor(index / GALLERY_SLOTS.length);
      if (!slot) return;
      piece.position.set(slot[0], slot[1] + stack * 0.35, slot[2] + stack * 0.08);
      piece.scale.setScalar(stack > 0 ? 0.75 : 1);
      parent.add(piece);
    });
  }
  const first = parent.children[0];
  if (first) galleryAim.set(first.position.x, first.position.y + 0.15, first.position.z);
  else galleryAim.set(-1.35, 0.9, -1.55);
  return galleryAim;
}
