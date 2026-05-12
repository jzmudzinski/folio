import { c, out, err, json } from "../io";
import { askYesNo } from "../install/prompts";
import { planUninstall, applyPlan, claudeCodePaths } from "../install/claude-code";
import type { UninstallOptions, InstallPlan, PlanAction } from "../install/types";

export interface UninstallCliOptions {
  target?: string;
  skillOnly?: boolean;
  mcpOnly?: boolean;
  scope?: string;
  allScopes?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  jsonOut?: boolean;
}

const SUPPORTED = new Set(["claude-code"]);

export async function uninstallCmd(opts: UninstallCliOptions): Promise<number> {
  const target = (opts.target ?? "claude-code").toLowerCase();
  if (!SUPPORTED.has(target)) {
    err(c.err(`✗ Unknown target: ${target}. Supported: ${[...SUPPORTED].join(", ")}.`));
    return 1;
  }
  if (opts.skillOnly && opts.mcpOnly) {
    err(c.err("✗ --skill-only and --mcp-only are mutually exclusive."));
    return 1;
  }

  const uOpts: UninstallOptions = {
    target: "claude-code",
    skill: !opts.mcpOnly,
    mcp: !opts.skillOnly,
    scope: opts.scope,
    allScopes: opts.allScopes,
    dryRun: opts.dryRun,
    yes: opts.yes,
    jsonOut: opts.jsonOut,
  };
  if (!uOpts.scope && !uOpts.allScopes && !opts.skillOnly) {
    uOpts.scope = process.cwd();
  }

  const paths = claudeCodePaths();
  const plan = planUninstall(uOpts, paths);

  if (opts.jsonOut) {
    if (opts.dryRun) {
      json({ target: plan.target, dry_run: true, plan: serializePlan(plan) });
      return 0;
    }
    const report = applyPlan(plan, paths);
    json({ target: report.target, dry_run: false, applied: report.applied, errors: report.errors });
    return report.errors.length === 0 ? 0 : 1;
  }

  printPlan(plan);
  if (opts.dryRun) {
    out(c.dim("\n(dry-run — no changes written)"));
    return 0;
  }
  if (plan.actions.every((a) => a.kind === "noop")) {
    out(c.dim("\nNothing to remove."));
    return 0;
  }
  if (!opts.yes && process.stdin.isTTY) {
    const proceed = await askYesNo(c.bold("\nRemove?"), false);
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
  out(c.ok(`\n✓ Uninstalled from ${target}.`));
  return 0;
}

function printPlan(plan: InstallPlan): void {
  out(c.bold(`Uninstall plan for ${plan.target}:`));
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
    case "rmSymlink":
      return `${c.warn("rmlink")}     ${a.dst}${a.currentTarget ? c.dim(`  # (was → ${a.currentTarget})`) : ""}`;
    case "deleteJson":
      return `${c.warn("delete")}     ${a.file} ${c.dim(a.jsonPointer)}  ${c.dim("# " + a.reason)}`;
    case "noop":
      return `${c.dim("noop")}       ${c.dim(a.reason)}`;
    default:
      return `${a.kind}  ${(a as any).reason ?? ""}`;
  }
}

function serializePlan(plan: InstallPlan): unknown {
  return {
    target: plan.target,
    warnings: plan.warnings,
    actions: plan.actions.map((a) => ({ ...a })),
  };
}
