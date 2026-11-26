import fs from "node:fs";
import path from "node:path";
import { getSetting, lastTickAt, setSetting } from "./db.js";
import { publishedDir } from "./env.js";
import { digestLink, notifyOwner } from "./notify.js";

const SEEN = "published_seen";
const QUIET_MS = 3 * 60 * 60 * 1000;

type PublishedProject = { id: string; title: string };

function publishedProjects(): PublishedProject[] {
  const root = publishedDir();
  if (!fs.existsSync(root)) return [];
  const found: PublishedProject[] = [];
  for (const name of fs.readdirSync(root)) {
    if (name.startsWith(".")) continue;
    const full = path.join(root, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (!fs.existsSync(path.join(full, "index.html"))) continue;
    const title = name.replace(/[-_]+/g, " ").trim() || name;
    found.push({ id: name, title });
  }
  found.sort((a, b) => a.id.localeCompare(b.id));
  return found;
}

function seenIds(): Set<string> | null {
  const raw = getSetting(SEEN);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) return null;
    return new Set(parsed);
  } catch {
    return null;
  }
}

export async function noteNewProjects(): Promise<void> {
  const current = publishedProjects();
  const seen = seenIds();
  if (!seen) {
    setSetting(SEEN, JSON.stringify(current.map((project) => project.id)));
    return;
  }
  for (const project of current) {
    if (seen.has(project.id)) continue;
    await notifyOwner("project", {
      title: "Pip finished a project",
      body: project.title,
      url: digestLink(),
    });
  }
  setSetting(SEEN, JSON.stringify(current.map((project) => project.id)));
}

let quietTimer: NodeJS.Timeout | null = null;

function checkQuiet(): void {
  const at = lastTickAt();
  if (!at) return;
  const then = Date.parse(at);
  if (!Number.isFinite(then) || Date.now() - then < QUIET_MS) return;
  if (getSetting("quiet_notified_for") === at) return;
  setSetting("quiet_notified_for", at);
  void notifyOwner("quiet", {
    title: "Pip's server went quiet",
    body: "No tick for 3 hours.",
    url: digestLink(),
  });
}

export function startQuietWatch(): void {
  checkQuiet();
  quietTimer = setInterval(checkQuiet, 5 * 60 * 1000);
  quietTimer.unref();
}

export function stopQuietWatch(): void {
  if (quietTimer) clearInterval(quietTimer);
  quietTimer = null;
}
