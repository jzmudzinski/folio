import type { NoteMeta, SearchHit } from "../core/types";
import { db } from "../core/db";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ago(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s temu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min temu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} godz temu`;
  const d = Math.floor(h / 24);
  return d === 1 ? "wczoraj" : `${d} dni temu`;
}

function daysUntil(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const d = Math.floor(ms / 86400000);
  if (d < 0) return "wygasła";
  if (d === 0) return "dziś";
  if (d === 1) return "jutro";
  return `${d}d`;
}

function dateGroup(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dDay = new Date(d);
  dDay.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((today.getTime() - dDay.getTime()) / 86400000);
  if (diffDays === 0) return "Dzisiaj";
  if (diffDays === 1) return "Wczoraj";
  if (diffDays < 7) return "W tym tygodniu";
  if (diffDays < 30) return "W tym miesiącu";
  return "Starsze";
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

.note-shell { display: grid; grid-template-columns: 248px 1fr; min-height: calc(100vh - 60px); }
.note-side { border-right: 1px solid var(--vline); padding: 24px 22px 22px; display: flex; flex-direction: column; gap: 0; background: var(--vbg); position: sticky; top: 60px; align-self: start; max-height: calc(100vh - 60px); overflow-y: auto; }
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
.side-meta dd { font-family: var(--vmono); font-size: 12px; color: var(--vink-2); margin: 0; align-self: baseline; }
.side-meta dd.thread { color: var(--vbronze); }
.side-meta dd.warn { color: var(--vamber); }
.side-meta dd.final { color: var(--vorange); }
.side-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.side-tags .tg { font-family: var(--vmono); font-size: 10.5px; padding: 3px 8px; border-radius: 4px; background: var(--vbg-2); color: var(--vmuted); border: 1px solid var(--vline-2); }
.side-aux { margin-top: auto; padding-top: 18px; border-top: 1px solid var(--vline); display: flex; flex-direction: column; gap: 4px; }
.side-aux a, .side-aux button { font-family: var(--vmono); font-size: 11px; color: var(--vmuted); letter-spacing: 0.06em; padding: 4px 0; transition: color .12s; background: transparent; border: 0; text-align: left; cursor: pointer; }
.side-aux a:hover, .side-aux button:hover { color: var(--vorange); }
.side-aux .danger { color: #c8412a; opacity: 0.7; }

.note-main { background: var(--vpanel); min-width: 0; }
.note-banner { padding: 12px 24px; background: linear-gradient(90deg, rgba(201,142,45,0.08), transparent 60%); border-bottom: 1px solid var(--vline-2); display: flex; align-items: center; justify-content: space-between; font-family: var(--vmono); font-size: 11.5px; color: var(--vink-2); gap: 14px; flex-wrap: wrap; }
.note-banner .lbl { color: var(--vamber); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; font-size: 10.5px; }
.note-banner .finalize-btn { font-family: var(--vhead); font-weight: 500; font-size: 13px; letter-spacing: -0.005em; padding: 6px 14px; border-radius: 7px; background: var(--vink); color: var(--vbg); border: 0; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
.note-banner .finalize-btn:hover { background: var(--vorange); }
.note-iframe-wrap { background: var(--vpanel); min-height: calc(100vh - 60px); }
.note-iframe { width: 100%; height: calc(100vh - 60px); border: 0; display: block; }

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
      <input type="search" name="q" placeholder="Szukaj notatek i wątków…" value="${esc(query)}" autocomplete="off">
      <kbd>/</kbd>
    </form>
    <nav class="v-nav">
      <a href="/"${on("notes")}>Noty</a>
      <a href="/threads"${on("threads")}>Wątki</a>
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

function filterBar(activeType?: string, activeStatus?: string, counts?: CountSummary, resultsMeta?: string): string {
  const cs = counts ?? { all: 0, final: 0, expiring: 0, byType: {} };
  const on = (cond: boolean) => (cond ? " on" : "");
  return `
<div class="v-strip">
  <div class="v-strip-inner">
    <a href="/" class="fp${on(!activeType && !activeStatus)}">Wszystkie <span class="count">${cs.all}</span></a>
    <a href="/?type=research" class="fp${on(activeType === "research")}">Research <span class="count">${cs.byType.research ?? 0}</span></a>
    <a href="/?type=comparison" class="fp${on(activeType === "comparison")}">Comparison <span class="count">${cs.byType.comparison ?? 0}</span></a>
    <a href="/?type=technical" class="fp${on(activeType === "technical")}">Technical <span class="count">${cs.byType.technical ?? 0}</span></a>
    ${cs.byType.journal ? `<a href="/?type=journal" class="fp${on(activeType === "journal")}">Journal <span class="count">${cs.byType.journal}</span></a>` : ""}
    <span class="sep"></span>
    <a href="/?final=1" class="fp${on(activeStatus === "final")}"><span class="star">★</span> Final <span class="count">${cs.final}</span></a>
    <a href="/?expiring=1" class="fp warn${on(activeStatus === "expiring")}">⏱ Wygasające 7d <span class="count">${cs.expiring}</span></a>
    ${resultsMeta ? `<span class="results-meta">${esc(resultsMeta)}</span>` : ""}
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
      <span>${n.word_count} słów</span>
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
  if (n.word_count > 0) subParts.push(`${n.word_count} słów`);
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
  const extraChip = extraN > 0 ? `<span class="chip">+${extraN} wcześniejszych</span>` : "";
  const big = t.count;
  const metaTail = t.final_count > 0 ? `★ final · ${ago(t.latest)}` : ago(t.latest);
  const title = exampleTitle ?? siblings[0]?.slug.replace(/-/g, " ") ?? t.thread_id;
  const blurbHtml = blurb ?? `Wątek z <strong>${t.count}</strong> ${t.count === 1 ? "notą" : "notatkami"}${t.final_count > 0 ? `, ${t.final_count} oznaczon${t.final_count === 1 ? "a" : "e"} jako <em>final</em>` : ""}. Ostatnia aktualizacja ${ago(t.latest)}.`;
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
    <span>${t.count === 1 ? "nota" : "not"}</span>
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
      `<span class="more">${notes.length - shown.length} więcej${t.final_count > 0 ? "" : ", brak final"}</span>`;
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

export function pageList(notes: NoteMeta[], counts: CountSummary, activeType?: string, activeStatus?: string): string {
  const groups = new Map<string, NoteMeta[]>();
  for (const n of notes) {
    const g = dateGroup(n.created);
    const arr = groups.get(g) ?? [];
    arr.push(n);
    groups.set(g, arr);
  }
  const groupsHtml = Array.from(groups.entries())
    .map(([label, items], idx) => {
      const accent = idx === 0 && label === "Dzisiaj" ? `<span class="spacer"></span><span class="accent">świeże</span>` : "";
      const lbl = `<div class="group-lbl">${label} <span class="count">· ${items.length}</span>${accent}</div>`;
      // For "Dzisiaj" group, first note gets hero treatment
      if (idx === 0 && label === "Dzisiaj" && items.length > 0) {
        const [hero, ...rest] = items;
        return `<div class="group">${lbl}${heroCard(hero!)}${rest.length > 0 ? `<div class="rows">${rest.map(noteRow).join("")}</div>` : ""}</div>`;
      }
      return `<div class="group">${lbl}<div class="rows">${items.map(noteRow).join("")}</div></div>`;
    })
    .join("");

  const body = notes.length === 0
    ? `<div class="empty"><h2>Pusto</h2><p class="lead">Stwórz pierwszą notatkę: <code>folio new --title "..." --html @file.html</code></p></div>`
    : `<main class="v-page">${groupsHtml}</main>`;

  const meta = notes.length > 0 ? `${notes.length} not · ostatnia ${ago(notes[0]!.created)}` : "";
  return shell("Folio", `${topbar("", "notes")}${filterBar(activeType, activeStatus, counts, meta)}${body}`);
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
    ? `<div class="empty"><h2>Brak wyników</h2><p class="lead">Spróbuj innych słów. Albo zobacz <a href="/threads" style="color:var(--vorange);border-bottom:1px solid currentColor">wszystkie wątki</a>.</p></div>`
    : `<main class="v-page">
         ${threadHits.length ? `<div class="group">
            <div class="group-lbl">Wątki <span class="count">· ${threadHits.length} ${threadHits.length === 1 ? "trafienie" : "trafień"}</span><span class="spacer"></span><span class="accent">grupy</span></div>
            ${threadHits.map((t) => clusterCard(t)).join("")}
          </div>` : ""}
         ${hits.length ? `<div class="group">
            <div class="group-lbl">Notatki <span class="count">· ${hits.length} ${hits.length === 1 ? "trafienie" : "trafień"}</span><span class="spacer"></span><span class="accent">single hits</span></div>
            <div class="rows">${hits.map(searchRow).join("")}</div>
          </div>` : ""}
       </main>`;
  const meta = `${hits.length + threadHits.length} trafień · ${durationMs} ms · fts5`;
  return shell(`Szukaj: ${query}`, `${topbar(query, "notes")}${filterBar(undefined, undefined, counts, meta)}${body}`);
}

export function pageThreads(threads: ThreadHit[], query?: string): string {
  // Split into active (recent activity, no final) vs closed (has final) — or just active vs all
  const withFinal = threads.filter((t) => t.final_count > 0);
  const active = threads.filter((t) => t.final_count === 0);
  const sections: string[] = [];
  if (active.length > 0) {
    sections.push(`<div class="group">
      <div class="group-lbl">${query ? "Dopasowane aktywne" : "Aktywne"} <span class="count">· ${active.length}</span><span class="spacer"></span><span class="accent">w toku</span></div>
      <div class="rows">${active.map(threadCard).join("")}</div>
    </div>`);
  }
  if (withFinal.length > 0) {
    sections.push(`<div class="group">
      <div class="group-lbl">${query ? "Z finalem" : "Z finalem"} <span class="count">· ${withFinal.length}</span></div>
      <div class="rows">${withFinal.map(threadCard).join("")}</div>
    </div>`);
  }
  const body = threads.length === 0
    ? `<div class="empty"><h2>Brak wątków</h2><p class="lead">${query ? `Brak dopasowań dla <code>${esc(query)}</code>.` : "Stwórz notatkę z thread_id, żeby zacząć."}</p></div>`
    : `<main class="v-page">${sections.join("")}</main>`;
  const meta = `${threads.length} ${threads.length === 1 ? "wątek" : "wątków"} · sort: ostatnia aktywność`;
  return shell("Wątki", `${topbar(query ?? "", "threads")}${filterBar(undefined, undefined, undefined, meta)}${body}`);
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
    <span class="title-sub">${esc(n.theme)} theme · ${n.word_count} słów</span>
  </div>
  <span class="age">${ago(n.created)}</span>
  ${stat}
</a>`;
  }).join("");

  const body = `
<main class="v-page">
  <div class="group">
    <div class="group-lbl"><a href="/threads" style="color:var(--vmuted)">← Wątki</a> <span class="spacer"></span>${hasFinal ? `<span class="accent">final w wątku</span>` : `<span class="accent">w toku</span>`}</div>
    <div style="padding: 8px 4px 20px;">
      <div style="font-family: var(--vmono); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--vbronze); margin-bottom: 8px;">📂 ${esc(threadId)}</div>
      <h1 style="font-family: var(--vhead); font-weight: 500; font-size: clamp(28px, 3.6vw, 40px); letter-spacing: -0.025em; margin: 0 0 6px; line-height: 1.1;">Wątek</h1>
      <div style="font-family: var(--vmono); font-size: 12px; color: var(--vmuted);">
        ${notes.length} ${notes.length === 1 ? "nota" : "not"} · ostatnia ${ago(latest)}${hasFinal ? ` · <span style="color:var(--vorange)">★ final</span>` : ""}
      </div>
    </div>
    <div class="rows">${rows}</div>
  </div>
</main>`;
  return shell(`Wątek: ${threadId}`, `${topbar("", "threads")}${body}`);
}

export function pageNote(note: NoteMeta, _themeName: string): string {
  const expiring = note.is_final ? null : daysUntil(note.expires_at);
  const banner = !note.is_final && expiring
    ? `<div class="note-banner">
        <div><span class="lbl">⏱ Auto-delete za ${expiring}</span>&nbsp; chyba że oznaczysz jako final albo opublikujesz</div>
        <form method="post" action="/api/notes/${note.id}/finalize" style="margin:0"><button class="finalize-btn" type="submit">★ Finalize</button></form>
       </div>`
    : "";

  // Pick representative version label — first note in thread or v(n)
  const siblings = db()
    .query<{ id: string }, [string, string]>(
      `SELECT id FROM notes WHERE thread_id = ? AND status='active' AND created <= ? ORDER BY created ASC`
    )
    .all(note.thread_id, note.created);
  const version = siblings.length;
  const totalInThread = db()
    .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM notes WHERE thread_id = ? AND status='active'")
    .get(note.thread_id)?.n ?? 1;

  const actionCard = note.is_final
    ? `<div class="action-card" style="background:var(--vorange-soft);color:var(--vorange);cursor:default">
         <div class="ac-lbl" style="color:var(--vorange)">Status</div>
         <div class="ac-title"><span class="ac-star">★</span> Final · zachowane</div>
         <div class="ac-hint" style="color:var(--vmuted)">Wyłączone z auto-cleanup. Bezpiecznie w archiwum wątku.</div>
       </div>`
    : `<form method="post" action="/api/notes/${note.id}/finalize" style="margin:0">
         <button class="action-card" type="submit">
           <span class="ac-lbl">Primary action</span>
           <span class="ac-title"><span class="ac-star">★</span> Mark as final</span>
           <span class="ac-hint">Zatrzymaj auto-delete · zarchiwizuj jako wersję kanoniczną wątku</span>
         </button>
       </form>`;

  const tagsHtml = note.tags.length > 0
    ? `<dt>Tagi</dt><dd><div class="side-tags">${note.tags.map((t) => `<span class="tg">${esc(t)}</span>`).join("")}</div></dd>`
    : "";

  return shell(note.title, `${topbar()}
<div class="note-shell">
  <aside class="note-side">
    <a href="/" class="back">← Wstecz do listy</a>
    <span class="type-pill ${note.type}">${note.type}</span>
    <h1>${esc(note.title)}</h1>
    ${actionCard}
    <dl class="side-meta">
      <dt>Wątek</dt><dd class="thread"><a href="/t/${esc(note.thread_id)}">${esc(note.thread_id)}</a></dd>
      <dt>Status</dt><dd class="${note.is_final ? "final" : "warn"}">${note.is_final ? "★ final" : (expiring ? `⏱ wygasa za ${expiring}` : "aktywna")}</dd>
      <dt>Utworzona</dt><dd>${ago(note.created)}</dd>
      <dt>Wersja</dt><dd>v${version} z ${totalInThread}</dd>
      <dt>Słów</dt><dd>${note.word_count}</dd>
      <dt>Theme</dt><dd>${esc(note.theme)}</dd>
      <dt>Profile</dt><dd>${esc(note.theme_profile)}</dd>
      ${tagsHtml}
    </dl>
    <nav class="side-aux">
      <a href="/raw/${note.id}" target="_blank">↗ View raw HTML</a>
      <a href="#" onclick="return false">↗ Export standalone</a>
      <a href="#" onclick="return false">↗ Share link · 7d</a>
    </nav>
  </aside>
  <main class="note-main">
    ${banner}
    <div class="note-iframe-wrap">
      <iframe class="note-iframe" src="/raw/${note.id}" title="${esc(note.title)}" sandbox="allow-same-origin"></iframe>
    </div>
  </main>
</div>`);
}

export function pageStats(s: any): string {
  return shell("Stats", `${topbar("", "stats")}
<main class="v-page">
  <div class="group">
    <div class="group-lbl">Stan systemu <span class="count">· live</span></div>
    <div style="padding: 8px 4px 20px;">
      <h1 style="font-family: var(--vhead); font-weight: 500; font-size: clamp(28px, 3.6vw, 40px); letter-spacing: -0.025em; margin: 0 0 6px; line-height: 1.1;">Statystyki</h1>
      <div style="font-family: var(--vserif); font-style: italic; font-size: 18px; color: var(--vmuted); margin-bottom: 12px;">Co Folio wie o sobie samym.</div>
    </div>
    <div class="stat-grid">
      <div class="stat-cell"><div class="n acc">${s.total}</div><div class="lbl">Total</div></div>
      <div class="stat-cell"><div class="n good">${s.final}</div><div class="lbl">★ Final</div></div>
      <div class="stat-cell"><div class="n mid">${s.expiring_7d}</div><div class="lbl">Expiring 7d</div></div>
      <div class="stat-cell"><div class="n">${s.threads}</div><div class="lbl">Wątki</div></div>
    </div>
  </div>

  <div class="group">
    <div class="group-lbl">Według typu</div>
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
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Folio</title><style>${VIEWER_CSS}</style></head><body>${body}${KBD_SHORTCUT_JS}</body></html>`;
}

export function pageError(code: number, msg: string): string {
  return shell(`${code}`, `${topbar()}<div class="empty"><h2>${code}</h2><p class="lead">${esc(msg)}</p><p style="margin-top:24px;"><a href="/" style="color:var(--vorange);border-bottom:1px solid currentColor;font-family:var(--vmono);font-size:13px">← Wstecz do listy</a></p></div>`);
}
