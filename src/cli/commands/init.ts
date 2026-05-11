import { existsSync, mkdirSync } from "node:fs";
import { folioRoot, threadsDir, themesDir, templatesDir, trashDir, notesDir, configPath, DEFAULT_CONFIG, saveConfig } from "../../core/config";
import { db } from "../../core/db";
import { c, out } from "../io";

export async function init(): Promise<number> {
  const root = folioRoot();
  const created: string[] = [];

  for (const dir of [root, threadsDir(), notesDir(), themesDir(), templatesDir(), trashDir()]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      created.push(dir);
    }
  }

  if (!existsSync(configPath())) {
    await saveConfig({ ...DEFAULT_CONFIG });
    created.push(configPath());
  }

  // Touch DB (creates + migrates).
  db();

  out(c.ok("✓") + ` Folio initialized at ${c.cyan(root)}`);
  if (created.length) {
    out(c.dim("Created:"));
    for (const p of created) out(c.dim("  " + p.replace(root, "~/Folio")));
  } else {
    out(c.dim("(already initialized — no changes)"));
  }
  out("");
  out(`Default theme: ${c.magenta(DEFAULT_CONFIG.theme)}`);
  out(`Run ${c.bold("folio serve")} to open the local viewer.`);
  return 0;
}
