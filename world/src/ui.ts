import {
  hourFromTick,
  isSeason,
  type ClientMessage,
  type DiaryRow,
  type DigestRow,
  type DigestSections,
  type RequestRow,
  type Season,
} from "@pips/shared";
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
  if (entries.length === 0) return `<p class="empty">The diary is blank.</p>`;
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

  function refreshScrim(): void {
    scrim.hidden = diary.hidden && mailbox.hidden && chat.hidden && digest.hidden && alerts.isOpen() === false;
  }

  function closePanels(): void {
    diary.hidden = true;
    mailbox.hidden = true;
    chat.hidden = true;
    alerts.close();
    hideDigest();
    refreshScrim();
    showChatFace();
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
    chat.hidden = true;
    alerts.close();
    refreshScrim();
    showChatFace();
    revealed.add(target.id);
    renderDigest(getState());
  }

  function considerDigest(state: ClientState): void {
    if (alerts.isOpen()) return;
    if (!state.connected || state.digests.length === 0) return;
    const sorted = sortedDigests(state);
    const unread = sorted.find((entry) => !entry.readAt);
    if (!bootShown) {
      bootShown = true;
      const target = unread ?? sorted[0];
      if (target) openDigest(target.day);
      return;
    }
    if (unread && !revealed.has(unread.id)) openDigest(unread.day);
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
        clockText.textContent = sawConnection ? "Reconnecting…" : "Connecting…";
      } else {
        sawConnection = true;
        const hour = hourFromTick(state.tick);
        clockText.textContent = hour > 0 ? `Day ${state.day} · Hour ${hour}` : `Day ${state.day}`;
      }
      villageZone = state.connected ? (state.world?.zone ?? "") : "";
      villageZoneName = state.connected ? (state.world?.zoneName ?? "") : "";
      paintVillageClock();
      presence.classList.toggle("on", state.connected);
      browsing.hidden = !state.browsing;
      browsing.textContent = state.browsing ? `browsing: ${state.browsing}` : "";
      const unread = unreadDiaryCount(state);
      const pending = pendingRequestCount(state);
      setCount(diaryCount, unread);
      setCount(mailCount, pending);
      setCount(digestCount, unreadDigestCount(state));
      diarySub.textContent =
        unread > 0 ? `${unread} unread · newest first` : "Newest first, grouped by day";
      mailSub.textContent = pending > 0 ? `${pending} waiting for an answer` : "Nothing waiting";
      pause.textContent = state.paused ? "Resume" : "Pause";
      pause.setAttribute("aria-pressed", String(state.paused));
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
      const nextMail = state.requests.map((request) => `${request.id}:${request.status}`).join("|");
      if (nextMail !== mailSig) {
        const mailTop = mailboxBody.scrollTop;
        mailboxBody.innerHTML = requestMarkup(state.requests);
        mailboxBody.scrollTop = mailTop;
        mailSig = nextMail;
      }
      renderDigest(state);
      considerDigest(state);
      if (!diary.hidden && state.diary.some((entry) => !entry.readAt)) {
        if (send({ type: "mark_diary_read" })) markDiaryRead(new Date().toISOString());
      }
    },
    openDiary() {
      mailbox.hidden = true;
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
      diary.hidden = true;
      chat.hidden = true;
      alerts.close();
      hideDigest();
      mailbox.hidden = false;
      refreshScrim();
      showChatFace();
      ui.sync(getState());
      mailbox.querySelector<HTMLElement>(".close")?.focus();
    },
    openChat() {
      diary.hidden = true;
      mailbox.hidden = true;
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
  openAlertsButton.addEventListener("click", () => {
    if (alerts.isOpen()) {
      alerts.close();
      refreshScrim();
      return;
    }
    diary.hidden = true;
    mailbox.hidden = true;
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
      target.dataset.close === "alerts"
    ) {
      closePanels();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanels();
  });
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
  window.addEventListener("pips-error", (event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (detail) showToast(detail);
    ui.sync(getState());
  });

  return ui;
}
