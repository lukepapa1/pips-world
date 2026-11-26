import cron from "node-cron";
import {
  dayBoundaryCron,
  digestCron,
  ownerDate,
  readClockConfig,
  weeklyCron,
} from "./clock.js";
import { setSetting } from "./db.js";
import { deliverDueDigest } from "./digest.js";
import { redactSecrets } from "./env.js";
import { runAgentTick } from "./loop.js";

let tasks: Array<{ stop: () => void | Promise<void>; destroy?: () => void | Promise<void> }> = [];
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

function track(expression: string, name: string, fn: () => void): void {
  if (!cron.validate(expression)) throw new Error(`Invalid ${name} schedule: ${expression}`);
  const zone = readClockConfig().zone;
  tasks.push(cron.schedule(expression, fn, { timezone: zone, name }));
}

export function startScheduler(): void {
  if (tasks.length > 0) stopScheduler();
  running = true;
  const config = readClockConfig();
  const expression = cronExpression();
  const model = process.env.LLM_MODEL ?? "(unset)";
  console.log(
    `Agent loop on. Model ${model}. Tick ${expression} in ${config.zone}. Day starts ${config.dayStartHour}:00. Digest ${config.digestHour}:00. Weekly reflection Sunday ${config.digestHour}:00.`,
  );
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY || !process.env.LLM_MODEL) {
    console.warn("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set before a tick can run.");
  }
  track(expression, "pip-tick", () => {
    if (!running) return;
    runAgentTick()
      .then((result) => {
        if (!result.ok) console.log(result.message);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Tick failed.";
        console.error(redactSecrets(`Tick failed: ${message}`));
      });
  });
  track(dayBoundaryCron(config.dayStartHour), "pip-day", () => {
    if (!running) return;
    console.log(`Day boundary. The day is ${ownerDate(new Date())}.`);
  });
  track(digestCron(config.digestHour), "pip-digest", () => {
    if (!running) return;
    deliverDueDigest().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Digest send failed.";
      console.error(redactSecrets(`Digest send failed: ${message}`));
    });
  });
  track(weeklyCron(config.digestHour), "pip-week", () => {
    if (!running) return;
    const at = new Date().toISOString();
    setSetting("last_weekly_reflection", at);
    console.log(`Weekly reflection window ${at}.`);
  });
}

export function stopScheduler(): void {
  running = false;
  for (const task of tasks) {
    void task.stop();
    void task.destroy?.();
  }
  tasks = [];
}
