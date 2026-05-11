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
:root {
  --vbg: #fbfaf7; --vbg-2: #f5f4f0; --vpanel: #fff; --vborder: #e5e3dc;
  --vtext: #1d1d1f; --vsoft: #333; --vmuted: #86868b;
  --vaccent: #0066cc; --vaccent-2: #3b82f6;
  --vmid: #ff9500; --vgood: #34c759; --vbad: #ff3b30;
  --vfont: -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif;
  --vmono: "SF Mono", "JetBrains Mono", ui-monospace, monospace;
}
* { box-sizing: border-box; }
html, body { background: var(--vbg); color: var(--vtext); font-family: var(--vfont); margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
a { color: var(--vaccent); text-decoration: none; }
a:hover { text-decoration: underline; }

.v-top { padding: 14px 24px; border-bottom: 1px solid var(--vborder); display: flex; align-items: center; gap: 14px; background: var(--vbg-2); position: sticky; top: 0; z-index: 10; }
.v-logo { font-weight: 800; font-size: 16px; letter-spacing: -0.01em; display: flex; align-items: center; gap: 6px; }
.v-search { flex: 1; max-width: 560px; background: var(--vpanel); border: 1px solid var(--vborder); border-radius: 8px; padding: 7px 14px; display: flex; align-items: center; gap: 8px; font-family: var(--vmono); font-size: 13px; }
.v-search input { flex: 1; background: transparent; border: 0; outline: 0; color: var(--vtext); font-family: var(--vmono); font-size: 13px; }
.v-actions { display: flex; gap: 8px; color: var(--vmuted); }
.v-actions a { padding: 4px 10px; border-radius: 6px; color: var(--vmuted); font-size: 13px; }
.v-actions a:hover { background: var(--vbg-2); }

.v-filters { padding: 11px 24px; border-bottom: 1px solid var(--vborder); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; background: var(--vbg); }
.fp { padding: 4px 11px; border-radius: 999px; font-size: 12px; font-weight: 600; background: transparent; border: 1px solid var(--vborder); color: var(--vmuted); text-decoration: none; }
.fp:hover { color: var(--vtext); }
.fp.active { background: rgba(0,102,204,0.1); border-color: var(--vaccent); color: var(--vaccent); }
.fp.warn { background: rgba(255,149,0,0.1); border-color: rgba(255,149,0,0.4); color: var(--vmid); }
.fp .count { margin-left: 5px; opacity: 0.7; font-weight: 500; }
.divider { width: 1px; height: 18px; background: var(--vborder); margin: 0 6px; }

.v-list { padding: 24px; max-width: 1100px; margin: 0 auto; }
.date-group { margin-bottom: 28px; }
.date-group .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--vmuted); margin: 0 0 12px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
.date-group .lbl .line { flex: 1; height: 1px; background: var(--vborder); }

.note-card { background: var(--vpanel); border: 1px solid var(--vborder); border-radius: 11px; padding: 14px 18px; margin-bottom: 8px; display: grid; grid-template-columns: auto 1fr auto; gap: 16px; align-items: start; text-decoration: none; color: var(--vtext); transition: border-color 0.15s, transform 0.15s; }
.note-card:hover { border-color: var(--vaccent); transform: translateY(-1px); text-decoration: none; }
.note-card .type { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; padding: 4px 9px; border-radius: 6px; font-weight: 700; font-family: var(--vmono); align-self: start; margin-top: 2px; white-space: nowrap; }
.type-research { background: rgba(26,170,255,0.13); color: var(--vaccent-2); }
.type-comparison { background: rgba(124,92,255,0.15); color: #7c5cff; }
.type-technical { background: rgba(245,158,11,0.13); color: #b45309; }
.type-journal { background: rgba(52,199,89,0.13); color: var(--vgood); }
.type-snippet { background: var(--vbg-2); color: var(--vmuted); }
.note-body .title { font-weight: 600; font-size: 14.5px; line-height: 1.35; margin-bottom: 5px; color: var(--vtext); }
.note-body .meta { font-size: 12px; color: var(--vmuted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.note-body .meta .sep { opacity: 0.4; }
.note-body .meta .thread { color: var(--vaccent); font-family: var(--vmono); font-size: 11.5px; }
.note-body .snippet { font-size: 13px; color: var(--vmuted); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.note-body .snippet mark { background: rgba(255,149,0,0.22); color: var(--vtext); padding: 1px 3px; border-radius: 3px; }
.note-status { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; font-family: var(--vmono); font-size: 11px; white-space: nowrap; }
.note-status .final { color: var(--vgood); }
.note-status .expiring { color: var(--vmid); }
.note-status .score { color: var(--vaccent-2); }

.empty { text-align: center; padding: 60px 20px; color: var(--vmuted); }
.empty h2 { color: var(--vtext); font-weight: 700; margin-bottom: 10px; }
.empty code { background: var(--vbg-2); padding: 2px 8px; border-radius: 4px; font-family: var(--vmono); }

.search-bar { padding: 14px 24px; background: rgba(0,102,204,0.05); border-bottom: 1px solid var(--vborder); color: var(--vmuted); font-size: 13px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.search-bar .query { font-family: var(--vmono); color: var(--vaccent); }
.search-bar .count { color: var(--vtext); font-weight: 600; }

.thread-head { padding: 24px 24px 20px; border-bottom: 1px solid var(--vborder); background: var(--vbg-2); }
.thread-head .crumb { font-size: 12px; color: var(--vmuted); font-family: var(--vmono); margin-bottom: 8px; }
.thread-head .crumb a { color: var(--vaccent); }
.thread-head h2 { margin: 0 0 8px; font-size: 22px; font-weight: 700; color: var(--vtext); }
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
.btn.primary { background: rgba(0,102,204,0.1); border-color: var(--vaccent); color: var(--vaccent); }
.btn.primary:hover { background: rgba(0,102,204,0.18); }

.note-iframe { width: 100%; height: calc(100vh - 60px); border: 0; }
.note-banner { padding: 12px 18px; background: rgba(255,149,0,0.07); border-bottom: 1px solid rgba(255,149,0,0.25); display: flex; justify-content: space-between; align-items: center; gap: 14px; font-size: 13px; color: var(--vsoft); flex-wrap: wrap; }
.note-banner .lbl { color: var(--vmid); font-weight: 600; }

@media (max-width: 780px) {
  .note-shell { grid-template-columns: 1fr; }
  .note-side { border-right: 0; border-bottom: 1px solid var(--vborder); }
}
`;

function topbar(query = ""): string {
  return `
<div class="v-top">
  <a href="/" class="v-logo">📄 Folio</a>
  <form class="v-search" action="/search" method="get">
    <span>🔍</span>
    <input type="search" name="q" placeholder="Szukaj…" value="${esc(query)}" autocomplete="off">
  </form>
  <div class="v-actions"><a href="/stats">stats</a></div>
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

function noteCard(n: NoteMeta): string {
  const expiring = !n.is_final ? daysUntil(n.expires_at) : null;
  const status = n.is_final
    ? `<span class="final">⭐ final</span>`
    : expiring
    ? `<span class="expiring">⏱ ${expiring}</span>`
    : "";
  return `
<a class="note-card" href="/n/${n.id}">
  <span class="type type-${n.type}">${n.type}</span>
  <div class="note-body">
    <div class="title">${esc(n.title)}</div>
    <div class="meta">
      <span class="thread">📂 <a href="/t/${esc(n.thread_id)}" style="color:inherit">${esc(n.thread_id)}</a></span>
      <span class="sep">·</span>
      <span>${ago(n.created)}</span>
      ${n.tags.length ? `<span class="sep">·</span><span>${n.tags.slice(0,3).map(esc).join(", ")}</span>` : ""}
    </div>
    <div class="snippet">${esc(n.summary ?? "")}</div>
  </div>
  <div class="note-status">${status}</div>
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
    .map(([label, items]) => `<div class="date-group"><div class="lbl">${label} <span class="line"></span></div>${items.map(noteCard).join("")}</div>`)
    .join("");

  const body = notes.length === 0
    ? `<div class="empty"><h2>Pusto.</h2><p>Stwórz pierwszą notatkę: <code>folio new --title "..." --html @file.html</code></p></div>`
    : `<div class="v-list">${groupHtml}</div>`;

  return shell("Folio", `${topbar()}${filterBar(activeType, activeStatus, counts)}${body}`);
}

export function pageSearch(query: string, hits: SearchHit[], counts: { all: number; final: number; expiring: number; byType: Record<string, number> }, durationMs: number): string {
  const body = hits.length === 0
    ? `<div class="empty"><h2>Brak wyników</h2><p>Spróbuj innych słów.</p></div>`
    : `<div class="v-list">${hits.map(searchCard).join("")}</div>`;
  return shell(`Szukaj: ${query}`, `${topbar(query)}<div class="search-bar"><div><span class="count">${hits.length} wynik${hits.length === 1 ? "" : "ów"}</span> dla <span class="query">"${esc(query)}"</span> · ${durationMs}ms</div></div>${filterBar(undefined, undefined, counts)}${body}`);
}

function searchCard(h: SearchHit): string {
  // snippet contains <mark> from FTS5; we keep it raw
  return `
<a class="note-card" href="/n/${h.id}">
  <span class="type type-${h.type}">${h.type}</span>
  <div class="note-body">
    <div class="title">${esc(h.title)}</div>
    <div class="meta">
      <span class="thread">📂 ${esc(h.thread_id)}</span>
      <span class="sep">·</span>
      <span>${ago(h.created)}</span>
    </div>
    <div class="snippet">${h.snippet}</div>
  </div>
  <div class="note-status">
    ${h.is_final ? `<span class="final">⭐ final</span>` : ""}
    <span class="score">★ ${(-h.score).toFixed(2)}</span>
  </div>
</a>`;
}

export function pageThread(threadId: string, notes: NoteMeta[]): string {
  const sorted = [...notes].sort((a, b) => a.created.localeCompare(b.created));
  const body = `
<div class="thread-head">
  <div class="crumb"><a href="/">← Wszystkie noty</a> / 📂 thread</div>
  <h2>${esc(threadId)}</h2>
  <div class="summary">
    <span><strong>${notes.length}</strong> not</span>
    <span>·</span>
    <span>Najnowsza: <strong>${ago(sorted[sorted.length - 1]?.created ?? "")}</strong></span>
    ${notes.some((n) => n.is_final) ? `<span>·</span><span style="color:var(--vgood)"><strong>⭐ final w threadzie</strong></span>` : ""}
  </div>
</div>
<div class="v-list">
${sorted.map((n, i) => `<div style="display:flex;align-items:center;gap:14px;margin-bottom:8px">
  <div style="font-family:var(--vmono);color:var(--vmuted);font-size:11px;min-width:30px">v${i + 1}</div>
  <div style="flex:1">${noteCard(n)}</div>
</div>`).join("")}
</div>`;
  return shell(`Thread: ${threadId}`, `${topbar()}${body}`);
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
  return shell("Stats", `${topbar()}
<div class="v-list">
  <h1 style="margin:0 0 24px;font-size:24px">Statystyki</h1>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:32px">
    <div class="note-card" style="grid-template-columns:1fr"><div><div style="font-size:32px;font-weight:800;color:var(--vaccent)">${s.total}</div><div style="color:var(--vmuted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Total</div></div></div>
    <div class="note-card" style="grid-template-columns:1fr"><div><div style="font-size:32px;font-weight:800;color:var(--vgood)">${s.final}</div><div style="color:var(--vmuted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Final ⭐</div></div></div>
    <div class="note-card" style="grid-template-columns:1fr"><div><div style="font-size:32px;font-weight:800;color:var(--vmid)">${s.expiring_7d}</div><div style="color:var(--vmuted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Expiring 7d</div></div></div>
    <div class="note-card" style="grid-template-columns:1fr"><div><div style="font-size:32px;font-weight:800">${s.threads}</div><div style="color:var(--vmuted);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px">Threads</div></div></div>
  </div>

  <h3 style="margin:24px 0 8px">By type</h3>
  <table style="width:100%;border-collapse:collapse">
    ${s.by_type.map((t: any) => `<tr><td style="padding:8px 0;border-bottom:1px solid var(--vborder)"><span class="type type-${t.type}" style="font-family:var(--vmono);font-size:10px;text-transform:uppercase;letter-spacing:0.1em;padding:3px 9px;border-radius:5px">${t.type}</span></td><td style="padding:8px 0;border-bottom:1px solid var(--vborder);text-align:right;font-family:var(--vmono);color:var(--vmuted)">${t.n}</td></tr>`).join("")}
  </table>

  <h3 style="margin:24px 0 8px">Analytics (ADR-017)</h3>
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
