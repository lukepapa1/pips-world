import { BUILDING_NAMES, isBuildingId, type BlueprintRecord, type WorldEvent } from "@pips/shared";
import * as THREE from "three";
import { eventText } from "./describe";
import { makeBlueprintMesh } from "./render/blueprintMesh";
import type { ClientState } from "./state";

export type OverviewTab = "now" | "mind" | "making" | "blueprints" | "stats";

export type OverviewData = {
  now: { season: string; time: string; zoneName: string; date: string; period: string };
  mind: {
    interestFile: string;
    interests: {
      name: string;
      summary: string;
      strength: number | null;
      firstSeen: string | null;
      lastActive: string | null;
      hobby: boolean;
      diaryIds: string[];
      domains: string[];
      creationIds: string[];
      fromFile: boolean;
    }[];
    identity: { body: string; versions: { version: number; createdAt: string; excerpt: string }[] };
    reading: { domain: string; topic: string; at: string }[];
  };
  making: { projects: { title: string; body: string }[] };
  blueprints: {
    notes: { name: string; version: number; body: string }[];
    diaryNotes: { name: string; version: number; body: string }[];
  };
  stats: {
    daysAlive: number;
    ticks: number;
    diary: number;
    builds: number;
    creations: number;
    pagesRead: number;
    activity: { day: number; count: number }[];
    toolErrors: number;
    toolFailures: { tool: string; error: string }[];
    private: { calls: number; callCap: number; tokensToday: number; spendUsd: number } | null;
  };
};

export type OverviewUi = {
  tab: OverviewTab;
  page: number;
  blueprint: string;
  detail: string;
};

const TABS: { id: OverviewTab; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "mind", label: "Mind" },
  { id: "making", label: "Making" },
  { id: "blueprints", label: "Blueprints" },
  { id: "stats", label: "Stats" },
];

const BLUEPRINT_PAGE = 12;
const MAKING_PAGE = 20;
const PREVIEW_CAP = 2;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char);
}

function line(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function latestThumb(item: { versions: { thumbnailUrl: string | null }[] }): string | null {
  for (let index = item.versions.length - 1; index >= 0; index -= 1) {
    const url = item.versions[index]?.thumbnailUrl;
    if (url) return url;
  }
  return null;
}

function liveOf(records: BlueprintRecord[]): BlueprintRecord | undefined {
  return records.find((record) => record.status === "live") ?? records[records.length - 1];
}

function grouped(records: BlueprintRecord[]): { name: string; versions: BlueprintRecord[] }[] {
  const order: string[] = [];
  const byName = new Map<string, BlueprintRecord[]>();
  for (const record of records) {
    const list = byName.get(record.name);
    if (list) list.push(record);
    else {
      byName.set(record.name, [record]);
      order.push(record.name);
    }
  }
  return order.map((name) => ({
    name,
    versions: (byName.get(name) ?? []).slice().sort((a, b) => a.version - b.version),
  }));
}

function usersOf(state: ClientState, name: string): number {
  return state.objects.filter((object) => object.blueprint === name || (object.blueprint == null && object.type === name)).length;
}

function noteFor(data: OverviewData | null, name: string, version: number): { text: string; source: "note" | "diary" | "none" } {
  const saved = data?.blueprints.notes.find((note) => note.name === name && note.version === version);
  if (saved?.body.trim()) return { text: saved.body.trim(), source: "note" };
  const diary = data?.blueprints.diaryNotes.find((note) => note.name === name && note.version === version);
  if (diary?.body.trim()) return { text: diary.body.trim(), source: "diary" };
  return { text: "No note saved with this version.", source: "none" };
}

function tabs(ui: OverviewUi): string {
  return `<div class="overview-tabs" role="tablist">${TABS.map(
    (tab) =>
      `<button type="button" role="tab" data-overview-tab="${tab.id}" aria-selected="${ui.tab === tab.id ? "true" : "false"}">${tab.label}</button>`,
  ).join("")}</div>`;
}

function nowTab(state: ClientState, data: OverviewData | null): string {
  const place = state.pipAt && isBuildingId(state.pipAt) ? BUILDING_NAMES[state.pipAt] : "Between places";
  const latest = state.events.at(-1);
  const pieces = (state.creations?.items ?? []).filter((item) => !item.archived);
  const draft = pieces.find((item) => item.status === "draft") ?? pieces.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const doing = state.browsing
    ? `Reading ${state.browsing}`
    : draft?.status === "draft"
      ? `Making ${draft.title}`
      : latest
        ? eventText(latest)
        : "Quiet for the moment.";
  const world = state.world;
  const season = world?.season ?? data?.now.season ?? "season";
  const time = world ? `${world.time} ${world.zoneName}` : data ? `${data.now.time} ${data.now.zoneName}` : "";
  const period = world?.period ?? data?.now.period ?? "";
  const project = draft
    ? { title: draft.title, detail: `${draft.type} · ${draft.status}`, thumb: latestThumb(draft), id: draft.id }
    : data?.making.projects[0]
      ? { title: data.making.projects[0].title, detail: line(data.making.projects[0].body, 140), thumb: null, id: "" }
      : null;
  const diary = state.diary.slice(0, 5);
  return `<section>
    <p class="overview-kicker">Day ${state.day}</p>
    <h3>${esc(place)}</h3>
    <p>${esc(doing)}</p>
    <p class="muted">${esc(season)} · ${esc(period)} · ${esc(time)}</p>
    ${
      project
        ? `<article class="overview-card" ${project.id ? `data-open-creation="${esc(project.id)}"` : ""}>
            ${project.thumb ? `<img src="${esc(project.thumb)}" alt="" loading="lazy" decoding="async" />` : ""}
            <div><strong>${esc(project.title)}</strong><p>${esc(project.detail)}</p></div>
          </article>`
        : `<p class="empty">No project or creation in progress.</p>`
    }
    <h3>Last diary lines</h3>
    ${
      diary.length
        ? diary.map((entry) => `<p class="diary-line">Day ${entry.day} · ${esc(line(entry.body))}</p>`).join("")
        : `<p class="empty">No diary entries yet.</p>`
    }
  </section>`;
}

function mindTab(data: OverviewData | null, error: string): string {
  if (!data) return `<p class="empty">${esc(error || "Loading his notes…")}</p>`;
  const cards = data.mind.interests
    .map((card) => {
      const links = [
        ...card.diaryIds.map((id) => `diary ${id.slice(0, 8)}`),
        ...card.domains,
        ...card.creationIds.map((id) => `creation ${id.slice(0, 8)}`),
      ];
      return `<article class="interest-card">
        <header><strong>${esc(card.name)}</strong>${card.hobby ? `<span class="hobby">hobby</span>` : ""}</header>
        <p>${esc(card.summary || "No summary yet.")}</p>
        <p class="muted">${
          card.strength == null
            ? "From the interest file. Strength is not stored yet."
            : `Strength ${card.strength} of 5. First seen ${esc(card.firstSeen ?? "")}. Last active ${esc(card.lastActive ?? "")}.`
        }</p>
        ${links.length ? `<p class="muted">${esc(links.join(" · "))}</p>` : ""}
      </article>`;
    })
    .join("");
  const versions = data.mind.identity.versions
    .map(
      (version) =>
        `<li><strong>Version ${version.version}</strong> ${version.createdAt ? `<time>${esc(version.createdAt.slice(0, 16).replace("T", " "))}</time>` : ""}<p>${esc(version.excerpt || "Empty.")}</p></li>`,
    )
    .join("");
  const reading = data.mind.reading
    .map((item) => `<li><strong>${esc(item.domain || "page")}</strong> ${esc(line(item.topic, 120))}</li>`)
    .join("");
  return `<section>
    <h3>Interests</h3>
    ${cards || (data.mind.interestFile ? `<article class="interest-card"><p>${esc(data.mind.interestFile)}</p></article>` : `<p class="empty">No interests written yet.</p>`)}
    <article class="overview-card identity-card">
      <h3>Identity</h3>
      <p>${esc(data.mind.identity.body || "identity.md is empty.")}</p>
      ${versions ? `<ol class="versions">${versions}</ol>` : ""}
    </article>
    <h3>What he’s been reading</h3>
    <p class="muted">Domains and topics from the last 7 days.</p>
    ${reading ? `<ul class="reading">${reading}</ul>` : `<p class="empty">Nothing browsed in the last 7 days.</p>`}
  </section>`;
}

function makingItems(state: ClientState, data: OverviewData | null): { key: string; title: string; meta: string; kind: string }[] {
  const items: { key: string; title: string; meta: string; kind: string }[] = [];
  for (const project of data?.making.projects ?? []) {
    items.push({ key: `project:${items.length}`, title: project.title, meta: "Project", kind: "project" });
  }
  for (const creation of state.creations?.items ?? []) {
    if (creation.archived) continue;
    if (creation.status !== "draft" && creation.status !== "finished" && creation.status !== "published") continue;
    items.push({
      key: `creation:${creation.id}`,
      title: creation.title,
      meta: `${creation.type} · ${creation.status}`,
      kind: creation.type === "mechanic" ? "mechanic" : "creation",
    });
  }
  const builds = state.events.filter((event): event is Extract<WorldEvent, { kind: "build" }> => event.kind === "build").slice(-12).reverse();
  for (const build of builds) {
    items.push({
      key: `build:${build.id}`,
      title: `${build.payload.type} at ${build.payload.x.toFixed(1)}, ${build.payload.z.toFixed(1)}`,
      meta: `Build · ${build.payload.action}`,
      kind: "build",
    });
  }
  return items;
}

function makingTab(state: ClientState, data: OverviewData | null, ui: OverviewUi): string {
  const items = makingItems(state, data);
  const start = ui.page * MAKING_PAGE;
  const page = items.slice(start, start + MAKING_PAGE);
  const selected = page.find((item) => item.key === ui.detail) ?? null;
  const cards = page
    .map(
      (item) =>
        `<button type="button" class="overview-card link" data-making="${esc(item.key)}" aria-pressed="${item.key === ui.detail ? "true" : "false"}"><strong>${esc(item.title)}</strong><span>${esc(item.meta)}</span></button>`,
    )
    .join("");
  let detail = "";
  if (selected?.kind === "project") {
    const index = Number(selected.key.slice("project:".length));
    const project = data?.making.projects[index];
    detail = project ? `<article class="overview-detail"><h3>${esc(project.title)}</h3><p>${esc(project.body || "No notes in the project file.")}</p></article>` : "";
  }
  if (selected?.kind === "build") {
    const event = state.events.find((item) => item.id === selected.key.slice("build:".length));
    detail = event ? `<article class="overview-detail"><h3>${esc(selected.title)}</h3><p>${esc(eventText(event))}</p></article>` : "";
  }
  const more = items.length > start + MAKING_PAGE ? `<button type="button" data-overview-page="${ui.page + 1}">More</button>` : "";
  const back = ui.page > 0 ? `<button type="button" data-overview-page="${ui.page - 1}">Previous</button>` : "";
  return `<section>
    <h3>In progress and recent</h3>
    ${cards || `<p class="empty">Nothing in progress yet.</p>`}
    ${detail}
    <p class="pager">${back}${more}</p>
  </section>`;
}

function slotUsage(spec: BlueprintRecord["spec"]): string {
  const body = spec.building;
  if (!body) return "";
  const kinds = body.interior.map((slot) => slot.kind).join(", ");
  return ` · ${body.interior.length} slots (${kinds})`;
}

function blueprintTab(state: ClientState, data: OverviewData | null, ui: OverviewUi): string {
  const groups = grouped(state.blueprints);
  const start = ui.page * BLUEPRINT_PAGE;
  const page = groups.slice(start, start + BLUEPRINT_PAGE);
  const selected = groups.find((group) => group.name === ui.blueprint);
  const cards = page
    .map((group) => {
      const current = liveOf(group.versions);
      if (!current) return "";
      return `<button type="button" class="bp-card" data-blueprint="${esc(group.name)}">
        <canvas data-blueprint-preview="${esc(group.name)}" data-version="${current.version}" width="160" height="120"></canvas>
        <strong>${esc(group.name)}</strong>
        <span>v${current.version} ${esc(current.status)} · ${usersOf(state, group.name)} in the village${slotUsage(current.spec)}</span>
      </button>`;
    })
    .join("");
  let detail = "";
  if (selected) {
    const versions = selected.versions.slice().reverse();
    const current = liveOf(selected.versions);
    const oldest = selected.versions[0];
    const history = versions
      .map((record) => {
        const note = noteFor(data, record.name, record.version);
        const label = note.source === "diary" ? "From his diary that hour" : note.source === "note" ? "His note" : "";
        const rollback =
          current && record.version !== current.version
            ? `<button type="button" data-rollback="${esc(record.name)}" data-version="${record.version}">Roll back to v${record.version}</button>`
            : "";
        return `<li><strong>v${record.version}</strong> <span>${esc(record.status)}</span> ${rollback}<p>${label ? `<em>${label}.</em> ` : ""}${esc(line(note.text, 320))}</p></li>`;
      })
      .join("");
    detail = `<article class="overview-detail">
      <h3>${esc(selected.name)}</h3>
      ${current?.spec.building ? `<p>${esc(slotUsage(current.spec).replace(/^ · /, ""))}</p>` : ""}
      ${
        oldest && current
          ? `<canvas data-compare-canvas data-blueprint-preview="${esc(selected.name)}" data-before="${oldest.version}" data-after="${current.version}" width="320" height="200"></canvas>
             <label class="compare-label">Before <input type="range" min="0" max="100" value="100" data-compare="${esc(selected.name)}" /> After</label>`
          : ""
      }
      <ol class="versions">${history}</ol>
      <button type="button" data-blueprint="">Back to the grid</button>
    </article>`;
  }
  const more = groups.length > start + BLUEPRINT_PAGE ? `<button type="button" data-overview-page="${ui.page + 1}">More</button>` : "";
  const back = ui.page > 0 ? `<button type="button" data-overview-page="${ui.page - 1}">Previous</button>` : "";
  return `<section>
    ${selected ? "" : `<div class="bp-grid">${cards || `<div class="empty-state"><h3>No blueprints yet.</h3><p>Versions Pip designs will show up here.</p></div>`}</div>`}
    ${detail}
    ${selected ? "" : `<p class="pager">${back}${more}</p>`}
  </section>`;
}

function statsTab(data: OverviewData | null, error: string): string {
  if (!data) return `<p class="empty">${esc(error || "Loading the counts…")}</p>`;
  const stats = data.stats;
  const cells = [
    ["Days alive", String(stats.daysAlive)],
    ["Ticks run", String(stats.ticks)],
    ["Diary entries", String(stats.diary)],
    ["Builds", String(stats.builds)],
    ["Creations", String(stats.creations)],
    ["Pages read", String(stats.pagesRead)],
    ["Tool errors", String(stats.toolErrors ?? 0)],
  ];
  if (stats.private) {
    cells.push(["Model calls today", `${stats.private.calls} / ${stats.private.callCap}`]);
    cells.push(["Estimated spend today", `$${stats.private.spendUsd.toFixed(4)}`]);
  }
  const max = Math.max(1, ...stats.activity.map((day) => day.count));
  const bars = stats.activity
    .map(
      (day) =>
        `<span title="Day ${day.day}: ${day.count}"><i style="height:${Math.max(4, Math.round((day.count / max) * 100))}%"></i><em>${day.day}</em></span>`,
    )
    .join("");
  const failures = (stats.toolFailures ?? [])
    .map((row) => `<li><strong>${esc(row.tool)}</strong> ${esc(row.error)}</li>`)
    .join("");
  return `<section>
    <div class="stat-grid">${cells.map(([label, value]) => `<article><span>${esc(label ?? "")}</span><strong>${esc(value ?? "")}</strong></article>`).join("")}</div>
    ${stats.private ? `<p class="muted">Spend is an estimate from today’s ${stats.private.tokensToday.toLocaleString("en-AU")} tokens. Older days are not stored.</p>` : ""}
    <h3>Tool problems</h3>
    ${failures ? `<ul class="tool-failures">${failures}</ul>` : `<p class="empty">No tool problems.</p>`}
    <h3>Activity per day</h3>
    <div class="bars">${bars || `<p class="empty">No events yet.</p>`}</div>
  </section>`;
}

export function overviewMarkup(state: ClientState, data: OverviewData | null, ui: OverviewUi, error: string): string {
  const body =
    ui.tab === "now"
      ? nowTab(state, data)
      : ui.tab === "mind"
        ? mindTab(data, error)
        : ui.tab === "making"
          ? makingTab(state, data, ui)
          : ui.tab === "blueprints"
            ? blueprintTab(state, data, ui)
            : statsTab(data, error);
  return `${tabs(ui)}<div class="overview-body">${body}</div>`;
}

const running = new Map<HTMLCanvasElement, () => void>();
let stopGrid: (() => void) | null = null;

export function releaseOverviewPreviews(): void {
  for (const stop of running.values()) stop();
  running.clear();
  stopGrid?.();
  stopGrid = null;
}

function specOf(state: ClientState, name: string, version: number): BlueprintRecord | undefined {
  return state.blueprints.find((record) => record.name === name && record.version === version);
}

function frame(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.4);
  camera.position.set(center.x + span * 1.4, center.y + span * 0.8, center.z + span * 1.6);
  camera.lookAt(center);
  camera.near = 0.05;
  camera.far = span * 20;
  camera.updateProjectionMatrix();
}

function startPreview(canvas: HTMLCanvasElement, state: ClientState): (() => void) | null {
  const name = canvas.dataset.blueprintPreview;
  if (!name) return null;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, (canvas.clientWidth || 160) / (canvas.clientHeight || 120), 0.05, 40);
  scene.add(new THREE.AmbientLight("#fff8ee", 0.9));
  const key = new THREE.DirectionalLight("#fff", 1.15);
  key.position.set(3, 5, 2);
  scene.add(key);
  const groups: THREE.Group[] = [];
  const beforeVersion = Number(canvas.dataset.before);
  const afterVersion = Number(canvas.dataset.after);
  if (canvas.dataset.compareCanvas != null && Number.isFinite(beforeVersion) && Number.isFinite(afterVersion)) {
    const beforeSpec = specOf(state, name, beforeVersion);
    const afterSpec = specOf(state, name, afterVersion);
    if (beforeSpec) {
      const before = makeBlueprintMesh(beforeSpec.spec, "", { cutaway: Boolean(beforeSpec.spec.building) });
      scene.add(before);
      groups.push(before);
    }
    if (afterSpec) {
      const after = makeBlueprintMesh(afterSpec.spec, "", { cutaway: Boolean(afterSpec.spec.building) });
      scene.add(after);
      groups.push(after);
    }
  } else {
    const version = Number(canvas.dataset.version);
    const record = specOf(state, name, version);
    if (!record) {
      renderer.dispose();
      return null;
    }
    const mesh = makeBlueprintMesh(record.spec, "", { cutaway: Boolean(record.spec.building) });
    scene.add(mesh);
    groups.push(mesh);
  }
  if (groups.length === 0) {
    renderer.dispose();
    return null;
  }
  frame(camera, groups[1] ?? groups[0]!);
  let frameId = 0;
  const draw = () => {
    frameId = requestAnimationFrame(draw);
    if (!reduced && groups.length === 1 && groups[0]) groups[0].rotation.y += 0.012;
    renderer.render(scene, camera);
  };
  draw();
  const setMix = (value: number) => {
    const before = groups[0];
    const after = groups[1];
    if (!before || !after) return;
    const shown = Math.min(1, Math.max(0, value));
    setOpacity(before, 1 - shown);
    setOpacity(after, shown);
  };
  if (groups.length > 1) setMix(1);
  canvas.dataset.mixReady = "1";
  (canvas as HTMLCanvasElement & { setMix?: (value: number) => void }).setMix = setMix;
  return () => {
    cancelAnimationFrame(frameId);
    renderer.dispose();
    for (const group of groups) {
      group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((item) => item.dispose());
        else material?.dispose();
      });
    }
  };
}

function setOpacity(group: THREE.Group, opacity: number): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const material = mesh.material;
    const list = Array.isArray(material) ? material : material ? [material] : [];
    for (const item of list) {
      item.transparent = opacity < 1;
      item.opacity = opacity;
    }
  });
}

function mountGrid(canvases: HTMLCanvasElement[], state: ClientState): void {
  const cards = canvases.filter((canvas) => canvas.dataset.compareCanvas == null);
  if (cards.length === 0) return;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(160, 120, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight("#fff8ee", 0.9));
  const key = new THREE.DirectionalLight("#fff", 1.15);
  key.position.set(3, 5, 2);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(35, 160 / 120, 0.05, 40);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const items = cards.flatMap((canvas) => {
    const name = canvas.dataset.blueprintPreview;
    const version = Number(canvas.dataset.version);
    if (!name) return [];
    const record = specOf(state, name, version);
    if (!record) return [];
    const context = canvas.getContext("2d");
    if (!context) return [];
    return [{ canvas, context, mesh: makeBlueprintMesh(record.spec, "", { cutaway: Boolean(record.spec.building) }) }];
  });
  let frameId = 0;
  const draw = () => {
    frameId = requestAnimationFrame(draw);
    for (const item of items) {
      if (!item.canvas.isConnected) continue;
      if (!reduced) item.mesh.rotation.y += 0.012;
      scene.add(item.mesh);
      frame(camera, item.mesh);
      renderer.render(scene, camera);
      item.context.drawImage(renderer.domElement, 0, 0, item.canvas.width, item.canvas.height);
      scene.remove(item.mesh);
    }
  };
  draw();
  stopGrid = () => {
    cancelAnimationFrame(frameId);
    renderer.dispose();
    for (const item of items) {
      item.mesh.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
    }
  };
}

export function bindOverview(root: HTMLElement, state: ClientState): void {
  const canvases = [...root.querySelectorAll<HTMLCanvasElement>("canvas[data-blueprint-preview]")];
  const detail = canvases.find((canvas) => canvas.dataset.compareCanvas != null);
  mountGrid(canvases, state);
  if (detail && running.size < PREVIEW_CAP) {
    const stop = startPreview(detail, state);
    if (stop) running.set(detail, stop);
  }
  const slider = root.querySelector<HTMLInputElement>("[data-compare]");
  slider?.addEventListener("input", () => {
    const canvas = root.querySelector<HTMLCanvasElement>("[data-compare-canvas]");
    const mix = (canvas as (HTMLCanvasElement & { setMix?: (value: number) => void }) | null)?.setMix;
    mix?.(Number(slider.value) / 100);
  });
}
