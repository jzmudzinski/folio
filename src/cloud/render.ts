/**
 * Minimal cloud-side note rendering. Wraps body_html with the requested
 * theme.css and a minimal `<!doctype>` shell. Intentionally simpler than the
 * local viewer (src/viewer/render.ts) — no sidebar, no TOC, no theme switcher,
 * no prev/next-in-thread. The PWA in W3 provides chrome around an iframe that
 * points at /raw/:uuid; capability URLs in W4 render the standalone HTML
 * directly.
 *
 * Theme.css is loaded from the bundled themes dir on the cloud host. If the
 * requested theme is missing, fall back to linen — never 500 on missing theme.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bundledThemesDir } from "../core/config";

function readThemeCss(theme: string): string {
  const candidate = join(bundledThemesDir(), theme, "theme.css");
  if (existsSync(candidate)) return readFileSync(candidate, "utf-8");
  const fallback = join(bundledThemesDir(), "linen", "theme.css");
  if (existsSync(fallback)) return readFileSync(fallback, "utf-8");
  return "";
}

export interface RenderNoteInput {
  title: string;
  theme: string;
  bodyHtml: string;
}

/**
 * Build a standalone HTML page (theme.css inlined, body_html slotted in).
 * This is what cloud serves at /raw/:uuid behind the iframe-isolation CSP.
 * `iframe-isolation` here means: the PWA wraps this in an iframe with
 * sandbox="allow-scripts allow-popups allow-forms" (no allow-same-origin),
 * matching how the local viewer works.
 */
export function renderStandaloneNote(input: RenderNoteInput): string {
  const css = readThemeCss(input.theme);
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en" data-theme="${esc(input.theme)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(input.title)}</title>
  <style>${css}</style>
</head>
<body class="theme theme-${esc(input.theme)}">
  <main class="wrap">
    <article data-folio-content>
${input.bodyHtml}
    </article>
  </main>
</body>
</html>`;
}

/**
 * Outer page for cloud /n/:uuid — wraps /raw/:uuid in an iframe. The PWA in
 * W3 may replace this with its own chrome; the standalone version exists so
 * /n/:uuid works in any plain browser without the PWA layer.
 */
export function renderNotePage(uuid: string, title: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #1a1a1a; }
    iframe { width: 100%; height: 100vh; border: 0; display: block; background: #fff; }
  </style>
</head>
<body>
  <iframe
    src="/raw/${esc(uuid)}"
    sandbox="allow-scripts allow-popups allow-forms"
    referrerpolicy="no-referrer"
    title="${esc(title)}"></iframe>
</body>
</html>`;
}
