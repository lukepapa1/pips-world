import cron from "node-cron";
import {
  dayBoundaryCron,
  digestCron,
  ownerDate,
  readClockConfig,
  weeklyCron,
} from "./clock.js";
import { deliverDueDigest } from "./digest.js";
import { redactSecrets } from "./env.js";
import { claimSlot, finishSlot } from "./db.js";
import { currentDecision, currentSlotId, describeDecision, noteGrowthDay, paceCron, startupLine } from "./growth.js";
import { callsToday, caps } from "./usage.js";
import { runAgentTick, tickInProgress } from "./loop.js";
import { runEveningReflection, runWeeklyReflection } from "./reflect.js";

let tasks: Array<{ stop: () => void | Promise<void>; destroy?: () => void | Promise<void> }> = [];
let tickTask: { stop: () => void | Promise<void>; destroy?: () => void | Promise<void> } | null = null;
let running = false;

export function cronExpression(): string {
  return paceCron();
}

function track(expression: string, name: string, fn: () => void): void {
  if (!cron.validate(expression)) throw new Error(`Invalid ${name} schedule: ${expression}`);
  const zone = readClockConfig().zone;
  tasks.push(cron.schedule(expression, fn, { timezone: zone, name }));
}

function skipSlot(slot: string, reason: string): void {
  console.log(`Skipping slot ${slot}. ${reason} Not queued.`);
  if (claimSlot(slot) === "claimed") finishSlot(slot, "skipped");
}

export function runScheduledTick(): void {
  const slot = currentSlotId();
  if (tickInProgress()) {
    skipSlot(slot, "A tick is still running.");
    return;
  }
  const decision = currentDecision();
  const limits = caps();
  console.log(describeDecision(decision, callsToday(), limits.calls));
  if (decision.action !== "run") {
    noteGrowthDay(decision.action);
    skipSlot(slot, decision.action === "sleep" ? "Pip is asleep." : "The call share for this slot is used up.");
    return;
  }
  const claimed = claimSlot(slot);
  if (claimed !== "claimed") {
    console.log(`Skipping slot ${slot}. It already started (${claimed}). Not queued.`);
    return;
  }
  runAgentTick({ morning: decision.morning, callShare: decision.callShare })
    .then((result) => {
      noteGrowthDay("run");
      finishSlot(slot, "done");
      if (!result.ok) console.log(result.message);
    })
    .catch((error: unknown) => {
      finishSlot(slot, "done");
      const message = error instanceof Error ? error.message : "Tick failed.";
      console.error(redactSecrets(`Tick failed: ${message}`));
    });
}

export function rescheduleTick(): void {
  if (!running) return;
  void tickTask?.stop();
  void tickTask?.destroy?.();
  tickTask = null;
  const expression = cronExpression();
  const zone = readClockConfig().zone;
  if (!cron.validate(expression)) throw new Error(`Invalid tick schedule: ${expression}`);
  tickTask = cron.schedule(expression, () => {
    if (!running) return;
    runScheduledTick();
  }, { timezone: zone, name: "pip-tick" });
  console.log(startupLine());
}

export function startScheduler(): void {
  if (tasks.length > 0 || tickTask) stopScheduler();
  running = true;
  const config = readClockConfig();
  console.log(
    `Agent loop on. Tick ${cronExpression()} in ${config.zone}. Day starts ${config.dayStartHour}:00. Digest ${config.digestHour}:00. Weekly reflection Sunday ${config.digestHour}:00.`,
  );
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY || !process.env.LLM_MODEL) {
    console.warn("LLM_BASE_URL, LLM_API_KEY and LLM_MODEL must be set before a tick can run.");
  }
  rescheduleTick();
  track(dayBoundaryCron(config.dayStartHour), "pip-day", () => {
    if (!running) return;
    const decision = currentDecision();
    console.log(`Day boundary. The day is ${ownerDate(new Date())}. ${describeDecision(decision, callsToday(), caps().calls)}`);
  });
  track(digestCron(config.digestHour), "pip-digest", () => {
    if (!running) return;
    deliverDueDigest().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Digest send failed.";
      console.error(redactSecrets(`Digest send failed: ${message}`));
    });
    runEveningReflection().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Evening reflection failed.";
      console.error(redactSecrets(`Evening reflection failed: ${message}`));
    });
  });
  track(weeklyCron(config.digestHour), "pip-week", () => {
    if (!running) return;
    runWeeklyReflection().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Weekly reflection failed.";
      console.error(redactSecrets(`Weekly reflection failed: ${message}`));
    });
  });
}

export function stopScheduler(): void {
  running = false;
  void tickTask?.stop();
  void tickTask?.destroy?.();
  tickTask = null;
  for (const task of tasks) {
    void task.stop();
    void task.destroy?.();
  }
  tasks = [];
}
