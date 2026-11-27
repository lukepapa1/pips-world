import { currentWorldState } from "./season.js";
import { callsToday, caps } from "./usage.js";
import {
  getSetting,
  listBlueprintNotes,
  listEvents,
  listIdentityVersions,
  overviewFacts,
} from "./db.js";
import { interestCards } from "./interests.js";
import { readMemory } from "./memory.js";

export type OverviewTab = "now" | "mind" | "making" | "blueprints" | "stats";

const TABS: OverviewTab[] = ["now", "mind", "making", "blueprints", "stats"];

export function isOverviewTab(value: unknown): value is OverviewTab {
  return typeof value === "string" && (TABS as string[]).includes(value);
}

export function publicOverviewEnabled(): boolean {
  const value = process.env.PUBLIC_OVERVIEW;
  return value === "1" || value === "true";
}

function spendPerMillion(): number {
  const raw = Number(process.env.USD_PER_MILLION_TOKENS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0.1;
}

function tokensToday(): number {
  const raw = getSetting("usage");
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { tokens?: unknown };
    return typeof parsed.tokens === "number" && parsed.tokens > 0 ? Math.floor(parsed.tokens) : 0;
  } catch {
    return 0;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function readingList(): { domain: string; topic: string; at: string }[] {
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows: { domain: string; topic: string; at: string }[] = [];
  for (const event of listEvents()) {
    if (event.kind !== "browse" || Date.parse(event.createdAt) < since) continue;
    const domain = hostOf(event.payload.url);
    const topic =
      event.payload.tool === "web_search"
        ? (event.payload.query ?? "").trim()
        : event.payload.url.replace(/^https?:\/\//, "").slice(0, 120);
    if (!domain && !topic) continue;
    rows.push({ domain, topic: topic || domain, at: event.createdAt });
  }
  return rows.slice(-30).reverse();
}

function projectCards(text: string): { title: string; body: string }[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/\n(?=#{1,3} )/)
    .slice(0, 12)
    .map((part) => {
      const lines = part.trim().split("\n");
      const title = (lines[0] ?? "Project").replace(/^#{1,3}\s+/, "").slice(0, 80);
      return { title, body: lines.slice(1).join("\n").trim().slice(0, 600) };
    });
}

function diaryNotes(): { name: string; version: number; body: string }[] {
  const events = listEvents();
  const out: { name: string; version: number; body: string }[] = [];
  for (const event of events) {
    if (event.kind !== "blueprint" || event.payload.action !== "design") continue;
    const diary = events.find((item) => item.kind === "diary" && item.tick === event.tick);
    if (!diary || diary.kind !== "diary") continue;
    out.push({ name: event.payload.name, version: event.payload.version, body: diary.payload.body.slice(0, 400) });
  }
  return out.slice(-40);
}

export function overviewPayload(revealPrivate: boolean) {
  const world = currentWorldState();
  const facts = overviewFacts();
  const limits = revealPrivate ? caps() : null;
  const tokens = revealPrivate ? tokensToday() : 0;
  const interestFile = readMemory("interests.md");
  const identityBody = readMemory("identity.md");
  const versions = listIdentityVersions()
    .slice(0, 12)
    .map((row) => ({
      version: row.version,
      createdAt: row.createdAt,
      excerpt: row.body.trim().slice(0, 280),
    }));
  return {
    publicOverview: publicOverviewEnabled(),
    now: {
      season: world.season,
      time: world.time,
      zoneName: world.zoneName,
      date: world.date,
      period: world.period,
    },
    mind: {
      interests: interestCards(interestFile),
      interestFile: interestFile.trim().slice(0, 4000),
      identity: {
        body: identityBody.trim().slice(0, 4000),
        versions:
          versions.length > 0
            ? versions
            : identityBody.trim()
              ? [{ version: 1, createdAt: "", excerpt: identityBody.trim().slice(0, 280) }]
              : [],
      },
      reading: readingList(),
    },
    making: {
      projects: projectCards(readMemory("projects.md")),
    },
    blueprints: {
      notes: listBlueprintNotes(),
      diaryNotes: diaryNotes(),
    },
    stats: {
      daysAlive: facts.daysAlive,
      ticks: facts.ticks,
      diary: facts.diary,
      builds: facts.builds,
      creations: facts.creations,
      pagesRead: facts.pagesRead,
      activity: facts.activity,
      private: revealPrivate
        ? {
            calls: callsToday(),
            callCap: limits?.calls ?? 0,
            tokensToday: tokens,
            spendUsd: Math.round((tokens / 1_000_000) * spendPerMillion() * 10_000) / 10_000,
          }
        : null,
    },
  };
}
