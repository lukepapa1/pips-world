import * as THREE from "three";
import { resolveSpec, type BlueprintSpec } from "@pips/shared";

function geometryFor(shape: BlueprintSpec["primitives"][number]["shape"], size: [number, number, number]): THREE.BufferGeometry {
  if (shape === "box") return new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (shape === "cylinder") return new THREE.CylinderGeometry(size[0] / 2, size[2] / 2, size[1], 6);
  if (shape === "cone") return new THREE.ConeGeometry(Math.max(size[0], size[2]) / 2, size[1], 7);
  const sphere = new THREE.IcosahedronGeometry(0.5, 0);
  sphere.scale(size[0], size[1], size[2]);
  return sphere;
}

function instanceScale(style: string): { scale: number; slot: number } {
  const match = /^[a-z]+:([0-9.]+):([0-9]+)$/.exec(style);
  const scale = match ? Number(match[1]) : 1;
  const slot = match ? Number(match[2]) : 0;
  return {
    scale: Number.isFinite(scale) && scale > 0.2 && scale < 3 ? scale : 1,
    slot: Number.isFinite(slot) ? Math.max(0, Math.min(2, Math.floor(slot))) : 0,
  };
}

export function makeBlueprintMesh(spec: BlueprintSpec, style: string): THREE.Group {
  const resolved = resolveSpec(spec, style);
  const { scale, slot } = instanceScale(style);
  const group = new THREE.Group();
  const leaves: THREE.Mesh[] = [];
  for (const primitive of resolved.primitives) {
    const material = new THREE.MeshStandardMaterial({
      color: primitive.colour,
      roughness: primitive.foliage ? 0.95 : 0.86,
      metalness: 0,
      flatShading: primitive.shape === "sphere" || primitive.shape === "cone" || primitive.foliage === true,
      emissive: primitive.emissive ? primitive.colour : "#000000",
      emissiveIntensity: primitive.emissive ? 0.35 : 0,
    });
    const item = new THREE.Mesh(geometryFor(primitive.shape, primitive.size), material);
    item.position.set(primitive.position[0], primitive.position[1], primitive.position[2]);
    item.rotation.set(primitive.rotation[0], primitive.rotation[1], primitive.rotation[2]);
    item.castShadow = true;
    item.receiveShadow = true;
    if (primitive.foliage) {
      item.userData.leafSlot = slot;
      leaves.push(item);
    }
    if (primitive.emissive) item.name = "bulb";
    group.add(item);
  }
  group.userData.leaves = leaves;
  if (scale !== 1) group.scale.setScalar(scale);
  if (resolved.behaviour === "sway") group.userData.seed = slot * 2.1 + scale;
  if (resolved.behaviour === "follow_path") {
    const speed = resolved.parameters?.speed;
    group.userData.follow = true;
    group.userData.speed = typeof speed === "number" ? Math.min(2, Math.max(0.05, speed)) : 0.5;
  }
  return group;
}
