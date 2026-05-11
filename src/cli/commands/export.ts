import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getNoteMeta, getNoteBySlug, readNoteHtml } from "../../core/storage";
import { themesDir, bundledThemesDir } from "../../core/config";
import { c, out } from "../io";

interface ExportOpts {
  idOrSlug: string;
  standalone?: boolean;
  out?: string;
}

function resolveThemeCss(name: string): string | null {
  for (const root of [themesDir(), bundledThemesDir()]) {
    const p = join(root, name, "theme.css");
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  return null;
}

export async function exportCmd(opts: ExportOpts): Promise<number> {
  if (!opts.idOrSlug) {
    process.stderr.write(c.err("✗ pass note id or slug\n"));
    return 3;
  }
  const note = getNoteMeta(opts.idOrSlug) ?? getNoteBySlug(opts.idOrSlug);
  if (!note) {
    process.stderr.write(c.err(`✗ note not found: ${opts.idOrSlug}\n`));
    return 2;
  }
  let html = readNoteHtml(note);

  if (opts.standalone) {
    const css = resolveThemeCss(note.theme);
    if (!css) {
      process.stderr.write(c.err(`✗ theme not found: ${note.theme}\n`));
      return 4;
    }
    // Replace <link rel="stylesheet" href="/themes/<name>/theme.css"> with inline <style>
    const linkRx = /<link\s+rel="stylesheet"\s+href="\/themes\/[^"]+\/theme\.css">/;
    if (linkRx.test(html)) {
      html = html.replace(linkRx, `<style>\n${css}\n</style>`);
    } else if (!/<style>/.test(html)) {
      // No <link>, no <style>? Inject style block before </head>
      html = html.replace(/<\/head>/, `<style>\n${css}\n</style>\n</head>`);
    }
    // Drop the leading /themes/* path hint from anywhere else (defensive)
  }

  if (opts.out) {
    writeFileSync(opts.out, html, "utf-8");
    out(c.ok("✓") + ` exported to ${c.cyan(opts.out)} (${Math.round(html.length / 1024)} KB${opts.standalone ? ", standalone" : ", hosted"})`);
  } else {
    process.stdout.write(html);
  }
  return 0;
}
