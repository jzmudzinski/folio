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
`;
