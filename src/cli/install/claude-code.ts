// Claude Code installer.
//
// Two things to install/uninstall, independently:
//   1. SKILL — symlink ~/.claude/skills/folio → <bundledSkillsDir>/folio
//      Folio's skill teaches an agent the create/get/search workflow + theme
//      and stylebook conventions. Auto-loaded by Claude Code on session start.
//   2. MCP   — entry in ~/.claude.json projects[<scope>].mcpServers.folio
//      Per-project scope mirrors how Claude Code already stores MCP config.
//      The command points to the folio-mcp binary (compiled mode) or the
//      `bun bin/folio-mcp.ts` invocation (dev mode).
//
// Both operations are idempotent: a Plan generated against current state only
// includes actions that change something. Re-running `folio install` after a
// successful install yields a noop plan.

import { homedir } from "node:os";
import { join, dirname, isAbsolute, resolve } from "node:path";
import { existsSync, mkdirSync, lstatSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { bundledSkillsDir } from "../../core/config";
import { mutateJsonConfig, readJsonConfig } from "./json-config";
import type {
  ApplyReport,
  CheckReport,
  InstallOptions,
  InstallPlan,
  PlanAction,
  UninstallOptions,
} from "./types";

const SKILL_NAME = "folio";

export interface ClaudeCodePaths {
  home: string;
  claudeDir: string;       // ~/.claude
  skillsDir: string;       // ~/.claude/skills
  skillLink: string;       // ~/.claude/skills/folio
  configJson: string;      // ~/.claude.json
}

export function claudeCodePaths(homeOverride?: string): ClaudeCodePaths {
  const home = homeOverride ?? process.env.HOME ?? homedir();
  const claudeDir = join(home, ".claude");
  return {
    home,
    claudeDir,
    skillsDir: join(claudeDir, "skills"),
    skillLink: join(claudeDir, "skills", SKILL_NAME),
    configJson: join(home, ".claude.json"),
  };
}

/**
 * Where the skill lives on disk for this Folio binary. In compiled mode this is
 * a stable path next to the binary; in dev mode it's the repo's skills/folio.
 */
export function skillSourcePath(): string {
  return join(bundledSkillsDir(), SKILL_NAME);
}

/**
 * MCP command to invoke. In compiled mode: the `folio-mcp` binary next to the
 * `folio` binary. In dev mode: bun + absolute path to bin/folio-mcp.ts.
 */
export function mcpCommand(): { command: string; args: string[] } {
  const execDir = dirname(process.execPath);
  const compiledMcp = join(execDir, "folio-mcp");
  if (existsSync(compiledMcp)) {
    return { command: compiledMcp, args: [] };
  }
  // Dev fallback: bun runs bin/folio-mcp.ts from repo root.
  const devEntry = resolve(join(import.meta.dir, "..", "..", "..", "bin", "folio-mcp.ts"));
  return { command: process.execPath, args: [devEntry] };
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

// ───── PLAN ────────────────────────────────────────────────────────────────

export function planInstall(opts: InstallOptions, paths = claudeCodePaths()): InstallPlan {
  const actions: PlanAction[] = [];
  const warnings: string[] = [];
  const wantSkill = opts.skill !== false;
  const wantMcp = opts.mcp !== false;

  if (!wantSkill && !wantMcp) {
    warnings.push("Both --skill-only and --mcp-only suppressed; nothing to do.");
  }

  // ── Skill ──
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
  }

  // ── MCP ──
  if (wantMcp) {
    const scope = opts.scope ?? process.cwd();
    const { command, args } = mcpCommand();
    const cfg = readJsonConfig<any>(paths.configJson);
    const existing = cfg?.projects?.[scope]?.mcpServers?.folio;
    const desired = { type: "stdio", command, args, env: {} };
    if (existing && shallowEqualMcp(existing, desired)) {
      actions.push({ kind: "noop", reason: `MCP already configured for ${scope}` });
    } else {
      actions.push({
        kind: "writeJson",
        file: paths.configJson,
        jsonPointer: `/projects/${escapePointer(scope)}/mcpServers/folio`,
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

  return { target: "claude-code", actions, warnings };
}

export function planUninstall(opts: UninstallOptions, paths = claudeCodePaths()): InstallPlan {
  const actions: PlanAction[] = [];
  const warnings: string[] = [];
  const wantSkill = opts.skill !== false;
  const wantMcp = opts.mcp !== false;

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
  }

  if (wantMcp) {
    const cfg = readJsonConfig<any>(paths.configJson);
    const projects = cfg?.projects ?? {};
    const scopes = opts.allScopes
      ? Object.keys(projects).filter((s) => projects[s]?.mcpServers?.folio)
      : [opts.scope ?? process.cwd()];
    let touched = 0;
    for (const scope of scopes) {
      const existing = projects?.[scope]?.mcpServers?.folio;
      if (!existing) continue;
      actions.push({
        kind: "deleteJson",
        file: paths.configJson,
        jsonPointer: `/projects/${escapePointer(scope)}/mcpServers/folio`,
        before: existing,
        reason: `remove MCP entry from ${scope}`,
      });
      touched++;
    }
    if (touched === 0) {
      actions.push({ kind: "noop", reason: "no MCP entries to remove" });
    }
  }

  return { target: "claude-code", actions, warnings };
}

// ───── APPLY ───────────────────────────────────────────────────────────────
//
// Target-agnostic: parent dirs are inferred from each action's path. The
// optional `paths` parameter is kept for back-compat (some callers pass
// claudeCodePaths() but it's no longer consulted; openclaw and any future
// target benefit equally).

export function applyPlan(plan: InstallPlan, _paths?: unknown): ApplyReport {
  void _paths;
  const report: ApplyReport = { target: plan.target, applied: [], skipped: [], errors: [] };

  for (const a of plan.actions) {
    try {
      switch (a.kind) {
        case "noop":
          report.skipped.push(a);
          break;
        case "symlink":
          ensureDir(dirname(a.dst));
          symlinkSync(a.src, a.dst);
          report.applied.push(a);
          break;
        case "rmSymlink":
          if (isSymlink(a.dst)) unlinkSync(a.dst);
          report.applied.push(a);
          break;
        case "writeJson":
          ensureDir(dirname(a.file));
          mutateJsonConfig(a.file, (cfg: any) => {
            setByPointer(cfg, a.jsonPointer, a.after);
          });
          report.applied.push(a);
          break;
        case "deleteJson":
          ensureDir(dirname(a.file));
          mutateJsonConfig(a.file, (cfg: any) => {
            deleteByPointer(cfg, a.jsonPointer);
          });
          report.applied.push(a);
          break;
      }
    } catch (e: any) {
      report.errors.push({ action: a, message: e?.message ?? String(e) });
    }
  }
  return report;
}

// ───── CHECK ───────────────────────────────────────────────────────────────

export function check(paths = claudeCodePaths()): CheckReport {
  const expected = skillSourcePath();
  const { command } = mcpCommand();

  const link = paths.skillLink;
  let skill: CheckReport["skill"];
  if (isSymlink(link)) {
    const current = readlinkSafe(link);
    if (current === expected) {
      skill = { expected, installedAt: link, currentTarget: current, state: existsSync(expected) ? "ok" : "stale", note: existsSync(expected) ? undefined : "symlink target does not exist" };
    } else {
      skill = { expected, installedAt: link, currentTarget: current, state: "wrong-target" };
    }
  } else if (existsSync(link)) {
    skill = { expected, installedAt: link, currentTarget: null, state: "wrong-target", note: "exists but is not a symlink" };
  } else {
    skill = { expected, installedAt: null, currentTarget: null, state: "missing" };
  }

  const cfg = readJsonConfig<any>(paths.configJson);
  const projects = cfg?.projects ?? {};
  const entries: { scope: string; command: string; state: "ok" | "stale" }[] = [];
  for (const scope of Object.keys(projects)) {
    const entry = projects[scope]?.mcpServers?.folio;
    if (!entry) continue;
    entries.push({
      scope,
      command: entry.command,
      state: entry.command === command && existsSync(entry.command) ? "ok" : "stale",
    });
  }

  return {
    target: "claude-code",
    skill,
    mcp: { entries, expectedCommand: command },
  };
}

// ───── Refresh after `folio update` ────────────────────────────────────────
//
// Called from updateCmd after a new binary is installed. Re-runs install in
// idempotent mode for any previously-installed scope so the MCP `command:`
// path catches up to the new binary location (in case install dir changed).

export function refreshAfterUpdate(paths = claudeCodePaths()): { refreshed: number; actions: PlanAction[] } {
  const report = check(paths);
  const actions: PlanAction[] = [];

  // Refresh skill symlink if present (even if currently fine, this is cheap
  // and self-healing).
  if (report.skill.state !== "missing" && existsSync(skillSourcePath())) {
    const plan = planInstall({ target: "claude-code", skill: true, mcp: false }, paths);
    applyPlan(plan, paths);
    actions.push(...plan.actions.filter((a) => a.kind !== "noop"));
  }

  // Refresh each MCP scope.
  for (const entry of report.mcp.entries) {
    const plan = planInstall({ target: "claude-code", skill: false, mcp: true, scope: entry.scope }, paths);
    applyPlan(plan, paths);
    actions.push(...plan.actions.filter((a) => a.kind !== "noop"));
  }

  return { refreshed: actions.length, actions };
}

// ───── helpers ─────────────────────────────────────────────────────────────

function shallowEqualMcp(a: any, b: any): boolean {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.command !== b.command) return false;
  const aa = Array.isArray(a.args) ? a.args : [];
  const ba = Array.isArray(b.args) ? b.args : [];
  if (aa.length !== ba.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== ba[i]) return false;
  return true;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Minimal JSON Pointer impl — only ~{0,1} escape (RFC 6901). Scope paths can
// contain slashes, so we escape '/' → '~1' before splitting.
export function escapePointer(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

function unescapeToken(s: string): string {
  return s.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function setByPointer(obj: any, pointer: string, value: unknown): void {
  if (!pointer.startsWith("/")) throw new Error(`bad pointer: ${pointer}`);
  const parts = pointer.slice(1).split("/").map(unescapeToken);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]!] = value;
}

export function deleteByPointer(obj: any, pointer: string): void {
  if (!pointer.startsWith("/")) throw new Error(`bad pointer: ${pointer}`);
  const parts = pointer.slice(1).split("/").map(unescapeToken);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]!;
    if (cur == null || typeof cur !== "object" || !(k in cur)) return;
    cur = cur[k];
  }
  if (cur && typeof cur === "object") delete cur[parts[parts.length - 1]!];
}
