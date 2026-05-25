/**
 * Open Graph image generator for capability URLs.
 *
 * Slack / Telegram / iMessage / Twitter scrapers fetch og:image when a
 * link is pasted and render the preview card. We build the card as an SVG
 * here (small ~2KB, renders the note's actual title + theme accent + scope
 * chip), then rasterize it to PNG in generateOgPng() below — because most
 * unfurlers (X/Twitter, Slack, Discord, iMessage, Facebook/LinkedIn) do NOT
 * render SVG og:images and would fall back to a titleless/imageless preview.
 * og:image therefore points at the PNG; the SVG route stays as a fallback.
 *
 * Dimensions: 1200x630 — the OG standard 1.91:1 aspect ratio. Looks good
 * at Twitter card "summary_large_image", Slack unfurled, Telegram preview.
 *
 * What we encode:
 *   - Title (truncated to ~80 chars; wraps onto 2 lines if needed)
 *   - Scope chip ("note" or "thread") in top-left
 *   - "folio." wordmark in bottom-left (the brand)
 *   - Theme accent color as a left-edge bar (linen/folio/etc. → their
 *     accent; plain has no accent so the bar is neutral)
 *
 * Recipient-bound shares: the title is still surfaced in og:image. This
 * matches Notion / Google Docs behaviour where the title leaks via the
 * link preview but content stays behind auth. If a future use case
 * wants to suppress the title on bound shares, gate this in server.ts.
 */

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAND } from "../core/brand";
import { bundledOgDir } from "../core/config";

const THEME_ACCENTS: Record<string, string> = {
  linen: "#ff5a1f",
  folio: "#ff5a1f",
  newsroom: "#1a3d5c",
  notebook: "#d4a373",
  brutalist: "#dc2626",
  terminal: "#22c55e",
  pastel: "#f4a8c1",
  dossier: "#7c2d12",
  atlas: "#7c3aed",
  studio: "#0ea5e9",
  memo: "#0a0a0a",
  codex: "#92400e",
  ledger: "#1e293b",
  sumi: "#dc2626",
  arcade: "#a855f7",
  garden: "#65a30d",
  kraft: "#9a3412",
  prism: "#0891b2",
  plain: "#6b6b66",
};

export interface OgInput {
  title: string;
  theme?: string;
  scope_type: "note" | "thread";
  scope_id?: string;
  thread_id?: string | null;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wrap a single-line string into up to N lines of M chars each. Naïve
 * word-wrap — splits on spaces, no hyphenation, no measuring (uses
 * character count as a proxy for display width). Good enough for SVG
 * text at 1200x630 with our font sizes.
 */
function wrapTitle(title: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = title.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const next = current ? current + " " + w : w;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // Ellipsize the last line if there's overflow.
  const remaining = words.slice(lines.join(" ").split(/\s+/).length);
  if (remaining.length > 0 && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = (last + "…").slice(0, maxCharsPerLine + 1);
  }
  return lines.length > 0 ? lines : [title.slice(0, maxCharsPerLine) + "…"];
}

export function generateOgSvg(input: OgInput): string {
  const accent = THEME_ACCENTS[input.theme ?? "linen"] ?? BRAND.accent;
  const titleLines = wrapTitle(input.title || "Folio note", 38, 3);
  const titleY0 = 240; // first line baseline
  const lineHeight = 78;
  const scopeLabel = input.scope_type === "thread" ? "thread" : "note";
  const threadName = input.thread_id ?? "";

  const lines = titleLines.map((line, i) => {
    return `<text x="120" y="${titleY0 + i * lineHeight}" class="title">${xmlEscape(line)}</text>`;
  }).join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <style>
    .bg { fill: ${BRAND.bg}; }
    .accent-bar { fill: ${accent}; }
    .title { font-family: 'Familjen Grotesk', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif; font-weight: 500; font-size: 64px; letter-spacing: -0.02em; fill: ${BRAND.ink}; }
    .chip { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 18px; letter-spacing: 0.12em; text-transform: uppercase; fill: ${BRAND.muted}; }
    .chip-box { fill: none; stroke: ${BRAND.muted}; stroke-width: 1.5; }
    .thread { font-family: 'Instrument Serif', Georgia, serif; font-style: italic; font-size: 32px; fill: ${BRAND.muted}; }
    .wordmark { font-family: 'Familjen Grotesk', 'Inter', system-ui, sans-serif; font-weight: 500; font-size: 44px; letter-spacing: -0.04em; }
    .wordmark-ink { fill: ${BRAND.ink}; }
    .wordmark-dot { fill: ${BRAND.accent}; }
    .tag { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 14px; letter-spacing: 0.18em; text-transform: uppercase; fill: ${BRAND.muted}; }
  </style>
  <rect class="bg" width="1200" height="630"/>
  <!-- Left edge accent bar — theme color stripe -->
  <rect class="accent-bar" x="0" y="0" width="14" height="630"/>
  <!-- Top: scope chip (note/thread) -->
  <rect class="chip-box" x="115" y="100" width="120" height="36" rx="4"/>
  <text x="175" y="125" class="chip" text-anchor="middle">${xmlEscape(scopeLabel)}</text>
  ${threadName ? `<text x="255" y="125" class="thread">${xmlEscape("· " + threadName)}</text>` : ""}
  <!-- Title -->
  ${lines}
  <!-- Bottom: wordmark + tagline -->
  <text x="120" y="555" class="wordmark"><tspan class="wordmark-ink">folio</tspan><tspan class="wordmark-dot">.</tspan></text>
  <text x="120" y="585" class="tag">VISUAL COMM FOR AGENTS</text>
</svg>`;
}

// ─── PNG rasterization ──────────────────────────────────────────────────────
// SVG og:images are NOT rendered by most unfurlers (X/Twitter, Slack, Discord,
// iMessage, Facebook/LinkedIn/WhatsApp all want raster); SVG would show a
// titleless or imageless card. So the og:image meta points at a PNG, produced
// here by rasterizing the same SVG via @resvg/resvg-wasm. resvg-wasm has no
// system fonts, so we feed it the bundled brand font — without it every glyph
// renders blank. Both the .wasm and the .ttf live in the og/ sidecar dir next
// to the binary (see config.bundledOgDir), loaded lazily on first render.

let wasmInit: Promise<void> | null = null;
function ensureWasm(): Promise<void> {
  if (!wasmInit) {
    wasmInit = initWasm(readFileSync(join(bundledOgDir(), "resvg.wasm"))).then(() => undefined);
  }
  return wasmInit;
}

let fontBuffer: Uint8Array | null = null;
function ogFont(): Uint8Array {
  if (!fontBuffer) fontBuffer = new Uint8Array(readFileSync(join(bundledOgDir(), "FamiljenGrotesk.ttf")));
  return fontBuffer;
}

/**
 * Rasterize the OG card to a 1200x630 PNG. Throws if the sidecar wasm/font are
 * missing (e.g. a deploy that didn't ship og/) — the caller falls back to SVG.
 */
export async function generateOgPng(input: OgInput): Promise<Uint8Array> {
  await ensureWasm();
  const svg = generateOgSvg(input);
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: false, // wasm has none; deterministic + avoids fs scan
      fontBuffers: [ogFont()],
      defaultFontFamily: "Familjen Grotesk", // every family in the SVG falls back to this
    },
  });
  return resvg.render().asPng();
}
