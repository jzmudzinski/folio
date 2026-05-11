export interface ExtractedText {
  title: string;
  headings: string;
  body: string;
  word_count: number;
  summary: string;
  inline_style_count: number;
  class_count: number;
  class_set: Set<string>;
}

export function extractText(html: string): ExtractedText {
  let title = "";
  const headings: string[] = [];
  const bodyChunks: string[] = [];
  let inline_style_count = 0;
  let class_count = 0;
  const class_set = new Set<string>();
  let inTitle = false;
  let inHeading = false;
  // Default true: callers pass body fragments without <article> wrapper.
  // If the input is a full document, the `article/main/body` handler keeps it true.
  let inArticle = true;
  let inScriptOrStyle = false;

  const rewriter = new HTMLRewriter()
    .on("title", {
      element: () => {
        inTitle = true;
      },
      text(t) {
        if (inTitle) {
          title += t.text;
          if (t.lastInTextNode) inTitle = false;
        }
      },
    })
    .on("h1, h2, h3, h4, h5, h6", {
      element: () => {
        inHeading = true;
        headings.push("");
      },
      text(t) {
        if (inHeading) {
          headings[headings.length - 1] += t.text;
          if (t.lastInTextNode) inHeading = false;
        }
      },
    })
    .on("script, style", {
      element: () => {
        inScriptOrStyle = true;
      },
    })
    .on("article, [data-folio-content], main, body", {
      element: () => {
        inArticle = true;
      },
    })
    .on("[style]", {
      element(el) {
        if (el.getAttribute("style")) inline_style_count++;
      },
    })
    .on("[class]", {
      element(el) {
        const cls = el.getAttribute("class");
        if (cls) {
          for (const c of cls.split(/\s+/)) {
            if (c) {
              class_count++;
              class_set.add(c);
            }
          }
        }
      },
    })
    .on("p, li, blockquote, td, th, h1, h2, h3, h4, h5, h6", {
      text(t) {
        if (inArticle && !inScriptOrStyle) {
          bodyChunks.push(t.text);
        }
      },
    });

  rewriter.transform(new Response(html));

  const body = bodyChunks.join(" ").replace(/\s+/g, " ").trim();
  const word_count = body ? body.split(/\s+/).length : 0;
  const summary = body.slice(0, 240).trim();

  return {
    title: title.trim(),
    headings: headings.filter(Boolean).join(" • "),
    body,
    word_count,
    summary,
    inline_style_count,
    class_count,
    class_set,
  };
}
