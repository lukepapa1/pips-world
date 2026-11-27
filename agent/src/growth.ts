import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { GrowthPace, GrowthSlot, GrowthView } from "@pips/shared";
import { readClockConfig, type ClockConfig } from "./clock.js";
import { nearDuplicate, noteDuplicate } from "./duplicates.js";
import {
  activeStudyCount,
  browseQueriesSince,
  countNotes,
  getSetting,
  insertNote,
  insertStudy,
  listCreationRows,
  listRequests,
  listStudies,
  markNotesPrompted,
  noteTopicsSince,
  notesMatchingTopics,
  recentNotes,
  saveStudy,
  searchNoteRows,
  setSetting,
  staleNotes,
  studyTopicsSince,
  type NoteRow,
  type StudyRow,
} from "./db.js";
import { broadcast } from "./hub.js";
import { runtimeConfig, tickCron } from "./runtimeConfig.js";
import { callsToday, caps, readCap, searchCap } from "./usage.js";
import type { ToolOutcome } from "./tools.js";

export type TickDecision = {
  action: "sleep" | "skip" | "run";
  morning: boolean;
  callShare: number;
  slotsLeft: number;
  slotsToday: number;
  interval: number;
  awakeStart: number;
  awakeEnd: number;
};

const DAY_KEY = "growth_days";

export function tickInterval(): number {
  return runtimeConfig().tickIntervalMinutes;
}

export function paceCron(): string {
  return tickCron(tickInterval());
}

export function readAwake(): { start: number; end: number } {
  const config = runtimeConfig();
  return { start: config.awakeStart, end: config.awakeEnd };
}

export function slotsInDay(start: number, end: number, interval = tickInterval()): number {
  if (end <= start || interval <= 0) return 0;
  return ((end - start) * 60) / interval;
}

export function decideTick(
  hour: number,
  minute: number,
  interval: number,
  start: number,
  end: number,
  callsUsed: number,
  callCap: number,
): TickDecision {
  const slotsToday = slotsInDay(start, end, interval);
  const asleep = hour < start || hour >= end;
  const morning = hour === start && minute < interval;
  const base = {
    morning,
    interval,
    awakeStart: start,
    awakeEnd: end,
    slotsToday,
    callShare: 0,
    slotsLeft: 0,
  };
  if (asleep) return { ...base, action: "sleep" };
  const elapsed = (hour - start) * 60 + minute;
  const windowMinutes = (end - start) * 60;
  const slotsLeft = Math.max(1, Math.ceil((windowMinutes - elapsed) / interval));
  let callShare = Math.floor(Math.max(0, callCap - callsUsed) / slotsLeft);
  if (morning && callShare < 1 && callsUsed < callCap) callShare = 1;
  if (callShare < 1) return { ...base, action: "skip", slotsLeft, callShare: 0 };
  return { ...base, action: "run", slotsLeft, callShare };
}

export function daySlots(start: number, end: number, interval = tickInterval()): GrowthSlot[] {
  const slots: GrowthSlot[] = [];
  for (let minute = start * 60; minute < end * 60; minute += interval) {
    const hour = Math.floor(minute / 60);
    const rest = minute % 60;
    slots.push({
      time: `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`,
      morning: slots.length === 0,
    });
  }
  return slots;
}

export function clockSlot(hour: number, minute: number, interval = tickInterval()): boolean {
  return minute % interval === 0;
}

export function describeDecision(decision: TickDecision, callsUsed: number, callCap: number): string {
  const window = `${pad(decision.awakeStart)}:00–${decision.awakeEnd === 24 ? "24:00" : `${pad(decision.awakeEnd)}:00`}`;
  const pace = `every ${decision.interval} min, awake ${window}`;
  if (decision.action === "sleep") return `Schedule ${pace}. Pip is asleep. Calls ${callsUsed}/${callCap}.`;
  if (decision.action === "skip") {
    return `Schedule ${pace}. Skipping this tick so the day stays within ${callCap} model calls. Calls ${callsUsed}/${callCap}.`;
  }
  return `Schedule ${pace}. Calls ${callsUsed}/${callCap}. This tick may use ${decision.callShare}. Slots left ${decision.slotsLeft} of ${decision.slotsToday}.`;
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}

export function currentSlotId(instant = new Date()): string {
  const config = readClockConfig();
  const interval = tickInterval();
  let dt = DateTime.fromJSDate(instant, { zone: config.zone });
  const minute = Math.floor(dt.minute / interval) * interval;
  dt = dt.set({ minute, second: 0, millisecond: 0 });
  return `${dt.toFormat("yyyy-MM-dd")} ${dt.toFormat("HH:mm")}`;
}

export function currentDecision(instant = new Date()): TickDecision {
  const config = readClockConfig();
  const dt = DateTime.fromJSDate(instant, { zone: config.zone });
  const awake = readAwake();
  const limits = caps();
  return decideTick(dt.hour, dt.minute, tickInterval(), awake.start, awake.end, callsToday(), limits.calls);
}

export function setPace(_pace: GrowthPace): void {
  publishGrowth();
}

export function setAwakeHours(_start: number, _end: number): string | null {
  return "Awake hours are read from the environment at startup.";
}

export function setReadCap(_cap: number): string | null {
  return "The page-read cap is read from the environment at startup.";
}

type DayLog = {
  date: string;
  pace: GrowthPace;
  calls: number;
  cap: number;
  ticks: number;
  skipped: number;
};

export function noteGrowthDay(action: TickDecision["action"], instant = new Date()): void {
  const config = readClockConfig();
  const date = ownerDateOnly(instant, config);
  const limits = caps();
  const logs = readLogs();
  const current = logs.find((row) => row.date === date) ?? {
    date,
    pace: "active",
    calls: 0,
    cap: limits.calls,
    ticks: 0,
    skipped: 0,
  };
  current.pace = "active";
  current.calls = callsToday();
  current.cap = limits.calls;
  if (action === "run") current.ticks += 1;
  if (action === "skip") current.skipped += 1;
  const next = [current, ...logs.filter((row) => row.date !== date)].slice(0, 14);
  setSetting(DAY_KEY, JSON.stringify(next));
}

function readLogs(): DayLog[] {
  const raw = getSetting(DAY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DayLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ownerDateOnly(instant: Date, config: ClockConfig): string {
  let dt = DateTime.fromJSDate(instant, { zone: config.zone });
  if (dt.hour < config.dayStartHour) dt = dt.minus({ days: 1 });
  return dt.toISODate() ?? "";
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

export function startStudy(topic: unknown, why: unknown, planned: unknown): ToolOutcome {
  const name = clean(topic, 80);
  const reason = clean(why, 400);
  if (!name) return { result: "A study needs a topic you choose.", kind: null };
  if (!reason) return { result: "Say why this topic is worth your time.", kind: null };
  if (typeof planned !== "number" || !Number.isInteger(planned) || planned < 1 || planned > 12) {
    return { result: "planned_ticks must be a whole number from 1 to 12.", kind: null };
  }
  if (activeStudyCount() >= 2) return { result: "Two studies are already open. End one before starting another.", kind: null };
  const same = listStudies().find((study) => nearDuplicate(study.topic, name));
  if (same) {
    noteDuplicate();
    return {
      result: `Study ${same.id} already covers ${same.topic} (${same.status}). Continue it or end it instead of starting another.`,
      kind: null,
    };
  }
  const now = new Date().toISOString();
  const row: StudyRow = {
    id: randomUUID().slice(0, 8),
    topic: name,
    why: reason,
    plannedTicks: planned,
    ticksDone: 0,
    notes: "",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  insertStudy(row);
  publishGrowth();
  return { result: `Study ${row.id} is open: ${row.topic}. ${activeStudyCount()} of 2 studies are active.`, kind: null };
}

export function continueStudy(id: unknown, notes: unknown): ToolOutcome {
  const row = findActive(id);
  if (typeof row === "string") return { result: row, kind: null };
  const text = clean(notes, 2000);
  if (!text) return { result: "notes are empty.", kind: null };
  const stamp = new Date().toISOString();
  row.notes = row.notes ? `${row.notes}\n${stamp} ${text}` : `${stamp} ${text}`;
  row.ticksDone += 1;
  row.updatedAt = stamp;
  saveStudy(row);
  publishGrowth();
  const left = Math.max(0, row.plannedTicks - row.ticksDone);
  return {
    result: `Study ${row.id} updated. ${row.ticksDone} ticks noted, ${left} of the plan still unused. End it when you are finished.`,
    kind: null,
  };
}

export function endStudy(id: unknown, summary: unknown): ToolOutcome {
  const row = findActive(id);
  if (typeof row === "string") return { result: row, kind: null };
  const text = clean(summary, 2000);
  if (!text) return { result: "A summary is needed to end a study.", kind: null };
  const stamp = new Date().toISOString();
  row.notes = row.notes ? `${row.notes}\nEnded ${stamp}: ${text}` : text;
  row.status = "done";
  row.updatedAt = stamp;
  saveStudy(row);
  publishGrowth();
  return { result: `Study ${row.id} is closed.`, kind: null };
}

function findActive(id: unknown): StudyRow | string {
  if (typeof id !== "string" || !id.trim()) return "Pass the study id.";
  const row = listStudies().find((study) => study.id === id.trim());
  if (!row) return "No study with that id.";
  if (row.status !== "active") return "That study is already closed.";
  return row;
}

export function saveNote(topic: unknown, text: unknown, sources: unknown): ToolOutcome {
  const name = clean(topic, 80);
  const body = clean(text, 2000);
  if (!name) return { result: "A note needs a topic.", kind: null };
  if (!body) return { result: "A note needs text.", kind: null };
  const same = recentNotes(40).find((note) => nearDuplicate(note.topic, name) || nearDuplicate(note.body, body));
  if (same) {
    noteDuplicate();
    return {
      result: `Note ${same.id} already says this under ${same.topic}: ${clip(same.body, 400)}. Extend that note instead of saving another.`,
      kind: null,
    };
  }
  const sourceText = sourcesText(sources);
  const now = new Date().toISOString();
  insertNote({
    id: randomUUID().slice(0, 8),
    topic: name,
    body,
    sources: sourceText,
    createdAt: now,
    touchedAt: now,
    promptedAt: null,
  });
  publishGrowth();
  return { result: `Note saved under ${name}.`, kind: null };
}

export function searchNotes(topic: unknown): ToolOutcome {
  const name = clean(topic, 80);
  if (!name) return { result: "Say which topic to search.", kind: null };
  const rows = searchNoteRows(name);
  if (rows.length === 0) return { result: `No notes match ${name}.`, kind: null };
  const lines = rows.map((row) => `- ${row.topic}: ${clip(row.body, 400)}${row.sources ? ` Sources: ${row.sources}` : ""}`);
  return { result: lines.join("\n"), kind: null };
}

function sourcesText(sources: unknown): string {
  if (Array.isArray(sources)) {
    return sources
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(", ")
      .slice(0, 500);
  }
  if (typeof sources === "string") return sources.trim().slice(0, 500);
  return "";
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function growthContext(morning: boolean): string {
  const studies = listStudies().filter((study) => study.status === "active");
  const lines: string[] = [];
  const decision = currentDecision();
  lines.push(
    `Model calls used today: ${callsToday()} of ${caps().calls}. A tick that would pass the day's cap is skipped.`,
  );
  lines.push(`A study tick is about ${tickInterval()} minutes.`);
  const waiting = waitingLines();
  if (waiting.length > 0) {
    lines.push("Unfinished or waiting:");
    lines.push(...waiting);
  }
  if (studies.length === 0) {
    lines.push("No study is open.");
  } else {
    lines.push("Open studies. Suggested next step: continue from what you already learned, or end the study. The next step is yours.");
    for (const study of studies) {
      const learned = study.notes ? clip(study.notes, 800) : "Nothing written down yet.";
      lines.push(
        `- ${study.id}: ${study.topic}. Why: ${study.why}. Learned so far: ${learned} Ticks noted ${study.ticksDone} of ${study.plannedTicks}.`,
      );
    }
    const related = notesMatchingTopics(studies.map((study) => study.topic));
    if (related.length > 0) {
      lines.push("Notes related to those studies:");
      for (const note of related) lines.push(noteLine(note));
    }
  }
  const revisit = takeRevisits();
  if (revisit.length > 0) {
    lines.push("These notes have been quiet for 7 days. Revisit or extend one if you still care. Leaving them is fine.");
    for (const note of revisit) lines.push(noteLine(note));
  }
  const recent = recentTopics();
  if (recent.length > 0) {
    lines.push(`Topics from the last 24 hours: ${recent.join("; ")}.`);
    lines.push("Go deeper on one of these, or try something you have not touched. Do not repeat a skim of the same topic.");
  }
  return lines.join("\n");
}

function waitingLines(): string[] {
  const lines: string[] = [];
  for (const study of listStudies().filter((row) => row.status === "active")) {
    lines.push(`- Study ${study.id}: ${study.topic}. ${study.ticksDone} of ${study.plannedTicks} ticks noted.`);
  }
  for (const creation of listCreationRows().filter((row) => row.status === "draft" && !row.archived)) {
    lines.push(`- Draft creation ${creation.id}: ${creation.title}.`);
  }
  for (const request of listRequests()) {
    if (request.status === "pending") lines.push(`- Wish waiting: ${request.title}.`);
    if (request.status === "approved" && /^(expansion|mechanic):/i.test(request.title)) {
      lines.push(`- Approved and waiting: ${request.title}.`);
    }
  }
  return lines;
}

function noteLine(note: NoteRow): string {
  const sources = note.sources ? ` Sources: ${note.sources}` : "";
  return `- ${note.topic}: ${clip(note.body, 400)}${sources}`;
}

function takeRevisits(): NoteRow[] {
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = staleNotes(week, week);
  if (rows.length > 0) markNotesPrompted(rows.map((row) => row.id), new Date().toISOString());
  return rows;
}

function recentTopics(): string[] {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const values = [...browseQueriesSince(since), ...noteTopicsSince(since), ...studyTopicsSince(since)];
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(value);
    if (topics.length >= 12) break;
  }
  return topics;
}

export function weekTopics(): string[] {
  const config = readClockConfig();
  const start = DateTime.now()
    .setZone(config.zone)
    .minus({ days: 6 })
    .set({ hour: config.dayStartHour, minute: 0, second: 0, millisecond: 0 });
  return recentWindow(start.toUTC().toISO() ?? new Date(0).toISOString());
}

function recentWindow(since: string): string[] {
  const values = [...browseQueriesSince(since), ...noteTopicsSince(since), ...studyTopicsSince(since)];
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(value);
  }
  return topics.slice(0, 20);
}

export function growthView(instant = new Date()): GrowthView {
  const awake = readAwake();
  const interval = tickInterval();
  const decision = currentDecision(instant);
  const limits = caps();
  const plans = listStudies()
    .filter((study) => study.status === "active")
    .map((study) => ({
      id: study.id,
      topic: study.topic,
      why: study.why,
      plannedTicks: study.plannedTicks,
      ticksDone: study.ticksDone,
      notes: clip(study.notes, 240),
    }));
  return {
    pace: interval === 60 ? "calm" : interval <= 15 ? "fast" : "active",
    awakeStart: awake.start,
    awakeEnd: awake.end,
    intervalMinutes: interval,
    callsUsed: callsToday(),
    callCap: limits.calls,
    callShare: decision.callShare,
    slotsToday: decision.slotsToday,
    asleep: decision.action === "sleep",
    morning: decision.morning && decision.action === "run",
    readsUsed: readsUsed(),
    readCap: readCap(),
    searchesUsed: searchesUsed(),
    searchCap: searchCap(),
    notesCount: countNotes(),
    topicsThisWeek: weekTopics(),
    plans,
    slots: daySlots(awake.start, awake.end, interval),
    reflectModel: process.env.LLM_MODEL_REFLECT?.trim() || process.env.LLM_MODEL || "",
    tickModel: process.env.LLM_MODEL ?? "",
  };
}

function readsUsed(): number {
  return usageCount("reads");
}

function searchesUsed(): number {
  return usageCount("searches");
}

function usageCount(key: "reads" | "searches"): number {
  const raw = getSetting("usage");
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { date?: string; reads?: number; searches?: number };
    const config = readClockConfig();
    const today = ownerDateOnly(new Date(), config);
    if (parsed.date !== today) return 0;
    const value = parsed[key];
    return typeof value === "number" && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

export function publishGrowth(): void {
  broadcast({ type: "growth", growth: growthView() });
}

export function startupLine(): string {
  const view = growthView();
  return `Ticks every ${view.intervalMinutes} min at the clock. Awake ${pad(view.awakeStart)}:00–${view.awakeEnd === 24 ? "24:00" : `${pad(view.awakeEnd)}:00`}, ${view.slotsToday} slots. Calls ${view.callsUsed}/${view.callCap}. Page reads ${view.readCap} a day. Searches ${view.searchCap} a day. Tick model ${view.tickModel}. Reflect model ${view.reflectModel}.`;
}
