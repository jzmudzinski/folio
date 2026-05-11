import { reindexAll } from "../../core/storage";
import { c, out } from "../io";

export async function reindexCmd(): Promise<number> {
  const r = await reindexAll();
  if (r.failed.length === 0) {
    out(c.ok("✓") + ` Reindexed ${c.bold(String(r.ok))} note${r.ok === 1 ? "" : "s"}`);
    return 0;
  }
  out(c.warn("⚠") + ` Reindexed ${r.ok}, ${c.err(String(r.failed.length))} failed:`);
  for (const f of r.failed) {
    out(`  ${c.dim(f.id)}  ${c.err(f.error)}`);
  }
  return 1;
}
