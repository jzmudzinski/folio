import { existsSync } from "node:fs";
import { c, out, err, json } from "../io";
import { askYesNo } from "../install/prompts";
import {
  planUninstall as planUninstallClaudeCode,
  applyPlan,
  claudeCodePaths,
} from "../install/claude-code";
import {
  planUninstall as planUninstallOpenclaw,
  isOpenclawPresent,
} from "../install/openclaw";
import type { InstallPlan, InstallTarget, PlanAction, UninstallOptions } from "../install/types";

export interface UninstallCliOptions {
  target?: string;
  skillOnly?: boolean;
  mcpOnly?: boolean;
  scope?: string;
  global?: boolean;
  allScopes?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  jsonOut?: boolean;
}

const SUPPORTED: InstallTarget[] = ["claude-code", "openclaw"];

function detectTargets(): InstallTarget[] {
  const found: InstallTarget[] = [];
  if (existsSync(claudeCodePaths().claudeDir)) found.push("claude-code");
  if (isOpenclawPresent()) found.push("openclaw");
  return found;
}

function resolveTargets(raw: string | undefined): InstallTarget[] | { error: string } {
  const norm = (raw ?? "").toLowerCase().trim();
  if (norm === "all") return [...SUPPORTED];
  if (norm && norm !== "auto") {
    if (!SUPPORTED.includes(norm as InstallTarget)) {
      return { error: `Unknown target: ${norm}. Supported: ${SUPPORTED.join(", ")} | all` };
    }
    return [norm as InstallTarget];
  }
  // No target: default to claude-code (back-compat). User must say --target all
  // or --target openclaw explicitly to touch openclaw on uninstall.
  return ["claude-code"];
}

export async function uninstallCmd(opts: UninstallCliOptions): Promise<number> {
  if (opts.skillOnly && opts.mcpOnly) {
    err(c.err("✗ --skill-only and --mcp-only are mutually exclusive."));
    return 1;
  }

  const targetsOrErr = resolveTargets(opts.target);
  if ("error" in targetsOrErr) {
    err(c.err(`✗ ${targetsOrErr.error}`));
    return 1;
  }
  const targets = targetsOrErr;

  // Detected-but-not-asked-for openclaw → hint, don't act.
  const detected = detectTargets();
  if (!targets.includes("openclaw") && detected.includes("openclaw") && opts.target !== "claude-code") {
    out(c.dim("(OpenClaw detected — pass --target openclaw or --target all to uninstall there too.)"));
  }

  const plans: InstallPlan[] = [];
  for (const target of targets) {
    const uOpts: UninstallOptions = {
      target,
      skill: !opts.mcpOnly,
      mcp: !opts.skillOnly,
      scope: opts.scope,
      global: opts.global,
      allScopes: opts.allScopes,
      dryRun: opts.dryRun,
      yes: opts.yes,
      jsonOut: opts.jsonOut,
    };
    // Default to the cwd project scope only when nothing more specific was
    // asked for — --global / --scope / --all-scopes all suppress that default.
    if (target === "claude-code" && !uOpts.scope && !uOpts.global && !uOpts.allScopes && !opts.skillOnly) {
      uOpts.scope = process.cwd();
    }
    if (target === "claude-code") plans.push(planUninstallClaudeCode(uOpts));
    else if (target === "openclaw") plans.push(planUninstallOpenclaw(uOpts));
  }

  if (opts.jsonOut) {
    if (opts.dryRun) {
      json({ dry_run: true, targets: plans.map((p) => ({ target: p.target, plan: serializePlan(p) })) });
      return 0;
    }
    const reports = plans.map((p) => applyPlan(p));
    json({
      dry_run: false,
      targets: plans.map((p, i) => ({
        target: p.target,
        applied: reports[i]!.applied,
        errors: reports[i]!.errors,
      })),
    });
    return reports.some((r) => r.errors.length > 0) ? 1 : 0;
  }

  for (const plan of plans) printPlan(plan);
  if (opts.dryRun) {
    out(c.dim("\n(dry-run — no changes written)"));
    return 0;
  }
  const anyAction = plans.some((p) => p.actions.some((a) => a.kind !== "noop"));
  if (!anyAction) {
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
  let totalErrors = 0;
  for (const plan of plans) {
    const report = applyPlan(plan);
    if (report.errors.length > 0) {
      err(c.err(`\n✗ [${plan.target}] ${report.errors.length} action(s) failed:`));
      for (const e of report.errors) err(c.err(`  - ${e.message}`));
      totalErrors += report.errors.length;
    } else if (plan.actions.some((a) => a.kind !== "noop")) {
      out(c.ok(`\n✓ Uninstalled from ${plan.target}.`));
    }
  }
  return totalErrors === 0 ? 0 : 1;
}

function printPlan(plan: InstallPlan): void {
  out(c.bold(`\nUninstall plan for ${plan.target}:`));
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
    case "writeJson":
      return `${c.cyan("write")}      ${a.file} ${c.dim(a.jsonPointer)}  ${c.dim("# " + a.reason)}`;
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
