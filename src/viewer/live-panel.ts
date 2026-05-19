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
 *
 * `noteId` is baked into the iframe so the kanban view can persist its
 * toggle choice per note in localStorage and send `move` messages back
 * to chrome with a stable identifier.
 */
export function panelIframeSrcdoc(args: { theme_css: string; entries_css: string; noteId: string }): string {
  const noteIdLit = JSON.stringify(args.noteId);
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${args.theme_css}</style>
<style>${args.entries_css}</style>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: inherit; padding: 18px 20px 80px; min-height: 100vh; box-sizing: border-box; }
  .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 14px; flex-wrap: wrap; }
  .panel-title { font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-muted, rgba(0,0,0,0.55)); margin: 0; font-weight: 600; }
  .panel-count { opacity: 0.6; font-weight: 400; margin-left: 4px; }
  .feed-empty { font-style: italic; color: var(--text-muted, rgba(0,0,0,0.5)); padding: 24px 0; }

  /* v0.25 — view toggle. Hidden until at least one entry carries state:*.
     The pair-button shape matches the iteration density toolbar (v0.22.3). */
  .view-toggle { display: inline-flex; gap: 0; border: 1px solid var(--text-muted, rgba(0,0,0,0.18)); border-radius: 6px; overflow: hidden; font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 10.5px; letter-spacing: 0.06em; }
  .view-toggle[hidden] { display: none; }
  .view-toggle__btn { background: transparent; border: 0; padding: 4px 10px; cursor: pointer; color: var(--text-muted, rgba(0,0,0,0.55)); border-right: 1px solid var(--text-muted, rgba(0,0,0,0.15)); font-family: inherit; font-size: inherit; }
  .view-toggle__btn:last-child { border-right: 0; }
  .view-toggle__btn:hover { color: var(--accent, #ff5a1f); background: rgba(255,90,31,0.06); }
  .view-toggle__btn.is-active { background: var(--accent, #ff5a1f); color: #fff; }

  /* Kanban swim lanes */
  .kanban[hidden] { display: none; }
  .kanban { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 6px; }
  @media (max-width: 720px) { .kanban { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 480px) { .kanban { grid-template-columns: 1fr; } }
  .lane { background: rgba(10,10,10,0.025); border-radius: 8px; padding: 10px 10px 12px; min-height: 60px; }
  @media (prefers-color-scheme: dark) { .lane { background: rgba(245,243,238,0.04); } }
  .lane__head { font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted, rgba(0,0,0,0.5)); font-weight: 600; padding: 4px 6px 8px; display: flex; justify-content: space-between; align-items: baseline; }
  .lane__head .lane-cnt { background: rgba(10,10,10,0.08); color: rgba(0,0,0,0.6); padding: 1px 6px; border-radius: 9px; font-size: 9.5px; }
  @media (prefers-color-scheme: dark) { .lane__head .lane-cnt { background: rgba(245,243,238,0.1); color: rgba(245,243,238,0.7); } }
  .lane[data-state="open"] .lane__head { color: var(--accent, #ff5a1f); }
  .lane[data-state="in_progress"] .lane__head { color: #2c4ad9; }
  .lane[data-state="done"] .lane__head { color: #2f9050; }
  .lane[data-state="cancelled"] .lane__head { color: #c8412a; }
  .kard { background: var(--surface, #fff); border: 1px solid var(--text-muted, rgba(0,0,0,0.08)); border-radius: 6px; padding: 8px 10px; margin-bottom: 6px; display: flex; flex-direction: column; gap: 6px; cursor: grab; transition: opacity .15s, transform .15s, box-shadow .15s; }
  @media (prefers-color-scheme: dark) { .kard { background: rgba(245,243,238,0.06); border-color: rgba(245,243,238,0.12); } }
  .kard:active { cursor: grabbing; }
  .kard.is-dragging { opacity: 0.4; transform: scale(0.97); }
  .lane.is-drop-target { background: rgba(255,90,31,0.08); box-shadow: inset 0 0 0 2px var(--accent, #ff5a1f); }
  .lane.is-drop-target .lane__head { color: var(--accent, #ff5a1f) !important; }
  .kard__body { font-size: 12.5px; line-height: 1.4; color: var(--ink, #0a0a0a); }
  @media (prefers-color-scheme: dark) { .kard__body { color: var(--ink, #f0f0eb); } }
  .kard__body * { max-width: 100%; }
  .kard__body p { margin: 0 0 4px; }
  .kard__meta { font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 9.5px; color: var(--text-muted, rgba(0,0,0,0.5)); display: flex; gap: 8px; flex-wrap: wrap; }
  .kard.is-done .kard__body { text-decoration: line-through; opacity: 0.62; }
  .kard.is-cancelled .kard__body { opacity: 0.45; }
  .kard__moves { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
  .kard__moves button { background: transparent; border: 1px solid var(--text-muted, rgba(0,0,0,0.15)); color: var(--text-muted, rgba(0,0,0,0.55)); font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 9.5px; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 4px; cursor: pointer; }
  .kard__moves button:hover { color: var(--accent, #ff5a1f); border-color: var(--accent, #ff5a1f); }
  .kard__moves button.busy { opacity: 0.5; cursor: wait; }
</style>
</head><body class="wrap">
<header class="panel-head">
  <h3 class="panel-title">Live feed <span class="panel-count" data-count></span></h3>
  <div class="view-toggle" data-view-toggle hidden role="group" aria-label="View mode">
    <button type="button" class="view-toggle__btn is-active" data-view="feed">Feed</button>
    <button type="button" class="view-toggle__btn" data-view="kanban">Kanban</button>
  </div>
</header>
<section class="feed-view" data-feed-view>
  <section class="entries-pinned" hidden><h3>Pinned</h3><div data-pinned></div></section>
  <section class="entries-feed" data-feed></section>
  <div class="feed-empty" data-empty hidden>No entries yet — append via folio.append_entry or <code>folio append</code>.</div>
</section>
<section class="kanban" data-kanban hidden></section>
<script>window.__folioPanelNoteId = ${noteIdLit};</script>
<script>${PANEL_RENDER_JS}</script>
</body></html>`;
}

// Script that lives inside the panel iframe. Receives compiled entries
// via postMessage from chrome, re-renders pinned rail + chronological
// feed. No SSE here — that lives in chrome. No CSS work — relies on
// theme.css + entries.css already loaded by parent <style> blocks above.
const PANEL_RENDER_JS = `
(function () {
  var noteId = window.__folioPanelNoteId || "";
  var pinnedWrap = document.querySelector(".entries-pinned");
  var pinnedEl = document.querySelector("[data-pinned]");
  var feedEl = document.querySelector("[data-feed]");
  var feedView = document.querySelector("[data-feed-view]");
  var emptyEl = document.querySelector("[data-empty]");
  var countEl = document.querySelector("[data-count]");
  var toggleEl = document.querySelector("[data-view-toggle]");
  var kanbanEl = document.querySelector("[data-kanban]");
  var toggleBtns = document.querySelectorAll(".view-toggle__btn");

  // v0.25 — per-note view preference. Defaults to "feed" when no state:* tags
  // are seen, switches to whatever the user toggled when state-tagged entries
  // exist. Choice persists across reloads.
  var storageKey = "folio-panel-view:" + noteId;
  var currentMode = "feed";
  try {
    var saved = localStorage.getItem(storageKey);
    if (saved === "kanban" || saved === "feed") currentMode = saved;
  } catch (_) {}

  // Cache the last compiled set so the toggle can re-render without waiting
  // for chrome to push another snapshot.
  var lastCompiled = [];

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

  // Kanban: group by compiled state. Default state is "open" — entries with
  // no state tag at all also live in the open lane (matches the SKILL tag
  // table: state:open is the default no-decoration state).
  var LANES = [
    { state: "open",        label: "Open" },
    { state: "in_progress", label: "In progress" },
    { state: "done",        label: "Done" },
    { state: "cancelled",   label: "Cancelled" },
  ];
  // Move buttons offered per current state. open/in_progress/done/cancelled
  // map to short labels; reopen is always available from terminal states.
  var MOVES = {
    open:        [["in_progress", "→ in prog"], ["done", "→ done"], ["cancelled", "✕ cancel"]],
    in_progress: [["done", "→ done"], ["open", "← open"], ["cancelled", "✕ cancel"]],
    done:        [["open", "↶ reopen"]],
    cancelled:   [["open", "↶ reopen"]],
  };

  function renderKanban(compiled) {
    // Only rendered entries (skip pure tag-mutation follow-ups). Pin tag is
    // unrelated to kanban — pinned items still appear in their state lane.
    var byState = { open: [], in_progress: [], done: [], cancelled: [] };
    var unmoved = [];
    for (var i = 0; i < compiled.length; i++) {
      var c = compiled[i];
      if (!c.rendered) continue;
      var s = c.state || "open";
      if (!byState[s]) { unmoved.push(c); continue; }
      byState[s].push(c);
    }
    return LANES.map(function (lane) {
      var items = (byState[lane.state] || []).map(function (c) {
        var moves = (MOVES[lane.state] || []).map(function (m) {
          return '<button type="button" data-move-entry="' + esc(c.id) + '" data-move-state="' + m[0] + '">' + esc(m[1]) + '</button>';
        }).join("");
        var cls = "kard";
        if (lane.state === "done") cls += " is-done";
        if (lane.state === "cancelled") cls += " is-cancelled";
        var ts = (c.ts || "").slice(0, 16).replace("T", " ");
        return '<div class="' + cls + '" data-entry-id="' + esc(c.id) + '" draggable="true">' +
          '<div class="kard__body">' + c.content_html + '</div>' +
          '<div class="kard__meta"><span>' + esc(ts) + '</span>' + (c.pinned ? '<span>★ pinned</span>' : '') + '</div>' +
          (moves ? '<div class="kard__moves">' + moves + '</div>' : '') +
          '</div>';
      }).join("");
      return '<div class="lane" data-state="' + lane.state + '" data-lane-state="' + lane.state + '">' +
        '<div class="lane__head"><span>' + esc(lane.label) + '</span><span class="lane-cnt">' + (byState[lane.state] || []).length + '</span></div>' +
        items +
        '</div>';
    }).join("");
  }

  function applyMode() {
    if (!feedView || !kanbanEl) return;
    if (currentMode === "kanban") {
      feedView.hidden = true;
      kanbanEl.hidden = false;
    } else {
      feedView.hidden = false;
      kanbanEl.hidden = true;
    }
    toggleBtns.forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-view") === currentMode);
    });
  }

  function rerender(compiled) {
    lastCompiled = compiled;
    var rendered = compiled.filter(function (c) { return c.rendered; });
    // v0.28 — newest-first within each section. compile() upstream sorts ASC
    // for correct ref application; here we reverse for display.
    var pinned = rendered.filter(function (c) { return c.pinned; }).slice().reverse();
    var rest = rendered.filter(function (c) { return !c.pinned; }).slice().reverse();
    countEl.textContent = rendered.length;
    pinnedWrap.hidden = pinned.length === 0;
    pinnedEl.innerHTML = pinned.map(renderEntry).join("");
    feedEl.innerHTML = rest.map(renderEntry).join("");
    emptyEl.hidden = rendered.length > 0;
    // Toggle visibility: only if at least one entry has a state:* tag.
    var hasState = false;
    for (var i = 0; i < rendered.length; i++) {
      if (rendered[i].state) { hasState = true; break; }
    }
    if (toggleEl) toggleEl.hidden = !hasState;
    kanbanEl.innerHTML = renderKanban(compiled);
    // If state tags disappeared (all entries cleaned), revert to feed view.
    if (!hasState && currentMode === "kanban") {
      currentMode = "feed";
      try { localStorage.setItem(storageKey, "feed"); } catch (_) {}
    }
    applyMode();
  }

  // Toggle clicks. Per-note persistence; uses the cached compiled set so we
  // don't wait for the next SSE push to swap views.
  toggleBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      var v = b.getAttribute("data-view");
      if (v !== "feed" && v !== "kanban") return;
      currentMode = v;
      try { localStorage.setItem(storageKey, v); } catch (_) {}
      applyMode();
    });
  });

  // Move buttons on kanban cards. Sandbox blocks our own fetch — push the
  // intent up to chrome via postMessage; chrome calls /api/notes/:id/entries.
  kanbanEl.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest && e.target.closest("[data-move-entry]");
    if (!btn) return;
    var entryId = btn.getAttribute("data-move-entry");
    var newState = btn.getAttribute("data-move-state");
    if (!entryId || !newState) return;
    btn.classList.add("busy");
    btn.disabled = true;
    try {
      parent.postMessage({ ns: "folio-feed", type: "move", entry_id: entryId, state: newState }, "*");
    } catch (_) {
      btn.classList.remove("busy");
      btn.disabled = false;
    }
  });

  // v0.27 — HTML5 drag-and-drop. Cards carry draggable=true; on drop into
  // a different lane, fire the same move postMessage as the buttons.
  // Same-lane drop is a no-op (no API roundtrip for "nothing changed").
  var draggingId = null;
  kanbanEl.addEventListener("dragstart", function (e) {
    var card = e.target && e.target.closest && e.target.closest(".kard");
    if (!card) return;
    draggingId = card.getAttribute("data-entry-id");
    card.classList.add("is-dragging");
    try { e.dataTransfer.setData("text/plain", draggingId); e.dataTransfer.effectAllowed = "move"; } catch (_) {}
  });
  kanbanEl.addEventListener("dragend", function (e) {
    var card = e.target && e.target.closest && e.target.closest(".kard");
    if (card) card.classList.remove("is-dragging");
    Array.prototype.forEach.call(kanbanEl.querySelectorAll(".lane.is-drop-target"), function (l) {
      l.classList.remove("is-drop-target");
    });
    draggingId = null;
  });
  kanbanEl.addEventListener("dragover", function (e) {
    var lane = e.target && e.target.closest && e.target.closest(".lane");
    if (!lane || !draggingId) return;
    e.preventDefault(); // signal "drop allowed here"
    try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
    if (!lane.classList.contains("is-drop-target")) {
      // Only highlight one lane at a time
      Array.prototype.forEach.call(kanbanEl.querySelectorAll(".lane.is-drop-target"), function (l) {
        l.classList.remove("is-drop-target");
      });
      lane.classList.add("is-drop-target");
    }
  });
  kanbanEl.addEventListener("dragleave", function (e) {
    var lane = e.target && e.target.closest && e.target.closest(".lane");
    // Only clear highlight when leaving the lane entirely (not when hovering
    // a child element inside it).
    if (lane && !lane.contains(e.relatedTarget)) {
      lane.classList.remove("is-drop-target");
    }
  });
  kanbanEl.addEventListener("drop", function (e) {
    var lane = e.target && e.target.closest && e.target.closest(".lane");
    if (!lane) return;
    e.preventDefault();
    var newState = lane.getAttribute("data-lane-state");
    var entryId = draggingId;
    lane.classList.remove("is-drop-target");
    if (!entryId || !newState) return;
    // Detect same-lane drop: card's current lane equals target lane.
    var sourceLane = kanbanEl.querySelector('.kard[data-entry-id="' + entryId + '"]');
    if (sourceLane) {
      var srcLaneEl = sourceLane.closest(".lane");
      if (srcLaneEl && srcLaneEl.getAttribute("data-lane-state") === newState) return;
    }
    try {
      parent.postMessage({ ns: "folio-feed", type: "move", entry_id: entryId, state: newState }, "*");
    } catch (_) {}
  });

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

  var entries = [];          // raw LiveEntry[] (deduped)
  var seenIds = Object.create(null);  // id → true; prevents duplicate inserts
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
    } else if (d.type === "move" && d.entry_id && d.state) {
      // v0.25 — kanban move click. Append a tag-only follow-up entry that
      // mutates the target's compiled state via refs + state:<new>. SSE will
      // re-deliver the new entry and the panel re-renders into the new lane.
      fetch("/api/notes/" + encodeURIComponent(noteId) + "/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content_html: "",
          tags: ["state:" + d.state],
          refs: [d.entry_id],
        }),
      }).catch(function () { /* SSE reconnects; even a network hiccup recovers */ });
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
      // Dedupe by entry.id. EventSource auto-reconnects on transport
      // hiccups and the server re-emits the full backlog on every fresh
      // subscription — without this guard, every reconnect would push
      // duplicates of every entry into the compiled feed.
      if (entry && entry.id && !seenIds[entry.id]) {
        seenIds[entry.id] = true;
        entries.push(entry);
        if (panelReady) sendCompiled();
      }
    } catch (_) { /* ignore corrupt frame */ }
  });
  // EventSource auto-reconnects on transport errors; no handler needed.
})();
</script>`;
