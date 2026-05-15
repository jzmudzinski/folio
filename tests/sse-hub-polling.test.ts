/**
 * SSE hub polling fallback (v0.19.2).
 *
 * Before v0.19.2 the hub only used fs.watch to detect new bytes in the
 * JSONL substrate. fs.watch is reliable for same-process writes but
 * notoriously flaky on macOS for cross-process writes — and the in-
 * process `publish()` fast-path doesn't help when the writer is a
 * different OS process (its `channels` Map is process-local).
 *
 * Symptom in production: agent in MCP server calls `wait_for_pick`;
 * user clicks in the viewer (separate process) and the viewer's
 * `pickVariant` appends to the JSONL + calls publish() locally; the
 * agent's wait_for_pick subscription never receives the event and
 * eventually times out — "wait_for_pick zawisł".
 *
 * Fix: every channel with active subscribers also runs a ~500ms poll
 * that calls drainAndEmit. fs.watch + direct publish() stay as fast
 * paths; the poll guarantees delivery within ~500ms even when both
 * miss.
 *
 * These tests simulate the "writer skips publish()" scenario by writing
 * directly to the file via fs.appendFileSync without calling publish()
 * — which is exactly what an out-of-process writer looks like to the
 * subscriber's channel.
 */

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { subscribe, _resetHubForTests } from "../src/core/sse-hub";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-sse-poll-"));
});

afterEach(() => {
  _resetHubForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

function jsonlEntry(id: string, content: string): string {
  return JSON.stringify({ id, ts: new Date().toISOString(), content_html: content, plain: content, tags: [] }) + "\n";
}

test("polling fallback delivers entries appended without publish() within ~750ms", async () => {
  const jsonl = join(tmpDir, "x.entries.jsonl");
  // Seed with empty file so the watcher attaches immediately.
  writeFileSync(jsonl, "");

  const received: string[] = [];
  const unsub = subscribe("note-x", jsonl, (entry) => received.push(entry.id));

  // Simulate a cross-process writer: append to the file without calling
  // publish() in this process's hub. fs.watch MAY fire (it's flaky)
  // but the poll must guarantee delivery.
  appendFileSync(jsonl, jsonlEntry("e1", "<p>one</p>"));

  // Wait one poll interval + a generous slack.
  await new Promise((r) => setTimeout(r, 750));

  expect(received).toContain("e1");
  unsub();
});

test("polling fallback picks up multiple sequential out-of-band appends", async () => {
  const jsonl = join(tmpDir, "y.entries.jsonl");
  writeFileSync(jsonl, "");

  const received: string[] = [];
  const unsub = subscribe("note-y", jsonl, (entry) => received.push(entry.id));

  appendFileSync(jsonl, jsonlEntry("a", "<p>a</p>"));
  await new Promise((r) => setTimeout(r, 600));
  appendFileSync(jsonl, jsonlEntry("b", "<p>b</p>"));
  await new Promise((r) => setTimeout(r, 600));
  appendFileSync(jsonl, jsonlEntry("c", "<p>c</p>"));
  await new Promise((r) => setTimeout(r, 600));

  expect(received).toEqual(["a", "b", "c"]);
  unsub();
});

test("polling does not duplicate entries when fs.watch also fires", async () => {
  // Each entry should be emitted exactly once even if poll + watch both
  // observe the same append. The offset check inside drainAndEmit is
  // what guarantees this; this test pins the contract.
  const jsonl = join(tmpDir, "z.entries.jsonl");
  writeFileSync(jsonl, "");

  const received: string[] = [];
  const unsub = subscribe("note-z", jsonl, (entry) => received.push(entry.id));

  appendFileSync(jsonl, jsonlEntry("dup-1", "<p>only-once</p>"));
  // Wait long enough for the poll to fire multiple times.
  await new Promise((r) => setTimeout(r, 1300));

  expect(received).toEqual(["dup-1"]);
  unsub();
});

test("unsubscribe stops both watcher and poll timer", async () => {
  const jsonl = join(tmpDir, "stop.entries.jsonl");
  writeFileSync(jsonl, "");

  const received: string[] = [];
  const unsub = subscribe("stop-note", jsonl, (entry) => received.push(entry.id));

  appendFileSync(jsonl, jsonlEntry("seen", "<p>seen</p>"));
  await new Promise((r) => setTimeout(r, 600));
  expect(received).toEqual(["seen"]);

  unsub();
  // After unsubscribe, further appends must NOT reach the listener.
  appendFileSync(jsonl, jsonlEntry("ignored", "<p>ignored</p>"));
  await new Promise((r) => setTimeout(r, 700));
  expect(received).toEqual(["seen"]);
});
