import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./env.js";

export type MemoryFile = "identity.md" | "interests.md" | "projects.md";

function fullPath(file: MemoryFile): string {
  return path.join(repoRoot(), "memory", file);
}

export function readMemory(file: MemoryFile): string {
  const full = fullPath(file);
  if (!fs.existsSync(full)) return "";
  return fs.readFileSync(full, "utf8");
}

export function writeMemory(file: MemoryFile, text: string): void {
  const full = fullPath(file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const body = text.endsWith("\n") ? text : `${text}\n`;
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, full);
}
