import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { SEASONS, type BuildingId, type Season, BUILDING_NAMES } from "@pips/shared";
import type { Quality } from "./quality";

export type WorldAction = "diary" | "mailbox";

export type Stand = {
  stand: THREE.Vector3;
  door: THREE.Vector3;
};

const RADIUS = 7.15;

const SLOT: Record<BuildingId, number> = {
  home: 0,
  mailbox: 1,
  gallery: 2,
  workshop: 3,
  library: 4,
};

function slotAngle(slot: number): number {
  return Math.PI / 2 - (slot * 2 * Math.PI) / 5;
}

function mat(
  color: string,
  extra: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.84,
    metalness: 0,
    ...extra,
  });
}

function box(
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function gable(width: number, depth: number, height: number): THREE.BufferGeometry {
  const hw = width / 2;
  const hd = depth / 2;
  const positions = [
    -hw, 0, hd, hw, 0, hd, 0, height, hd,
    hw, 0, -hd, -hw, 0, -hd, 0, height, -hd,
    -hw, 0, -hd, -hw, 0, hd, 0, height, hd,
    -hw, 0, -hd, 0, height, hd, 0, height, -hd,
    hw, 0, hd, hw, 0, -hd, 0, height, -hd,
    hw, 0, hd, 0, height, -hd, 0, height, hd,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function mulberry32(seed: number): () => number {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function grassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the ground.");
  const rng = mulberry32(9);
  const wash = ctx.createRadialGradient(512, 512, 40, 512, 512, 520);
  wash.addColorStop(0, "#9cbf78");
  wash.addColorStop(0.55, "#7ea45c");
  wash.addColorStop(1, "#688a48");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, 1024, 1024);

  for (let i = 0; i < 16; i += 1) {
    const x = rng() * 1024;
    const y = rng() * 1024;
    const radius = 46 + rng() * 130;
    const patch = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const dark = rng() > 0.45;
    patch.addColorStop(0, dark ? "rgba(52, 86, 38, 0.42)" : "rgba(214, 226, 140, 0.34)");
    patch.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = patch;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.55 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 2800; i += 1) {
    ctx.fillStyle = i % 3 === 0 ? "rgba(48, 78, 34, 0.18)" : "rgba(244, 232, 170, 0.12)";
    ctx.fillRect(rng() * 1024, rng() * 1024, 2, 3);
  }

  const rim = ctx.createRadialGradient(512, 512, 390, 512, 512, 512);
  rim.addColorStop(0, "rgba(0, 0, 0, 0)");
  rim.addColorStop(1, "rgba(122, 96, 58, 0.38)");
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.fillStyle = "#e6cb9d";
  ctx.beginPath();
  ctx.arc(512, 512, 58, 0, Math.PI * 2);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type SwayMesh = {
  mesh: THREE.InstancedMesh;
  bases: THREE.Matrix4[];
  seeds: number[];
  foliage: boolean;
};

function makeInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  scene: THREE.Scene,
  sway: boolean,
  foliage = false,
): SwayMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (sway) mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  return { mesh, bases: [], seeds: [], foliage };
}

function makeBook(): THREE.Group {
  const book = new THREE.Group();
  const cover = mat("#7c2e2a", { roughness: 0.62 });
  const page = mat("#f6f1e4", { roughness: 0.9 });
  book.add(box(0.06, 0.1, 0.36, cover, 0, 0.05, 0));
  const left = box(0.24, 0.045, 0.34, cover, -0.14, 0.07, 0);
  left.rotation.z = 0.35;
  const right = box(0.24, 0.04, 0.34, cover, 0.15, 0.07, 0);
  right.rotation.z = -0.55;
  const pages = box(0.2, 0.025, 0.3, page, 0.15, 0.1, 0);
  pages.rotation.z = -0.55;
  book.add(left, right, pages);
  return book;
}

function addSign(group: THREE.Group, text: string, badge?: HTMLSpanElement): void {
  const height = new THREE.Box3().setFromObject(group).max.y;
  const element = document.createElement("div");
  element.className = "sign";
  element.append(document.createTextNode(text));
  if (badge) {
    badge.className = "sign-badge";
    badge.hidden = true;
    element.append(badge);
  }
  const label = new CSS2DObject(element);
  label.center.set(0.5, 1);
  label.position.set(0, height + 0.28, 0);
  group.add(label);
}

function place(group: THREE.Group, id: BuildingId): Stand {
  const angle = slotAngle(SLOT[id]);
  const x = Math.cos(angle) * RADIUS;
  const z = Math.sin(angle) * RADIUS;
  group.position.set(x, 0, z);
  group.rotation.y = Math.atan2(-x, -z);
  const standRadius = RADIUS - 2.55;
  return {
    stand: new THREE.Vector3(Math.cos(angle) * standRadius, 0, Math.sin(angle) * standRadius),
    door: new THREE.Vector3(x, 0.7, z),
  };
}

const FLOWER_HIGH = 64;
const FLOWER_LOW = 28;
const ROCK_HIGH = 16;
const ROCK_LOW = 8;

export type Village = {
  stands: Record<BuildingId, Stand>;
  pickables: THREE.Object3D[];
  diaryBadge: HTMLSpanElement;
  mailboxBadge: HTMLSpanElement;
  update(time: number): void;
  setNight(amount: number): void;
  setBrowsing(on: boolean): void;
  setSeason(weights: Record<Season, number>): void;
  setQuality(quality: Quality): void;
};

export function createVillage(scene: THREE.Scene, quality: Quality): Village {
  const cream = mat("#f4e6cf");
  const stone = mat("#e4eef2");
  const wood = mat("#d0894e");
  const white = mat("#f7f5f1");
  const mailWall = mat("#f3efe6");
  const roofHome = mat("#c4543a", { roughness: 0.72, side: THREE.DoubleSide, flatShading: true });
  const roofLibrary = mat("#2c455c", { roughness: 0.7, side: THREE.DoubleSide, flatShading: true });
  const roofWorkshop = mat("#6a3b2a", { roughness: 0.8, side: THREE.DoubleSide, flatShading: true });
  const roofGallery = mat("#d9d3cb", { roughness: 0.65, side: THREE.DoubleSide });
  const roofMail = mat("#b4333a", { roughness: 0.68, side: THREE.DoubleSide, flatShading: true });
  const doorMat = mat("#5c3828", { roughness: 0.78 });
  const trim = mat("#f7f1e6", { roughness: 0.7 });
  const glassWarm = mat("#f0d7a2", {
    emissive: "#f3d7a1",
    emissiveIntensity: 0.45,
    roughness: 0.25,
  });
  const glassCool = mat("#b7d7e2", {
    emissive: "#d5e7ef",
    emissiveIntensity: 0.2,
    roughness: 0.18,
  });
  const libraryGlass = mat("#b7d7e2", {
    emissive: "#d5e7ef",
    emissiveIntensity: 0.2,
    roughness: 0.18,
  });
  const pathMat = mat("#e2c59a", { roughness: 1 });
  const wornMat = mat("#c9aa78", { roughness: 1 });
  const coolDay = new THREE.Color("#d5e7ef");
  const warmGlow = new THREE.Color("#ffb15a");

  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(16, 14.6, 1.5, 56),
    mat("#6a5140", { roughness: 1 }),
  );
  lip.position.y = -0.78;
  lip.receiveShadow = true;
  scene.add(lip);

  const groundMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(16, 64), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const yard = new THREE.Mesh(new THREE.CircleGeometry(1.35, 28), pathMat);
  yard.rotation.x = -Math.PI / 2;
  yard.position.y = 0.025;
  yard.receiveShadow = true;
  scene.add(yard);

  for (const id of Object.keys(SLOT) as BuildingId[]) {
    const angle = slotAngle(SLOT[id]);
    const mid = 3.4;
    const yaw = Math.atan2(Math.cos(angle), Math.sin(angle));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.02, 3.75), wornMat);
    edge.position.set(Math.cos(angle) * mid, 0.02, Math.sin(angle) * mid);
    edge.rotation.y = yaw;
    edge.receiveShadow = true;
    scene.add(edge);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.028, 3.45), pathMat);
    spoke.position.set(Math.cos(angle) * mid, 0.04, Math.sin(angle) * mid);
    spoke.rotation.y = yaw;
    spoke.receiveShadow = true;
    scene.add(spoke);
  }

  const diaryBadge = document.createElement("span");
  const mailboxBadge = document.createElement("span");
  const stands = {} as Record<BuildingId, Stand>;
  const pickables: THREE.Object3D[] = [];
  const smoke: THREE.Mesh[] = [];

  const home = new THREE.Group();
  home.name = "home";
  home.userData.action = "diary";
  home.add(box(2.5, 1.55, 2.05, cream, 0, 0.775, 0));
  const homeRoof = new THREE.Mesh(gable(2.95, 2.45, 0.95), roofHome);
  homeRoof.position.y = 1.55;
  homeRoof.castShadow = true;
  home.add(homeRoof);
  home.add(box(0.34, 0.7, 0.34, mat("#8d4a3a"), 0.72, 2.05, -0.35));
  home.add(box(0.42, 0.16, 0.42, mat("#6d4034"), 0.72, 2.42, -0.35));
  home.add(box(1.05, 1.15, 0.08, mat("#3d2a24"), 0, 0.62, 0.15));
  home.add(box(1.2, 0.1, 0.12, trim, 0, 1.22, 1.05));
  home.add(box(0.1, 1.15, 0.12, trim, -0.55, 0.62, 1.05));
  home.add(box(0.1, 1.15, 0.12, trim, 0.55, 0.62, 1.05));
  home.add(box(0.36, 0.42, 0.06, glassWarm, -0.78, 0.95, 1.04));
  home.add(box(0.36, 0.42, 0.06, glassWarm, 0.78, 0.95, 1.04));
  home.add(box(0.62, 0.46, 0.46, doorMat, 0.78, 0.23, 1.42));
  const book = makeBook();
  book.position.set(0.78, 0.52, 1.42);
  book.rotation.y = -0.6;
  home.add(book);
  for (let i = 0; i < 3; i += 1) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 8, 6),
      mat("#f7f4ee", { transparent: true, opacity: 0.3, depthWrite: false, roughness: 1 }),
    );
    puff.position.set(0.72, 2.5, -0.35);
    home.add(puff);
    smoke.push(puff);
  }
  addSign(home, BUILDING_NAMES.home, diaryBadge);
  stands.home = place(home, "home");
  scene.add(home);
  pickables.push(home);

  const library = new THREE.Group();
  library.name = "library";
  library.add(box(2.3, 2.2, 1.9, stone, 0, 1.1, 0));
  const libraryRoof = new THREE.Mesh(gable(2.7, 2.3, 0.85), roofLibrary);
  libraryRoof.position.y = 2.2;
  libraryRoof.castShadow = true;
  library.add(libraryRoof);
  library.add(box(0.22, 1.35, 0.22, trim, -0.78, 0.68, 0.98));
  library.add(box(0.22, 1.35, 0.22, trim, 0.78, 0.68, 0.98));
  library.add(box(0.7, 1.15, 0.08, doorMat, 0, 0.58, 0.98));
  library.add(box(0.34, 0.46, 0.06, libraryGlass, -0.55, 1.45, 0.98));
  library.add(box(0.34, 0.46, 0.06, libraryGlass, 0.55, 1.45, 0.98));
  library.add(box(0.34, 0.46, 0.06, libraryGlass, -0.55, 0.85, 0.98));
  library.add(box(0.34, 0.46, 0.06, libraryGlass, 0.55, 0.85, 0.98));
  const libraryLight = new THREE.PointLight("#ffd089", 0, 9, 1.4);
  libraryLight.position.set(0, 1.5, 1.4);
  library.add(libraryLight);
  addSign(library, BUILDING_NAMES.library);
  stands.library = place(library, "library");
  scene.add(library);

  const workshop = new THREE.Group();
  workshop.name = "workshop";
  workshop.add(box(2.7, 1.35, 2.05, wood, 0, 0.675, 0));
  const shed = box(2.95, 0.14, 2.35, roofWorkshop, 0, 1.55, 0);
  shed.rotation.x = -0.28;
  workshop.add(shed);
  workshop.add(box(1.15, 1.05, 0.08, doorMat, -0.45, 0.52, 1.05));
  workshop.add(box(0.55, 0.45, 0.06, glassWarm, 0.75, 0.85, 1.05));
  const logMat = mat("#8a5a32", { roughness: 1 });
  for (let i = 0; i < 3; i += 1) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.85, 7), logMat);
    log.rotation.z = Math.PI / 2;
    log.position.set(1.15, 0.16 + i * 0.2, 0.35);
    log.castShadow = true;
    workshop.add(log);
  }
  addSign(workshop, BUILDING_NAMES.workshop);
  stands.workshop = place(workshop, "workshop");
  scene.add(workshop);

  const gallery = new THREE.Group();
  gallery.name = "gallery";
  gallery.add(box(2.45, 1.85, 2.05, white, 0, 0.925, 0));
  gallery.add(box(2.7, 0.12, 2.3, roofGallery, 0, 1.9, 0));
  gallery.add(box(1.35, 1.15, 0.06, glassCool, 0, 0.85, 1.05));
  gallery.add(box(0.08, 0.55, 0.7, trim, 1.45, 0.45, 0.7));
  const frame = box(0.55, 0.7, 0.05, mat("#efe8dc"), 1.15, 0.55, 1.15);
  frame.rotation.y = -0.4;
  gallery.add(frame);
  addSign(gallery, BUILDING_NAMES.gallery);
  stands.gallery = place(gallery, "gallery");
  scene.add(gallery);

  const mailbox = new THREE.Group();
  mailbox.name = "mailbox";
  mailbox.userData.action = "mailbox";
  mailbox.add(box(1.7, 1.45, 1.55, mailWall, 0, 0.725, 0));
  const mailRoof = new THREE.Mesh(gable(2.05, 1.9, 0.7), roofMail);
  mailRoof.position.y = 1.45;
  mailRoof.castShadow = true;
  mailbox.add(mailRoof);
  mailbox.add(box(0.55, 0.9, 0.08, doorMat, 0, 0.45, 0.8));
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 6), doorMat);
  post.position.set(0.95, 0.35, 0.95);
  post.castShadow = true;
  mailbox.add(post);
  mailbox.add(box(0.42, 0.26, 0.22, mat("#c23b3b"), 0.95, 0.78, 0.95));
  const flag = box(0.05, 0.28, 0.16, mat("#e23d3d"), 1.18, 0.98, 0.95);
  flag.rotation.z = -0.4;
  mailbox.add(flag);
  addSign(mailbox, BUILDING_NAMES.mailbox, mailboxBadge);
  stands.mailbox = place(mailbox, "mailbox");
  scene.add(mailbox);
  pickables.push(mailbox);

  const lampMat = mat("#ffd7a1", { emissive: "#ffb15a", emissiveIntensity: 0, roughness: 0.35 });
  const lampPost = mat("#4a3a30", { roughness: 0.9 });
  function addLamp(group: THREE.Group, x: number, y: number, z: number): void {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, y, 5), lampPost);
    post.position.set(x, y / 2, z);
    post.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), lampMat);
    bulb.position.set(x, y, z);
    group.add(post, bulb);
  }
  addLamp(home, -1.05, 1.15, 1.12);
  addLamp(library, -1.05, 1.55, 1.05);
  addLamp(workshop, 1.15, 1.05, 1.12);
  addLamp(gallery, -1.15, 1.25, 1.12);
  addLamp(mailbox, -0.85, 1.05, 0.95);

  const treeRng = mulberry32(17);
  const specs: { round: boolean; x: number; z: number; rot: number; scale: number; seed: number }[] = [];
  for (let i = 0; i < 22; i += 1) {
    const angle = (i / 22) * Math.PI * 2 + (treeRng() - 0.5) * 0.28;
    const radius = 12.15 + treeRng() * 2.35;
    specs.push({
      round: treeRng() > 0.45,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      rot: treeRng() * Math.PI * 2,
      scale: 0.78 + treeRng() * 0.65,
      seed: treeRng() * Math.PI * 2,
    });
  }
  const roundCount = specs.filter((spec) => spec.round).length;
  const coneCount = specs.length - roundCount;
  const trunkGeo = new THREE.CylinderGeometry(0.07, 0.11, 0.72, 6);
  trunkGeo.translate(0, 0.36, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(0.62, 0);
  canopyGeo.scale(1, 0.82, 1);
  canopyGeo.translate(0, 1.05, 0);
  const sideGeo = new THREE.IcosahedronGeometry(0.38, 0);
  sideGeo.translate(0.28, 0.82, 0.1);
  const lowerGeo = new THREE.ConeGeometry(0.62, 0.95, 7);
  lowerGeo.translate(0, 1.05, 0);
  const upperGeo = new THREE.ConeGeometry(0.42, 0.75, 7);
  upperGeo.translate(0, 1.62, 0);
  const trunkMat = mat("#6d4c34", { roughness: 0.95 });
  const leafMat = mat("#ffffff", { roughness: 0.95, flatShading: true });
  const trunks = makeInstances(trunkGeo, trunkMat, specs.length, scene, true);
  const canopies = makeInstances(canopyGeo, leafMat, Math.max(1, roundCount), scene, true, true);
  const sides = makeInstances(sideGeo, leafMat, Math.max(1, roundCount), scene, true, true);
  const lowers = makeInstances(lowerGeo, leafMat, Math.max(1, coneCount), scene, true, true);
  const uppers = makeInstances(upperGeo, leafMat, Math.max(1, coneCount), scene, true, true);
  const leafSlots: { mesh: THREE.InstancedMesh; index: number; slot: number }[] = [];
  const swayParts = [trunks, canopies, sides, lowers, uppers];
  const greens = ["#3f6d3c", "#4e8248", "#2f5a34"];
  const leafColor = new THREE.Color();
  const treePos = new THREE.Vector3();
  const treeQuat = new THREE.Quaternion();
  const treeScale = new THREE.Vector3();
  const treeUp = new THREE.Vector3(0, 1, 0);
  const treeBase = new THREE.Matrix4();

  function pushTree(part: SwayMesh, seed: number): number {
    const index = part.seeds.length;
    part.bases.push(treeBase.clone());
    part.seeds.push(seed);
    part.mesh.setMatrixAt(index, treeBase);
    return index;
  }

  for (const spec of specs) {
    treePos.set(spec.x, 0, spec.z);
    treeQuat.setFromAxisAngle(treeUp, spec.rot);
    treeScale.setScalar(spec.scale);
    treeBase.compose(treePos, treeQuat, treeScale);
    pushTree(trunks, spec.seed);
    const slot = Math.floor(treeRng() * greens.length);
    leafColor.set(greens[slot] ?? "#3f6d3c");
    if (spec.round) {
      const index = pushTree(canopies, spec.seed);
      canopies.mesh.setColorAt(index, leafColor);
      leafSlots.push({ mesh: canopies.mesh, index, slot });
      const sideIndex = pushTree(sides, spec.seed);
      sides.mesh.setColorAt(sideIndex, leafColor);
      leafSlots.push({ mesh: sides.mesh, index: sideIndex, slot });
    } else {
      const index = pushTree(lowers, spec.seed);
      lowers.mesh.setColorAt(index, leafColor);
      leafSlots.push({ mesh: lowers.mesh, index, slot });
      const topIndex = pushTree(uppers, spec.seed);
      uppers.mesh.setColorAt(topIndex, leafColor);
      leafSlots.push({ mesh: uppers.mesh, index: topIndex, slot });
    }
  }
  for (const part of swayParts) {
    part.mesh.count = part.seeds.length;
    part.mesh.instanceMatrix.needsUpdate = true;
    if (part.mesh.instanceColor) part.mesh.instanceColor.needsUpdate = true;
    part.mesh.computeBoundingSphere();
  }

  const scatterRng = mulberry32(29);
  const petalHex = ["#e07a5f", "#f2cc8f", "#f7f3ea", "#e7a0bf", "#f0a36b"];
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.014, 0.08, 4);
  stemGeo.translate(0, 0.04, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.05, 0);
  headGeo.translate(0, 0.095, 0);
  const petalMat = mat("#ffffff", { roughness: 0.5 });
  const flowerHeads = makeInstances(headGeo, petalMat, FLOWER_HIGH, scene, false);
  const flowerStems = makeInstances(stemGeo, mat("#3e6b38", { roughness: 0.9 }), FLOWER_HIGH, scene, false);
  flowerHeads.mesh.castShadow = quality === "high";
  flowerHeads.mesh.receiveShadow = quality === "high";
  flowerStems.mesh.castShadow = false;
  flowerStems.mesh.receiveShadow = false;

  const rockGeo = new THREE.DodecahedronGeometry(0.18, 0);
  const rocks = makeInstances(rockGeo, mat("#ffffff", { roughness: 0.92, flatShading: true }), ROCK_HIGH, scene, false);
  const rockHex = ["#8a8176", "#6e655c", "#a39684", "#7d7268"];
  const tint = new THREE.Color();
  const scatterPos = new THREE.Vector3();
  const scatterQuat = new THREE.Quaternion();
  const scatterScale = new THREE.Vector3();
  const scatterBase = new THREE.Matrix4();
  const scatterEuler = new THREE.Euler();

  function clearOfBuildings(x: number, z: number, padding: number): boolean {
    const distance = Math.hypot(x, z);
    if (distance < 1.2) return false;
    for (const id of Object.keys(SLOT) as BuildingId[]) {
      const angle = slotAngle(SLOT[id]);
      const bx = Math.cos(angle) * RADIUS;
      const bz = Math.sin(angle) * RADIUS;
      if ((x - bx) ** 2 + (z - bz) ** 2 < padding * padding) return false;
    }
    return true;
  }

  function onPath(x: number, z: number): boolean {
    const distance = Math.hypot(x, z);
    if (distance < 1.5 || distance > 6.6) return false;
    const angle = Math.atan2(z, x);
    for (const id of Object.keys(SLOT) as BuildingId[]) {
      let delta = Math.abs(angle - slotAngle(SLOT[id]));
      delta = Math.min(delta, Math.PI * 2 - delta);
      if (delta < 0.09) return true;
    }
    return false;
  }

  let flowerCursor = 0;
  let flowerGuard = 0;
  while (flowerCursor < FLOWER_HIGH && flowerGuard < 800) {
    flowerGuard += 1;
    const angle = scatterRng() * Math.PI * 2;
    const inner = scatterRng() > 0.55;
    const radius = inner ? 1.7 + scatterRng() * 3.6 : 8.8 + scatterRng() * 2.6;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (!clearOfBuildings(x, z, 1.7) || onPath(x, z)) continue;
    scatterPos.set(x, 0, z);
    scatterQuat.identity();
    scatterScale.setScalar(0.75 + scatterRng() * 0.7);
    scatterBase.compose(scatterPos, scatterQuat, scatterScale);
    flowerStems.mesh.setMatrixAt(flowerCursor, scatterBase);
    flowerHeads.mesh.setMatrixAt(flowerCursor, scatterBase);
    tint.set(petalHex[flowerCursor % petalHex.length] ?? "#f2cc8f");
    flowerHeads.mesh.setColorAt(flowerCursor, tint);
    flowerCursor += 1;
  }
  flowerHeads.mesh.count = flowerCursor;
  flowerStems.mesh.count = flowerCursor;
  flowerHeads.mesh.instanceMatrix.needsUpdate = true;
  flowerStems.mesh.instanceMatrix.needsUpdate = true;
  if (flowerHeads.mesh.instanceColor) flowerHeads.mesh.instanceColor.needsUpdate = true;
  flowerHeads.mesh.computeBoundingSphere();
  flowerStems.mesh.computeBoundingSphere();

  let rockCursor = 0;
  let rockGuard = 0;
  while (rockCursor < ROCK_HIGH && rockGuard < 400) {
    rockGuard += 1;
    const angle = scatterRng() * Math.PI * 2;
    const radius = rockCursor < 6 ? 4 + scatterRng() * 3.2 : 11.2 + scatterRng() * 2.4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (!clearOfBuildings(x, z, 1.9)) continue;
    const scale = 0.55 + scatterRng() * 1.15;
    const flat = 0.45 + scatterRng() * 0.45;
    scatterPos.set(x, 0.18 * scale * flat * 0.35, z);
    scatterEuler.set(scatterRng() * 0.4, scatterRng() * Math.PI, scatterRng() * 0.4);
    scatterQuat.setFromEuler(scatterEuler);
    scatterScale.set(scale, scale * flat, scale * (0.75 + scatterRng() * 0.4));
    scatterBase.compose(scatterPos, scatterQuat, scatterScale);
    rocks.mesh.setMatrixAt(rockCursor, scatterBase);
    tint.set(rockHex[rockCursor % rockHex.length] ?? "#8a8176");
    rocks.mesh.setColorAt(rockCursor, tint);
    rockCursor += 1;
  }
  rocks.mesh.count = rockCursor;
  rocks.mesh.instanceMatrix.needsUpdate = true;
  if (rocks.mesh.instanceColor) rocks.mesh.instanceColor.needsUpdate = true;
  rocks.mesh.computeBoundingSphere();

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sway = new THREE.Matrix4();
  const lean = new THREE.Matrix4();
  const swayed = new THREE.Matrix4();
  const shrink = new THREE.Matrix4();
  const placedFlowers = flowerCursor;
  const placedRocks = rockCursor;
  const leafPalettes: Record<Season, THREE.Color[]> = {
    spring: colors(["#f3b7c8", "#f7d6e2", "#e89ab4"]),
    summer: colors(["#2f7a3a", "#3f8f48", "#1f5c30"]),
    autumn: colors(["#e07a2f", "#d84b32", "#e6b325"]),
    winter: colors(["#6d5a48", "#7a6754", "#5c4d40"]),
  };
  const flowerPalettes = {
    spring: new THREE.Color("#ffe4ef"),
    summer: new THREE.Color("#ffffff"),
    autumn: new THREE.Color("#f0c090"),
    winter: new THREE.Color("#b7bdae"),
  };
  const grassPalettes = {
    spring: new THREE.Color("#d7f0c4"),
    summer: new THREE.Color("#ffffff"),
    autumn: new THREE.Color("#e4c48a"),
    winter: new THREE.Color("#b7bcae"),
  };
  const mixedLeaf = new THREE.Color();
  let foliageScale = 1;

  function setSeason(weights: Record<Season, number>): void {
    mixedLeaf.setRGB(0, 0, 0);
    groundMat.color.setRGB(0, 0, 0);
    petalMat.color.setRGB(0, 0, 0);
    for (const season of SEASONS) {
      const weight = weights[season] ?? 0;
      const grass = grassPalettes[season];
      const petal = flowerPalettes[season];
      groundMat.color.r += grass.r * weight;
      groundMat.color.g += grass.g * weight;
      groundMat.color.b += grass.b * weight;
      petalMat.color.r += petal.r * weight;
      petalMat.color.g += petal.g * weight;
      petalMat.color.b += petal.b * weight;
    }
    const touched = new Set<THREE.InstancedMesh>();
    for (const leaf of leafSlots) {
      mixedLeaf.setRGB(0, 0, 0);
      for (const season of SEASONS) {
        const weight = weights[season] ?? 0;
        const color = leafPalettes[season][leaf.slot] ?? leafPalettes.summer[0];
        if (!color) continue;
        mixedLeaf.r += color.r * weight;
        mixedLeaf.g += color.g * weight;
        mixedLeaf.b += color.b * weight;
      }
      leaf.mesh.setColorAt(leaf.index, mixedLeaf);
      touched.add(leaf.mesh);
    }
    for (const mesh of touched) {
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    foliageScale =
      (weights.spring ?? 0) * 1 +
      (weights.summer ?? 0) * 1.04 +
      (weights.autumn ?? 0) * 0.94 +
      (weights.winter ?? 0) * 0.18;
  }

  let browsing = false;

  function setNight(amount: number): void {
    const glow = THREE.MathUtils.clamp(amount, 0, 1);
    glassWarm.emissive.copy(warmGlow);
    glassWarm.emissiveIntensity = THREE.MathUtils.lerp(0.16, 2.15, glow);
    glassCool.emissive.copy(coolDay).lerp(warmGlow, glow);
    glassCool.emissiveIntensity = THREE.MathUtils.lerp(0.08, 1.6, glow);
    lampMat.emissiveIntensity = glow * 2.6;
    if (browsing) {
      libraryGlass.emissive.set("#ffe3a8");
      libraryGlass.emissiveIntensity = 3.2;
      libraryLight.intensity = 10;
    } else {
      libraryGlass.emissive.copy(glassCool.emissive);
      libraryGlass.emissiveIntensity = glassCool.emissiveIntensity;
      libraryLight.intensity = 0;
    }
  }

  function setBrowsing(on: boolean): void {
    browsing = on;
  }

  function setQuality(next: Quality): void {
    const many = next === "high";
    flowerHeads.mesh.count = Math.min(placedFlowers, many ? FLOWER_HIGH : FLOWER_LOW);
    flowerStems.mesh.count = flowerHeads.mesh.count;
    flowerHeads.mesh.castShadow = many;
    flowerHeads.mesh.receiveShadow = many;
    rocks.mesh.count = Math.min(placedRocks, many ? ROCK_HIGH : ROCK_LOW);
  }

  setQuality(quality);

  return {
    stands,
    pickables,
    diaryBadge,
    mailboxBadge,
    setNight,
    setBrowsing,
    setSeason,
    setQuality,
    update(time: number) {
      smoke.forEach((puff, index) => {
        const cycle = (time * 0.22 + index * 0.33) % 1;
        puff.position.y = 2.45 + cycle * 0.8;
        puff.scale.setScalar(0.65 + cycle * 1.5);
        const material = puff.material;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.opacity = 0.3 * (1 - cycle);
        }
      });
      const motion = reduceMotion ? 0 : 1;
      for (const part of swayParts) {
        if (part.seeds.length === 0) continue;
        for (let i = 0; i < part.seeds.length; i += 1) {
          const seed = part.seeds[i] ?? 0;
          const base = part.bases[i];
          if (!base) continue;
          const tilt =
            (Math.sin(time * 1.15 + seed) * 0.035 + Math.sin(time * 0.37 + seed * 2) * 0.012) * motion;
          lean.makeRotationX(Math.cos(time * 0.85 + seed) * 0.018 * motion);
          sway.makeRotationZ(tilt).multiply(lean);
          swayed.multiplyMatrices(base, sway);
          if (part.foliage && Math.abs(foliageScale - 1) > 0.001) {
            shrink.makeScale(foliageScale, foliageScale, foliageScale);
            swayed.multiply(shrink);
          }
          part.mesh.setMatrixAt(i, swayed);
        }
        part.mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

function colors(hexes: string[]): THREE.Color[] {
  return hexes.map((hex) => new THREE.Color(hex));
}

export function actionOf(object: THREE.Object3D | null): WorldAction | null {
  let current = object;
  while (current) {
    const action = current.userData.action;
    if (action === "diary" || action === "mailbox") return action;
    current = current.parent;
  }
  return null;
}
