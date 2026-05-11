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

// Themes are filesystem-backed. No in-memory cache — we re-scan on every call
// so that newly added theme folders (e.g., user dropping a `themes/aurora/`
// or a `folio install` later writing one) become visible without a server
// restart. The scan is ~10ms over ~20 directories with 2 file existence
// checks each; cheap relative to the rest of a request.
export function loadThemes(_force = false): Map<string, Theme> {
  const themes = new Map<string, Theme>();
  for (const root of [bundledThemesDir(), themesDir()]) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const cssPath = join(dir, "theme.css");
      const promptPath = join(dir, "theme.md");
      if (!existsSync(cssPath)) continue;
      const source: Theme["source"] = root === themesDir() ? "user" : "bundled";
      themes.set(name, {
        name,
        css: "",      // populated lazily by getTheme()
        prompt: existsSync(promptPath) ? "" : "",
        source,
        path: dir,
      });
    }
  }
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
