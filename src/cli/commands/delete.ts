/**
 * `folio delete <id>` — soft-delete a note. File moves to ~/Folio/.trash/<id>/
 * (recoverable for 7 days), DB row flips to status='trashed', FTS row is
 * removed so search doesn't surface the note.
 *
 * If the device is paired with a cloud relay, the sync daemon propagates
 * the deletion to the cloud on next sync. Other paired devices still hold
 * their local copy until you run `folio delete` there too (no automatic
 * cross-device delete propagation in W4b MVP).
 *
 * Recovery within grace period (7 days): move the file back from
 * ~/Folio/.trash/<id>/note.html into the original thread directory, then
 * run `folio reindex`. After grace, `folio cleanup` hard-deletes.
 */

import { c, out, err } from "../io";
import { deleteNote, getNoteMeta } from "../../core/storage";

export interface DeleteOpts {
  id?: string;
  yes?: boolean;
  jsonOut?: boolean;
}

export async function deleteCmd(opts: DeleteOpts): Promise<number> {
  const id = (opts.id ?? "").trim();
  if (!id) {
    err(c.err("✗ note id required\n"));
    return 3;
  }
  const note = getNoteMeta(id);
  if (!note) {
    err(c.err(`✗ note not found: ${id}\n`));
    return 4;
  }

  // Light safety net for human use: confirm before trashing unless --yes.
  // Tests + agents bypass with --yes; scripts can pipe yes(1) easily.
  if (!opts.yes && process.stdin.isTTY && process.stdout.isTTY) {
    process.stdout.write(
      `Trash "${note.title}" (thread: ${note.thread_id})? [y/N] `
    );
    const buf = new Uint8Array(8);
    const n = await Bun.stdin.stream().getReader().read();
    const answer = (n.value ? new TextDecoder().decode(n.value) : "").trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      out(c.dim("aborted."));
      return 0;
    }
  }

  const res = deleteNote(id);
  if (!res.ok) {
    err(c.err(`✗ delete failed: ${res.reason ?? "unknown"}\n`));
    return 5;
  }

  if (opts.jsonOut) {
    out(JSON.stringify({ deleted: id, recoverable_until_days: 7 }));
    return 0;
  }
  out(c.ok("✓") + ` Trashed ${c.dim(id)} — "${note.title}"`);
  out(c.dim(`  File saved at ~/Folio/.trash/${id}/note.html for 7 days.`));
  out(c.dim("  Sync propagates the deletion to your cloud on next run."));
  return 0;
}
