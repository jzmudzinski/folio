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
import { check, claudeCodePaths, mcpCommand, skillSourcePath } from "../install/claude-code";
import { bundledSkillsDir } from "../../core/config";
import pkg from "../../../package.json" with { type: "json" };

export interface DoctorOptions {
  jsonOut?: boolean;
}

interface DoctorReport {
  folio_version: string;
  binary: string;
  bundled_skills_dir: string;
  skill_source: string;
  mcp_command: { command: string; args: string[] };
  claude_code: ReturnType<typeof check>;
  warnings: { level: "warn" | "error"; message: string }[];
  conflicts: { kind: string; detail: string }[];
}

export async function doctorCmd(opts: DoctorOptions = {}): Promise<number> {
  const paths = claudeCodePaths();
  const cc = check(paths);
  const warnings: DoctorReport["warnings"] = [];
  const conflicts: DoctorReport["conflicts"] = [];

  // ── Skill source on disk ──
  const skillSrc = skillSourcePath();
  if (!existsSync(skillSrc)) {
    warnings.push({ level: "error", message: `bundled skill missing at ${skillSrc} — Folio install is incomplete.` });
  }

  // ── Skill symlink state ──
  switch (cc.skill.state) {
    case "ok":
      break;
    case "missing":
      // Not an error — just means skill is not installed for Claude Code.
      break;
    case "wrong-target":
      warnings.push({
        level: "warn",
        message: cc.skill.installedAt
          ? `Skill symlink ${cc.skill.installedAt} points elsewhere (${cc.skill.currentTarget ?? "non-symlink"}); run \`folio install\` to refresh.`
          : `Skill expected at ${cc.skill.expected}; run \`folio install\`.`,
      });
      break;
    case "stale":
      warnings.push({ level: "warn", message: `Skill symlink target ${cc.skill.expected} does not exist on disk.` });
      break;
  }

  // ── MCP entries ──
  for (const e of cc.mcp.entries) {
    if (e.state === "stale") {
      warnings.push({
        level: "warn",
        message: `MCP entry in ${paths.configJson} for scope ${e.scope} points to ${e.command} which differs from this binary (${cc.mcp.expectedCommand}). Run \`folio install --scope ${e.scope}\` to refresh.`,
      });
    }
  }

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
  out("");
  out(c.bold("Claude Code"));
  out(`  skill: ${formatSkillState(cc.skill)}`);
  if (cc.mcp.entries.length === 0) {
    out(`  mcp:   ${c.dim("(no entries)")}`);
  } else {
    out(`  mcp:`);
    for (const e of cc.mcp.entries) {
      const tag = e.state === "ok" ? c.ok("ok") : c.warn("stale");
      out(`    [${tag}] ${e.scope}`);
      out(`           ${c.dim("→ " + e.command)}`);
    }
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

function formatSkillState(s: ReturnType<typeof check>["skill"]): string {
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
