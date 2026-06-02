/**
 * PWA surface for the cloud relay — app shell, pair page, service worker,
 * manifest, icons.
 *
 * Design model: the cloud serves an SPA-style shell. First request returns
 * minimal HTML + bootstrap JS that:
 *   1. Registers the service worker
 *   2. Reads the bearer token from IndexedDB (set during pairing)
 *   3. If absent → window.location = '/pair'
 *   4. If present → fetches /v1/feed and renders the home list
 *
 * Service worker handles auth injection: every fetch to /v1/*, /n/*, /raw/*,
 * /t/* gets the Authorization: Bearer header attached from IDB. The PWA's
 * own pages don't carry the token in URL or cookie — only in IDB, which is
 * origin-scoped and not exposed to scripts on other origins.
 *
 * Why not server-side render? Cloud already has all the data and could just
 * pageList()-style render. Chose SPA shell because: (a) avoids
 * Authorization-on-first-request bootstrapping problem (browser doesn't
 * carry a header until JS attaches), (b) offline caching is trivial when
 * the shell is a static asset.
 */

const PWA_CSS = `
:root {
  --bg:       #f5f3ee;
  --bg-2:     #efeae0;
  --panel:    #fdfcf9;
  --ink:      #0a0a0a;
  --ink-2:    #1a1a1a;
  --muted:    #6b6b66;
  --muted-2:  #a8a89e;
  --line:     rgba(10,10,10,0.10);
  --line-2:   rgba(10,10,10,0.06);
  --accent:   #ff5a1f;
  --accent-soft: rgba(255,90,31,0.10);
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink); font-family: 'Familjen Grotesk', system-ui, -apple-system, sans-serif; font-size: 17px; line-height: 1.5; }
@import url('https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@400..700&family=Instrument+Serif:ital@0;1&display=swap');
header.top { padding: 14px 20px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; background: var(--panel); position: sticky; top: 0; z-index: 10; }
/* Wordmark mirrors assets/wordmark-light.svg — Familjen Grotesk 500,
   negative letter-spacing, single orange period as the only color note. */
header.top .brand { font-family: 'Familjen Grotesk', system-ui, sans-serif; font-weight: 500; font-size: 22px; letter-spacing: -0.04em; color: var(--ink); }
header.top .brand .dot { color: var(--accent); }
header.top .meta { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); }
header.top .whoami { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.06em; color: var(--muted); margin-left: 4px; }
header.top .whoami a { color: inherit; text-decoration: none; border-bottom: 1px dotted var(--line); }
header.top .whoami a:hover { color: var(--ink); border-bottom-color: var(--muted); }
header.top .whoami .display { color: var(--ink-2); }
main { padding: 16px 20px 60px; max-width: 760px; margin: 0 auto; }
.empty, .loading { color: var(--muted); text-align: center; padding: 60px 20px; font-style: italic; font-family: 'Instrument Serif', serif; font-size: 18px; }
.offline-banner { background: #fff6d6; color: #5a4400; border-bottom: 1px solid var(--line); padding: 8px 20px; font-size: 13px; text-align: center; }
.offline-banner.hidden { display: none; }
.search { display: block; width: 100%; padding: 12px 14px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--ink); margin-bottom: 20px; -webkit-appearance: none; }
.search:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.list { display: flex; flex-direction: column; gap: 2px; }
.note { display: block; padding: 14px 12px; border-radius: 10px; transition: background 120ms; min-height: 56px; cursor: pointer; color: inherit; }
.note:hover, .note:active { background: var(--bg-2); }
.note .title { font-size: 17px; font-weight: 500; line-height: 1.35; color: var(--ink); margin-bottom: 4px; }
.note .meta {
  font-size: 13px;
  color: var(--muted);
  display: flex;
  gap: 6px 12px;
  align-items: baseline;
  flex-wrap: wrap;
  min-width: 0;
}
.note .meta > * { white-space: nowrap; min-width: 0; }
.note .type { font-size: 10.5px; padding: 1px 6px; border: 1px solid var(--line); border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); flex-shrink: 0; }
.note .type.research { color: #0a6; border-color: rgba(0,170,102,0.3); }
.note .type.comparison { color: #963; border-color: rgba(153,102,51,0.3); }
.note .type.technical { color: #345; border-color: rgba(51,68,85,0.3); }
.note .type.journal { color: #864; border-color: rgba(136,102,68,0.3); }
.note .type.snippet { color: var(--muted); }
.note a.thread {
  font-style: italic;
  font-family: 'Instrument Serif', serif;
  font-size: 15px;
  color: var(--muted);
  text-decoration: none;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}
.note a.thread:active { color: var(--ink-2); }
.note .ago { color: var(--muted-2); margin-left: auto; flex-shrink: 0; }
header.top #ctx { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; justify-content: flex-end; overflow: hidden; }
header.top #ctx .back-link { color: var(--accent); text-decoration: none; font-weight: 500; flex-shrink: 0; }
header.top #ctx .thread-name { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 15px; color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.group-h { font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted-2); padding: 18px 12px 8px; }

/* Add-device panel — small surface at the bottom of the home list that
   lets a paired user generate a pairing code for another device without
   touching SSH. Hidden by default; revealed when the link is tapped. */
.add-device-link { display: block; text-align: center; margin: 36px 0 12px; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted-2); text-decoration: none; padding: 12px; }
.add-device-link:hover { color: var(--accent); }
.add-device-panel { display: none; padding: 20px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; margin: 12px 0 60px; }
.add-device-panel.shown { display: block; }
.add-device-panel h3 { font-family: 'Familjen Grotesk'; font-weight: 500; margin: 0 0 8px; font-size: 17px; }
.add-device-panel p { color: var(--muted); font-size: 13px; margin: 0 0 16px; line-height: 1.5; }
.add-device-panel button.gen { width: 100%; padding: 12px 14px; font-size: 14px; font-weight: 600; background: var(--ink); color: var(--bg); border: 0; border-radius: 8px; cursor: pointer; font-family: inherit; }
.add-device-panel button.gen:disabled { opacity: 0.5; cursor: wait; }
.add-device-panel .code-box { margin-top: 18px; padding: 14px; background: var(--bg-2); border-radius: 8px; text-align: center; }
.add-device-panel .code-box .lbl { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; }
.add-device-panel .code-box .code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 28px; letter-spacing: 6px; color: var(--ink); user-select: all; }
.add-device-panel .code-box .hint { font-size: 12px; color: var(--muted); margin-top: 10px; }
.add-device-panel .err { color: #a4253a; font-size: 13px; margin-top: 12px; display: none; }
.add-device-panel .err.shown { display: block; }

/* Install banner — visible only when the app isn't yet running in
   standalone mode and the user hasn't dismissed it this session. The
   button half is shown only when beforeinstallprompt is captured;
   on iOS Safari we show inline Share-menu instructions instead. */
.install-banner { display: none; padding: 14px 16px; background: var(--accent-soft); border: 1px solid rgba(255,90,31,0.25); border-radius: 12px; margin-bottom: 18px; gap: 12px; align-items: center; flex-wrap: wrap; }
.install-banner.shown { display: flex; }
.install-banner .txt { flex: 1; min-width: 200px; font-size: 14px; color: var(--ink); line-height: 1.45; }
.install-banner .txt strong { font-weight: 500; }
.install-banner .txt small { display: block; color: var(--muted); font-size: 12.5px; margin-top: 3px; }
.install-banner .install-btn { padding: 10px 16px; font-size: 14px; font-weight: 600; background: var(--accent); color: #fff; border: 0; border-radius: 8px; cursor: pointer; font-family: inherit; }
.install-banner .install-btn:disabled { opacity: 0.6; cursor: wait; }
.install-banner .install-btn[hidden] { display: none; }
.install-banner .dismiss { padding: 8px 10px; font-size: 12px; background: transparent; color: var(--muted); border: 0; cursor: pointer; font-family: inherit; }
.install-banner .dismiss:hover { color: var(--ink); }

/* Pair page */
.pair-wrap { max-width: 420px; margin: 60px auto; padding: 20px; }
/* Pair page heading mirrors brand wordmark — Familjen Grotesk 500, orange dot. */
.pair-wrap h1 { font-family: 'Familjen Grotesk', system-ui, sans-serif; font-weight: 500; font-size: 40px; letter-spacing: -0.04em; margin: 0 0 10px; color: var(--ink); }
.pair-wrap h1 .dot { color: var(--accent); }
.pair-wrap p.lead { color: var(--muted); font-size: 15px; line-height: 1.5; margin-bottom: 30px; }
.pair-wrap label { display: block; font-size: 13px; color: var(--muted); margin: 18px 0 6px; letter-spacing: 0.5px; text-transform: uppercase; }
.pair-wrap input { width: 100%; padding: 14px 16px; font-size: 17px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--ink); -webkit-appearance: none; font-family: inherit; }
.pair-wrap input#code { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 22px; letter-spacing: 4px; text-align: center; }
.pair-wrap input:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.pair-wrap button { width: 100%; padding: 14px 16px; font-size: 16px; font-weight: 600; background: var(--ink); color: var(--bg); border: 0; border-radius: 10px; margin-top: 20px; cursor: pointer; }
.pair-wrap button:disabled { opacity: 0.5; cursor: wait; }
.pair-wrap .err { margin-top: 16px; padding: 12px 14px; background: rgba(220,53,69,0.08); border: 1px solid rgba(220,53,69,0.25); border-radius: 8px; color: #a4253a; font-size: 14px; display: none; }
.pair-wrap .err.shown { display: block; }
.pair-wrap .tip { margin-top: 30px; font-size: 13px; color: var(--muted); line-height: 1.55; }
.pair-wrap .tip code { background: var(--bg-2); padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
`;

/** Tiny IDB helper inlined into both shell + sw — shared key-value store. */
const IDB_HELPERS_JS = `
(function () {
  const DB_NAME = 'folio-pwa';
  const STORE = 'kv';
  function open() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  window.folioKV = {
    get: function (key) {
      return open().then(function (db) {
        return new Promise(function (resolve) {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { resolve(undefined); };
        });
      });
    },
    set: function (key, value) {
      return open().then(function (db) {
        return new Promise(function (resolve) {
          const tx = db.transaction(STORE, 'readwrite');
          const req = tx.objectStore(STORE).put(value, key);
          req.onsuccess = function () { resolve(); };
          req.onerror = function () { resolve(); };
        });
      });
    },
    del: function (key) {
      return open().then(function (db) {
        return new Promise(function (resolve) {
          const tx = db.transaction(STORE, 'readwrite');
          const req = tx.objectStore(STORE).delete(key);
          req.onsuccess = function () { resolve(); };
          req.onerror = function () { resolve(); };
        });
      });
    }
  };
})();
`;

const APP_SHELL_BOOTSTRAP_JS = `
${IDB_HELPERS_JS}
(function () {
  // Register service worker — sets up auth header injection + offline cache
  // for sub-resources (theme.css, icons). Auth on note routes is now done
  // explicitly in JS (no SW dependency for correctness — SW is just polish).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (e) {
      console.warn('[folio-pwa] sw register failed', e);
    });
  }

  // Online/offline banner.
  const banner = document.getElementById('offline-banner');
  function updateOnline() {
    if (banner) banner.classList.toggle('hidden', navigator.onLine);
  }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();

  // Detect context from URL: home (/) shows all, thread page (/t/:id)
  // pre-filters to that thread. Both use the same shell.
  function currentThread() {
    const m = window.location.pathname.match(/^\\/t\\/([^/]+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function ago(iso) {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' hr';
    const d = Math.floor(h / 24);
    return d === 1 ? 'yesterday' : d + 'd';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderList(notes, opts) {
    const root = document.getElementById('list');
    const grouped = opts && opts.grouped !== false;
    if (!notes || notes.length === 0) {
      const msg = opts && opts.thread
        ? 'No notes in thread "' + esc(opts.thread) + '" yet.'
        : (opts && opts.query
          ? 'No notes match "' + esc(opts.query) + '".'
          : 'No notes yet. Create one on your laptop and run <code>folio sync</code>.');
      root.innerHTML = '<div class="empty">' + msg + '</div>';
      return;
    }
    // On thread page every note IS in that thread — the chip would be
    // redundant noise, so suppress it. Search results and home both keep
    // the chip so the user can see where each hit comes from.
    const rowOpts = { hideThread: !!(opts && opts.thread) };
    // Group by date bucket on home; flat list on thread or search results.
    if (!grouped) {
      const flat = [];
      for (const n of notes) flat.push(noteRow(n, rowOpts));
      root.innerHTML = flat.join('');
      return;
    }
    const buckets = { Today: [], Yesterday: [], 'This week': [], 'This month': [], Older: [] };
    const now = new Date(); now.setHours(0, 0, 0, 0);
    for (const n of notes) {
      const d = new Date(n.created_at); d.setHours(0, 0, 0, 0);
      const diff = Math.floor((now - d) / 86400000);
      const b = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? 'This week' : diff < 30 ? 'This month' : 'Older';
      buckets[b].push(n);
    }
    const html = [];
    for (const label of ['Today', 'Yesterday', 'This week', 'This month', 'Older']) {
      const arr = buckets[label];
      if (arr.length === 0) continue;
      html.push('<div class="group-h">' + label + '</div>');
      for (const n of arr) html.push(noteRow(n, rowOpts));
    }
    root.innerHTML = html.join('');
  }

  function noteRow(n, opts) {
    // Outer is a <div> not <a>: a row contains a nested <a class="thread">,
    // and nested <a> is invalid HTML (browsers pick the outer on click,
    // breaking the chip nav). Click delegation below routes:
    //   - tap on .thread <a>  → browser navigates natively to /t/<id>
    //   - tap anywhere else   → JS navigates to data-href = /n/<uuid>
    const hideThread = opts && opts.hideThread;
    return (
      '<div class="note" data-href="/n/' + encodeURIComponent(n.uuid) + '">' +
        '<div class="title">' + esc(n.title) + '</div>' +
        '<div class="meta">' +
          '<span class="type ' + esc(n.type) + '">' + esc(n.type) + '</span>' +
          (hideThread
            ? ''
            : '<a class="thread" href="/t/' + encodeURIComponent(n.thread_id) + '">' + esc(n.thread_id) + '</a>') +
          '<span class="ago">' + ago(n.created_at) + ' ago</span>' +
        '</div>' +
      '</div>'
    );
  }

  // Feed loader. Used by initial boot, by search input, and on thread page.
  let inflight = 0;
  async function loadFeed(opts) {
    opts = opts || {};
    const token = await window.folioKV.get('token');
    if (!token) { window.location.href = '/pair'; return; }
    const params = new URLSearchParams();
    if (opts.query) params.set('q', opts.query);
    if (opts.thread) params.set('thread', opts.thread);
    const url = '/v1/feed' + (params.toString() ? '?' + params.toString() : '');
    const myCall = ++inflight;
    try {
      const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      if (myCall !== inflight) return; // Stale response — newer search inflight.
      if (r.status === 401) { window.location.href = '/pair'; return; }
      if (!r.ok) throw new Error('feed: HTTP ' + r.status);
      const body = await r.json();
      renderList(body.notes || [], {
        grouped: !opts.query && !opts.thread,
        query: opts.query,
        thread: opts.thread,
      });
    } catch (e) {
      if (myCall !== inflight) return;
      const root = document.getElementById('list');
      if (root) root.innerHTML = '<div class="empty">Could not load: ' + esc(e.message) + '</div>';
    }
  }

  // Update header for thread page.
  function setHeader(opts) {
    const ctxEl = document.getElementById('ctx');
    if (!ctxEl) return;
    if (opts.thread) {
      ctxEl.innerHTML = '<a href="/" class="back-link">‹ all</a> <span class="thread-name">' + esc(opts.thread) + '</span>';
    } else {
      ctxEl.textContent = '';
    }
  }

  // Click delegation on the list: thread <a> navigates natively, everything
  // else on a .note row triggers note view via data-href. Avoids nested
  // anchors (invalid HTML, breaks both clicks on some browsers).
  document.addEventListener('click', function (ev) {
    const threadLink = ev.target.closest && ev.target.closest('a.thread');
    if (threadLink) return; // let browser follow it
    const row = ev.target.closest && ev.target.closest('.note[data-href]');
    if (row) {
      ev.preventDefault();
      window.location.href = row.getAttribute('data-href');
    }
  });

  // Boot.
  const thread = currentThread();
  setHeader({ thread: thread });
  loadFeed({ thread: thread });

  // "Add another device" panel — paired user can generate codes here so a
  // new phone/laptop can pair without anyone touching the cloud server.
  // Token is read from IDB (same one used for the feed call); the cloud's
  // /v1/auth/pair-code endpoint is bearer-authed.
  const addLink = document.getElementById('add-device-link');
  const addPanel = document.getElementById('add-device-panel');
  if (addLink && addPanel) {
    addLink.addEventListener('click', function(ev){
      ev.preventDefault();
      addPanel.classList.toggle('shown');
      if (addPanel.classList.contains('shown')) {
        addPanel.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    });
  }
  const genBtn = document.getElementById('gen-code-btn');
  if (genBtn) {
    genBtn.addEventListener('click', async function(){
      const errEl = document.getElementById('gen-code-err');
      errEl.classList.remove('shown');
      const orig = genBtn.textContent;
      genBtn.disabled = true; genBtn.textContent = 'Generating…';
      try {
        const tok = await window.folioKV.get('token');
        if (!tok) throw new Error('not paired — open /pair first');
        const r = await fetch('/v1/auth/pair-code', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tok }
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const body = await r.json();
        const box = document.getElementById('gen-code-box');
        document.getElementById('gen-code-value').textContent = body.code;
        document.getElementById('gen-code-hint').textContent =
          'expires ' + new Date(body.expires_at).toLocaleTimeString();
        box.hidden = false;
      } catch (e) {
        errEl.textContent = e.message || String(e);
        errEl.classList.add('shown');
      } finally {
        genBtn.disabled = false; genBtn.textContent = orig;
      }
    });
  }

  // ---- Identity hint (v0.14+) ----
  // Calls /v1/admin/whoami with the bearer from IDB; renders
  // "signed in as <display>" + a tiny "sign out" link in the top bar.
  // Sign-out clears IDB token + reloads → /pair flow.
  (async function setupWhoami(){
    var el = document.getElementById('whoami');
    if (!el) return;
    var tok = await window.folioKV.get('token');
    if (!tok) return;
    try {
      var r = await fetch('/v1/admin/whoami', { headers: { Authorization: 'Bearer ' + tok } });
      if (!r.ok) return;
      var me = await r.json();
      el.hidden = false;
      el.innerHTML = '';
      el.appendChild(document.createTextNode('signed in as '));
      var disp = document.createElement('span');
      disp.className = 'display';
      disp.textContent = me.display_name || me.user_id;
      el.appendChild(disp);
      el.appendChild(document.createTextNode(' · '));
      var out = document.createElement('a');
      out.href = '#sign-out';
      out.textContent = 'sign out';
      out.addEventListener('click', async function(ev){
        ev.preventDefault();
        if (!window.confirm('Sign out of ' + (me.display_name || me.user_id) + '?')) return;
        await window.folioKV.del('token');
        await window.folioKV.del('paired_at');
        try { var caches2 = await caches.keys(); for (var k of caches2) await caches.delete(k); } catch (_e) {}
        window.location.href = '/pair';
      });
      el.appendChild(out);
    } catch (_e) {}
  })();

  // ---- Install prompt ----
  // beforeinstallprompt: Chrome/Edge/Samsung capture so we can offer an
  // explicit Install button rather than burying it in the browser menu.
  // iOS Safari doesn't fire that event; instead we show inline "tap Share →
  // Add to Home Screen" instructions. Both paths are short-circuited when
  // the app is already running in standalone mode (display-mode media query
  // or iOS's legacy navigator.standalone) or when the user dismissed the
  // banner earlier in the session.
  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    } catch (_e) {}
    return navigator.standalone === true;
  }
  function isIosSafari() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  }
  (function setupInstallBanner(){
    const banner = document.getElementById('install-banner');
    const btn = document.getElementById('install-btn');
    const dismiss = document.getElementById('install-dismiss');
    const title = document.getElementById('install-title');
    const hint = document.getElementById('install-hint');
    if (!banner || !btn || !dismiss || !title || !hint) return;
    if (isStandalone()) return;
    try { if (sessionStorage.getItem('folio-install-dismissed') === '1') return; } catch (_e) {}

    let deferred = null;
    window.addEventListener('beforeinstallprompt', function(ev){
      ev.preventDefault();
      deferred = ev;
      title.textContent = 'Install Folio';
      hint.textContent = 'Get faster access from your home screen.';
      btn.hidden = false;
      banner.classList.add('shown');
    });
    btn.addEventListener('click', async function(){
      if (!deferred) return;
      btn.disabled = true;
      try {
        deferred.prompt();
        const result = await deferred.userChoice;
        if (result && result.outcome === 'accepted') {
          banner.classList.remove('shown');
        }
      } catch (_e) {}
      deferred = null;
      btn.disabled = false;
    });
    dismiss.addEventListener('click', function(){
      banner.classList.remove('shown');
      try { sessionStorage.setItem('folio-install-dismissed', '1'); } catch (_e) {}
    });
    if (isIosSafari()) {
      // Defer slightly — gives any (rare) iOS install prompt a moment to
      // fire. On stock iOS Safari it never does, so the inline instructions
      // become the only path. Both URLs and PWA icon link to the same target.
      setTimeout(function(){
        if (deferred) return;
        title.textContent = 'Install Folio on this iPhone';
        hint.innerHTML = "Tap the <strong>Share</strong> icon below, then <strong>“Add to Home Screen”</strong>.";
        btn.hidden = true;
        banner.classList.add('shown');
      }, 250);
    }
    window.addEventListener('appinstalled', function(){
      banner.classList.remove('shown');
      try { sessionStorage.setItem('folio-install-dismissed', '1'); } catch (_e) {}
    });
    try {
      const mq = window.matchMedia('(display-mode: standalone)');
      const onChange = function(e){ if (e.matches) banner.classList.remove('shown'); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch (_e) {}
  })();

  // Debounced search input → server query.
  const q = document.getElementById('search');
  if (q) {
    let searchTimer = null;
    q.addEventListener('input', function () {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        const value = q.value.trim();
        if (value === '') {
          loadFeed({ thread: thread });
        } else {
          loadFeed({ query: value, thread: thread });
        }
      }, 250);
    });
  }
})();
`;

export function renderHome(publicUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f5f3ee">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Folio">
  <link rel="apple-touch-icon" href="/icons/folio.svg">
  <link rel="icon" href="/icons/folio.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.webmanifest">
  <title>Folio</title>
  <style>${PWA_CSS}</style>
</head>
<body>
  <div id="offline-banner" class="offline-banner hidden">Offline — showing cached notes.</div>
  <header class="top">
    <a href="/" style="text-decoration: none;"><span class="brand">folio<span class="dot">.</span></span></a>
    <span id="whoami" class="whoami" hidden></span>
    <span id="ctx"></span>
  </header>
  <main>
    <div id="install-banner" class="install-banner">
      <div class="txt">
        <strong id="install-title">Install Folio</strong>
        <small id="install-hint">Get faster access from your home screen.</small>
      </div>
      <button id="install-btn" class="install-btn" type="button" hidden>Install</button>
      <button id="install-dismiss" class="dismiss" type="button" aria-label="Dismiss install banner">Dismiss</button>
    </div>
    <input id="search" class="search" type="search" placeholder="filter notes…" autocomplete="off" autocapitalize="none">
    <div id="list" class="list">
      <div class="loading">Loading…</div>
    </div>
    <a href="#" id="add-device-link" class="add-device-link">+ Add another device</a>
    <div id="add-device-panel" class="add-device-panel">
      <h3>Pair a new device</h3>
      <p>Generate a one-shot 6-digit code, then enter it on the other device's pair screen (PWA <code>/pair</code> or local viewer <code>/cloud</code>) within 10 minutes.</p>
      <button id="gen-code-btn" class="gen" type="button">Generate code</button>
      <div id="gen-code-box" class="code-box" hidden>
        <div class="lbl">Pairing code</div>
        <div class="code" id="gen-code-value"></div>
        <div class="hint" id="gen-code-hint"></div>
      </div>
      <div id="gen-code-err" class="err"></div>
    </div>
  </main>
  <script>${APP_SHELL_BOOTSTRAP_JS}</script>
</body>
</html>`;
}

export function renderPair(publicUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f5f3ee">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <link rel="apple-touch-icon" href="/icons/folio.svg">
  <link rel="manifest" href="/manifest.webmanifest">
  <title>Pair · Folio</title>
  <style>${PWA_CSS}</style>
</head>
<body>
  <div class="pair-wrap">
    <h1>Pair with folio<span class="dot">.</span></h1>
    <p class="lead">${escapeHtml(new URL(publicUrl).host)}</p>
    <form id="pair-form" autocomplete="off">
      <label for="code">Pairing code</label>
      <input id="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autocomplete="off" autocapitalize="none">
      <label for="name">Device name</label>
      <input id="name" type="text" maxlength="64" required autocapitalize="none">
      <button id="submit" type="submit">Pair this device</button>
      <div id="err" class="err"></div>
    </form>
    <div class="tip">
      On the server, generate a fresh code with:<br>
      <code>sudo -u folio /opt/folio/folio cloud pair-code</code><br>
      Codes expire after 10 minutes.
    </div>
  </div>
  <script>${IDB_HELPERS_JS}</script>
  <script>
(function () {
  const ua = navigator.userAgent || '';
  // Build a friendly default name.
  let suggested = 'phone';
  if (/iPhone/i.test(ua)) suggested = 'iphone';
  else if (/iPad/i.test(ua)) suggested = 'ipad';
  else if (/Android/i.test(ua)) suggested = 'android';
  else if (/Macintosh/i.test(ua)) suggested = 'mac';
  document.getElementById('name').value = suggested;

  // Prefill the pairing code from the query string (?code=NNNNNN). Scanning the
  // QR — which encodes the full /pair?code=… URL — should pair without retyping
  // the 6 digits. Only accept an exact 6-digit code; anything else falls back to
  // manual entry. We never log the code.
  let autoCode = false;
  const codeParam = new URLSearchParams(location.search).get('code');
  if (codeParam && /^[0-9]{6}$/.test(codeParam)) {
    document.getElementById('code').value = codeParam;
    autoCode = true;
  }

  // Build a stable client-side device id (per-origin, persisted in IDB).
  function rndUlid() {
    // 26-char Crockford-base32 ULID-ish: simple time + random. Good enough
    // for cross-device unique on the cloud's notes.origin_device_id field.
    const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const ts = Date.now();
    let s = '';
    let t = ts;
    for (let i = 0; i < 10; i++) { s = A[t & 31] + s; t = Math.floor(t / 32); }
    const rnd = new Uint8Array(10);
    crypto.getRandomValues(rnd);
    for (let i = 0; i < 10; i++) s += A[rnd[i] & 31];
    return s + A[Math.floor(Math.random() * 32)] + A[Math.floor(Math.random() * 32)];
  }

  const form = document.getElementById('pair-form');
  const errEl = document.getElementById('err');
  const submit = document.getElementById('submit');
  function showErr(msg) {
    errEl.textContent = msg;
    errEl.classList.add('shown');
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    errEl.classList.remove('shown');
    submit.disabled = true;
    submit.textContent = 'Pairing…';

    Promise.all([window.folioKV.get('device_id'), Promise.resolve()]).then(function (vals) {
      let deviceId = vals[0];
      if (!deviceId) {
        deviceId = rndUlid();
      }
      const code = document.getElementById('code').value.trim();
      const name = document.getElementById('name').value.trim() || 'phone';
      return fetch('/v1/auth/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code, device_name: name, device_id: deviceId })
      })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
          return { body: body, deviceId: deviceId };
        });
      });
    }).then(function (out) {
      return Promise.all([
        window.folioKV.set('token', out.body.token),
        window.folioKV.set('device_id', out.deviceId),
        window.folioKV.set('paired_at', new Date().toISOString())
      ]);
    }).then(function () {
      window.location.href = '/';
    }).catch(function (e) {
      showErr(e.message || String(e));
      submit.disabled = false;
      submit.textContent = 'Pair this device';
    });
  });

  // Auto-pair when the code arrived via the QR URL — the device name is already
  // auto-filled, so the submit has everything it needs. If the code was already
  // used or expired (e.g. on reload), the normal #err handling surfaces it.
  if (autoCode) {
    form.requestSubmit();
  }
})();
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Bumped on layout/JS changes that need to invalidate PWA caches.
//   v1 → v2: fetchWithAuth fix
//   v2 → v3: nested-anchor fix + meta flex-wrap layout
//   v3 → v4: hide thread chip in note rows when viewing a single thread
//   v4 → v5: add-device panel on home so users can onboard new devices
//             without touching the cloud server
//   v5 → v6: install banner — beforeinstallprompt capture for Chrome/Edge,
//             inline Share → Add-to-Home-Screen instructions for iOS Safari
//   v6 → v7: asset URLs in /raw/ body_html rewritten to /u/<user>/t/.../asset/
//             so multi-user cloud serves the right bytes per user namespace.
//             Old cached /t/<thread>/asset/ URLs would 404 in multi-user
//             setups; bump SW invalidates the cache so the new rewrite path
//             takes over cleanly.
//   v7 → v8: "signed in as <display>" identity hint + sign-out link in the
//             top bar. Calls /v1/admin/whoami with bearer; sign-out clears
//             IDB + caches and redirects to /pair.
//   v8 → v9: iframe sandbox gains `allow-modals` so window.print() works
//             from inside notes. Cache bust so cached /n/:uuid shell picks
//             up the new sandbox attribute.
export const SW_VERSION = "folio-pwa-9";

export function serviceWorkerJs(): string {
  return `// Folio PWA service worker — auth injection + offline cache.
${IDB_HELPERS_JS.replace(/window\\.folioKV/g, "self.folioKV")}

const VERSION = ${JSON.stringify(SW_VERSION)};
const SHELL_CACHE = VERSION + '-shell';
const NOTES_CACHE = VERSION + '-notes';

const SHELL_PRECACHE = ['/', '/pair', '/manifest.webmanifest', '/icons/folio.svg'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) { return c.addAll(SHELL_PRECACHE).catch(function () {}); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (!k.startsWith(VERSION)) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function needsAuth(pathname) {
  if (pathname.startsWith('/v1/auth/pair')) return false;
  if (pathname === '/healthz' || pathname === '/v1/version') return false;
  if (pathname === '/manifest.webmanifest' || pathname === '/pair' || pathname === '/') return false;
  if (pathname === '/sw.js') return false;
  if (pathname.startsWith('/icons/')) return false;
  if (pathname.startsWith('/p/')) return false;
  return true;
}

async function fetchWithAuth(request) {
  if (request.method !== 'GET' || !needsAuth(new URL(request.url).pathname)) {
    return fetch(request);
  }
  const token = await self.folioKV.get('token');
  if (!token) return fetch(request); // server will 401 and shell handles it
  // Build a minimal request: just URL + Authorization + Accept. Do NOT
  // try to clone original headers — for navigation requests they include
  // Sec-Fetch-Mode: navigate and other client hints that some browsers
  // mishandle when SW reconstructs the Request. Also do NOT set mode:
  // 'cors' — defaults are fine for same-origin and avoid surprise behavior.
  const headers = { 'Authorization': 'Bearer ' + token };
  const accept = request.headers.get('accept');
  if (accept) headers['Accept'] = accept;
  return fetch(request.url, { method: 'GET', headers: headers });
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate for note content + theme assets.
  if (url.pathname.startsWith('/raw/') || url.pathname.startsWith('/themes/') || url.pathname.startsWith('/t/') || url.pathname.startsWith('/icons/')) {
    event.respondWith((async function () {
      const cache = await caches.open(NOTES_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetchWithAuth(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone()).catch(function () {});
        return res;
      }).catch(function () { return null; });
      return cached || (await networkPromise) || new Response('Offline', { status: 503 });
    })());
    return;
  }

  // Network-first for /n/:uuid + / + /pair + /v1/feed.
  if (url.pathname === '/' || url.pathname === '/pair' || url.pathname.startsWith('/n/') || url.pathname === '/v1/feed' || url.pathname === '/manifest.webmanifest') {
    event.respondWith((async function () {
      try {
        const res = await fetchWithAuth(req);
        if (res && res.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, res.clone()).catch(function () {});
        }
        return res;
      } catch (_e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
});
`;
}

// Icon SVG lives in src/core/brand.ts now — single source of truth for both
// the cloud PWA's apple-touch-icon + manifest, and the local viewer's
// favicon. Re-exported here so existing imports (server.ts) keep working.
export { FOLIO_ICON_SVG } from "../core/brand";

export function manifestJson(publicUrl: string): unknown {
  const u = new URL(publicUrl);
  return {
    name: "Folio",
    short_name: "Folio",
    description: "Visual communication layer between AI agents and humans",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f3ee",
    theme_color: "#f5f3ee",
    orientation: "portrait",
    icons: [
      { src: "/icons/folio.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/folio.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    id: u.host,
  };
}
