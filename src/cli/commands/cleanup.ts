import { cleanup } from "../../core/storage";
import { c, out, json } from "../io";

interface CleanupOpts {
  dryRun?: boolean;
  graceDays?: number;
  jsonOut?: boolean;
}

export async function cleanupCmd(opts: CleanupOpts): Promise<number> {
  const result = await cleanup({
    dry_run: opts.dryRun ?? false,
    trash_grace_days: opts.graceDays ?? 7,
  });

  if (opts.jsonOut) {
    json(result);
    return 0;
  }

  const tag = opts.dryRun ? c.warn("[dry-run]") : c.ok("✓");
  out(`${tag} Cleanup complete`);
  out("");
  if (result.trashed.length === 0) {
    out(c.dim("  no notes past expiry"));
  } else {
    out(c.bold(`Moved to .trash (${result.trashed.length}):`));
    for (const n of result.trashed) {
      out(`  ${c.dim(n.id.slice(0, 10))}  ${c.bold(n.title.padEnd(40).slice(0, 40))}  ${c.dim(`${n.age_days}d old`)}`);
    }
  }
  out("");
  if (result.hard_deleted.length === 0) {
    out(c.dim("  no stale trash to delete"));
  } else {
    out(c.bold(`Hard-deleted from trash (${result.hard_deleted.length}):`));
    for (const n of result.hard_deleted) {
      out(`  ${c.dim(n.id.slice(0, 10))}  ${c.dim(n.path)}`);
    }
  }
  return 0;
}
