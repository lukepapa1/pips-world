import type { ClientState } from "./state";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function growthMarkup(state: ClientState): string {
  const growth = state.growth;
  if (!growth) return `<div class="skeleton" aria-busy="true" aria-label="Loading pace"><span></span><span></span></div>`;
  const paceButtons = (["calm", "active", "fast"] as const)
    .map((pace) => {
      const label = pace === "calm" ? "Calm · 60 min" : pace === "active" ? "Active · 30 min" : "Fast · 15 min";
      const current = growth.pace === pace ? " aria-pressed=\"true\"" : "";
      return `<button type="button" data-pace="${pace}"${current}>${label}</button>`;
    })
    .join("");
  const status = growth.asleep ? "Asleep" : growth.morning ? "Morning tick" : "Awake";
  const share = growth.asleep ? "no tick" : `${growth.callShare} calls this slot`;
  const slots = growth.slots
    .map((slot) => `${esc(slot.time)}${slot.morning ? " morning" : ""}`)
    .join(", ");
  const plans =
    growth.plans.length === 0
      ? `<p class="empty">No study is open.</p>`
      : growth.plans
          .map(
            (plan) =>
              `<section class="blueprint-name"><h3>${esc(plan.topic)}</h3><p>${esc(plan.why)}</p><p>${plan.ticksDone} of ${plan.plannedTicks} ticks noted.</p><button type="button" data-end-study="${esc(plan.id)}">End</button></section>`,
          )
          .join("");
  const topics = growth.topicsThisWeek.length === 0 ? "None yet." : growth.topicsThisWeek.map((topic) => esc(topic)).join("; ");
  return `
    <div class="pace-row">${paceButtons}</div>
    <p>${status}. Awake ${String(growth.awakeStart).padStart(2, "0")}:00–${String(growth.awakeEnd).padStart(2, "0")}:00. ${growth.slotsToday} slots, every ${growth.intervalMinutes} min. ${share}.</p>
    <p>Model calls ${growth.callsUsed} / ${growth.callCap}. Page reads ${growth.readsUsed} / ${growth.readCap}. Searches ${growth.searchesUsed} / ${growth.searchCap}.</p>
    <form data-growth="awake">
      <label>Awake from <input name="start" type="number" min="0" max="22" value="${growth.awakeStart}" /></label>
      <label>until <input name="end" type="number" min="1" max="23" value="${growth.awakeEnd}" /></label>
      <button type="submit">Save hours</button>
    </form>
    <form data-growth="reads">
      <label>Page reads a day <input name="cap" type="number" min="0" max="2000" value="${growth.readCap}" /></label>
      <button type="submit">Save</button>
    </form>
    <h3>Today</h3>
    <p class="slot-list">${slots}</p>
    <h3>Studies</h3>
    ${plans}
    <p>${growth.notesCount} notes. Topics this week: ${topics}</p>
    <p class="who">Tick model ${esc(growth.tickModel)}. Reflection model ${esc(growth.reflectModel)}.</p>
  `;
}
