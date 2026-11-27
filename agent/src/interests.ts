import { ownerDate } from "./clock.js";
import { listInterestRecords, replaceInterests, type InterestRecord } from "./db.js";
import { writeMemory } from "./memory.js";

const DAY = 24 * 60 * 60 * 1000;

export function isHobby(row: Pick<InterestRecord, "strength" | "firstSeen" | "lastActive">, now = Date.now()): boolean {
  const start = Date.parse(row.firstSeen);
  const end = Date.parse(row.lastActive);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  if (end > now + DAY) return false;
  return row.strength >= 4 && end - start >= 7 * DAY;
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim().slice(0, 200)).slice(0, max);
}

function dayOf(value: unknown, fallback: string): string | null {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return value.slice(0, 10);
}

export function saveStructuredInterests(raw: unknown): string | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return "items must be a list of interests.";
    }
  }
  if (!Array.isArray(value)) return "items must be a list of interests.";
  if (value.length > 24) return "Keep the list to 24 interests.";
  const today = ownerDate(new Date());
  const rows: InterestRecord[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") return "Each interest needs a name.";
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name || name.length > 60) return "Each interest needs a name of 1 to 60 characters.";
    const key = name.toLowerCase();
    if (seen.has(key)) return `“${name}” is listed twice.`;
    seen.add(key);
    const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 240) : "";
    if (!summary) return `“${name}” needs a one-line summary.`;
    const strength = typeof record.strength === "number" ? record.strength : Number(record.strength);
    if (!Number.isInteger(strength) || strength < 1 || strength > 5) {
      return `Strength for “${name}” must be a whole number from 1 to 5.`;
    }
    const firstSeen = dayOf(record.first_seen, today);
    const lastActive = dayOf(record.last_active, today);
    if (!firstSeen || !lastActive) return `Dates for “${name}” need to be real dates.`;
    if (lastActive < firstSeen) return `“${name}” has a last active date before it was first seen.`;
    const evidence = record.evidence;
    const bag = evidence && typeof evidence === "object" ? (evidence as Record<string, unknown>) : {};
    rows.push({
      name,
      summary,
      strength,
      firstSeen,
      lastActive,
      diaryIds: asStringList(bag.diary ?? record.diary, 8),
      domains: asStringList(bag.domains ?? record.domains, 8),
      creationIds: asStringList(bag.creations ?? record.creations, 8),
    });
  }
  replaceInterests(rows);
  writeMemory("interests.md", renderInterestFile(rows));
  return null;
}

export function renderInterestFile(rows: InterestRecord[]): string {
  if (rows.length === 0) return "# Interests\n\n";
  const blocks = rows.map((row) =>
    [`## ${row.name}`, row.summary, "", `Strength ${row.strength} of 5. First seen ${row.firstSeen}. Last active ${row.lastActive}.`].join("\n"),
  );
  return `# Interests\n\n${blocks.join("\n\n")}\n`;
}

export function interestCards(fileText: string): {
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
}[] {
  const stored = listInterestRecords();
  if (stored.length > 0) {
    return stored.map((row) => ({ ...row, hobby: isHobby(row), fromFile: false }));
  }
  return cardsFromMarkdown(fileText);
}

function cardsFromMarkdown(text: string): {
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
}[] {
  const lines = text.split("\n");
  const cards: { name: string; summary: string }[] = [];
  let current: { name: string; summary: string } | null = null;
  for (const line of lines) {
    const heading = /^#{1,3}\s+(.+)/.exec(line.trim());
    if (heading?.[1] && heading[1].trim().toLowerCase() !== "interests") {
      if (current) cards.push(current);
      current = { name: heading[1].trim().slice(0, 60), summary: "" };
      continue;
    }
    if (!current) continue;
    const plain = line.trim();
    if (!plain || plain.startsWith("#")) continue;
    if (!current.summary) current.summary = plain.slice(0, 240);
  }
  if (current) cards.push(current);
  return cards.map((card) => ({
    name: card.name,
    summary: card.summary,
    strength: null,
    firstSeen: null,
    lastActive: null,
    hobby: false,
    diaryIds: [],
    domains: [],
    creationIds: [],
    fromFile: true,
  }));
}
