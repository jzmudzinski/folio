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
@media (prefers-color-scheme: dark) {
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

  // Tiny chrome overlay (bottom-right) — counter + key hints.
  var nav = document.createElement("div");
  nav.className = "slide-nav";
  nav.innerHTML = '<span class="pos"><span data-pos>1</span>/' + slides.length + '</span> ' +
    '<span class="key">←/→</span> nav <span class="key">F</span> full <span class="key">S</span> spk';
  document.body.appendChild(nav);
  var posEl = nav.querySelector("[data-pos]");
  function updateNav() {
    if (posEl) posEl.textContent = String(current + 1);
  }

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
