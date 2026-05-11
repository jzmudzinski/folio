import sanitizeHtml from "sanitize-html";

export interface SanitizeResult {
  html: string;
  drops: number;
}

// Sanitization is applied to AGENT body only — not the template wrapper.
// So no <html/head/body/style/title/meta> here; those come from _base.html.eta.
//
// <iframe> is allowed for sandboxed embeds (interactive widgets, CodeSandbox,
// YouTube, demo charts) — but sandbox is enforced and `allow-same-origin` is
// always stripped so the embedded frame can never escape into the parent origin
// even if both happen to be served from the same host. See transformTags below.
const ALLOWED_TAGS = [
  "article", "section", "main", "header", "footer", "aside", "nav",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "ul", "ol", "li", "dl", "dt", "dd",
  "blockquote", "pre", "code", "em", "strong", "small", "sub", "sup",
  "a", "img", "figure", "figcaption", "picture", "source",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "hr", "br", "div", "span",
  "details", "summary", "mark", "kbd", "var", "samp",
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon", "text", "tspan",
  "iframe",
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
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      iframe: ["http", "https"], // no data:, no javascript:
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
    nonTextTags: ["script", "noscript", "object", "embed", "link"],
  });
  return { html: out, drops: Math.max(0, before - out.length) };
}
