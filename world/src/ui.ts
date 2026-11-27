import {
  BUILDING_NAMES,
  hourFromTick,
  isSeason,
  type ClientMessage,
  type DiaryRow,
  type DigestRow,
  type DigestSections,
  type RequestRow,
  type Season,
} from "@pips/shared";
import { blueprintMarkup, pendingBlueprintCount } from "./blueprintsPanel";
import { growthMarkup } from "./growthPanel";
import { creationsMarkup, type CreationFilters } from "./creationsPanel";
import { bindInboxSwipe, inboxCount, inboxMarkup } from "./inboxPanel";
import { connect } from "./socket";
import type { OverviewData, OverviewTab, OverviewUi } from "./overviewPanel";
import { eventClass, eventHour, eventLabel, eventText } from "./describe";
import { mountAlerts } from "./alerts";
import {
  getState,
  markDigestReadLocal,
  markDiaryRead,
  pendingRequestCount,
  unreadDiaryCount,
  unreadDigestCount,
  type ClientState,
} from "./state";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

function formatWhen(iso: string): { time: string; title: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { time: "", title: "" };
  try {
    return {
      time: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      title: date.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    };
  } catch {
    return { time: "", title: "" };
  }
}

const SEASON_ICON: Record<Season, string> = {
  spring: "🌸",
  summer: "☀",
  autumn: "🍂",
  winter: "🌧",
};

function seasonName(season: Season): string {
  return season.charAt(0).toUpperCase() + season.slice(1);
}

function setCount(element: HTMLElement, count: number): void {
  element.hidden = count <= 0;
  element.textContent = count > 9 ? "9+" : String(count);
}

function diaryMarkup(entries: DiaryRow[]): string {
  if (entries.length === 0) {
    return `<div class="empty-state"><h3>The diary is blank.</h3><p>Pip writes a note at the end of each hour. It will show up here.</p></div>`;
  }
  const sorted = [...entries].sort(
    (a, b) => b.day - a.day || b.tick - a.tick || b.createdAt.localeCompare(a.createdAt),
  );
  const groups = new Map<number, DiaryRow[]>();
  for (const entry of sorted) {
    const list = groups.get(entry.day);
    if (list) list.push(entry);
    else groups.set(entry.day, [entry]);
  }
  let html = "";
  for (const [day, list] of groups) {
    html += `<section class="day"><h3>Day ${day}</h3>`;
    for (const entry of list) {
      const hour = hourFromTick(entry.tick);
      const when = formatWhen(entry.createdAt);
      html += `<article class="entry${entry.readAt ? "" : " unread"}">
        <header>
          <span>${hour > 0 ? `Hour ${hour}` : "Note"}${when.time ? ` · ${esc(when.time)}` : ""}</span>
          ${entry.readAt ? "" : `<span class="new">New</span>`}
        </header>
        <p>${esc(entry.body)}</p>
      </article>`;
    }
    html += `</section>`;
  }
  return html;
}

function requestMarkup(requests: RequestRow[]): string {
  if (requests.length === 0) return `<p class="empty">No requests yet.</p>`;
  const sorted = [...requests].sort((a, b) => {
    const rank = (status: RequestRow["status"]) => (status === "pending" ? 0 : 1);
    const byStatus = rank(a.status) - rank(b.status);
    if (byStatus !== 0) return byStatus;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return sorted
    .map((request) => {
      const label =
        request.status === "approved" ? "Approved" : request.status === "denied" ? "Denied" : "Pending";
      const actions =
        request.status === "pending"
          ? `<div class="row-actions">
              <button type="button" data-decision="approved" data-id="${esc(request.id)}">Approve</button>
              <button type="button" class="ghost" data-decision="denied" data-id="${esc(request.id)}">Deny</button>
            </div>`
          : "";
      return `<article class="request ${request.status}">
        <header>
          <h3>${esc(request.title)}</h3>
          <span class="status">${label}</span>
        </header>
        <p>${esc(request.body)}</p>
        ${actions}
      </article>`;
    })
    .join("");
}

const DIGEST_LABELS: Array<[keyof DigestSections, string]> = [
  ["built", "Built"],
  ["learnt", "Learnt"],
  ["made", "Made"],
  ["wants", "Wants"],
];

function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function digestMarkup(digest: DigestRow): string {
  return DIGEST_LABELS.map(([key, label]) => {
    const items = digest.sections[key];
    const body =
      items.length === 0
        ? `<p class="empty">Nothing new.</p>`
        : `<ul>${items
            .map((item) => {
              const href = safeHref(item.url);
              const text = esc(item.text);
              return `<li>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text}</li>`;
            })
            .join("")}</ul>`;
    return `<details${items.length ? " open" : ""}><summary>${label}</summary>${body}</details>`;
  }).join("");
}

function feedMarkup(state: ClientState): string {
  const events = state.events.length > 120 ? state.events.slice(-120) : state.events;
  const skipped = state.events.length - events.length;
  if (events.length === 0) return `<p class="empty">The village is quiet.</p>`;
  let html = skipped > 0 ? `<p class="earlier">${skipped} earlier events are saved.</p>` : "";
  let day = 0;
  for (const event of events) {
    if (event.day !== day) {
      day = event.day;
      html += `<p class="feed-day">Day ${day}</p>`;
    }
    const hour = eventHour(event);
    const when = formatWhen(event.createdAt);
    html += `<article class="feed-item ${eventClass(event)}">
      <header>
        <span class="chip">${esc(eventLabel(event))}</span>
        ${hour > 0 ? `<span class="hour">Hour ${hour}</span>` : ""}
        <time datetime="${esc(event.createdAt)}" title="${esc(when.title)}">${esc(when.time)}</time>
      </header>
      <p>${esc(eventText(event))}</p>
    </article>`;
  }
  return html;
}

export type UI = {
  sync(state: ClientState): void;
  openDiary(): void;
  openMailbox(): void;
  openChat(): void;
  openCreation(id: string): void;
  openOverview(): void;
  openPip(): void;
};

type ChatLine = { id: string; role: "owner" | "pip"; text: string };

const CHAT_SESSION = "pips-chat-session";

function chatSession(): string {
  const existing = localStorage.getItem(CHAT_SESSION);
  if (existing && /^[A-Za-z0-9-]{8,80}$/.test(existing)) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(CHAT_SESSION, id);
  return id;
}

export function createUI(
  send: (message: ClientMessage) => boolean,
  onChat: (visual: { open: boolean; reply: string | null }) => void,
): UI {
  const clockText = must<HTMLElement>("clock-text");
  const browsing = must<HTMLElement>("browsing");
  const presence = must<HTMLElement>("presence");
  const diaryCount = must<HTMLElement>("diary-count");
  const mailCount = must<HTMLElement>("mail-count");
  const pause = must<HTMLButtonElement>("pause");
  const logout = must<HTMLButtonElement>("logout");
  const banner = must<HTMLElement>("banner");
  const feed = must<HTMLElement>("feed");
  const feedList = must<HTMLElement>("feed-list");
  const feedToggle = must<HTMLButtonElement>("feed-toggle");
  const scrim = must<HTMLElement>("scrim");
  const diary = must<HTMLElement>("diary");
  const diaryBody = must<HTMLElement>("diary-body");
  const diarySub = must<HTMLElement>("diary-sub");
  const mailbox = must<HTMLElement>("mailbox");
  const mailboxBody = must<HTMLElement>("mailbox-body");
  const mailSub = must<HTMLElement>("mail-sub");
  const toast = must<HTMLElement>("toast");
  const chat = must<HTMLElement>("chat");
  const chatLog = must<HTMLElement>("chat-log");
  const chatForm = must<HTMLFormElement>("chat-form");
  const chatInput = must<HTMLInputElement>("chat-input");
  const chatSend = must<HTMLButtonElement>("chat-send");
  const chatSub = must<HTMLElement>("chat-sub");
  const digest = must<HTMLElement>("digest");
  const digestDay = must<HTMLElement>("digest-day");
  const digestHeadline = must<HTMLElement>("digest-headline");
  const digestBody = must<HTMLElement>("digest-body");
  const digestPlace = must<HTMLElement>("digest-place");
  const digestOlder = must<HTMLButtonElement>("digest-older");
  const digestNewer = must<HTMLButtonElement>("digest-newer");
  const digestCount = must<HTMLElement>("digest-count");
  const openDigestButton = must<HTMLButtonElement>("open-digest");
  const openChatButton = must<HTMLButtonElement>("open-chat");
  const openDiaryButton = must<HTMLButtonElement>("open-diary");
  const openMailboxButton = must<HTMLButtonElement>("open-mailbox");
  const blueprints = must<HTMLElement>("blueprints");
  const blueprintsBody = must<HTMLElement>("blueprints-body");
  const blueprintsSub = must<HTMLElement>("blueprints-sub");
  const blueprintCount = must<HTMLElement>("blueprint-count");
  const openBlueprintsButton = must<HTMLButtonElement>("open-blueprints");
  const growth = must<HTMLElement>("growth");
  const growthBody = must<HTMLElement>("growth-body");
  const openGrowthButton = must<HTMLButtonElement>("open-growth");
  const creations = must<HTMLElement>("creations");
  const creationsBody = must<HTMLElement>("creations-body");
  const openCreationsButton = must<HTMLButtonElement>("open-creations");
  const overview = must<HTMLElement>("overview");
  const overviewBody = must<HTMLElement>("overview-body");
  const openOverviewButton = must<HTMLButtonElement>("open-overview");
  const settings = must<HTMLElement>("settings");
  const pipSheet = must<HTMLElement>("pip-sheet");
  const pipSheetSub = must<HTMLElement>("pip-sheet-sub");
  const tabbar = must<HTMLElement>("tabbar");
  const tabWorld = must<HTMLButtonElement>("tab-world");
  const statusPill = must<HTMLButtonElement>("status-pill");
  const openSettingsButton = must<HTMLButtonElement>("open-settings");
  const hudInbox = must<HTMLButtonElement>("hud-inbox");
  const hudBadge = must<HTMLElement>("hud-badge");
  const retry = must<HTMLButtonElement>("retry");
  const connectionError = must<HTMLElement>("connection-error");
  const settingsSearch = must<HTMLInputElement>("settings-search");
  const pauseSwitch = must<HTMLButtonElement>("pause-switch");
  const approvalSwitch = must<HTMLInputElement>("approval-switch");
  const publicSwitch = must<HTMLInputElement>("public-switch");
  const storageForm = must<HTMLFormElement>("storage-form");
  const maxForm = must<HTMLFormElement>("max-form");
  document.getElementById("growth-mount")?.append(growth);
  const openAlertsButton = must<HTMLButtonElement>("open-alerts");
  const seasonIcon = must<HTMLElement>("season-icon");
  const seasonLabel = must<HTMLElement>("season-label");
  const villageClock = must<HTMLElement>("village-clock");

  let sawConnection = false;
  let villageZone = "";
  let villageZoneName = "";

  function viewerZone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    } catch {
      return "";
    }
  }

  function formatInZone(date: Date, zone: string, withName = false): string {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      ...(withName ? { timeZoneName: "short" as const } : {}),
    }).format(date);
  }

  function paintVillageClock(): void {
    if (!villageZone) {
      villageClock.hidden = true;
      villageClock.textContent = "";
      villageClock.removeAttribute("title");
      return;
    }
    const now = new Date();
    try {
      const time = formatInZone(now, villageZone);
      villageClock.hidden = false;
      villageClock.textContent = villageZoneName ? `${time} ${villageZoneName}` : time;
      const mine = viewerZone();
      if (mine && mine !== villageZone) {
        villageClock.title = `Your time: ${formatInZone(now, mine, true)}`;
      } else {
        villageClock.removeAttribute("title");
      }
    } catch {
      villageClock.hidden = true;
    }
  }

  window.setInterval(paintVillageClock, 15_000);
  let toastTimer = 0;
  let feedOpen = true;
  let feedSig = "";
  let diarySig = "";
  let mailSig = "";
  let blueprintSig = "";
  let growthSig = "";
  let creationSig = "";
  let selectedCreation: string | null = null;
  const creationFilters: CreationFilters = { type: "", season: "", status: "", starred: false };
  let overviewSig = "";
  let overviewPlace = "";
  let overviewData: OverviewData | null = null;
  let overviewError = "";
  let overviewLoading = false;
  const overviewUi: OverviewUi = { tab: "now", page: 0, blueprint: "", detail: "" };

  let overviewApi: typeof import("./overviewPanel") | null = null;
  let overviewApiLoading = false;

  function renderOverview(): void {
    if (overview.hidden) return;
    if (!overviewApi) {
      if (!overviewBody.querySelector(".skeleton")) {
        overviewBody.innerHTML = `<div class="skeleton" aria-busy="true" aria-label="Loading the overview"><span></span><span></span><span></span></div>`;
      }
      if (!overviewApiLoading) {
        overviewApiLoading = true;
        void import("./overviewPanel").then((api) => {
          overviewApi = api;
          overviewSig = "";
          renderOverview();
        });
      }
      if (!overviewData && !overviewLoading && !overviewError) loadOverview();
      return;
    }
    const api = overviewApi;
    if (!overviewData && !overviewLoading && !overviewError) loadOverview();
    const state = getState();
    const key = `${overviewUi.tab}:${overviewUi.page}:${overviewUi.blueprint}:${overviewUi.detail}:${overviewError}:${state.day}:${state.pipAt}:${state.events.at(-1)?.id ?? ""}:${state.diary[0]?.id ?? ""}:${state.blueprints.length}:${state.objects.length}:${state.creations?.items.length ?? 0}:${overviewData ? "ready" : "wait"}`;
    if (key === overviewSig && overviewBody.childElementCount > 0) return;
    api.releaseOverviewPreviews();
    const place = `${overviewUi.tab}:${overviewUi.page}:${overviewUi.blueprint}`;
    const top = place === overviewPlace ? overviewBody.scrollTop : 0;
    overviewBody.innerHTML = api.overviewMarkup(state, overviewData, overviewUi, overviewError);
    api.bindOverview(overviewBody, state);
    overviewBody.scrollTop = top;
    overviewPlace = place;
    overviewSig = key;
  }

  function loadOverview(): void {
    if (overviewLoading) return;
    overviewLoading = true;
    overviewError = "";
    fetch("/api/overview")
      .then(async (response) => {
        if (!response.ok) throw new Error("Overview did not load.");
        overviewData = (await response.json()) as OverviewData;
      })
      .catch(() => {
        overviewError = "The overview could not be loaded.";
      })
      .finally(() => {
        overviewLoading = false;
        overviewSig = "";
        renderOverview();
      });
  }

  function renderCreations(): void {
    const library = getState().creations;
    const key = library
      ? `${library.usedBytes}:${library.budgetBytes}:${library.maxCreationBytes}:${library.publicEnabled}:${selectedCreation}:${creationFilters.type}:${creationFilters.season}:${creationFilters.status}:${creationFilters.starred}:${library.items.map((item) => item.id + item.status + item.updatedAt + item.favourite + item.archived).join(",")}`
      : "";
    if (key === creationSig && creationsBody.childElementCount > 0) return;
    const top = creationsBody.scrollTop;
    creationsBody.innerHTML = creationsMarkup(getState(), creationFilters, selectedCreation);
    creationsBody.scrollTop = top;
    creationSig = key;
  }
  let digestSig = "";
  let selectedDay = 0;
  let bootShown = false;
  const revealed = new Set<string>();

  function showToast(text: string): void {
    toast.hidden = false;
    toast.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 3200);
  }

  let chatLines: ChatLine[] = [];
  let chatOn = true;
  let sending = false;

  function latestReply(): string | null {
    for (let index = chatLines.length - 1; index >= 0; index -= 1) {
      const line = chatLines[index];
      if (line?.role === "pip") return line.text;
    }
    return null;
  }

  function showChatFace(): void {
    onChat({ open: !chat.hidden, reply: chat.hidden ? null : latestReply() });
  }

  function renderChat(): void {
    chatSub.textContent = chatOn ? "Talk with Pip" : "Chat is turned off";
    chatInput.disabled = !chatOn || sending;
    chatSend.disabled = !chatOn || sending;
    if (chatLines.length === 0) {
      chatLog.innerHTML = `<p class="empty">Pip is listening.</p>`;
    } else {
      chatLog.innerHTML = chatLines
        .map((line) => `<p class="bubble ${line.role}">${esc(line.text)}</p>`)
        .join("");
    }
    chatLog.scrollTop = chatLog.scrollHeight;
    showChatFace();
  }

  async function loadChat(): Promise<void> {
    try {
      const response = await fetch(`/api/chat?session=${encodeURIComponent(chatSession())}`);
      if (response.status === 401) {
        location.href = "/login";
        return;
      }
      if (!response.ok) return;
      const body = (await response.json()) as {
        sessionId?: string;
        enabled?: boolean;
        messages?: ChatLine[];
      };
      if (body.sessionId) localStorage.setItem(CHAT_SESSION, body.sessionId);
      chatOn = body.enabled !== false;
      chatLines = body.messages ?? [];
      renderChat();
    } catch {
      showToast("Chat history did not load.");
    }
  }

  const alerts = mountAlerts(showToast);
  const alertsRoot = document.getElementById("alerts");
  if (alertsRoot) document.getElementById("alerts-mount")?.append(alertsRoot);

  function refreshScrim(): void {
    scrim.hidden =
      diary.hidden &&
      mailbox.hidden &&
      chat.hidden &&
      digest.hidden &&
      blueprints.hidden &&
      growth.hidden &&
      creations.hidden &&
      overview.hidden &&
      settings.hidden &&
      pipSheet.hidden &&
      alerts.isOpen() === false;
  }

  type ScreenName = "world" | "overview" | "diary" | "creations" | "inbox";
  let screen: ScreenName = "world";

  function showTab(tab: ScreenName): void {
    screen = tab;
    document.body.dataset.tab = tab;
    sessionStorage.setItem("pips-tab", tab);
    overview.hidden = tab !== "overview";
    diary.hidden = tab !== "diary";
    creations.hidden = tab !== "creations";
    mailbox.hidden = tab !== "inbox";
    chat.hidden = true;
    blueprints.hidden = true;
    settings.hidden = true;
    pipSheet.hidden = true;
    if (!digest.hidden) hideDigest();
    for (const button of tabbar.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
      button.setAttribute("aria-current", button.dataset.tab === tab ? "page" : "false");
    }
    if (tab === "overview") {
      renderOverview();
      if (!overviewData) loadOverview();
    }
    refreshScrim();
    showChatFace();
  }

  function closePanels(): void {
    alerts.close();
    showTab("world");
  }

  function sortedDigests(state: ClientState): DigestRow[] {
    return [...state.digests].sort((a, b) => b.day - a.day);
  }

  function renderDigest(state: ClientState): void {
    const sorted = sortedDigests(state);
    if (sorted.length === 0) {
      digestDay.textContent = "Digest";
      digestDay.title = "";
      digestHeadline.textContent = "No day summarised yet.";
      digestPlace.textContent = "";
      digestOlder.disabled = true;
      digestNewer.disabled = true;
      if (digestSig !== "empty") {
        digestBody.innerHTML = `<p class="empty">A digest appears at the end of a day.</p>`;
        digestSig = "empty";
      }
      return;
    }
    if (!sorted.some((entry) => entry.day === selectedDay)) selectedDay = sorted[0]?.day ?? 0;
    const index = sorted.findIndex((entry) => entry.day === selectedDay);
    const current = sorted[index];
    if (!current) return;
    digestOlder.disabled = index >= sorted.length - 1;
    digestNewer.disabled = index <= 0;
    digestPlace.textContent = `${index + 1} of ${sorted.length}`;
    const when = formatWhen(current.createdAt);
    digestDay.textContent = when.time ? `Day ${current.day} · ${when.time}` : `Day ${current.day}`;
    digestDay.title = when.title;
    const sig = `${current.id}:${current.readAt ?? ""}:${current.headline}:${index}`;
    if (sig === digestSig) return;
    digestHeadline.textContent = current.headline;
    const top = digestBody.scrollTop;
    digestBody.innerHTML = digestMarkup(current);
    digestBody.scrollTop = top;
    digestSig = sig;
  }

  function markSelectedDigest(): void {
    const row = getState().digests.find((entry) => entry.day === selectedDay);
    if (!row || row.readAt) return;
    if (send({ type: "mark_digest_read", id: row.id })) {
      markDigestReadLocal(row.id, new Date().toISOString());
    }
  }

  function hideDigest(): void {
    if (digest.hidden) return;
    markSelectedDigest();
    digest.hidden = true;
  }

  function openDigest(day?: number): void {
    const sorted = sortedDigests(getState());
    const unread = sorted.find((entry) => !entry.readAt);
    const target = sorted.find((entry) => entry.day === day) ?? unread ?? sorted[0];
    if (!target) {
      digest.hidden = false;
      refreshScrim();
      renderDigest(getState());
      return;
    }
    if (!digest.hidden && target.day !== selectedDay) markSelectedDigest();
    selectedDay = target.day;
    digest.hidden = false;
    diary.hidden = true;
    mailbox.hidden = true;
    blueprints.hidden = true;
    growth.hidden = true;
    creations.hidden = true;
    overview.hidden = true;
    chat.hidden = true;
    alerts.close();
    refreshScrim();
    showChatFace();
    revealed.add(target.id);
    renderDigest(getState());
  }

  function considerDigest(state: ClientState): void {
    if (!state.connected) return;
    bootShown = true;
  }

  function renderFeed(state: ClientState): void {
    const distance = feedList.scrollHeight - feedList.scrollTop - feedList.clientHeight;
    const stick = distance < 48;
    const top = feedList.scrollTop;
    feedList.innerHTML = feedMarkup(state);
    feedList.scrollTop = stick ? feedList.scrollHeight : top;
  }

  const ui: UI = {
    sync(state) {
      if (!state.connected) {
        clockText.textContent = sawConnection ? "Pip is reconnecting…" : "Pip is connecting…";
      } else {
        sawConnection = true;
        const hour = hourFromTick(state.tick);
        const place = state.pipAt ? BUILDING_NAMES[state.pipAt] : "between places";
        const draft = state.creations?.items.find((item) => item.status === "draft" && !item.archived);
        clockText.textContent = state.paused
          ? "Pip is paused"
          : state.browsing
            ? `Pip is reading`
            : draft
              ? `Pip is making ${draft.title}`
              : `Pip is at the ${place}`;
        if (hour > 0) pipSheetSub.textContent = `Day ${state.day} · Hour ${hour}`;
      }
      connectionError.hidden = state.connected || !sawConnection;
      villageZone = state.connected ? (state.world?.zone ?? "") : "";
      villageZoneName = state.connected ? (state.world?.zoneName ?? "") : "";
      paintVillageClock();
      presence.classList.toggle("on", state.connected);
      browsing.hidden = !state.browsing;
      browsing.textContent = state.browsing ? `browsing: ${state.browsing}` : "";
      const unread = unreadDiaryCount(state);
      const pending = pendingRequestCount(state);
      const waiting = pendingBlueprintCount(state);
      const needing = inboxCount(state);
      setCount(diaryCount, unread);
      setCount(mailCount, needing);
      setCount(hudBadge, needing);
      setCount(digestCount, unreadDigestCount(state));
      setCount(blueprintCount, waiting);
      blueprintsSub.textContent = waiting > 0 ? `${waiting} waiting for approval` : "Versions of each object";
      diarySub.textContent =
        unread > 0 ? `${unread} unread · newest first` : "Newest first, grouped by day";
      mailSub.textContent = needing > 0 ? `${needing} need you` : "Nothing needs you";
      pause.textContent = state.paused ? "Resume" : "Pause";
      pause.setAttribute("aria-pressed", String(state.paused));
      pauseSwitch.textContent = state.paused ? "On" : "Off";
      pauseSwitch.setAttribute("aria-pressed", String(state.paused));
      approvalSwitch.checked = state.blueprintApproval;
      if (state.creations) {
        publicSwitch.checked = state.creations.publicEnabled;
        const budget = storageForm.elements.namedItem("megabytes");
        const max = maxForm.elements.namedItem("megabytes");
        if (budget instanceof HTMLInputElement && document.activeElement !== budget) {
          budget.value = String(Math.round(state.creations.budgetBytes / (1024 * 1024)));
        }
        if (max instanceof HTMLInputElement && document.activeElement !== max) {
          max.value = String(Math.round(state.creations.maxCreationBytes / (1024 * 1024)));
        }
      }
      if (state.world?.season) document.body.dataset.season = state.world.season;
      pause.disabled = !state.connected;
      banner.hidden = !state.paused;
      document.body.classList.toggle("is-paused", state.paused);
      const season = state.world?.season;
      if (season && isSeason(season)) {
        seasonIcon.textContent = SEASON_ICON[season];
        seasonLabel.textContent = seasonName(season);
      } else {
        seasonIcon.textContent = "";
        seasonLabel.textContent = "Season";
      }
      const lastEvent = state.events[state.events.length - 1];
      const nextFeed = `${state.events.length}:${lastEvent?.id ?? ""}`;
      if (nextFeed !== feedSig) {
        renderFeed(state);
        feedSig = nextFeed;
      }
      const nextDiary = state.diary.map((entry) => `${entry.id}:${entry.readAt ?? ""}`).join("|");
      if (nextDiary !== diarySig) {
        const diaryTop = diaryBody.scrollTop;
        diaryBody.innerHTML = diaryMarkup(state.diary);
        diaryBody.scrollTop = diaryTop;
        diarySig = nextDiary;
      }
      const nextMail = `${inboxCount(state)}:${state.requests.map((request) => `${request.id}:${request.status}`).join("|")}:${state.digests.map((item) => item.id + (item.readAt ?? "")).join("|")}`;
      if (nextMail !== mailSig) {
        const mailTop = mailboxBody.scrollTop;
        mailboxBody.innerHTML = inboxMarkup(state, state.connected);
        bindInboxSwipe(mailboxBody);
        mailboxBody.scrollTop = mailTop;
        mailSig = nextMail;
      }
      const nextBlueprints = `${state.blueprintApproval}:${state.blueprints
        .map((record) => `${record.name}:${record.version}:${record.status}`)
        .join("|")}`;
      if (nextBlueprints !== blueprintSig) {
        const top = blueprintsBody.scrollTop;
        blueprintsBody.innerHTML = blueprintMarkup(state);
        blueprintsBody.scrollTop = top;
        blueprintSig = nextBlueprints;
      }
      const growthKey = state.growth
        ? `${state.growth.pace}:${state.growth.callsUsed}:${state.growth.readCap}:${state.growth.awakeStart}:${state.growth.awakeEnd}:${state.growth.plans.map((plan) => plan.id + plan.ticksDone).join(",")}:${state.growth.notesCount}:${state.growth.topicsThisWeek.join(",")}`
        : "";
      if (growthKey !== growthSig) {
        const top = growthBody.scrollTop;
        growthBody.innerHTML = growthMarkup(state);
        growthBody.scrollTop = top;
        growthSig = growthKey;
      }
      renderCreations();
      renderOverview();
      renderDigest(state);
      considerDigest(state);
      if (!diary.hidden && state.diary.some((entry) => !entry.readAt)) {
        if (send({ type: "mark_diary_read" })) markDiaryRead(new Date().toISOString());
      }
    },
    openOverview() {
      showTab("overview");
      diary.hidden = true;
      mailbox.hidden = true;
      chat.hidden = true;
      blueprints.hidden = true;
      growth.hidden = true;
      creations.hidden = true;
      alerts.close();
      hideDigest();
      overview.hidden = false;
      refreshScrim();
      showChatFace();
      renderOverview();
      if (!overviewData) loadOverview();
      overview.querySelector<HTMLElement>(".close")?.focus();
    },
    openCreation(id: string) {
      showTab("creations");
      selectedCreation = id;
      creationSig = "";
      diary.hidden = true;
      mailbox.hidden = true;
      chat.hidden = true;
      blueprints.hidden = true;
      growth.hidden = true;
      creations.hidden = true;
    overview.hidden = true;
      creations.hidden = false;
      alerts.close();
      hideDigest();
      refreshScrim();
      showChatFace();
      renderCreations();
      creations.querySelector<HTMLElement>(".close")?.focus();
    },
    openDiary() {
      showTab("diary");
      mailbox.hidden = true;
      blueprints.hidden = true;
      growth.hidden = true;
    creations.hidden = true;
    overview.hidden = true;
      chat.hidden = true;
      alerts.close();
      hideDigest();
      diary.hidden = false;
      refreshScrim();
      showChatFace();
      ui.sync(getState());
      diary.querySelector<HTMLElement>(".close")?.focus();
    },
    openMailbox() {
      showTab("inbox");
      diary.hidden = true;
      blueprints.hidden = true;
      growth.hidden = true;
    creations.hidden = true;
    overview.hidden = true;
      chat.hidden = true;
      alerts.close();
      hideDigest();
      mailbox.hidden = false;
      refreshScrim();
      showChatFace();
      ui.sync(getState());
      mailbox.querySelector<HTMLElement>(".close")?.focus();
    },
    openPip() {
      pipSheetSub.textContent = clockText.textContent;
      chat.hidden = true;
      settings.hidden = true;
      digest.hidden = true;
      pipSheet.hidden = false;
      refreshScrim();
      pipSheet.querySelector<HTMLElement>(".close")?.focus();
    },
    openChat() {
      diary.hidden = true;
      mailbox.hidden = true;
      blueprints.hidden = true;
      growth.hidden = true;
    creations.hidden = true;
    overview.hidden = true;
      alerts.close();
      hideDigest();
      chat.hidden = false;
      refreshScrim();
      renderChat();
      chatInput.focus();
    },
  };

  openDigestButton.addEventListener("click", () => {
    if (!digest.hidden) {
      hideDigest();
      refreshScrim();
      return;
    }
    openDigest();
  });
  digestOlder.addEventListener("click", () => {
    const sorted = sortedDigests(getState());
    const index = sorted.findIndex((entry) => entry.day === selectedDay);
    const next = sorted[index + 1];
    if (!next) return;
    markSelectedDigest();
    selectedDay = next.day;
    revealed.add(next.id);
    renderDigest(getState());
  });
  digestNewer.addEventListener("click", () => {
    const sorted = sortedDigests(getState());
    const index = sorted.findIndex((entry) => entry.day === selectedDay);
    const next = sorted[index - 1];
    if (!next) return;
    markSelectedDigest();
    selectedDay = next.day;
    revealed.add(next.id);
    renderDigest(getState());
  });
  openChatButton.addEventListener("click", () => ui.openChat());
  openDiaryButton.addEventListener("click", () => ui.openDiary());
  openMailboxButton.addEventListener("click", () => ui.openMailbox());
  openBlueprintsButton.addEventListener("click", () => {
    if (!blueprints.hidden) {
      blueprints.hidden = true;
      refreshScrim();
      return;
    }
    diary.hidden = true;
    mailbox.hidden = true;
    chat.hidden = true;
    growth.hidden = true;
    creations.hidden = true;
    overview.hidden = true;
    alerts.close();
    hideDigest();
    blueprints.hidden = false;
    refreshScrim();
    showChatFace();
    ui.sync(getState());
    blueprints.querySelector<HTMLElement>(".close")?.focus();
  });
  openGrowthButton.addEventListener("click", () => {
    if (!growth.hidden) {
      growth.hidden = true;
    creations.hidden = true;
    overview.hidden = true;
      refreshScrim();
      return;
    }
    diary.hidden = true;
    mailbox.hidden = true;
    chat.hidden = true;
    blueprints.hidden = true;
    creations.hidden = true;
    overview.hidden = true;
    alerts.close();
    hideDigest();
    growth.hidden = false;
    refreshScrim();
    showChatFace();
    ui.sync(getState());
    growth.querySelector<HTMLElement>(".close")?.focus();
  });
  openOverviewButton.addEventListener("click", () => ui.openOverview());
  overviewBody.addEventListener("click", (event) => {
    const control = (event.target as HTMLElement).closest<HTMLElement>("[data-overview-tab], [data-overview-page], [data-blueprint], [data-making], [data-rollback], [data-open-creation]");
    if (!control) return;
    if (control.dataset.overviewTab === "now" || control.dataset.overviewTab === "mind" || control.dataset.overviewTab === "making" || control.dataset.overviewTab === "blueprints" || control.dataset.overviewTab === "stats") {
      overviewUi.tab = control.dataset.overviewTab as OverviewTab;
      overviewUi.page = 0;
      overviewUi.blueprint = "";
      overviewUi.detail = "";
      overviewSig = "";
      renderOverview();
      return;
    }
    if (control.dataset.overviewPage) {
      overviewUi.page = Number(control.dataset.overviewPage);
      overviewSig = "";
      renderOverview();
      return;
    }
    if (control.dataset.blueprint !== undefined && control.dataset.rollback === undefined) {
      overviewUi.blueprint = control.dataset.blueprint;
      overviewUi.page = 0;
      overviewSig = "";
      renderOverview();
      return;
    }
    if (control.dataset.making) {
      const key = control.dataset.making;
      if (key.startsWith("creation:")) {
        ui.openCreation(key.slice("creation:".length));
        return;
      }
      overviewUi.detail = overviewUi.detail === key ? "" : key;
      overviewSig = "";
      renderOverview();
      return;
    }
    if (control.dataset.rollback && control.dataset.version) {
      send({ type: "rollback_blueprint", name: control.dataset.rollback, version: Number(control.dataset.version) });
      showToast(`Rolling ${control.dataset.rollback} back to v${control.dataset.version}.`);
      return;
    }
    if (control.dataset.openCreation) ui.openCreation(control.dataset.openCreation);
  });
  openCreationsButton.addEventListener("click", () => {
    selectedCreation = null;
    creationSig = "";
    showTab("creations");
    renderCreations();
  });
  openAlertsButton.addEventListener("click", () => {
    if (alerts.isOpen()) {
      alerts.close();
      refreshScrim();
      return;
    }
    diary.hidden = true;
    mailbox.hidden = true;
    blueprints.hidden = true;
    growth.hidden = true;
    creations.hidden = true;
    overview.hidden = true;
    chat.hidden = true;
    hideDigest();
    alerts.open();
    refreshScrim();
  });
  pause.addEventListener("click", () => {
    const next = !getState().paused;
    if (!send({ type: "set_paused", paused: next })) showToast("Not connected.");
  });
  logout.addEventListener("click", () => {
    fetch("/logout", { method: "POST" }).finally(() => {
      location.href = "/login";
    });
  });
  feedToggle.addEventListener("click", () => {
    feedOpen = !feedOpen;
    feed.classList.toggle("collapsed", !feedOpen);
    feedToggle.textContent = feedOpen ? "Hide" : "Show";
    feedToggle.setAttribute("aria-expanded", String(feedOpen));
  });
  scrim.addEventListener("click", closePanels);
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.dataset.close === "diary" ||
      target.dataset.close === "mailbox" ||
      target.dataset.close === "chat" ||
      target.dataset.close === "digest" ||
      target.dataset.close === "alerts" ||
      target.dataset.close === "blueprints" ||
      target.dataset.close === "growth" ||
      target.dataset.close === "creations" ||
      target.dataset.close === "overview" ||
      target.dataset.close === "pip" ||
      target.dataset.close === "settings"
    ) {
      closePanels();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanels();
  });
  creationsBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const control = target.closest<HTMLElement>("[data-open-creation], [data-creation-back], [data-star], [data-archive], [data-publish], [data-unpublish]");
    if (!control) return;
    if (control.dataset.openCreation) {
      selectedCreation = control.dataset.openCreation;
      creationSig = "";
      renderCreations();
      return;
    }
    if (control.dataset.creationBack !== undefined) {
      selectedCreation = null;
      creationSig = "";
      renderCreations();
      return;
    }
    if (control.dataset.star) {
      const favourite = control.dataset.favourite !== "1";
      if (!send({ type: "star_creation", id: control.dataset.star, favourite })) showToast("Not connected.");
      return;
    }
    if (control.dataset.archive) {
      if (!send({ type: "archive_creation", id: control.dataset.archive })) showToast("Not connected.");
      return;
    }
    if (control.dataset.publish) {
      if (!send({ type: "publish_creation", id: control.dataset.publish })) showToast("Not connected.");
      return;
    }
    if (control.dataset.unpublish) {
      if (!send({ type: "unpublish_creation", id: control.dataset.unpublish })) showToast("Not connected.");
    }
  });
  creationsBody.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.public !== undefined) {
      if (!send({ type: "set_creations_public", enabled: target.checked })) showToast("Not connected.");
      return;
    }
    if (target instanceof HTMLSelectElement && target.dataset.filter) {
      if (target.dataset.filter === "type") creationFilters.type = target.value;
      if (target.dataset.filter === "season") creationFilters.season = target.value;
      if (target.dataset.filter === "status") creationFilters.status = target.value;
      creationSig = "";
      renderCreations();
      return;
    }
    if (target instanceof HTMLInputElement && target.dataset.filter === "starred") {
      creationFilters.starred = target.checked;
      creationSig = "";
      renderCreations();
    }
  });
  creationsBody.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.compare === undefined) return;
    const after = creationsBody.querySelector<HTMLElement>("[data-after]");
    if (after) after.style.clipPath = `inset(0 ${100 - Number(target.value)}% 0 0)`;
  });
  creationsBody.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const megabytes = Number(new FormData(form).get("megabytes"));
    const type = form.dataset.creations === "max" ? "set_creation_max" : "set_storage_budget";
    if (!send({ type, megabytes })) showToast("Not connected.");
  });
  growthBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    if (target.dataset.pace === "calm" || target.dataset.pace === "active" || target.dataset.pace === "fast") {
      if (!send({ type: "set_growth_pace", pace: target.dataset.pace })) showToast("Not connected.");
      return;
    }
    if (target.dataset.endStudy) {
      if (!send({ type: "end_study", id: target.dataset.endStudy })) showToast("Not connected.");
    }
  });
  growthBody.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.growth === "awake") {
      const start = Number(data.get("start"));
      const end = Number(data.get("end"));
      if (!send({ type: "set_awake_hours", start, end })) showToast("Not connected.");
      return;
    }
    if (form.dataset.growth === "reads") {
      const cap = Number(data.get("cap"));
      if (!send({ type: "set_read_cap", cap })) showToast("Not connected.");
    }
  });
  blueprintsBody.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.approval !== "required") return;
    if (!send({ type: "set_blueprint_approval", required: target.checked })) showToast("Not connected.");
  });
  blueprintsBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const version = Number(target.dataset.version);
    if (!Number.isInteger(version)) return;
    if (target.dataset.rollback) {
      if (!send({ type: "rollback_blueprint", name: target.dataset.rollback, version })) showToast("Not connected.");
      return;
    }
    if (target.dataset.approve) {
      if (!send({ type: "approve_blueprint", name: target.dataset.approve, version })) showToast("Not connected.");
    }
  });
  tabWorld.addEventListener("click", () => showTab("world"));
  statusPill.addEventListener("click", () => ui.openPip());
  hudInbox.addEventListener("click", () => ui.openMailbox());
  openSettingsButton.addEventListener("click", () => {
    chat.hidden = true;
    pipSheet.hidden = true;
    digest.hidden = true;
    settings.hidden = false;
    refreshScrim();
    settingsSearch.focus();
  });
  retry.addEventListener("click", () => connect());
  pauseSwitch.addEventListener("click", () => pause.click());
  settingsSearch.addEventListener("input", () => {
    const query = settingsSearch.value.trim().toLowerCase();
    for (const group of settings.querySelectorAll<HTMLElement>(".setting-group")) {
      const blob = `${group.dataset.keywords ?? ""} ${group.textContent ?? ""}`.toLowerCase();
      group.hidden = query.length > 0 && !blob.includes(query);
    }
  });
  approvalSwitch.addEventListener("change", () => {
    if (!send({ type: "set_blueprint_approval", required: approvalSwitch.checked })) showToast("Not connected.");
  });
  publicSwitch.addEventListener("change", () => {
    if (!send({ type: "set_creations_public", enabled: publicSwitch.checked })) showToast("Not connected.");
  });
  storageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const megabytes = Number(new FormData(storageForm).get("megabytes"));
    if (!send({ type: "set_storage_budget", megabytes })) showToast("Not connected.");
  });
  maxForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const megabytes = Number(new FormData(maxForm).get("megabytes"));
    if (!send({ type: "set_creation_max", megabytes })) showToast("Not connected.");
  });
  pipSheet.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.closest<HTMLElement>("[data-pip]")?.dataset.pip;
    if (action === "chat") ui.openChat();
    if (action === "diary") ui.openDiary();
    if (action === "inbox") ui.openMailbox();
  });
  mailboxBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const digestButton = target.closest<HTMLElement>("[data-open-digest]");
    if (digestButton?.dataset.openDigest) {
      openDigest(Number(digestButton.dataset.openDigest));
      return;
    }
    const settingsButton = target.closest<HTMLElement>("[data-open-settings]");
    if (settingsButton) {
      openSettingsButton.click();
      return;
    }
    const approve = target.closest<HTMLButtonElement>("[data-approve]");
    if (approve?.dataset.approve && approve.dataset.version) {
      if (!send({ type: "approve_blueprint", name: approve.dataset.approve, version: Number(approve.dataset.version) })) {
        showToast("Not connected.");
      }
    }
  });
  const pull = (element: HTMLElement, action: () => void) => {
    let startY = 0;
    let armed = false;
    element.addEventListener("pointerdown", (event) => {
      armed = element.scrollTop <= 0;
      startY = event.clientY;
    });
    element.addEventListener("pointerup", (event) => {
      if (!armed) return;
      armed = false;
      if (event.clientY - startY > 72) action();
    });
  };
  const refreshLive = () => {
    connect();
    overviewSig = "";
    loadOverview();
  };
  pull(diaryBody, refreshLive);
  pull(mailboxBody, refreshLive);
  pull(overviewBody, refreshLive);
  pull(creationsBody, refreshLive);
  mailboxBody.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("button[data-decision]");
    if (!(button instanceof HTMLButtonElement)) return;
    const requestId = button.dataset.id;
    const decision = button.dataset.decision;
    if (!requestId || (decision !== "approved" && decision !== "denied")) return;
    if (!send({ type: "decide_request", requestId, decision })) {
      showToast("Not connected.");
      return;
    }
    button.disabled = true;
  });
  chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text || sending || !chatOn) return;
    sending = true;
    renderChat();
    fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: chatSession(), text }),
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          ok?: boolean;
          sessionId?: string;
          messages?: ChatLine[];
          message?: string;
        };
        if (response.status === 401) {
          location.href = "/login";
          return;
        }
        if (body.sessionId) localStorage.setItem(CHAT_SESSION, body.sessionId);
        if (body.messages) chatLines = body.messages;
        if (!response.ok || body.ok === false) showToast(body.message || "Pip did not answer.");
        else chatInput.value = "";
      })
      .catch(() => showToast("Pip did not answer."))
      .finally(() => {
        sending = false;
        renderChat();
      });
  });
  void loadChat();
  const savedTab = sessionStorage.getItem("pips-tab");
  if (savedTab === "overview" || savedTab === "diary" || savedTab === "creations" || savedTab === "inbox") {
    showTab(savedTab);
  }
  window.addEventListener("pips-error", (event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (detail) showToast(detail);
    ui.sync(getState());
  });

  return ui;
}
