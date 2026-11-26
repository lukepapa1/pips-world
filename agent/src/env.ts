import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function demoMode(): boolean {
  const value = process.env.DEMO_MODE;
  return value === "1" || value === "true";
}

function configuredDir(name: string): string {
  const raw = process.env.DATA_DIR?.trim();
  const root = raw ? path.resolve(raw) : repoRoot();
  return path.join(root, name);
}

export function sqliteFile(): string {
  const raw = process.env.DATA_DIR?.trim();
  if (raw) return path.join(path.resolve(raw), "pips.sqlite");
  return path.join(repoRoot(), "data", "pips.sqlite");
}

export function memoryDir(): string {
  return configuredDir("memory");
}

export function publishedDir(): string {
  return configuredDir("published");
}

export function worldDistDir(): string {
  return path.join(repoRoot(), "world", "dist");
}

export function ensureDataDirs(): void {
  fs.mkdirSync(path.dirname(sqliteFile()), { recursive: true });
  fs.mkdirSync(memoryDir(), { recursive: true });
  fs.mkdirSync(path.join(memoryDir(), "journal"), { recursive: true });
  fs.mkdirSync(publishedDir(), { recursive: true });
}

const SECRET_ENV = ["LLM_API_KEY", "SEARCH_API_KEY", "OWNER_PASSWORD", "NTFY_TOPIC", "VAPID_PRIVATE_KEY"];

export function redactSecrets(text: string): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 4) out = out.split(value).join("[redacted]");
  }
  return out;
}
