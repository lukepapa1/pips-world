import fs from "node:fs";
import path from "node:path";
import { authRequired } from "./auth.js";
import { startChatWatch, stopChatWatch } from "./chat.js";
import { closeDatabase, databasePath, openDatabase } from "./db.js";
import { applyOwnerTimezone } from "./clock.js";
import { demoMode, ensureDataDirs, loadEnv, memoryDir, publishedDir, repoRoot, worldDistDir } from "./env.js";
import { noteNewProjects, startQuietWatch, stopQuietWatch } from "./alerts.js";
import { stopAcceptingTicks, waitForTickToFinish } from "./loop.js";
import { startScheduler, stopScheduler } from "./schedule.js";
import { startServer } from "./server.js";
import { startSeasonClock, stopSeasonClock } from "./season.js";
import { startSimulator, stopSimulator } from "./simulator.js";
import { initTickFromDb } from "./tickState.js";

loadEnv(path.join(repoRoot(), ".env"));
applyOwnerTimezone();

if (process.env.NODE_ENV === "production" && !authRequired()) {
  console.error("OWNER_PASSWORD is missing or shorter than 8 characters. Refusing to start.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && !fs.existsSync(path.join(worldDistDir(), "index.html"))) {
  console.error("The world build is missing. Run npm run build before npm start.");
  process.exit(1);
}

ensureDataDirs();
openDatabase();
initTickFromDb();
console.log(`Database ${databasePath()}`);
console.log(`Memory ${memoryDir()}`);
console.log(`Published ${publishedDir()}`);
if (authRequired()) console.log("Owner login is on.");
else console.log("OWNER_PASSWORD is not set. Login is off.");

if (demoMode()) startSimulator();
else startScheduler();
startSeasonClock();
startChatWatch();
void noteNewProjects();
startQuietWatch();
const server = startServer();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: finishing the current tick.`);
  stopAcceptingTicks();
  stopScheduler();
  stopSimulator();
  stopChatWatch();
  stopSeasonClock();
  stopQuietWatch();
  await waitForTickToFinish();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 10_000);
  });
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
