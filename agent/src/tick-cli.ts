import path from "node:path";
import { closeDatabase, openDatabase } from "./db.js";
import { loadEnv, repoRoot } from "./env.js";
import { runAgentTick } from "./loop.js";
import { initTickFromDb } from "./tickState.js";

loadEnv(path.join(repoRoot(), ".env"));

async function viaServer(): Promise<boolean> {
  const port = Number(process.env.PORT) || 3001;
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/tick`, { method: "POST" });
  } catch {
    return false;
  }
  const body = await response.text();
  if (response.status === 404) {
    console.error("The running server has no /api/tick yet. Restart npm run dev, then run npm run tick again.");
    process.exit(1);
  }
  console.log(body);
  process.exit(response.ok ? 0 : 1);
}

async function localTick(): Promise<void> {
  openDatabase();
  initTickFromDb();
  try {
    const result = await runAgentTick();
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  } finally {
    closeDatabase();
  }
}

viaServer()
  .then((handled) => {
    if (!handled) return localTick();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Tick failed.";
    console.error(message);
    process.exit(1);
  });
