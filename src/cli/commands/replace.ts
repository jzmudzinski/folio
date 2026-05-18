import { readFileSync, existsSync } from "node:fs";
import { getNoteMeta, replaceNote } from "../../core/storage";
import { c, out } from "../io";

export interface ReplaceCmdOptions {
  html?: string;        // "@path" → read file; raw HTML otherwise
  title?: string;
  theme?: string;
  tags?: string;
}

/**
 * `folio replace <old_id> --html @path [--title T] [--theme X] [--tags "a,b"]`
 *
 * Wraps storage.replaceNote — see the note in storage.ts for semantics.
 * Body is read from --html (use @path to read from file). Title/theme/tags
 * are optional overrides; default = inherit from old.
 */
export async function replaceCmd(oldId: string, opts: ReplaceCmdOptions): Promise<number> {
  if (!oldId) {
    process.stderr.write(c.err("✗ pass old note id\n"));
    return 3;
  }
  if (!opts.html) {
    process.stderr.write(c.err("✗ --html is required (use @path to read from file)\n"));
    return 3;
  }
  const old = getNoteMeta(oldId);
  if (!old) {
    process.stderr.write(c.err(`✗ note not found: ${oldId}\n`));
    return 2;
  }

  let body_html = opts.html;
  if (body_html.startsWith("@")) {
    const p = body_html.slice(1);
    if (!existsSync(p)) {
      process.stderr.write(c.err(`✗ file not found: ${p}\n`));
      return 2;
    }
    body_html = readFileSync(p, "utf-8");
  }

  const patch: Parameters<typeof replaceNote>[0] = { old_id: oldId, body_html };
  if (typeof opts.title === "string") patch.title = opts.title;
  if (typeof opts.theme === "string") patch.theme = opts.theme;
  if (typeof opts.tags === "string") {
    patch.tags = opts.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }

  const result = await replaceNote(patch);
  if (!result.ok) {
    if (result.reason === "already-superseded") {
      process.stderr.write(c.err(`✗ note ${oldId} is already superseded; replace its successor instead\n`));
      return 4;
    }
    process.stderr.write(c.err(`✗ replace failed: ${result.reason ?? "unknown"}\n`));
    return 1;
  }

  out(c.ok("✓") + ` Replaced ${c.bold(old.title)}`);
  out(`  old → ${c.dim(oldId)}`);
  out(`  new → ${c.cyan(result.new_meta!.id)} (${result.new_meta!.slug})`);
  return 0;
}
