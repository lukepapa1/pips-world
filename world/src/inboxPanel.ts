import type { ClientState } from "./state";

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

export function inboxCount(state: ClientState): number {
  const requests = state.requests.filter((item) => item.status === "pending").length;
  const blueprints = state.blueprints.filter((item) => item.status === "pending").length;
  const digests = state.digests.filter((item) => !item.readAt).length;
  return requests + blueprints + digests;
}

export function inboxMarkup(state: ClientState, connected: boolean): string {
  if (!connected && state.requests.length === 0 && state.digests.length === 0) {
    return `<div class="skeleton" aria-busy="true" aria-label="Loading the inbox"><span></span><span></span><span></span></div>`;
  }
  const cards: string[] = [];
  for (const request of state.requests) {
    if (request.status !== "pending") continue;
    cards.push(`<article class="inbox-card">
      <div class="inbox-row">
        <p class="inbox-kind">Request</p>
        <h3>${esc(request.title)}</h3>
        <p>${esc(request.body)}</p>
        <div class="row-actions">
          <button type="button" data-decision="approved" data-id="${esc(request.id)}" data-swipe="approve">Approve</button>
          <button type="button" class="danger" data-decision="denied" data-id="${esc(request.id)}" data-swipe="deny">Deny</button>
        </div>
      </div>
    </article>`);
  }
  for (const record of state.blueprints) {
    if (record.status !== "pending") continue;
    cards.push(`<article class="inbox-card">
      <div class="inbox-row">
        <p class="inbox-kind">Blueprint</p>
        <h3>${esc(record.name.replaceAll("_", " "))} version ${record.version}</h3>
        <p>Pip is waiting for this version to go live.</p>
        <div class="row-actions">
          <button type="button" data-approve="${esc(record.name)}" data-version="${record.version}" data-swipe="approve">Approve</button>
        </div>
      </div>
    </article>`);
  }
  for (const digest of state.digests) {
    if (digest.readAt) continue;
    cards.push(`<article class="inbox-card">
      <div class="inbox-row">
        <p class="inbox-kind">Digest</p>
        <h3>${esc(digest.headline)}</h3>
        <p>Day ${digest.day} is ready to read.</p>
        <div class="row-actions">
          <button type="button" data-open-digest="${digest.day}" data-swipe="approve">Open</button>
        </div>
      </div>
    </article>`);
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    cards.push(`<article class="inbox-card">
      <div class="inbox-row">
        <p class="inbox-kind">Alerts</p>
        <h3>Notifications are off</h3>
        <p>This phone is not telling you when a request or a digest arrives.</p>
        <div class="row-actions">
          <button type="button" data-open-settings="notifications">Notification settings</button>
        </div>
      </div>
    </article>`);
  }
  if (cards.length === 0) {
    return `<div class="empty-state"><h3>Nothing needs you</h3><p>When Pip asks for something, waits on a blueprint, or finishes a day, it shows up here.</p></div>`;
  }
  return cards.join("");
}

export function bindInboxSwipe(root: HTMLElement): void {
  for (const card of root.querySelectorAll<HTMLElement>(".inbox-card")) {
    if (card.dataset.swipeBound === "1") continue;
    card.dataset.swipeBound = "1";
    const row = card.querySelector<HTMLElement>(".inbox-row");
    if (!row) continue;
    let startX = 0;
    let delta = 0;
    let tracking = false;
    card.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      tracking = true;
      startX = event.clientX;
      delta = 0;
    });
    card.addEventListener("pointermove", (event) => {
      if (!tracking) return;
      delta = event.clientX - startX;
      row.style.transform = `translateX(${Math.max(-96, Math.min(96, delta))}px)`;
    });
    const finish = () => {
      if (!tracking) return;
      tracking = false;
      row.style.transform = "";
      if (delta > 72) card.querySelector<HTMLButtonElement>("[data-swipe='approve']")?.click();
      else if (delta < -72) card.querySelector<HTMLButtonElement>("[data-swipe='deny']")?.click();
      delta = 0;
    };
    card.addEventListener("pointerup", finish);
    card.addEventListener("pointercancel", finish);
  }
}
