// Shared types for the install/uninstall/doctor commands.
//
// Conventions:
//   - "Plan" describes intended mutations without touching disk; used for
//     --dry-run preview and idempotency checks.
//   - "Apply" performs the mutations described by a Plan; returns Report.
//   - Targets currently supported: "claude-code". Cursor + Claude Desktop are
//     follow-ups (see `folio install --target` in CLI help).

export type InstallTarget = "claude-code";

export const ALL_TARGETS: InstallTarget[] = ["claude-code"];

export interface InstallOptions {
  /** Which client to install for. */
  target: InstallTarget;
  /** Install the agent skill (symlink in client's skill dir). Default: true. */
  skill?: boolean;
  /** Install the MCP server entry. Default: true. */
  mcp?: boolean;
  /**
   * MCP scope for clients that store wiring per project (Claude Code).
   * If omitted, the installer prompts interactively (or uses cwd in --yes mode).
   */
  scope?: string;
  /** Show plan without mutating disk. */
  dryRun?: boolean;
  /** Skip interactive confirm. */
  yes?: boolean;
  /** JSON output instead of human-readable. */
  jsonOut?: boolean;
}

export interface UninstallOptions {
  target: InstallTarget;
  skill?: boolean;
  mcp?: boolean;
  /** When uninstalling MCP from Claude Code, which project scope. */
  scope?: string;
  /** Remove from every project scope where the folio entry is present. */
  allScopes?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  jsonOut?: boolean;
}

export type PlanAction =
  | { kind: "symlink"; src: string; dst: string; reason: string }
  | { kind: "rmSymlink"; dst: string; currentTarget: string | null; reason: string }
  | { kind: "writeJson"; file: string; jsonPointer: string; before: unknown; after: unknown; reason: string }
  | { kind: "deleteJson"; file: string; jsonPointer: string; before: unknown; reason: string }
  | { kind: "noop"; reason: string };

export interface InstallPlan {
  target: InstallTarget;
  actions: PlanAction[];
  /** Pre-flight warnings the user should see before applying. */
  warnings: string[];
}

export interface ApplyReport {
  target: InstallTarget;
  applied: PlanAction[];
  skipped: PlanAction[];
  errors: { action: PlanAction; message: string }[];
}

export interface CheckReport {
  target: InstallTarget;
  skill: {
    expected: string;
    installedAt: string | null;
    /** If a symlink exists at expected, what it currently points to. */
    currentTarget: string | null;
    state: "ok" | "missing" | "stale" | "wrong-target";
    note?: string;
  };
  mcp: {
    /** Each scope (project path or "global") where a folio entry exists. */
    entries: { scope: string; command: string; state: "ok" | "stale" }[];
    expectedCommand: string;
  };
}
