import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { bundledThemesDir, themesDir } from "./config";

export interface Theme {
  name: string;
  css: string;
  prompt: string;
  source: "user" | "bundled";
  path: string;
}

let _cache: Map<string, Theme> | null = null;

export function loadThemes(force = false): Map<string, Theme> {
  if (_cache && !force) return _cache;
  const themes = new Map<string, Theme>();
  for (const root of [bundledThemesDir(), themesDir()]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      const cssPath = join(dir, "theme.css");
      const promptPath = join(dir, "theme.md");
      if (!existsSync(cssPath)) continue;
      const source: Theme["source"] = root === themesDir() ? "user" : "bundled";
      themes.set(name, {
        name,
        css: Bun.file(cssPath).text() as unknown as string,
        prompt: existsSync(promptPath) ? (Bun.file(promptPath).text() as unknown as string) : "",
        source,
        path: dir,
      });
    }
  }
  _cache = themes;
  return themes;
}

export async function getTheme(name: string): Promise<Theme | null> {
  const cached = loadThemes().get(name);
  if (!cached) return null;
  const css = await Bun.file(join(cached.path, "theme.css")).text();
  const promptPath = join(cached.path, "theme.md");
  const prompt = await Bun.file(promptPath).text().catch(() => "");
  return { ...cached, css, prompt };
}

export function listThemes(): { name: string; source: "user" | "bundled" }[] {
  return Array.from(loadThemes().values()).map((t) => ({ name: t.name, source: t.source }));
}
