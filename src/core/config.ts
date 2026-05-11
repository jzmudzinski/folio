import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface FolioConfig {
  theme: string;
  default_lifespan_days: number;
  viewer_port: number;
  viewer_host: string;
}

export const DEFAULT_CONFIG: FolioConfig = {
  theme: "linen",
  default_lifespan_days: 30,
  viewer_port: 4810,
  viewer_host: "127.0.0.1",
};

export function folioRoot(): string {
  return process.env.FOLIO_HOME ?? join(homedir(), "Folio");
}

export function notesDir(): string {
  return join(folioRoot(), "notes");
}

export function threadsDir(): string {
  return join(folioRoot(), "threads");
}

export function themesDir(): string {
  return join(folioRoot(), "themes");
}

export function templatesDir(): string {
  return join(folioRoot(), "templates");
}

export function trashDir(): string {
  return join(folioRoot(), ".trash");
}

export function dbPath(): string {
  return join(folioRoot(), "index.sqlite");
}

export function configPath(): string {
  return join(folioRoot(), "folio.config.json");
}

export function bundledThemesDir(): string {
  return join(import.meta.dir, "..", "..", "themes");
}

export function bundledTemplatesDir(): string {
  return join(import.meta.dir, "..", "..", "templates");
}

export async function loadConfig(): Promise<FolioConfig> {
  if (!existsSync(configPath())) return { ...DEFAULT_CONFIG };
  try {
    const raw = await Bun.file(configPath()).text();
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(cfg: FolioConfig): Promise<void> {
  await Bun.write(configPath(), JSON.stringify(cfg, null, 2));
}
