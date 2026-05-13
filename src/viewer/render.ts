import type { NoteMeta, SearchHit } from "../core/types";
import { db } from "../core/db";
import { listThemes } from "../core/themes";
import { panelIframeSrcdoc, LIVE_CHROME_JS } from "./live-panel";
import { ENTRIES_CSS } from "./entries-css";
import { themesDir, bundledThemesDir } from "../core/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };

/** Sync theme.css read. Mirrors viewer/server.ts resolveTheme without
 *  creating a circular import (render.ts is imported by server.ts). */
function loadThemeCss(name: string): string | null {
  for (const root of [themesDir(), bundledThemesDir()]) {
    const p = join(root, name, "theme.css");
    if (existsSync(p)) return readFileSync(p, "utf-8");
  }
  return null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ago(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

function daysUntil(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const d = Math.floor(ms / 86400000);
  if (d < 0) return "expired";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  return `${d}d`;
}

function dateGroup(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dDay = new Date(d);
  dDay.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - dDay.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "This week";
  if (diffDays < 30) return "This month";
  return "Older";
}

const VIEWER_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400..700&family=Instrument+Serif:ital@0;1&family=Inter:wght@300..700&family=JetBrains+Mono:wght@300..600&display=swap');

:root {
  --vbg:       #f5f3ee;
  --vbg-2:     #efeae0;
  --vbg-3:     #e8e3d5;
  --vpanel:    #fdfcf9;
  --vink:      #0a0a0a;
  --vink-2:    #1a1a1a;
  --vmuted:    #6b6b66;
  --vmuted-2:  #a8a89e;
  --vline:     rgba(10,10,10,0.10);
  --vline-2:   rgba(10,10,10,0.06);

  --vorange:   #ff5a1f;
  --vorange-soft: rgba(255,90,31,0.10);
  --vorange-glow: rgba(255,90,31,0.22);
  --vamber:    #c98e2d;
  --vgood:     #2f9050;
  --vblue:     #2c4ad9;
  --vbronze:   #8b6535;
  --vpurple:   #6b3e9a;

  --vhead:  'Familjen Grotesk', 'Inter', system-ui, sans-serif;
  --vbody:  'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --vserif: 'Instrument Serif', Georgia, serif;
  --vmono:  'JetBrains Mono', 'SF Mono', ui-monospace, monospace;

  --gutter: 32px;
  --content-max: 720px;
  --list-max:    1100px;
  --chrome-max:  1400px;
}

* { box-sizing: border-box; }
html, body {
  background: var(--vbg);
  color: var(--vink);
  font-family: var(--vbody);
  margin: 0; padding: 0;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
a { color: inherit; text-decoration: none; }
::selection { background: var(--vorange); color: var(--vpanel); }

.v-top { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--vbg) 92%, transparent); backdrop-filter: saturate(140%) blur(8px); -webkit-backdrop-filter: saturate(140%) blur(8px); border-bottom: 1px solid var(--vline); }
.v-top-inner { max-width: var(--chrome-max); margin: 0 auto; padding: 14px var(--gutter); display: flex; align-items: center; gap: 22px; }
.v-logo { display: flex; align-items: baseline; gap: 14px; font-family: var(--vhead); font-weight: 500; letter-spacing: -0.035em; line-height: 1; color: var(--vink); }
.v-logo .mark { font-size: 26px; }
.v-logo .mark .dot { color: var(--vorange); }
.v-logo .div { width: 1px; height: 18px; background: var(--vline); align-self: center; }
.v-logo .tagline { font-family: var(--vmono); font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--vmuted-2); font-weight: 400; }
.v-search { flex: 1; max-width: 520px; background: var(--vpanel); border: 1px solid var(--vline); border-radius: 10px; padding: 8px 14px; display: flex; align-items: center; gap: 10px; font-family: var(--vmono); font-size: 13px; transition: border-color .15s, box-shadow .15s, background .15s; }
.v-search:focus-within { border-color: var(--vorange); box-shadow: 0 0 0 4px var(--vorange-soft); background: #fff; }
.v-search .ico { color: var(--vmuted-2); font-size: 12px; }
.v-search input { flex: 1; background: transparent; border: 0; outline: 0; color: var(--vink); font-family: var(--vmono); font-size: 13px; }
.v-search input::placeholder { color: var(--vmuted-2); }
.v-search kbd { font-family: var(--vmono); font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--vbg-2); color: var(--vmuted); border: 1px solid var(--vline); }
.v-nav { display: flex; gap: 2px; }
.v-nav a { padding: 6px 12px; border-radius: 7px; color: var(--vmuted); font-size: 13.5px; font-family: var(--vhead); font-weight: 500; letter-spacing: -0.005em; transition: color .12s, background .12s; }
.v-nav a:hover { color: var(--vink); background: var(--vbg-2); }
.v-nav a.on { color: var(--vink); background: var(--vbg-2); }
.v-nav a.on::after { content: ""; display: block; height: 2px; margin: 4px -4px -8px; background: var(--vorange); border-radius: 1px; }

.v-strip { border-bottom: 1px solid var(--vline); background: var(--vbg); }
.v-strip-inner { max-width: var(--chrome-max); margin: 0 auto; padding: 12px var(--gutter); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.fp { padding: 5px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; background: transparent; border: 1px solid var(--vline); color: var(--vmuted); font-family: var(--vbody); display: inline-flex; align-items: center; gap: 7px; transition: color .12s, background .12s, border-color .12s, transform .12s; }
.fp:hover { color: var(--vink); border-color: var(--vink); }
.fp:active { transform: translateY(1px); }
.fp.on { background: var(--vink); border-color: var(--vink); color: var(--vbg); }
.fp.on .count { color: var(--vbg); opacity: 0.7; }
.fp.warn.on { background: var(--vamber); border-color: var(--vamber); color: #fff; }
.fp .count { font-family: var(--vmono); font-weight: 500; opacity: 0.7; font-size: 11px; }
.fp .star { color: var(--vorange); }
.v-strip .sep { width: 1px; height: 18px; background: var(--vline); margin: 0 6px; }
.v-strip .results-meta { margin-left: auto; font-family: var(--vmono); font-size: 11.5px; color: var(--vmuted-2); text-transform: lowercase; letter-spacing: 0.04em; }

.v-page { max-width: var(--list-max); margin: 0 auto; padding: 28px var(--gutter) 96px; }
.v-page.wide { max-width: var(--chrome-max); }

.group { margin-bottom: 36px; }
.group-lbl { display: flex; align-items: baseline; gap: 14px; font-family: var(--vmono); font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--vmuted-2); font-weight: 500; padding: 0 4px 10px; border-bottom: 1px solid var(--vline); margin-bottom: 6px; }
.group-lbl .count { color: var(--vmuted); }
.group-lbl .spacer { flex: 1; }
.group-lbl .accent { color: var(--vorange); font-style: italic; font-family: var(--vserif); text-transform: none; letter-spacing: 0; font-size: 15px; font-weight: 400; }

.hero { display: grid; grid-template-columns: 1fr auto; gap: 24px; padding: 22px 4px 26px; border-bottom: 1px solid var(--vline); align-items: end; margin-bottom: 6px; cursor: pointer; transition: background .15s; }
.hero:hover { background: linear-gradient(180deg, transparent, var(--vbg-2)); }
.hero .eyebrow { display: flex; align-items: center; gap: 12px; font-family: var(--vmono); font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--vmuted); margin-bottom: 16px; }
.hero .eyebrow .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--vorange); box-shadow: 0 0 0 4px var(--vorange-soft); }
.hero h1 { font-family: var(--vhead); font-weight: 500; font-size: clamp(32px, 4.4vw, 52px); line-height: 1.02; letter-spacing: -0.035em; margin: 0 0 14px; max-width: 18ch; text-wrap: balance; }
.hero .lead { font-family: var(--vserif); font-size: 18px; font-style: italic; color: var(--vmuted); line-height: 1.5; max-width: 56ch; margin: 0 0 18px; }
.hero .meta { display: flex; gap: 16px; flex-wrap: wrap; font-family: var(--vmono); font-size: 11.5px; color: var(--vmuted); align-items: center; }
.hero .meta .pip { width: 4px; height: 4px; border-radius: 50%; background: var(--vmuted-2); }
.hero .meta .thread { color: var(--vbronze); }
.hero .meta .final { color: var(--vorange); font-weight: 600; }
.hero-arrow { align-self: end; font-family: var(--vhead); font-weight: 400; font-size: 56px; line-height: 1; color: var(--vmuted-2); transition: transform .25s, color .15s; }
.hero:hover .hero-arrow { transform: translateX(8px); color: var(--vorange); }

.rows { display: flex; flex-direction: column; }
.row { display: grid; grid-template-columns: 88px minmax(0, 1fr) 92px auto; gap: 18px; padding: 12px 8px; align-items: baseline; border-bottom: 1px solid var(--vline-2); color: var(--vink); position: relative; transition: background .12s; }
.row::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: transparent; transition: background .12s; }
.row:hover { background: var(--vbg-2); }
.row:hover::before { background: var(--vorange); }
.row .type { font-family: var(--vmono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600; color: var(--vmuted); padding-top: 1px; }
.row .type.research    { color: var(--vorange); }
.row .type.comparison  { color: var(--vbronze); }
.row .type.technical   { color: var(--vblue); }
.row .type.journal     { color: var(--vgood); }
.row .type.snippet     { color: var(--vmuted); }
.row .title { font-family: var(--vhead); font-weight: 500; font-size: 18px; line-height: 1.3; letter-spacing: -0.015em; color: var(--vink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.row .title-sub { display: block; font-family: var(--vmono); font-size: 11px; color: var(--vmuted); font-weight: 400; letter-spacing: 0; margin-top: 3px; }
.row .title-sub .thread:hover { color: var(--vorange); }
.row .age { font-family: var(--vmono); font-size: 11.5px; color: var(--vmuted-2); text-align: right; }
.row .stat { font-family: var(--vmono); font-size: 11.5px; text-align: right; min-width: 56px; }
.row .stat.final { color: var(--vorange); font-weight: 600; }
.row .stat.warn  { color: var(--vamber); }
.row .stat .star { font-style: normal; }

.row.with-snippet { padding: 14px 8px; align-items: start; }
.row.with-snippet .snippet { font-family: var(--vserif); font-size: 16px; font-style: italic; color: var(--vmuted); line-height: 1.55; margin-top: 6px; max-width: 64ch; }
.row.with-snippet .snippet mark { background: var(--vorange-soft); color: var(--vink); padding: 0 3px; border-radius: 2px; font-style: normal; font-weight: 500; font-family: var(--vbody); }

.cluster { display: grid; grid-template-columns: 1fr auto; gap: 24px; padding: 18px 18px 18px 22px; background: var(--vbg-2); border: 1px solid var(--vline); border-radius: 12px; margin-bottom: 10px; position: relative; overflow: hidden; transition: border-color .15s, transform .15s; }
.cluster:hover { border-color: var(--vorange); transform: translateY(-1px); }
.cluster::before { content: ""; position: absolute; left: 0; top: 14px; bottom: 14px; width: 3px; background: var(--vorange); border-radius: 0 2px 2px 0; }
.cluster .tid { font-family: var(--vmono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vbronze); margin-bottom: 6px; }
.cluster h3 { font-family: var(--vhead); font-weight: 500; font-size: 22px; letter-spacing: -0.02em; margin: 0 0 4px; }
.cluster .blurb { color: var(--vmuted); font-size: 13.5px; line-height: 1.5; margin-bottom: 12px; max-width: 60ch; }
.cluster .stack { display: flex; gap: 0; flex-wrap: wrap; }
.cluster .stack .chip { font-family: var(--vmono); font-size: 11px; padding: 4px 10px; border-radius: 999px; background: var(--vpanel); border: 1px solid var(--vline); color: var(--vmuted); margin-right: 6px; margin-bottom: 4px; }
.cluster .stack .chip.final { color: var(--vorange); border-color: var(--vorange-glow); }
.cluster .cluster-meta { font-family: var(--vmono); font-size: 11px; color: var(--vmuted); text-align: right; display: flex; flex-direction: column; gap: 4px; align-items: end; }
.cluster .cluster-meta .big { font-family: var(--vhead); font-weight: 500; font-size: 32px; line-height: 1; color: var(--vink); letter-spacing: -0.02em; }

.tag-cloud { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 4px 8px; }
.tag-cloud .tag-chip { display: inline-flex; align-items: baseline; gap: 8px; font-family: var(--vmono); font-size: 12px; padding: 5px 12px; border-radius: 999px; background: var(--vpanel); border: 1px solid var(--vline); color: var(--vink-2); transition: color .12s, border-color .12s, background .12s, box-shadow .12s; max-width: 100%; overflow-wrap: anywhere; }
.tag-cloud .tag-chip:hover { color: var(--vorange); border-color: var(--vorange); }
.tag-cloud .tag-chip.on { background: var(--vink); border-color: var(--vink); color: var(--vbg); box-shadow: 0 0 0 3px var(--vorange-soft); }
.tag-cloud .tag-chip .ns { color: var(--vbronze); opacity: 0.65; font-weight: 400; }
.tag-cloud .tag-chip .val { font-weight: 600; }
.tag-cloud .tag-chip.on .ns { color: var(--vamber); opacity: 0.9; }
.tag-cloud .tag-chip .count { font-size: 10.5px; color: var(--vmuted); }
.tag-cloud .tag-chip.on .count { color: var(--vbg); opacity: 0.7; }
.tag-cloud .more { font-family: var(--vmono); font-size: 11px; color: var(--vmuted-2); padding: 5px 4px; align-self: center; }

/* Namespace coloring — color-mix gives the chip a soft tint of the accent
   without sacrificing contrast against linen-warm viewer chrome.
   ns-klient → niebieski, ns-projekt → zielony, ns-temat → bursztynowy,
   ns-type → fioletowy, ns-unknown / no namespace → muted neutral. */
/* Intensities tuned for clearly-visible tint on linen-warm chrome:
   ~24% background fill (still light, but distinguishable from #f5f3ee bg),
   ~55% border for a strong outline, ~70% text for AA-safe contrast on top. */
.tag-cloud .tag-chip.ns-klient   { background: color-mix(in srgb, var(--vblue)   22%, var(--vpanel)); border-color: color-mix(in srgb, var(--vblue)   55%, var(--vline));  color: color-mix(in srgb, var(--vblue)   70%, var(--vink)); }
.tag-cloud .tag-chip.ns-projekt  { background: color-mix(in srgb, var(--vgood)   22%, var(--vpanel)); border-color: color-mix(in srgb, var(--vgood)   55%, var(--vline));  color: color-mix(in srgb, var(--vgood)   70%, var(--vink)); }
.tag-cloud .tag-chip.ns-temat    { background: color-mix(in srgb, var(--vamber)  26%, var(--vpanel)); border-color: color-mix(in srgb, var(--vamber)  60%, var(--vline));  color: color-mix(in srgb, var(--vamber)  75%, var(--vink)); }
.tag-cloud .tag-chip.ns-type     { background: color-mix(in srgb, var(--vpurple) 22%, var(--vpanel)); border-color: color-mix(in srgb, var(--vpurple) 55%, var(--vline));  color: color-mix(in srgb, var(--vpurple) 70%, var(--vink)); }
.tag-cloud .tag-chip.ns-klient   .ns { color: color-mix(in srgb, var(--vblue)   65%, var(--vink)); }
.tag-cloud .tag-chip.ns-projekt  .ns { color: color-mix(in srgb, var(--vgood)   65%, var(--vink)); }
.tag-cloud .tag-chip.ns-temat    .ns { color: color-mix(in srgb, var(--vamber)  70%, var(--vink)); }
.tag-cloud .tag-chip.ns-type     .ns { color: color-mix(in srgb, var(--vpurple) 65%, var(--vink)); }
.tag-cloud .tag-chip:hover.ns-klient,
.tag-cloud .tag-chip:hover.ns-projekt,
.tag-cloud .tag-chip:hover.ns-temat,
.tag-cloud .tag-chip:hover.ns-type { color: currentColor; filter: brightness(0.95); border-color: currentColor; }
/* Large header chip variant for /tag/:slug page */
.tag-header { display: inline-flex; align-items: baseline; gap: 12px; font-family: var(--vmono); font-size: 18px; padding: 10px 22px; border-radius: 999px; background: var(--vpanel); border: 1.5px solid var(--vline); color: var(--vink-2); max-width: 100%; overflow-wrap: anywhere; }
.tag-header .ns { color: var(--vbronze); opacity: 0.7; font-weight: 400; }
.tag-header .val { font-weight: 600; letter-spacing: -0.01em; }
.tag-header .count { font-family: var(--vmono); font-size: 12px; color: var(--vmuted); font-weight: 400; letter-spacing: 0.04em; padding-left: 8px; border-left: 1px solid var(--vline); }
.tag-header.ns-klient  { background: color-mix(in srgb, var(--vblue)   22%, var(--vpanel)); border-color: color-mix(in srgb, var(--vblue)   60%, var(--vline)); color: color-mix(in srgb, var(--vblue)   70%, var(--vink)); }
.tag-header.ns-projekt { background: color-mix(in srgb, var(--vgood)   22%, var(--vpanel)); border-color: color-mix(in srgb, var(--vgood)   60%, var(--vline)); color: color-mix(in srgb, var(--vgood)   70%, var(--vink)); }
.tag-header.ns-temat   { background: color-mix(in srgb, var(--vamber)  26%, var(--vpanel)); border-color: color-mix(in srgb, var(--vamber)  65%, var(--vline)); color: color-mix(in srgb, var(--vamber)  75%, var(--vink)); }
.tag-header.ns-type    { background: color-mix(in srgb, var(--vpurple) 22%, var(--vpanel)); border-color: color-mix(in srgb, var(--vpurple) 60%, var(--vline)); color: color-mix(in srgb, var(--vpurple) 70%, var(--vink)); }
.tag-header.ns-klient  .ns { color: color-mix(in srgb, var(--vblue)   65%, var(--vink)); }
.tag-header.ns-projekt .ns { color: color-mix(in srgb, var(--vgood)   65%, var(--vink)); }
.tag-header.ns-temat   .ns { color: color-mix(in srgb, var(--vamber)  70%, var(--vink)); }
.tag-header.ns-type    .ns { color: color-mix(in srgb, var(--vpurple) 65%, var(--vink)); }

/* Active filter strip shown above the date groups when ?tag= and/or ?type= is set */
.active-filter { display: flex; align-items: center; gap: 10px; padding: 10px 4px 14px; margin-bottom: 4px; flex-wrap: wrap; font-family: var(--vmono); font-size: 11.5px; color: var(--vmuted); }
.active-filter .lbl { letter-spacing: 0.14em; text-transform: uppercase; color: var(--vmuted-2); font-size: 10.5px; }
.active-filter .chip { display: inline-flex; align-items: baseline; gap: 8px; padding: 4px 10px 4px 12px; border-radius: 999px; background: var(--vpanel); border: 1px solid var(--vline); color: var(--vink-2); font-size: 12px; }
.active-filter .chip .x { color: var(--vmuted-2); padding-left: 6px; border-left: 1px solid var(--vline-2); margin-left: 4px; transition: color .12s; }
.active-filter .chip:hover .x { color: var(--vorange); }
.active-filter .clear-all { color: var(--vmuted-2); padding: 3px 8px; border-radius: 4px; transition: color .12s, background .12s; }
.active-filter .clear-all:hover { color: var(--vorange); background: var(--vbg-2); }

.thread-card { display: grid; grid-template-columns: 1fr auto auto; gap: 22px; align-items: center; padding: 18px 8px 18px 30px; border-bottom: 1px solid var(--vline-2); position: relative; transition: background .12s; }
.thread-card:hover { background: var(--vbg-2); }
.thread-card::before { content: ""; position: absolute; left: 8px; top: 18px; bottom: 18px; width: 2px; background: var(--vline); border-radius: 1px; }
.thread-card:hover::before { background: var(--vorange); }
.thread-card .tid { font-family: var(--vmono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vbronze); margin-bottom: 4px; }
.thread-card .title { font-family: var(--vhead); font-weight: 500; font-size: 20px; letter-spacing: -0.015em; margin-bottom: 8px; }
.thread-card .progress { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.thread-card .progress .tick { width: 18px; height: 4px; border-radius: 2px; background: var(--vmuted-2); opacity: 0.5; }
.thread-card .progress .tick.has { background: var(--vmuted); opacity: 1; }
.thread-card .progress .tick.final { background: var(--vorange); opacity: 1; }
.thread-card .progress .more { font-family: var(--vmono); font-size: 10px; color: var(--vmuted); margin-left: 4px; }
.thread-card .count { font-family: var(--vhead); font-weight: 500; font-size: 28px; line-height: 1; letter-spacing: -0.02em; color: var(--vink); }
.thread-card .count small { font-family: var(--vmono); font-size: 10.5px; color: var(--vmuted); display: block; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 4px; font-weight: 400; }
.thread-card .latest { font-family: var(--vmono); font-size: 11.5px; color: var(--vmuted-2); text-align: right; min-width: 90px; }
.thread-card .latest .final-marker { display: inline-block; color: var(--vorange); font-weight: 600; margin-top: 4px; }

.note-shell { display: grid; grid-template-columns: 360px 1fr; min-height: calc(100vh - 60px); }
.note-shell.has-live { grid-template-columns: 360px minmax(0, 1fr) minmax(340px, 26vw); }
@media (max-width: 1180px) { .note-shell.has-live { grid-template-columns: 360px 1fr; } .note-shell.has-live .live-panel { grid-column: 1 / -1; max-height: 60vh; } }
@media (max-width: 720px) { .note-shell, .note-shell.has-live { grid-template-columns: 1fr; } }
.live-panel { background: var(--vbg-2); border-left: 1px solid var(--vline); display: flex; flex-direction: column; height: calc(100vh - 60px); min-width: 0; }
.live-panel-iframe { flex: 1; width: 100%; border: 0; min-height: 0; display: block; background: var(--vpanel); }
.note-side { border-right: 1px solid var(--vline); padding: 24px 22px 22px; display: flex; flex-direction: column; gap: 0; background: var(--vbg); position: sticky; top: 60px; align-self: start; max-height: calc(100vh - 60px); overflow-y: auto; overflow-x: hidden; min-width: 0; }
.note-side .back { font-family: var(--vmono); font-size: 11px; color: var(--vmuted); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 22px; transition: color .12s; }
.note-side .back:hover { color: var(--vorange); }
.note-side .type-pill { align-self: flex-start; font-family: var(--vmono); font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 600; padding: 4px 9px; border-radius: 5px; background: var(--vorange-soft); color: var(--vorange); margin-bottom: 14px; }
.note-side .type-pill.technical { background: rgba(44,74,217,0.10); color: var(--vblue); }
.note-side .type-pill.comparison { background: rgba(139,101,53,0.12); color: var(--vbronze); }
.note-side .type-pill.journal { background: rgba(47,144,80,0.10); color: var(--vgood); }
.note-side .type-pill.snippet { background: var(--vbg-2); color: var(--vmuted); }
.note-side h1 { font-family: var(--vhead); font-weight: 500; font-size: 24px; line-height: 1.15; letter-spacing: -0.025em; margin: 0 0 22px; text-wrap: balance; }

.action-card { display: block; background: var(--vink); color: var(--vbg); border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; position: relative; overflow: hidden; cursor: pointer; border: 0; width: 100%; text-align: left; font-family: inherit; line-height: 1.3; transition: transform .15s, background .15s; }
.action-card > * { display: block; }
.action-card:hover { background: var(--vorange); transform: translateY(-1px); }
.action-card .ac-lbl { font-family: var(--vmono); font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--vmuted-2); margin-bottom: 6px; }
.action-card .ac-title { font-family: var(--vhead); font-weight: 500; font-size: 16px; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; }
.action-card .ac-title .ac-star { color: var(--vorange); font-style: normal; }
.action-card:hover .ac-title .ac-star { color: var(--vbg); }
.action-card .ac-hint { font-family: var(--vmono); font-size: 11px; color: var(--vmuted-2); margin-top: 6px; line-height: 1.45; }

.side-meta { display: grid; grid-template-columns: auto 1fr; gap: 12px 14px; padding: 4px 0 18px; border-bottom: 1px solid var(--vline); margin-bottom: 18px; }
.side-meta dt { font-family: var(--vmono); font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--vmuted-2); align-self: baseline; }
.side-meta dd { font-family: var(--vmono); font-size: 12px; color: var(--vink-2); margin: 0; align-self: baseline; min-width: 0; overflow-wrap: anywhere; word-break: break-word; }
.side-meta dd.thread { color: var(--vbronze); }
.side-meta dd.warn { color: var(--vamber); }
.side-meta dd.final { color: var(--vorange); }
.side-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.side-tags .tg { font-family: var(--vmono); font-size: 10.5px; padding: 3px 8px; border-radius: 4px; background: var(--vbg-2); color: var(--vmuted); border: 1px solid var(--vline-2); transition: color .12s, border-color .12s, background .12s; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
.side-tags a.tg:hover { color: var(--vorange); border-color: var(--vorange); background: var(--vpanel); }
.side-aux { margin-top: auto; padding-top: 18px; border-top: 1px solid var(--vline); display: flex; flex-direction: column; gap: 4px; }
.side-aux a, .side-aux button { font-family: var(--vmono); font-size: 11px; color: var(--vmuted); letter-spacing: 0.06em; padding: 4px 0; transition: color .12s; background: transparent; border: 0; text-align: left; cursor: pointer; }
.side-aux a:hover, .side-aux button:hover { color: var(--vorange); }
.side-aux .danger { color: #c8412a; opacity: 0.7; }

.theme-switch { font-family: var(--vmono); font-size: 12px; color: var(--vink-2); background: transparent; border: 1px solid var(--vline); padding: 3px 6px 3px 4px; border-radius: 4px; cursor: pointer; max-width: 140px; }
.theme-switch:hover { border-color: var(--vink); }
.theme-switch:focus { outline: 0; border-color: var(--vorange); box-shadow: 0 0 0 3px var(--vorange-soft); }

.reading-progress { position: fixed; top: 0; left: 0; right: 0; height: 2px; background: transparent; z-index: 30; pointer-events: none; }
.reading-progress-fill { height: 100%; background: var(--vorange); width: 0%; transition: width .05s linear; }

.toc { margin: 0 0 18px; padding: 14px 0 12px; border-top: 1px solid var(--vline); border-bottom: 1px solid var(--vline); }
.toc[hidden] { display: none; }
.toc .toc-lbl { font-family: var(--vmono); font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--vmuted-2); margin-bottom: 10px; font-weight: 500; }
.toc ol { list-style: none; padding: 0; margin: 0; counter-reset: toc; display: flex; flex-direction: column; gap: 3px; }
.toc li { position: relative; counter-increment: toc; padding-left: 22px; }
.toc li::before { content: counter(toc, decimal-leading-zero); position: absolute; left: 0; top: 2px; font-family: var(--vmono); font-size: 9.5px; color: var(--vmuted-2); letter-spacing: 0.04em; }
.toc li.h3 { padding-left: 34px; }
.toc li.h3::before { left: 14px; opacity: 0.6; }
.toc a { display: block; color: var(--vmuted); font-size: 12.5px; line-height: 1.35; padding: 2px 0; transition: color .12s; cursor: pointer; }
.toc a:hover { color: var(--vink); }
.toc li.active a { color: var(--vorange); font-weight: 500; }

.prev-next { display: flex; gap: 6px; margin-bottom: 20px; }
.pn-btn { flex: 1; padding: 8px 10px; border: 1px solid var(--vline); border-radius: 7px; font-family: var(--vmono); font-size: 11px; color: var(--vmuted); text-align: center; transition: color .12s, border-color .12s; min-width: 0; }
.pn-btn:hover { border-color: var(--vorange); color: var(--vorange); }
.pn-btn.disabled { opacity: 0.3; pointer-events: none; }
.pn-btn .pn-label { display: block; font-size: 9.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vmuted-2); margin-bottom: 2px; }

.side-action { font-family: var(--vmono); font-size: 11px; color: var(--vmuted); letter-spacing: 0.06em; padding: 4px 0; transition: color .12s; background: transparent; border: 0; text-align: left; cursor: pointer; width: 100%; display: block; }
.side-action:hover { color: var(--vorange); }
.side-action.copied { color: var(--vgood); }
.side-action.danger { color: var(--vmuted); margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--vline-2); }
.side-action.danger:hover { color: #c0392b; }
.side-action.danger.confirming { color: #c0392b; font-weight: 500; }

.lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 9999; display: flex; align-items: center; justify-content: center; cursor: zoom-out; animation: lb-in .15s ease-out; }
.lightbox img { max-width: 95vw; max-height: 95vh; box-shadow: 0 8px 32px rgba(0,0,0,0.6); border-radius: 4px; }
.lightbox .lb-close { position: absolute; top: 18px; right: 22px; font-family: var(--vmono); font-size: 11px; color: rgba(255,255,255,0.7); letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; }
@keyframes lb-in { from { opacity: 0; } to { opacity: 1; } }

.note-main { background: var(--vpanel); min-width: 0; display: flex; flex-direction: column; height: calc(100vh - 60px); }
.note-banner { padding: 12px 24px; background: linear-gradient(90deg, rgba(201,142,45,0.08), transparent 60%); border-bottom: 1px solid var(--vline-2); display: flex; align-items: center; justify-content: space-between; font-family: var(--vmono); font-size: 11.5px; color: var(--vink-2); gap: 14px; flex-wrap: wrap; flex-shrink: 0; }
.note-banner .lbl { color: var(--vamber); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-size: 10.5px; }
.note-banner .finalize-btn { font-family: var(--vhead); font-weight: 500; font-size: 13px; letter-spacing: -0.005em; padding: 6px 14px; border-radius: 7px; background: var(--vink); color: var(--vbg); border: 0; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.note-banner .finalize-btn:hover { background: var(--vorange); }
.note-iframe-wrap { background: var(--vpanel); flex: 1; min-height: 0; }
.note-iframe { width: 100%; height: 100%; border: 0; display: block; }

.empty { text-align: center; padding: 80px 20px; color: var(--vmuted); max-width: 480px; margin: 0 auto; }
.empty h2 { font-family: var(--vhead); font-weight: 500; font-size: 36px; letter-spacing: -0.025em; color: var(--vink); margin: 0 0 12px; }
.empty .lead { font-family: var(--vserif); font-style: italic; font-size: 19px; color: var(--vmuted); }
.empty code { font-family: var(--vmono); font-size: 12px; background: var(--vbg-2); padding: 3px 8px; border-radius: 5px; color: var(--vink-2); }

.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin: 24px 0 32px; }
.stat-cell { padding: 18px 20px; background: var(--vpanel); border: 1px solid var(--vline); border-radius: 10px; }
.stat-cell .n { font-family: var(--vhead); font-weight: 500; font-size: 36px; letter-spacing: -0.025em; line-height: 1; color: var(--vink); }
.stat-cell .n.acc { color: var(--vorange); }
.stat-cell .n.good { color: var(--vgood); }
.stat-cell .n.mid { color: var(--vamber); }
.stat-cell .lbl { font-family: var(--vmono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--vmuted); margin-top: 8px; font-weight: 500; }

@media (max-width: 860px) {
  :root { --gutter: 18px; }
  .v-logo .div, .v-logo .tagline { display: none; }
  .v-search { max-width: none; }
  .v-top-inner { flex-wrap: wrap; gap: 12px; }
  .v-nav { width: 100%; order: 3; }
  .v-strip-inner { overflow-x: auto; flex-wrap: nowrap; padding-right: 24px; }
  .v-strip-inner .fp { flex: 0 0 auto; }
  .v-strip .results-meta { display: none; }
  .hero { grid-template-columns: 1fr; }
  .hero-arrow { display: none; }
  .hero h1 { font-size: 32px; max-width: none; }
  .hero .lead { font-size: 16px; }
  .row { grid-template-columns: 64px minmax(0,1fr) auto; gap: 12px; }
  .row .age { display: none; }
  .row .title { font-size: 16px; white-space: normal; }
  .cluster { grid-template-columns: 1fr; }
  .cluster .cluster-meta { flex-direction: row; align-items: center; justify-content: flex-start; text-align: left; }
  .cluster .cluster-meta .big { font-size: 22px; }
  .thread-card { grid-template-columns: 1fr auto; gap: 12px 18px; }
  .thread-card .latest { grid-column: 2; }
  .thread-card .progress { grid-column: 1 / -1; margin-top: 4px; }
  .note-shell { grid-template-columns: 1fr; }
  .note-side { position: static; max-height: none; overflow: visible; border-right: 0; border-bottom: 1px solid var(--vline); }
  .note-side h1 { font-size: 22px; }
  .action-card { margin-bottom: 14px; }
}

/* Live search dropdown — attached to .v-search by JS */
.v-search { position: relative; }
.v-search-results {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0;
  background: var(--vpanel); border: 1px solid var(--vline); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(10,10,10,0.12);
  z-index: 50; max-height: 60vh; overflow-y: auto;
  display: none;
}
.v-search-results.open { display: block; }
.v-search-results .group-lbl { font-family: var(--vmono); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vmuted-2); padding: 10px 14px 6px; border-bottom: 1px solid var(--vline-2); display: flex; align-items: center; gap: 8px; }
.v-search-results .group-lbl .accent { color: var(--vorange); }
.v-search-results a.hit { display: block; padding: 9px 14px; border-bottom: 1px solid var(--vline-2); color: var(--vink); cursor: pointer; }
.v-search-results a.hit:last-of-type { border-bottom: 0; }
.v-search-results a.hit:hover, .v-search-results a.hit.kb { background: var(--vbg-2); }
.v-search-results .hit .t { font-family: var(--vhead); font-weight: 500; font-size: 14px; line-height: 1.3; letter-spacing: -0.01em; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.v-search-results .hit .sub { font-family: var(--vmono); font-size: 10.5px; color: var(--vmuted); display: flex; gap: 8px; align-items: center; }
.v-search-results .hit .sub .type.research { color: var(--vorange); }
.v-search-results .hit .sub .type.comparison { color: var(--vbronze); }
.v-search-results .hit .sub .type.technical { color: var(--vblue); }
.v-search-results .hit .sub .type.journal { color: var(--vgood); }
.v-search-results .hit .sub .final { color: var(--vorange); font-weight: 600; }
.v-search-results .hit .snip { font-family: var(--vserif); font-style: italic; font-size: 12px; color: var(--vmuted); margin-top: 3px; line-height: 1.45; max-height: 2.9em; overflow: hidden; }
.v-search-results .hit .snip mark { background: var(--vorange-soft); color: var(--vink); padding: 0 2px; font-style: normal; font-weight: 500; font-family: var(--vbody); }
.v-search-results .footer { padding: 8px 14px; font-family: var(--vmono); font-size: 11px; color: var(--vmuted-2); border-top: 1px solid var(--vline-2); display: flex; justify-content: space-between; align-items: center; }
.v-search-results .footer a { color: var(--vorange); }
.v-search-results .empty { padding: 24px 14px; font-family: var(--vserif); font-style: italic; color: var(--vmuted); font-size: 14px; text-align: center; }
`;

const KBD_SHORTCUT_JS = `<script>
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement && (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA')) {
    e.preventDefault();
    document.querySelector('.v-search input')?.focus();
  }
  if (e.key === 'Escape' && document.activeElement && document.activeElement.tagName === 'INPUT') {
    document.activeElement.blur();
  }
});

// Live search — debounced /api/search dropdown attached to .v-search.
// Hits Enter / form submit still falls through to /search?q=... so the
// no-JS / full-results path keeps working.
(function(){
  var form = document.querySelector('.v-search');
  if (!form) return;
  var input = form.querySelector('input');
  if (!input) return;
  var results = document.createElement('div');
  results.className = 'v-search-results';
  form.appendChild(results);

  var debounceTimer = 0;
  var lastQuery = '';
  var activeReq = 0;
  var kbIdx = -1;

  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function close(){ results.classList.remove('open'); results.innerHTML = ''; kbIdx = -1; }
  function open(){ results.classList.add('open'); }

  function render(query, hits){
    if (!Array.isArray(hits) || hits.length === 0) {
      results.innerHTML = '<div class="empty">No matches for <em>' + escapeHtml(query) + '</em></div>';
      open();
      return;
    }
    var shown = hits.slice(0, 8);
    var pieces = ['<div class="group-lbl">Notes <span class="accent">· ' + hits.length + ' ' + (hits.length === 1 ? 'hit' : 'hits') + '</span></div>'];
    shown.forEach(function(h){
      var sub = '<div class="sub"><span class="type ' + escapeHtml(h.type) + '">' + escapeHtml(h.type) + '</span> · <span>' + escapeHtml(h.thread_id) + '</span>' + (h.is_final ? ' · <span class="final">★ final</span>' : '') + '</div>';
      var snip = h.snippet ? '<div class="snip">' + h.snippet + '</div>' : '';
      pieces.push('<a class="hit" href="/n/' + escapeHtml(h.id) + '"><div class="t">' + escapeHtml(h.title) + '</div>' + sub + snip + '</a>');
    });
    var moreNote = hits.length > shown.length ? '+' + (hits.length - shown.length) + ' more' : '&nbsp;';
    pieces.push('<div class="footer"><span>' + moreNote + '</span><a href="/search?q=' + encodeURIComponent(query) + '">Open full results →</a></div>');
    results.innerHTML = pieces.join('');
    kbIdx = -1;
    open();
  }

  function doSearch(q){
    var myReq = ++activeReq;
    fetch('/api/search?q=' + encodeURIComponent(q))
      .then(function(r){ return r.json(); })
      .then(function(json){
        if (myReq !== activeReq) return; // stale response
        render(q, json);
      })
      .catch(function(){
        if (myReq !== activeReq) return;
        results.innerHTML = '<div class="empty">Search failed</div>';
        open();
      });
  }

  input.addEventListener('input', function(){
    var q = input.value.trim();
    if (q === lastQuery) return;
    lastQuery = q;
    clearTimeout(debounceTimer);
    if (!q) { close(); return; }
    debounceTimer = setTimeout(function(){ doSearch(q); }, 150);
  });

  input.addEventListener('focus', function(){
    if (input.value.trim() && results.children.length > 0) open();
  });

  document.addEventListener('mousedown', function(e){
    if (!form.contains(e.target)) close();
  });

  input.addEventListener('keydown', function(e){
    var items = results.querySelectorAll('a.hit');
    if (e.key === 'ArrowDown') {
      if (items.length === 0) return;
      e.preventDefault();
      kbIdx = Math.min(items.length - 1, kbIdx + 1);
      items.forEach(function(el, i){ el.classList.toggle('kb', i === kbIdx); });
      items[kbIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      if (items.length === 0) return;
      e.preventDefault();
      kbIdx = Math.max(0, kbIdx - 1);
      items.forEach(function(el, i){ el.classList.toggle('kb', i === kbIdx); });
      items[kbIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && kbIdx >= 0 && items[kbIdx]) {
      e.preventDefault();
      window.location.href = items[kbIdx].getAttribute('href');
    } else if (e.key === 'Escape') {
      close();
    }
  });
})();
</script>`;

function topbar(query = "", active?: "notes" | "threads" | "stats"): string {
  const on = (k: string) => (active === k ? ' class="on"' : "");
  return `
<header class="v-top">
  <div class="v-top-inner">
    <a href="/" class="v-logo" aria-label="Folio home">
      <span class="mark">folio<span class="dot">.</span></span>
      <span class="div"></span>
      <span class="tagline">Visual comm for agents</span>
    </a>
    <form class="v-search" role="search" action="/search" method="get">
      <span class="ico">⌕</span>
      <input type="search" name="q" placeholder="Search notes and threads…" value="${esc(query)}" autocomplete="off">
      <kbd>/</kbd>
    </form>
    <nav class="v-nav">
      <a href="/"${on("notes")}>Notes</a>
      <a href="/threads"${on("threads")}>Threads</a>
      <a href="/stats"${on("stats")}>Stats</a>
    </nav>
  </div>
</header>`;
}

interface CountSummary {
  all: number;
  final: number;
  expiring: number;
  byType: Record<string, number>;
}

function buildHref(params: Record<string, string | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  }
  const qs = usp.toString();
  return qs ? `/?${qs}` : "/";
}

function filterBar(activeType?: string, activeStatus?: string, counts?: CountSummary, resultsMeta?: string, activeTag?: string): string {
  const cs = counts ?? { all: 0, final: 0, expiring: 0, byType: {} };
  const on = (cond: boolean) => (cond ? " on" : "");
  // Type/status chips preserve the active tag so combined filter works
  const withTag = (extra: Record<string, string>) => buildHref({ tag: activeTag ?? null, ...extra });
  return `
<div class="v-strip">
  <div class="v-strip-inner">
    <a href="${withTag({})}" class="fp${on(!activeType && !activeStatus)}">All <span class="count">${cs.all}</span></a>
    <a href="${withTag({ type: "research" })}" class="fp${on(activeType === "research")}">Research <span class="count">${cs.byType.research ?? 0}</span></a>
    <a href="${withTag({ type: "comparison" })}" class="fp${on(activeType === "comparison")}">Comparison <span class="count">${cs.byType.comparison ?? 0}</span></a>
    <a href="${withTag({ type: "technical" })}" class="fp${on(activeType === "technical")}">Technical <span class="count">${cs.byType.technical ?? 0}</span></a>
    ${cs.byType.journal ? `<a href="${withTag({ type: "journal" })}" class="fp${on(activeType === "journal")}">Journal <span class="count">${cs.byType.journal}</span></a>` : ""}
    <span class="sep"></span>
    <a href="${withTag({ final: "1" })}" class="fp${on(activeStatus === "final")}"><span class="star">★</span> Final <span class="count">${cs.final}</span></a>
    <a href="${withTag({ expiring: "1" })}" class="fp warn${on(activeStatus === "expiring")}">⏱ Expiring 7d <span class="count">${cs.expiring}</span></a>
    ${resultsMeta ? `<span class="results-meta">${esc(resultsMeta)}</span>` : ""}
  </div>
</div>`;
}

function activeFilterStrip(activeTag?: string, activeType?: string, activeStatus?: string): string {
  if (!activeTag && !activeType && !activeStatus) return "";
  const chips: string[] = [];
  if (activeTag) {
    const { ns, value, nsClass } = parseTagNs(activeTag);
    const label = ns !== null
      ? `<span class="ns" style="color:var(--vmuted-2)">${esc(ns)}:</span>${esc(value)}`
      : esc(activeTag);
    // Remove tag, keep other filters
    const href = buildHref({ type: activeType, final: activeStatus === "final" ? "1" : null, expiring: activeStatus === "expiring" ? "1" : null });
    chips.push(`<a href="${href}" class="chip${nsClass ? " " + nsClass : ""}" title="Clear tag filter">🏷 ${label}<span class="x">×</span></a>`);
  }
  if (activeType) {
    const href = buildHref({ tag: activeTag, final: activeStatus === "final" ? "1" : null, expiring: activeStatus === "expiring" ? "1" : null });
    chips.push(`<a href="${href}" class="chip" title="Clear type filter">type: ${esc(activeType)}<span class="x">×</span></a>`);
  }
  if (activeStatus) {
    const href = buildHref({ tag: activeTag, type: activeType });
    chips.push(`<a href="${href}" class="chip" title="Clear status filter">${activeStatus === "final" ? "★ final" : "⏱ expiring 7d"}<span class="x">×</span></a>`);
  }
  return `
<div class="v-page" style="padding-top: 12px; padding-bottom: 0;">
  <div class="active-filter">
    <span class="lbl">active filter</span>
    ${chips.join("")}
    <a href="/" class="clear-all">clear all</a>
  </div>
</div>`;
}

function heroCard(n: NoteMeta): string {
  const eyebrowParts: string[] = [];
  eyebrowParts.push(n.type[0].toUpperCase() + n.type.slice(1));
  eyebrowParts.push(ago(n.created));
  const finalChip = n.is_final ? `<span class="pip"></span><span class="final">★ FINAL</span>` : "";
  const lead = n.summary && n.summary.length > 10 ? esc(n.summary) : "";
  return `
<a class="hero" href="/n/${n.id}">
  <div>
    <div class="eyebrow"><span class="dot"></span><span>${eyebrowParts.join(" · ")}</span></div>
    <h1>${esc(n.title)}</h1>
    ${lead ? `<p class="lead">${lead}</p>` : ""}
    <div class="meta">
      <span class="thread">📂 ${esc(n.thread_id)}</span>
      <span class="pip"></span>
      <span>${n.word_count} words</span>
      <span class="pip"></span>
      <span>theme: ${esc(n.theme)}</span>
      ${finalChip}
    </div>
  </div>
  <div class="hero-arrow">→</div>
</a>`;
}

function noteRow(n: NoteMeta): string {
  const expiring = !n.is_final ? daysUntil(n.expires_at) : null;
  let stat = `<span class="stat">·</span>`;
  if (n.is_final) stat = `<span class="stat final">★ final</span>`;
  else if (expiring && /^\d+d$/.test(expiring)) {
    const d = parseInt(expiring);
    if (d <= 7) stat = `<span class="stat warn">⏱ ${expiring}</span>`;
  }
  const subParts: string[] = [];
  subParts.push(`<span class="thread">📂 ${esc(n.thread_id)}</span>`);
  if (n.theme) subParts.push(`${esc(n.theme)} theme`);
  if (n.word_count > 0) subParts.push(`${n.word_count} words`);
  return `
<a class="row" href="/n/${n.id}">
  <span class="type ${n.type}">${n.type}</span>
  <div>
    <span class="title">${esc(n.title)}</span>
    <span class="title-sub">${subParts.join("  ·  ")}</span>
  </div>
  <span class="age">${ago(n.created)}</span>
  ${stat}
</a>`;
}

function searchRow(h: SearchHit): string {
  const subParts: string[] = [];
  subParts.push(`<span class="thread">📂 ${esc(h.thread_id)}</span>`);
  subParts.push(ago(h.created));
  const stat = h.is_final ? `<span class="stat final">★</span>` : `<span class="stat">·</span>`;
  // snippet already contains <mark> from FTS5
  return `
<a class="row with-snippet" href="/n/${h.id}">
  <span class="type ${h.type}">${h.type}</span>
  <div>
    <span class="title">${esc(h.title)}</span>
    <p class="snippet">${h.snippet}</p>
    <span class="title-sub">${subParts.join("  ·  ")}</span>
  </div>
  <span class="age">★ ${(-h.score).toFixed(1)}</span>
  ${stat}
</a>`;
}

export interface ThreadHit {
  thread_id: string;
  count: number;
  latest: string;
  final_count: number;
}

function clusterCard(t: ThreadHit, exampleTitle?: string, blurb?: string): string {
  // Fetch up to 5 sibling notes for the chip stack
  const siblings = db()
    .query<{ slug: string; is_final: number; word_count: number; created: string }, [string]>(
      `SELECT slug, is_final, word_count, created FROM notes WHERE thread_id = ? AND status = 'active' ORDER BY created DESC LIMIT 5`
    )
    .all(t.thread_id);
  const chips = siblings
    .map((s, i) => {
      const v = `v${t.count - i}`;
      const cls = s.is_final ? "chip final" : "chip";
      const star = s.is_final ? "★ " : "";
      return `<span class="${cls}">${star}${v} · ${s.word_count}w</span>`;
    })
    .join("");
  const extraN = Math.max(0, t.count - siblings.length);
  const extraChip = extraN > 0 ? `<span class="chip">+${extraN} earlier</span>` : "";
  const big = t.count;
  const metaTail = t.final_count > 0 ? `★ final · ${ago(t.latest)}` : ago(t.latest);
  const title = exampleTitle ?? siblings[0]?.slug.replace(/-/g, " ") ?? t.thread_id;
  const blurbHtml = blurb ?? `Thread of <strong>${t.count}</strong> ${t.count === 1 ? "note" : "notes"}${t.final_count > 0 ? `, ${t.final_count} marked <em>final</em>` : ""}. Last updated ${ago(t.latest)}.`;
  return `
<a class="cluster" href="/t/${esc(t.thread_id)}">
  <div>
    <div class="tid">📂 ${esc(t.thread_id)}</div>
    <h3>${esc(title)}</h3>
    <p class="blurb">${blurbHtml}</p>
    <div class="stack">${chips}${extraChip}</div>
  </div>
  <div class="cluster-meta">
    <span class="big">${big}</span>
    <span>${t.count === 1 ? "note" : "notes"}</span>
    <span>${metaTail}</span>
  </div>
</a>`;
}

function threadCard(t: ThreadHit): string {
  // Compute progress ticks from real per-note final flags
  const notes = db()
    .query<{ is_final: number }, [string]>(
      `SELECT is_final FROM notes WHERE thread_id = ? AND status = 'active' ORDER BY created ASC`
    )
    .all(t.thread_id);
  const MAX = 8;
  let ticks: string;
  if (notes.length <= MAX) {
    ticks = notes.map((n) => `<span class="tick ${n.is_final ? "final" : "has"}"></span>`).join("");
  } else {
    const shown = notes.slice(0, MAX - 1);
    ticks =
      shown.map((n) => `<span class="tick ${n.is_final ? "final" : "has"}"></span>`).join("") +
      `<span class="more">${notes.length - shown.length} more${t.final_count > 0 ? "" : ", no final"}</span>`;
  }
  // Build title — derive from first note's title to make threads scannable
  const title = db()
    .query<{ title: string }, [string]>(
      `SELECT title FROM notes WHERE thread_id = ? AND status = 'active' ORDER BY is_final DESC, created DESC LIMIT 1`
    )
    .get(t.thread_id)?.title ?? t.thread_id.replace(/-/g, " ");
  const latestFinal = t.final_count > 0 ? `<span class="final-marker">★ ${t.final_count} final</span>` : "";
  return `
<a class="thread-card" href="/t/${esc(t.thread_id)}">
  <div>
    <div class="tid">📂 ${esc(t.thread_id)}</div>
    <div class="title">${esc(title)}</div>
    <div class="progress">${ticks}</div>
  </div>
  <div class="count">${t.count}<small>${t.count === 1 ? "nota" : "not"}</small></div>
  <div class="latest">${ago(t.latest)}${latestFinal ? "<br>" + latestFinal : ""}</div>
</a>`;
}

const KNOWN_NAMESPACES = new Set(["klient", "projekt", "temat", "type"]);

/** Parse `klient:foo` → { ns: "klient", value: "foo", nsClass: "ns-klient" }.
 *  Unknown namespaces and bare tags get `nsClass: ""` so they keep the
 *  neutral muted styling (no jarring color for arbitrary prefixes). */
function parseTagNs(tag: string): { ns: string | null; value: string; nsClass: string } {
  const i = tag.indexOf(":");
  if (i <= 0 || i === tag.length - 1) return { ns: null, value: tag, nsClass: "" };
  const ns = tag.slice(0, i);
  const value = tag.slice(i + 1);
  const nsClass = KNOWN_NAMESPACES.has(ns) ? `ns-${ns}` : "";
  return { ns, value, nsClass };
}

function tagChip(t: { tag: string; count: number }, active = false): string {
  const { ns, value, nsClass } = parseTagNs(t.tag);
  const label = ns !== null
    ? `<span class="ns">${esc(ns)}:</span><span class="val">${esc(value)}</span>`
    : `<span class="val">${esc(value)}</span>`;
  const classes = ["tag-chip"];
  if (nsClass) classes.push(nsClass);
  if (active) classes.push("on");
  return `<a class="${classes.join(" ")}" href="/tag/${encodeURIComponent(t.tag)}">${label}<span class="count">${t.count}</span></a>`;
}

function tagCloud(tags: { tag: string; count: number }[], activeTag?: string): string {
  if (tags.length === 0) return "";
  return `<div class="tag-cloud">${tags.map((t) => tagChip(t, t.tag === activeTag)).join("")}</div>`;
}

export function pageList(
  notes: NoteMeta[],
  counts: CountSummary,
  activeType?: string,
  activeStatus?: string,
  popularTags: { tag: string; count: number }[] = [],
  activeTag?: string
): string {
  const groups = new Map<string, NoteMeta[]>();
  for (const n of notes) {
    const g = dateGroup(n.created);
    const arr = groups.get(g) ?? [];
    arr.push(n);
    groups.set(g, arr);
  }
  const groupsHtml = Array.from(groups.entries())
    .map(([label, items], idx) => {
      const accent = idx === 0 && label === "Today" ? `<span class="spacer"></span><span class="accent">fresh</span>` : "";
      const lbl = `<div class="group-lbl">${label} <span class="count">· ${items.length}</span>${accent}</div>`;
      // For "Today" group, first note gets hero treatment
      if (idx === 0 && label === "Today" && items.length > 0) {
        const [hero, ...rest] = items;
        return `<div class="group">${lbl}${heroCard(hero!)}${rest.length > 0 ? `<div class="rows">${rest.map(noteRow).join("")}</div>` : ""}</div>`;
      }
      return `<div class="group">${lbl}<div class="rows">${items.map(noteRow).join("")}</div></div>`;
    })
    .join("");

  const tagsSection = popularTags.length > 0 && !activeType && !activeStatus && !activeTag
    ? `<div class="group">
         <div class="group-lbl">Tags <span class="count">· ${popularTags.length}</span><span class="spacer"></span><span class="accent">popular</span></div>
         ${tagCloud(popularTags, activeTag)}
       </div>`
    : "";

  const emptyMsg = activeTag
    ? `No notes tagged <code>${esc(activeTag)}</code>${activeType ? ` of type <code>${esc(activeType)}</code>` : ""}.`
    : activeType
    ? `No notes of type <code>${esc(activeType)}</code>.`
    : `Create your first note: <code>folio new --title "..." --html @file.html</code>`;
  const body = notes.length === 0
    ? `<div class="empty"><h2>Empty</h2><p class="lead">${emptyMsg}</p></div>`
    : `<main class="v-page">${groupsHtml}${tagsSection}</main>`;

  const meta = notes.length > 0 ? `${notes.length} ${notes.length === 1 ? "note" : "notes"} · latest ${ago(notes[0]!.created)}` : "";
  return shell("Folio", `${topbar("", "notes")}${filterBar(activeType, activeStatus, counts, meta, activeTag)}${activeFilterStrip(activeTag, activeType, activeStatus)}${body}`);
}

export function pageTag(tag: string, notes: NoteMeta[], popularTags: { tag: string; count: number }[] = []): string {
  const sorted = [...notes].sort((a, b) => b.created.localeCompare(a.created));
  const latest = sorted[0]?.created ?? "";
  const finalCount = notes.filter((n) => n.is_final).length;
  const rows = sorted.map(noteRow).join("");
  const otherTags = popularTags.filter((t) => t.tag !== tag).slice(0, 16);
  const otherCloud = otherTags.length > 0
    ? `<div class="group">
         <div class="group-lbl">Other popular tags <span class="count">· ${otherTags.length}</span></div>
         ${tagCloud(otherTags)}
       </div>`
    : "";

  const { ns, value, nsClass } = parseTagNs(tag);
  // Description: <prefix>: <value-with-spaces> — fact-only, no prose
  const description = ns !== null
    ? `${esc(ns)}: ${esc(value.replace(/-/g, " "))}`
    : "";
  const headerInner = ns !== null
    ? `<span class="ns">${esc(ns)}:</span><span class="val">${esc(value)}</span>`
    : `<span class="val">${esc(tag)}</span>`;
  const headerClasses = ["tag-header"];
  if (nsClass) headerClasses.push(nsClass);

  const body = `
<main class="v-page">
  <div class="group">
    <div class="group-lbl"><a href="/" style="color:var(--vmuted)">← Notes</a> <span class="spacer"></span><span class="accent">tag</span></div>
    <div style="padding: 12px 4px 24px;">
      <div class="${headerClasses.join(" ")}">${headerInner}<span class="count">${notes.length} ${notes.length === 1 ? "note" : "notes"}</span></div>
      <div style="font-family: var(--vserif); font-style: italic; font-size: 17px; color: var(--vmuted); margin-top: 12px; line-height: 1.4;">${description ? esc("Notes tagged: ") + description : "Notes carrying this tag."}</div>
      <div style="font-family: var(--vmono); font-size: 12px; color: var(--vmuted-2); margin-top: 6px;">
        latest ${ago(latest)}${finalCount > 0 ? ` · <span style="color:var(--vorange)">★ ${finalCount} final</span>` : ""}
        · <a href="/?tag=${encodeURIComponent(tag)}" style="color:var(--vmuted); border-bottom: 1px solid var(--vline);">open in main feed</a>
      </div>
    </div>
    <div class="rows">${rows}</div>
  </div>
  ${otherCloud}
</main>`;
  return shell(`Tag: ${tag}`, `${topbar("", "notes")}${body}`);
}

export function pageSearch(
  query: string,
  hits: SearchHit[],
  threadHits: ThreadHit[],
  counts: CountSummary,
  durationMs: number
): string {
  const empty = hits.length === 0 && threadHits.length === 0;
  const body = empty
    ? `<div class="empty"><h2>No results</h2><p class="lead">Try different words. Or browse <a href="/threads" style="color:var(--vorange);border-bottom:1px solid currentColor">all threads</a>.</p></div>`
    : `<main class="v-page">
         ${threadHits.length ? `<div class="group">
            <div class="group-lbl">Threads <span class="count">· ${threadHits.length} ${threadHits.length === 1 ? "hit" : "hits"}</span><span class="spacer"></span><span class="accent">groups</span></div>
            ${threadHits.map((t) => clusterCard(t)).join("")}
          </div>` : ""}
         ${hits.length ? `<div class="group">
            <div class="group-lbl">Notes <span class="count">· ${hits.length} ${hits.length === 1 ? "hit" : "hits"}</span><span class="spacer"></span><span class="accent">single hits</span></div>
            <div class="rows">${hits.map(searchRow).join("")}</div>
          </div>` : ""}
       </main>`;
  const meta = `${hits.length + threadHits.length} ${hits.length + threadHits.length === 1 ? "hit" : "hits"} · ${durationMs} ms · fts5`;
  return shell(`Search: ${query}`, `${topbar(query, "notes")}${filterBar(undefined, undefined, counts, meta)}${body}`);
}

export function pageThreads(threads: ThreadHit[], query?: string): string {
  // Split into active (recent activity, no final) vs closed (has final) — or just active vs all
  const withFinal = threads.filter((t) => t.final_count > 0);
  const active = threads.filter((t) => t.final_count === 0);
  const sections: string[] = [];
  if (active.length > 0) {
    sections.push(`<div class="group">
      <div class="group-lbl">${query ? "Matched active" : "Active"} <span class="count">· ${active.length}</span><span class="spacer"></span><span class="accent">in progress</span></div>
      <div class="rows">${active.map(threadCard).join("")}</div>
    </div>`);
  }
  if (withFinal.length > 0) {
    sections.push(`<div class="group">
      <div class="group-lbl">With final <span class="count">· ${withFinal.length}</span></div>
      <div class="rows">${withFinal.map(threadCard).join("")}</div>
    </div>`);
  }
  const body = threads.length === 0
    ? `<div class="empty"><h2>No threads</h2><p class="lead">${query ? `No matches for <code>${esc(query)}</code>.` : "Create a note with a thread_id to start."}</p></div>`
    : `<main class="v-page">${sections.join("")}</main>`;
  const meta = `${threads.length} ${threads.length === 1 ? "thread" : "threads"} · sort: last activity`;
  return shell("Threads", `${topbar(query ?? "", "threads")}${filterBar(undefined, undefined, undefined, meta)}${body}`);
}

export function pageThread(threadId: string, notes: NoteMeta[]): string {
  const sorted = [...notes].sort((a, b) => a.created.localeCompare(b.created));
  const latest = sorted[sorted.length - 1]?.created ?? "";
  const hasFinal = notes.some((n) => n.is_final);
  const rows = sorted.map((n, i) => {
    const expiring = !n.is_final ? daysUntil(n.expires_at) : null;
    let stat = `<span class="stat">·</span>`;
    if (n.is_final) stat = `<span class="stat final">★ final</span>`;
    else if (expiring && /^\d+d$/.test(expiring)) {
      const d = parseInt(expiring);
      if (d <= 7) stat = `<span class="stat warn">⏱ ${expiring}</span>`;
    }
    return `
<a class="row" href="/n/${n.id}">
  <span class="type ${n.type}">v${i + 1} · ${n.type}</span>
  <div>
    <span class="title">${esc(n.title)}</span>
    <span class="title-sub">${esc(n.theme)} theme · ${n.word_count} words</span>
  </div>
  <span class="age">${ago(n.created)}</span>
  ${stat}
</a>`;
  }).join("");

  const body = `
<main class="v-page">
  <div class="group">
    <div class="group-lbl"><a href="/threads" style="color:var(--vmuted)">← Threads</a> <span class="spacer"></span>${hasFinal ? `<span class="accent">final in thread</span>` : `<span class="accent">in progress</span>`}</div>
    <div style="padding: 8px 4px 20px;">
      <div style="font-family: var(--vmono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vbronze); margin-bottom: 8px;">📂 ${esc(threadId)}</div>
      <h1 style="font-family: var(--vhead); font-weight: 500; font-size: clamp(28px, 3.6vw, 40px); letter-spacing: -0.025em; margin: 0 0 6px; line-height: 1.1;">Thread</h1>
      <div style="font-family: var(--vmono); font-size: 12px; color: var(--vmuted);">
        ${notes.length} ${notes.length === 1 ? "note" : "notes"} · latest ${ago(latest)}${hasFinal ? ` · <span style="color:var(--vorange)">★ final</span>` : ""}
      </div>
    </div>
    <div class="rows">${rows}</div>
  </div>
</main>`;
  return shell(`Thread: ${threadId}`, `${topbar("", "threads")}${body}`);
}

export function pageNote(note: NoteMeta, _themeName: string): string {
  const expiring = note.is_final ? null : daysUntil(note.expires_at);
  const banner = !note.is_final && expiring
    ? `<div class="note-banner">
        <div><span class="lbl">⏱ Auto-delete in ${expiring}</span>&nbsp; unless you mark final or publish</div>
        <form method="post" action="/api/notes/${note.id}/finalize" style="margin:0"><button class="finalize-btn" type="submit">★ Finalize</button></form>
       </div>`
    : "";

  // Sibling notes in thread, ascending — for version label + prev/next nav
  const allSiblings = db()
    .query<{ id: string; created: string }, [string]>(
      `SELECT id, created FROM notes WHERE thread_id = ? AND status='active' ORDER BY created ASC`
    )
    .all(note.thread_id);
  const myIdx = allSiblings.findIndex((s) => s.id === note.id);
  const version = myIdx >= 0 ? myIdx + 1 : 1;
  const totalInThread = allSiblings.length || 1;
  const prevSibling = myIdx > 0 ? allSiblings[myIdx - 1] : null;
  const nextSibling = myIdx >= 0 && myIdx < allSiblings.length - 1 ? allSiblings[myIdx + 1] : null;

  // Reading time @ ~220 wpm
  const readingMin = Math.max(1, Math.ceil(note.word_count / 220));

  const prevNextHtml = totalInThread > 1
    ? `<div class="prev-next">
         ${prevSibling
           ? `<a class="pn-btn" href="/n/${prevSibling.id}"><span class="pn-label">← prev</span>v${myIdx}</a>`
           : `<span class="pn-btn disabled"><span class="pn-label">prev</span>—</span>`}
         ${nextSibling
           ? `<a class="pn-btn" href="/n/${nextSibling.id}"><span class="pn-label">next →</span>v${myIdx + 2}</a>`
           : `<span class="pn-btn disabled"><span class="pn-label">next</span>—</span>`}
       </div>`
    : "";

  const actionCard = note.is_final
    ? `<div class="action-card" style="background:var(--vorange-soft);color:var(--vorange);cursor:default">
         <div class="ac-lbl" style="color:var(--vorange)">Status</div>
         <div class="ac-title"><span class="ac-star">★</span> Final · preserved</div>
         <div class="ac-hint" style="color:var(--vmuted)">Excluded from auto-cleanup. Safely archived in this thread.</div>
       </div>`
    : `<form method="post" action="/api/notes/${note.id}/finalize" style="margin:0">
         <button class="action-card" type="submit">
           <span class="ac-lbl">Primary action</span>
           <span class="ac-title"><span class="ac-star">★</span> Mark as final</span>
           <span class="ac-hint">Stop auto-delete · archive as canonical version of the thread</span>
         </button>
       </form>`;

  const tagsHtml = note.tags.length > 0
    ? `<dt>Tags</dt><dd><div class="side-tags">${note.tags.map((t) => `<a class="tg" href="/tag/${encodeURIComponent(t)}">${esc(t)}</a>`).join("")}</div></dd>`
    : "";

  const tocHtml = `<nav class="toc" id="folio-toc" hidden><div class="toc-lbl">In this document</div><ol class="toc-list"></ol></nav>`;

  const themes = listThemes();
  const themeOptions = themes
    .map((t) => `<option value="${esc(t.name)}"${t.name === note.theme ? " selected" : ""}>${esc(t.name)}${t.name === note.theme ? " · saved" : ""}</option>`)
    .join("");
  const themeDd = `<dd><select class="theme-switch" data-noteid="${note.id}" data-original="${esc(note.theme)}">${themeOptions}</select></dd>`;

  // Parent-side viewer chrome. The note lives in a null-origin iframe (since
  // v0.3+) so we cannot reach .contentDocument; instead the note's bootstrap
  // script publishes TOC / scroll / heading-spy events via postMessage and we
  // request content (plain/markdown) the same way for copy buttons.
  const noteScript = `<script>(function(){
    var iframe = document.querySelector('.note-iframe');
    var sel = document.querySelector('.theme-switch');
    var progressFill = document.querySelector('.reading-progress-fill');
    var toc = document.getElementById('folio-toc');
    var tocList = toc ? toc.querySelector('.toc-list') : null;
    var tocItems = []; // [{ id, li }]

    // Theme preview switcher — purely parent-side, no iframe content access
    if (sel && iframe) {
      sel.addEventListener('change', function(){
        var t = sel.value;
        var orig = sel.dataset.original;
        iframe.src = '/raw/' + sel.dataset.noteid + (t !== orig ? '?theme=' + encodeURIComponent(t) : '');
      });
    }

    function buildToc(items){
      if (!toc || !tocList) return;
      var visible = items.filter(function(i){ return i.level === 'h2' || i.level === 'h3'; });
      if (visible.length < 3) { toc.hidden = true; return; }
      tocList.innerHTML = '';
      tocItems = [];
      visible.forEach(function(it){
        var li = document.createElement('li');
        li.className = it.level;
        li.dataset.targetId = it.id;
        var a = document.createElement('a');
        a.textContent = it.text;
        a.addEventListener('click', function(e){
          e.preventDefault();
          postToIframe({ type: 'scroll-to', id: it.id });
        });
        li.appendChild(a);
        tocList.appendChild(li);
        tocItems.push({ id: it.id, li: li });
      });
      toc.hidden = false;
    }

    function setActiveHeading(id){
      tocItems.forEach(function(it){
        if (it.id === id) it.li.classList.add('active');
        else it.li.classList.remove('active');
      });
    }

    function postToIframe(msg){
      try { iframe && iframe.contentWindow && iframe.contentWindow.postMessage(Object.assign({ ns: 'folio' }, msg), '*'); } catch(_){}
    }

    // Pending copy requests: requestId -> { resolve, reject, timer }
    var pending = new Map();
    var nextReqId = 1;
    function requestContent(){
      var id = String(nextReqId++);
      return new Promise(function(resolve, reject){
        var timer = setTimeout(function(){
          pending.delete(id);
          reject(new Error('content-timeout'));
        }, 2000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        postToIframe({ type: 'request-content', requestId: id });
      });
    }
    // Receive messages from the note's bootstrap (runs inside the iframe)
    window.addEventListener('message', function(e){
      var d = e.data; if (!d || d.ns !== 'folio') return;
      // Optional source check: only accept from our iframe's window
      if (iframe && e.source && e.source !== iframe.contentWindow) return;
      switch (d.type) {
        case 'ready':
          // Tell the note our parent URL so anchor-copy builds a clipboard URL
          // that opens the viewer page (with the hash) rather than /raw/.
          postToIframe({ type: 'set-parent-url', url: window.location.href });
          break;
        case 'toc':
          buildToc(Array.isArray(d.items) ? d.items : []);
          break;
        case 'heading':
          if (d.id) setActiveHeading(String(d.id));
          break;
        case 'scroll':
          if (progressFill) progressFill.style.width = Math.max(0, Math.min(100, Number(d.pct) || 0)) + '%';
          break;
        case 'content': {
          var p = pending.get(String(d.requestId));
          if (!p) return;
          clearTimeout(p.timer);
          pending.delete(String(d.requestId));
          p.resolve({ plain: String(d.plain || ''), markdown: String(d.markdown || '') });
          break;
        }
      }
    });

    // Copy buttons — ask the iframe over postMessage instead of reading its DOM
    document.querySelectorAll('[data-copy]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        e.preventDefault();
        var mode = btn.dataset.copy;
        var orig = btn.dataset.label;
        requestContent().then(function(content){
          var text = mode === 'markdown' ? content.markdown : content.plain;
          return navigator.clipboard.writeText(text);
        }).then(function(){
          btn.textContent = '✓ copied';
          btn.classList.add('copied');
          setTimeout(function(){ btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
        }).catch(function(){
          btn.textContent = '✗ error';
          setTimeout(function(){ btn.textContent = orig; }, 1500);
        });
      });
    });

    // Delete button — two-step inline confirmation (no modal dialog). First
    // click flips label + colour; second click within 5s POSTs the delete
    // and navigates to the thread index. Resets if the user mouses away or
    // 5s elapse, so a stray double-tap can't fire it.
    (function(){
      var btn = document.getElementById('folio-delete-btn');
      if (!btn) return;
      var armedTimer = 0;
      var armed = false;
      function disarm(){
        armed = false;
        btn.classList.remove('confirming');
        btn.textContent = btn.dataset.defaultLabel || '✕ Delete note';
        if (armedTimer) { clearTimeout(armedTimer); armedTimer = 0; }
      }
      btn.addEventListener('click', function(){
        if (!armed) {
          armed = true;
          btn.classList.add('confirming');
          btn.textContent = btn.dataset.confirmLabel || '✕ Click again to confirm';
          armedTimer = setTimeout(disarm, 5000);
          return;
        }
        var id = btn.dataset.noteId;
        var thread = btn.dataset.threadId;
        btn.disabled = true;
        btn.textContent = '… deleting';
        fetch('/api/notes/' + encodeURIComponent(id) + '/delete', {
          method: 'POST',
          headers: { 'X-Folio-Thread': '/t/' + thread },
        }).then(function(r){
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function(body){
          window.location.href = body.thread_redirect || ('/t/' + thread);
        }).catch(function(e){
          btn.disabled = false;
          btn.classList.remove('confirming');
          btn.textContent = '✗ error: ' + e.message;
          setTimeout(disarm, 2500);
        });
      });
      btn.addEventListener('mouseleave', function(){
        if (armed) disarm();
      });
    })();
  })();</script>`;

  // Live notes: inject a side panel iframe with the compiled feed plus
  // a chrome-side EventSource subscriber. Panel iframe is sandboxed and
  // null-origin (no allow-same-origin); chrome and panel talk via
  // postMessage. Body iframe is unchanged — its CSP stays connect-src:'none'.
  const isLive = note.live && !note.is_final;
  let livePanelHtml = "";
  let liveScript = "";
  if (isLive) {
    const themeCss = loadThemeCss(note.theme) ?? "";
    const srcdoc = panelIframeSrcdoc({ theme_css: themeCss, entries_css: ENTRIES_CSS });
    livePanelHtml = `
  <aside class="live-panel" aria-label="Live entries feed">
    <iframe class="live-panel-iframe" title="Live feed" sandbox="allow-scripts" srcdoc="${esc(srcdoc)}"></iframe>
  </aside>`;
    liveScript = `<script>window.__folioLiveNoteId = ${JSON.stringify(note.id)};</script>${LIVE_CHROME_JS}`;
  }
  const shellClass = isLive ? "note-shell has-live" : "note-shell";

  return shell(note.title, `${topbar()}
<div class="reading-progress"><div class="reading-progress-fill"></div></div>
<div class="${shellClass}">
  <aside class="note-side">
    <a href="/" class="back">← Back to list</a>
    <span class="type-pill ${note.type}">${note.type}</span>
    <h1>${esc(note.title)}</h1>
    ${actionCard}
    ${prevNextHtml}
    ${tocHtml}
    <dl class="side-meta">
      <dt>Thread</dt><dd class="thread"><a href="/t/${esc(note.thread_id)}">${esc(note.thread_id)}</a></dd>
      <dt>Status</dt><dd class="${note.is_final ? "final" : "warn"}">${note.is_final ? "★ final" : (expiring ? `⏱ expires in ${expiring}` : "active")}</dd>
      <dt>Created</dt><dd>${ago(note.created)}</dd>
      <dt>Version</dt><dd>v${version} of ${totalInThread}</dd>
      <dt>Words</dt><dd>${note.word_count} · ~${readingMin} min</dd>
      <dt>Theme</dt>${themeDd}
      <dt>Profile</dt><dd>${esc(note.theme_profile)}</dd>
      ${tagsHtml}
    </dl>
    <nav class="side-aux">
      <button class="side-action" data-copy="plain" data-label="⎘ Copy plain text">⎘ Copy plain text</button>
      <button class="side-action" data-copy="markdown" data-label="⎘ Copy as markdown">⎘ Copy as markdown</button>
      <a href="/raw/${note.id}" target="_blank">↗ View raw HTML</a>
      <a href="#" onclick="window.print();return false">↗ Print / PDF</a>
      <button class="side-action danger" id="folio-delete-btn"
              data-note-id="${esc(note.id)}"
              data-thread-id="${esc(note.thread_id)}"
              data-default-label="✕ Delete note"
              data-confirm-label="✕ Click again to confirm">✕ Delete note</button>
    </nav>
  </aside>
  <main class="note-main">
    ${banner}
    <div class="note-iframe-wrap">
      <iframe class="note-iframe" src="/raw/${note.id}" title="${esc(note.title)}" sandbox="allow-scripts allow-popups allow-forms"></iframe>
    </div>
  </main>${livePanelHtml}
</div>${noteScript}${liveScript}`);
}

export function pageStats(s: any): string {
  return shell("Stats", `${topbar("", "stats")}
<main class="v-page">
  <div class="group">
    <div class="group-lbl">System state <span class="count">· live</span></div>
    <div style="padding: 8px 4px 20px;">
      <h1 style="font-family: var(--vhead); font-weight: 500; font-size: clamp(28px, 3.6vw, 40px); letter-spacing: -0.025em; margin: 0 0 6px; line-height: 1.1;">Stats</h1>
      <div style="font-family: var(--vserif); font-style: italic; font-size: 18px; color: var(--vmuted); margin-bottom: 12px;">What Folio knows about itself.</div>
      <div style="font-family: var(--vmono); font-size: 11px; letter-spacing: 0.06em; color: var(--vmuted-2); display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; background: var(--vbg-2); border: 1px solid var(--vline-2); border-radius: 6px;">
        <span style="color: var(--vorange); font-weight: 600;">●</span> folio
        <span style="color: var(--vink); font-weight: 600;">v${esc(pkg.version)}</span>
        · ${esc(pkg.name)}
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat-cell"><div class="n acc">${s.total}</div><div class="lbl">Total</div></div>
      <div class="stat-cell"><div class="n good">${s.final}</div><div class="lbl">★ Final</div></div>
      <div class="stat-cell"><div class="n mid">${s.expiring_7d}</div><div class="lbl">Expiring 7d</div></div>
      <div class="stat-cell"><div class="n">${s.threads}</div><div class="lbl">Threads</div></div>
    </div>
  </div>

  <div class="group">
    <div class="group-lbl">By type</div>
    <div class="rows">
      ${s.by_type.map((t: any) => `<div class="row" style="cursor:default"><span class="type ${t.type}">${t.type}</span><div><span class="title" style="font-size:15px">${t.type}</span></div><span class="age">${t.n}</span><span class="stat">·</span></div>`).join("")}
    </div>
  </div>

  <div class="group">
    <div class="group-lbl">Analytics <span class="count">· ADR-017</span></div>
    <div style="padding: 8px 4px; font-family: var(--vmono); font-size: 13px; color: var(--vink-2); line-height: 1.8;">
      <div>Class match rate: <strong>${s.analytics.avg_class_match == null ? "—" : (s.analytics.avg_class_match * 100).toFixed(1) + "%"}</strong></div>
      <div>Logged events: <strong>${s.analytics.total_events}</strong></div>
    </div>
  </div>
</main>`);
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Folio</title><style>${VIEWER_CSS}</style></head><body>${body}${KBD_SHORTCUT_JS}</body></html>`;
}

export function pageError(code: number, msg: string): string {
  return shell(`${code}`, `${topbar()}<div class="empty"><h2>${code}</h2><p class="lead">${esc(msg)}</p><p style="margin-top:24px;"><a href="/" style="color:var(--vorange);border-bottom:1px solid currentColor;font-family:var(--vmono);font-size:13px">← Back to list</a></p></div>`);
}
