import { stats } from "../../core/storage";
import { c, out, json } from "../io";

export async function statsCmd(opts: { jsonOut?: boolean }): Promise<number> {
  const s = stats();
  if (opts.jsonOut) {
    json(s);
    return 0;
  }
  out(c.bold("Folio stats"));
  out("");
  out(`  ${c.dim("total      ")} ${s.total}`);
  out(`  ${c.dim("final ⭐    ")} ${s.final}`);
  out(`  ${c.dim("expiring 7d")} ${s.expiring_7d}`);
  out(`  ${c.dim("threads    ")} ${s.threads}`);
  out("");
  out(c.bold("By type:"));
  for (const t of s.by_type) {
    out(`  ${c.dim(t.type.padEnd(12))} ${t.n}`);
  }
  out("");
  out(c.bold("Analytics:"));
  const acm = s.analytics.avg_class_match;
  out(`  ${c.dim("class match")} ${acm == null ? "(no data)" : (acm * 100).toFixed(1) + "%"}`);
  out(`  ${c.dim("events     ")} ${s.analytics.total_events}`);
  return 0;
}
