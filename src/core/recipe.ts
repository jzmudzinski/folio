/**
 * Recipe template (v0.42) — Folio's first structured template.
 *
 * The agent sends compact structured data (RecipeData) instead of writing
 * full HTML; `renderRecipe` turns it into a SELF-CONTAINED body fragment:
 * its own <style> (responsive, theme-variable-driven) + semantic content +
 * <script> (progressive enhancement). Because the CSS/JS live inside the
 * body, the recipe renders identically everywhere the file travels — local
 * viewer, /raw, export, cloud-published share on a phone — with zero
 * per-context injection (unlike the presentation/iteration render path,
 * which only fires in the local /raw handler and does not reach the cloud).
 *
 * The fragment goes through the normal sanitize → _base → file pipeline.
 * <style>, <script>, data-* all survive default-mode sanitize, so nothing
 * special is needed downstream.
 */
import type { RecipeData, RecipeIngredient, RecipeLabels } from "./types";

const DEFAULT_LABELS: Required<RecipeLabels> = {
  ingredients: "Składniki",
  steps: "Przygotowanie",
  equipment: "Sprzęt",
  tips: "Wskazówki",
  source: "Źródło",
  servings: "Porcje",
};

/** HTML-escape text destined for element content or attribute values. */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Validate the minimum a recipe needs to render usefully. Returns a list of
 * human-readable problems; empty array = valid.
 */
export function validateRecipe(data: unknown): string[] {
  const errors: string[] = [];
  if (typeof data !== "object" || data === null) {
    return ["recipe must be an object"];
  }
  const d = data as Partial<RecipeData>;
  if (!Array.isArray(d.ingredients) || d.ingredients.length === 0) {
    errors.push("ingredients: at least one group with items is required");
  } else {
    const anyItems = d.ingredients.some(
      (g) => g && Array.isArray(g.items) && g.items.some((it) => it && typeof it.name === "string" && it.name.trim()),
    );
    if (!anyItems) errors.push("ingredients: every group is empty or missing item names");
  }
  if (!Array.isArray(d.steps) || d.steps.length === 0) {
    errors.push("steps: at least one step is required");
  } else if (!d.steps.some((s) => s && typeof s.text === "string" && s.text.trim())) {
    errors.push("steps: every step is missing text");
  }
  if (d.kind !== undefined && d.kind !== "dish" && d.kind !== "drink") {
    errors.push('kind: must be "dish" or "drink"');
  }
  return errors;
}

/** Leading number of a servings value ("4 porcje" → 4), or null. */
function servingsBase(servings: string | number | undefined): number | null {
  if (typeof servings === "number" && isFinite(servings)) return servings;
  if (typeof servings === "string") {
    const m = servings.match(/-?\d+(?:[.,]\d+)?/);
    if (m) return parseFloat(m[0].replace(",", "."));
  }
  return null;
}

function renderQty(qty: number | string | undefined): string {
  if (qty === undefined || qty === null || qty === "") return "";
  if (typeof qty === "number" && isFinite(qty)) {
    return `<span class="r-qty" data-base="${qty}">${esc(formatNumber(qty))}</span>`;
  }
  // Non-numeric quantity (e.g. "do smaku") — render as plain, unscaled text.
  return `<span class="r-qty">${esc(String(qty))}</span>`;
}

/** Plain server-side number format; the client mirror in RECIPE_JS adds
 *  cooking fractions when scaling. Keep this simple + integer-friendly. */
function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

function renderIngredient(it: RecipeIngredient): string {
  if (!it || !it.name || !it.name.trim()) return "";
  const qty = renderQty(it.qty);
  const unit = it.unit ? `<span class="r-unit">${esc(it.unit)}</span>` : "";
  const name = `<span class="r-name">${esc(it.name)}</span>`;
  const note = it.note ? ` <span class="r-note">${esc(it.note)}</span>` : "";
  const measure = [qty, unit].filter(Boolean).join(" ");
  const measureSpan = measure ? `<span class="r-measure">${measure}</span> ` : "";
  return `<li class="r-ing"><span class="r-ing-body">${measureSpan}${name}${note}</span></li>`;
}

/**
 * Render a recipe to a self-contained HTML body fragment.
 * @param data  validated recipe payload
 * @param title note title (becomes the <h1>; recipes have no separate title field)
 */
export function renderRecipe(data: RecipeData, title: string): string {
  const labels = { ...DEFAULT_LABELS, ...(data.labels ?? {}) };
  const kind = data.kind === "drink" ? "drink" : "dish";
  const meta = data.meta ?? {};
  const parts: string[] = [];

  parts.push(`<style>${RECIPE_CSS}</style>`);
  parts.push(`<div class="r-recipe" data-recipe data-kind="${kind}">`);

  if (data.image) {
    parts.push(`<img class="r-hero" src="${esc(data.image)}" alt="${esc(title)}" loading="lazy">`);
  }
  parts.push(`<h1 class="r-title">${esc(title)}</h1>`);
  if (data.summary) parts.push(`<p class="r-summary">${esc(data.summary)}</p>`);

  // Meta chips
  const chips: string[] = [];
  const sBase = servingsBase(meta.servings);
  if (meta.servings !== undefined) {
    const servingsText = typeof meta.servings === "number" ? `${meta.servings}` : String(meta.servings);
    const baseAttr = sBase !== null ? ` data-servings-base="${sBase}"` : "";
    chips.push(`<span class="r-chip r-chip--servings"${baseAttr}><span class="r-chip-k">${esc(labels.servings)}</span> <span class="r-chip-v" data-servings-text>${esc(servingsText)}</span></span>`);
  }
  const chip = (k: string, v?: string) => v && chips.push(`<span class="r-chip"><span class="r-chip-k">${esc(k)}</span> <span class="r-chip-v">${esc(v)}</span></span>`);
  chip("Przygotowanie", meta.prep_time);
  if (kind === "dish") chip("Gotowanie", meta.cook_time);
  chip("Razem", meta.total_time);
  chip("Poziom", meta.difficulty);
  if (kind === "drink") {
    chip("Szkło", meta.glass);
    chip("Metoda", meta.method);
    chip("ABV", meta.abv);
  }
  if (chips.length) parts.push(`<div class="r-meta">${chips.join("")}</div>`);

  // Scaler mount point — RECIPE_JS only populates it when servings is numeric.
  if (sBase !== null) parts.push(`<div class="r-scale" data-recipe-scale hidden></div>`);

  parts.push(`<div class="r-body">`);

  // Ingredients column
  parts.push(`<section class="r-col r-col--ings">`);
  parts.push(`<h2 class="r-h">${esc(labels.ingredients)}</h2>`);
  for (const group of data.ingredients) {
    if (!group || !Array.isArray(group.items)) continue;
    const items = group.items.map(renderIngredient).filter(Boolean);
    if (!items.length) continue;
    if (group.group) parts.push(`<h3 class="r-group">${esc(group.group)}</h3>`);
    parts.push(`<ul class="r-ings">${items.join("")}</ul>`);
  }
  parts.push(`</section>`);

  // Steps column
  parts.push(`<section class="r-col r-col--steps">`);
  parts.push(`<h2 class="r-h">${esc(labels.steps)}</h2>`);
  const steps = data.steps
    .filter((s) => s && typeof s.text === "string" && s.text.trim())
    .map((s) => {
      const time = s.time ? `<span class="r-step-time">${esc(s.time)}</span>` : "";
      return `<li class="r-step">${time}<div class="r-step-text">${esc(s.text)}</div></li>`;
    });
  parts.push(`<ol class="r-steps">${steps.join("")}</ol>`);
  parts.push(`</section>`);

  parts.push(`</div>`); // .r-body

  // Extras
  if (Array.isArray(data.equipment) && data.equipment.length) {
    const eq = data.equipment.filter((e) => e && String(e).trim()).map((e) => `<li>${esc(String(e))}</li>`);
    if (eq.length) parts.push(`<section class="r-extra"><h2 class="r-h">${esc(labels.equipment)}</h2><ul class="r-list">${eq.join("")}</ul></section>`);
  }
  if (Array.isArray(data.tips) && data.tips.length) {
    const tips = data.tips.filter((t) => t && String(t).trim()).map((t) => `<li>${esc(String(t))}</li>`);
    if (tips.length) parts.push(`<section class="r-extra"><h2 class="r-h">${esc(labels.tips)}</h2><ul class="r-list">${tips.join("")}</ul></section>`);
  }
  if (data.source && (data.source.url || data.source.title)) {
    const t = esc(data.source.title || data.source.url || "");
    parts.push(data.source.url
      ? `<p class="r-source"><span class="r-source-k">${esc(labels.source)}:</span> <a href="${esc(data.source.url)}" target="_blank" rel="noreferrer">${t}</a></p>`
      : `<p class="r-source"><span class="r-source-k">${esc(labels.source)}:</span> ${t}</p>`);
  }

  parts.push(`</div>`); // .r-recipe
  parts.push(`<script>${RECIPE_JS}</script>`);
  return parts.join("\n");
}

/**
 * Responsive, theme-agnostic styles. Every color reads a theme variable with
 * a hard fallback so it works on all themes (which need not define the same
 * variable names). Layout is driven by a container query on `.r-recipe` so it
 * adapts to the note's iframe width in every context, not just the viewport.
 * Namespaced `.r-*` so it never collides with theme utility classes.
 */
export const RECIPE_CSS = `
.r-recipe{container-type:inline-size;--r-accent:var(--accent,#e2553f);--r-ink:var(--text,#1a1a1a);--r-soft:var(--soft,#333);--r-muted:var(--muted,#6b6b66);--r-panel:var(--panel,#fff);--r-line:var(--border,rgba(0,0,0,.12));--r-bg2:var(--bg-2,#efeae0);}
.r-hero{display:block;width:100%;max-height:420px;object-fit:cover;border-radius:14px;margin:0 0 22px;}
.r-title{margin:0 0 6px;}
.r-summary{color:var(--r-soft);margin:0 0 18px;max-width:60ch;}
.r-meta{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px;}
.r-chip{display:inline-flex;align-items:baseline;gap:6px;padding:6px 12px;border:1px solid var(--r-line);border-radius:999px;font-size:13px;line-height:1.2;background:var(--r-panel);}
.r-chip-k{color:var(--r-muted);text-transform:uppercase;letter-spacing:.05em;font-size:10.5px;}
.r-chip-v{color:var(--r-ink);font-weight:600;}
.r-scale{display:flex;align-items:center;gap:12px;margin:0 0 22px;padding:10px 14px;border:1px solid var(--r-line);border-radius:12px;background:var(--r-bg2);width:max-content;max-width:100%;}
.r-scale-btn{appearance:none;cursor:pointer;width:36px;height:36px;min-width:36px;border-radius:9px;border:1px solid var(--r-line);background:var(--r-panel);color:var(--r-ink);font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;}
.r-scale-btn:hover{border-color:var(--r-accent);color:var(--r-accent);}
.r-scale-lbl{font-size:13px;color:var(--r-muted);}
.r-scale-lbl b{color:var(--r-ink);font-size:15px;}
.r-body{display:block;}
.r-h{margin:0 0 12px;font-size:18px;}
.r-group{margin:14px 0 6px;font-size:14px;color:var(--r-muted);text-transform:uppercase;letter-spacing:.05em;}
.r-ings{list-style:none;margin:0;padding:0;}
.r-ing{display:flex;align-items:flex-start;gap:10px;min-height:44px;padding:8px 0;border-bottom:1px dashed var(--r-line);cursor:pointer;line-height:1.4;}
.r-ing::before{content:"";flex:0 0 auto;width:22px;height:22px;margin-top:1px;border:2px solid var(--r-line);border-radius:6px;transition:background .12s,border-color .12s;}
.r-ing.is-done{opacity:.5;}
.r-ing.is-done .r-name,.r-ing.is-done .r-measure{text-decoration:line-through;}
.r-ing.is-done::before{background:var(--r-accent);border-color:var(--r-accent);}
.r-ing-body{flex:1;min-width:0;}
.r-measure{font-weight:600;color:var(--r-ink);white-space:nowrap;}
.r-unit{font-weight:600;}
.r-name{color:var(--r-soft);}
.r-note{display:block;color:var(--r-muted);font-size:.9em;margin-top:1px;}
.r-steps{margin:0;padding:0;list-style:none;counter-reset:r-step;}
.r-step{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--r-line);}
.r-step::before{counter-increment:r-step;content:counter(r-step);flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:var(--r-accent);color:#fff;font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;}
.r-step-text{color:var(--r-soft);line-height:1.55;flex:1;}
.r-step-time{order:2;flex:0 0 auto;color:var(--r-muted);font-size:12px;white-space:nowrap;margin-left:8px;}
.r-extra{margin-top:24px;}
.r-list{margin:0;padding-left:20px;}
.r-list li{color:var(--r-soft);margin:4px 0;}
.r-source{margin-top:24px;font-size:14px;color:var(--r-muted);}
.r-source-k{text-transform:uppercase;letter-spacing:.05em;font-size:11px;}
@container (min-width:720px){
  .r-body{display:grid;grid-template-columns:minmax(240px,300px) 1fr;gap:36px;align-items:start;}
  .r-col--ings{position:sticky;top:16px;}
}
@media print{
  .r-scale{display:none;}
  .r-ing{cursor:auto;}
  .r-ing::before{display:none;}
  .r-body{display:block;}
  .r-col--ings{position:static;}
}
`.trim();

/**
 * Progressive enhancement, runs inside the note's null-origin sandboxed
 * iframe (no network needed). Adds (1) a servings scaler that recomputes all
 * data-base quantities with cooking-friendly fractions, and (2) tap-to-check
 * ingredient strike-through. State is in-memory only — localStorage can throw
 * in an opaque-origin iframe, so we don't rely on it. Without JS the recipe
 * still reads fine (graceful degradation).
 */
export const RECIPE_JS = `
(function(){
  var root=document.querySelector('[data-recipe]');
  if(!root)return;
  // Ingredient check-off
  root.querySelectorAll('.r-ing').forEach(function(li){
    li.setAttribute('role','button');li.setAttribute('tabindex','0');
    function toggle(){li.classList.toggle('is-done');}
    li.addEventListener('click',toggle);
    li.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
  });
  // Servings scaler
  var mount=root.querySelector('[data-recipe-scale]');
  var sChip=root.querySelector('[data-servings-base]');
  var sText=root.querySelector('[data-servings-text]');
  var base=sChip?parseFloat(sChip.getAttribute('data-servings-base')):NaN;
  var qtys=[].slice.call(root.querySelectorAll('.r-qty[data-base]'));
  if(mount&&isFinite(base)&&base>0&&qtys.length){
    var baseText=sText?sText.textContent:'';
    var mult=1;
    function fmt(n){
      var whole=Math.floor(n+1e-9);var frac=n-whole;
      var marks=[[.125,'⅛'],[.25,'¼'],[.333,'⅓'],[.375,'⅜'],[.5,'½'],[.625,'⅝'],[.667,'⅔'],[.75,'¾'],[.875,'⅞']];
      var best=null,bd=.06;
      for(var i=0;i<marks.length;i++){var dd=Math.abs(frac-marks[i][0]);if(dd<bd){bd=dd;best=marks[i][1];}}
      if(frac<.06)return String(whole);
      if(best)return (whole>0?whole:'')+best;
      return String(Math.round(n*100)/100);
    }
    function apply(){
      qtys.forEach(function(s){var b=parseFloat(s.getAttribute('data-base'));if(isFinite(b))s.textContent=fmt(b*mult);});
      if(sText){var v=base*mult;sText.textContent=baseText.replace(/-?\\d+(?:[.,]\\d+)?/,fmt(v));}
      lbl.querySelector('b').textContent='×'+ (Math.round(mult*100)/100);
    }
    function mk(t,fn){var b=document.createElement('button');b.type='button';b.className='r-scale-btn';b.textContent=t;b.setAttribute('aria-label',t==='−'?'mniej':'więcej');b.addEventListener('click',fn);return b;}
    var minus=mk('−',function(){mult=Math.max(.25,Math.round((mult-(mult<=1?.5:1))*100)/100)||.25;apply();});
    var plus=mk('+',function(){mult=Math.round((mult+(mult<1?.5:1))*100)/100;apply();});
    var lbl=document.createElement('span');lbl.className='r-scale-lbl';lbl.innerHTML='Skala porcji <b>×1</b>';
    mount.appendChild(minus);mount.appendChild(lbl);mount.appendChild(plus);
    mount.hidden=false;
  }
})();
`.trim();
