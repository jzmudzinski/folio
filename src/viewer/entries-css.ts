// Baseline CSS for live-note entries — shipped from viewer chrome.
//
// Two consumers:
//   1. The live-feed panel iframe (loaded inline in its srcdoc alongside
//      the active theme.css) so streamed entries render coherently with
//      the user's theme.
//   2. The compiled body after finalize (loaded as <link href="/entries.css">
//      or inlined into <style> for standalone profile) so a finalized
//      live note's preserved entries look right in any future theme.
//
// Themes can override these selectors (`.entry`, `.entry.pinned`, etc.)
// in their theme.css to provide theme-native decoration. The baseline
// uses CSS variables (--accent, --text-muted, --panel, --border) with
// safe fallbacks so themes that don't override still pick up
// theme-correct colors where available.

export const ENTRIES_CSS = `
/* Folio live-note entries — baseline. Themes may override. */

.entries-pinned {
  margin: 0 0 24px;
  padding: 14px 16px;
  background: var(--panel, rgba(0,0,0,0.04));
  border-left: 3px solid var(--accent, #ff5a1f);
  border-radius: 6px;
}
.entries-pinned > h3 {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin: 0 0 10px;
  color: var(--text-muted, rgba(0,0,0,0.55));
  font-weight: 600;
}
.entries-feed {
  margin: 0;
}

.entry {
  display: block;
  padding: 14px 4px 14px 14px;
  margin: 0;
  border-bottom: 1px solid var(--border, rgba(0,0,0,0.08));
  position: relative;
}
.entry:last-child {
  border-bottom: 0;
}

.entry > .meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 11px;
  color: var(--text-muted, rgba(0,0,0,0.55));
  margin-bottom: 6px;
}
.entry > .meta time {
  letter-spacing: 0.02em;
}

.entry > .content {
  font-size: 14.5px;
  line-height: 1.55;
}
.entry > .content > *:first-child {
  margin-top: 0;
}
.entry > .content > *:last-child {
  margin-bottom: 0;
}

/* Pinned — distinct left rule + small "📌" marker. Used in both rails. */
.entry.pinned {
  background: linear-gradient(90deg, color-mix(in srgb, var(--accent, #ff5a1f) 6%, transparent) 0%, transparent 60%);
  border-left: 3px solid var(--accent, #ff5a1f);
  padding-left: 11px;
}

/* state:* decoration. Compile applies the modifier class
   (entry.state-<value>); these three are the meaningful ones. */
.entry.state-done > .content {
  text-decoration: line-through;
  opacity: 0.6;
}
.entry.state-cancelled {
  opacity: 0.5;
}
.entry.state-snoozed > .meta::before {
  content: "snoozed";
  display: inline-block;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 3px;
  background: var(--accent, #c98e2d);
  color: var(--panel, #fff);
  margin-right: 4px;
}

/* Reference target marker — slight indent so chains read as ladders. */
.entry .ref-target {
  margin-left: 18px;
  padding-left: 10px;
  border-left: 2px solid var(--border, rgba(0,0,0,0.08));
}

/* ── Task entries (carry a state:* tag) — checklist row, not a log line ──
   feed-render emits .entry.task → <button.entry-check> + <div.entry-body>
   (.content over a demoted .meta). Plain entries keep the timestamp-led
   layout above. */
.entry.task {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 9px 4px 9px 14px;
}
.entry.task > .entry-check {
  flex: 0 0 auto;
  width: 19px;
  height: 19px;
  margin-top: 1px;
  padding: 0;
  border: 2px solid var(--accent, #ff5a1f);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  display: grid;
  place-items: center;
  font-size: 12px;
  line-height: 1;
  color: #fff;
  transition: background .12s, border-color .12s, box-shadow .12s;
}
.entry.task > .entry-check:hover {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #ff5a1f) 16%, transparent);
}
.entry.task.state-done > .entry-check { background: var(--ok, #2f9050); border-color: var(--ok, #2f9050); }
.entry.task.state-done > .entry-check::after { content: "✓"; }
.entry.task.state-cancelled > .entry-check { border-color: var(--text-muted, rgba(0,0,0,0.4)); }
.entry.task.state-cancelled > .entry-check::after { content: "✕"; color: var(--text-muted, rgba(0,0,0,0.55)); }
.entry.task.state-in_progress > .entry-check::after { content: "·"; color: var(--accent, #ff5a1f); font-weight: 900; font-size: 19px; }
.entry.task > .entry-body { flex: 1 1 auto; min-width: 0; }
.entry.task > .entry-body > .content { font-size: 14.5px; line-height: 1.5; }
.entry.task > .entry-body > .meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  font-family: ui-monospace, "JetBrains Mono", monospace;
  font-size: 10.5px;
  color: var(--text-muted, rgba(0,0,0,0.5));
  margin: 4px 0 0;
}
/* state-done/-cancelled content sits under .entry-body, so the direct-child
   rules above don't reach it — restate strikethrough for task rows. The
   whole-row dim on .state-cancelled would grey the checkbox too, so keep the
   row opaque and dim only the text. */
.entry.task.state-cancelled { opacity: 1; }
.entry.task.state-done > .entry-body > .content { text-decoration: line-through; opacity: 0.55; }
.entry.task.state-cancelled > .entry-body > .content { text-decoration: line-through; opacity: 0.5; }
`;
