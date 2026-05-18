import { getNoteMeta, updateNoteMetadata } from "../../core/storage";
import { c, out } from "../io";

export interface EditCmdOptions {
  title?: string;
  theme?: string;
  tags?: string;
  final?: boolean;
  unfinal?: boolean;
}

/**
 * `folio edit <id>` — update metadata on an existing note. Body stays
 * immutable (use `folio new` in the same thread to add a body revision,
 * or eventually `folio replace` for in-place body replacement).
 *
 *   --title "New title"          replace the title
 *   --theme linen                switch the theme
 *   --tags "a,b,c"               replace the tag set (comma-sep; "" clears)
 *   --final / --unfinal          flip the is_final flag (mutually exclusive)
 */
export async function editCmd(id: string, opts: EditCmdOptions): Promise<number> {
  if (!id) {
    process.stderr.write(c.err("✗ pass note id\n"));
    return 3;
  }
  const note = getNoteMeta(id);
  if (!note) {
    process.stderr.write(c.err(`✗ note not found: ${id}\n`));
    return 2;
  }
  if (opts.final && opts.unfinal) {
    process.stderr.write(c.err("✗ --final and --unfinal are mutually exclusive\n"));
    return 3;
  }

  const patch: Parameters<typeof updateNoteMetadata>[0] = { id };
  if (typeof opts.title === "string") patch.title = opts.title;
  if (typeof opts.theme === "string") patch.theme = opts.theme;
  if (typeof opts.tags === "string") {
    patch.tags = opts.tags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  if (opts.final) patch.is_final = true;
  else if (opts.unfinal) patch.is_final = false;

  const result = await updateNoteMetadata(patch);
  if (!result.ok) {
    if (result.reason === "no-change") {
      process.stderr.write(c.err("✗ no-change — pass at least one field different from current state\n"));
      return 4;
    }
    if (result.reason === "unknown-theme") {
      process.stderr.write(c.err(`✗ unknown theme: ${patch.theme}\n`));
      return 5;
    }
    process.stderr.write(c.err(`✗ update failed: ${result.reason ?? "unknown"}\n`));
    return 1;
  }

  out(c.ok("✓") + ` Updated ${c.bold(result.meta!.title)} (${result.updated_fields!.join(", ")})`);
  return 0;
}
