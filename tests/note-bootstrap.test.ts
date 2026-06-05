import { expect, test } from "bun:test";
import { NOTE_BOOTSTRAP, injectBootstrap } from "../src/viewer/note-bootstrap";

// Regression: the copy-button injection must skip <pre class="mermaid">.
// Mermaid parses the element's textContent to build the graph, so a "copy"
// button appended inside leaks a trailing "copy" line → "Syntax error in text".
test("copy-button injection skips pre.mermaid", () => {
  // The guard runs before the element is marked bound, so a mermaid <pre> is
  // never decorated.
  expect(NOTE_BOOTSTRAP).toContain("pre.classList.contains('mermaid')");
  // The guard sits inside attachCopyCode, ahead of the ccBound marker.
  const fn = NOTE_BOOTSTRAP.slice(NOTE_BOOTSTRAP.indexOf("function attachCopyCode"));
  const guardAt = fn.indexOf("pre.classList.contains('mermaid')");
  const boundAt = fn.indexOf("pre.dataset.ccBound = '1'");
  expect(guardAt).toBeGreaterThan(-1);
  expect(boundAt).toBeGreaterThan(-1);
  expect(guardAt).toBeLessThan(boundAt);
});

test("injectBootstrap inserts the bootstrap before </body>", () => {
  const out = injectBootstrap("<html><body><p>hi</p></body></html>");
  expect(out).toContain("folio-copy-btn");
  expect(out.indexOf("</body>")).toBeGreaterThan(out.indexOf("folio-copy-btn"));
});
