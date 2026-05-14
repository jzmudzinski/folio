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
 */
export function renderFeedHtml(compiled: CompiledEntry[]): string {
  const pinned = compiled.filter((c) => c.pinned);
  const rest = compiled.filter((c) => !c.pinned);
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
  // Find or lazily create the feed/pinned containers inside the placeholder.
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
    // Skip if we already have this id (dedup on slow SSE reconnect replay).
    if (s.host.querySelector('[data-entry-id="' + (c.id || "").replace(/"/g, "") + '"]')) return;
    var el = renderEntry(c);
    if (c.pinned) {
      if (!s.pinned) {
        var p = document.createElement("section");
        p.className = "entries-pinned";
        p.innerHTML = "<h3>Pinned</h3>";
        s.host.insertBefore(p, s.feed);
        s.pinned = p;
      }
      s.pinned.appendChild(el);
    } else {
      s.feed.appendChild(el);
    }
    // Scroll-into-view on the new entry if it's near the bottom.
    try { el.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_e) {}
  }
  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || typeof d !== "object") return;
    if (d.ns !== "folio") return;
    if (d.type === "entry" && d.entry) appendNewEntry(d.entry);
  });
  // Signal to parent that we're ready to receive entries (parent may have
  // queued some during iframe load).
  try { window.parent.postMessage({ ns: "folio", type: "inline-feed-ready" }, "*"); } catch (_e) {}
})();
`;
