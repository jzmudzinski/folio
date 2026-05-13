/**
 * `folio cloud {init|serve|pair-code}` — operator-facing cloud relay CLI.
 *
 * init     — Idempotent first-run setup of the cloud data dir + DB schema.
 *            Safe to re-run; touches nothing if already initialized.
 * serve    — Long-running process. Reads env: FOLIO_CLOUD_HOME (data dir),
 *            FOLIO_CLOUD_PORT (default 8081), FOLIO_CLOUD_HOST (default
 *            127.0.0.1), FOLIO_CLOUD_PUBLIC_URL. Runs until SIGTERM/SIGINT.
 * pair-code — Generate a one-shot 6-digit pairing code, print to stdout.
 *            Used by the admin to onboard a new device. 10 min TTL.
 *
 * All commands operate against the cloud DB (cloud.sqlite) — independent
 * from the local viewer's index.sqlite.
 */

import { existsSync, mkdirSync } from "node:fs";
import { cloudDataDir, cloudDb, cloudDbPath, cloudAssetsDir } from "../../cloud/db";
import { createPairingCode } from "../../cloud/auth";
import { startCloudServer } from "../../cloud/server";
import { c, out, err } from "../io";

export async function cloudCmd(sub: string | undefined, _args: string[]): Promise<number> {
  switch (sub) {
    case "init":
      return cloudInit();
    case "serve":
      return cloudServe();
    case "pair-code":
      return cloudPairCode();
    default:
      err("Usage: folio cloud {init|serve|pair-code}");
      return 1;
  }
}

function cloudInit(): number {
  const dir = cloudDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 });
  const assetsDir = cloudAssetsDir();
  if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true, mode: 0o755 });
  // Touching the DB creates schema if missing (idempotent).
  cloudDb();
  out(c.cyan("✓ Folio Cloud initialized"));
  out(`  Data dir: ${dir}`);
  out(`  DB:       ${cloudDbPath()}`);
  out(`  Assets:   ${assetsDir}`);
  out("");
  out(`Next: ${c.cyan("folio cloud pair-code")} to onboard a device.`);
  return 0;
}

async function cloudServe(): Promise<number> {
  // Ensure data dir + DB exist before the server tries to use them.
  cloudInit();
  const server = startCloudServer();
  out(c.cyan(`✓ Folio Cloud listening on ${server.hostname}:${server.port}`));
  const pub = process.env.FOLIO_CLOUD_PUBLIC_URL;
  if (pub) out(`  Public URL: ${pub}`);
  out(c.dim("  Ctrl-C to stop"));
  // Hold the process. Bun.serve already keeps the event loop alive, but
  // wire SIGTERM/SIGINT explicitly so systemd graceful shutdown works.
  const stop = (sig: string) => {
    out(c.dim(`\n  received ${sig}, stopping`));
    server.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  // Block forever (Bun keeps event loop alive on its own).
  await new Promise<void>(() => {});
  return 0;
}

function cloudPairCode(): number {
  cloudInit();
  const { code, expiresAt } = createPairingCode();
  out("");
  out(`  Pairing code: ${c.bold(c.cyan(code))}`);
  out(`  Expires:      ${c.dim(expiresAt)}`);
  out("");
  out(c.dim("  Use within 10 minutes:"));
  out(c.dim(`    curl -X POST $CLOUD/v1/auth/pair \\`));
  out(c.dim(`      -d '{"code":"${code}","device_name":"<name>"}'`));
  return 0;
}
