// Presentation mode (v0.26+).
//
// When note.type === "presentation", the /raw/:id handler appends a CSS
// block + a bootstrap script to body. Inside the body iframe the script:
//   - Detects every <section class="slide"> as one slide
//   - Hides all but the current; toggles the .is-current class on nav
//   - Listens for ←/→/PageUp/PageDown/Space/Home/End keys + digit jumps
//   - F → requests fullscreen on documentElement (works because the body
//     iframe carries allow="fullscreen" — added by render.ts when type
//     is presentation)
//   - S → toggles body.is-speaker, revealing <aside class="notes"> hidden
//     by default so speaker notes are invisible to the audience
//   - Renders a tiny bottom-right overlay with current / total + hints
//
// The CSS is generic — independent of theme. Agents pick the actual
// per-slide design via theme:"plain" + inline <style>. The chrome/script
// here just handles navigation + visibility.

export const PRESENTATION_CSS = `
/* v0.26 presentation mode — slide visibility + small navigation chrome. */
html, body { height: 100%; }
body { margin: 0; padding: 0; overflow: hidden; }
/* v0.27 — body gains a thumbnails-rail layout when the sidebar is shown */
body.has-thumbs { display: grid; grid-template-columns: 140px 1fr; min-height: 100vh; }
body.has-thumbs.is-fullscreen { display: block; }
body.has-thumbs > .slide { grid-column: 2; }
body.has-thumbs.is-fullscreen > .slide { grid-column: 1 / -1; }
.slide {
  box-sizing: border-box;
  width: 100%;
  min-height: 100vh;
  padding: 4vh 6vw;
  display: none;
  flex-direction: column;
  justify-content: center;
  overflow-y: auto;
  position: relative;
}
.slide.is-current { display: flex; }
.slide aside.notes {
  display: none;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  background: rgba(10,10,10,0.04);
  border-left: 3px solid rgba(255,90,31,0.4);
  padding: 10px 14px;
  margin-top: 16px;
  color: rgba(10,10,10,0.7);
  white-space: pre-wrap;
}
body.is-speaker .slide.is-current aside.notes { display: block; }
body.is-speaker .slide.is-current::before {
  content: "SPEAKER MODE";
  position: absolute;
  top: 12px;
  right: 14px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.18em;
  color: #ff5a1f;
  background: rgba(255,90,31,0.12);
  padding: 3px 8px;
  border-radius: 4px;
  font-weight: 600;
}
.slide-nav {
  position: fixed;
  bottom: 14px;
  right: 16px;
  background: rgba(10,10,10,0.78);
  color: #f5f3ee;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  display: flex;
  gap: 10px;
  align-items: center;
  z-index: 100;
  user-select: none;
  pointer-events: none;
}
.slide-nav .key { color: #888; }
.slide-nav .pos { color: #ff5a1f; font-weight: 600; }
.slide-empty {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: 'Instrument Serif', Georgia, serif;
  font-style: italic;
  color: rgba(10,10,10,0.55);
  font-size: 18px;
}

/* v0.27 — thumbnails sidebar. Left rail of small slide previews. Click
   jumps to slide N. Current slide highlighted. Toggle visibility with T.
   Hidden automatically in fullscreen so the slide takes the whole viewport. */
.thumbs-rail {
  grid-column: 1;
  background: rgba(10,10,10,0.04);
  border-right: 1px solid rgba(10,10,10,0.08);
  padding: 12px 8px;
  overflow-y: auto;
  display: none;
}
body.has-thumbs .thumbs-rail { display: block; }
body.has-thumbs.is-fullscreen .thumbs-rail { display: none; }
.thumb {
  background: #fff;
  border: 2px solid rgba(10,10,10,0.1);
  border-radius: 5px;
  padding: 8px 9px;
  margin-bottom: 8px;
  cursor: pointer;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: rgba(10,10,10,0.7);
  transition: border-color .12s, transform .12s;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 64px;
  position: relative;
  overflow: hidden;
}
.thumb:hover { border-color: rgba(255,90,31,0.5); transform: translateY(-1px); }
.thumb.is-current { border-color: #ff5a1f; box-shadow: 0 2px 8px rgba(255,90,31,0.15); }
.thumb .thumb-n { color: #ff5a1f; font-weight: 700; font-size: 10px; }
.thumb .thumb-h {
  font-family: 'Familjen Grotesk', system-ui, sans-serif;
  font-size: 10.5px;
  font-weight: 500;
  color: rgba(10,10,10,0.85);
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: normal;
  letter-spacing: 0;
  text-transform: none;
}
@media (prefers-color-scheme: dark) {
  .thumbs-rail { background: rgba(245,243,238,0.04); border-right-color: rgba(245,243,238,0.08); }
  .thumb { background: rgba(245,243,238,0.06); border-color: rgba(245,243,238,0.12); color: rgba(245,243,238,0.7); }
  .thumb .thumb-h { color: rgba(245,243,238,0.85); }
  .slide aside.notes { background: rgba(245,243,238,0.05); color: rgba(245,243,238,0.7); }
  .slide-empty { color: rgba(245,243,238,0.55); }
}
`;

export const PRESENTATION_JS = `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  if (slides.length === 0) {
    // Helpful empty state — body had no <section class="slide"> blocks.
    var hint = document.createElement("div");
    hint.className = "slide-empty";
    hint.textContent = 'Presentation mode: add <section class="slide"> blocks to body_html.';
    document.body.appendChild(hint);
    return;
  }
  var current = 0;
  function show(idx) {
    if (idx < 0) idx = 0;
    if (idx >= slides.length) idx = slides.length - 1;
    if (idx === current) return;
    slides[current].classList.remove("is-current");
    slides[idx].classList.add("is-current");
    current = idx;
    updateNav();
    // Scroll the new slide to top — long slides should start at top, not
    // remember the prior slide's scroll position.
    try { slides[idx].scrollTop = 0; } catch (_) {}
  }
  function next() { show(current + 1); }
  function prev() { show(current - 1); }
  function first() { show(0); }
  function last() { show(slides.length - 1); }
  function toggleSpeaker() {
    document.body.classList.toggle("is-speaker");
    updateNav();
  }
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen();
      }
    } catch (_) { /* allow="fullscreen" missing or denied — silently ignore */ }
  }

  // Initial state: first slide visible.
  slides[0].classList.add("is-current");

  // v0.27 — Thumbnails sidebar. Build once from the existing .slide list;
  // click jumps to slide. Persisted toggle so the user can keep or hide it.
  // For each thumb pull the first heading or, failing that, a short text
  // sample so even un-titled slides have a recognizable label.
  var THUMBS_KEY = "folio-pres-thumbs";
  function firstHeadingOrText(slide) {
    var h = slide.querySelector("h1, h2, h3");
    if (h && h.textContent) return h.textContent.trim().slice(0, 80);
    var t = (slide.textContent || "").trim().replace(/\s+/g, " ");
    return t.slice(0, 80) || "(empty)";
  }
  var rail = document.createElement("aside");
  rail.className = "thumbs-rail";
  rail.setAttribute("aria-label", "Slide thumbnails");
  rail.innerHTML = slides.map(function (s, i) {
    return '<div class="thumb" data-thumb-n="' + i + '"' + (i === 0 ? ' role="button" tabindex="0"' : ' role="button" tabindex="0"') + '>' +
      '<span class="thumb-n">' + (i + 1) + '</span>' +
      '<span class="thumb-h">' + (firstHeadingOrText(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")) + '</span>' +
      '</div>';
  }).join("");
  // Insert before the first slide so layout flows correctly with grid.
  document.body.insertBefore(rail, slides[0]);

  var thumbsVisible = true;
  try {
    var saved = localStorage.getItem(THUMBS_KEY);
    if (saved === "hidden") thumbsVisible = false;
  } catch (_) {}
  function applyThumbs() {
    if (thumbsVisible) document.body.classList.add("has-thumbs");
    else document.body.classList.remove("has-thumbs");
  }
  applyThumbs();

  function updateThumbs() {
    var ts = rail.querySelectorAll(".thumb");
    for (var ti = 0; ti < ts.length; ti++) {
      ts[ti].classList.toggle("is-current", ti === current);
    }
  }
  rail.addEventListener("click", function (e) {
    var t = e.target && e.target.closest && e.target.closest(".thumb");
    if (!t) return;
    var n = parseInt(t.getAttribute("data-thumb-n") || "-1", 10);
    if (n >= 0) show(n);
  });
  rail.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var t = e.target && e.target.closest && e.target.closest(".thumb");
    if (!t) return;
    e.preventDefault();
    var n = parseInt(t.getAttribute("data-thumb-n") || "-1", 10);
    if (n >= 0) show(n);
  });

  // Tiny chrome overlay (bottom-right) — counter + key hints.
  var nav = document.createElement("div");
  nav.className = "slide-nav";
  nav.innerHTML = '<span class="pos"><span data-pos>1</span>/' + slides.length + '</span> ' +
    '<span class="key">←/→</span> nav <span class="key">F</span> full <span class="key">T</span> thumbs <span class="key">S</span> spk';
  document.body.appendChild(nav);
  var posEl = nav.querySelector("[data-pos]");
  function updateNav() {
    if (posEl) posEl.textContent = String(current + 1);
    updateThumbs();
  }
  function toggleThumbs() {
    thumbsVisible = !thumbsVisible;
    try { localStorage.setItem(THUMBS_KEY, thumbsVisible ? "visible" : "hidden"); } catch (_) {}
    applyThumbs();
  }

  // Fullscreen state affects the rail visibility via body.is-fullscreen
  // class; the actual hide is in CSS.
  function syncFullscreenClass() {
    if (document.fullscreenElement) document.body.classList.add("is-fullscreen");
    else document.body.classList.remove("is-fullscreen");
  }
  document.addEventListener("fullscreenchange", syncFullscreenClass);

  // Keyboard nav. Captured at document level so any focused element passes
  // through — slides may contain inputs / buttons inside interactive demos,
  // but those rarely consume arrow keys.
  document.addEventListener("keydown", function (e) {
    // Don't hijack arrows when user is typing in an input/textarea.
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
    if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " " || e.key === "Enter") {
      e.preventDefault(); next();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "Backspace") {
      e.preventDefault(); prev();
    } else if (e.key === "Home") {
      e.preventDefault(); first();
    } else if (e.key === "End") {
      e.preventDefault(); last();
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault(); toggleFullscreen();
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault(); toggleSpeaker();
    } else if (e.key === "t" || e.key === "T") {
      e.preventDefault(); toggleThumbs();
    } else if (e.key >= "1" && e.key <= "9") {
      var n = parseInt(e.key, 10) - 1;
      if (n < slides.length) { e.preventDefault(); show(n); }
    }
  });

  // Click-to-advance: click the right half of the current slide → next,
  // left half → prev. Excludes clicks on links, buttons, inputs so demos
  // inside slides keep working.
  document.addEventListener("click", function (e) {
    var t = e.target;
    while (t && t !== document.body) {
      var tn = t.tagName;
      if (tn === "A" || tn === "BUTTON" || tn === "INPUT" || tn === "TEXTAREA" || tn === "SELECT" || tn === "LABEL") return;
      t = t.parentNode;
    }
    var rect = document.documentElement.getBoundingClientRect();
    var x = e.clientX - rect.left;
    if (x > rect.width / 2) next(); else prev();
  });

  updateNav();
})();
`;
