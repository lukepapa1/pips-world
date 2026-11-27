import type { PlotRecord, Terrain } from "@pips/shared";
import { getState, subscribe } from "./state";

const FILL: Record<Terrain, string> = {
  meadow: "#7d9954",
  forest: "#3f6b3c",
  beach: "#e4d2a8",
  hills: "#8a9a6a",
  wetland: "#5d7a62",
  lake: "#6aa0b8",
  rocky: "#8a8178",
};

let pipX = 0;
let pipZ = 0;

export function notePip(x: number, z: number): void {
  pipX = x;
  pipZ = z;
}

function draw(canvas: HTMLCanvasElement, plots: PlotRecord[]): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const size = 220;
  canvas.width = Math.floor(size * ratio);
  canvas.height = Math.floor(size * ratio);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size, size);
  context.fillStyle = "#f6f0e4";
  context.fillRect(0, 0, size, size);
  if (plots.length === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const plot of plots) {
    minX = Math.min(minX, plot.gridX);
    maxX = Math.max(maxX, plot.gridX);
    minZ = Math.min(minZ, plot.gridZ);
    maxZ = Math.max(maxZ, plot.gridZ);
  }
  const cols = maxX - minX + 1;
  const rows = maxZ - minZ + 1;
  const cell = Math.min(36, Math.floor((size - 28) / Math.max(cols, rows)));
  const originX = (size - cols * cell) / 2;
  const originY = (size - rows * cell) / 2;
  for (const plot of plots) {
    const x = originX + (plot.gridX - minX) * cell;
    const y = originY + (maxZ - plot.gridZ) * cell;
    const open = plot.status === "unlocked";
    context.fillStyle = open ? FILL[plot.type] : "rgba(226, 232, 228, 0.95)";
    context.fillRect(x + 2, y + 2, cell - 4, cell - 4);
    context.strokeStyle = open ? "rgba(42, 36, 28, 0.25)" : "rgba(42, 36, 28, 0.18)";
    context.strokeRect(x + 2, y + 2, cell - 4, cell - 4);
    if (!open) {
      context.fillStyle = "#2a241c";
      context.font = "600 14px Nunito, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("?", x + cell / 2, y + cell / 2);
    }
  }
  const px = originX + ((pipX / 24) - minX + 0.5) * cell;
  const py = originY + (maxZ - pipZ / 24 + 0.5) * cell;
  context.beginPath();
  context.fillStyle = "#8e3b28";
  context.arc(px, py, 4.5, 0, Math.PI * 2);
  context.fill();
  context.lineWidth = 1.5;
  context.strokeStyle = "#f6f0e4";
  context.stroke();
}

export function mountPlotMap(): void {
  const open = document.getElementById("open-map");
  const panel = document.getElementById("plot-map");
  const canvas = document.getElementById("plot-map-canvas");
  const close = document.getElementById("close-map");
  if (!(open instanceof HTMLButtonElement)) return;
  if (!(panel instanceof HTMLElement)) return;
  if (!(canvas instanceof HTMLCanvasElement)) return;
  if (!(close instanceof HTMLButtonElement)) return;

  const paint = () => {
    if (panel.hidden) return;
    draw(canvas, getState().plots);
  };
  open.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    open.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
    paint();
  });
  close.addEventListener("click", () => {
    panel.hidden = true;
    open.setAttribute("aria-expanded", "false");
  });
  subscribe(() => paint());
  window.setInterval(paint, 400);
}
