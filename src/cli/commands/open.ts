import { spawn } from "node:child_process";
import { getNoteMeta, getNoteBySlug } from "../../core/storage";
import { loadConfig } from "../../core/config";
import { c } from "../io";

function osOpener(): string {
  if (process.platform === "darwin") return "open";
  if (process.platform === "win32") return "start";
  return "xdg-open";
}

export async function openCmd(idOrSlug: string): Promise<number> {
  if (!idOrSlug) {
    process.stderr.write(c.err("✗ pass note id or slug\n"));
    return 3;
  }
  const note = getNoteMeta(idOrSlug) ?? getNoteBySlug(idOrSlug);
  if (!note) {
    process.stderr.write(c.err(`✗ note not found: ${idOrSlug}\n`));
    return 2;
  }
  const cfg = await loadConfig();
  const url = `http://${cfg.viewer_host}:${cfg.viewer_port}/n/${note.id}`;

  spawn(osOpener(), [url], { stdio: "ignore", detached: true }).unref();
  process.stdout.write(c.ok("✓") + ` opened ${c.cyan(url)}\n`);
  return 0;
}
