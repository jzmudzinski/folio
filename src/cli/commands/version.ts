import pkg from "../../../package.json" with { type: "json" };
import { loadConfig, folioRoot } from "../../core/config";
import { c, out, json } from "../io";

export interface VersionOptions {
  jsonOut?: boolean;
}

export async function versionCmd(opts: VersionOptions = {}): Promise<number> {
  // Match MCP `version` tool payload — same fields, same names, so scripts can
  // pick either surface and get identical structure.
  const cfg = await loadConfig().catch(() => null);
  const payload = {
    name: pkg.name,
    version: pkg.version,
    folio_root: folioRoot(),
    viewer_url: cfg ? `http://${cfg.viewer_host}:${cfg.viewer_port}` : null,
    default_theme: cfg?.theme ?? null,
    default_lifespan_days: cfg?.default_lifespan_days ?? null,
  };
  if (opts.jsonOut) {
    json(payload);
    return 0;
  }
  out(`${c.bold("folio")} ${c.cyan("v" + payload.version)}`);
  out(`  ${c.dim("storage:")}   ${payload.folio_root}`);
  if (payload.viewer_url) out(`  ${c.dim("viewer:")}    ${payload.viewer_url}`);
  if (payload.default_theme) out(`  ${c.dim("theme:")}     ${payload.default_theme}`);
  if (payload.default_lifespan_days != null) {
    out(`  ${c.dim("lifespan:")}  ${payload.default_lifespan_days} days`);
  }
  return 0;
}
