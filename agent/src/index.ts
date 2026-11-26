import path from "node:path";
import { startChatWatch, stopChatWatch } from "./chat.js";
import { closeDatabase, databasePath, openDatabase } from "./db.js";
import { demoMode, loadEnv, repoRoot } from "./env.js";
import { startScheduler, stopScheduler } from "./schedule.js";
import { startServer } from "./server.js";
import { startSeasonClock, stopSeasonClock } from "./season.js";
import { startSimulator, stopSimulator } from "./simulator.js";
import { initTickFromDb } from "./tickState.js";

loadEnv(path.join(repoRoot(), ".env"));
openDatabase();
initTickFromDb();
console.log(`Database ${databasePath()}`);

if (demoMode()) startSimulator();
else startScheduler();
startSeasonClock();
startChatWatch();
const server = startServer();

function shutdown(): void {
  stopChatWatch();
  stopSeasonClock();
  stopScheduler();
  stopSimulator();
  server.close();
  closeDatabase();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
