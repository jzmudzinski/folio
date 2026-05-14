/**
 * Iteration note renderer (v0.18+).
 *
 * Produces the full body HTML for /raw/:id when note.type === "iteration":
 *   - The agent's static body_html chrome (extracted from <article
 *     data-folio-content>…</article>) sits at the top
 *   - Below: gallery of current round's variants, each rendered into its
 *     own sandboxed sub-iframe via srcdoc so per-variant CSS/JS stays
 *     isolated from siblings
 *   - Below that: breadcrumb of past picks (variant labels + a tiny
 *     thumbnail strip)
 *   - When current_round is null (round picked, waiting for agent to
 *     propose next), shows a calm "waiting for next round" state
 *
 * Click handling: variant cards postMessage `{ns:'folio',
 * type:'iteration-pick', variant_id}` up to the parent viewer chrome.
 * Parent fetches `/api/notes/:id/iter/pick`, reloads the iframe on
 * success. We don't use SSE/parent re-render mid-flight in v0.18 — full
 * iframe reload is simpler and the round-pick latency is low enough that
 * users won't notice.
 */

import type { IterationState, Variant } from "../core/iteration";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function extractChrome(fullHtml: string): string {
  // Pull the agent's body fragment out of <article data-folio-content>…</article>.
  // Same shape rendered by templates/_base.html.eta.
  const m = fullHtml.match(/<article[^>]*data-folio-content[^>]*>([\s\S]*?)<\/article>/);
  return m && m[1] ? m[1].trim() : "";
}

function renderVariantCard(v: Variant, currentRound: number, readonly: boolean): string {
  // Each variant's content_html runs inside its own sandboxed sub-iframe.
  // Same allow-list as the outer note iframe but more conservative: no
  // allow-popups/forms/modals — these are designs, not interactive widgets.
  // The card itself (parent-iframe DOM) carries the click handler.
  const isPicked = v.state === "picked";
  const isRejected = v.state === "rejected";
  const isOpen = v.state === "open";
  const stateClass = isPicked ? "picked" : isRejected ? "rejected" : "open";
  // Read-only viewers (cloud / shared link) never get pick buttons or
  // role=button — the pick happens on the device that owns the note.
  const interactive = !readonly && isOpen && v.round === currentRound;
  const label = v.label || `variant ${v.id.slice(0, 4)}`;
  return `
    <article class="iter-card iter-card--${stateClass}" data-variant-id="${esc(v.id)}"${interactive ? ' role="button" tabindex="0"' : ""}>
      <iframe class="iter-card__preview" sandbox="allow-scripts" srcdoc="${esc(wrapVariantSrcdoc(v.content_html))}" title="${esc(label)}"></iframe>
      <div class="iter-card__meta">
        <span class="iter-card__label">${esc(label)}</span>
        <span class="iter-card__state">${isPicked ? "✓ picked" : isRejected ? "✗ skipped" : "open"}</span>
      </div>
      ${interactive ? `<button type="button" class="iter-card__pick" data-variant-id="${esc(v.id)}">Pick this</button>` : ""}
    </article>`;
}

function wrapVariantSrcdoc(contentHtml: string): string {
  // Minimal scaffold for the variant preview sub-iframe: reset, baseline
  // typography, dark-mode adapt. The agent's content_html drops in below
  // and can override anything.
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;font-family:'Familjen Grotesk',-apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;background:#fff;color:#0a0a0a;line-height:1.5;height:100%}
    @media (prefers-color-scheme: dark){html,body{background:#0e0e0d;color:#f0f0eb}}
    body{padding:16px;font-size:13px}
    h1,h2,h3,h4{font-weight:500;letter-spacing:-0.01em;margin:0 0 8px;line-height:1.2}
    h1{font-size:1.4em}h2{font-size:1.2em}h3{font-size:1.05em}
    p{margin:0 0 6px}
    a{color:inherit;border-bottom:1px solid currentColor;text-decoration:none}
  </style></head><body>${contentHtml}</body></html>`;
}

function renderBreadcrumb(lineage: Variant[]): string {
  if (lineage.length === 0) return "";
  const items = lineage.map((v, i) => {
    const label = v.label || `variant ${v.id.slice(0, 4)}`;
    return `<span class="iter-bc__step"><span class="iter-bc__round">R${v.round}</span><span class="iter-bc__name">${esc(label)}</span></span>${i < lineage.length - 1 ? '<span class="iter-bc__arrow">→</span>' : ""}`;
  }).join("");
  return `<nav class="iter-bc" aria-label="Iteration lineage"><span class="iter-bc__label">Lineage</span>${items}</nav>`;
}

/**
 * Build /raw/:id body for an iteration note.
 * Caller wraps in the standard /raw/ doctype + theme.css + sanitize-html
 * pass at create time; this just produces the HTML fragment.
 */
export function renderIterationRaw(args: {
  noteId: string;
  title: string;
  chromeHtml: string;
  state: IterationState;
  readonly?: boolean;
}): string {
  const { state } = args;
  const readonly = args.readonly === true;
  const current = state.current_round;
  const headSuffix = readonly && current
    ? ' <span class="iter-gallery__readonly">read-only · owner picks</span>'
    : "";
  const headCount = readonly
    ? `${current?.variants.length ?? 0} variants`
    : `${current?.variants.length ?? 0} variants · pick one to advance`;
  const gallery = current
    ? `<section class="iter-gallery">
        <header class="iter-gallery__head">
          <span class="iter-gallery__round">Round ${current.round}</span>
          <span class="iter-gallery__count">${headCount}</span>${headSuffix}
        </header>
        <div class="iter-gallery__grid">
          ${current.variants.map((v) => renderVariantCard(v, current.round, readonly)).join("\n")}
        </div>
      </section>`
    : state.rounds.length === 0
      ? `<section class="iter-empty">
          <p class="iter-empty__lead">No variants yet.</p>
          <p class="iter-empty__hint">The agent will call <code>propose_round</code> to drop in the first batch of design candidates — refresh this page when it's been kicked off.</p>
        </section>`
      : `<section class="iter-empty">
          <p class="iter-empty__lead">✓ Round ${state.rounds[state.rounds.length - 1]!.round} picked. Waiting for the agent to propose round ${state.rounds[state.rounds.length - 1]!.round + 1}…</p>
          <p class="iter-empty__hint">Refresh the page when the new round lands.</p>
        </section>`;

  const breadcrumb = renderBreadcrumb(state.lineage);

  const css = `<style>
    .iter-page{max-width:1100px;margin:0 auto;padding:0 28px 60px}
    .iter-chrome{margin:0 0 28px}
    .iter-gallery__head{display:flex;align-items:baseline;gap:14px;margin:0 0 14px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted,#6b6b66)}
    .iter-gallery__round{color:var(--accent,#ff5a1f);font-weight:600}
    .iter-gallery__grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}
    @media (max-width:640px){.iter-gallery__grid{grid-template-columns:1fr}}
    .iter-card{background:#fff;border:2px solid rgba(10,10,10,0.10);border-radius:12px;overflow:hidden;display:flex;flex-direction:column;transition:transform .15s,border-color .15s,opacity .25s;position:relative}
    @media (prefers-color-scheme: dark){.iter-card{background:#1a1a18;border-color:rgba(255,255,255,0.10)}}
    .iter-card--open[role="button"]:hover{border-color:var(--accent,#ff5a1f);transform:translateY(-2px);cursor:pointer}
    .iter-card--picked{border-color:#2f9050;border-width:3px}
    .iter-card--rejected{opacity:0.32;pointer-events:none}
    .iter-card__preview{width:100%;aspect-ratio:3/2;border:0;display:block;background:#fafaf7}
    @media (prefers-color-scheme: dark){.iter-card__preview{background:#0e0e0d}}
    .iter-card__meta{padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(10,10,10,0.06);font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;color:var(--muted,#6b6b66)}
    @media (prefers-color-scheme: dark){.iter-card__meta{border-color:rgba(255,255,255,0.06)}}
    .iter-card__label{font-weight:600;color:var(--ink-2,#1a1a1a);letter-spacing:0.04em}
    @media (prefers-color-scheme: dark){.iter-card__label{color:#d4d4cf}}
    .iter-card--picked .iter-card__state{color:#2f9050}
    .iter-card--rejected .iter-card__state{color:#c8412a}
    .iter-card__pick{margin:8px 14px 14px;padding:8px 14px;font-family:'Familjen Grotesk',sans-serif;font-weight:500;font-size:13px;background:#0a0a0a;color:#f5f3ee;border:0;border-radius:7px;cursor:pointer}
    @media (prefers-color-scheme: dark){.iter-card__pick{background:#ff5a1f;color:#0a0a0a}}
    .iter-card__pick:hover{background:#ff5a1f;color:#0a0a0a}
    .iter-bc{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:32px 0 0;padding:14px 18px;background:rgba(10,10,10,0.03);border:1px solid rgba(10,10,10,0.08);border-radius:10px;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11.5px}
    @media (prefers-color-scheme: dark){.iter-bc{background:rgba(255,255,255,0.03);border-color:rgba(255,255,255,0.08)}}
    .iter-bc__label{color:var(--muted,#6b6b66);letter-spacing:0.12em;text-transform:uppercase;font-size:10px}
    .iter-bc__step{display:inline-flex;gap:6px;align-items:baseline}
    .iter-bc__round{color:var(--accent,#ff5a1f);font-weight:600}
    .iter-bc__name{color:var(--ink-2,#1a1a1a)}
    @media (prefers-color-scheme: dark){.iter-bc__name{color:#d4d4cf}}
    .iter-bc__arrow{color:var(--muted-2,#a8a89e)}
    .iter-empty{padding:60px 20px;text-align:center;color:var(--muted,#6b6b66);font-family:'Instrument Serif',serif;font-style:italic}
    .iter-empty__lead{font-size:18px;margin:0 0 8px;color:var(--ink-2,#1a1a1a)}
    @media (prefers-color-scheme: dark){.iter-empty__lead{color:#d4d4cf}}
    .iter-empty__hint{font-size:14px;margin:0;line-height:1.55}
    .iter-gallery__readonly{color:var(--muted-2,#a8a89e);font-style:italic;text-transform:none;letter-spacing:0;font-size:11px}
    code{font-family:ui-monospace,monospace;background:rgba(10,10,10,0.06);padding:1px 5px;border-radius:3px;font-size:12.5px}
  </style>`;

  const bootstrap = `<script>
    (function(){
      function postPick(variantId){
        try{
          window.parent.postMessage({ns:'folio',type:'iteration-pick',variant_id:variantId,note_id:${JSON.stringify(args.noteId)}}, '*');
        }catch(_e){}
      }
      document.addEventListener('click', function(ev){
        var card = ev.target.closest && ev.target.closest('.iter-card--open');
        if(!card) return;
        var id = card.getAttribute('data-variant-id');
        if(id) postPick(id);
      });
      document.addEventListener('keydown', function(ev){
        if(ev.key!=='Enter' && ev.key!==' ') return;
        var card = ev.target.closest && ev.target.closest('.iter-card--open');
        if(!card) return;
        ev.preventDefault();
        var id = card.getAttribute('data-variant-id');
        if(id) postPick(id);
      });
    })();
  </script>`;

  // Readonly views skip the click bootstrap entirely — without it there
  // are no event listeners, no parent.postMessage calls. Saves bytes and
  // avoids confusing console errors on cloud/shared contexts where the
  // parent has no /iter/pick endpoint to relay to.
  const tail = readonly ? "" : bootstrap;
  return `${css}
<div class="iter-page">
  ${args.chromeHtml ? `<div class="iter-chrome">${args.chromeHtml}</div>` : ""}
  ${gallery}
  ${breadcrumb}
</div>${tail}`;
}

export { extractChrome };
