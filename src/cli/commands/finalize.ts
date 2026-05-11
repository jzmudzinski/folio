import { finalize, getNoteMeta } from "../../core/storage";
import { c, out } from "../io";

export async function finalizeCmd(id: string): Promise<number> {
  if (!id) {
    process.stderr.write(c.err("✗ pass note id\n"));
    return 3;
  }
  const note = getNoteMeta(id);
  if (!note) {
    process.stderr.write(c.err(`✗ note not found: ${id}\n`));
    return 2;
  }
  finalize(id);
  out(c.ok("⭐") + ` Marked as final: ${c.bold(note.title)}`);
  return 0;
}
