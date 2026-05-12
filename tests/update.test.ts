import { expect, test } from "bun:test";
import { cmpVersion, detectTarget } from "../src/cli/commands/update";

test("cmpVersion orders releases correctly", () => {
  expect(cmpVersion("0.4.2", "0.4.2")).toBe(0);
  expect(cmpVersion("0.4.2", "0.4.1")).toBeGreaterThan(0);
  expect(cmpVersion("0.4.1", "0.4.2")).toBeLessThan(0);
  expect(cmpVersion("0.5.0", "0.4.99")).toBeGreaterThan(0);
  expect(cmpVersion("1.0.0", "0.99.99")).toBeGreaterThan(0);
  // tolerates v prefix
  expect(cmpVersion("v0.4.2", "0.4.2")).toBe(0);
  expect(cmpVersion("v0.5.0", "v0.4.2")).toBeGreaterThan(0);
  // tolerates missing minor/patch
  expect(cmpVersion("1", "1.0.0")).toBe(0);
  expect(cmpVersion("1.2", "1.2.0")).toBe(0);
});

test("detectTarget returns one of the supported triples (or null)", () => {
  const t = detectTarget();
  if (t !== null) {
    expect(["darwin-arm64", "linux-x64", "linux-arm64"]).toContain(t);
  }
  // No assertion when null — test runs on whatever platform CI/dev provides
});
