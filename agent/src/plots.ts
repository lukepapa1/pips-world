import { randomUUID } from "node:crypto";
import {
  approachPoint,
  exploreTitle,
  footprintInside,
  isStartingPlot,
  parsePlotArg,
  type PlotRecord,
  type WorldEvent,
} from "@pips/shared";
import {
  listPlots,
  listRequests,
  makeEvent,
  openFrontier,
  saveEvents,
  savePlot,
} from "./db.js";
import { broadcast } from "./hub.js";
import { runtimeConfig } from "./runtimeConfig.js";
import type { ToolOutcome } from "./tools.js";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function publish(event: WorldEvent): void {
  saveEvents([event]);
  broadcast({ type: "event", event });
}

function broadcastPlots(): void {
  broadcast({ type: "plots", plots: listPlots() });
}

function plotEvent(
  action: "unlocked" | "explored",
  plot: PlotRecord,
  point: { x: number; z: number },
  tick: number,
): WorldEvent {
  return makeEvent<Extract<WorldEvent, { kind: "plot" }>>(
    "plot",
    {
      action,
      plotId: plot.id,
      gridX: plot.gridX,
      gridZ: plot.gridZ,
      terrain: plot.type,
      name: plot.name,
      x: Math.round(point.x * 100) / 100,
      z: Math.round(point.z * 100) / 100,
    },
    tick,
  );
}

function unlockedPlots(): PlotRecord[] {
  return listPlots().filter((plot) => plot.status === "unlocked");
}

function expansionsThisWeek(): number {
  const since = Date.now() - WEEK_MS;
  return unlockedPlots().filter((plot) => {
    if (isStartingPlot(plot.gridX, plot.gridZ)) return false;
    if (!plot.unlockedAt) return false;
    return Date.parse(plot.unlockedAt) >= since;
  }).length;
}

function plotForRequest(requestId: string): PlotRecord | null {
  return listPlots().find((plot) => plot.notes === `request:${requestId}`) ?? null;
}

function sharesASide(plot: PlotRecord): boolean {
  return unlockedPlots().some(
    (open) =>
      Math.abs(open.gridX - plot.gridX) + Math.abs(open.gridZ - plot.gridZ) === 1,
  );
}

export function canBuildAt(x: number, z: number, radius: number): boolean {
  return unlockedPlots().some((plot) => footprintInside(plot.gridX, plot.gridZ, x, z, radius));
}

export function plotBrief(): string {
  const plots = listPlots();
  const open = plots.filter((plot) => plot.status === "unlocked");
  const edges = plots
    .filter((plot) => plot.status === "mist" || plot.status === "proposed")
    .sort((a, b) => a.gridX - b.gridX || a.gridZ - b.gridZ);
  const opened = open.filter((plot) => !isStartingPlot(plot.gridX, plot.gridZ));
  const cap = runtimeConfig().expansionPerWeek;
  const room = runtimeConfig().maxPlots;
  const lines = [
    `Open land: ${open.map((plot) => `${plot.name} (${plot.type}, grid ${plot.gridX},${plot.gridZ})`).join("; ") || "none"}.`,
  ];
  if (opened.length > 0) {
    lines.push(
      `Land opened beyond the village: ${opened.map((plot) => `${plot.name} (${plot.type})`).join("; ")}.`,
    );
  }
  lines.push(
    edges.length > 0
      ? `Edges still in mist: ${edges.map((plot) => `${plot.name} (${plot.type}, grid ${plot.gridX},${plot.gridZ}${plot.status === "proposed" ? ", asked" : ""})`).join("; ")}.`
      : "No mist edges are waiting.",
  );
  lines.push(
    `propose_expansion takes one of those grids and a reason. At most ${cap} can be approved in a week. The world holds ${room} open plots.`,
  );
  return lines.join("\n");
}

export function proposeExpansion(args: Record<string, unknown>, tick: number): ToolOutcome {
  const parsed = parsePlotArg(args.plot);
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (!parsed) return { result: "Name the plot as its grid, such as two numbers separated by a comma.", kind: null };
  if (!reason) return { result: "Give a reason for wanting to go there.", kind: null };
  const plot = listPlots().find((row) => row.gridX === parsed.gridX && row.gridZ === parsed.gridZ);
  if (!plot || plot.status === "unlocked") {
    return {
      result: plot?.status === "unlocked" ? "That land is already open." : "That plot is not waiting at the edge.",
      kind: null,
    };
  }
  if (plot.status === "proposed") {
    const requestId = plot.notes.startsWith("request:") ? plot.notes.slice("request:".length) : "";
    const same = listRequests().find((request) => request.id === requestId);
    if (same) {
      return {
        result: `Request ${same.id} already covers this (${same.status}): ${same.title}. ${same.body}`,
        kind: null,
      };
    }
  }
  if (!sharesASide(plot)) return { result: "That plot does not share a side with open land.", kind: null };
  const pending = listPlots().find((row) => row.status === "proposed");
  if (pending && pending.id !== plot.id) {
    return { result: "A request to explore is already waiting.", kind: null };
  }
  if (unlockedPlots().length >= runtimeConfig().maxPlots) {
    return { result: "The world is already as large as it can be.", kind: null };
  }
  if (expansionsThisWeek() >= runtimeConfig().expansionPerWeek) {
    return { result: "An expansion was already opened this week.", kind: null };
  }
  const requestId = randomUUID();
  const title = exploreTitle(plot.gridX, plot.gridZ, plot.type).slice(0, 120);
  const body = `${reason.slice(0, 500)}\n\nTerrain: ${plot.type}.`;
  savePlot({ ...plot, status: "proposed", notes: `request:${requestId}` });
  publish(
    makeEvent<Extract<WorldEvent, { kind: "request" }>>(
      "request",
      { requestId, title, body },
      tick,
    ),
  );
  broadcastPlots();
  return { result: `Filed for the owner: ${title}.`, kind: "request" };
}

export function explorePlot(args: Record<string, unknown>, tick: number): ToolOutcome {
  const parsed = parsePlotArg(args.plot);
  if (!parsed) return { result: "Name the plot as its grid, such as two numbers separated by a comma.", kind: null };
  const plot = listPlots().find((row) => row.gridX === parsed.gridX && row.gridZ === parsed.gridZ);
  if (!plot || plot.status !== "unlocked") return { result: "That land is not open yet.", kind: null };
  const point = approachPoint(plot.gridX, plot.gridZ);
  publish(plotEvent("explored", plot, point, tick));
  return { result: `Walking to the edge of ${plot.name}.`, kind: "plot" };
}

export function expansionBlock(requestId: string, decision: "approved" | "denied"): string | null {
  if (decision !== "approved") return null;
  const plot = plotForRequest(requestId);
  if (!plot) return null;
  if (unlockedPlots().length >= runtimeConfig().maxPlots) return "The world is already as large as it can be.";
  if (expansionsThisWeek() >= runtimeConfig().expansionPerWeek) return "An expansion was already opened this week.";
  return null;
}

export function applyExpansionDecision(
  requestId: string,
  decision: "approved" | "denied",
  tick: number,
): WorldEvent | null {
  const plot = plotForRequest(requestId);
  if (!plot) return null;
  if (decision === "denied") {
    savePlot({ ...plot, status: "mist", notes: "" });
    broadcastPlots();
    return null;
  }
  const opened: PlotRecord = {
    ...plot,
    status: "unlocked",
    unlockedAt: new Date().toISOString(),
    notes: "",
  };
  savePlot(opened);
  openFrontier();
  const event = plotEvent("unlocked", opened, approachPoint(plot.gridX, plot.gridZ), tick);
  publish(event);
  broadcastPlots();
  return event;
}
