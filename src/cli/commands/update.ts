import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import pkg from "../../../package.json" with { type: "json" };
import { c, out, err, json } from "../io";

const RELEASES_API = "https://api.github.com/repos/jzmudzinski/folio/releases";

interface GhAsset {
  name: string;
  browser_download_url: string;
}

interface GhRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  published_at: string;
  assets: GhAsset[];
}

export interface UpdateOptions {
  check?: boolean;       // only check, don't install
  force?: boolean;       // reinstall even if already on latest
  prerelease?: boolean;  // consider prereleases when picking "latest"
  jsonOut?: boolean;
}

/** Pick the asset name for the host platform: folio-<target>.tar.gz */
export function detectTarget(): string | null {
  const p = process.platform;
  const a = process.arch;
  if (p === "darwin" && a === "arm64") return "darwin-arm64";
  if (p === "linux" && a === "x64") return "linux-x64";
  if (p === "linux" && a === "arm64") return "linux-arm64";
  return null;
}

/** Strict semver-ish compare; returns >0 if a>b, <0 if a<b, 0 equal. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

async function fetchLatest(includePrerelease: boolean): Promise<GhRelease> {
  const res = await fetch(RELEASES_API + (includePrerelease ? "?per_page=10" : "/latest"), {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `folio/${pkg.version}` },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const body = await res.json();
  if (includePrerelease) {
    // /releases returns an array; pick first non-draft (newest first per API contract)
    const arr = body as GhRelease[];
    const pick = arr.find((r) => !r.draft);
    if (!pick) throw new Error("No releases found");
    return pick;
  }
  return body as GhRelease;
}

export async function updateCmd(opts: UpdateOptions = {}): Promise<number> {
  const target = detectTarget();
  if (!target) {
    err(c.err(`✗ Unsupported platform: ${process.platform}/${process.arch}. Supported: darwin-arm64, linux-x64, linux-arm64.`));
    return 1;
  }

  let latest: GhRelease;
  try {
    latest = await fetchLatest(opts.prerelease ?? false);
  } catch (e: any) {
    err(c.err(`✗ Could not reach GitHub releases: ${e?.message ?? e}`));
    return 1;
  }

  const currentRaw = pkg.version;
  const latestRaw = latest.tag_name.replace(/^v/, "");
  const diff = cmpVersion(currentRaw, latestRaw);

  if (opts.jsonOut) {
    json({
      current: currentRaw,
      latest: latestRaw,
      up_to_date: diff >= 0 && !opts.force,
      target,
      release_url: latest.html_url,
      published_at: latest.published_at,
      action: opts.check ? "check" : (diff < 0 || opts.force ? "install" : "skip"),
    });
    if (opts.check) return 0;
    if (diff >= 0 && !opts.force) return 0;
  } else {
    out(`${c.dim("current:")} ${c.bold("v" + currentRaw)}`);
    out(`${c.dim("latest: ")} ${c.bold("v" + latestRaw)} ${c.dim("(" + latest.published_at.slice(0, 10) + ")")}`);
    if (diff >= 0 && !opts.force) {
      out(c.ok("✓ You're on the latest version."));
      if (opts.check) return 0;
      out(c.dim("  (re-install with --force, or pass --pre to consider prereleases.)"));
      return 0;
    }
    if (opts.check) {
      out(c.warn(diff < 0 ? `↑ Update available: v${currentRaw} → v${latestRaw}` : `(forced reinstall path)`));
      out(c.dim(`  Release: ${latest.html_url}`));
      return 0;
    }
    out(diff < 0
      ? c.warn(`↑ Updating: v${currentRaw} → v${latestRaw}`)
      : c.warn(`↻ Reinstalling v${latestRaw} (--force)`));
  }

  // Find the right asset
  const expected = `folio-${target}.tar.gz`;
  const asset = latest.assets.find((a) => a.name === expected);
  if (!asset) {
    err(c.err(`✗ Release ${latest.tag_name} is missing asset ${expected}. Assets: ${latest.assets.map((a) => a.name).join(", ")}`));
    return 1;
  }

  const tmp = mkdtempSync(join(tmpdir(), "folio-update-"));
  try {
    if (!opts.jsonOut) out(c.dim(`  download → ${tmp}/${expected}`));
    const r = await fetch(asset.browser_download_url);
    if (!r.ok) throw new Error(`download ${r.status}: ${asset.browser_download_url}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    const tarPath = join(tmp, expected);
    await Bun.write(tarPath, buf);

    // Extract via the system `tar` (every supported platform ships it)
    if (!opts.jsonOut) out(c.dim("  extract"));
    await runCmd("tar", ["xz", "-f", tarPath, "-C", tmp]);

    const installSh = join(tmp, "install.sh");
    if (!existsSync(installSh)) {
      throw new Error(`tarball is missing install.sh: ${tarPath}`);
    }
    if (!opts.jsonOut) out(c.dim("  install.sh"));
    await runCmd("bash", [installSh], { cwd: tmp });

    // Post-update refresh: if the user previously ran `folio install --target
    // claude-code`, the MCP command path in ~/.claude.json may now point at
    // the old binary location. Refresh idempotently — noop if nothing was
    // ever installed.
    let refreshed = 0;
    try {
      const { refreshAfterUpdate } = await import("../install/claude-code");
      const r = refreshAfterUpdate();
      refreshed = r.refreshed;
    } catch (e: any) {
      if (!opts.jsonOut) err(c.warn(`! Post-update install refresh failed: ${e?.message ?? e}`));
    }

    if (opts.jsonOut) {
      json({ action: "installed", target, from: currentRaw, to: latestRaw, refreshed });
    } else {
      out("");
      out(c.ok(`✓ Installed v${latestRaw}.`));
      if (refreshed > 0) out(c.dim(`  Refreshed ${refreshed} install entr${refreshed === 1 ? "y" : "ies"} (skill / MCP).`));
      out(c.dim("  Restart `folio serve` (if running) and reconnect any MCP client to pick it up."));
    }
    return 0;
  } catch (e: any) {
    err(c.err(`✗ Update failed: ${e?.message ?? e}`));
    return 1;
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

function runCmd(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}`));
    });
  });
}
