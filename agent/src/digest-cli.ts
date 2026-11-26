import path from "node:path";
import { closeDatabase, openDatabase } from "./db.js";
import { generateDailyDigest, resolveDigestDay } from "./digest.js";
import { loadEnv, repoRoot } from "./env.js";

loadEnv(path.join(repoRoot(), ".env"));

function requestedDay(): number | undefined {
  const raw = process.argv[2];
  if (!raw) return undefined;
  const day = Number(raw);
  if (!Number.isInteger(day) || day < 1) {
    console.error("Usage: npm run digest -- [day]");
    process.exit(1);
  }
  return day;
}

async function viaServer(day: number | undefined): Promise<boolean> {
  const port = Number(process.env.PORT) || 3001;
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/digest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(day ? { day } : {}),
    });
  } catch {
    return false;
  }
  const body = await response.text();
  if (response.status === 404) {
    console.error("The running server has no /api/digest yet. Restart npm run dev, then run npm run digest again.");
    process.exit(1);
  }
  console.log(body);
  process.exit(response.ok ? 0 : 1);
}

async function localDigest(day: number | undefined): Promise<void> {
  openDatabase();
  try {
    const resolved = resolveDigestDay(day);
    const result = await generateDailyDigest(resolved, true);
    if (!result) {
      console.log(JSON.stringify({ ok: false, message: `Day ${resolved} already has a digest.` }));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, day: resolved, ...result }));
  } finally {
    closeDatabase();
  }
}

viaServer(requestedDay())
  .then((handled) => {
    if (!handled) return localDigest(requestedDay());
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Digest failed.";
    console.error(message);
    process.exit(1);
  });
