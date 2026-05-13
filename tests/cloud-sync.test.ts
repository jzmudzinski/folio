import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeCloudDb } from "../src/cloud/db";

let tmpDir: string;
let server: { stop: () => void; port: number; hostname: string } | null = null;
let baseUrl: string;
let token: string;

async function pair(name = "test-device"): Promise<string> {
  const { createPairingCode } = await import("../src/cloud/auth");
  const { code } = createPairingCode();
  const res = await fetch(`${baseUrl}/v1/auth/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, device_name: name }),
  });
  const body = (await res.json()) as { token: string };
  return body.token;
}

function note(uuid: string, slug = "n", thread = "smoke", overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid,
    slug,
    thread_id: thread,
    title: `Note ${slug}`,
    type: "research",
    body_html: `<p>body ${slug}</p>`,
    created_at: "2026-05-13T10:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-cloud-sync-"));
  process.env.FOLIO_CLOUD_HOME = tmpDir;
  const { startCloudServer } = await import("../src/cloud/server");
  server = (await startCloudServer({ port: 0 })) as any;
  baseUrl = `http://${server!.hostname}:${server!.port}`;
  token = await pair();
});

afterEach(() => {
  try { server?.stop(); } catch {}
  server = null;
  closeCloudDb();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.FOLIO_CLOUD_HOME;
});

test("push 5 notes + pull returns all + cursor advances", async () => {
  const notes = Array.from({ length: 5 }, (_, i) =>
    note(`019e2110-0000-7000-8000-00000000000${i}`, `n${i}`, "smoke")
  );
  const pushRes = await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes }),
  });
  expect(pushRes.status).toBe(200);
  const pushBody = (await pushRes.json()) as { notes: unknown[]; cursor: number };
  expect(pushBody.notes).toHaveLength(5);
  expect(pushBody.cursor).toBe(5);

  const pullRes = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const pullBody = (await pullRes.json()) as { notes: unknown[]; cursor: number };
  expect(pullBody.notes).toHaveLength(5);
  expect(pullBody.cursor).toBe(5);
});

test("pull cursor: since=3 only returns later rows", async () => {
  const notes = Array.from({ length: 5 }, (_, i) =>
    note(`019e2110-0000-7000-8000-00000000010${i}`, `n${i}`, "t1")
  );
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes }),
  });

  const pullRes = await fetch(`${baseUrl}/v1/sync/pull?since=3`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const pullBody = (await pullRes.json()) as { notes: { server_seq: number }[]; cursor: number };
  expect(pullBody.notes).toHaveLength(2);
  expect(pullBody.notes.every((n) => n.server_seq > 3)).toBe(true);
});

test("push is idempotent on same uuid (no duplicate)", async () => {
  const n = note("019e2110-0000-7000-8000-000000000200", "dup", "smoke");
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes: [n] }),
  });
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes: [{ ...n, title: "Note dup updated" }] }),
  });

  const pullRes = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const pullBody = (await pullRes.json()) as { notes: { uuid: string; title: string }[] };
  expect(pullBody.notes).toHaveLength(1);
  expect(pullBody.notes[0]!.title).toBe("Note dup updated");
});

test("slug collision: different uuid, same thread+slug → rename with uuid6 suffix", async () => {
  const a = note("019e2110-0000-7000-8000-000000000300", "morning-review", "t-coll");
  const b = note("019e2110-0000-7000-8000-000000000301", "morning-review", "t-coll");
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes: [a] }),
  });
  const pushBRes = await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes: [b] }),
  });
  const pushB = (await pushBRes.json()) as { notes: { uuid: string; canonical_slug: string }[] };
  expect(pushB.notes[0]!.canonical_slug).not.toBe("morning-review");
  expect(pushB.notes[0]!.canonical_slug).toMatch(/^morning-review-[a-f0-9]{6}$/);
});

test("push stamps origin_device_id from authed device (overrides client claim)", async () => {
  const n = note("019e2110-0000-7000-8000-000000000400", "origin-test", "smoke", {
    origin_device_id: "totally-fake-id-from-client",
  });
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes: [n] }),
  });
  const pullRes = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const pullBody = (await pullRes.json()) as { notes: { origin_device_id: string }[] };
  expect(pullBody.notes[0]!.origin_device_id).not.toBe("totally-fake-id-from-client");
  expect(pullBody.notes[0]!.origin_device_id).toMatch(/^[0-9a-f-]{36}$/);
});

test("tags round-trip on push + pull", async () => {
  const n = note("019e2110-0000-7000-8000-000000000500", "tagged", "smoke", {
    tags: ["alpha", "beta", "gamma"],
  });
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes: [n] }),
  });
  const pullRes = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const pullBody = (await pullRes.json()) as { notes: { tags: string[] }[] };
  expect(pullBody.notes[0]!.tags.sort()).toEqual(["alpha", "beta", "gamma"]);
});

test("live entry push + pull preserves order and dedup", async () => {
  const noteUuid = "019e2110-0000-7000-8000-000000000600";
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ notes: [note(noteUuid, "live-1", "smoke", { live: 1 })] }),
  });
  const entries = [
    { id: "ent1", note_uuid: noteUuid, ts: "2026-05-13T11:00:00Z", content_html: "<p>1</p>" },
    { id: "ent2", note_uuid: noteUuid, ts: "2026-05-13T11:01:00Z", content_html: "<p>2</p>" },
  ];
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ live_entries: entries }),
  });
  // Re-push same entries (dedup)
  await fetch(`${baseUrl}/v1/sync/push`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ live_entries: entries }),
  });

  const pullRes = await fetch(`${baseUrl}/v1/sync/pull?since=0`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await pullRes.json()) as { live_entries: { id: string }[] };
  expect(body.live_entries).toHaveLength(2);
  expect(body.live_entries.map((e) => e.id).sort()).toEqual(["ent1", "ent2"]);
});

test("asset upload + GET round-trip + hash mismatch rejected", async () => {
  const { createHash } = await import("node:crypto");
  const bytes = new TextEncoder().encode("fake png bytes");
  const hash = createHash("sha256").update(bytes).digest("hex");
  const upRes = await fetch(`${baseUrl}/v1/sync/assets/${hash}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-folio-filename": "chart.png",
      "x-folio-thread-id": "smoke",
      "content-type": "application/octet-stream",
    },
    body: bytes,
  });
  expect(upRes.status).toBe(200);
  const upBody = (await upRes.json()) as { hash: string; stored: boolean };
  expect(upBody.hash).toBe(hash);
  expect(upBody.stored).toBe(true);

  // Idempotent re-upload
  const upRes2 = await fetch(`${baseUrl}/v1/sync/assets/${hash}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-folio-filename": "chart.png",
      "x-folio-thread-id": "smoke",
      "content-type": "application/octet-stream",
    },
    body: bytes,
  });
  expect(upRes2.status).toBe(200);
  expect(((await upRes2.json()) as { stored: boolean }).stored).toBe(false);

  // GET returns bytes
  const getRes = await fetch(`${baseUrl}/v1/sync/assets/${hash}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(getRes.status).toBe(200);
  expect(getRes.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await getRes.arrayBuffer())).toEqual(bytes);

  // Hash mismatch rejected
  const wrongHash = "0".repeat(64);
  const badRes = await fetch(`${baseUrl}/v1/sync/assets/${wrongHash}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-folio-filename": "chart.png",
      "x-folio-thread-id": "smoke",
      "content-type": "application/octet-stream",
    },
    body: bytes,
  });
  expect(badRes.status).toBe(400);
});
