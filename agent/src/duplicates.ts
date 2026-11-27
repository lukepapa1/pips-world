import { ownerDate } from "./clock.js";
import { getSetting, setSetting } from "./db.js";

const KEY = "duplicates_rejected";
const THRESHOLD = 0.85;

export function similarity(a: string, b: string): number {
  const left = grams(a);
  const right = grams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  let leftCount = 0;
  let rightCount = 0;
  for (const count of left.values()) leftCount += count;
  for (const count of right.values()) rightCount += count;
  if (leftCount === 0 || rightCount === 0) return 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) ?? 0);
  return (2 * overlap) / (leftCount + rightCount);
}

export function nearDuplicate(a: string, b: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return similarity(left, right) >= THRESHOLD;
}

export function noteDuplicate(): void {
  const date = ownerDate(new Date());
  const current = readCount();
  const count = current.date === date ? current.count + 1 : 1;
  setSetting(KEY, JSON.stringify({ date, count }));
}

export function duplicatesRejected(instant = new Date()): number {
  const current = readCount();
  return current.date === ownerDate(instant) ? current.count : 0;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function grams(text: string): Map<string, number> {
  const normalized = normalize(text);
  const counts = new Map<string, number>();
  if (normalized.length < 3) {
    if (normalized) counts.set(normalized, 1);
    return counts;
  }
  for (let index = 0; index < normalized.length - 2; index += 1) {
    const gram = normalized.slice(index, index + 3);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function readCount(): { date: string; count: number } {
  const raw = getSetting(KEY);
  if (!raw) return { date: "", count: 0 };
  try {
    const parsed = JSON.parse(raw) as { date?: unknown; count?: unknown };
    const date = typeof parsed.date === "string" ? parsed.date : "";
    const count = typeof parsed.count === "number" && parsed.count > 0 ? Math.floor(parsed.count) : 0;
    return { date, count };
  } catch {
    return { date: "", count: 0 };
  }
}
