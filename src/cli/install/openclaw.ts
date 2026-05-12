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
import { existsSync, mkdirSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { readJsonConfig } from "./json-config";
import { skillSourcePath, mcpCommand, escapePointer } from "./claude-code";
import type {
  CheckReport,
  InstallOptions,
  InstallPlan,
  PlanAction,
  UninstallOptions,
} from "./types";

const SKILL_NAME = "folio";

export interface OpenclawPaths {
  home: string;
  openclawDir: string;       // ~/.openclaw
  workspaceSkills: string;   // ~/.openclaw/workspace/skills
  skillLink: string;         // ~/.openclaw/workspace/skills/folio
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
    configJson: join(openclawDir, "openclaw.json"),
  };
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

  // ── Skill symlink ──
  if (wantSkill) {
    const src = skillSourcePath();
    if (!existsSync(src)) {
      warnings.push(`Skill source missing at ${src} — Folio install is incomplete.`);
    } else {
      const dst = paths.skillLink;
      if (isSymlink(dst)) {
        const current = readlinkSafe(dst);
        if (current === src) {
          actions.push({ kind: "noop", reason: `skill already linked → ${src}` });
        } else {
          actions.push({ kind: "rmSymlink", dst, currentTarget: current, reason: "skill symlink points elsewhere; will retarget" });
          actions.push({ kind: "symlink", src, dst, reason: "create skill symlink" });
        }
      } else if (existsSync(dst)) {
        warnings.push(`${dst} exists and is not a symlink; refusing to overwrite. Move it aside and re-run.`);
      } else {
        actions.push({ kind: "symlink", src, dst, reason: "create skill symlink" });
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
      actions.push({ kind: "rmSymlink", dst, currentTarget: current, reason: "remove skill symlink" });
    } else if (existsSync(dst)) {
      warnings.push(`${dst} exists but is not a symlink; leaving alone.`);
    } else {
      actions.push({ kind: "noop", reason: "skill symlink already absent" });
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
    const current = readlinkSafe(link);
    if (current === expected) {
      skill = {
        expected,
        installedAt: link,
        currentTarget: current,
        state: existsSync(expected) ? "ok" : "stale",
        note: existsSync(expected) ? undefined : "symlink target does not exist",
      };
    } else {
      skill = { expected, installedAt: link, currentTarget: current, state: "wrong-target" };
    }
  } else if (existsSync(link)) {
    skill = { expected, installedAt: link, currentTarget: null, state: "wrong-target", note: "exists but is not a symlink" };
  } else {
    skill = { expected, installedAt: null, currentTarget: null, state: "missing" };
  }

  const entries: { scope: string; command: string; state: "ok" | "stale" }[] = [];
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
  }

  return {
    target: "openclaw",
    skill,
    mcp: { entries, expectedCommand: command },
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
