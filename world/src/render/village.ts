import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  BUILDING_NAMES,
  BUILDING_SLOTS,
  SEASONS,
  VILLAGE_RADIUS,
  buildingAngle,
  isBuildable,
  isBuildingId,
  STARTER_BLUEPRINTS,
  liveSpec,
  starterObjects,
  autoAssign,
  villageBuilding,
  type BlueprintRecord,
  type BuildingBody,
  type BlueprintSpec,
  type BuildingId,
  type CreationView,
  type PathRecord,
  type Season,
  type WorldObject,
} from "@pips/shared";
import { layBlueprintCopies, makeBlueprintMesh } from "./blueprintMesh";
import { updateStudioFx } from "./studio";
import { fillSlots, makeBuildingMesh, setCutaway, setOccupant, setWindowsGlow, type SlotVisual } from "./buildingMesh";
import { makePiece } from "./pieces";
import type { Quality } from "./quality";

export type WorldAction = "diary" | "mailbox" | "studio" | "gallery" | { kind: "creation"; id: string } | { kind: "enter"; id: string };

export type Stand = {
  stand: THREE.Vector3;
  door: THREE.Vector3;
  inside: THREE.Vector3;
};

const RADIUS = VILLAGE_RADIUS;

const SLOT = BUILDING_SLOTS;

function slotAngle(slot: number): number {
  return buildingAngle(slot);
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

function paintSign(ctx: CanvasRenderingContext2D, text: string): void {
  ctx.clearRect(0, 0, 512, 192);
  ctx.fillStyle = "#6b3e28";
  ctx.fillRect(0, 0, 512, 192);
  ctx.strokeStyle = "#f3e6d0";
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, 488, 168);
  ctx.fillStyle = "#f6efe2";
  ctx.font = "700 92px Fraunces, Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 102);
}

function signBoard(text: string): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not paint a village sign.");
  paintSign(ctx, text);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.96, 0.36, 0.05),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, color: "#f6efe2" }),
  );
  mesh.castShadow = true;
  void document.fonts?.ready.then(() => {
    paintSign(ctx, text);
    texture.needsUpdate = true;
  });
  return mesh;
}

type NameTag = { id: BuildingId; element: HTMLElement; anchor: THREE.Object3D };

function starterSpec(name: string): BlueprintSpec {
  const item = STARTER_BLUEPRINTS.find((entry) => entry.name === name);
  if (!item) throw new Error(`Missing blueprint ${name}`);
  return item.spec;
}

function shellFrom(spec: BlueprintSpec, name: string): THREE.Group {
  const shell = spec.building ? makeBuildingMesh(spec.building) : makeBlueprintMesh(spec, "");
  shell.name = `${name}-shell`;
  return shell;
}

function hangSign(group: THREE.Group, text: string, x: number, y: number, z: number): void {
  const board = signBoard(text);
  board.position.set(x, y, z);
  group.add(board);
}

function place(group: THREE.Group, id: BuildingId): void {
  const angle = slotAngle(SLOT[id]);
  const x = Math.cos(angle) * RADIUS;
  const z = Math.sin(angle) * RADIUS;
  group.position.set(x, 0, z);
  group.rotation.y = Math.atan2(-x, -z);
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
  syncObjects(objects: WorldObject[], blueprints?: BlueprintRecord[], paths?: PathRecord[]): void;
  syncCreations(items: CreationView[], notes?: string[], displays?: { creationId: string; building: string; slot: string }[]): void;
  dressLabels(camera: THREE.Camera): void;
  setFocus(id: BuildingId | null): void;
  route(from: BuildingId | null, to: BuildingId): THREE.Vector3[];
  frontView(id: BuildingId): { position: THREE.Vector3; target: THREE.Vector3 };
  interiorView(id: string): { position: THREE.Vector3; target: THREE.Vector3 } | null;
  setEntered(id: string | null, amount: number): void;
  setOccupied(id: BuildingId | null, insideView: boolean): void;
};

export function createVillage(scene: THREE.Scene, quality: Quality): Village {
  const cream = mat("#f4e6cf");
  const stone = mat("#e4eef2");
  const mailWall = mat("#f3efe6");
  const roofHome = mat("#c4543a", { roughness: 0.72, side: THREE.DoubleSide, flatShading: true });
  const roofLibrary = mat("#2c455c", { roughness: 0.7, side: THREE.DoubleSide, flatShading: true });
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

  const pathRoot = new THREE.Group();
  pathRoot.name = "village-paths";
  scene.add(pathRoot);
  let pathKey = "";

  const diaryBadge = document.createElement("span");
  const mailboxBadge = document.createElement("span");
  const stands = {} as Record<BuildingId, Stand>;
  const pickables: THREE.Object3D[] = [];
  const nameTags: NameTag[] = [];
  let focused: BuildingId | null = null;
  const labelCam = new THREE.Vector3();
  const labelPos = new THREE.Vector3();

  function addName(group: THREE.Group, id: BuildingId, text: string, badge?: HTMLSpanElement): void {
    const element = document.createElement("div");
    element.className = "sign";
    element.hidden = true;
    element.append(document.createTextNode(text));
    if (badge) {
      badge.className = "sign-badge";
      badge.hidden = true;
      element.append(badge);
    }
    const label = new CSS2DObject(element);
    label.center.set(0.5, 1);
    label.position.set(0, 3.15, 0);
    group.add(label);
    nameTags.push({ id, element, anchor: group });
  }
  const smoke: THREE.Mesh[] = [];

  const shellName: Record<BuildingId, string> = {
    home: "home",
    library: "library",
    workshop: "studio",
    gallery: "gallery",
    mailbox: "mailbox",
  };
  const buildings = {} as Record<BuildingId, THREE.Group>;
  const shells = new Map<string, THREE.Group>();
  const badges: Partial<Record<BuildingId, HTMLSpanElement>> = { home: diaryBadge, mailbox: mailboxBadge };

  function mountFixed(id: BuildingId): void {
    const group = new THREE.Group();
    group.name = id;
    group.userData.enterId = id;
    const name = shellName[id];
    const shell = shellFrom(starterSpec(name), name);
    group.add(shell);
    shells.set(name, shell);
    const body = shell.userData.spec as BuildingBody | undefined;
    if (body?.chimney) {
      for (let i = 0; i < 3; i += 1) {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 8, 6),
          mat("#f7f4ee", { transparent: true, opacity: 0.3, depthWrite: false, roughness: 1 }),
        );
        puff.position.set(body.footprint.width * 0.22, body.floors === 2 ? 3.5 : 2.45, -body.footprint.depth * 0.12);
        group.add(puff);
        smoke.push(puff);
      }
    }
    const label = id === "workshop" ? "Studio" : BUILDING_NAMES[id];
    addName(group, id, label, badges[id]);
    place(group, id);
    scene.add(group);
    pickables.push(group);
    buildings[id] = group;
  }
  for (const id of ["home", "library", "workshop", "gallery", "mailbox"] as BuildingId[]) mountFixed(id);

  const libraryLight = new THREE.PointLight("#ffd089", 0, 9, 1.4);
  libraryLight.position.set(0, 1.6, 0.2);
  buildings.library.add(libraryLight);
  const studioFill = new THREE.PointLight("#fff4e2", 0.85, 8, 1.5);
  studioFill.position.set(0, 1.7, 0.4);
  const studioLamp = new THREE.PointLight("#ffb15a", 0, 5.5, 1.8);
  studioLamp.position.set(-1.6, 1.3, 1.2);
  buildings.workshop.add(studioFill, studioLamp);
  const gallerySpot = new THREE.SpotLight("#fff6e4", 1.8, 8, 0.7, 0.45, 1.2);
  gallerySpot.position.set(0.1, 2.2, 0.4);
  gallerySpot.target.position.set(0, 1.0, -0.4);
  gallerySpot.castShadow = false;
  buildings.gallery.add(gallerySpot, gallerySpot.target);

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
  addLamp(buildings.home, -1.15, 1.15, 1.35);
  addLamp(buildings.library, -1.05, 1.7, 1.15);
  addLamp(buildings.gallery, -1.9, 1.15, 1.9);
  addLamp(buildings.mailbox, -0.9, 1.05, 1.05);
  const junctionLamps = new THREE.Group();
  scene.add(junctionLamps);
  for (const id of Object.keys(SLOT) as BuildingId[]) {
    const angle = slotAngle(SLOT[id]) + 0.34;
    const radius = 4.55;
    addLamp(junctionLamps, Math.cos(angle) * radius, 1.28, Math.sin(angle) * radius);
  }

    function poseStand(id: BuildingId): void {
    const group = buildings[id];
    const shell = shells.get(shellName[id]);
    const doorLocal = shell?.userData.doorLocal instanceof THREE.Vector3 ? shell.userData.doorLocal : new THREE.Vector3(0, 0, 2);
    const activity = shell?.userData.activity instanceof THREE.Vector3 ? shell.userData.activity : new THREE.Vector3(0, 0, 0.4);
    const stand = group.localToWorld(doorLocal.clone());
    stand.y = 0;
    const inside = group.localToWorld(activity.clone());
    inside.y = 0;
    const door = group.localToWorld(new THREE.Vector3(doorLocal.x * 0.25, 0.8, doorLocal.z * 0.35));
    stands[id] = { stand, door, inside };
  }
  for (const id of Object.keys(buildings) as BuildingId[]) poseStand(id);

  function junctionAt(slot: number): THREE.Vector3 {
    const angle = slotAngle(slot);
    return new THREE.Vector3(Math.cos(angle) * 4.28, 0, Math.sin(angle) * 4.28);
  }

  function pathSpots(): { x: number; y: number; z: number; yaw: number }[] {
    const spots: { x: number; y: number; z: number; yaw: number }[] = [];
    const ring = 46;
    for (let index = 0; index < ring; index += 1) {
      const angle = (index / ring) * Math.PI * 2;
      spots.push({
        x: Math.cos(angle) * 4.28,
        y: 0.015,
        z: Math.sin(angle) * 4.28,
        yaw: angle + Math.PI / 2,
      });
    }
    for (const id of Object.keys(SLOT) as BuildingId[]) {
      const shell = shells.get(shellName[id]);
      const door = shell?.userData.doorLocal instanceof THREE.Vector3 ? shell.userData.doorLocal : new THREE.Vector3(0, 0, 2);
      const front = buildings[id].localToWorld(door.clone());
      const end = Math.hypot(front.x, front.z);
      const angle = Math.atan2(front.z, front.x);
      for (let radius = 4.55; radius < end - 0.15; radius += 0.48) {
        spots.push({
          x: Math.cos(angle) * radius,
          y: 0.02,
          z: Math.sin(angle) * radius,
          yaw: angle,
        });
      }
    }
    return spots;
  }

  function layPaths(spec: BlueprintSpec): void {
    for (const child of [...pathRoot.children]) {
      pathRoot.remove(child);
      disposeGroup(child instanceof THREE.Group ? child : new THREE.Group());
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const material = child.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material.dispose();
      }
    }
    pathRoot.add(layBlueprintCopies(spec, pathSpots()));
  }
  layPaths(starterSpec("path_tile"));
  pathKey = "starter";
  const dynamic = new Map<string, THREE.Group>();
  const glows: THREE.Mesh[] = [];
  let liveLeaves: { material: THREE.MeshStandardMaterial; slot: number; mesh: THREE.Mesh }[] = [];

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
    for (const id of Object.keys(buildings) as BuildingId[]) {
      const group = buildings[id];
      if ((x - group.position.x) ** 2 + (z - group.position.z) ** 2 < padding * padding) return false;
    }
    return true;
  }

  function onPath(x: number, z: number): boolean {
    const distance = Math.hypot(x, z);
    if (distance > 3.85 && distance < 4.8) return true;
    if (distance < 4.6 || distance > 6.6) return false;
    const angle = Math.atan2(z, x);
    for (const id of Object.keys(SLOT) as BuildingId[]) {
      let delta = Math.abs(angle - slotAngle(SLOT[id]));
      delta = Math.min(delta, Math.PI * 2 - delta);
      if (delta < 0.16) return true;
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
    if (!clearOfBuildings(x, z, 3.4) || onPath(x, z)) continue;
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
    if (!clearOfBuildings(x, z, 3.5)) continue;
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
  const RECENT_MS = 6 * 60 * 60 * 1000;

  function disposeGroup(group: THREE.Group): void {
    const ring = group.getObjectByName("recent-glow");
    if (ring instanceof THREE.Mesh) {
      const index = glows.indexOf(ring);
      if (index >= 0) glows.splice(index, 1);
    }
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    });
  }

  function rememberLeaves(): void {
    const next: typeof liveLeaves = [];
    for (const group of dynamic.values()) {
      const leaves = group.userData.leaves;
      if (!Array.isArray(leaves)) continue;
      for (const leaf of leaves) {
        if (!(leaf instanceof THREE.Mesh)) continue;
        const material = leaf.material;
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        const slot = leaf.userData.leafSlot;
        if (!(leaf.userData.baseScale instanceof THREE.Vector3)) {
          leaf.userData.baseScale = leaf.scale.clone();
        }
        next.push({ material, slot: typeof slot === "number" ? slot : 0, mesh: leaf });
      }
    }
    liveLeaves = next;
  }

  function touchGlow(group: THREE.Group, createdAt: string): void {
    const recent = Number.isFinite(Date.parse(createdAt)) && Date.now() - Date.parse(createdAt) < RECENT_MS;
    const existing = group.getObjectByName("recent-glow");
    if (!recent) {
      if (existing instanceof THREE.Mesh) {
        group.remove(existing);
        const index = glows.indexOf(existing);
        if (index >= 0) glows.splice(index, 1);
        existing.geometry.dispose();
        const material = existing.material;
        if (!Array.isArray(material)) material.dispose();
      }
      return;
    }
    if (existing) return;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.68, 28),
      new THREE.MeshBasicMaterial({
        color: "#ffe08a",
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.name = "recent-glow";
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    ring.renderOrder = 2;
    group.add(ring);
    glows.push(ring);
  }

  function adoptShell(id: BuildingId, blueprints: BlueprintRecord[]): void {
    const name = shellName[id];
    const host = buildings[id];
    const live = liveSpec(blueprints, name);
    const spec = live?.spec ?? starterSpec(name);
    const key = `${name}@${live?.version ?? 0}:${spec.building ? "building" : spec.primitives.length}`;
    if (host.userData.shellKey === key) return;
    host.userData.shellKey = key;
    const previous = shells.get(name);
    if (previous) {
      host.remove(previous);
      disposeGroup(previous);
    }
    const next = shellFrom(spec, name);
    host.add(next);
    shells.set(name, next);
    poseStand(id);
  }

  let openBuilding: string | null = null;
  function applyEntered(id: string | null, amount: number): void {
    openBuilding = id;
    for (const buildingId of Object.keys(buildings) as BuildingId[]) {
      const shell = shells.get(shellName[buildingId]);
      const open = id === buildingId;
      if (shell) setCutaway(shell, open, open ? amount : 0);
      buildings[buildingId].visible = id === null || open;
    }
    for (const [objectId, group] of dynamic) {
      const open = id === objectId;
      if (group.userData.spec) setCutaway(group, open, open ? amount : 0);
      group.visible = id === null || open;
    }
    pathRoot.visible = id === null;
    junctionLamps.visible = id === null;
  }

  function syncObjects(objects: WorldObject[], blueprints: BlueprintRecord[] = [], paths: PathRecord[] = []): void {
    for (const id of Object.keys(buildings) as BuildingId[]) adoptShell(id, blueprints);
    const pathLive = liveSpec(blueprints, "path_tile");
    const nextPathKey = pathLive ? `path@${pathLive.version}:${pathLive.spec.primitives.length}` : "starter";
    if (nextPathKey !== pathKey) {
      pathKey = nextPathKey;
      layPaths(pathLive?.spec ?? starterSpec("path_tile"));
    }
    if (objects.length === 0) return;
    const seen = new Set<string>();
    const shownBuildings = new Set<BuildingId>();
    for (const object of objects) {
      if (isBuildingId(object.type)) {
        const group = buildings[object.type];
        group.visible = true;
        group.position.set(object.x, 0, object.z);
        group.rotation.y = object.rotation;
        poseStand(object.type);
        shownBuildings.add(object.type);
        continue;
      }
      seen.add(object.id);
      const name = object.blueprint ?? object.type;
      const live = liveSpec(blueprints, name);
      const specKey = `${name}@${live?.version ?? 0}|${object.style}`;
      let group = dynamic.get(object.id);
      if (group && group.userData.specKey !== specKey) {
        scene.remove(group);
        disposeGroup(group);
        dynamic.delete(object.id);
        group = undefined;
      }
      if (!group) {
        group = live ? makeBlueprintMesh(live.spec, object.style) : isBuildable(object.type) ? makePiece(object.type, object.style) : new THREE.Group();
        group.userData.specKey = specKey;
        if (live?.spec.building) {
          group.userData.enterId = object.id;
          group.userData.blueprintName = name;
          pickables.push(group);
        }
        scene.add(group);
        dynamic.set(object.id, group);
      }
      const route = paths.find((path) => path.name === object.path);
      group.userData.route = route ? route.points : null;
      group.position.set(object.x, 0, object.z);
      group.userData.yaw = object.rotation;
      group.rotation.y = object.rotation;
      touchGlow(group, object.createdAt);
    }
    for (const id of Object.keys(buildings) as BuildingId[]) {
      if (!shownBuildings.has(id)) buildings[id].visible = true;
    }
    for (const [id, group] of dynamic) {
      if (seen.has(id)) continue;
      scene.remove(group);
      const index = pickables.indexOf(group);
      if (index >= 0) pickables.splice(index, 1);
      disposeGroup(group);
      dynamic.delete(id);
    }
    if (openBuilding) applyEntered(openBuilding, 1);
    rememberLeaves();
  }
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
    foliageScale =
      (weights.spring ?? 0) * 1 +
      (weights.summer ?? 0) * 1.04 +
      (weights.autumn ?? 0) * 0.94 +
      (weights.winter ?? 0) * 0.18;
    for (const leaf of liveLeaves) {
      mixedLeaf.setRGB(0, 0, 0);
      for (const season of SEASONS) {
        const weight = weights[season] ?? 0;
        const color = leafPalettes[season][leaf.slot] ?? leafPalettes.summer[0];
        if (!color) continue;
        mixedLeaf.r += color.r * weight;
        mixedLeaf.g += color.g * weight;
        mixedLeaf.b += color.b * weight;
      }
      leaf.material.color.copy(mixedLeaf);
      const base = leaf.mesh.userData.baseScale;
      if (base instanceof THREE.Vector3) leaf.mesh.scale.copy(base).multiplyScalar(foliageScale);
    }
  }

  let browsing = false;

  function setNight(amount: number): void {
    const glow = THREE.MathUtils.clamp(amount, 0, 1);
    glassWarm.emissive.copy(warmGlow);
    glassWarm.emissiveIntensity = THREE.MathUtils.lerp(0.16, 2.15, glow);
    glassCool.emissive.copy(coolDay).lerp(warmGlow, glow);
    glassCool.emissiveIntensity = THREE.MathUtils.lerp(0.08, 1.6, glow);
    lampMat.emissiveIntensity = glow * 2.6;
    for (const shell of shells.values()) setWindowsGlow(shell, glow);
    for (const group of dynamic.values()) setWindowsGlow(group, glow);
    gallerySpot.intensity = THREE.MathUtils.lerp(1.7, 3.1, glow);
    studioLamp.intensity = glow * 2.4;
    studioFill.intensity = THREE.MathUtils.lerp(0.85, 0.35, glow);
    const glowRoots = [...dynamic.values(), ...shells.values()];
    for (const group of glowRoots) {
      group.traverse((child) => {
        if (child.name !== "bulb" || !(child instanceof THREE.Mesh)) return;
        const material = child.material;
        if (!(material instanceof THREE.MeshStandardMaterial)) return;
        if (material.emissive.r <= material.emissive.b) return;
        material.emissiveIntensity = 0.2 + glow * 2.2;
      });
    }
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
  syncObjects(starterObjects());

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
      for (const group of dynamic.values()) {
        const yaw = group.userData.yaw;
        const route = group.userData.route;
        if (group.userData.follow === true && Array.isArray(route) && route.length >= 2) {
          if (motion === 0) {
            const first = route[0] as { x: number; z: number };
            group.position.set(first.x, 0, first.z);
            if (typeof yaw === "number") group.rotation.y = yaw;
          } else {
            const speed = typeof group.userData.speed === "number" ? group.userData.speed : 0.5;
            const spot = travel(route as { x: number; z: number }[], time * speed);
            group.position.set(spot.x, 0, spot.z);
            group.rotation.y = spot.yaw;
          }
          group.rotation.z = 0;
          continue;
        }
        const seed = group.userData.seed;
        if (typeof seed !== "number" || typeof yaw !== "number") continue;
        const tilt = (Math.sin(time * 1.15 + seed) * 0.02 + Math.sin(time * 0.37 + seed) * 0.008) * motion;
        group.rotation.y = yaw;
        group.rotation.z = tilt;
      }
      updateStudioFx(time);
      for (const ring of glows) {
        const material = ring.material;
        if (material instanceof THREE.MeshBasicMaterial) {
          material.opacity = 0.4 + Math.sin(time * 2.4) * 0.28;
        }
      }
    },
    syncObjects,
    syncCreations(items: CreationView[], notes: string[] = [], displays: { creationId: string; building: string; slot: string }[] = []) {
      const taken = new Set(displays.map((row) => row.creationId));
      const hosts: { name: string; shell: THREE.Object3D }[] = [];
      for (const id of Object.keys(buildings) as BuildingId[]) {
        const shell = shells.get(shellName[id]);
        if (shell?.userData.spec) hosts.push({ name: shellName[id], shell });
      }
      for (const [id, group] of dynamic) {
        if (!group.userData.spec) continue;
        hosts.push({ name: typeof group.userData.blueprintName === "string" ? group.userData.blueprintName : id, shell: group });
      }
      for (const host of hosts) {
        const spec = host.shell.userData.spec as BuildingBody;
        const used = new Set(displays.filter((row) => row.building === host.name).map((row) => row.slot));
        const auto = autoAssign(
          spec,
          host.name,
          items.map((item) => ({
            id: item.id,
            type: item.type,
            status: item.status,
            favourite: item.favourite,
            archived: item.archived,
          })),
          taken,
          used,
        );
        const chosen = [...displays.filter((row) => row.building === host.name), ...auto];
        const visuals: SlotVisual[] = chosen.map((row) => {
          const item = items.find((entry) => entry.id === row.creationId);
          return { slot: row.slot, label: item?.title ?? "Piece", colour: item?.type === "writing" ? "#f4efe4" : "#e7c27a", creationId: row.creationId };
        });
        if (host.name === "library") {
          const book = spec.interior.find((slot) => slot.kind === "bookcase");
          if (book && notes[0]) visuals.push({ slot: book.id, label: notes[0], colour: "#8d5a34" });
        }
        fillSlots(host.shell, visuals);
      }
    },
    interiorView(id: string) {
      const group = isBuildingId(id) ? buildings[id] : dynamic.get(id);
      const shell = isBuildingId(id) ? shells.get(shellName[id]) : dynamic.get(id);
      if (!group || !shell) return null;
      const door = shell.userData.doorLocal instanceof THREE.Vector3 ? shell.userData.doorLocal : new THREE.Vector3(0, 0, 2);
      const activity = shell.userData.activity instanceof THREE.Vector3 ? shell.userData.activity : new THREE.Vector3(0, 0, 0);
      return {
        position: group.localToWorld(new THREE.Vector3(door.x * 0.04 + 0.35, 1.55, door.z * 0.9)),
        target: group.localToWorld(new THREE.Vector3(activity.x * 0.1, 0.65, -0.15)),
      };
    },
    setEntered(id: string | null, amount: number) {
      applyEntered(id, amount);
    },
    setOccupied(id: BuildingId | null, insideView: boolean) {
      for (const buildingId of Object.keys(buildings) as BuildingId[]) {
        const shell = shells.get(shellName[buildingId]);
        if (shell) setOccupant(shell, id === buildingId && !insideView);
      }
    },
    dressLabels(camera) {
      camera.getWorldPosition(labelCam);
      for (const tag of nameTags) {
        tag.anchor.getWorldPosition(labelPos);
        const far = labelCam.distanceTo(labelPos) > 17;
        tag.element.hidden = !(far || focused === tag.id);
      }
    },
    setFocus(id) {
      focused = id;
    },
    route(from, to) {
      const fromSlot = from ? SLOT[from] : SLOT[to];
      const toSlot = SLOT[to];
      let hops = (toSlot - fromSlot + 5) % 5;
      const step = hops > 2 ? -1 : 1;
      if (hops > 2) hops = 5 - hops;
      const points: THREE.Vector3[] = [];
      let slot = fromSlot;
      if (from && hops > 0) points.push(junctionAt(slot));
      for (let index = 0; index < hops; index += 1) {
        slot = (slot + step + 5) % 5;
        points.push(junctionAt(slot));
      }
      if (!from) points.push(junctionAt(toSlot));
      return points;
    },
    frontView(id) {
      const group = buildings[id];
      return {
        position: group.localToWorld(new THREE.Vector3(3.8, 2.7, 7.4)),
        target: group.localToWorld(new THREE.Vector3(0, 1.2, 0)),
      };
    },
  };
}

function travel(points: { x: number; z: number }[], distance: number): { x: number; z: number; yaw: number } {
  const lengths: number[] = [];
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (!from || !to) continue;
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    lengths.push(length);
    total += length;
  }
  const start = points[0];
  if (!start || total <= 0.001) return { x: start?.x ?? 0, z: start?.z ?? 0, yaw: 0 };
  let left = distance % total;
  for (let index = 0; index < lengths.length; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const length = lengths[index] ?? 0;
    if (!from || !to) break;
    if (left <= length || index === lengths.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, left / length);
      return {
        x: from.x + (to.x - from.x) * t,
        z: from.z + (to.z - from.z) * t,
        yaw: Math.atan2(to.x - from.x, to.z - from.z),
      };
    }
    left -= length;
  }
  return { x: start.x, z: start.z, yaw: 0 };
}

function colors(hexes: string[]): THREE.Color[] {
  return hexes.map((hex) => new THREE.Color(hex));
}

export function actionOf(object: THREE.Object3D | null): WorldAction | null {
  let current = object;
  while (current) {
    if (typeof current.userData.creationId === "string") return { kind: "creation", id: current.userData.creationId };
    if (typeof current.userData.enterId === "string") return { kind: "enter", id: current.userData.enterId };
    const action = current.userData.action;
    if (action === "diary" || action === "mailbox" || action === "studio" || action === "gallery") return action;
    current = current.parent;
  }
  return null;
}
