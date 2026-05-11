import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb } from "../src/core/db";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "folio-skill-test-"));
  process.env.FOLIO_HOME = tmpDir;
  const { init } = await import("../src/cli/commands/init");
  await init();
});

afterEach(() => {
  closeDb();
  rmSync(tmpDir, { recursive: true, force: true });
});

const EXAMPLES_DIR = join(import.meta.dir, "..", "skills", "folio", "examples");

function getExampleDirs(): string[] {
  if (!existsSync(EXAMPLES_DIR)) return [];
  return readdirSync(EXAMPLES_DIR);
}

test("examples folder exists with 4 typed examples", () => {
  const dirs = getExampleDirs();
  expect(dirs).toContain("research");
  expect(dirs).toContain("comparison");
  expect(dirs).toContain("technical");
  expect(dirs).toContain("snippet");
});

for (const name of ["research", "comparison", "technical", "snippet"]) {
  test(`example "${name}" creates a sanitized note with no inline styles`, async () => {
    const { createNote } = await import("../src/core/storage");
    const { db } = await import("../src/core/db");

    const htmlPath = join(EXAMPLES_DIR, name, "output.html");
    expect(existsSync(htmlPath)).toBe(true);
    const body = readFileSync(htmlPath, "utf-8");

    const note = await createNote({
      type: name as any,
      title: `Example ${name}`,
      body_html: body,
      thread_id: `ex-${name}`,
    });
    expect(note.id).toBeTruthy();

    // Check analytics — examples should have zero inline_style usage
    const ev = db()
      .query<{ data: string }, [string]>(
        "SELECT data FROM events WHERE kind = 'note_created' AND note_id = ?"
      )
      .get(note.id);
    expect(ev).toBeTruthy();
    const payload = JSON.parse(ev!.data);
    expect(payload.inline_style_count).toBe(0);
    expect(payload.sanitizer_drops).toBeLessThanOrEqual(50); // small noise OK
    expect(payload.class_count).toBeGreaterThan(0);
  });
}

test("SKILL.md exists with frontmatter", () => {
  const skillPath = join(import.meta.dir, "..", "skills", "folio", "SKILL.md");
  expect(existsSync(skillPath)).toBe(true);
  const content = readFileSync(skillPath, "utf-8");
  expect(content).toMatch(/^---\nname: folio\n/);
  expect(content).toContain("description:");
});

test("STYLEBOOK.md exists and lists utility classes", () => {
  const stylePath = join(import.meta.dir, "..", "skills", "folio", "STYLEBOOK.md");
  expect(existsSync(stylePath)).toBe(true);
  const content = readFileSync(stylePath, "utf-8");
  for (const cls of [".eyebrow", ".lead", ".pill", ".card", ".cards", ".verdict"]) {
    expect(content).toContain(cls);
  }
});
