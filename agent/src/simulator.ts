import { hourFromTick, type BuildingId, type WorldEvent } from "@pips/shared";
import {
  countPending,
  isPaused,
  lastMoveTarget,
  makeEvent,
  saveEvents,
} from "./db.js";
import {
  diaryBody,
  journalBody,
  newId,
  nextRequest,
  otherBuilding,
  shouldWriteJournal,
  shouldWriteRequest,
} from "./fixtures.js";
import { broadcast } from "./hub.js";
import { advanceTick, currentTick, initTickFromDb } from "./tickState.js";

let timer: NodeJS.Timeout | null = null;
let running = false;
let where: BuildingId | null = null;

export { currentTick } from "./tickState.js";

export function startSimulator(): void {
  initTickFromDb();
  where = lastMoveTarget();
  running = true;
  const tickMs = tickInterval();
  console.log(
    `Simulator on. Tick ${currentTick()}, every ${tickMs}ms. PAUSED=${isPaused() ? "1" : "0"}.`,
  );
  schedule(tickMs);
}

export function stopSimulator(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

function tickInterval(): number {
  const parsed = Number(process.env.TICK_MS);
  if (!Number.isFinite(parsed) || parsed < 1000) return 8000;
  return parsed;
}

function schedule(delay: number): void {
  timer = setTimeout(() => {
    if (!running) return;
    if (!isPaused()) {
      try {
        runTick();
      } catch (error) {
        console.error("Tick failed:", error);
      }
    }
    if (!running) return;
    schedule(isPaused() ? 500 : tickInterval());
  }, delay);
}

function runTick(): void {
  const next = advanceTick();
  const to = otherBuilding(where);
  const events: WorldEvent[] = [
    makeEvent<Extract<WorldEvent, { kind: "move" }>>(
      "move",
      { from: where, to },
      next,
    ),
  ];

  if (shouldWriteRequest(next) && countPending() < 4) {
    const request = nextRequest(next);
    const requestId = newId();
    events.push(
      makeEvent<Extract<WorldEvent, { kind: "request" }>>(
        "request",
        { requestId, title: request.title, body: request.body },
        next,
      ),
    );
  }

  const entryId = newId();
  events.push(
    makeEvent<Extract<WorldEvent, { kind: "diary" }>>(
      "diary",
      { entryId, body: diaryBody(to, next, hourFromTick(next)) },
      next,
    ),
  );

  if (shouldWriteJournal(next)) {
    events.push(
      makeEvent<Extract<WorldEvent, { kind: "journal" }>>(
        "journal",
        { entryId: newId(), body: journalBody(events[0].day) },
        next,
      ),
    );
  }

  saveEvents(events);
  where = to;
  for (const event of events) broadcast({ type: "event", event });
  const kinds = events.map((event) => event.kind).join(", ");
  console.log(`Tick ${next} (day ${events[0].day}): ${kinds}`);
}
