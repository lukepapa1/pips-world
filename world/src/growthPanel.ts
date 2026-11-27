import type { ClientState } from "./state";

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function growthMarkup(state: ClientState): string {
  const growth = state.growth;
  if (!growth) return `<div class="skeleton" aria-busy="true" aria-label="Loading pace"><span></span><span></span></div>`;
  const status = growth.asleep ? "Asleep" : "Awake";
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
              `<section class="blueprint-name"><h3>${esc(plan.topic)}</h3><p>${esc(plan.why)}</p><p>${plan.ticksDone} of ${plan.plannedTicks} ticks noted.</p></section>`,
          )
          .join("");
  const topics = growth.topicsThisWeek.length === 0 ? "None yet." : growth.topicsThisWeek.map((topic) => esc(topic)).join("; ");
  return `
    <p>${status}. Awake ${String(growth.awakeStart).padStart(2, "0")}:00–${String(growth.awakeEnd).padStart(2, "0")}:00. ${growth.slotsToday} slots, every ${growth.intervalMinutes} min. ${share}.</p>
    <p>Model calls ${growth.callsUsed} / ${growth.callCap}. Page reads ${growth.readsUsed} / ${growth.readCap}. Searches ${growth.searchesUsed} / ${growth.searchCap}.</p>
    <h3>Today</h3>
    <p class="slot-list">${slots}</p>
    <h3>Studies</h3>
    ${plans}
    <p>${growth.notesCount} notes. Topics this week: ${topics}</p>
    <p class="who">Tick model ${esc(growth.tickModel)}. Reflection model ${esc(growth.reflectModel)}.</p>
  `;
}
