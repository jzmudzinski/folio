// Internal cross-note links must (a) break out of the sandboxed body iframe
// instead of loading the whole viewer inside the note ("Folio-in-Folio"), and
// (b) resolve against the current scope so they survive publish. The body
// iframe relays a {ns:'folio', type:'navigate', href} message; each parent
// shell navigates the TOP window. These tests assert the relay + each shell's
// handler are present (string-level — the runtime behaviour needs a browser).

import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";
import { NOTE_BOOTSTRAP } from "../src/viewer/note-bootstrap";
import { renderStandaloneNote, renderSharedNotePage, renderNotePage } from "../src/cloud/render";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "folio-links-")); process.env.FOLIO_HOME = tmp; });
afterEach(() => { closeDb(); rmSync(tmp, { recursive: true, force: true }); delete process.env.FOLIO_HOME; });

test("note-bootstrap relays internal-link clicks as a navigate message", () => {
  expect(NOTE_BOOTSTRAP).toContain("type: 'navigate'");
  expect(NOTE_BOOTSTRAP).toContain("(n|p|t|tag|threads)");
  // Same-host full URLs are normalised to their path (so a baked-in absolute
  // URL to this viewer host still breaks out instead of opening a dead tab).
  expect(NOTE_BOOTSTRAP).toContain("new URL(href)");
});

test("local viewer parent navigates the top window on a navigate message", async () => {
  const { init } = await import("../src/cli/commands/init");
  await init();
  const { createNote, getNoteMeta } = await import("../src/core/storage");
  const { pageNote } = await import("../src/viewer/render");
  const n = await createNote({ type: "snippet", title: "x", body_html: "<p>x</p>", thread_id: "t", theme: "linen" });
  const html = pageNote(getNoteMeta(n.id)!, "linen");
  expect(html).toContain("case 'navigate'");
  expect(html).toContain("window.location.assign");
});

test("cloud /raw body injects the link interceptor", () => {
  const html = renderStandaloneNote({ theme: "linen", title: "x", bodyHtml: "<p>x</p>" } as any);
  expect(html).toContain("type: 'navigate'");
  expect(html).toContain("(n|p|t|tag|threads)");
});

test("cloud capability page prefixes the token so links stay in-scope", () => {
  const html = renderSharedNotePage("TOK123", "uuid1", "Title");
  expect(html).toContain("'navigate'");
  expect(html).toContain("'/p/' + TOKEN + href");
  expect(html).toContain('"TOK123"');
});

test("cloud PWA shell navigates root-relative on a navigate message", () => {
  const html = renderNotePage("uuid1", "Title");
  expect(html).toContain("'navigate'");
  expect(html).toContain("window.location.assign(href)");
});
