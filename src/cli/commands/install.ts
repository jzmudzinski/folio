import { existsSync } from "node:fs";
import { c, out, err, json } from "../io";
import { askString, askYesNo } from "../install/prompts";
import {
  planInstall as planInstallClaudeCode,
  applyPlan,
  claudeCodePaths,
} from "../install/claude-code";
import {
  planInstall as planInstallOpenclaw,
  openclawPaths,
  isOpenclawPresent,
} from "../install/openclaw";
import type { InstallOptions, InstallPlan, InstallTarget, PlanAction } from "../install/types";

export interface InstallCliOptions {
  target?: string;
  skillOnly?: boolean;
  mcpOnly?: boolean;
  scope?: string;
  dryRun?: boolean;
  yes?: boolean;
  jsonOut?: boolean;
}

const SUPPORTED: InstallTarget[] = ["claude-code", "openclaw"];
const FUTURE: Record<string, string> = {
  cursor: "Cursor support is a follow-up; will write .cursor/rules/folio.mdc to the current project.",
  "claude-desktop": "Claude Desktop support is a follow-up — Custom Skills support varies by version.",
};

/** Detect which agent clients exist on this machine. */
function detectTargets(): InstallTarget[] {
  const found: InstallTarget[] = [];
  if (existsSync(claudeCodePaths().claudeDir)) found.push("claude-code");
  if (isOpenclawPresent()) found.push("openclaw");
  return found;
}

/** Resolve `--target` flag to a concrete target list. */
async function resolveTargets(raw: string | undefined, isInteractive: boolean): Promise<InstallTarget[] | { error: string }> {
  const norm = (raw ?? "").toLowerCase().trim();

  // Explicit "all" → every supported target, regardless of detection.
  if (norm === "all") return [...SUPPORTED];

  // Explicit single target.
  if (norm && norm !== "auto") {
    if (FUTURE[norm]) return { error: `${norm}: not yet supported. ${FUTURE[norm]}` };
    if (!SUPPORTED.includes(norm as InstallTarget)) {
      return { error: `Unknown target: ${norm}. Supported: ${SUPPORTED.join(", ")} | all` };
    }
    return [norm as InstallTarget];
  }

  // No --target: detect, then default-or-prompt.
  const detected = detectTargets();
  if (detected.length === 0) {
    // Nothing detected — default to claude-code so the command does something
    // sensible (and shows a useful "OpenClaw not detected" warning if relevant).
    return ["claude-code"];
  }
  if (detected.length === 1) {
    return detected;
  }

  // Both detected. In non-interactive mode: install everywhere ("both"
  // semantics, per design). In interactive mode: ask.
  if (!isInteractive) return detected;

  out(c.dim("Detected agent clients on this machine:"));
  for (const t of detected) out(c.dim(`  ✓ ${t}`));
  const answer = (await askString(
    c.bold(`Install to which? [a]ll / [c]laude-code / [o]penclaw`),
    "a",
  )).trim().toLowerCase();
  if (answer === "" || answer === "a" || answer === "all" || answer === "both") {
    return detected;
  }
  if (answer === "c" || answer === "claude-code") return ["claude-code"];
  if (answer === "o" || answer === "openclaw") return ["openclaw"];
  return { error: `Unrecognized answer: ${answer}` };
}

export async function installCmd(opts: InstallCliOptions): Promise<number> {
  if (opts.skillOnly && opts.mcpOnly) {
    err(c.err("✗ --skill-only and --mcp-only are mutually exclusive."));
    return 1;
  }

  const isInteractive = !opts.yes && process.stdin.isTTY;
  const targetsOrErr = await resolveTargets(opts.target, isInteractive);
  if ("error" in targetsOrErr) {
    err(c.err(`✗ ${targetsOrErr.error}`));
    return 1;
  }
  const targets = targetsOrErr;

  // Resolve Claude Code per-project scope upfront (shared across runs if
  // claude-code is one of the targets; openclaw ignores scope).
  let scope = opts.scope;
  const needsScope = targets.includes("claude-code") && !opts.skillOnly;
  if (needsScope && !scope) {
    if (opts.yes || !process.stdin.isTTY) {
      scope = process.cwd();
    } else {
      const proposed = process.cwd();
      out(c.dim(`MCP wiring is per-project in Claude Code (one entry per directory). OpenClaw is global.`));
      scope = await askString(c.bold(`Which project directory should Claude Code's Folio MCP be wired to?`), proposed);
    }
  }

  // Build plan per target.
  const plans: InstallPlan[] = [];
  for (const target of targets) {
    const installOpts: InstallOptions = {
      target,
      skill: !opts.mcpOnly,
      mcp: !opts.skillOnly,
      scope,
      dryRun: opts.dryRun,
      yes: opts.yes,
      jsonOut: opts.jsonOut,
    };
    if (target === "claude-code") plans.push(planInstallClaudeCode(installOpts));
    else if (target === "openclaw") plans.push(planInstallOpenclaw(installOpts));
  }

  if (opts.jsonOut) {
    const out_ = plans.map((p) => ({ target: p.target, plan: serializePlan(p) }));
    if (opts.dryRun) {
      json({ dry_run: true, targets: out_ });
      return 0;
    }
    const reports = plans.map((p) => applyPlan(p));
    json({
      dry_run: false,
      targets: plans.map((p, i) => ({
        target: p.target,
        plan: serializePlan(p),
        applied: reports[i]!.applied,
        errors: reports[i]!.errors,
      })),
    });
    return reports.some((r) => r.errors.length > 0) ? 1 : 0;
  }

  // Human-readable output: print all plans first, then ask once, then apply.
  for (const plan of plans) printPlan(plan);

  if (opts.dryRun) {
    out(c.dim("\n(dry-run — no changes written)"));
    return 0;
  }

  const anyMutation = plans.some(hasMutations);
  if (!anyMutation) {
    out(c.ok("\n✓ Nothing to do — already installed everywhere requested."));
    return 0;
  }

  if (!opts.yes && process.stdin.isTTY) {
    const proceed = await askYesNo(c.bold("\nApply changes?"), true);
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
    } else if (hasMutations(plan)) {
      out(c.ok(`\n✓ Installed for ${plan.target}.`));
    }
  }
  if (totalErrors === 0) {
    if (targets.includes("claude-code")) out(c.dim("  Restart Claude Code to pick up the skill + MCP entry."));
    if (targets.includes("openclaw")) out(c.dim("  Restart OpenClaw to pick up the new skill + MCP entry."));
  }
  return totalErrors === 0 ? 0 : 1;
}

function printPlan(plan: InstallPlan): void {
  out(c.bold(`\nPlan for ${plan.target}:`));
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
