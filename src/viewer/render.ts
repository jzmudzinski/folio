import type { NoteMeta, SearchHit } from "../core/types";
import { listThreads } from "../core/storage";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function ago(iso: string): string {
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
  --vbg: #f5f3ee; --vbg-2: #efeae0; --vpanel: #fff; --vborder: rgba(10,10,10,0.10);
  --vtext: #0a0a0a; --vsoft: #1a1a1a; --vmuted: #6b6b66; --vmuted-light: #a8a89e;
  --vaccent: #ff5a1f; --vaccent-2: #d4a574;
  --vmid: #c98e2d; --vgood: #2f9050; --vbad: #c8412a;
  --vfont: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --vhead: 'Familjen Grotesk', 'Inter', system-ui, sans-serif;
  --vserif: 'Instrument Serif', Georgia, serif;
  --vmono: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body { background: var(--vbg); color: var(--vtext); font-family: var(--vfont); margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
a { color: var(--vaccent); text-decoration: none; }
a:hover { text-decoration: underline; }

.v-top { padding: 14px 24px; border-bottom: 1px solid var(--vborder); display: flex; align-items: center; gap: 18px; background: var(--vbg); position: sticky; top: 0; z-index: 10; }
.v-logo {
  display: flex; align-items: baseline; gap: 14px;
  font-family: var(--vhead); font-weight: 500;
  letter-spacing: -0.035em;
  color: var(--vtext);
  text-decoration: none;
  line-height: 1;
}
.v-logo:hover { text-decoration: none; }
.v-logo .mark { font-size: 26px; }
.v-logo .mark .dot { color: var(--vaccent); }
.v-logo .divider { width: 1px; height: 18px; background: var(--vborder); align-self: center; }
.v-logo .tagline {
  font-family: var(--vmono); font-size: 10.5px;
  letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--vmuted-light); font-weight: 400;
}
@media (max-width: 720px) {
  .v-logo .divider, .v-logo .tagline { display: none; }
}
.v-search { flex: 1; max-width: 560px; background: var(--vpanel); border: 1px solid var(--vborder); border-radius: 8px; padding: 7px 14px; display: flex; align-items: center; gap: 8px; font-family: var(--vmono); font-size: 13px; }
.v-search input { flex: 1; background: transparent; border: 0; outline: 0; color: var(--vtext); font-family: var(--vmono); font-size: 13px; }
.v-actions { display: flex; gap: 8px; color: var(--vmuted); }
.v-actions a { padding: 4px 10px; border-radius: 6px; color: var(--vmuted); font-size: 13px; }
.v-actions a:hover { background: var(--vbg-2); }

.v-filters { padding: 11px 24px; border-bottom: 1px solid var(--vborder); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; background: var(--vbg); }
.fp { padding: 4px 11px; border-radius: 999px; font-size: 12px; font-weight: 600; background: transparent; border: 1px solid var(--vborder); color: var(--vmuted); text-decoration: none; }
.fp:hover { color: var(--vtext); }
.fp.active { background: rgba(255,90,31,0.1); border-color: var(--vaccent); color: var(--vaccent); }
.fp.warn { background: rgba(201,142,45,0.1); border-color: rgba(201,142,45,0.4); color: var(--vmid); }
.fp .count { margin-left: 5px; opacity: 0.7; font-weight: 500; }
.divider { width: 1px; height: 18px; background: var(--vborder); margin: 0 6px; }

.v-list { padding: 16px 24px 32px; max-width: 1100px; margin: 0 auto; }
.date-group { margin-bottom: 22px; }
.date-group .lbl { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--vmuted-light); margin: 0 0 4px; font-weight: 600; font-family: var(--vmono); display: flex; align-items: center; gap: 10px; padding: 0 2px; }
.date-group .lbl .line { flex: 1; height: 1px; background: var(--vborder); }

/* Compact row layout — one note = one ~36px row */
.note-rows { display: flex; flex-direction: column; }
.note-row {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr) auto auto;
  gap: 14px;
  padding: 8px 8px 8px 8px;
  border-bottom: 1px solid var(--vborder);
  align-items: center;
  text-decoration: none;
  color: var(--vtext);
  border-radius: 4px;
  transition: background 0.1s;
}
.note-row:hover { background: var(--vbg-2); text-decoration: none; }
.note-row .type {
  font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em;
  padding: 2px 7px; border-radius: 4px; font-weight: 700; font-family: var(--vmono);
  text-align: center; justify-self: start;
}
.type-research { background: rgba(255,90,31,0.10); color: var(--vaccent); }
.type-comparison { background: rgba(212,165,116,0.18); color: #8b6535; }
.type-technical { background: rgba(74,108,247,0.10); color: #2c4ad9; }
.type-journal { background: rgba(47,144,80,0.10); color: var(--vgood); }
.type-snippet { background: var(--vbg-2); color: var(--vmuted); }
.note-row .body { min-width: 0; display: flex; align-items: baseline; gap: 12px; }
.note-row .title { font-weight: 600; font-size: 14px; line-height: 1.3; color: var(--vtext); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.note-row .thread { color: var(--vmuted); font-family: var(--vmono); font-size: 11px; white-space: nowrap; }
.note-row .thread:hover { color: var(--vaccent); }
.note-row .age { color: var(--vmuted-light); font-family: var(--vmono); font-size: 11px; white-space: nowrap; }
.note-row .status { display: flex; align-items: center; gap: 6px; font-family: var(--vmono); font-size: 11px; white-space: nowrap; }
.note-row .status .final { color: var(--vgood); }
.note-row .status .expiring { color: var(--vmid); }
.note-row .status .score { color: var(--vaccent-2); }

/* Search results need an extra row for snippet — same compact pattern */
.note-row.with-snippet { grid-template-columns: 92px minmax(0, 1fr) auto auto; padding: 10px 8px; align-items: start; }
.note-row.with-snippet .body { flex-direction: column; align-items: flex-start; gap: 3px; }
.note-row.with-snippet .snippet { font-size: 12.5px; color: var(--vmuted); line-height: 1.5; max-width: 100%; }
.note-row.with-snippet .snippet mark { background: rgba(255,90,31,0.18); color: var(--vtext); padding: 1px 3px; border-radius: 2px; font-weight: 500; }
.note-row.with-snippet .row-meta { display: flex; gap: 10px; font-size: 11px; color: var(--vmuted-light); font-family: var(--vmono); }
.note-row.with-snippet .row-meta .thread { color: var(--vmuted); }

/* Threads page */
.thread-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 16px;
  padding: 10px 8px;
  border-bottom: 1px solid var(--vborder);
  align-items: center;
  text-decoration: none;
  color: var(--vtext);
  border-radius: 4px;
  transition: background 0.1s;
}
.thread-row:hover { background: var(--vbg-2); text-decoration: none; }
.thread-row .tid { font-family: var(--vmono); font-size: 13px; color: var(--vaccent); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.thread-row .latest { color: var(--vmuted-light); font-size: 11.5px; font-family: var(--vmono); white-space: nowrap; }
.thread-row .count { color: var(--vmuted); font-size: 11.5px; font-family: var(--vmono); white-space: nowrap; }
.thread-row .marker { font-family: var(--vmono); font-size: 11px; white-space: nowrap; min-width: 28px; text-align: right; }
.thread-row .marker.final { color: var(--vgood); }
.thread-row .marker.expiring { color: var(--vmid); }

.empty { text-align: center; padding: 60px 20px; color: var(--vmuted); }
.empty h2 { color: var(--vtext); font-family: var(--vhead); font-weight: 500; font-size: 28px; letter-spacing: -0.02em; margin-bottom: 10px; }
.empty code { background: var(--vbg-2); padding: 2px 8px; border-radius: 4px; font-family: var(--vmono); }

.search-bar { padding: 14px 24px; background: rgba(255,90,31,0.06); border-bottom: 1px solid var(--vborder); color: var(--vmuted); font-size: 13px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.search-bar .query { font-family: var(--vmono); color: var(--vaccent); }
.search-bar .count { color: var(--vtext); font-weight: 600; }

.thread-head { padding: 24px 24px 20px; border-bottom: 1px solid var(--vborder); background: var(--vbg-2); }
.thread-head .crumb { font-size: 12px; color: var(--vmuted); font-family: var(--vmono); margin-bottom: 8px; }
.thread-head .crumb a { color: var(--vaccent); }
.thread-head h2 { margin: 0 0 8px; font-size: 26px; font-weight: 500; font-family: var(--vhead); letter-spacing: -0.02em; color: var(--vtext); }
.thread-head .summary { display: flex; gap: 14px; flex-wrap: wrap; font-size: 13px; color: var(--vmuted); }

.note-shell { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 60px); }
.note-side { background: var(--vbg-2); border-right: 1px solid var(--vborder); padding: 22px 22px; font-size: 13px; display: flex; flex-direction: column; gap: 18px; color: var(--vsoft); }
.side-back { font-family: var(--vmono); font-size: 11.5px; color: var(--vaccent); }
.side-type { display: inline-block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; padding: 3px 9px; border-radius: 6px; font-weight: 700; font-family: var(--vmono); align-self: flex-start; }
.side-title { font-size: 16px; font-weight: 700; line-height: 1.3; color: var(--vtext); margin: -4px 0; }
.side-row { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
.side-row .k { color: var(--vmuted); text-transform: uppercase; letter-spacing: 0.1em; font-size: 10.5px; font-weight: 600; }
.side-row .v { color: var(--vsoft); font-family: var(--vmono); font-size: 12.5px; }
.side-row .v.thread { color: var(--vaccent); }
.side-row .v.final { color: var(--vgood); }
.side-row .v.warn { color: var(--vmid); }
.side-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.side-tags .tg { padding: 2px 8px; border-radius: 5px; background: var(--vpanel); color: var(--vmuted); font-size: 11px; font-family: var(--vmono); border: 1px solid var(--vborder); }
.side-actions { display: flex; flex-direction: column; gap: 6px; margin-top: auto; }
.btn { padding: 7px 14px; border-radius: 7px; font-size: 12.5px; font-weight: 600; border: 1px solid var(--vborder); background: var(--vpanel); color: var(--vsoft); cursor: pointer; text-align: center; text-decoration: none; display: block; font-family: var(--vfont); }
.btn:hover { border-color: var(--vaccent); color: var(--vtext); text-decoration: none; }
.btn.primary { background: rgba(255,90,31,0.1); border-color: var(--vaccent); color: var(--vaccent); }
.btn.primary:hover { background: rgba(0,102,204,0.18); }

.note-iframe { width: 100%; height: calc(100vh - 60px); border: 0; }
.note-banner { padding: 12px 18px; background: rgba(201,142,45,0.07); border-bottom: 1px solid rgba(201,142,45,0.25); display: flex; justify-content: space-between; align-items: center; gap: 14px; font-size: 13px; color: var(--vsoft); flex-wrap: wrap; }
.note-banner .lbl { color: var(--vmid); font-weight: 600; }

@media (max-width: 780px) {
  .note-shell { grid-template-columns: 1fr; }
  .note-side { border-right: 0; border-bottom: 1px solid var(--vborder); }
}
`;

function topbar(query = "", active?: "notes" | "threads" | "stats"): string {
  const a = (k: string) => (active === k ? ' style="color:var(--vtext);background:var(--vbg-2)"' : "");
  return `
<div class="v-top">
  <a href="/" class="v-logo">
    <span class="mark">folio<span class="dot">.</span></span>
    <span class="divider"></span>
    <span class="tagline">VISUAL COMM FOR AGENTS</span>
  </a>
  <form class="v-search" action="/search" method="get">
    <span>🔍</span>
    <input type="search" name="q" placeholder="Szukaj notatek i wątków…" value="${esc(query)}" autocomplete="off">
  </form>
  <div class="v-actions">
    <a href="/"${a("notes")}>noty</a>
    <a href="/threads"${a("threads")}>wątki</a>
    <a href="/stats"${a("stats")}>stats</a>
  </div>
</div>`;
}

function filterBar(activeType?: string, activeStatus?: string, counts?: { all: number; final: number; expiring: number; byType: Record<string, number> }): string {
  const cs = counts ?? { all: 0, final: 0, expiring: 0, byType: {} };
  const a = (cond: boolean) => (cond ? " active" : "");
  return `
<div class="v-filters">
  <a href="/" class="fp${a(!activeType && !activeStatus)}">Wszystkie <span class="count">${cs.all}</span></a>
  <a href="/?type=research" class="fp${a(activeType === "research")}">Research <span class="count">${cs.byType.research ?? 0}</span></a>
  <a href="/?type=comparison" class="fp${a(activeType === "comparison")}">Comparison <span class="count">${cs.byType.comparison ?? 0}</span></a>
  <a href="/?type=technical" class="fp${a(activeType === "technical")}">Technical <span class="count">${cs.byType.technical ?? 0}</span></a>
  <span class="divider"></span>
  <a href="/?final=1" class="fp${a(activeStatus === "final")}">⭐ Final <span class="count">${cs.final}</span></a>
  <a href="/?expiring=1" class="fp warn${a(activeStatus === "expiring")}">⏱ Wygasające 7d <span class="count">${cs.expiring}</span></a>
</div>`;
}

function noteRow(n: NoteMeta): string {
  const expiring = !n.is_final ? daysUntil(n.expires_at) : null;
  const status = n.is_final
    ? `<span class="final">⭐</span>`
    : expiring
    ? `<span class="expiring">⏱ ${expiring}</span>`
    : "";
  return `
<a class="note-row" href="/n/${n.id}">
  <span class="type type-${n.type}">${n.type}</span>
  <div class="body">
    <span class="title">${esc(n.title)}</span>
    <span class="thread">📂 ${esc(n.thread_id)}</span>
  </div>
  <span class="age">${ago(n.created)}</span>
  <span class="status">${status}</span>
</a>`;
}

export function pageList(notes: NoteMeta[], counts: { all: number; final: number; expiring: number; byType: Record<string, number> }, activeType?: string, activeStatus?: string): string {
  // group by date label
  const groups = new Map<string, NoteMeta[]>();
  for (const n of notes) {
    const g = dateGroup(n.created);
    const arr = groups.get(g) ?? [];
    arr.push(n);
    groups.set(g, arr);
  }
  const groupHtml = Array.from(groups.entries())
    .map(([label, items]) => `<div class="date-group"><div class="lbl">${label} <span class="line"></span></div><div class="note-rows">${items.map(noteRow).join("")}</div></div>`)
    .join("");

  const body = notes.length === 0
    ? `<div class="empty"><h2>Pusto.</h2><p>Stwórz pierwszą notatkę: <code>folio new --title "..." --html @file.html</code></p></div>`
    : `<div class="v-list">${groupHtml}</div>`;

  return shell("Folio", `${topbar("", "notes")}${filterBar(activeType, activeStatus, counts)}${body}`);
}

export interface ThreadHit {
  thread_id: string;
  count: number;
  latest: string;
  final_count: number;
}

export function pageSearch(
  query: string,
  hits: SearchHit[],
  threadHits: ThreadHit[],
  counts: { all: number; final: number; expiring: number; byType: Record<string, number> },
  durationMs: number
): string {
  const empty = hits.length === 0 && threadHits.length === 0;
  const body = empty
    ? `<div class="empty"><h2>Brak wyników</h2><p>Spróbuj innych słów lub zobacz <a href="/threads">wszystkie wątki</a>.</p></div>`
    : `<div class="v-list">
         ${threadHits.length ? `<div class="date-group"><div class="lbl">Wątki <span class="line"></span></div><div class="note-rows">${threadHits.map(threadRow).join("")}</div></div>` : ""}
         ${hits.length ? `<div class="date-group"><div class="lbl">Notatki <span class="line"></span></div><div class="note-rows">${hits.map(searchRow).join("")}</div></div>` : ""}
       </div>`;
  return shell(
    `Szukaj: ${query}`,
    `${topbar(query, "notes")}<div class="search-bar"><div><span class="count">${hits.length} not${hits.length === 1 ? "a" : "atek"}</span>${threadHits.length ? ` + <span class="count">${threadHits.length} wątek${threadHits.length === 1 ? "" : "ów"}</span>` : ""} dla <span class="query">"${esc(query)}"</span> · ${durationMs}ms</div></div>${filterBar(undefined, undefined, counts)}${body}`
  );
}

function searchRow(h: SearchHit): string {
  return `
<a class="note-row with-snippet" href="/n/${h.id}">
  <span class="type type-${h.type}">${h.type}</span>
  <div class="body">
    <span class="title">${esc(h.title)}</span>
    <div class="snippet">${h.snippet}</div>
    <div class="row-meta">
      <span class="thread">📂 ${esc(h.thread_id)}</span>
      <span>${ago(h.created)}</span>
    </div>
  </div>
  <span class="age">${ago(h.created)}</span>
  <span class="status">
    ${h.is_final ? `<span class="final">⭐</span>` : ""}
    <span class="score">★${(-h.score).toFixed(1)}</span>
  </span>
</a>`;
}

function threadRow(t: ThreadHit): string {
  const finalMarker = t.final_count > 0 ? `<span class="marker final">⭐ ${t.final_count}</span>` : "";
  return `
<a class="thread-row" href="/t/${esc(t.thread_id)}">
  <span class="tid">📂 ${esc(t.thread_id)}</span>
  <span class="count">${t.count} not${t.count === 1 ? "a" : "atek"}</span>
  <span class="latest">${ago(t.latest)}</span>
  ${finalMarker || `<span class="marker">·</span>`}
</a>`;
}

export function pageThreads(threads: ThreadHit[], query?: string): string {
  const body = threads.length === 0
    ? `<div class="empty"><h2>Brak wątków</h2><p>${query ? `Brak dopasowań dla "${esc(query)}".` : "Stwórz notatkę z thread_id, żeby zacząć."}</p></div>`
    : `<div class="v-list"><div class="note-rows">${threads.map(threadRow).join("")}</div></div>`;
  const sub = query ? `<div class="search-bar"><div><span class="count">${threads.length} wątek${threads.length === 1 ? "" : "ów"}</span> dla <span class="query">"${esc(query)}"</span></div></div>` : "";
  return shell("Wątki", `${topbar(query ?? "", "threads")}${sub}${body}`);
}

export function pageThread(threadId: string, notes: NoteMeta[]): string {
  const sorted = [...notes].sort((a, b) => a.created.localeCompare(b.created));
  const latest = sorted[sorted.length - 1]?.created ?? "";
  const body = `
<div class="thread-head">
  <div class="crumb"><a href="/threads">← Wszystkie wątki</a></div>
  <h2>📂 ${esc(threadId)}</h2>
  <div class="summary">
    <span><strong>${notes.length}</strong> not${notes.length === 1 ? "a" : "atek"}</span>
    <span>·</span>
    <span>Najnowsza: <strong>${ago(latest)}</strong></span>
    ${notes.some((n) => n.is_final) ? `<span>·</span><span style="color:var(--vgood)"><strong>⭐ final w wątku</strong></span>` : ""}
  </div>
</div>
<div class="v-list"><div class="note-rows">
${sorted.map((n, i) => {
  const expiring = !n.is_final ? daysUntil(n.expires_at) : null;
  const status = n.is_final ? `<span class="final">⭐</span>` : expiring ? `<span class="expiring">⏱ ${expiring}</span>` : "";
  return `
<a class="note-row" href="/n/${n.id}">
  <span class="type type-${n.type}" style="min-width:78px">v${i + 1} · ${n.type}</span>
  <div class="body"><span class="title">${esc(n.title)}</span></div>
  <span class="age">${ago(n.created)}</span>
  <span class="status">${status}</span>
</a>`;
}).join("")}
</div></div>`;
  return shell(`Thread: ${threadId}`, `${topbar("", "threads")}${body}`);
}

export function pageNote(note: NoteMeta, themeName: string): string {
  const expiring = note.is_final ? null : daysUntil(note.expires_at);
  const banner = !note.is_final && expiring ? `
<div class="note-banner">
  <div><span class="lbl">⏱ Auto-delete za ${expiring}</span> — chyba że oznaczysz jako final albo opublikujesz</div>
  <form method="post" action="/api/notes/${note.id}/finalize" style="margin:0"><button class="btn primary" type="submit">⭐ Finalize</button></form>
</div>` : "";
  return shell(note.title, `${topbar()}
<div class="note-shell">
  <aside class="note-side">
    <a href="/" class="side-back">← Wstecz</a>
    <span class="side-type type-${note.type}">${note.type}</span>
    <div class="side-title">${esc(note.title)}</div>
    <div class="side-row"><span class="k">Thread</span><span class="v thread"><a href="/t/${esc(note.thread_id)}" style="color:inherit">📂 ${esc(note.thread_id)}</a></span></div>
    <div class="side-row"><span class="k">Status</span><span class="v ${note.is_final ? "final" : "warn"}">${note.is_final ? "⭐ Final" : `⏱ wygasa za ${expiring ?? "?"}`}</span></div>
    <div class="side-row"><span class="k">Utworzona</span><span class="v">${ago(note.created)}</span></div>
    <div class="side-row"><span class="k">Słów</span><span class="v">${note.word_count}</span></div>
    <div class="side-row"><span class="k">Theme</span><span class="v">${esc(themeName)}</span></div>
    <div class="side-row"><span class="k">Profile</span><span class="v">${note.theme_profile}</span></div>
    ${note.tags.length ? `<div class="side-row"><span class="k">Tagi</span><div class="side-tags">${note.tags.map((t) => `<span class="tg">${esc(t)}</span>`).join("")}</div></div>` : ""}
    <div class="side-actions">
      ${!note.is_final ? `<form method="post" action="/api/notes/${note.id}/finalize" style="margin:0"><button class="btn primary" type="submit">⭐ Mark as final</button></form>` : ""}
      <a class="btn" href="/raw/${note.id}" target="_blank">📄 View raw HTML</a>
    </div>
  </aside>
  <main style="background:#fff;overflow:hidden">
    ${banner}
    <iframe class="note-iframe" src="/raw/${note.id}" title="${esc(note.title)}" sandbox="allow-same-origin"></iframe>
  </main>
</div>`);
}

export function pageStats(s: any): string {
  return shell("Stats", `${topbar("", "stats")}
<div class="v-list">
  <h1 style="margin:0 0 24px;font-size:32px;font-family:var(--vhead);font-weight:500;letter-spacing:-0.02em">Statystyki</h1>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:32px">
    <div class="note-card" style="grid-template-columns:1fr"><div><div style="font-size:32px;font-weight:800;color:var(--vaccent)">${s.total}</div><div style="color:var(--vmuted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Total</div></div></div>
    <div class="note-card" style="grid-template-columns:1fr"><div><div style="font-size:32px;font-weight:800;color:var(--vgood)">${s.final}</div><div style="color:var(--vmuted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Final ⭐</div></div></div>
    <div class="note-card" style="grid-template-columns:1fr"><div><div style="font-size:32px;font-weight:800;color:var(--vmid)">${s.expiring_7d}</div><div style="color:var(--vmuted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Expiring 7d</div></div></div>
    <div class="note-card" style="grid-template-columns:1fr"><div><div style="font-size:32px;font-weight:800">${s.threads}</div><div style="color:var(--vmuted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Threads</div></div></div>
  </div>

  <h3 style="margin:32px 0 10px;font-family:var(--vhead);font-weight:500;letter-spacing:-0.01em">By type</h3>
  <table style="width:100%;border-collapse:collapse">
    ${s.by_type.map((t: any) => `<tr><td style="padding:8px 0;border-bottom:1px solid var(--vborder)"><span class="type type-${t.type}" style="font-family:var(--vmono);font-size:10px;text-transform:uppercase;letter-spacing:0.1em;padding:3px 9px;border-radius:5px">${t.type}</span></td><td style="padding:8px 0;border-bottom:1px solid var(--vborder);text-align:right;font-family:var(--vmono);color:var(--vmuted)">${t.n}</td></tr>`).join("")}
  </table>

  <h3 style="margin:32px 0 10px;font-family:var(--vhead);font-weight:500;letter-spacing:-0.01em">Analytics (ADR-017)</h3>
  <p>Class match rate: <strong>${s.analytics.avg_class_match == null ? "—" : (s.analytics.avg_class_match * 100).toFixed(1) + "%"}</strong></p>
  <p>Logged events: <strong>${s.analytics.total_events}</strong></p>
</div>`);
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Folio</title><style>${VIEWER_CSS}</style></head><body>${body}</body></html>`;
}

export function pageError(code: number, msg: string): string {
  return shell(`${code}`, `${topbar()}<div class="empty"><h2>${code}</h2><p>${esc(msg)}</p><p><a href="/">← Wstecz</a></p></div>`);
}
