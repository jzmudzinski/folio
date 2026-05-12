// Live feed panel — two pieces:
//   1. PANEL_IFRAME_SRCDOC: a self-contained HTML doc that renders the
//      compiled feed inside a sandboxed iframe. Theme.css + entries.css
//      are inlined at render time so the panel inherits the user's
//      theme styling without needing same-origin or CSP relaxations.
//   2. LIVE_CHROME_JS: parent-frame JS that opens EventSource to
//      /n/:id/stream, maintains the raw entry log, computes the
//      compiled state (mirrors src/core/live.ts compile rule), and
//      postMessages the compiled snapshot to the panel iframe on every
//      update.
//
// Same trust model as the body iframe: panel iframe is sandbox-allowed
// scripts but no allow-same-origin → null origin → can't reach parent
// window, cookies, /api/*. SSE lives in chrome (which has the viewer's
// origin), data flows one-way down via postMessage.

/**
 * Build the panel iframe's srcdoc value. Caller pre-escapes if needed;
 * we trust theme_css + entries_css are server-generated.
 */
export function panelIframeSrcdoc(args: { theme_css: string; entries_css: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${args.theme_css}</style>
<style>${args.entries_css}</style>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: inherit; padding: 18px 20px 80px; min-height: 100vh; box-sizing: border-box; }
  .panel-title { font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted, rgba(0,0,0,0.55)); margin: 0 0 14px; font-weight: 600; }
  .panel-count { float: right; opacity: 0.6; font-weight: 400; }
  .feed-empty { font-style: italic; color: var(--text-muted, rgba(0,0,0,0.5)); padding: 24px 0; }
</style>
</head><body class="wrap">
<h3 class="panel-title">Live feed <span class="panel-count" data-count></span></h3>
<section class="entries-pinned" hidden><h3>Pinned</h3><div data-pinned></div></section>
<section class="entries-feed" data-feed></section>
<div class="feed-empty" data-empty hidden>No entries yet — append via folio.append_entry or <code>folio append</code>.</div>
<script>${PANEL_RENDER_JS}</script>
</body></html>`;
}

// Script that lives inside the panel iframe. Receives compiled entries
// via postMessage from chrome, re-renders pinned rail + chronological
// feed. No SSE here — that lives in chrome. No CSS work — relies on
// theme.css + entries.css already loaded by parent <style> blocks above.
const PANEL_RENDER_JS = `
(function () {
  var pinnedWrap = document.querySelector(".entries-pinned");
  var pinnedEl = document.querySelector("[data-pinned]");
  var feedEl = document.querySelector("[data-feed]");
  var emptyEl = document.querySelector("[data-empty]");
  var countEl = document.querySelector("[data-count]");

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function renderEntry(c) {
    var cls = ["entry"];
    if (c.pinned) cls.push("pinned");
    if (c.state) cls.push("state-" + c.state);
    var tagsHtml = (c.compiled_tags || []).map(function (t) {
      return '<span class="pill info">' + esc(t) + '</span>';
    }).join(" ");
    var occurred = c.occurred_at ? ' (' + esc(c.occurred_at) + ')' : '';
    return '<article class="' + cls.join(" ") + '" data-entry-id="' + esc(c.id) + '">' +
      '<header class="meta"><time datetime="' + esc(c.ts) + '">' + esc(c.ts) + '</time>' + occurred + ' ' + tagsHtml + '</header>' +
      '<div class="content">' + c.content_html + '</div>' +
      '</article>';
  }

  function rerender(compiled) {
    var rendered = compiled.filter(function (c) { return c.rendered; });
    var pinned = rendered.filter(function (c) { return c.pinned; });
    var rest = rendered.filter(function (c) { return !c.pinned; });
    countEl.textContent = rendered.length;
    pinnedWrap.hidden = pinned.length === 0;
    pinnedEl.innerHTML = pinned.map(renderEntry).join("");
    feedEl.innerHTML = rest.map(renderEntry).join("");
    emptyEl.hidden = rendered.length > 0;
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.ns !== "folio-feed") return;
    if (d.type === "compiled" && Array.isArray(d.entries)) {
      rerender(d.entries);
    }
  });

  // Signal to parent that the panel is ready to receive the first batch.
  try { parent.postMessage({ ns: "folio-feed", type: "ready" }, "*"); } catch (_) {}
  // Show the empty state immediately so there's no flash of nothing.
  emptyEl.hidden = false;
})();
`;

/**
 * Chrome-side JS injected into the /n/:id page when note.live === true
 * && !is_final. Opens EventSource, mirrors src/core/live.ts compile
 * rule, posts compiled entries to the panel iframe.
 *
 * Note id is baked in at render time (window.__folioLiveNoteId).
 */
export const LIVE_CHROME_JS = `<script>
(function () {
  var noteId = window.__folioLiveNoteId;
  if (!noteId) return;
  var iframe = document.querySelector(".live-panel-iframe");
  if (!iframe) return;

  var entries = [];   // raw LiveEntry[]
  var panelReady = false;

  // Client-side mirror of src/core/live.ts compile().
  function compile() {
    var sorted = entries.slice().sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
    var followupsByTarget = Object.create(null);
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      if (!e.refs) continue;
      for (var j = 0; j < e.refs.length; j++) {
        var t = e.refs[j];
        (followupsByTarget[t] = followupsByTarget[t] || []).push(e);
      }
    }
    return sorted.map(function (entry) {
      var followups = followupsByTarget[entry.id] || [];
      var nsMap = Object.create(null);
      var unNs = Object.create(null);
      var apply = function (tag) {
        var idx = tag.indexOf(":");
        if (idx <= 0) unNs[tag] = true;
        else nsMap[tag.slice(0, idx)] = tag;
      };
      for (var k = 0; k < entry.tags.length; k++) apply(entry.tags[k]);
      for (var fi = 0; fi < followups.length; fi++) {
        var ftags = followups[fi].tags;
        for (var fk = 0; fk < ftags.length; fk++) apply(ftags[fk]);
      }
      var compiled_tags = [];
      for (var nsKey in nsMap) compiled_tags.push(nsMap[nsKey]);
      for (var unKey in unNs) compiled_tags.push(unKey);

      var state, pinned = false;
      for (var ti = 0; ti < compiled_tags.length; ti++) {
        var ct = compiled_tags[ti];
        var ci = ct.indexOf(":");
        if (ci <= 0) continue;
        var ns = ct.slice(0, ci), val = ct.slice(ci + 1);
        if (ns === "state") state = val;
        else if (ns === "view" && val === "pinned") pinned = true;
      }
      var rendered = (entry.content_html || "").replace(/<[^>]+>/g, "").trim().length > 0
        || (entry.content_html || "").trim().length > 0;
      var c = {};
      for (var key in entry) c[key] = entry[key];
      c.compiled_tags = compiled_tags;
      if (state !== undefined) c.state = state;
      c.pinned = pinned;
      c.rendered = rendered;
      return c;
    });
  }

  function sendCompiled() {
    var w = iframe.contentWindow;
    if (!w) return;
    try { w.postMessage({ ns: "folio-feed", type: "compiled", entries: compile() }, "*"); } catch (_) {}
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.ns !== "folio-feed") return;
    if (e.source && e.source !== iframe.contentWindow) return;
    if (d.type === "ready") {
      panelReady = true;
      sendCompiled();
    }
  });

  var es;
  try {
    es = new EventSource("/n/" + noteId + "/stream");
  } catch (_) {
    return;
  }
  es.addEventListener("entry", function (e) {
    try {
      var entry = JSON.parse(e.data);
      entries.push(entry);
      if (panelReady) sendCompiled();
    } catch (_) { /* ignore corrupt frame */ }
  });
  // EventSource auto-reconnects on transport errors; no handler needed.
})();
</script>`;
