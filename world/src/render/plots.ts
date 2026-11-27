import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import {
  PLOT_SIZE,
  SEASONS,
  approachPoint,
  isStartingPlot,
  plotBounds,
  terrainSample,
  type PlotRecord,
  type Season,
  type Terrain,
} from "@pips/shared";
import type { Quality } from "./quality";

type Reveal = {
  land: THREE.Material[];
  mist: THREE.Material[];
  t: number;
};

const NEAR = 46;
const treeGeo = new THREE.ConeGeometry(0.42, 1.5, 5);
const rockGeo = new THREE.DodecahedronGeometry(0.32, 0);
const reedGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.85, 4);
const flowerGeo = new THREE.ConeGeometry(0.07, 0.2, 4);
const waterGeo = new THREE.CircleGeometry(6.5, 18);
waterGeo.rotateX(-Math.PI / 2);

const SEASON_TINT: Record<Season, THREE.Color> = {
  spring: new THREE.Color("#d7e3bc"),
  summer: new THREE.Color("#e0e7aa"),
  autumn: new THREE.Color("#e4c79a"),
  winter: new THREE.Color("#d5dee4"),
};

function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function propPlan(type: Terrain, quality: Quality): Array<{ kind: "tree" | "rock" | "reed" | "flower"; count: number }> {
  const scale = quality === "high" ? 1 : 0.55;
  const count = (amount: number) => Math.max(1, Math.round(amount * scale));
  switch (type) {
    case "forest":
      return [
        { kind: "tree", count: count(8) },
        { kind: "rock", count: count(2) },
      ];
    case "rocky":
      return [{ kind: "rock", count: count(7) }];
    case "wetland":
      return [{ kind: "reed", count: count(12) }];
    case "beach":
      return [{ kind: "rock", count: count(3) }];
    case "hills":
      return [
        { kind: "rock", count: count(4) },
        { kind: "tree", count: count(2) },
      ];
    case "lake":
      return [{ kind: "reed", count: count(8) }];
    default:
      return [{ kind: "flower", count: count(5) }];
  }
}

export type PlotLayer = {
  sync(plots: PlotRecord[]): void;
  update(
    dt: number,
    camera: THREE.Camera,
    pip: THREE.Vector3,
    quality: Quality,
    weights: Record<Season, number>,
  ): void;
};

export function createPlots(scene: THREE.Scene): PlotLayer {
  const root = new THREE.Group();
  root.name = "plots";
  scene.add(root);

  let plots: PlotRecord[] = [];
  let dirty = true;
  const prior = new Map<string, PlotRecord["status"]>();
  let seen = false;
  let lastStatus = "";
  let lastLod = "";
  let holdLod = false;
  const reveals: Reveal[] = [];
  const tinted: THREE.MeshStandardMaterial[] = [];
  const tint = new THREE.Color();
  let lodClock = 0;

  function typeOf(gridX: number, gridZ: number): Terrain | null {
    return plots.find((plot) => plot.gridX === gridX && plot.gridZ === gridZ)?.type ?? null;
  }

  function makeGround(plot: PlotRecord, segments: number): THREE.BufferGeometry {
    const geometry = new THREE.PlaneGeometry(PLOT_SIZE, PLOT_SIZE, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    if (!position) return geometry;
    const colors = new Float32Array(position.count * 3);
    const centerX = plot.gridX * PLOT_SIZE;
    const centerZ = plot.gridZ * PLOT_SIZE;
    const quiet = isStartingPlot(plot.gridX, plot.gridZ);
    for (let index = 0; index < position.count; index += 1) {
      const worldX = (position.getX(index) ?? 0) + centerX;
      const worldZ = (position.getZ(index) ?? 0) + centerZ;
      const sample = terrainSample(worldX, worldZ, typeOf);
      let height = sample.height;
      if (quiet) {
        const dist = Math.hypot(worldX, worldZ);
        if (dist < 16.2) height = -0.25;
        else if (dist < 18) height = THREE.MathUtils.lerp(-0.25, sample.height, (dist - 16.2) / 1.8);
      }
      position.setY(index, height);
      colors[index * 3] = sample.r;
      colors[index * 3 + 1] = sample.g;
      colors[index * 3 + 2] = sample.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }

  function placeProps(
    plot: PlotRecord,
    quality: Quality,
    parent: THREE.Group,
    cast: boolean,
    ghost: boolean,
  ): THREE.Material[] {
    if (isStartingPlot(plot.gridX, plot.gridZ)) return [];
    const made: THREE.Material[] = [];
    const rng = mulberry(plot.seed);
    const center = { x: plot.gridX * PLOT_SIZE, z: plot.gridZ * PLOT_SIZE };
    const span = PLOT_SIZE * 0.36;
    const dummy = new THREE.Object3D();
    for (const plan of propPlan(plot.type, quality)) {
      const geometry = plan.kind === "tree" ? treeGeo : plan.kind === "rock" ? rockGeo : plan.kind === "reed" ? reedGeo : flowerGeo;
      const color = ghost
        ? "#6d7872"
        : plan.kind === "tree"
          ? "#2f5a34"
          : plan.kind === "rock"
            ? "#8d8680"
            : plan.kind === "reed"
              ? "#6e8f62"
              : "#d2b154";
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.86,
        transparent: ghost,
        opacity: ghost ? 0.42 : 1,
        depthWrite: !ghost,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, plan.count);
      mesh.castShadow = cast && !ghost && plan.kind !== "flower";
      mesh.receiveShadow = cast && !ghost;
      let written = 0;
      for (let index = 0; index < plan.count; index += 1) {
        const x = center.x + (rng() * 2 - 1) * span;
        const z = center.z + (rng() * 2 - 1) * span;
        if (Math.hypot(x, z) < 16.8) continue;
        const sample = terrainSample(x, z, typeOf);
        const tall = plan.kind === "tree" ? 0.7 + rng() * 0.8 : plan.kind === "reed" ? 0.7 + rng() * 0.5 : 0.6 + rng() * 0.7;
        dummy.position.set(x, sample.height + (plan.kind === "flower" ? 0.08 : tall * 0.45), z);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.scale.set(0.7 + rng() * 0.6, tall, 0.7 + rng() * 0.6);
        dummy.updateMatrix();
        mesh.setMatrixAt(written, dummy.matrix);
        written += 1;
      }
      mesh.count = written;
      mesh.instanceMatrix.needsUpdate = true;
      if (written > 0) {
        parent.add(mesh);
        made.push(material);
      } else material.dispose();
    }
    if (plot.type === "lake") {
      const sample = terrainSample(center.x, center.z, typeOf);
      const water = new THREE.MeshStandardMaterial({
        color: "#6aa8c4",
        transparent: true,
        opacity: ghost ? 0.28 : 0.78,
        roughness: 0.15,
        metalness: 0.05,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(waterGeo, water);
      mesh.position.set(center.x, sample.height + 0.08, center.z);
      parent.add(mesh);
      made.push(water);
    }
    return made;
  }

  function marker(plot: PlotRecord): CSS2DObject {
    const spot = approachPoint(plot.gridX, plot.gridZ);
    const sample = terrainSample(spot.x, spot.z, typeOf);
    const element = document.createElement("span");
    element.className = "plot-mark";
    element.textContent = "?";
    element.title = plot.name;
    const label = new CSS2DObject(element);
    label.position.set(spot.x, sample.height + 1.5, spot.z);
    return label;
  }

  function clearRoot(): void {
    const children = [...root.children];
    for (const child of children) {
      child.traverse((node) => {
        if (node instanceof CSS2DObject) node.element.remove();
        if (node instanceof THREE.Mesh) {
          if (node.userData.ownGeo === true) node.geometry.dispose();
          const material = node.material;
          if (Array.isArray(material)) for (const item of material) item.dispose();
          else material.dispose();
        }
      });
      root.remove(child);
    }
    reveals.length = 0;
    tinted.length = 0;
  }

  function nearest(x: number, z: number, plot: PlotRecord): number {
    const bounds = plotBounds(plot.gridX, plot.gridZ);
    const cx = Math.min(bounds.maxX, Math.max(bounds.minX, x));
    const cz = Math.min(bounds.maxZ, Math.max(bounds.minZ, z));
    return Math.hypot(x - cx, z - cz);
  }

  function rebuild(camera: THREE.Vector3, pip: THREE.Vector3, quality: Quality): void {
    const revealIds = new Set<string>();
    if (seen) {
      for (const plot of plots) {
        const before = prior.get(plot.id);
        if (plot.status === "unlocked" && before && before !== "unlocked") revealIds.add(plot.id);
      }
    }
    seen = true;
    prior.clear();
    for (const plot of plots) prior.set(plot.id, plot.status);
    clearRoot();
    holdLod = revealIds.size > 0;
    const cast = quality === "high";
    for (const plot of plots) {
      const distance = Math.min(nearest(camera.x, camera.z, plot), nearest(pip.x, pip.z, plot));
      const near = distance < NEAR;
      const segments = near ? (quality === "high" ? 10 : 6) : 3;
      const open = plot.status === "unlocked";
      const reveal = revealIds.has(plot.id);
      const geometry = makeGround(plot, segments);
      const group = new THREE.Group();
      if (open) {
        const land = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 1,
          metalness: 0,
          transparent: reveal,
          opacity: reveal ? 0 : 1,
        });
        const mesh = new THREE.Mesh(geometry, land);
        mesh.userData.ownGeo = true;
        mesh.receiveShadow = cast && near;
        mesh.castShadow = false;
        mesh.position.set(plot.gridX * PLOT_SIZE, 0, plot.gridZ * PLOT_SIZE);
        group.add(mesh);
        tinted.push(land);
        const props = near ? placeProps(plot, quality, group, cast && near, reveal) : [];
        if (reveal) {
          land.opacity = 0;
          for (const material of props) {
            material.transparent = true;
            material.opacity = 0;
          }
          const veil = new THREE.MeshStandardMaterial({
            color: "#d5deda",
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            roughness: 1,
          });
          const mist = new THREE.Mesh(geometry, veil);
          mist.position.set(plot.gridX * PLOT_SIZE, 0.12, plot.gridZ * PLOT_SIZE);
          group.add(mist);
          reveals.push({ land: [land, ...props], mist: [veil], t: 0 });
        }
      } else {
        const silhouette = new THREE.MeshStandardMaterial({
          vertexColors: true,
          color: "#9aa8a0",
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          roughness: 0.9,
        });
        const shape = new THREE.Mesh(geometry, silhouette);
        shape.userData.ownGeo = true;
        shape.position.set(plot.gridX * PLOT_SIZE, 0, plot.gridZ * PLOT_SIZE);
        const veil = new THREE.MeshStandardMaterial({
          color: "#e4eeea",
          transparent: true,
          opacity: 0.34,
          depthWrite: false,
          roughness: 1,
        });
        const mist = new THREE.Mesh(geometry, veil);
        mist.position.set(plot.gridX * PLOT_SIZE, 0.08, plot.gridZ * PLOT_SIZE);
        group.add(shape, mist);
        if (near) placeProps(plot, quality, group, false, true);
        group.add(marker(plot));
      }
      root.add(group);
    }
  }

  return {
    sync(next) {
      plots = next;
      dirty = true;
    },
    update(dt, camera, pip, quality, weights) {
      lodClock += dt;
      const cameraAt = camera.position;
      const statusKey = plots.map((plot) => `${plot.id}:${plot.status}`).join("|");
      let lodKey = lastLod;
      if (lodClock > 0.45 || dirty) {
        lodKey = plots
          .map((plot) => {
            const distance = Math.min(nearest(cameraAt.x, cameraAt.z, plot), nearest(pip.x, pip.z, plot));
            return distance < NEAR ? "n" : "f";
          })
          .join("") + quality;
        lodClock = 0;
      }
      const statusChanged = statusKey !== lastStatus;
      if (dirty || statusChanged || (!holdLod && lodKey !== lastLod)) {
        rebuild(cameraAt, pip, quality);
        lastStatus = statusKey;
        lastLod = lodKey;
        dirty = false;
      }
      tint.setRGB(0, 0, 0);
      for (const season of SEASONS) {
        const weight = weights[season] ?? 0;
        if (weight <= 0) continue;
        tint.add(SEASON_TINT[season].clone().multiplyScalar(weight));
      }
      for (const material of tinted) material.color.copy(tint);
      let running = false;
      for (const reveal of reveals) {
        reveal.t = Math.min(1, reveal.t + dt / 2.4);
        const lift = reveal.t;
        for (const material of reveal.mist) {
          material.opacity = 0.5 * (1 - lift);
        }
        for (const material of reveal.land) {
          material.opacity = lift;
          if (lift >= 1) {
            material.transparent = false;
            material.opacity = 1;
            material.depthWrite = true;
          }
        }
        if (lift < 1) running = true;
      }
      if (!running) holdLod = false;
    },
  };
}
