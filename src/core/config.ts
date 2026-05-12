import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

export interface FolioConfig {
  theme: string;
  default_lifespan_days: number;
  viewer_port: number;
  viewer_host: string;
  // Public-facing base URL of the viewer when Folio is reverse-proxied
  // (e.g. https://notes.example.com). When set, MCP responses and CLI
  // banners surface this instead of http://127.0.0.1:<port> — important when
  // an agent (bot, Telegram, email) relays the URL to a user who can't reach
  // localhost. Notes themselves keep relative /n/<id> links so they render
  // unchanged behind either base. No trailing slash.
  viewer_public_url?: string;
}

export const DEFAULT_CONFIG: FolioConfig = {
  theme: "linen",
  default_lifespan_days: 30,
  viewer_port: 4810,
  viewer_host: "127.0.0.1",
};

export function viewerLocalBaseUrl(cfg: FolioConfig): string {
  return `http://${cfg.viewer_host}:${cfg.viewer_port}`;
}

export function viewerPublicBaseUrl(cfg: FolioConfig): string {
  const pub = cfg.viewer_public_url?.trim();
  if (pub) return pub.replace(/\/+$/, "");
  return viewerLocalBaseUrl(cfg);
}

export function folioRoot(): string {
  return process.env.FOLIO_HOME ?? join(homedir(), "Folio");
}

export function notesDir(): string {
  return join(folioRoot(), "notes");
}

export function threadsDir(): string {
  return join(folioRoot(), "threads");
}

export function threadAssetsDir(threadId: string): string {
  // Assets live in threads/<thread_id>/assets/ — sibling to the note *.html
  // files so they share the thread folder and get the same backup coverage,
  // but in a subdir so a filename can never collide with a note slug.
  return join(threadsDir(), threadId, "assets");
}

/**
 * Safe-asset-filename predicate. Must be ASCII alphanumeric + `.` `_` `-`,
 * non-empty, ≤ 200 chars, no leading/trailing dot, no consecutive dots
 * (prevents `..` and `.foo` hidden files). Path separators are excluded by
 * the character class. Reject everything else; this is the only guard
 * between an untrusted MCP caller and the filesystem.
 */
export function isSafeAssetFilename(name: string): boolean {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 200) return false;
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return false;
  if (name.startsWith(".") || name.endsWith(".")) return false;
  if (name.includes("..")) return false;
  return true;
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
  // Env override for compiled binaries (bun --compile) — `import.meta.dir`
  // resolves to an embedded path that does not exist on disk. Production
  // deploys (Jetson) ship themes separately + FOLIO_BUNDLED_THEMES_DIR=/opt/folio/themes.
  const envDir = process.env.FOLIO_BUNDLED_THEMES_DIR?.trim();
  if (envDir && existsSync(envDir)) return envDir;
  // Fallback: relative to execPath (binary location)
  if (process.execPath && existsSync(process.execPath)) {
    const next = join(process.execPath, "..", "themes");
    if (existsSync(next)) return next;
  }
  return join(import.meta.dir, "..", "..", "themes");
}

export function bundledTemplatesDir(): string {
  const envDir = process.env.FOLIO_BUNDLED_TEMPLATES_DIR?.trim();
  if (envDir && existsSync(envDir)) return envDir;
  if (process.execPath && existsSync(process.execPath)) {
    const next = join(process.execPath, "..", "templates");
    if (existsSync(next)) return next;
  }
  return join(import.meta.dir, "..", "..", "templates");
}

export function bundledSkillsDir(): string {
  // Same resolution pattern as themes/templates: env override → execPath
  // sibling → dev fallback. Each subdir is one skill (currently just "folio").
  // `folio install --target claude-code` symlinks ~/.claude/skills/<name> →
  // <bundledSkillsDir>/<name>; after `folio update`, the path stays stable so
  // symlinks survive.
  const envDir = process.env.FOLIO_BUNDLED_SKILLS_DIR?.trim();
  if (envDir && existsSync(envDir)) return envDir;
  if (process.execPath && existsSync(process.execPath)) {
    const next = join(process.execPath, "..", "skills");
    if (existsSync(next)) return next;
  }
  return join(import.meta.dir, "..", "..", "skills");
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
