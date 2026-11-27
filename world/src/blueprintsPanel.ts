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
      return `<section class="blueprint-name"><h3>${esc(name)}</h3><ul>${rows}</ul></section>`;
    })
    .join("");
  return groups;
}
