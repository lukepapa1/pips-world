import cron from "node-cron";
import { runAgentTick } from "./loop.js";

let task: { stop: () => void } | null = null;
let running = false;

export function cronExpression(): string {
  const raw = process.env.TICK_INTERVAL_MINUTES;
  if (raw === undefined || raw.trim() === "") return "0 * * * *";
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0 * * * *";
  const minutes = Math.floor(parsed);
  if (minutes >= 60) {
    const hours = Math.max(1, Math.round(minutes / 60));
    return hours === 1 ? "0 * * * *" : `0 */${hours} * * *`;
  }
  return minutes === 1 ? "* * * * *" : `*/${minutes} * * * *`;
}

export function startScheduler(): void {
  const expression = cronExpression();
  if (!cron.validate(expression)) {
    throw new Error(`Invalid tick schedule: ${expression}`);
  }
  const model = process.env.LLM_MODEL ?? "(unset)";
  console.log(`Agent loop on. Model ${model}. Schedule: ${expression}.`);
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY || !process.env.LLM_MODEL) {
    console.warn("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set before a tick can run.");
  }
  running = true;
  task = cron.schedule(expression, () => {
    if (!running) return;
    runAgentTick()
      .then((result) => {
        if (!result.ok) console.log(result.message);
      })
      .catch((error: unknown) => {
        console.error("Tick failed:", error);
      });
  });
}

export function stopScheduler(): void {
  running = false;
  task?.stop();
  task = null;
}
