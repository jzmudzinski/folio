import { readFileSync, existsSync } from "node:fs";
import { createNote } from "../../core/storage";
import { loadConfig } from "../../core/config";
import { c, out, json } from "../io";
import type { CreateNoteInput, NoteType } from "../../core/types";

interface NewOpts {
  title: string;
  type?: string;
  htmlFile?: string;
  htmlInline?: string;
  thread?: string;
  theme?: string;
  themeProfile?: "hosted" | "standalone";
  tags?: string[];
  isFinal?: boolean;
  jsonOut?: boolean;
}

function validType(t: string | undefined): NoteType {
  const ok: NoteType[] = ["research", "comparison", "technical", "journal", "snippet"];
  if (!t) return "snippet";
  if (!ok.includes(t as NoteType)) throw new Error(`Invalid --type. One of: ${ok.join(", ")}`);
  return t as NoteType;
}

export async function newNote(opts: NewOpts): Promise<number> {
  if (!opts.title) {
    process.stderr.write(c.err("✗ --title required\n"));
    return 3;
  }
  let body_html = "";
  if (opts.htmlFile) {
    if (!existsSync(opts.htmlFile)) {
      process.stderr.write(c.err(`✗ file not found: ${opts.htmlFile}\n`));
      return 4;
    }
    body_html = readFileSync(opts.htmlFile, "utf-8");
  } else if (opts.htmlInline) {
    body_html = opts.htmlInline;
  } else if (!process.stdin.isTTY) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
    body_html = Buffer.concat(chunks).toString("utf-8");
  } else {
    process.stderr.write(c.err("✗ no body — pass --html @file, --html-inline 'string', or pipe stdin\n"));
    return 3;
  }
  if (!body_html.trim()) {
    process.stderr.write(c.err("✗ empty body\n"));
    return 3;
  }

  const cfg = await loadConfig();
  const input: CreateNoteInput = {
    type: validType(opts.type),
    title: opts.title,
    body_html,
    thread_id: opts.thread,
    theme: opts.theme ?? cfg.theme,
    theme_profile: opts.themeProfile ?? "hosted",
    tags: opts.tags,
    is_final: opts.isFinal,
  };

  const note = await createNote(input);
  if (opts.jsonOut) {
    json({ ...note, local_url: `http://${cfg.viewer_host}:${cfg.viewer_port}/n/${note.id}` });
  } else {
    out(c.ok("✓") + ` Created ${c.bold(note.title)}`);
    out(`  ${c.dim("id   ")} ${note.id}`);
    out(`  ${c.dim("type ")} ${note.type}  ${c.dim("theme")} ${note.theme}  ${c.dim("thread")} ${note.thread_id}`);
    out(`  ${c.dim("path ")} ~/Folio/${note.path}`);
    out(`  ${c.dim("url  ")} ${c.cyan(`http://${cfg.viewer_host}:${cfg.viewer_port}/n/${note.id}`)}`);
  }
  return 0;
}
