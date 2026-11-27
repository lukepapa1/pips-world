import type { ClientState } from "./state";

export type CreationFilters = {
  type: string;
  season: string;
  status: string;
  starred: boolean;
};

const TYPES = ["", "art", "writing", "design", "game", "site", "mechanic"];
const STATUSES = ["", "draft", "finished", "published", "archived"];

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const named: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return named[char] ?? char;
  });
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1);
}

function option(value: string, label: string, current: string): string {
  return `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
}

export function creationsMarkup(state: ClientState, filters: CreationFilters, selectedId: string | null): string {
  const library = state.creations;
  if (!library) return `<div class="skeleton" aria-busy="true" aria-label="Loading creations"><span></span><span></span><span></span></div>`;
  const ratio = library.budgetBytes > 0 ? library.usedBytes / library.budgetBytes : 0;
  const warning = ratio >= 0.8 ? `<p class="warn">Storage is at ${Math.round(ratio * 100)}% of the budget.</p>` : "";
  const head = `
    <p>Studio and gallery. ${mb(library.usedBytes)} / ${mb(library.budgetBytes)} MB used. One creation can be up to ${mb(library.maxCreationBytes)} MB. Nothing here is deleted.</p>
    ${warning}
    <form data-creations="budget">
      <label>Storage budget MB <input name="megabytes" type="number" min="64" max="20000" value="${Math.round(library.budgetBytes / (1024 * 1024))}"></label>
      <button type="submit">Save</button>
    </form>
    <form data-creations="max">
      <label>Largest creation MB <input name="megabytes" type="number" min="1" max="512" value="${Math.round(library.maxCreationBytes / (1024 * 1024))}"></label>
      <button type="submit">Save</button>
    </form>
    <label class="switch"><input type="checkbox" data-public ${library.publicEnabled ? "checked" : ""}> Public page of creations I mark public</label>
  `;
  const selected = library.items.find((item) => item.id === selectedId) ?? null;
  if (selected) return head + detail(state, selected);
  const seasons = ["", ...new Set(library.items.map((item) => item.season))];
  const shown = library.items.filter((item) => {
    if (filters.starred && !item.favourite) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.season && item.season !== filters.season) return false;
    if (filters.status === "archived") return item.archived;
    if (item.archived) return false;
    if (filters.status && item.status !== filters.status) return false;
    return true;
  });
  const cards = shown
    .map((item) => {
      const thumb = item.versions.at(-1)?.thumbnailUrl;
      const image = thumb
        ? `<img src="${esc(thumb)}" alt="" loading="lazy" decoding="async">`
        : `<span class="thumb-fallback">${esc(item.type)}</span>`;
      return `<button type="button" class="creation-card" data-open-creation="${esc(item.id)}">${image}<span>${item.favourite ? "★ " : ""}${esc(item.title)}</span><small>${esc(item.type)} · ${esc(item.status)}${item.archived ? " · archived" : ""}</small></button>`;
    })
    .join("");
  return `${head}
    <div class="creation-filters">
      <label>Type <select data-filter="type">${TYPES.map((value) => option(value, value || "All", filters.type)).join("")}</select></label>
      <label>Season <select data-filter="season">${seasons.map((value) => option(value, value || "All", filters.season)).join("")}</select></label>
      <label>Status <select data-filter="status">${STATUSES.map((value) => option(value, value || "Library", filters.status)).join("")}</select></label>
      <label class="switch"><input type="checkbox" data-filter="starred" ${filters.starred ? "checked" : ""}> Starred</label>
    </div>
    <div class="creation-grid">${cards || `<div class="empty-state"><h3>Nothing in this filter.</h3><p>Try another type, season, or status.</p></div>`}</div>`;
}

function detail(state: ClientState, item: NonNullable<ClientState["creations"]>["items"][number]): string {
  const latest = item.versions.at(-1);
  const first = item.versions[0];
  const images = item.versions.filter((version) => version.thumbnailUrl);
  const compare =
    images.length >= 2 && images[0]?.thumbnailUrl && images.at(-1)?.thumbnailUrl
      ? `<div class="compare"><img src="${esc(images[0].thumbnailUrl)}" alt=""><img class="after" data-after src="${esc(images.at(-1)?.thumbnailUrl ?? "")}" alt=""></div><label>Before / after <input type="range" min="0" max="100" value="100" data-compare></label>`
      : latest?.thumbnailUrl
        ? `<img class="creation-hero" src="${esc(latest.thumbnailUrl)}" alt="">`
        : "";
  const diary = item.diaryIds
    .map((id) => state.diary.find((entry) => entry.id === id))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => `<blockquote>${esc(entry.body)}</blockquote>`)
    .join("");
  const files = (latest?.files ?? []).map((file) => `<li>${esc(file.name)} · ${file.bytes} bytes</li>`).join("");
  const versions = item.versions
    .map((version) => `<li>v${version.version} · ${esc(version.createdAt.slice(0, 16).replace("T", " "))}</li>`)
    .join("");
  const download = latest ? `<a class="button" href="/creations/${esc(item.id)}/v/${latest.version}.zip">Download</a>` : "";
  const star = item.favourite ? "★ Starred" : "☆ Star";
  const publish =
    item.status === "published"
      ? `<button type="button" data-unpublish="${esc(item.id)}">Unmark public</button>`
      : item.status === "finished" && !item.archived
        ? `<button type="button" data-publish="${esc(item.id)}">Mark public</button>`
        : "";
  return `
    <button type="button" data-creation-back>Back</button>
    <h3>${esc(item.title)}</h3>
    <p>${esc(item.type)} · ${esc(item.status)} · ${esc(item.season)}${item.archived ? " · archived" : ""}</p>
    ${compare}
    <p>${esc(item.pipNotes || "No notes yet.")}</p>
    ${item.inspiredBy ? `<p>Inspired by ${esc(item.inspiredBy)}</p>` : ""}
    ${item.domains.length ? `<p>Domains: ${esc(item.domains.join(", "))}</p>` : ""}
    ${diary ? `<h3>Diary</h3>${diary}` : ""}
    <h3>Versions</h3>
    <ul>${versions}</ul>
    ${files ? `<ul>${files}</ul>` : ""}
    <p class="creation-actions">
      <button type="button" data-star="${esc(item.id)}" data-favourite="${item.favourite ? "1" : "0"}">${star}</button>
      ${publish}
      ${item.archived ? "" : `<button type="button" data-archive="${esc(item.id)}">Archive</button>`}
      ${download}
    </p>
    ${first ? "" : ""}
  `;
}
