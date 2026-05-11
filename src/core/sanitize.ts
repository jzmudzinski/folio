import sanitizeHtml from "sanitize-html";

export interface SanitizeResult {
  html: string;
  drops: number;
}

// Sanitization is applied to AGENT body only — not the template wrapper.
// So no <html/head/body/style/title/meta> here; those come from _base.html.eta.
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
};

export function sanitize(html: string): SanitizeResult {
  const before = html.length;
  const out = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ["http", "https", "mailto", "tel", "data"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
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
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "noscript", "iframe", "object", "embed", "link"],
  });
  return { html: out, drops: Math.max(0, before - out.length) };
}
