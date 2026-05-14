import sanitizeHtml from "sanitize-html";

export interface SanitizeResult {
  html: string;
  drops: number;
}

// Sanitization is applied to AGENT body only — not the template wrapper.
// So no <html/head/body/style/title/meta> here; those come from _base.html.eta.
//
// Security model (v0.3+):
//   - <script> is ALLOWED so notes can ship interactive content natively
//     (D3, Plotly, sortable tables, three.js) instead of forcing agents to wrap
//     everything in <iframe srcdoc>. This is safe because:
//       (a) `/raw/:id` is served into an outer iframe sandboxed WITHOUT
//           `allow-same-origin` → the note is a null-origin document and
//           cannot reach the viewer's window.parent, /api/*, cookies, or
//           localStorage on 127.0.0.1:4810.
//       (b) `/raw/:id` carries a strict CSP: `connect-src 'none'` blocks
//           fetch/XHR/WebSocket, so even arbitrary scripts cannot exfiltrate
//           data or call back to attacker-controlled hosts.
//       (c) `script[src]` is restricted to `https:` (no `http:`, `data:`,
//           `javascript:`) and on*-handlers are dropped by sanitize-html.
//   - <iframe> stays allowed for embeds (YouTube, CodeSandbox, custom srcdoc).
//     Sandbox is enforced and `allow-same-origin` is always stripped from
//     nested iframes — same defense as before. See transformTags below.
//   - <noscript>, <object>, <embed>, <link> remain stripped.
const ALLOWED_TAGS = [
  "article", "section", "main", "header", "footer", "aside", "nav",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "ul", "ol", "li", "dl", "dt", "dd",
  "blockquote", "pre", "code", "em", "strong", "small", "sub", "sup",
  "a", "img", "figure", "figcaption", "picture", "source",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "hr", "br", "div", "span",
  "details", "summary", "mark", "kbd", "var", "samp", "time",
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "text", "tspan",
  "iframe",
  "script",
  // <style> at body level was previously stripped (per the v0.3 doc) under
  // the assumption that theme.css is the only authority. v0.15 reverses that:
  // notes render in a sandboxed null-origin iframe with CSP `connect-src
  // 'none'`, so CSS injection can't reach the parent window, cookies, or any
  // network endpoint. The `plain` theme depends on this — agents own the
  // visual identity per-note via a <style> block at the top of body_html.
  // Inline style="..." attributes were already allowed (see ALLOWED_ATTRIBUTES
  // below), so this is just a smaller, more idiomatic surface for the same
  // capability.
  "style",
];

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  "*": ["class", "id", "style", "data-folio-id", "data-folio-type", "data-folio-thread", "data-folio-content", "data-folio-selectable", "lang"],
  a: ["href", "title", "rel", "target"],
  img: ["src", "alt", "title", "width", "height", "loading"],
  source: ["src", "srcset", "type", "media"],
  th: ["colspan", "rowspan", "scope"],
  td: ["colspan", "rowspan"],
  svg: ["viewBox", "width", "height", "xmlns", "fill", "stroke"],
  path: ["d", "fill", "stroke", "stroke-width"],
  circle: ["cx", "cy", "r", "fill", "stroke"],
  rect: ["x", "y", "width", "height", "fill", "stroke", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2", "stroke"],
  iframe: ["src", "srcdoc", "sandbox", "width", "height", "title", "allow", "loading", "name", "referrerpolicy", "allowfullscreen"],
  time: ["datetime"],
  script: ["src", "type", "async", "defer", "crossorigin", "integrity", "nomodule", "referrerpolicy"],
};

// Default sandbox flags applied to every iframe — explicit allow-list, never
// includes `allow-same-origin` (the only flag combo that can break out).
const DEFAULT_IFRAME_SANDBOX = "allow-scripts allow-popups allow-forms";

function normalizeIframeSandbox(input?: string): string {
  // sanitize-html sometimes hands us an empty string for sandbox attribute → that
  // is actually the most restrictive form. We treat missing OR empty as "no
  // preference" and apply our DEFAULT. If the author specified flags, we keep
  // them except for allow-same-origin, which is always stripped.
  if (input == null || input.trim() === "") return DEFAULT_IFRAME_SANDBOX;
  const flags = input
    .split(/\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((s) => s !== "allow-same-origin")
    .filter((s) => s.startsWith("allow-"));
  return flags.length > 0 ? flags.join(" ") : DEFAULT_IFRAME_SANDBOX;
}

export function sanitize(html: string): SanitizeResult {
  const before = html.length;
  const out = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    // We knowingly allow <script>; isolation is the outer iframe sandbox +
    // CSP, not the sanitizer. Silence sanitize-html's XSS-warning banner.
    allowVulnerableTags: true,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      iframe: ["http", "https"], // no data:, no javascript:
      script: ["https"], // CDN only — no http:, data:, javascript:
    },
    allowedStyles: {
      "*": {
        color: [/.*/],
        "background-color": [/.*/],
        background: [/.*/],
        "text-align": [/.*/],
        "font-weight": [/.*/],
        "font-style": [/.*/],
        "font-size": [/.*/],
        margin: [/.*/],
        padding: [/.*/],
        border: [/.*/],
        width: [/.*/],
        height: [/.*/],
      },
    },
    transformTags: {
      iframe: (_tag, attribs) => {
        const cleaned: Record<string, string> = {};
        // Whitelist only safe attrs we want carried over
        for (const k of ["src", "srcdoc", "width", "height", "title", "allow", "loading", "name", "referrerpolicy"]) {
          if (typeof attribs[k] === "string") cleaned[k] = attribs[k]!;
        }
        // Force a safe sandbox — strips allow-same-origin always; defaults if missing
        cleaned.sandbox = normalizeIframeSandbox(attribs.sandbox);
        // Forbid in-frame navigation that would auto-leave the iframe context
        cleaned.referrerpolicy = cleaned.referrerpolicy ?? "no-referrer";
        return { tagName: "iframe", attribs: cleaned };
      },
    },
    disallowedTagsMode: "discard",
    nonTextTags: ["noscript", "object", "embed", "link"],
  });
  return { html: out, drops: Math.max(0, before - out.length) };
}
