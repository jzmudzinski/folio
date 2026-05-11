import { Eta } from "eta";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledTemplatesDir, templatesDir } from "./config";
import type { NoteType, RenderProfile } from "./types";

const eta = new Eta({ autoEscape: false, cache: false, useWith: false });

function resolveTemplate(name: string): string {
  const filename = `${name}.html.eta`;
  for (const root of [templatesDir(), bundledTemplatesDir()]) {
    const p = join(root, filename);
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  throw new Error(`Template not found: ${filename} (looked in ${templatesDir()} and ${bundledTemplatesDir()})`);
}

export interface RenderInput {
  id: string;
  type: NoteType;
  title: string;
  body_html: string;
  theme: string;
  theme_css: string;
  theme_profile: RenderProfile;
  tags: string[];
  thread_id: string;
  created: string;
  updated: string;
  is_final: boolean;
  lang?: string;
}

export function renderNote(input: RenderInput): string {
  const data = {
    ...input,
    lang: input.lang ?? "pl",
    metadata: {
      id: input.id,
      type: input.type,
      thread_id: input.thread_id,
      created: input.created,
      updated: input.updated,
      is_final: input.is_final,
      theme: input.theme,
      tags: input.tags,
      schema: 1,
    },
    inline_theme: input.theme_profile === "standalone",
  };
  return eta.renderString(resolveTemplate("_base"), data);
}

export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return eta.renderString(resolveTemplate(template), data);
}
