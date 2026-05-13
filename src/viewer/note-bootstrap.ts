// Bootstrap script injected into every /raw/:id response. Runs INSIDE the
// sandboxed note iframe (null origin since v0.3+). Owns the helpers that
// previously lived in parent and reached into iframe.contentDocument — those
// no longer work cross-origin.
//
// Communication with the viewer chrome happens via window.postMessage with the
// envelope `{ ns: 'folio', type: '<...>', ...payload }`. The matching parent
// listener is in src/viewer/render.ts noteScript.
//
// Messages emitted to parent:
//   - { type: 'ready' }                           — once on load
//   - { type: 'toc', items: [{level,id,text}] }   — once after DOM ready
//   - { type: 'scroll', pct: number }             — on scroll (throttled)
//   - { type: 'heading', id: string }             — IntersectionObserver hits
//   - { type: 'content', requestId, plain, markdown } — reply to request-content
//
// Messages received from parent:
//   - { type: 'set-parent-url', url }   — so anchor-copy can build a clipboard
//                                          URL that opens the *viewer* page
//   - { type: 'scroll-to', id }         — TOC item click in parent
//   - { type: 'request-content', requestId } — copy plain/markdown action

export const NOTE_BOOTSTRAP = `<script>
(function(){
  if (window.__folioBootstrap) return; // idempotent (e.g. when re-rendered)
  window.__folioBootstrap = true;

  var parentUrl = '';
  function post(msg){ try { parent.postMessage(Object.assign({ ns: 'folio' }, msg), '*'); } catch(_){} }

  function slugify(s){
    return (s || '').toLowerCase()
      .normalize('NFKD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-\$/g, '')
      .slice(0, 60);
  }

  function injectStyles(){
    if (document.getElementById('folio-helpers-css')) return;
    var s = document.createElement('style');
    s.id = 'folio-helpers-css';
    s.textContent = [
      'pre { position: relative; }',
      '.folio-copy-btn { position: absolute; top: 6px; right: 6px; font-family: ui-monospace, "JetBrains Mono", monospace; font-size: 10px; padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(127,127,127,0.25); background: rgba(255,255,255,0.6); color: rgba(0,0,0,0.55); cursor: pointer; opacity: 0; transition: opacity .12s, color .12s, border-color .12s; }',
      'pre:hover .folio-copy-btn { opacity: 1; }',
      '.folio-copy-btn:hover { color: #ff5a1f; border-color: #ff5a1f; }',
      '.folio-copy-btn.copied { color: #2f9050; border-color: #2f9050; opacity: 1; }',
      'h1, h2, h3, h4, h5, h6 { position: relative; }',
      '.folio-anchor { display: inline-block; margin-left: 0.4em; font-size: 0.7em; opacity: 0; color: #ff5a1f; cursor: pointer; font-weight: 400; text-decoration: none; vertical-align: middle; transition: opacity .12s; user-select: none; }',
      'h1:hover .folio-anchor, h2:hover .folio-anchor, h3:hover .folio-anchor, h4:hover .folio-anchor, h5:hover .folio-anchor, h6:hover .folio-anchor { opacity: 0.7; }',
      '.folio-anchor:hover { opacity: 1 !important; }',
      '.folio-anchor.copied::after { content: " copied"; font-size: 0.8em; color: #2f9050; }',
      'img { cursor: zoom-in; }',
      '.folio-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.92); z-index: 9999; display: flex; align-items: center; justify-content: center; cursor: zoom-out; }',
      '.folio-lightbox img { max-width: 95vw; max-height: 95vh; box-shadow: 0 8px 32px rgba(0,0,0,0.6); border-radius: 4px; }',
      '.folio-lightbox .folio-lb-close { position: absolute; top: 18px; right: 22px; font-family: ui-monospace, monospace; font-size: 11px; color: rgba(255,255,255,0.7); letter-spacing: 0.14em; text-transform: uppercase; cursor: pointer; }'
    ].join('\\n');
    document.head.appendChild(s);
  }

  function attachAnchors(){
    document.querySelectorAll('article h1, article h2, article h3, article h4, [data-folio-content] h1, [data-folio-content] h2, [data-folio-content] h3, [data-folio-content] h4').forEach(function(h){
      if (h.dataset.anchorBound) return;
      h.dataset.anchorBound = '1';
      if (!h.id) h.id = slugify(h.textContent);
      var a = document.createElement('a');
      a.className = 'folio-anchor';
      a.href = '#' + h.id;
      a.textContent = '¶';
      a.title = 'Klik = skopiuj link do tej sekcji';
      a.addEventListener('click', function(e){
        e.preventDefault();
        var base = parentUrl || (location.origin + location.pathname);
        var url = base.split('#')[0] + '#' + h.id;
        try { navigator.clipboard.writeText(url).then(function(){
          a.classList.add('copied');
          setTimeout(function(){ a.classList.remove('copied'); }, 1200);
        }); } catch(_){}
      });
      h.appendChild(a);
    });
  }

  function attachCopyCode(){
    document.querySelectorAll('pre').forEach(function(pre){
      if (pre.dataset.ccBound) return;
      pre.dataset.ccBound = '1';
      var btn = document.createElement('button');
      btn.className = 'folio-copy-btn';
      btn.type = 'button';
      btn.textContent = 'copy';
      btn.addEventListener('click', function(e){
        e.preventDefault();
        var code = pre.querySelector('code') || pre;
        var text = code.textContent || '';
        try { navigator.clipboard.writeText(text).then(function(){
          btn.textContent = '✓ copied';
          btn.classList.add('copied');
          setTimeout(function(){ btn.textContent = 'copy'; btn.classList.remove('copied'); }, 1400);
        }); } catch(_){}
      });
      pre.appendChild(btn);
    });
  }

  function attachLightbox(){
    document.querySelectorAll('article img, [data-folio-content] img').forEach(function(img){
      if (img.dataset.lbBound) return;
      img.dataset.lbBound = '1';
      img.addEventListener('click', function(e){
        e.preventDefault();
        var ov = document.createElement('div');
        ov.className = 'folio-lightbox';
        var im = document.createElement('img');
        im.src = img.currentSrc || img.src; im.alt = img.alt || '';
        var cx = document.createElement('div');
        cx.className = 'folio-lb-close';
        cx.textContent = '✕ esc';
        ov.appendChild(im); ov.appendChild(cx);
        function close(){ ov.remove(); document.removeEventListener('keydown', esc); }
        function esc(e){ if (e.key === 'Escape') close(); }
        ov.addEventListener('click', close);
        document.addEventListener('keydown', esc);
        document.body.appendChild(ov);
      });
    });
  }

  function attachExternalLinks(){
    document.querySelectorAll('a[href^="http"], a[href^="//"]').forEach(function(a){
      if (a.dataset.extBound) return;
      a.dataset.extBound = '1';
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer noopener');
    });
  }

  function emitToc(){
    // Two depths max — h3 and below add noise without much navigational
    // value in the typical note. Anchor links still work for h3+ (the
    // ensureHeadingIds() pass elsewhere stamps ids on every heading),
    // they just don't show in the TOC pane.
    var headings = document.querySelectorAll('article h1, article h2, [data-folio-content] h1, [data-folio-content] h2');
    var items = [];
    headings.forEach(function(h){
      if (!h.id) h.id = slugify(h.textContent);
      items.push({ level: h.tagName.toLowerCase(), id: h.id, text: (h.textContent || '').replace(/¶\$/, '').trim() });
    });
    post({ type: 'toc', items: items });
    // Scroll spy
    try {
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if (en.isIntersecting) post({ type: 'heading', id: en.target.id });
        });
      }, { root: null, rootMargin: '-30% 0px -55% 0px', threshold: 0 });
      headings.forEach(function(h){ io.observe(h); });
    } catch(_){}
  }

  var scrollRaf = 0;
  window.addEventListener('scroll', function(){
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function(){
      scrollRaf = 0;
      var de = document.documentElement;
      var total = de.scrollHeight - window.innerHeight;
      var pct = total <= 0 ? 0 : Math.min(100, Math.max(0, (window.scrollY / total) * 100));
      post({ type: 'scroll', pct: pct });
    });
  }, { passive: true });

  // ────── HTML → markdown (replies to copy-MD requests) ──────
  function tableToMd(t){
    var rows = [];
    t.querySelectorAll('tr').forEach(function(tr){
      var cells = [];
      tr.querySelectorAll('th, td').forEach(function(c){
        cells.push((c.textContent || '').trim().replace(/\\|/g, '\\\\|'));
      });
      rows.push('| ' + cells.join(' | ') + ' |');
    });
    if (rows.length > 1) {
      var firstRow = rows[0];
      var cols = (firstRow.match(/\\|/g) || []).length - 1;
      rows.splice(1, 0, '| ' + Array(cols).fill('---').join(' | ') + ' |');
    }
    return rows.join('\\n');
  }
  function htmlToMd(node){
    function walk(n){
      var out = '';
      n.childNodes.forEach(function(c){
        if (c.nodeType === 3) { out += c.textContent; return; }
        if (c.nodeType !== 1) return;
        var tag = c.tagName.toLowerCase();
        var inner = walk(c).trim();
        switch (tag) {
          case 'h1': out += '\\n# ' + inner + '\\n\\n'; break;
          case 'h2': out += '\\n## ' + inner + '\\n\\n'; break;
          case 'h3': out += '\\n### ' + inner + '\\n\\n'; break;
          case 'h4': out += '\\n#### ' + inner + '\\n\\n'; break;
          case 'p':  out += inner + '\\n\\n'; break;
          case 'strong': case 'b': out += '**' + inner + '**'; break;
          case 'em': case 'i': out += '*' + inner + '*'; break;
          case 'code':
            if (c.parentNode && c.parentNode.tagName === 'PRE') out += inner;
            else out += '\`' + inner + '\`';
            break;
          case 'pre': out += '\\n\\\`\\\`\\\`\\n' + inner + '\\n\\\`\\\`\\\`\\n\\n'; break;
          case 'ul': case 'ol': {
            var i = 1;
            c.querySelectorAll(':scope > li').forEach(function(li){
              var lt = walk(li).trim();
              out += (tag === 'ol' ? (i++) + '. ' : '- ') + lt + '\\n';
            });
            out += '\\n';
            break;
          }
          case 'li': out += inner; break;
          case 'a': {
            var href = c.getAttribute('href') || '';
            out += '[' + inner + '](' + href + ')';
            break;
          }
          case 'br': out += '  \\n'; break;
          case 'hr': out += '\\n---\\n\\n'; break;
          case 'blockquote':
            out += inner.split('\\n').map(function(l){ return '> ' + l; }).join('\\n') + '\\n\\n';
            break;
          case 'img':
            out += '![' + (c.getAttribute('alt') || '') + '](' + (c.getAttribute('src') || '') + ')';
            break;
          case 'table': out += tableToMd(c) + '\\n'; break;
          case 'script': case 'style': case 'iframe': break;
          default: out += inner;
        }
      });
      return out;
    }
    return walk(node).replace(/\\n{3,}/g, '\\n\\n').trim();
  }

  function getArticle(){ return document.querySelector('article, [data-folio-content]'); }

  window.addEventListener('message', function(e){
    var d = e.data; if (!d || d.ns !== 'folio') return;
    if (d.type === 'set-parent-url') { parentUrl = String(d.url || ''); return; }
    if (d.type === 'scroll-to' && d.id) {
      var el = document.getElementById(String(d.id));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (d.type === 'request-content') {
      var a = getArticle();
      if (!a) { post({ type: 'content', requestId: d.requestId, plain: '', markdown: '' }); return; }
      var plain = (a.textContent || '').replace(/\\n{3,}/g, '\\n\\n').trim();
      var md = htmlToMd(a);
      post({ type: 'content', requestId: d.requestId, plain: plain, markdown: md });
    }
  });

  function init(){
    injectStyles();
    attachAnchors();
    attachCopyCode();
    attachLightbox();
    attachExternalLinks();
    emitToc();
    post({ type: 'ready' });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>`;

export function injectBootstrap(html: string): string {
  // Insert right before </body>. Fallback: append at end if no </body> tag.
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${NOTE_BOOTSTRAP}\n</body>`);
  }
  return html + NOTE_BOOTSTRAP;
}
