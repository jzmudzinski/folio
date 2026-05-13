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
header.top .brand { font-family: 'Instrument Serif', serif; font-style: italic; font-size: 22px; letter-spacing: -0.5px; }
header.top .brand b { font-family: 'Familjen Grotesk'; font-style: normal; font-weight: 700; color: var(--accent); }
header.top .meta { font-size: 12px; color: var(--muted); }
main { padding: 16px 20px 60px; max-width: 760px; margin: 0 auto; }
.empty, .loading { color: var(--muted); text-align: center; padding: 60px 20px; font-style: italic; font-family: 'Instrument Serif', serif; font-size: 18px; }
.offline-banner { background: #fff6d6; color: #5a4400; border-bottom: 1px solid var(--line); padding: 8px 20px; font-size: 13px; text-align: center; }
.offline-banner.hidden { display: none; }
.search { display: block; width: 100%; padding: 12px 14px; font-size: 16px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--ink); margin-bottom: 20px; -webkit-appearance: none; }
.search:focus { outline: 0; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.list { display: flex; flex-direction: column; gap: 2px; }
.note { display: block; padding: 14px 12px; border-radius: 10px; text-decoration: none; color: inherit; transition: background 120ms; min-height: 56px; }
.note:hover, .note:active { background: var(--bg-2); }
.note .title { font-size: 17px; font-weight: 500; line-height: 1.35; color: var(--ink); margin-bottom: 4px; }
.note .meta { font-size: 13px; color: var(--muted); display: flex; gap: 10px; align-items: center; }
.note .type { font-size: 11px; padding: 1px 6px; border: 1px solid var(--line); border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
.note .type.research { color: #0a6; border-color: rgba(0,170,102,0.3); }
.note .type.comparison { color: #963; border-color: rgba(153,102,51,0.3); }
.note .type.technical { color: #345; border-color: rgba(51,68,85,0.3); }
.note .type.journal { color: #864; border-color: rgba(136,102,68,0.3); }
.note .type.snippet { color: var(--muted); }
.note .ago { color: var(--muted-2); }
.note .thread { font-style: italic; font-family: 'Instrument Serif', serif; color: var(--muted); }
.group-h { font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted-2); padding: 18px 12px 8px; }

/* Pair page */
.pair-wrap { max-width: 420px; margin: 60px auto; padding: 20px; }
.pair-wrap h1 { font-family: 'Instrument Serif', serif; font-style: italic; font-weight: 400; font-size: 36px; letter-spacing: -1px; margin: 0 0 10px; }
.pair-wrap h1 b { font-family: 'Familjen Grotesk'; font-style: normal; font-weight: 700; color: var(--accent); }
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
  // Register service worker — sets up auth header injection + offline cache.
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

  function renderList(notes) {
    const root = document.getElementById('list');
    if (!notes || notes.length === 0) {
      root.innerHTML = '<div class="empty">No notes yet. Create one on your laptop and run <code>folio sync</code>.</div>';
      return;
    }
    // Group by date bucket.
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
      for (const n of arr) {
        html.push(
          '<a class="note" href="/n/' + encodeURIComponent(n.uuid) + '">' +
            '<div class="title">' + esc(n.title) + '</div>' +
            '<div class="meta">' +
              '<span class="type ' + esc(n.type) + '">' + esc(n.type) + '</span>' +
              '<span class="thread">' + esc(n.thread_id) + '</span>' +
              '<span class="ago">' + ago(n.created_at) + ' ago</span>' +
            '</div>' +
          '</a>'
        );
      }
    }
    root.innerHTML = html.join('');
  }

  // Boot: check token. If missing, redirect to /pair. Else fetch feed.
  window.folioKV.get('token').then(function (token) {
    if (!token) { window.location.href = '/pair'; return; }
    fetch('/v1/feed', { headers: { Authorization: 'Bearer ' + token } })
      .then(function (r) {
        if (r.status === 401) { window.location.href = '/pair'; throw new Error('unauthorized'); }
        if (!r.ok) throw new Error('feed: HTTP ' + r.status);
        return r.json();
      })
      .then(function (body) { renderList(body.notes || []); })
      .catch(function (e) {
        const root = document.getElementById('list');
        if (root) root.innerHTML = '<div class="empty">Could not load: ' + esc(e.message) + '</div>';
      });
  });

  // Search: filter currently visible items by title substring (client-side).
  const q = document.getElementById('search');
  if (q) {
    q.addEventListener('input', function () {
      const needle = q.value.trim().toLowerCase();
      const items = document.querySelectorAll('#list .note');
      items.forEach(function (el) {
        const title = el.querySelector('.title');
        const visible = !needle || (title && title.textContent.toLowerCase().indexOf(needle) >= 0);
        el.style.display = visible ? '' : 'none';
      });
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
    <span class="brand">folio<b>.</b></span>
    <span class="meta">${escapeHtml(new URL(publicUrl).host)}</span>
  </header>
  <main>
    <input id="search" class="search" type="search" placeholder="filter notes…" autocomplete="off" autocapitalize="none">
    <div id="list" class="list">
      <div class="loading">Loading…</div>
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
    <h1>Pair with <b>folio</b></h1>
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
})();
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const SW_VERSION = "folio-pwa-1";

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
  const headers = new Headers(request.headers);
  headers.set('Authorization', 'Bearer ' + token);
  return fetch(new Request(request.url, {
    method: request.method,
    headers: headers,
    credentials: 'omit',
    mode: 'cors',
    cache: 'no-store'
  }));
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

export const FOLIO_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none">
  <rect width="512" height="512" rx="96" fill="#f5f3ee"/>
  <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle"
        font-family="'Familjen Grotesk', 'Helvetica Neue', system-ui, sans-serif"
        font-weight="700" font-size="320" fill="#ff5a1f">F</text>
  <text x="64%" y="78%" dominant-baseline="middle" text-anchor="middle"
        font-family="'Instrument Serif', 'Times New Roman', serif"
        font-style="italic" font-weight="400" font-size="180" fill="#0a0a0a">.</text>
</svg>`;

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
