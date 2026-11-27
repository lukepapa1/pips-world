export const GROWTH_PACES = ["calm", "active", "fast"] as const;

export type GrowthPace = (typeof GROWTH_PACES)[number];

export type GrowthSlot = {
  time: string;
  morning: boolean;
};

export type GrowthPlanView = {
  id: string;
  topic: string;
  why: string;
  plannedTicks: number;
  ticksDone: number;
  notes: string;
};

export type GrowthView = {
  pace: GrowthPace;
  awakeStart: number;
  awakeEnd: number;
  intervalMinutes: number;
  callsUsed: number;
  callCap: number;
  callShare: number;
  slotsToday: number;
  asleep: boolean;
  morning: boolean;
  readsUsed: number;
  readCap: number;
  searchesUsed: number;
  searchCap: number;
  notesCount: number;
  topicsThisWeek: string[];
  plans: GrowthPlanView[];
  slots: GrowthSlot[];
  reflectModel: string;
  tickModel: string;
};

export function isGrowthPace(value: unknown): value is GrowthPace {
  return value === "calm" || value === "active" || value === "fast";
}
