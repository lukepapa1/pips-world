import { maxTick } from "./db.js";

let tick = 0;

export function currentTick(): number {
  return tick;
}

export function initTickFromDb(): void {
  tick = maxTick();
}

export function advanceTick(): number {
  tick += 1;
  return tick;
}
