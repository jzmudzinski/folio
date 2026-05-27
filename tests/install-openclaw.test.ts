import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, lstatSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  openclawPaths,
  planInstall,
  planUninstall,
  check,
  isOpenclawPresent,
  refreshAfterUpdate,
} from "../src/cli/install/openclaw";
import { applyPlan, skillSourcePath } from "../src/cli/install/claude-code";
import { _resetBackupMemoForTests, readJsonConfig } from "../src/cli/install/json-config";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "folio-oc-install-test-"));
  _resetBackupMemoForTests();
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

function paths() {
  return openclawPaths(fakeHome);
}

function seedOpenclawConfig(extra: any = {}): void {
  const p = paths();
  mkdirSync(p.workspaceSkills, { recursive: true });
  writeFileSync(p.configJson, JSON.stringify({ mcp: { servers: {} }, ...extra }, null, 2));
}

/** A real (non-symlink) directory. */
function isRealDir(p: string): boolean {
  try { return lstatSync(p).isDirectory(); } catch { return false; }
}
/** True when p is the Folio skill installed as a copy: real dir + SKILL.md + marker. */
function isCopiedSkill(p: string): boolean {
  return isRealDir(p) && existsSync(join(p, "SKILL.md")) && existsSync(join(p, ".folio-version"));
}
function markerOf(p: string): string {
  return readFileSync(join(p, ".folio-version"), "utf-8").trim();
}

// ───── isOpenclawPresent ──────────────────────────────────────────────────

test("isOpenclawPresent is false when openclaw.json missing", () => {
  expect(isOpenclawPresent(paths())).toBe(false);
});

test("isOpenclawPresent is true when openclaw.json exists", () => {
  seedOpenclawConfig();
  expect(isOpenclawPresent(paths())).toBe(true);
});

// ───── planInstall ────────────────────────────────────────────────────────

test("planInstall on missing OpenClaw warns and emits no actions", () => {
  const plan = planInstall({ target: "openclaw" }, paths());
  expect(plan.actions).toEqual([]);
  expect(plan.warnings.length).toBeGreaterThan(0);
  expect(plan.warnings[0]).toContain("OpenClaw not detected");
});

test("planInstall on fresh OpenClaw copies skill + hook (copyDir, NOT symlink) + writeJson for hook entry + MCP", () => {
  seedOpenclawConfig();
  const plan = planInstall({ target: "openclaw" }, paths());
  const kinds = plan.actions.map((a) => a.kind);
  // The bug fix: directories are copied, never symlinked, for OpenClaw.
  expect(kinds).not.toContain("symlink");
  expect(kinds).toContain("copyDir");
  const copies = plan.actions.filter((a) => a.kind === "copyDir");
  expect(copies.length).toBe(2); // skill + hook
  copies.forEach((a: any) => expect(a.version).toBe(VERSION));
  const writes = plan.actions.filter((a) => a.kind === "writeJson");
  expect(writes.length).toBe(2); // hook entry + MCP
});

test("apply install creates a REAL skill dir (copy) with SKILL.md + version marker — not a symlink", () => {
  seedOpenclawConfig();
  const report = applyPlan(planInstall({ target: "openclaw" }, paths()));
  expect(report.errors).toEqual([]);
  const link = paths().skillLink;
  expect(lstatSync(link).isSymbolicLink()).toBe(false);
  expect(isCopiedSkill(link)).toBe(true);
  expect(markerOf(link)).toBe(VERSION);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio.command).toBeString();
  expect(cfg.mcp.servers.folio.type).toBeUndefined();
});

test("re-running install is idempotent (all noop) when version unchanged", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const plan2 = planInstall({ target: "openclaw" }, paths());
  expect(plan2.actions.every((a) => a.kind === "noop")).toBe(true);
});

test("version drift re-copies the skill (marker mismatch → copyDir, not noop)", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  // Simulate a prior install from an older Folio version.
  writeFileSync(join(paths().skillLink, ".folio-version"), "0.0.1\n");
  const plan = planInstall({ target: "openclaw", skill: true, mcp: false }, paths());
  const skillCopy = plan.actions.find((a) => a.kind === "copyDir" && a.dst === paths().skillLink) as any;
  expect(skillCopy).toBeDefined();
  expect(skillCopy.reason).toContain("refresh");
  applyPlan(plan);
  expect(markerOf(paths().skillLink)).toBe(VERSION);
});

test("a legacy symlink install is replaced by a real copied dir", () => {
  seedOpenclawConfig();
  mkdirSync(paths().workspaceSkills, { recursive: true });
  symlinkSync(skillSourcePath(), paths().skillLink); // legacy install
  const plan = planInstall({ target: "openclaw", skill: true, mcp: false }, paths());
  const skillCopy = plan.actions.find((a) => a.kind === "copyDir" && a.dst === paths().skillLink) as any;
  expect(skillCopy).toBeDefined();
  expect(skillCopy.reason).toContain("replace legacy");
  applyPlan(plan);
  expect(lstatSync(paths().skillLink).isSymbolicLink()).toBe(false);
  expect(isCopiedSkill(paths().skillLink)).toBe(true);
});

test("install with --skill-only does not touch mcp.servers.folio", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw", skill: true, mcp: false }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio).toBeUndefined();
  expect(isCopiedSkill(paths().skillLink)).toBe(true);
});

test("install with --mcp-only does not create the workspace skill dir", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw", skill: false, mcp: true }, paths()));
  expect(existsSync(paths().skillLink)).toBe(false);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio).toBeDefined();
});

// ───── extraDirs cleanup ──────────────────────────────────────────────────

test("install removes stale folio paths from skills.load.extraDirs", () => {
  seedOpenclawConfig({
    skills: {
      load: {
        extraDirs: [
          "/Users/x/Projects/Folio/skills/folio",
          "/some/other/skills/folio",
          "/keep/this/skills/other-skill",
        ],
      },
    },
  });
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.skills.load.extraDirs).toEqual(["/keep/this/skills/other-skill"]);
});

test("install leaves extraDirs alone when no folio paths present", () => {
  seedOpenclawConfig({
    skills: { load: { extraDirs: ["/keep/this/skills/other"] } },
  });
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.skills.load.extraDirs).toEqual(["/keep/this/skills/other"]);
});

// ───── env preservation ──────────────────────────────────────────────────

test("install preserves existing env (e.g. FOLIO_HOME) on MCP entry update", () => {
  seedOpenclawConfig({
    mcp: { servers: { folio: { command: "/old/folio-mcp", args: [], env: { FOLIO_HOME: "/tmp/folio-test-home" } } } },
  });
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio.env.FOLIO_HOME).toBe("/tmp/folio-test-home");
  expect(cfg.mcp.servers.folio.command).not.toBe("/old/folio-mcp");
});

test("fresh install starts with empty env", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio.env).toEqual({});
});

// ───── preserve unrelated config ─────────────────────────────────────────

test("install preserves unrelated keys in openclaw.json", () => {
  seedOpenclawConfig({
    meta: { foo: "bar" },
    mcp: { servers: { other: { command: "/usr/bin/other" } } },
  });
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.meta.foo).toBe("bar");
  expect(cfg.mcp.servers.other.command).toBe("/usr/bin/other");
  expect(cfg.mcp.servers.folio).toBeDefined();
});

test("install creates a backup of openclaw.json on first touch", () => {
  seedOpenclawConfig({ keep: 1 });
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const fs = require("node:fs") as typeof import("node:fs");
  const backups = fs.readdirSync(paths().openclawDir).filter((n) => n.startsWith(".") && n.includes("folio-backup"));
  expect(backups.length).toBe(1);
});

// ───── planUninstall ─────────────────────────────────────────────────────

test("uninstall removes copied skill dir + mcp entry, keeps unrelated servers", () => {
  seedOpenclawConfig({
    mcp: { servers: { other: { command: "/usr/bin/other" } } },
  });
  applyPlan(planInstall({ target: "openclaw" }, paths())); // copy in
  expect(isCopiedSkill(paths().skillLink)).toBe(true);

  applyPlan(planUninstall({ target: "openclaw" }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio).toBeUndefined();
  expect(cfg.mcp.servers.other.command).toBe("/usr/bin/other");
  expect(existsSync(paths().skillLink)).toBe(false);
});

test("uninstall removes a legacy skill symlink too", () => {
  seedOpenclawConfig();
  mkdirSync(paths().workspaceSkills, { recursive: true });
  symlinkSync(skillSourcePath(), paths().skillLink);
  applyPlan(planUninstall({ target: "openclaw" }, paths()));
  expect(existsSync(paths().skillLink)).toBe(false);
});

test("uninstall leaves a non-Folio directory (no marker) alone", () => {
  seedOpenclawConfig();
  mkdirSync(paths().skillLink, { recursive: true });
  writeFileSync(join(paths().skillLink, "README.md"), "not folio"); // no marker
  const plan = planUninstall({ target: "openclaw", skill: true, mcp: false }, paths());
  expect(plan.actions.some((a) => a.kind === "rmDir")).toBe(false);
  expect(plan.warnings.some((w) => w.includes("without a Folio marker"))).toBe(true);
  applyPlan(plan);
  expect(existsSync(paths().skillLink)).toBe(true);
});

test("uninstall also clears matching extraDirs entries", () => {
  seedOpenclawConfig({
    skills: { load: { extraDirs: ["/Users/x/Projects/Folio/skills/folio", "/keep/me/skills/other"] } },
  });
  applyPlan(planUninstall({ target: "openclaw", skill: true, mcp: false }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.skills.load.extraDirs).toEqual(["/keep/me/skills/other"]);
});

// ───── check ─────────────────────────────────────────────────────────────

test("check reports missing skill + no entries on fresh openclaw", () => {
  seedOpenclawConfig();
  const r = check(paths());
  expect(r.skill.state).toBe("missing");
  expect(r.mcp.entries).toEqual([]);
});

test("check reports ok (healthy copy) after install", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const r = check(paths());
  expect(r.skill.state).toBe("ok");
  expect(r.skill.note).toContain("copy");
  expect(r.mcp.entries.length).toBe(1);
  expect(r.mcp.entries[0]!.scope).toBe("global");
});

test("check flags a legacy symlink as wrong-target (the bug)", () => {
  seedOpenclawConfig();
  mkdirSync(paths().workspaceSkills, { recursive: true });
  symlinkSync(skillSourcePath(), paths().skillLink);
  const r = check(paths());
  expect(r.skill.state).toBe("wrong-target");
  expect(r.skill.note).toContain("symlink");
});

test("check flags a version-drifted copy as stale", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  writeFileSync(join(paths().skillLink, ".folio-version"), "0.0.1\n");
  const r = check(paths());
  expect(r.skill.state).toBe("stale");
});

test("check returns missing-skill-but-no-mcp-entries when openclaw absent", () => {
  const r = check(paths());
  expect(r.skill.state).toBe("missing");
  expect(r.mcp.entries).toEqual([]);
});

// ───── refreshAfterUpdate ────────────────────────────────────────────────

test("refreshAfterUpdate is noop when nothing installed", () => {
  seedOpenclawConfig();
  const r = refreshAfterUpdate(paths());
  expect(r.refreshed).toBe(0);
});

test("refreshAfterUpdate rewrites MCP command + re-copies skill when binary path changes", () => {
  seedOpenclawConfig({
    mcp: { servers: { folio: { command: "/old/folio-mcp", args: [], env: {} } } },
  });
  applyPlan(planInstall({ target: "openclaw", skill: true, mcp: false }, paths())); // copy skill in
  // Simulate an older copy + stale MCP command (as after a `folio update`).
  writeFileSync(join(paths().skillLink, ".folio-version"), "0.0.1\n");
  const r = refreshAfterUpdate(paths());
  expect(r.refreshed).toBeGreaterThan(0);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio.command).not.toBe("/old/folio-mcp");
  expect(markerOf(paths().skillLink)).toBe(VERSION); // re-copied to current
});

test("refreshAfterUpdate is a noop when OpenClaw is absent entirely", () => {
  const r = refreshAfterUpdate(paths());
  expect(r.refreshed).toBe(0);
});

// ───── folio-event-watcher hook (copied dir since the symlink-escape fix) ──

test("install copies the hook dir + writes enabled flag", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  expect(lstatSync(paths().hookLink).isSymbolicLink()).toBe(false);
  expect(isRealDir(paths().hookLink)).toBe(true);
  expect(existsSync(join(paths().hookLink, ".folio-version"))).toBe(true);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.hooks.internal.entries["folio-event-watcher"].enabled).toBe(true);
});

test("check reports hook state ok after install", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const r = check(paths());
  expect(r.hook).toBeDefined();
  expect(r.hook!.name).toBe("folio-event-watcher");
  expect(r.hook!.state).toBe("ok");
});

test("check reports hook missing on fresh openclaw (before install)", () => {
  seedOpenclawConfig();
  const r = check(paths());
  expect(r.hook!.state).toBe("missing");
});

test("check reports hook disabled when copy present but enabled=false", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const cfg = readJsonConfig<any>(paths().configJson);
  cfg.hooks.internal.entries["folio-event-watcher"].enabled = false;
  writeFileSync(paths().configJson, JSON.stringify(cfg, null, 2));
  const r = check(paths());
  expect(r.hook!.state).toBe("disabled");
});

test("uninstall removes copied hook dir + entry alongside skill", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  expect(isRealDir(paths().hookLink)).toBe(true);
  applyPlan(planUninstall({ target: "openclaw" }, paths()));
  expect(existsSync(paths().hookLink)).toBe(false);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.hooks?.internal?.entries?.["folio-event-watcher"]).toBeUndefined();
});

test("install with --skill-only keeps the hook (copied), opts out of MCP", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw", mcp: false }, paths()));
  expect(isCopiedSkill(paths().skillLink)).toBe(true);
  expect(isRealDir(paths().hookLink)).toBe(true);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.hooks.internal.entries["folio-event-watcher"].enabled).toBe(true);
  expect(cfg.mcp?.servers?.folio).toBeUndefined();
});

test("install with --mcp-only does NOT install the hook (hook coupled to skill)", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw", skill: false }, paths()));
  expect(existsSync(paths().hookLink)).toBe(false);
  expect(existsSync(paths().skillLink)).toBe(false);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.hooks?.internal?.entries?.["folio-event-watcher"]).toBeUndefined();
  expect(cfg.mcp?.servers?.folio).toBeDefined();
});
