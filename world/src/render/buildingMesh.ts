import * as THREE from "three";
import { activitySlot, doorPad, type BuildingBody, type BuildingSlot, type DoorSide } from "@pips/shared";

export type SlotVisual = {
  slot: string;
  label: string;
  colour: string;
  creationId?: string;
};

function mat(color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
}

function addBox(
  parent: THREE.Object3D,
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  name = "",
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function gable(width: number, depth: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(0, height);
  shape.lineTo(width / 2, 0);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function signTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#f6f0e4";
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = "#5c4636";
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 244, 84);
    ctx.fillStyle = "#2a241c";
    ctx.font = "700 42px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 16), 128, 50);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function wallSpan(spec: BuildingBody, side: DoorSide): number {
  return side === "front" || side === "back" ? spec.footprint.width : spec.footprint.depth;
}

function placeOnWall(spec: BuildingBody, side: DoorSide, along: number, y: number, outward: number): [number, number, number] {
  const width = spec.footprint.width;
  const depth = spec.footprint.depth;
  const x = along * (wallSpan(spec, side) / 2 - 0.35);
  if (side === "front") return [x, y, depth / 2 + outward];
  if (side === "back") return [-x, y, -(depth / 2 + outward)];
  if (side === "left") return [-(width / 2 + outward), y, x];
  return [width / 2 + outward, y, x];
}

export function makeBuildingMesh(spec: BuildingBody, options: { cutaway?: boolean } = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = "building";
  const width = spec.footprint.width;
  const depth = spec.footprint.depth;
  const floorH = spec.floors === 2 ? 3.15 : 2.05;
  const wall = mat(spec.wall.colour);
  const trim = mat("#6b4128");
  const roofMat = mat(spec.roof.colour);
  const glass = mat("#f0d7a2", { emissive: "#ffb15a", emissiveIntensity: 0.2, roughness: 0.25, transparent: true, opacity: 0.92 });
  const floorMat = mat("#c4a574", { roughness: 1 });
  const interior = new THREE.Group();
  interior.name = "interior";
  interior.visible = false;
  group.add(interior);
  addBox(interior, width - 0.28, 0.06, depth - 0.28, floorMat, 0, 0.03, 0, "floor");

  const front = new THREE.Group();
  front.name = "front";
  group.add(front);
  const doorW = 0.62;
  const doorH = 1.15;
  const doorAt = spec.door.position * (wallSpan(spec, spec.door.side) / 2 - 0.7);
  buildWalls(spec, group, front, wall, trim, floorH, doorW, doorH, doorAt);

  const roof = new THREE.Group();
  roof.name = "roof";
  const overhangW = width + 0.45;
  const overhangD = depth + 0.45;
  if (spec.roof.style === "flat") {
    addBox(roof, overhangW, 0.12, overhangD, roofMat, 0, floorH + 0.08, 0);
  } else if (spec.roof.style === "shed") {
    const slab = addBox(roof, overhangW, 0.12, overhangD, roofMat, 0, floorH + 0.28, 0);
    slab.rotation.x = -0.28;
  } else if (spec.roof.style === "hip") {
    const hip = new THREE.Mesh(new THREE.ConeGeometry(1, 0.9, 4), roofMat);
    hip.scale.set(overhangW * 0.62, 1, overhangD * 0.62);
    hip.rotation.y = Math.PI / 4;
    hip.position.y = floorH + 0.45;
    hip.castShadow = true;
    roof.add(hip);
  } else {
    const mesh = new THREE.Mesh(gable(overhangW, overhangD, 1.05), roofMat);
    mesh.position.y = floorH;
    mesh.castShadow = true;
    roof.add(mesh);
  }
  group.add(roof);

  if (spec.chimney) {
    addBox(group, 0.34, 0.85, 0.34, mat("#8d4a3a"), width * 0.22, floorH + 1.15, -depth * 0.02, "chimney");
    addBox(group, 0.46, 0.1, 0.46, mat("#5c3828"), width * 0.22, floorH + 1.58, -depth * 0.02);
  }
  if (spec.skylight) {
    addBox(roof, 0.55, 0.06, 0.4, mat("#d7ecf5", { emissive: "#fff4d2", emissiveIntensity: 0.35 }), 0, floorH + 0.42, 0.05, "skylight");
  }

  for (const win of spec.windows) {
    const y = win.floor === 2 ? 2.35 : 1.2;
    const [x, yy, z] = placeOnWall(spec, win.side, win.position, y, 0.04);
    const host = win.side === spec.door.side ? front : group;
    const pane = addBox(host, win.side === "left" || win.side === "right" ? 0.06 : 0.42, 0.4, win.side === "left" || win.side === "right" ? 0.42 : 0.06, glass, x, yy, z, "window");
    pane.userData.glow = true;
    const frame = mat("#5c4636");
    addBox(host, win.side === "left" || win.side === "right" ? 0.05 : 0.48, 0.05, win.side === "left" || win.side === "right" ? 0.48 : 0.05, frame, x, yy + 0.22, z);
    addBox(host, win.side === "left" || win.side === "right" ? 0.05 : 0.48, 0.05, win.side === "left" || win.side === "right" ? 0.48 : 0.05, frame, x, yy - 0.22, z);
  }

  const [dx, , dz] = placeOnWall(spec, spec.door.side, spec.door.position, doorH / 2, 0.03);
  const doorWide = spec.door.side === "left" || spec.door.side === "right";
  const door = addBox(front, doorWide ? 0.08 : doorW * 0.98, doorH * 0.98, doorWide ? doorW * 0.98 : 0.08, mat("#6b3a28"), dx, doorH * 0.49, dz, "door");
  addBox(front, doorWide ? 0.04 : doorW * 0.52, doorH * 0.5, doorWide ? doorW * 0.52 : 0.03, mat("#c4a574"), dx, doorH * 0.55, dz + (doorWide ? 0 : 0.03));
  door.userData.door = true;
  addBox(group, 0.7, 0.06, 0.45, mat("#8d7b68"), doorPad(spec).x * 0.15, 0.03, spec.door.side === "front" ? depth / 2 + 0.28 : dz);

  if (spec.sign) {
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.32),
      new THREE.MeshStandardMaterial({ map: signTexture(spec.sign), roughness: 0.8 }),
    );
    const [sx, , sz] = placeOnWall(spec, spec.door.side, spec.door.position, floorH - 0.15, 0.08);
    board.position.set(sx, floorH - 0.62, sz);
    if (spec.door.side === "left") board.rotation.y = Math.PI / 2;
    if (spec.door.side === "right") board.rotation.y = -Math.PI / 2;
    if (spec.door.side === "back") board.rotation.y = Math.PI;
    board.name = "sign";
    front.add(board);
  }

  if (spec.template === "stall") {
    addBox(group, 0.36, 0.24, 0.22, mat("#c23b3b"), width / 2 + 0.15, 0.7, depth / 4, "postbox");
  }

  const occupant = new THREE.Group();
  occupant.name = "occupant";
  occupant.visible = false;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.32, 2, 6), mat("#1c1814"));
  body.position.y = 0.78;
  occupant.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), mat("#1c1814"));
  head.position.y = 1.12;
  occupant.add(head);
  const [ox, , oz] = placeOnWall(spec, spec.door.side, -0.72, 1, -0.12);
  occupant.position.set(ox, 0, oz);
  group.add(occupant);

  for (const item of spec.interior) addSlot(interior, item);
  group.userData.spec = spec;
  group.userData.interior = interior;
  group.userData.cutaway = [roof, front];
  group.userData.occupant = occupant;
  group.userData.activity = activityOf(spec);
  group.userData.doorLocal = new THREE.Vector3(doorPad(spec).x, 0, doorPad(spec).z);
  if (options.cutaway) {
    roof.visible = false;
    front.visible = false;
    interior.visible = true;
  }
  return group;
}

function sy(spec: BuildingBody, floorH: number): number {
  return spec.floors === 2 ? floorH * 0.55 : floorH - 0.2;
}

function buildWalls(
  spec: BuildingBody,
  shell: THREE.Group,
  front: THREE.Group,
  wall: THREE.Material,
  trim: THREE.Material,
  floorH: number,
  doorW: number,
  doorH: number,
  doorAt: number,
): void {
  const width = spec.footprint.width;
  const depth = spec.footprint.depth;
  const t = 0.12;
  const sides: { side: DoorSide; length: number; x: number; z: number; alongX: boolean }[] = [
    { side: "back", length: width, x: 0, z: -depth / 2, alongX: true },
    { side: "front", length: width, x: 0, z: depth / 2, alongX: true },
    { side: "left", length: depth, x: -width / 2, z: 0, alongX: false },
    { side: "right", length: depth, x: width / 2, z: 0, alongX: false },
  ];
  for (const item of sides) {
    const host = item.side === spec.door.side ? front : shell;
    if (item.side !== spec.door.side) {
      addBox(host, item.alongX ? item.length : t, floorH, item.alongX ? t : item.length, wall, item.x, floorH / 2, item.z, `wall-${item.side}`);
      continue;
    }
    const left = item.length / 2 + doorAt - doorW / 2;
    const right = item.length / 2 - doorAt - doorW / 2;
    const sign = item.side === "back" || item.side === "left" ? -1 : 1;
    if (left > 0.08) {
      const offset = sign * (-item.length / 2 + left / 2);
      addBox(
        host,
        item.alongX ? left : t,
        floorH,
        item.alongX ? t : left,
        wall,
        item.alongX ? item.x + offset : item.x,
        floorH / 2,
        item.alongX ? item.z : item.z + offset,
      );
    }
    if (right > 0.08) {
      const offset = sign * (item.length / 2 - right / 2);
      addBox(
        host,
        item.alongX ? right : t,
        floorH,
        item.alongX ? t : right,
        wall,
        item.alongX ? item.x + offset : item.x,
        floorH / 2,
        item.alongX ? item.z : item.z + offset,
      );
    }
    addBox(
      front,
      item.alongX ? doorW : t,
      Math.max(0.2, floorH - doorH),
      item.alongX ? t : doorW,
      wall,
      item.alongX ? doorAt * sign : item.x,
      doorH + Math.max(0.2, floorH - doorH) / 2,
      item.alongX ? item.z : doorAt * sign,
    );
    addBox(host, doorW + 0.12, 0.08, 0.08, trim, item.alongX ? doorAt : item.x, doorH, item.alongX ? item.z : doorAt);
  }
}

function activityOf(spec: BuildingBody): THREE.Vector3 {
  const slot = activitySlot(spec);
  if (!slot) return new THREE.Vector3(0, 0, 0);
  const forward = spec.door.side === "back" ? -1 : 1;
  const limitX = spec.footprint.width / 2 - 0.4;
  const limitZ = spec.footprint.depth / 2 - 0.4;
  const x = Math.max(-limitX, Math.min(limitX, slot.position[0] * 0.35));
  const z = Math.max(-limitZ, Math.min(limitZ, slot.position[2] + forward * (slot.size[2] * 0.5 + 0.35)));
  return new THREE.Vector3(x, 0, z);
}

function addSlot(parent: THREE.Object3D, item: BuildingSlot): void {
  const host = new THREE.Group();
  host.name = `slot-${item.id}`;
  host.position.set(item.position[0], item.position[1], item.position[2]);
  host.userData.slotId = item.id;
  const wood = mat("#6b4630");
  const [w, h, d] = item.size;
  if (item.kind === "wall_frame") {
    addBox(host, w, h, 0.05, wood, 0, 0, 0);
    addBox(host, w - 0.08, h - 0.08, 0.02, mat("#f6f0e4"), 0, 0, 0.03, "canvas");
  } else if (item.kind === "plinth") {
    addBox(host, w, h, d, mat("#e7e0d4"), 0, h / 2, 0);
  } else if (item.kind === "bookcase" || item.kind === "shelf") {
    addBox(host, w, h, d, wood, 0, h / 2, 0);
  } else if (item.kind === "easel") {
    addBox(host, 0.08, h, 0.08, wood, -w / 3, h / 2, 0);
    addBox(host, 0.08, h, 0.08, wood, w / 3, h / 2, 0);
    addBox(host, w, h * 0.7, 0.04, mat("#f4efe4"), 0, h * 0.55, 0.05, "canvas");
  } else if (item.kind === "screen") {
    addBox(host, w, h * 0.7, d, mat("#243044"), 0, h * 0.55, 0, "canvas");
    addBox(host, w * 0.8, 0.08, d * 0.8, wood, 0, 0.2, 0);
  } else if (item.kind === "bed") {
    addBox(host, w, 0.2, d, wood, 0, 0.2, 0);
    addBox(host, w * 0.9, 0.12, d * 0.85, mat("#f7f3ea"), 0, 0.34, 0);
  } else {
    addBox(host, w, h * 0.15, d, wood, 0, h, 0);
    addBox(host, 0.08, h, 0.08, wood, -w / 2 + 0.06, h / 2, -d / 2 + 0.06);
    addBox(host, 0.08, h, 0.08, wood, w / 2 - 0.06, h / 2, d / 2 - 0.06);
  }
  parent.add(host);
}

export function fillSlots(building: THREE.Object3D, visuals: SlotVisual[]): void {
  const interior = building.userData.interior as THREE.Object3D | undefined;
  if (!interior) return;
  for (const child of interior.children) {
    if (!(child instanceof THREE.Group) || typeof child.userData.slotId !== "string") continue;
    const old = child.getObjectByName("shown");
    if (old) {
      child.remove(old);
      old.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const material = node.material;
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material.dispose();
        }
      });
    }
    const visual = visuals.find((item) => item.slot === child.userData.slotId);
    if (!visual) {
      delete child.userData.creationId;
      continue;
    }
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.16, 0.04),
      mat(visual.colour),
    );
    marker.name = "shown";
    marker.position.y = 0.45;
    marker.userData.creationId = visual.creationId;
    if (visual.creationId) child.userData.creationId = visual.creationId;
    child.add(marker);
  }
}

export function setCutaway(building: THREE.Object3D, open: boolean, amount = 1): void {
  const parts = building.userData.cutaway as THREE.Object3D[] | undefined;
  const interior = building.userData.interior as THREE.Object3D | undefined;
  if (interior) interior.visible = open;
  if (!parts) return;
  for (const part of parts) {
    part.visible = !open || amount < 0.98;
    part.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const material = node.material;
      const list = Array.isArray(material) ? material : [material];
      for (const item of list) {
        if (!(item instanceof THREE.MeshStandardMaterial)) continue;
        item.transparent = open;
        item.opacity = open ? 1 - amount : 1;
        item.depthWrite = !open || amount < 0.2;
      }
    });
  }
}

export function setWindowsGlow(root: THREE.Object3D, amount: number): void {
  root.traverse((node) => {
    if (node.name !== "window" || !(node instanceof THREE.Mesh)) return;
    const material = node.material;
    if (!(material instanceof THREE.MeshStandardMaterial)) return;
    material.emissive.set("#ffb15a");
    material.emissiveIntensity = 0.12 + amount * 2.6;
  });
}

export function setOccupant(building: THREE.Object3D, present: boolean): void {
  const occupant = building.userData.occupant as THREE.Object3D | undefined;
  if (occupant) occupant.visible = present;
}
