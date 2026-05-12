import { c, out, err, json } from "../io";
import { askString, askYesNo } from "../install/prompts";
import { planInstall, applyPlan, claudeCodePaths } from "../install/claude-code";
import type { InstallOptions, InstallPlan, PlanAction } from "../install/types";

export interface InstallCliOptions {
  target?: string;
  skillOnly?: boolean;
  mcpOnly?: boolean;
  scope?: string;
  dryRun?: boolean;
  yes?: boolean;
  jsonOut?: boolean;
}

const SUPPORTED = new Set(["claude-code"]);
// Targets we know about but haven't implemented yet — surface a useful hint
// instead of a generic "unknown target" error.
const FUTURE: Record<string, string> = {
  cursor: "Cursor support is a follow-up; will write .cursor/rules/folio.mdc to the current project.",
  "claude-desktop": "Claude Desktop support is a follow-up — Custom Skills support varies by version.",
  openclaw: "OpenClaw / Ryszard manages its own skill registry; install via the OpenClaw side.",
};

export async function installCmd(opts: InstallCliOptions): Promise<number> {
  const target = (opts.target ?? "claude-code").toLowerCase();

  if (FUTURE[target] && !SUPPORTED.has(target)) {
    err(c.warn(`! ${target}: not yet supported. ${FUTURE[target]}`));
    return 2;
  }
  if (!SUPPORTED.has(target)) {
    err(c.err(`✗ Unknown target: ${target}. Supported: ${[...SUPPORTED].join(", ")}.`));
    return 1;
  }

  if (opts.skillOnly && opts.mcpOnly) {
    err(c.err("✗ --skill-only and --mcp-only are mutually exclusive."));
    return 1;
  }

  // Resolve scope (interactive when missing + not --yes).
  let scope = opts.scope;
  if (!opts.mcpOnly && opts.skillOnly) {
    // skill-only: scope is irrelevant
  } else if (!scope) {
    if (opts.yes || !process.stdin.isTTY) {
      scope = process.cwd();
    } else {
      const proposed = process.cwd();
      out(c.dim(`MCP wiring is per-project in Claude Code (one entry per directory).`));
      scope = await askString(c.bold(`Which project directory should Folio MCP be wired to?`), proposed);
    }
  }

  const installOpts: InstallOptions = {
    target: "claude-code",
    skill: !opts.mcpOnly,
    mcp: !opts.skillOnly,
    scope,
    dryRun: opts.dryRun,
    yes: opts.yes,
    jsonOut: opts.jsonOut,
  };

  const paths = claudeCodePaths();
  const plan = planInstall(installOpts, paths);

  if (opts.jsonOut) {
    if (opts.dryRun) {
      json({ target: plan.target, dry_run: true, plan: serializePlan(plan) });
      return 0;
    }
    const report = applyPlan(plan, paths);
    json({ target: report.target, dry_run: false, plan: serializePlan(plan), applied: report.applied, errors: report.errors });
    return report.errors.length === 0 ? 0 : 1;
  }

  printPlan(plan);

  if (opts.dryRun) {
    out(c.dim("\n(dry-run — no changes written)"));
    return 0;
  }

  if (!hasMutations(plan)) {
    out(c.ok("\n✓ Nothing to do — already installed."));
    return 0;
  }

  if (!opts.yes && process.stdin.isTTY) {
    const proceed = await askYesNo(c.bold("\nApply changes?"), true);
    if (!proceed) {
      out(c.dim("Aborted."));
      return 0;
    }
  }

  const report = applyPlan(plan, paths);
  if (report.errors.length > 0) {
    err(c.err(`\n✗ ${report.errors.length} action(s) failed:`));
    for (const e of report.errors) err(c.err(`  - ${e.message}`));
    return 1;
  }
  out(c.ok(`\n✓ Installed for ${target}.`));
  out(c.dim("  Restart Claude Code to pick up the skill + MCP entry."));
  return 0;
}

function printPlan(plan: InstallPlan): void {
  out(c.bold(`Plan for ${plan.target}:`));
  if (plan.actions.length === 0) {
    out(c.dim("  (no actions)"));
  } else {
    for (const a of plan.actions) out("  " + formatAction(a));
  }
  if (plan.warnings.length > 0) {
    out("");
    for (const w of plan.warnings) err(c.warn(`! ${w}`));
  }
}

function formatAction(a: PlanAction): string {
  switch (a.kind) {
    case "symlink":
      return `${c.cyan("symlink")}    ${a.dst} → ${a.src}  ${c.dim("# " + a.reason)}`;
    case "rmSymlink":
      return `${c.warn("rmlink")}     ${a.dst}  ${c.dim("# " + a.reason + (a.currentTarget ? ` (was → ${a.currentTarget})` : ""))}`;
    case "writeJson":
      return `${c.cyan("write")}      ${a.file} ${c.dim(a.jsonPointer)}  ${c.dim("# " + a.reason)}`;
    case "deleteJson":
      return `${c.warn("delete")}     ${a.file} ${c.dim(a.jsonPointer)}  ${c.dim("# " + a.reason)}`;
    case "noop":
      return `${c.dim("noop")}       ${c.dim(a.reason)}`;
  }
}

function hasMutations(plan: InstallPlan): boolean {
  return plan.actions.some((a) => a.kind !== "noop");
}

function serializePlan(plan: InstallPlan): unknown {
  return {
    target: plan.target,
    warnings: plan.warnings,
    actions: plan.actions.map((a) => ({ ...a })),
  };
}
