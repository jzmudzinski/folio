// `folio doctor` — diagnostic. Shows where the skill + MCP are wired in for
// every supported target, and warns about:
//   - missing or broken skill symlinks
//   - MCP `command:` paths that don't exist on disk
//   - multiple folio binaries on $PATH (potential version skew)
//
// Read-only; no mutations. Exit code 0 = healthy, 1 = at least one warning.

import { existsSync, readlinkSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { c, out, err, json } from "../io";
import { check as checkClaudeCode, claudeCodePaths, mcpCommand, skillSourcePath } from "../install/claude-code";
import { check as checkOpenclaw, openclawPaths, isOpenclawPresent } from "../install/openclaw";
import { bundledSkillsDir } from "../../core/config";
import pkg from "../../../package.json" with { type: "json" };

type CheckResult = ReturnType<typeof checkClaudeCode>;

export interface DoctorOptions {
  jsonOut?: boolean;
}

interface DoctorReport {
  folio_version: string;
  binary: string;
  bundled_skills_dir: string;
  skill_source: string;
  mcp_command: { command: string; args: string[] };
  claude_code: CheckResult;
  openclaw: CheckResult | { present: false };
  warnings: { level: "warn" | "error"; message: string }[];
  conflicts: { kind: string; detail: string }[];
}

export async function doctorCmd(opts: DoctorOptions = {}): Promise<number> {
  const ccPaths = claudeCodePaths();
  const ocPaths = openclawPaths();
  const cc = checkClaudeCode(ccPaths);
  const ocPresent = isOpenclawPresent(ocPaths);
  const oc = ocPresent ? checkOpenclaw(ocPaths) : null;
  const warnings: DoctorReport["warnings"] = [];
  const conflicts: DoctorReport["conflicts"] = [];

  // ── Skill source on disk ──
  const skillSrc = skillSourcePath();
  if (!existsSync(skillSrc)) {
    warnings.push({ level: "error", message: `bundled skill missing at ${skillSrc} — Folio install is incomplete.` });
  }

  // ── Per-target skill + MCP analysis ──
  function analyzeTarget(label: string, cr: CheckResult, refreshHint: string): void {
    switch (cr.skill.state) {
      case "ok":
      case "missing":
        break;
      case "wrong-target":
        warnings.push({
          level: "warn",
          message: cr.skill.installedAt
            ? `[${label}] skill symlink ${cr.skill.installedAt} points elsewhere (${cr.skill.currentTarget ?? "non-symlink"}); ${refreshHint}`
            : `[${label}] skill expected at ${cr.skill.expected}; ${refreshHint}`,
        });
        break;
      case "stale":
        warnings.push({ level: "warn", message: `[${label}] skill symlink target ${cr.skill.expected} does not exist on disk.` });
        break;
    }
    for (const e of cr.mcp.entries) {
      if (e.state === "stale") {
        warnings.push({
          level: "warn",
          message: `[${label}] MCP entry for scope ${e.scope} points to ${e.command}; differs from this binary (${cr.mcp.expectedCommand}). ${refreshHint}`,
        });
      }
    }
  }
  analyzeTarget("claude-code", cc, "run `folio install --target claude-code` to refresh.");
  if (oc) analyzeTarget("openclaw", oc, "run `folio install --target openclaw` to refresh.");

  // ── Conflicts: multiple folio binaries on $PATH ──
  const found = findFolioBinariesOnPath();
  if (found.length > 1) {
    conflicts.push({
      kind: "multiple-binaries",
      detail: `Multiple \`folio\` on PATH: ${found.join(", ")}. Last \`folio install\` wins; consider removing the older one.`,
    });
    warnings.push({ level: "warn", message: `Multiple folio binaries detected — see conflicts.` });
  }

  const report: DoctorReport = {
    folio_version: pkg.version,
    binary: process.execPath,
    bundled_skills_dir: bundledSkillsDir(),
    skill_source: skillSrc,
    mcp_command: mcpCommand(),
    claude_code: cc,
    openclaw: oc ?? { present: false },
    warnings,
    conflicts,
  };

  if (opts.jsonOut) {
    json(report);
    return warnings.some((w) => w.level === "error") ? 1 : 0;
  }

  out(c.bold(`Folio doctor — v${pkg.version}`));
  out(c.dim(`  binary:         ${process.execPath}`));
  out(c.dim(`  skill source:   ${skillSrc}${existsSync(skillSrc) ? "" : c.err(" (MISSING)")}`));
  out(c.dim(`  mcp command:    ${mcpCommand().command} ${mcpCommand().args.join(" ")}`));

  printTargetSection("Claude Code", cc);
  if (oc) {
    printTargetSection("OpenClaw", oc);
  } else {
    out("");
    out(c.bold("OpenClaw"));
    out(c.dim("  not detected (no ~/.openclaw/openclaw.json)"));
  }

  if (conflicts.length > 0) {
    out("");
    out(c.bold("Conflicts"));
    for (const k of conflicts) out(c.warn(`  ! ${k.kind}: ${k.detail}`));
  }

  if (warnings.length > 0) {
    out("");
    out(c.bold("Warnings"));
    for (const w of warnings) {
      const sym = w.level === "error" ? c.err("✗") : c.warn("!");
      out(`  ${sym} ${w.message}`);
    }
    return 1;
  }
  out("");
  out(c.ok("✓ No issues."));
  return 0;
}

function printTargetSection(title: string, cr: CheckResult): void {
  out("");
  out(c.bold(title));
  out(`  skill: ${formatSkillState(cr.skill)}`);
  if (cr.mcp.entries.length === 0) {
    out(`  mcp:   ${c.dim("(no entries)")}`);
  } else {
    out(`  mcp:`);
    for (const e of cr.mcp.entries) {
      const tag = e.state === "ok" ? c.ok("ok") : c.warn("stale");
      out(`    [${tag}] ${e.scope}`);
      out(`           ${c.dim("→ " + e.command)}`);
    }
  }
}

function formatSkillState(s: CheckResult["skill"]): string {
  switch (s.state) {
    case "ok":
      return `${c.ok("ok")} ${c.dim(s.installedAt + " → " + s.currentTarget)}`;
    case "missing":
      return `${c.dim("not installed")}`;
    case "stale":
      return `${c.warn("stale")} ${c.dim(s.installedAt + " → " + s.currentTarget + (s.note ? ` (${s.note})` : ""))}`;
    case "wrong-target":
      return `${c.warn("wrong-target")} ${c.dim((s.installedAt ?? "") + " → " + (s.currentTarget ?? "") + (s.note ? ` (${s.note})` : ""))}`;
  }
}

function findFolioBinariesOnPath(): string[] {
  const PATH = process.env.PATH ?? "";
  const dirs = PATH.split(":").filter(Boolean);
  const found: string[] = [];
  for (const d of dirs) {
    const candidate = `${d}/folio`;
    if (existsSync(candidate)) {
      try {
        const st = lstatSync(candidate);
        const resolved = st.isSymbolicLink() ? readlinkSync(candidate) : candidate;
        if (!found.includes(candidate)) found.push(candidate);
        // Ignore `resolved` for now — listing the PATH entry is more useful than
        // listing the symlink target (which collapses brew + manual installs).
        void resolved;
      } catch {
        // ignore
      }
    }
  }
  return found;
}

// `which -a folio` would be cleaner on Unix; we keep it portable to avoid a
// shell dep in compiled Bun binaries. spawnSync stays imported so tests can
// shim it if we ever want to mock PATH lookup; currently unused.
void spawnSync;
