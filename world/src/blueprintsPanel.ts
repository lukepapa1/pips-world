import type { BlueprintRecord } from "@pips/shared";
import * as THREE from "three";
import { makeBlueprintMesh } from "./render/blueprintMesh";
import type { ClientState } from "./state";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function pendingBlueprintCount(state: ClientState): number {
  return state.blueprints.filter((record) => record.status === "pending").length;
}

export function blueprintMarkup(state: ClientState): string {
  const names = [...new Set(state.blueprints.map((record) => record.name))].sort();
  if (names.length === 0) return `<div class="empty-state"><h3>No blueprints yet.</h3><p>Versions Pip designs will show up here.</p></div>`;
  const groups = names
    .map((name) => {
      const versions = state.blueprints
        .filter((record) => record.name === name)
        .sort((a, b) => b.version - a.version);
      const live = versions.find((record) => record.status === "live") ?? versions[0];
      const usage = live ? slotUsage(live) : "";
      const preview = live?.spec.building
        ? `<canvas data-building-preview="${esc(name)}" data-version="${live.version}" width="160" height="120"></canvas>`
        : "";
      const rows = versions
        .map((record) => {
          const label = record.status === "live" ? "Live" : record.status === "pending" ? "Waiting" : "Earlier";
          const who = record.createdBy === "pip" ? "Pip" : "Village";
          const action =
            record.status === "pending"
              ? `<button type="button" data-approve="${esc(name)}" data-version="${record.version}">Approve</button>`
              : record.status === "live"
                ? ""
                : `<button type="button" data-rollback="${esc(name)}" data-version="${record.version}">Rollback</button>`;
          return `<li><span>${esc(name)} v${record.version}</span><span class="status">${label}</span><span class="who">${who}</span>${action}</li>`;
        })
        .join("");
      return `<section class="blueprint-name"><h3>${esc(name)}</h3>${preview}${usage}<ul>${rows}</ul></section>`;
    })
    .join("");
  return groups;
}

function slotUsage(record: BlueprintRecord): string {
  const body = record.spec.building;
  if (!body) return "";
  const kinds = body.interior.map((slot) => slot.kind).join(", ");
  return `<p class="slot-usage">${body.interior.length} slots: ${esc(kinds)}. ${body.footprint.width.toFixed(1)} by ${body.footprint.depth.toFixed(1)}, ${body.floors} floor${body.floors === 1 ? "" : "s"}.</p>`;
}

export function mountBuildingPreviews(root: ParentNode, state: ClientState): void {
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>("canvas[data-building-preview]")];
  if (canvases.length === 0) return;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(160, 120, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight("#fff8ee", 0.95));
  const key = new THREE.DirectionalLight("#fff", 1.1);
  key.position.set(2, 4, 3);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(32, 160 / 120, 0.05, 40);
  for (const canvas of canvases) {
    const name = canvas.dataset.buildingPreview;
    const version = Number(canvas.dataset.version);
    const record = state.blueprints.find((item) => item.name === name && item.version === version);
    if (!record?.spec.building) continue;
    const mesh = makeBlueprintMesh(record.spec, "", { cutaway: true });
    scene.add(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    camera.position.set(center.x + size.x, center.y + size.y * 0.8, center.z + size.z * 1.4);
    camera.lookAt(center);
    renderer.render(scene, camera);
    const context = canvas.getContext("2d");
    if (context) context.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
    scene.remove(mesh);
  }
  renderer.dispose();
}
