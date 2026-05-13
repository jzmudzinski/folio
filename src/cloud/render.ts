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
 * Outer page for cloud /n/:uuid — JS-driven shell. PUBLIC route (no auth
 * required) that returns this HTML, which then:
 *   1. Reads the bearer token from IndexedDB (origin-scoped, set during pair)
 *   2. Fetches /raw/:uuid with Authorization: Bearer ...
 *   3. Wraps the response body in a Blob and loads it into a sandboxed
 *      iframe via blob: URL.
 *
 * Why not let SW inject the Authorization header for direct iframe src?
 * Two reasons:
 *   - First-navigation race: on a freshly-installed PWA, the user can tap
 *     a note before the SW takes control. Direct fetch in this page avoids
 *     that race entirely — works the moment the JS runs.
 *   - Some browsers reconstruct/normalize navigation requests in ways that
 *     drop the SW-added header. Doing the fetch explicitly sidesteps that.
 *
 * Blob URL + sandbox without `allow-same-origin` = null origin for the
 * iframe content. Body scripts run with no access to folio.notibox.ai
 * cookies/IDB. CSP on the raw response still applies if we set
 * Content-Security-Policy as meta tag in the rendered content. The current
 * raw response is theme'd standalone HTML; we keep the same isolation
 * guarantees as before because the iframe sandbox attribute is the
 * load-bearing piece, not the response headers.
 */
export function renderNotePage(uuid: string, _title: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#1a1a1a">
  <title>Folio</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #1a1a1a; color: #aaa; font-family: 'Familjen Grotesk', system-ui, sans-serif; }
    iframe { width: 100%; height: 100vh; border: 0; display: block; background: #fff; }
    .state { padding: 20vh 20px; text-align: center; font-size: 14px; line-height: 1.6; }
    .state a { color: #ff5a1f; text-decoration: none; }
    .state a:hover { text-decoration: underline; }
    .state .err { color: #ff7a5f; font-size: 13px; margin-top: 8px; opacity: 0.7; }
    .back { position: fixed; top: env(safe-area-inset-top, 0) ; left: 0; padding: 10px 14px; color: #888; text-decoration: none; font-size: 14px; z-index: 10; }
  </style>
</head>
<body>
  <a href="/" class="back" id="back">‹ back</a>
  <div id="state" class="state">Loading…</div>
  <iframe id="frame" sandbox="allow-scripts allow-popups allow-forms" referrerpolicy="no-referrer" style="display: none;"></iframe>
  <script>
(function () {
  var UUID = ${JSON.stringify(uuid)};
  var stateEl = document.getElementById('state');
  var frame = document.getElementById('frame');

  function setError(msg, hint) {
    stateEl.innerHTML = msg + (hint ? '<div class="err">' + hint + '</div>' : '');
    stateEl.style.display = '';
    frame.style.display = 'none';
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open('folio-pwa', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function kvGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction('kv', 'readonly');
        var req = tx.objectStore('kv').get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(undefined); };
      });
    });
  }

  kvGet('token').then(function (token) {
    if (!token) {
      setError('Not paired on this device.', '<a href="/pair">Pair now</a>');
      return;
    }
    return fetch('/raw/' + encodeURIComponent(UUID), {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'text/html' }
    }).then(function (r) {
      if (r.status === 401) {
        setError('Session expired or device revoked.', '<a href="/pair">Pair this device again</a>');
        return null;
      }
      if (r.status === 404) {
        setError('Note not found.', '<a href="/">‹ back to list</a>');
        return null;
      }
      if (!r.ok) {
        setError('Could not load note.', 'HTTP ' + r.status);
        return null;
      }
      return r.text();
    });
  }).then(function (html) {
    if (!html) return;
    var blob = new Blob([html], { type: 'text/html' });
    var blobUrl = URL.createObjectURL(blob);
    frame.onload = function () {
      stateEl.style.display = 'none';
      frame.style.display = 'block';
    };
    frame.src = blobUrl;
  }).catch(function (e) {
    setError('Could not load note.', String(e && e.message || e));
  });
})();
  </script>
</body>
</html>`;
}
