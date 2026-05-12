import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, lstatSync, readlinkSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  claudeCodePaths,
  planInstall,
  planUninstall,
  applyPlan,
  check,
  skillSourcePath,
  refreshAfterUpdate,
  escapePointer,
  setByPointer,
  deleteByPointer,
} from "../src/cli/install/claude-code";
import { _resetBackupMemoForTests, readJsonConfig } from "../src/cli/install/json-config";

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "folio-install-test-"));
  _resetBackupMemoForTests();
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

function paths() {
  return claudeCodePaths(fakeHome);
}

test("planInstall on empty home produces symlink + writeJson actions", () => {
  const plan = planInstall({ target: "claude-code", scope: "/some/project" }, paths());
  const kinds = plan.actions.map((a) => a.kind);
  expect(kinds).toContain("symlink");
  expect(kinds).toContain("writeJson");
});

test("apply install creates symlink and writes ~/.claude.json", () => {
  const plan = planInstall({ target: "claude-code", scope: "/some/project" }, paths());
  const report = applyPlan(plan, paths());
  expect(report.errors).toEqual([]);
  expect(lstatSync(paths().skillLink).isSymbolicLink()).toBe(true);
  expect(readlinkSync(paths().skillLink)).toBe(skillSourcePath());
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.projects["/some/project"].mcpServers.folio.type).toBe("stdio");
  expect(cfg.projects["/some/project"].mcpServers.folio.command).toBeString();
});

test("re-running install is idempotent (all noop)", () => {
  const plan1 = planInstall({ target: "claude-code", scope: "/p" }, paths());
  applyPlan(plan1, paths());
  const plan2 = planInstall({ target: "claude-code", scope: "/p" }, paths());
  expect(plan2.actions.every((a) => a.kind === "noop")).toBe(true);
});

test("install with --skill-only does not touch ~/.claude.json", () => {
  const plan = planInstall({ target: "claude-code", skill: true, mcp: false }, paths());
  applyPlan(plan, paths());
  expect(existsSync(paths().configJson)).toBe(false);
  expect(lstatSync(paths().skillLink).isSymbolicLink()).toBe(true);
});

test("install with --mcp-only does not create skill symlink", () => {
  const plan = planInstall({ target: "claude-code", skill: false, mcp: true, scope: "/q" }, paths());
  applyPlan(plan, paths());
  expect(existsSync(paths().skillLink)).toBe(false);
  expect(existsSync(paths().configJson)).toBe(true);
});

test("install preserves unrelated content in ~/.claude.json", () => {
  // Pre-seed with foreign config — must survive a folio install untouched.
  mkdirSync(paths().claudeDir, { recursive: true });
  writeFileSync(
    paths().configJson,
    JSON.stringify({
      projects: {
        "/other/proj": { mcpServers: { other: { type: "stdio", command: "/usr/bin/other" } } },
      },
      unrelated: { key: "value" },
    }, null, 2),
  );
  const plan = planInstall({ target: "claude-code", scope: "/p" }, paths());
  applyPlan(plan, paths());
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.projects["/other/proj"].mcpServers.other.command).toBe("/usr/bin/other");
  expect(cfg.unrelated.key).toBe("value");
  expect(cfg.projects["/p"].mcpServers.folio).toBeDefined();
});

test("install creates a backup of ~/.claude.json on first touch", () => {
  mkdirSync(paths().claudeDir, { recursive: true });
  writeFileSync(paths().configJson, JSON.stringify({ keep: 1 }), "utf-8");
  const plan = planInstall({ target: "claude-code", scope: "/p" }, paths());
  applyPlan(plan, paths());
  const backups = require("node:fs").readdirSync(fakeHome).filter((n: string) => n.startsWith(".") && n.includes("folio-backup"));
  expect(backups.length).toBe(1);
});

test("uninstall removes only the folio entry, leaves the rest", () => {
  mkdirSync(paths().claudeDir, { recursive: true });
  writeFileSync(
    paths().configJson,
    JSON.stringify({
      projects: {
        "/p": {
          mcpServers: {
            folio: { type: "stdio", command: "/old/folio-mcp" },
            other: { type: "stdio", command: "/usr/bin/other" },
          },
        },
      },
    }, null, 2),
  );
  mkdirSync(paths().skillsDir, { recursive: true });
  symlinkSync(skillSourcePath(), paths().skillLink);

  const plan = planUninstall({ target: "claude-code", scope: "/p" }, paths());
  applyPlan(plan, paths());

  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.projects["/p"].mcpServers.folio).toBeUndefined();
  expect(cfg.projects["/p"].mcpServers.other).toBeDefined();
  expect(existsSync(paths().skillLink)).toBe(false);
});

test("uninstall --all-scopes removes folio from every scope", () => {
  mkdirSync(paths().claudeDir, { recursive: true });
  writeFileSync(
    paths().configJson,
    JSON.stringify({
      projects: {
        "/p1": { mcpServers: { folio: { type: "stdio", command: "/x" } } },
        "/p2": { mcpServers: { folio: { type: "stdio", command: "/x" } } },
        "/p3": { mcpServers: { other: { type: "stdio", command: "/o" } } },
      },
    }, null, 2),
  );
  const plan = planUninstall({ target: "claude-code", allScopes: true, skill: false }, paths());
  applyPlan(plan, paths());
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.projects["/p1"].mcpServers.folio).toBeUndefined();
  expect(cfg.projects["/p2"].mcpServers.folio).toBeUndefined();
  expect(cfg.projects["/p3"].mcpServers.other).toBeDefined();
});

test("check reports missing skill before install", () => {
  const r = check(paths());
  expect(r.skill.state).toBe("missing");
  expect(r.mcp.entries).toEqual([]);
});

test("check reports ok after install", () => {
  applyPlan(planInstall({ target: "claude-code", scope: "/p" }, paths()), paths());
  const r = check(paths());
  expect(r.skill.state).toBe("ok");
  expect(r.mcp.entries.length).toBe(1);
  expect(r.mcp.entries[0]!.scope).toBe("/p");
});

test("check reports stale when MCP command points to a non-existent binary", () => {
  mkdirSync(paths().claudeDir, { recursive: true });
  writeFileSync(
    paths().configJson,
    JSON.stringify({
      projects: { "/p": { mcpServers: { folio: { type: "stdio", command: "/no/such/folio-mcp", args: [] } } } },
    }, null, 2),
  );
  const r = check(paths());
  expect(r.mcp.entries[0]!.state).toBe("stale");
});

test("refreshAfterUpdate rewrites MCP command when binary path changes", () => {
  // Simulate a prior install with a different command path.
  mkdirSync(paths().claudeDir, { recursive: true });
  mkdirSync(paths().skillsDir, { recursive: true });
  symlinkSync(skillSourcePath(), paths().skillLink);
  writeFileSync(
    paths().configJson,
    JSON.stringify({
      projects: { "/p": { mcpServers: { folio: { type: "stdio", command: "/old/path/folio-mcp", args: [] } } } },
    }, null, 2),
  );

  const result = refreshAfterUpdate(paths());
  expect(result.refreshed).toBeGreaterThan(0);
  const cfg = readJsonConfig<any>(paths().configJson);
  expect(cfg.projects["/p"].mcpServers.folio.command).not.toBe("/old/path/folio-mcp");
});

test("refreshAfterUpdate is a noop when nothing was previously installed", () => {
  const result = refreshAfterUpdate(paths());
  expect(result.refreshed).toBe(0);
});

test("escapePointer + set/deleteByPointer handle slashes in scope keys", () => {
  const ptr = `/projects/${escapePointer("/some/dir")}/x`;
  const obj: any = {};
  setByPointer(obj, ptr, 42);
  expect(obj.projects["/some/dir"].x).toBe(42);
  deleteByPointer(obj, ptr);
  expect(obj.projects["/some/dir"].x).toBeUndefined();
});
