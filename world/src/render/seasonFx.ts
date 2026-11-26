import * as THREE from "three";
import type { SeasonLook } from "./atmosphere";
import type { Quality } from "./quality";

type Budget = { petals: number; leaves: number; rain: number; flies: number };

const BUDGET: Record<Quality, Budget> = {
  high: { petals: 42, leaves: 36, rain: 70, flies: 22 },
  low: { petals: 16, leaves: 12, rain: 28, flies: 8 },
};

export type SeasonFx = {
  update(time: number, dt: number, look: SeasonLook): void;
  setQuality(quality: Quality): void;
};

export function createSeasonFx(scene: THREE.Scene, quality: Quality): SeasonFx {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const petals = makeDrift(scene, BUDGET.high.petals, "#f6c3d2", 0.16, 0.1);
  const leaves = makeDrift(scene, BUDGET.high.leaves, "#e07a32", 0.2, 0.14);
  const rain = makePoints(scene, BUDGET.high.rain, "#d5dee8", 2.2);
  const flies = makePoints(scene, BUDGET.high.flies, "#f3e39a", 4.2);
  let budget = BUDGET[quality];
  petals.mesh.count = budget.petals;
  leaves.mesh.count = budget.leaves;
  rain.points.geometry.setDrawRange(0, budget.rain);
  flies.points.geometry.setDrawRange(0, budget.flies);

  function update(time: number, dt: number, look: SeasonLook): void {
    const spring = look.weights.spring ?? 0;
    const summer = look.weights.summer ?? 0;
    const autumn = look.weights.autumn ?? 0;
    const winter = look.weights.winter ?? 0;
    stepDrift(petals, time, dt, budget.petals, spring, 0.35, 1.1, reduce);
    stepDrift(leaves, time, dt, budget.leaves, autumn, 0.7, 1.6, reduce);
    stepPoints(rain, dt, budget.rain, winter * 0.85, 7.5, 0.15, reduce);
    const glow = summer * look.dusk;
    stepPoints(flies, dt, budget.flies, glow, 0.35, 1.4, reduce);
  }

  return {
    update,
    setQuality(next) {
      budget = BUDGET[next];
      petals.mesh.count = budget.petals;
      leaves.mesh.count = budget.leaves;
      rain.points.geometry.setDrawRange(0, budget.rain);
      flies.points.geometry.setDrawRange(0, budget.flies);
    },
  };
}

type Drift = {
  mesh: THREE.InstancedMesh;
  seeds: Float32Array;
  y: Float32Array;
  x: Float32Array;
  z: Float32Array;
};

function makeDrift(scene: THREE.Scene, count: number, color: string, width: number, height: number): Drift {
  const geo = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  const seeds = new Float32Array(count);
  const y = new Float32Array(count);
  const x = new Float32Array(count);
  const z = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    seeds[i] = Math.random() * Math.PI * 2;
    x[i] = (Math.random() - 0.5) * 26;
    z[i] = (Math.random() - 0.5) * 26;
    y[i] = Math.random() * 5;
  }
  return { mesh, seeds, y, x, z };
}

const driftMatrix = new THREE.Matrix4();
const driftPos = new THREE.Vector3();
const driftQuat = new THREE.Quaternion();
const driftEuler = new THREE.Euler();
const driftScale = new THREE.Vector3(1, 1, 1);

function stepDrift(
  drift: Drift,
  time: number,
  dt: number,
  count: number,
  weight: number,
  fall: number,
  spin: number,
  reduce: boolean,
): void {
  const material = drift.mesh.material;
  if (material instanceof THREE.MeshStandardMaterial) material.opacity = weight * 0.9;
  drift.mesh.visible = weight > 0.04;
  if (!drift.mesh.visible) return;
  const motion = reduce ? 0 : 1;
  for (let i = 0; i < count; i += 1) {
    const seed = drift.seeds[i] ?? 0;
    drift.y[i] = (drift.y[i] ?? 0) - dt * fall * motion;
    drift.x[i] = (drift.x[i] ?? 0) + Math.sin(time * 0.7 + seed) * dt * 0.4 * motion;
    if ((drift.y[i] ?? 0) < 0.05) {
      drift.y[i] = 3.2 + ((seed * 17) % 2.4);
      drift.x[i] = (Math.sin(seed * 12.3) - 0.5) * 24;
      drift.z[i] = (Math.cos(seed * 9.1) - 0.5) * 24;
    }
    driftPos.set(drift.x[i] ?? 0, drift.y[i] ?? 0, drift.z[i] ?? 0);
    driftEuler.set(time * spin + seed, seed, Math.sin(time + seed) * 0.6);
    driftQuat.setFromEuler(driftEuler);
    driftMatrix.compose(driftPos, driftQuat, driftScale);
    drift.mesh.setMatrixAt(i, driftMatrix);
  }
  drift.mesh.instanceMatrix.needsUpdate = true;
}

type PointField = {
  points: THREE.Points;
  positions: Float32Array;
  seeds: Float32Array;
};

function makePoints(scene: THREE.Scene, count: number, color: string, size: number): PointField {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    seeds[i] = Math.random() * Math.PI * 2;
    positions[i * 3] = (Math.random() - 0.5) * 28;
    positions[i * 3 + 1] = Math.random() * 6;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 28;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return { points, positions, seeds };
}

function stepPoints(
  field: PointField,
  dt: number,
  count: number,
  weight: number,
  speed: number,
  bob: number,
  reduce: boolean,
): void {
  const material = field.points.material;
  if (material instanceof THREE.PointsMaterial) material.opacity = Math.min(0.75, weight);
  field.points.visible = weight > 0.04;
  if (!field.points.visible || reduce) return;
  for (let i = 0; i < count; i += 1) {
    const seed = field.seeds[i] ?? 0;
    let y = (field.positions[i * 3 + 1] ?? 0) - dt * speed;
    let x = (field.positions[i * 3] ?? 0) + Math.sin(seed + y) * dt * bob;
    if (y < 0.05) {
      y = 4 + (seed % 2);
      x = (Math.sin(seed * 8) - 0.5) * 26;
      field.positions[i * 3 + 2] = (Math.cos(seed * 5) - 0.5) * 26;
    }
    field.positions[i * 3] = x;
    field.positions[i * 3 + 1] = y;
  }
  const attribute = field.points.geometry.getAttribute("position");
  if (attribute) attribute.needsUpdate = true;
}
