/**
 * Brand assets shared between the local viewer (favicon) and cloud PWA
 * (apple-touch-icon + manifest icons). Single source of truth for the
 * "folio." mark so favicon + PWA icon never drift.
 *
 * Icon: square version of the wordmark — lowercase "f" + single orange "."
 * that reads as the full "folio." mark. Familjen Grotesk weight 500, matches
 * assets/wordmark-light.svg typography. Linen cream background, 96px corner
 * radius so iOS/Android render with consistent rounding when used as PWA app
 * icon. Inline SVG (no font files) so it renders identically with or without
 * Familjen Grotesk installed — the rasterizer falls back to system sans.
 *
 * Colors are the brand palette (also in linen theme): bg #f5f3ee, ink
 * #0a0a0a, accent #ff5a1f.
 */

export const FOLIO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#f5f3ee"/>
  <text x="190" y="380"
        font-family="'Familjen Grotesk', 'Inter', system-ui, -apple-system, sans-serif"
        font-weight="500" font-size="420" letter-spacing="-16"
        fill="#0a0a0a">f</text>
  <text x="340" y="380"
        font-family="'Familjen Grotesk', 'Inter', system-ui, -apple-system, sans-serif"
        font-weight="500" font-size="420"
        fill="#ff5a1f">.</text>
</svg>`;

export const BRAND = {
  bg: "#f5f3ee",
  ink: "#0a0a0a",
  ink2: "#1a1a1a",
  muted: "#6b6b66",
  accent: "#ff5a1f",
} as const;
