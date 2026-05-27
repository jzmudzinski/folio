// OpenClaw installer.
//
// Mirror of claude-code.ts with three OpenClaw-specific differences:
//   1. Skill path is ~/.openclaw/workspace/skills/<name>/ (auto-loaded by
//      OpenClaw from that directory).
//   2. MCP config lives in ~/.openclaw/openclaw.json under
//      /mcp/servers/<name>. Global — no per-project scope (unlike Claude
//      Code where mcpServers is nested under projects[<path>]).
//   3. MCP entry shape is {command, args, env} — no `type: "stdio"` field.
//
// Also handles cleanup of stale entries from skills.load.extraDirs (where
// a dev-mode install may have registered the repo path explicitly).
//
// All operations idempotent: a Plan generated against current state only
// includes actions that change something.

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, lstatSync, readlinkSync, readFileSync } from "node:fs";
import { readJsonConfig } from "./json-config";
import { skillSourcePath, mcpCommand, escapePointer, VERSION_MARKER } from "./claude-code";
import { bundledHooksDir } from "../../core/config";
import pkg from "../../../package.json" with { type: "json" };
import type {
  CheckReport,
  InstallOptions,
  InstallPlan,
  PlanAction,
  UninstallOptions,
} from "./types";

const SKILL_NAME = "folio";
const HOOK_NAME = "folio-event-watcher";

// OpenClaw skills/hooks are installed as COPIED directories, not symlinks:
// its loader rejects any whose realpath escapes the workspace root (a
// supply-chain "symlink-escape" guard), and Folio's bundle lives in
// /opt/folio/<ver> — outside the root — so a symlink is silently skipped and
// the skill never loads. A copy is the only thing OpenClaw will accept. The
// copied dir is stamped with VERSION_MARKER (.folio-version) so reinstall /
// `folio update` can detect version drift and re-copy.
const FOLIO_VERSION: string = pkg.version;

/** A real (non-symlink) directory at p. lstat doesn't follow links, so a
 *  symlink-to-dir reports isDirectory() === false here. */
function isRealDir(p: string): boolean {
  try { return lstatSync(p).isDirectory(); } catch { return false; }
}

/** Folio version recorded in a copied skill/hook dir's marker, or null. */
function markerVersion(dir: string): string | null {
  try { return readFileSync(join(dir, VERSION_MARKER), "utf-8").trim() || null; } catch { return null; }
}

export interface OpenclawPaths {
  home: string;
  openclawDir: string;       // ~/.openclaw
  workspaceSkills: string;   // ~/.openclaw/workspace/skills
  skillLink: string;         // ~/.openclaw/workspace/skills/folio
  hooksDir: string;          // ~/.openclaw/hooks
  hookLink: string;          // ~/.openclaw/hooks/folio-event-watcher
  configJson: string;        // ~/.openclaw/openclaw.json
}

export function openclawPaths(homeOverride?: string): OpenclawPaths {
  const home = homeOverride ?? process.env.HOME ?? homedir();
  const openclawDir = join(home, ".openclaw");
  return {
    home,
    openclawDir,
    workspaceSkills: join(openclawDir, "workspace", "skills"),
    skillLink: join(openclawDir, "workspace", "skills", SKILL_NAME),
    hooksDir: join(openclawDir, "hooks"),
    hookLink: join(openclawDir, "hooks", HOOK_NAME),
    configJson: join(openclawDir, "openclaw.json"),
  };
}

/** v0.21.0+: source path of the bundled folio-event-watcher OpenClaw hook.
 *  Copied into ~/.openclaw/hooks/<HOOK_NAME>/ by `folio install` (copy, not
 *  symlink — same escape-guard reason as the skill). */
export function hookSourcePath(): string {
  return join(bundledHooksDir(), "openclaw", HOOK_NAME);
}

/** True when OpenClaw appears to be installed on this machine. */
export function isOpenclawPresent(paths = openclawPaths()): boolean {
  return existsSync(paths.configJson);
}

function readlinkSafe(p: string): string | null {
  try {
    return readlinkSync(p);
  } catch {
    return null;
  }
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * True when this extraDirs entry points at a folio skill folder (either the
 * bundled one or a sibling install). We strip these on install because the
 * conventional ~/.openclaw/workspace/skills/folio symlink supersedes them.
 */
function isFolioExtraDirEntry(entry: unknown): boolean {
  if (typeof entry !== "string") return false;
  return /\/skills\/folio\/?$/.test(entry);
}

// ───── PLAN ────────────────────────────────────────────────────────────────

export function planInstall(opts: InstallOptions, paths = openclawPaths()): InstallPlan {
  const actions: PlanAction[] = [];
  const warnings: string[] = [];
  const wantSkill = opts.skill !== false;
  const wantMcp = opts.mcp !== false;

  if (!isOpenclawPresent(paths)) {
    warnings.push(
      `OpenClaw not detected (expected ${paths.configJson}). Install OpenClaw first, or skip this target.`,
    );
    return { target: "openclaw", actions, warnings };
  }

  // ── Skill (copied dir, NOT a symlink — see FOLIO_VERSION note above) ──
  if (wantSkill) {
    const src = skillSourcePath();
    if (!existsSync(src)) {
      warnings.push(`Skill source missing at ${src} — Folio install is incomplete.`);
    } else {
      const dst = paths.skillLink;
      if (isRealDir(dst) && markerVersion(dst) === FOLIO_VERSION && existsSync(join(dst, "SKILL.md"))) {
        actions.push({ kind: "noop", reason: `skill already installed (copy, v${FOLIO_VERSION})` });
      } else {
        const reason = isSymlink(dst)
          ? "replace legacy skill symlink with a copied dir (OpenClaw rejects symlink-escape)"
          : isRealDir(dst)
            ? `refresh copied skill (${markerVersion(dst) ?? "unversioned"} → v${FOLIO_VERSION})`
            : "copy skill into workspace";
        actions.push({ kind: "copyDir", src, dst, version: FOLIO_VERSION, reason });
      }
    }

    // ── extraDirs cleanup ──
    // The workspace skills dir is auto-loaded; any path in skills.load.extraDirs
    // that points at a folio skill folder is now redundant (and probably stale,
    // e.g. dev-install repo paths). Filter them out.
    const cfg = readJsonConfig<any>(paths.configJson);
    const extras: unknown[] = Array.isArray(cfg?.skills?.load?.extraDirs)
      ? cfg.skills.load.extraDirs
      : [];
    const filtered = extras.filter((p) => !isFolioExtraDirEntry(p));
    if (filtered.length !== extras.length) {
      actions.push({
        kind: "writeJson",
        file: paths.configJson,
        jsonPointer: "/skills/load/extraDirs",
        before: extras,
        after: filtered,
        reason: `remove ${extras.length - filtered.length} stale folio skill path(s) from skills.load.extraDirs`,
      });
    }
  }

  // ── Hook (v0.21.0+) — folio-event-watcher ──
  // Surfaces new Folio events (iteration picks, variants, todo state, pins)
  // into the agent's context on every user message. See
  // docs/openclaw-integration.md for the architecture rationale.
  //
  // Gated by `wantSkill` because conceptually the hook and the skill are
  // one package — the skill tells the agent what events MEAN, the hook
  // delivers them. Users opting out of the skill with --skill=false
  // presumably don't want the hook either.
  if (wantSkill) {
    const src = hookSourcePath();
    if (!existsSync(src)) {
      warnings.push(`Hook source missing at ${src} — Folio install bundle is incomplete.`);
    } else {
      const dst = paths.hookLink;
      // Same copy treatment as the skill — OpenClaw applies the escape guard to
      // hook paths too, so a symlink into /opt/folio won't load.
      if (isRealDir(dst) && markerVersion(dst) === FOLIO_VERSION) {
        actions.push({ kind: "noop", reason: `hook already installed (copy, v${FOLIO_VERSION})` });
      } else {
        const reason = isSymlink(dst)
          ? "replace legacy hook symlink with a copied dir"
          : isRealDir(dst)
            ? `refresh copied hook (${markerVersion(dst) ?? "unversioned"} → v${FOLIO_VERSION})`
            : "copy hook into workspace";
        actions.push({ kind: "copyDir", src, dst, version: FOLIO_VERSION, reason });
      }
    }

    // Enable in OpenClaw config. The hooks block lives under
    // hooks.internal.entries.<name> per the OpenClaw hook docs. We patch
    // just that key — other hooks (or other top-level keys) untouched.
    const cfg = readJsonConfig<any>(paths.configJson);
    const existingHookCfg = cfg?.hooks?.internal?.entries?.[HOOK_NAME];
    const desiredHookCfg = { enabled: true };
    const same = existingHookCfg && typeof existingHookCfg === "object" && existingHookCfg.enabled === true;
    if (same) {
      actions.push({ kind: "noop", reason: "hook already enabled in openclaw.json" });
    } else {
      actions.push({
        kind: "writeJson",
        file: paths.configJson,
        jsonPointer: `/hooks/internal/entries/${escapePointer(HOOK_NAME)}`,
        before: existingHookCfg ?? null,
        after: desiredHookCfg,
        reason: existingHookCfg ? "hook entry differs; will update enabled flag" : "register hook in openclaw.json",
      });
    }
  }

  // ── MCP ──
  if (wantMcp) {
    const cfg = readJsonConfig<any>(paths.configJson);
    const existing = cfg?.mcp?.servers?.folio;
    const { command, args } = mcpCommand();
    // Preserve any env the user set (e.g. FOLIO_HOME pointing somewhere
    // non-default). On fresh install, start with empty env — Folio defaults
    // to ~/Folio in that case.
    const env = (existing && typeof existing.env === "object" && existing.env) ? existing.env : {};
    const desired = { command, args, env };
    if (existing && shallowEqualMcp(existing, desired)) {
      actions.push({ kind: "noop", reason: "MCP already configured" });
    } else {
      actions.push({
        kind: "writeJson",
        file: paths.configJson,
        jsonPointer: "/mcp/servers/folio",
        before: existing ?? null,
        after: desired,
        reason: existing ? "MCP entry differs; will update" : "add MCP entry",
      });
      if (command === process.execPath && args.length > 0) {
        warnings.push(
          "Detected dev-mode install: MCP command will be `bun bin/folio-mcp.ts` — fragile if the repo moves. " +
            "For production use, run `folio install` from a compiled binary instead.",
        );
      }
    }
  }

  return { target: "openclaw", actions, warnings };
}

export function planUninstall(opts: UninstallOptions, paths = openclawPaths()): InstallPlan {
  const actions: PlanAction[] = [];
  const warnings: string[] = [];
  const wantSkill = opts.skill !== false;
  const wantMcp = opts.mcp !== false;

  if (!isOpenclawPresent(paths)) {
    warnings.push(`OpenClaw not detected (expected ${paths.configJson}); nothing to uninstall.`);
    return { target: "openclaw", actions, warnings };
  }

  if (wantSkill) {
    const dst = paths.skillLink;
    if (isSymlink(dst)) {
      const current = readlinkSafe(dst);
      actions.push({ kind: "rmSymlink", dst, currentTarget: current, reason: "remove legacy skill symlink" });
    } else if (isRealDir(dst)) {
      if (markerVersion(dst) !== null) {
        actions.push({ kind: "rmDir", dst, reason: "remove copied skill dir" });
      } else {
        warnings.push(`${dst} is a directory without a Folio marker; leaving alone (not created by folio install).`);
      }
    } else if (existsSync(dst)) {
      warnings.push(`${dst} exists but is neither a symlink nor a directory; leaving alone.`);
    } else {
      actions.push({ kind: "noop", reason: "skill already absent" });
    }

    // Also clear any extraDirs entries that point at folio skill folders —
    // mirror of the install-time cleanup. Users who manually added a non-
    // matching path (e.g. ~/work/folio-fork/skills/folio) get caught too;
    // accepted trade-off (heuristic strong but predictable: anything ending
    // in /skills/folio is treated as a folio entry).
    const cfg = readJsonConfig<any>(paths.configJson);
    const extras: unknown[] = Array.isArray(cfg?.skills?.load?.extraDirs)
      ? cfg.skills.load.extraDirs
      : [];
    const filtered = extras.filter((p) => !isFolioExtraDirEntry(p));
    if (filtered.length !== extras.length) {
      actions.push({
        kind: "writeJson",
        file: paths.configJson,
        jsonPointer: "/skills/load/extraDirs",
        before: extras,
        after: filtered,
        reason: `remove ${extras.length - filtered.length} folio skill path(s) from skills.load.extraDirs`,
      });
    }
  }

  if (wantSkill) {
    // Mirror of install: hook lifecycle follows skill flag. Remove symlink
    // and config entry both. If the symlink isn't a symlink, leave alone
    // (don't accidentally remove a manually-installed hook directory).
    const dst = paths.hookLink;
    if (isSymlink(dst)) {
      const current = readlinkSafe(dst);
      actions.push({ kind: "rmSymlink", dst, currentTarget: current, reason: "remove legacy hook symlink" });
    } else if (isRealDir(dst)) {
      if (markerVersion(dst) !== null) {
        actions.push({ kind: "rmDir", dst, reason: "remove copied hook dir" });
      } else {
        warnings.push(`${dst} is a directory without a Folio marker; leaving alone (not created by folio install).`);
      }
    } else if (existsSync(dst)) {
      warnings.push(`${dst} exists but is neither a symlink nor a directory; leaving alone.`);
    } else {
      actions.push({ kind: "noop", reason: "hook already absent" });
    }

    const cfg = readJsonConfig<any>(paths.configJson);
    const existingHookCfg = cfg?.hooks?.internal?.entries?.[HOOK_NAME];
    if (existingHookCfg) {
      actions.push({
        kind: "deleteJson",
        file: paths.configJson,
        jsonPointer: `/hooks/internal/entries/${escapePointer(HOOK_NAME)}`,
        before: existingHookCfg,
        reason: "remove hook entry from openclaw.json",
      });
    }
  }

  if (wantMcp) {
    const cfg = readJsonConfig<any>(paths.configJson);
    const existing = cfg?.mcp?.servers?.folio;
    if (existing) {
      actions.push({
        kind: "deleteJson",
        file: paths.configJson,
        jsonPointer: "/mcp/servers/folio",
        before: existing,
        reason: "remove MCP entry from openclaw.json",
      });
    } else {
      actions.push({ kind: "noop", reason: "no MCP entry to remove" });
    }
  }

  // OpenClaw uninstall has no per-scope wrinkle (no scopes to enumerate).
  // The allScopes flag from UninstallOptions is silently ignored here.
  void opts.allScopes;

  return { target: "openclaw", actions, warnings };
}

// ───── CHECK ───────────────────────────────────────────────────────────────

export function check(paths = openclawPaths()): CheckReport {
  const expected = skillSourcePath();
  const { command } = mcpCommand();

  const link = paths.skillLink;
  let skill: CheckReport["skill"];
  if (isSymlink(link)) {
    // A symlink is the *broken* state now — OpenClaw rejects it (symlink-escape).
    skill = {
      expected, installedAt: link, currentTarget: readlinkSafe(link), state: "wrong-target",
      note: "legacy symlink — OpenClaw rejects it (symlink-escape); re-run install to copy a real dir",
    };
  } else if (isRealDir(link)) {
    const mv = markerVersion(link);
    if (!existsSync(join(link, "SKILL.md"))) {
      skill = { expected, installedAt: link, currentTarget: null, state: "wrong-target", note: "directory present but no SKILL.md" };
    } else if (mv === FOLIO_VERSION) {
      skill = { expected, installedAt: link, currentTarget: null, state: "ok", note: `copy, v${FOLIO_VERSION}` };
    } else {
      skill = {
        expected, installedAt: link, currentTarget: null, state: "stale",
        note: `copied skill is ${mv ? "v" + mv : "unversioned"}; Folio is v${FOLIO_VERSION} — re-run install to refresh`,
      };
    }
  } else if (existsSync(link)) {
    skill = { expected, installedAt: link, currentTarget: null, state: "wrong-target", note: "exists but is not a directory" };
  } else {
    skill = { expected, installedAt: null, currentTarget: null, state: "missing" };
  }

  const entries: { scope: string; command: string; state: "ok" | "stale" }[] = [];
  let hook: CheckReport["hook"];
  if (isOpenclawPresent(paths)) {
    const cfg = readJsonConfig<any>(paths.configJson);
    const entry = cfg?.mcp?.servers?.folio;
    if (entry) {
      entries.push({
        scope: "global",
        command: entry.command,
        state: entry.command === command && existsSync(entry.command) ? "ok" : "stale",
      });
    }

    // ── Hook check (v0.21.0+; copied dir since the symlink-escape fix) ──
    const hookExpected = hookSourcePath();
    const hookLink = paths.hookLink;
    const hookCfg = cfg?.hooks?.internal?.entries?.[HOOK_NAME];
    const enabled = hookCfg && typeof hookCfg === "object" && hookCfg.enabled === true;
    if (isSymlink(hookLink)) {
      hook = {
        name: HOOK_NAME, expected: hookExpected, installedAt: hookLink, currentTarget: readlinkSafe(hookLink),
        state: "wrong-target", note: "legacy symlink — OpenClaw may reject it (symlink-escape); re-run install to copy",
      };
    } else if (isRealDir(hookLink)) {
      const mv = markerVersion(hookLink);
      if (mv !== FOLIO_VERSION) {
        hook = {
          name: HOOK_NAME, expected: hookExpected, installedAt: hookLink, currentTarget: null, state: "stale",
          note: `copied hook is ${mv ? "v" + mv : "unversioned"}; Folio is v${FOLIO_VERSION} — re-run install to refresh`,
        };
      } else if (!enabled) {
        hook = {
          name: HOOK_NAME, expected: hookExpected, installedAt: hookLink, currentTarget: null, state: "disabled",
          note: "copied but disabled in openclaw.json",
        };
      } else {
        hook = { name: HOOK_NAME, expected: hookExpected, installedAt: hookLink, currentTarget: null, state: "ok", note: `copy, v${FOLIO_VERSION}` };
      }
    } else if (existsSync(hookLink)) {
      hook = { name: HOOK_NAME, expected: hookExpected, installedAt: hookLink, currentTarget: null, state: "wrong-target", note: "exists but is not a directory" };
    } else {
      hook = { name: HOOK_NAME, expected: hookExpected, installedAt: null, currentTarget: null, state: "missing" };
    }
  }

  return {
    target: "openclaw",
    skill,
    mcp: { entries, expectedCommand: command },
    hook,
  };
}

// ───── Refresh after `folio update` ────────────────────────────────────────

import { applyPlan } from "./claude-code";

export function refreshAfterUpdate(paths = openclawPaths()): { refreshed: number; actions: PlanAction[] } {
  if (!isOpenclawPresent(paths)) return { refreshed: 0, actions: [] };
  const report = check(paths);
  const actions: PlanAction[] = [];

  if (report.skill.state !== "missing" && existsSync(skillSourcePath())) {
    const plan = planInstall({ target: "openclaw", skill: true, mcp: false }, paths);
    applyPlan(plan);
    actions.push(...plan.actions.filter((a) => a.kind !== "noop"));
  }

  if (report.mcp.entries.length > 0) {
    const plan = planInstall({ target: "openclaw", skill: false, mcp: true }, paths);
    applyPlan(plan);
    actions.push(...plan.actions.filter((a) => a.kind !== "noop"));
  }

  return { refreshed: actions.length, actions };
}

// ───── helpers ─────────────────────────────────────────────────────────────

function shallowEqualMcp(a: any, b: any): boolean {
  if (!a || !b) return false;
  if (a.command !== b.command) return false;
  const aa = Array.isArray(a.args) ? a.args : [];
  const ba = Array.isArray(b.args) ? b.args : [];
  if (aa.length !== ba.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== ba[i]) return false;
  const aenv = a.env && typeof a.env === "object" ? a.env : {};
  const benv = b.env && typeof b.env === "object" ? b.env : {};
  const akeys = Object.keys(aenv).sort();
  const bkeys = Object.keys(benv).sort();
  if (akeys.length !== bkeys.length) return false;
  for (let i = 0; i < akeys.length; i++) {
    if (akeys[i] !== bkeys[i]) return false;
    if (aenv[akeys[i]!] !== benv[bkeys[i]!]) return false;
  }
  return true;
}

// Re-export the JSON pointer escape helper for symmetry with claude-code.ts
// (so callers/tests don't need to know which module owns it).
export { escapePointer };
