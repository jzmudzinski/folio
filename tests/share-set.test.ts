// v0.32: 'set'-scoped shares grant access to a note + the notes it links to.
// The cloud computes the linked set from synced bodies (/n/<id>, transitive +
// bounded) and gates capability access by share_notes membership.

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cloudDb, closeCloudDb, nextSeq } from "../src/cloud/db";
import { createShare, validateShareAccess, getShare, computeLinkedNoteSet } from "../src/cloud/shares";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "folio-shareset-"));
  process.env.FOLIO_CLOUD_HOME = tmp;
  cloudDb().run(
    "INSERT INTO devices (id, name, token_hash, paired_at, user_id) VALUES ('dev1','d','h','2026-05-22T00:00:00Z','default')"
  );
});
afterEach(() => { closeCloudDb(); rmSync(tmp, { recursive: true, force: true }); delete process.env.FOLIO_CLOUD_HOME; });

function seed(uuid: string, body: string) {
  cloudDb().run(
    `INSERT INTO notes (uuid, slug, thread_id, title, type, theme, theme_profile,
       body_html, plain_text, created_at, updated_at, expires_at, is_final, live,
       owner_device_id, origin_device_id, word_count, summary, server_seq)
     VALUES (?, ?, 'th', ?, 'technical', 'linen', 'hosted', ?, '', '2026-05-22T00:00:00Z',
       '2026-05-22T00:00:00Z', NULL, 0, 0, NULL, 'dev1', 0, NULL, ?)`,
    [uuid, uuid.toLowerCase(), `Note ${uuid}`, body, nextSeq(cloudDb())]
  );
}

const ROOT = "01HROOT0000000000000000000";
const B = "01HB00000000000000000000BB";
const C = "01HC00000000000000000000CC";
const D = "01HD00000000000000000000DD";

test("computeLinkedNoteSet follows /n/ links transitively, excludes root + unlinked, cycle-safe", () => {
  seed(ROOT, `<p><a href="/n/${B}">B</a> and <a href="/n/${C}">C</a></p>`);
  seed(B, `<p>leaf</p>`);
  seed(C, `<p><a href="/n/${ROOT}">back to root</a></p>`);
  seed(D, `<p>nobody links me</p>`);
  const set = computeLinkedNoteSet(ROOT, "default", cloudDb());
  expect(set.sort()).toEqual([B, C].sort());
});

test("computeLinkedNoteSet skips dangling/foreign links (no leak)", () => {
  seed(ROOT, `<p><a href="/n/01HGHOST000000000000000000">ghost</a></p>`);
  expect(computeLinkedNoteSet(ROOT, "default", cloudDb())).toEqual([]);
});

test("createShare set → share_notes = root + linked; access gated by membership", () => {
  seed(ROOT, `<p><a href="/n/${B}">B</a></p>`);
  seed(B, `<p>leaf</p>`);
  seed(D, `<p>unrelated</p>`);
  const share = createShare({ user_id: "default", scope_type: "set", scope_id: ROOT, created_by_device: "dev1" });
  expect(share.scope_type).toBe("set");

  const members = cloudDb()
    .query<{ note_uuid: string }, [string]>("SELECT note_uuid FROM share_notes WHERE token = ?")
    .all(share.token)
    .map((r) => r.note_uuid);
  expect(members.sort()).toEqual([ROOT, B].sort());

  const got = getShare(share.token, cloudDb());
  expect(validateShareAccess(got, { type: "note", uuid: ROOT }, cloudDb()).ok).toBe(true);
  expect(validateShareAccess(got, { type: "note", uuid: B }, cloudDb()).ok).toBe(true);
  expect(validateShareAccess(got, { type: "note", uuid: D }, cloudDb()).ok).toBe(false);
});

test("set share denies thread-scope requests (it's a note bundle)", () => {
  seed(ROOT, "<p>x</p>");
  const share = createShare({ user_id: "default", scope_type: "set", scope_id: ROOT, created_by_device: "dev1" });
  const got = getShare(share.token, cloudDb());
  expect(validateShareAccess(got, { type: "thread", thread_id: "th" }, cloudDb()).ok).toBe(false);
});
