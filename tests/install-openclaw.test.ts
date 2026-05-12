import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, lstatSync, readlinkSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
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

test("planInstall on fresh OpenClaw produces symlink + writeJson for MCP", () => {
  seedOpenclawConfig();
  const plan = planInstall({ target: "openclaw" }, paths());
  const kinds = plan.actions.map((a) => a.kind);
  expect(kinds).toContain("symlink");
  expect(kinds).toContain("writeJson");
  // No extraDirs cleanup needed on a fresh seed.
  const writes = plan.actions.filter((a) => a.kind === "writeJson");
  expect(writes.length).toBe(1);
});

test("apply install creates workspace symlink + writes MCP entry", () => {
  seedOpenclawConfig();
  const plan = planInstall({ target: "openclaw" }, paths());
  const report = applyPlan(plan);
  expect(report.errors).toEqual([]);
  expect(lstatSync(paths().skillLink).isSymbolicLink()).toBe(true);
  expect(readlinkSync(paths().skillLink)).toBe(skillSourcePath());
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio.command).toBeString();
  // OpenClaw entries do not carry a `type` field.
  expect(cfg.mcp.servers.folio.type).toBeUndefined();
});

test("re-running install is idempotent (all noop)", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const plan2 = planInstall({ target: "openclaw" }, paths());
  expect(plan2.actions.every((a) => a.kind === "noop")).toBe(true);
});

test("install with --skill-only does not touch mcp.servers.folio", () => {
  seedOpenclawConfig();
  const plan = planInstall({ target: "openclaw", skill: true, mcp: false }, paths());
  applyPlan(plan);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio).toBeUndefined();
  expect(lstatSync(paths().skillLink).isSymbolicLink()).toBe(true);
});

test("install with --mcp-only does not create the workspace symlink", () => {
  seedOpenclawConfig();
  const plan = planInstall({ target: "openclaw", skill: false, mcp: true }, paths());
  applyPlan(plan);
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
  const plan = planInstall({ target: "openclaw" }, paths());
  applyPlan(plan);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.skills.load.extraDirs).toEqual(["/keep/this/skills/other-skill"]);
});

test("install leaves extraDirs alone when no folio paths present", () => {
  seedOpenclawConfig({
    skills: { load: { extraDirs: ["/keep/this/skills/other"] } },
  });
  const plan = planInstall({ target: "openclaw" }, paths());
  applyPlan(plan);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.skills.load.extraDirs).toEqual(["/keep/this/skills/other"]);
});

// ───── env preservation ──────────────────────────────────────────────────

test("install preserves existing env (e.g. FOLIO_HOME) on MCP entry update", () => {
  seedOpenclawConfig({
    mcp: {
      servers: {
        folio: {
          command: "/old/folio-mcp",
          args: [],
          env: { FOLIO_HOME: "/Users/jarek/Folio-custom" },
        },
      },
    },
  });
  const plan = planInstall({ target: "openclaw" }, paths());
  applyPlan(plan);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio.env.FOLIO_HOME).toBe("/Users/jarek/Folio-custom");
  expect(cfg.mcp.servers.folio.command).not.toBe("/old/folio-mcp");
});

test("fresh install starts with empty env", () => {
  seedOpenclawConfig();
  const plan = planInstall({ target: "openclaw" }, paths());
  applyPlan(plan);
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

test("uninstall removes symlink + mcp entry, keeps unrelated servers", () => {
  seedOpenclawConfig({
    mcp: {
      servers: {
        folio: { command: "/old", args: [], env: {} },
        other: { command: "/usr/bin/other" },
      },
    },
  });
  mkdirSync(paths().workspaceSkills, { recursive: true });
  symlinkSync(skillSourcePath(), paths().skillLink);

  const plan = planUninstall({ target: "openclaw" }, paths());
  applyPlan(plan);

  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio).toBeUndefined();
  expect(cfg.mcp.servers.other.command).toBe("/usr/bin/other");
  expect(existsSync(paths().skillLink)).toBe(false);
});

test("uninstall also clears matching extraDirs entries", () => {
  seedOpenclawConfig({
    skills: {
      load: {
        extraDirs: ["/Users/x/Projects/Folio/skills/folio", "/keep/me/skills/other"],
      },
    },
  });
  const plan = planUninstall({ target: "openclaw", skill: true, mcp: false }, paths());
  applyPlan(plan);
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

test("check reports ok after install", () => {
  seedOpenclawConfig();
  applyPlan(planInstall({ target: "openclaw" }, paths()));
  const r = check(paths());
  expect(r.skill.state).toBe("ok");
  expect(r.mcp.entries.length).toBe(1);
  expect(r.mcp.entries[0]!.scope).toBe("global");
});

test("check returns missing-skill-but-no-mcp-entries when openclaw absent", () => {
  // No openclaw.json: check shouldn't read mcp entries.
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

test("refreshAfterUpdate rewrites MCP command when binary path changes", () => {
  seedOpenclawConfig({
    mcp: { servers: { folio: { command: "/old/folio-mcp", args: [], env: {} } } },
  });
  mkdirSync(paths().workspaceSkills, { recursive: true });
  symlinkSync(skillSourcePath(), paths().skillLink);
  const r = refreshAfterUpdate(paths());
  expect(r.refreshed).toBeGreaterThan(0);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.mcp.servers.folio.command).not.toBe("/old/folio-mcp");
});

test("refreshAfterUpdate is a noop when OpenClaw is absent entirely", () => {
  // No seed → openclaw.json missing.
  const r = refreshAfterUpdate(paths());
  expect(r.refreshed).toBe(0);
});
