import { isPaused, lastTickAt, slotStatus } from "./db.js";
import { duplicatesRejected } from "./duplicates.js";
import { currentSlotId, startupLine } from "./growth.js";
import { sinceLastTick } from "./clock.js";
import { runtimeConfig } from "./runtimeConfig.js";
import { caps, usageSnapshot } from "./usage.js";

export function statusLines(): string[] {
  const config = runtimeConfig();
  const used = usageSnapshot();
  const limits = caps();
  const slot = currentSlotId();
  const slotState = slotStatus(slot);
  const alerts = (Object.entries(config.alerts) as Array<[string, boolean]>)
    .filter(([, on]) => on)
    .map(([name]) => name);
  const awakeEnd = config.awakeEnd === 24 ? "24:00" : `${pad(config.awakeEnd)}:00`;
  const allDay = config.awakeStart === 0 && config.awakeEnd === 24;
  return [
    isPaused()
      ? "Pip is paused. The emergency pause is on."
      : `Pip is running. ${sinceLastTick(lastTickAt())}`,
    startupLine(),
    allDay
      ? "Awake hours are 00:00 to 24:00, so ticks can run all day."
      : `Awake from ${pad(config.awakeStart)}:00 until ${awakeEnd}. Outside that window he sleeps.`,
    config.tickIntervalMinutes === 30
      ? "Ticks are scheduled on the village clock at :00 and :30. A missed slot is not caught up."
      : `Ticks are scheduled every ${config.tickIntervalMinutes} minutes on the village clock. A missed slot is not caught up.`,
    `This slot is ${slot}${slotState ? ` (${slotState})` : ""}.`,
    `Calls today ${used.calls} of ${limits.calls}. Page reads ${used.reads} of ${config.dailyReadCap}. Searches ${used.searches} of ${config.dailySearchCap}. Builds ${used.builds} of ${config.dailyBuildCap}. Ticks ${used.ticks} of ${limits.ticks}.`,
    `Duplicates rejected today: ${duplicatesRejected()}.`,
    config.blueprintApproval
      ? "A new blueprint waits for approval before it goes live."
      : "A new blueprint goes live when Pip publishes it.",
    config.creationsPublic
      ? "The public creations page is on."
      : "The public creations page is off.",
    `Storage budget ${mb(config.storageBudgetBytes)} MB. One creation can be up to ${mb(config.creationMaxBytes)} MB.`,
    alerts.length > 0 ? `Notifications on: ${alerts.join(", ")}.` : "Notifications are off.",
    `Tick model ${process.env.LLM_MODEL || "not set"}. Reflection model ${process.env.LLM_MODEL_REFLECT?.trim() || process.env.LLM_MODEL || "not set"}.`,
  ];
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}

function mb(bytes: number): string {
  return String(Math.round((bytes / (1024 * 1024)) * 10) / 10);
}
