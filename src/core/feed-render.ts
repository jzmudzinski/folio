/**
 * Render compiled live-note entries to HTML. Shared by:
 *   - finalize() — splices the full feed into body_html as a one-shot
 *     compile, then archives the .entries.jsonl sidecar.
 *   - /raw/:uuid serve path for inline_render=1 live notes — splices the
 *     current feed into a <section data-folio-live-feed> placeholder on
 *     every request. Parent chrome then postMessages new entries that
 *     a small bootstrap script appends to the same element in real time.
 *
 * Output classes match what `entries-css.ts` styles (.entry, .entry.pinned,
 * .entry.state-done, .entries-feed, .entries-pinned). Both themes that
 * style entries (linen, folio, terminal, …) inherit the same vocabulary.
 */

import type { CompiledEntry } from "./live";

function esc(s: string): string {
  return String(s).replace(/[<>&"]/g, (ch) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[ch] ?? ch)
  );
}

/** Single entry → `<article class="entry …" data-entry-id="…">…</article>`. */
export function renderEntryHtml(c: CompiledEntry): string {
  const cls = ["entry"];
  if (c.pinned) cls.push("pinned");
  if (c.state) cls.push(`state-${c.state}`);
  const tagsHtml = c.compiled_tags
    .map((t) => `<span class="pill info">${esc(t)}</span>`)
    .join(" ");
  const timeHtml = `<time datetime="${esc(c.ts)}">${esc(c.ts)}</time>`;
  return [
    `<article class="${cls.join(" ")}" data-entry-id="${esc(c.id)}">`,
    `  <header class="meta">${timeHtml} ${tagsHtml}</header>`,
    `  <div class="content">${c.content_html}</div>`,
    `</article>`,
  ].join("\n");
}

/**
 * Compile pinned + chronological feed sections from a set of already-compiled
 * entries. Empty sections are omitted so a fresh live note doesn't render
 * empty boxes.
 *
 * Render order (v0.28+): newest first within each section. compile() upstream
 * sorts ASC so ref-driven tag mutations apply in the right order; here we
 * reverse for display so the latest entry leads — matches the Slack / RSS /
 * Twitter convention. A 12-month-old changelog reads top-down from current
 * release backward; that's the right shape for a feed surface.
 */
export function renderFeedHtml(compiled: CompiledEntry[]): string {
  const pinned = compiled.filter((c) => c.pinned).slice().reverse();
  const rest = compiled.filter((c) => !c.pinned).slice().reverse();
  const pinnedHtml = pinned.length > 0
    ? `<section class="entries-pinned"><h3>Pinned</h3>\n${pinned.map(renderEntryHtml).join("\n")}\n</section>`
    : "";
  const restHtml = rest.length > 0
    ? `<section class="entries-feed">\n${rest.map(renderEntryHtml).join("\n")}\n</section>`
    : "";
  return [pinnedHtml, restHtml].filter(Boolean).join("\n");
}

/**
 * Splice compiled feed HTML into the body's `<section data-folio-live-feed>`
 * placeholder. Idempotent: replacing the section's children on every call
 * keeps the rendered state consistent with the sidecar contents.
 *
 * Match strategy: regex on the data attribute. If the placeholder is missing
 * entirely (agent didn't include it AND it wasn't auto-injected at create
 * time — shouldn't happen, but defensive), append a new section to the end
 * of body.
 */
export function spliceFeedIntoBody(bodyHtml: string, feedHtml: string): string {
  const re = /(<section[^>]*data-folio-live-feed[^>]*>)([\s\S]*?)(<\/section>)/i;
  if (re.test(bodyHtml)) {
    return bodyHtml.replace(re, `$1\n${feedHtml}\n$3`);
  }
  // Defensive fallback — should be unreachable when createNote auto-injects.
  return `${bodyHtml}\n<section data-folio-live-feed>\n${feedHtml}\n</section>`;
}

/**
 * Bootstrap script for inline-rendered live notes. Lives inside the note's
 * body iframe (sandboxed null-origin). Listens for `message` events from
 * the parent viewer chrome (or PWA shell) — each message carries a new
 * entry to append, or a pinned-set update. Re-uses renderEntryHtml's class
 * vocabulary so theme.css + entries.css style new entries identically.
 *
 * No SSE here: the iframe can't open EventSource (null-origin + CSP
 * connect-src 'none'). SSE lives in the parent; data flows down via
 * postMessage. Same pattern as the side-panel iframe.
 */
export const INLINE_FEED_BOOTSTRAP_JS = `
(function () {
  // v0.27 — inline live notes now offer a Kanban toggle alongside the
  // server-rendered feed. The Feed view keeps its append-only behavior:
  // each incoming entry lands at the bottom (or in pinned), DOM grows. The
  // Kanban view maintains its own compiled state in JS and re-renders
  // every time a new entry arrives — that way state:* follow-ups flip
  // cards between lanes without DOM churn on the feed side.
  var noteId = window.__folioInlineNoteId || "";

  function host() { return document.querySelector("section[data-folio-live-feed]"); }
  function ensureSections() {
    var h = host(); if (!h) return null;
    var pinned = h.querySelector(".entries-pinned");
    var feed = h.querySelector(".entries-feed");
    if (!feed) {
      feed = document.createElement("section");
      feed.className = "entries-feed";
      h.appendChild(feed);
    }
    return { host: h, pinned: pinned, feed: feed };
  }
  function escAttr(s) { return String(s).replace(/[<>&"']/g, function(ch){ return ({"<":"&lt;",">":"&gt;","&":"&amp;","\\"":"&quot;","'":"&#39;"})[ch]||ch; }); }
  function renderEntry(c) {
    var cls = ["entry"];
    if (c.pinned) cls.push("pinned");
    if (c.state) cls.push("state-" + c.state);
    var tags = (c.compiled_tags || c.tags || []).map(function(t){ return '<span class="pill info">' + escAttr(t) + '</span>'; }).join(" ");
    var a = document.createElement("article");
    a.className = cls.join(" ");
    a.setAttribute("data-entry-id", c.id);
    a.innerHTML =
      '<header class="meta"><time datetime="' + escAttr(c.ts) + '">' + escAttr(c.ts) + '</time> ' + tags + '</header>' +
      '<div class="content">' + (c.content_html || "") + '</div>';
    return a;
  }
  function appendNewEntry(c) {
    var s = ensureSections(); if (!s) return;
    if (s.host.querySelector('[data-entry-id="' + (c.id || "").replace(/"/g, "") + '"]')) return;
    var el = renderEntry(c);
    // v0.28 — newest-first within each section. Server-side render (initial
    // paint) already reverses; here we prepend so live append also lands at
    // the top of its section instead of appending below older items.
    if (c.pinned) {
      if (!s.pinned) {
        var p = document.createElement("section");
        p.className = "entries-pinned";
        p.innerHTML = "<h3>Pinned</h3>";
        s.host.insertBefore(p, s.feed);
        s.pinned = p;
      }
      // Insert before the first existing entry (or after the <h3>).
      var firstPinned = s.pinned.querySelector("[data-entry-id]");
      if (firstPinned) s.pinned.insertBefore(el, firstPinned);
      else s.pinned.appendChild(el);
    } else {
      var firstFeed = s.feed.querySelector("[data-entry-id]");
      if (firstFeed) s.feed.insertBefore(el, firstFeed);
      else s.feed.appendChild(el);
    }
    try { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_e) {}
  }

  // ── v0.27 kanban state + view toggle ───────────────────────────────
  // Mirror of src/core/live.ts compile() — produces compiled_tags +
  // state + pinned from a raw entry stream. Identical to the panel-mode
  // compile() in live-panel.ts (LIVE_CHROME_JS). Kept verbatim there too
  // for now; an extraction is a separate refactor.
  var rawEntries = [];
  var seenIds = Object.create(null);
  function compile() {
    var sorted = rawEntries.slice().sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
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
      var rendered = (entry.content_html || "").trim().length > 0;
      var c = {};
      for (var key in entry) c[key] = entry[key];
      c.compiled_tags = compiled_tags;
      if (state !== undefined) c.state = state;
      c.pinned = pinned;
      c.rendered = rendered;
      return c;
    });
  }

  // Lazy-mount the toggle + kanban container. Skip if there's no feed
  // placeholder at all (defensive — should always exist in inline mode).
  var toggleEl = null, kanbanEl = null, feedHost = null;
  function mountKanbanUI() {
    if (toggleEl) return;
    feedHost = host(); if (!feedHost) return;
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;justify-content:flex-end;margin:0 0 10px;";
    wrap.innerHTML =
      '<div class="folio-view-toggle" role="group" aria-label="View mode" style="display:inline-flex;border:1px solid rgba(127,127,127,0.25);border-radius:6px;overflow:hidden;font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:0.06em;">' +
      '<button type="button" data-view="feed"   class="folio-view-btn is-active" style="background:transparent;border:0;padding:4px 10px;cursor:pointer;color:rgba(127,127,127,0.7);border-right:1px solid rgba(127,127,127,0.2);font-family:inherit;font-size:inherit;">Feed</button>' +
      '<button type="button" data-view="kanban" class="folio-view-btn"            style="background:transparent;border:0;padding:4px 10px;cursor:pointer;color:rgba(127,127,127,0.7);font-family:inherit;font-size:inherit;">Kanban</button>' +
      '</div>';
    feedHost.parentNode.insertBefore(wrap, feedHost);
    toggleEl = wrap.querySelector(".folio-view-toggle");
    kanbanEl = document.createElement("section");
    kanbanEl.className = "folio-kanban-inline";
    kanbanEl.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:6px;";
    kanbanEl.hidden = true;
    feedHost.parentNode.insertBefore(kanbanEl, feedHost.nextSibling);
    var styles = document.createElement("style");
    styles.textContent = [
      ".folio-view-btn.is-active { background:#ff5a1f !important; color:#fff !important; }",
      ".folio-kanban-inline .lane { background: rgba(127,127,127,0.06); border-radius:8px; padding:10px; min-height:60px; }",
      ".folio-kanban-inline .lane__head { font-family: ui-monospace,monospace; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; font-weight:600; opacity:0.6; padding:4px 6px 8px; display:flex; justify-content:space-between; }",
      '.folio-kanban-inline .lane[data-lane-state="open"] .lane__head { color:#ff5a1f; opacity:1; }',
      '.folio-kanban-inline .lane[data-lane-state="in_progress"] .lane__head { color:#2c4ad9; opacity:1; }',
      '.folio-kanban-inline .lane[data-lane-state="done"] .lane__head { color:#2f9050; opacity:1; }',
      '.folio-kanban-inline .lane[data-lane-state="cancelled"] .lane__head { color:#c8412a; opacity:1; }',
      ".folio-kanban-inline .kard { background: rgba(255,255,255,0.6); border:1px solid rgba(127,127,127,0.15); border-radius:6px; padding:8px 10px; margin-bottom:6px; cursor:grab; transition: opacity .15s, transform .15s; }",
      "@media (prefers-color-scheme: dark) { .folio-kanban-inline .kard { background: rgba(255,255,255,0.06); } }",
      ".folio-kanban-inline .kard.is-done .kard__body { text-decoration: line-through; opacity:0.62; }",
      ".folio-kanban-inline .kard.is-cancelled .kard__body { opacity:0.45; }",
      ".folio-kanban-inline .kard.is-dragging { opacity:0.4; transform:scale(0.97); }",
      ".folio-kanban-inline .lane.is-drop-target { background: rgba(255,90,31,0.08); box-shadow: inset 0 0 0 2px #ff5a1f; }",
      ".folio-kanban-inline .kard__body { font-size:12.5px; line-height:1.4; }",
      ".folio-kanban-inline .kard__meta { font-family: ui-monospace,monospace; font-size:9.5px; opacity:0.55; display:flex; gap:8px; margin-top:6px; }",
      ".folio-kanban-inline .kard__moves { display:flex; gap:4px; flex-wrap:wrap; margin-top:4px; }",
      ".folio-kanban-inline .kard__moves button { background:transparent; border:1px solid rgba(127,127,127,0.25); color:rgba(127,127,127,0.7); font-family: ui-monospace,monospace; font-size:9.5px; padding:2px 7px; border-radius:4px; cursor:pointer; }",
      ".folio-kanban-inline .kard__moves button:hover { color:#ff5a1f; border-color:#ff5a1f; }",
    ].join("\\n");
    document.head.appendChild(styles);

    // Toggle handlers + per-note localStorage.
    var storageKey = "folio-inline-view:" + noteId;
    var currentMode = "feed";
    try {
      var saved = localStorage.getItem(storageKey);
      if (saved === "kanban" || saved === "feed") currentMode = saved;
    } catch (_) {}
    function applyMode() {
      if (currentMode === "kanban") { feedHost.hidden = true; kanbanEl.hidden = false; }
      else { feedHost.hidden = false; kanbanEl.hidden = true; }
      var btns = toggleEl.querySelectorAll(".folio-view-btn");
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle("is-active", btns[i].getAttribute("data-view") === currentMode);
      }
    }
    applyMode();
    toggleEl.addEventListener("click", function (e) {
      var b = e.target && e.target.closest && e.target.closest(".folio-view-btn");
      if (!b) return;
      var v = b.getAttribute("data-view");
      if (v !== "feed" && v !== "kanban") return;
      currentMode = v;
      try { localStorage.setItem(storageKey, v); } catch (_) {}
      applyMode();
    });
  }

  function hasAnyState(compiled) {
    for (var i = 0; i < compiled.length; i++) if (compiled[i].state) return true;
    return false;
  }

  var LANES = [
    { state: "open",        label: "Open" },
    { state: "in_progress", label: "In progress" },
    { state: "done",        label: "Done" },
    { state: "cancelled",   label: "Cancelled" },
  ];
  var MOVES = {
    open:        [["in_progress","→ in prog"],["done","→ done"],["cancelled","✕ cancel"]],
    in_progress: [["done","→ done"],["open","← open"],["cancelled","✕ cancel"]],
    done:        [["open","↶ reopen"]],
    cancelled:   [["open","↶ reopen"]],
  };
  function renderKanban() {
    var compiled = compile();
    if (!hasAnyState(compiled)) { if (toggleEl) toggleEl.style.display = "none"; return; }
    mountKanbanUI();
    if (toggleEl) toggleEl.style.display = "";
    var byState = { open: [], in_progress: [], done: [], cancelled: [] };
    for (var i = 0; i < compiled.length; i++) {
      var c = compiled[i];
      if (!c.rendered) continue;
      var s = c.state || "open";
      if (!byState[s]) continue;
      byState[s].push(c);
    }
    kanbanEl.innerHTML = LANES.map(function (lane) {
      var items = (byState[lane.state] || []).map(function (c) {
        var moves = (MOVES[lane.state] || []).map(function (m) {
          return '<button type="button" data-move-entry="' + escAttr(c.id) + '" data-move-state="' + m[0] + '">' + escAttr(m[1]) + '</button>';
        }).join("");
        var cls = "kard";
        if (lane.state === "done") cls += " is-done";
        if (lane.state === "cancelled") cls += " is-cancelled";
        var ts = (c.ts || "").slice(0, 16).replace("T", " ");
        return '<div class="' + cls + '" data-entry-id="' + escAttr(c.id) + '" draggable="true">' +
          '<div class="kard__body">' + (c.content_html || "") + '</div>' +
          '<div class="kard__meta"><span>' + escAttr(ts) + '</span>' + (c.pinned ? '<span>★ pinned</span>' : '') + '</div>' +
          (moves ? '<div class="kard__moves">' + moves + '</div>' : '') +
          '</div>';
      }).join("");
      return '<div class="lane" data-lane-state="' + lane.state + '">' +
        '<div class="lane__head"><span>' + escAttr(lane.label) + '</span><span>' + (byState[lane.state] || []).length + '</span></div>' +
        items + '</div>';
    }).join("");
  }

  // Click + DnD wiring on the kanban (delegated; runs once at first mount).
  var wiredKanban = false;
  function wireKanban() {
    if (wiredKanban || !kanbanEl) return;
    wiredKanban = true;
    kanbanEl.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest && e.target.closest("[data-move-entry]");
      if (!btn) return;
      var entryId = btn.getAttribute("data-move-entry");
      var newState = btn.getAttribute("data-move-state");
      if (!entryId || !newState) return;
      try { parent.postMessage({ ns: "folio-feed", type: "move", entry_id: entryId, state: newState }, "*"); } catch (_) {}
    });
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
      var hi = kanbanEl.querySelectorAll(".lane.is-drop-target");
      for (var i = 0; i < hi.length; i++) hi[i].classList.remove("is-drop-target");
      draggingId = null;
    });
    kanbanEl.addEventListener("dragover", function (e) {
      var lane = e.target && e.target.closest && e.target.closest(".lane");
      if (!lane || !draggingId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
      if (!lane.classList.contains("is-drop-target")) {
        var existing = kanbanEl.querySelectorAll(".lane.is-drop-target");
        for (var i = 0; i < existing.length; i++) existing[i].classList.remove("is-drop-target");
        lane.classList.add("is-drop-target");
      }
    });
    kanbanEl.addEventListener("dragleave", function (e) {
      var lane = e.target && e.target.closest && e.target.closest(".lane");
      if (lane && !lane.contains(e.relatedTarget)) lane.classList.remove("is-drop-target");
    });
    kanbanEl.addEventListener("drop", function (e) {
      var lane = e.target && e.target.closest && e.target.closest(".lane");
      if (!lane) return;
      e.preventDefault();
      var newState = lane.getAttribute("data-lane-state");
      var entryId = draggingId;
      lane.classList.remove("is-drop-target");
      if (!entryId || !newState) return;
      var sourceCard = kanbanEl.querySelector('.kard[data-entry-id="' + entryId + '"]');
      if (sourceCard) {
        var srcLane = sourceCard.closest(".lane");
        if (srcLane && srcLane.getAttribute("data-lane-state") === newState) return;
      }
      try { parent.postMessage({ ns: "folio-feed", type: "move", entry_id: entryId, state: newState }, "*"); } catch (_) {}
    });
  }

  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || typeof d !== "object") return;
    if (d.ns !== "folio") return;
    if (d.type === "entry" && d.entry) {
      // Feed view: legacy append-to-DOM path.
      appendNewEntry(d.entry);
      // Kanban view: track raw entry + re-render lanes.
      if (d.entry.id && !seenIds[d.entry.id]) {
        seenIds[d.entry.id] = true;
        rawEntries.push(d.entry);
        renderKanban();
        wireKanban();
      }
    }
  });

  // Signal to parent that we're ready to receive entries (parent may have
  // queued some during iframe load).
  try { window.parent.postMessage({ ns: "folio", type: "inline-feed-ready" }, "*"); } catch (_e) {}
})();
`;
