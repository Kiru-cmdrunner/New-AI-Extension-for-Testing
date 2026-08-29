// AdaniOne-TECH clone — reproduces confirmed technical characteristics of
// www.adanione.com (Next.js 14.2.35 App Router patterns), generic content.
// Characteristics emulated (all evidenced — see note adanione-site-access-blocked):
//  1. SSR HTML + React-style hydration swap (grid re-rendered client-side ~300ms)
//  2. Late-injected async widget bundle (script tag → builds search UI ~700ms)
//  3. self.__next_f-style late content push
//  4. data-auto-id attribute convention (their own test-ID scheme)
//  5. Icon-only buttons whose accessible name is only aria-label
//  6. Skeleton loaders → fetched content swap (900ms)
//  7. Debounced typeahead (400ms) + AJAX option list (dynamic click targets)
//  8. Soft navigation: history.pushState client router (no MPA nav)
//  9. Analytics beacon noise (GTM/webengage-style /collect fetches)
// 10. Separate asset host for the widget script (assets.clone.local)
import http from 'node:http';

const PORT = 8166;
const AIRPORTS = [
  { code: 'BOM', city: 'Mumbai' }, { code: 'BLR', city: 'Bengaluru' },
  { code: 'DEL', city: 'Delhi' }, { code: 'MAA', city: 'Chennai' },
  { code: 'HYD', city: 'Hyderabad' }, { code: 'PNQ', city: 'Pune' },
];
const FLIGHTS = [
  { id: 'F1', no: '6E-5233', dep: '07:40', arr: '09:55', price: 4120 },
  { id: 'F2', no: 'AI-887', dep: '10:15', arr: '12:30', price: 5380 },
  { id: 'F3', no: 'QP-1478', dep: '14:05', arr: '16:20', price: 3890 },
];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const shellHead = `<style>
*{box-sizing:border-box}body{font-family:system-ui;margin:0;color:#111}
header{display:flex;align-items:center;gap:1rem;padding:.7rem 1.2rem;background:#0b1f4b;color:#fff;position:sticky;top:0}
header a{color:#fff;text-decoration:none;font-size:.95rem}
.badge{position:relative;margin-left:auto;cursor:pointer}
.badge .count{position:absolute;top:-8px;right:-10px;background:#e87;border-radius:9px;font-size:.72rem;padding:1px 5px}
main{max-width:880px;margin:0 auto;padding:1.2rem}
.svc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.7rem;margin:1rem 0}
.svc{border:1px solid #dde;padding:.8rem;border-radius:8px;text-align:center}
input{font-size:1rem;padding:.5rem;border:1px solid #ccd;border-radius:6px;width:100%}
button{font-size:.95rem;padding:.45rem .9rem;border:1px solid #ccd;border-radius:6px;background:#fff;cursor:pointer}
button.primary{background:#0b6;border-color:#0b6;color:#fff}
ul.opts{list-style:none;margin:.2rem 0;padding:0;border:1px solid #dde;border-radius:6px;position:absolute;background:#fff;z-index:5}
ul.opts li{padding:.5rem .8rem;cursor:pointer}
ul.opts li:hover{background:#eef}
.skel{height:64px;border-radius:8px;background:linear-gradient(90deg,#eee 25%,#f7f7f7 50%,#eee 75%);background-size:200% 100%;animation:w 1.2s infinite;margin:.6rem 0}
@keyframes w{to{background-position:-200% 0}}
.flight{display:flex;align-items:center;gap:1rem;border:1px solid #dde;border-radius:8px;padding:.8rem 1rem;margin:.6rem 0}
.extras-panel{margin:.4rem 0 0 0;padding:.7rem;border:1px dashed #bbc;border-radius:8px}
.qty{display:flex;align-items:center;gap:.7rem}
.qty button{width:34px;height:34px;padding:0;display:grid;place-items:center}
.total{font-size:1.15rem;font-weight:600;margin:.9rem 0}
.f-right{margin-left:auto;font-weight:600}
[hidden]{display:none !important}
</style>`;

const hydrateAndRouter = `
// analytics noise (GTM/webengage-style beacons)
function beacon(e, extra){ fetch('/collect?e=' + e + (extra ? '&' + extra : ''), {keepalive:true}).catch(()=>{}); }
document.addEventListener('click', (ev) => { const b = ev.target.closest('button,a'); if (b) beacon('click', 't=' + encodeURIComponent(b.getAttribute('data-auto-id') || b.tagName)); }, true);

// soft client router (Next.js-style: pushState + re-render, no document load)
async function softNav(path){
  history.pushState({}, '', path);
  beacon('navigate', 'path=' + encodeURIComponent(path));
  await renderRoute();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[data-soft]');
  if (!a) return; ev.preventDefault(); softNav(a.getAttribute('href'));
});
window.addEventListener('popstate', renderRoute);

// __next_f-style late content push (App-Router streaming emulation)
self.__next_f = self.__next_f || [];
__next_f.push([1, "late-fragment"]);

const cart = { items: {} };
function bumpBadge(){ const n = Object.values(cart.items).reduce((s,q)=>s+q,0);
  const c = document.querySelector('[data-auto-id="cart-count"]'); if (c) c.textContent = String(n);
  const b = document.querySelector('[data-auto-id="cart-badge"]'); if (b) b.setAttribute('data-count', String(n)); }

// home hydration swap: grid re-rendered ~300ms after load (React takeover)
setTimeout(() => {
  const g = document.querySelector('[data-auto-id="services-grid"]');
  if (g) { const html = g.innerHTML; g.innerHTML = ''; requestAnimationFrame(()=>{ g.innerHTML = html; }); }
}, 300);

// late async widget bundle from separate asset host (assets.clone.local → same origin here)
setTimeout(() => { const s = document.createElement('script'); s.src = '/widget/search.js'; document.head.appendChild(s); }, 700);

// debounced typeahead
let t = null, ctx = null;
function wireTypeahead(inputId, listId, which){
  const inp = document.getElementById(inputId); if (!inp) return;
  inp.addEventListener('input', () => {
    clearTimeout(t); ctx = which;
    t = setTimeout(async () => {
      const q = inp.value.trim(); if (!q) return;
      const r = await fetch('/api/airports?q=' + encodeURIComponent(q)); const data = await r.json();
      const ul = document.getElementById(listId); ul.innerHTML = '';
      data.forEach((a, i) => { const li = document.createElement('li');
        li.setAttribute('data-auto-id', 'airport-opt-' + i); li.setAttribute('role','option');
        li.textContent = a.code + ' — ' + a.city;
        li.addEventListener('click', () => { inp.value = a.code; inp.setAttribute('data-city', a.city); ul.hidden = true; beacon('airport_selected'); });
        ul.appendChild(li); });
      ul.hidden = false;
    }, 400);
  });
}

async function api(path){ const r = await fetch(path); return r.json(); }

async function renderRoute(){
  const main = document.getElementById('app-root');
  const path = location.pathname + location.search;
  bumpBadge();
  if (path.startsWith('/cart')) { await renderCart(main); }
  else if (path.startsWith('/flights')) { await renderFlights(main); }
  else { await renderHome(main); }
}

async function renderHome(main){
  main.innerHTML = '<h1>One-stop travel &amp; shopping</h1>' +
    '<div class="svc-grid" data-auto-id="services-grid">' +
    ['Flight booking','Duty free','Lounges','Flight status'].map(s => '<div class="svc" data-auto-id="svc-' + s.toLowerCase().replace(/\\W+/g,'-') + '">' + s + '</div>').join('') +
    '</div><div id="search-root"><p>Loading search…</p></div>';
  bumpBadge();
}

async function renderFlights(main){
  const u = new URLSearchParams(location.search);
  main.innerHTML = '<h1>Flights ' + (u.get('from')||'—') + ' → ' + (u.get('to')||'—') + '</h1>' +
    '<div id="flights-root"><div class="skel" data-auto-id="skel-0"></div><div class="skel" data-auto-id="skel-1"></div><div class="skel" data-auto-id="skel-2"></div></div>';
  await delay(900); // skeleton → fetched content swap
  const root = document.getElementById('flights-root'); if (!root) return; // user left
  root.innerHTML = FLIGHTS.map(f =>
    '<div class="flight" data-auto-id="flight-' + f.id + '">' +
      '<div><strong>' + f.no + '</strong><br><small>' + f.dep + ' – ' + f.arr + '</small></div>' +
      '<div class="f-right">₹' + f.price + '</div>' +
      '<button data-auto-id="extras-' + f.id + '" aria-label="Add extras for flight ' + f.no + '">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="#456"/><path d="M8 5v6M5 8h6" stroke="#456"/></svg>' +
      '</button>' +
      '<div class="extras-panel" data-auto-id="extras-panel-' + f.id + '" hidden>' +
        '<button class="primary" data-auto-id="add-meal-' + f.id + '" aria-label="Add meal to flight ' + f.no + '">Add meal ₹450</button>' +
      '</div>' +
    '</div>').join('');
  root.querySelectorAll('[data-auto-id^="extras-F"]').forEach(btn => {
    const id = btn.getAttribute('data-auto-id').replace('extras-','');
    btn.addEventListener('click', () => {
      const p = document.querySelector('[data-auto-id="extras-panel-' + id + '"]');
      if (p) p.hidden = !p.hidden;
    });
    const addBtn = () => {
      const meal = document.querySelector('[data-auto-id="add-meal-' + id + '"]');
      if (!meal) return; meal.addEventListener('click', async () => {
        meal.disabled = true;
        const r = await fetch('/api/cart/add', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({sku:'MEAL', qty:1})});
        const d = await r.json();
        cart.items['MEAL'] = (cart.items['MEAL']||0) + 1;
        bumpBadge();
        const st = document.querySelector('[data-auto-id="meal-status-' + id + '"]'); if (st) st.hidden = false;
        // SECOND delayed state change (1.2s) — quiescence/settle stressor
        setTimeout(() => { const s2 = document.querySelector('[data-auto-id="meal-late-' + id + '"]'); if (s2) s2.hidden = false; }, 1200);
        meal.disabled = false;
      });
    }; addBtn();
  });
}

async function renderCart(main){
  const seed = new URLSearchParams(location.search).get('seed');
  main.innerHTML = '<h1>Your selections</h1><div id="cart-root"><div class="skel"></div></div>';
  const data = await api('/api/cart' + (seed ? '?seed=' + seed : ''));
  if (seed) data.items.forEach(it => cart.items[it.sku] = it.qty);
  const root = document.getElementById('cart-root'); if (!root) return;
  const skus = Object.keys(cart.items);
  const rows = skus.map(sku =>
    '<div class="flight" data-auto-id="cart-item-' + sku + '" data-sku="' + sku + '">' +
      '<div>' + (sku === 'MEAL' ? 'In-flight meal' : sku) + '</div>' +
      '<div class="qty" style="margin-left:auto">' +
        '<button data-auto-id="qty-minus-' + sku + '" aria-label="Decrease quantity of ' + sku + '">−</button>' +
        '<span data-auto-id="qty-' + sku + '">' + cart.items[sku] + '</span>' +
        '<button data-auto-id="qty-plus-' + sku + '" aria-label="Increase quantity of ' + sku + '">+</button>' +
      '</div>' +
    '</div>').join('');
  const total = Object.values(cart.items).reduce((s,q)=>s+q,0);
  root.innerHTML = (rows || '<p data-auto-id="cart-empty">Nothing here yet.</p>') +
    '<div class="total">Total items: <span data-auto-id="cart-total">' + total + '</span></div>' +
    '<span data-auto-id="meal-status-CART" hidden>Meal added to your trip.</span>';
  bumpBadge();
  root.querySelectorAll('[data-auto-id^="qty-plus-"]').forEach(btn => {
    const sku = btn.getAttribute('data-auto-id').replace('qty-plus-','');
    btn.addEventListener('click', async () => {
      cart.items[sku] = (cart.items[sku]||0) + 1;
      const q = document.querySelector('[data-auto-id="qty-' + sku + '"]'); if (q) q.textContent = String(cart.items[sku]);
      const r = await fetch('/api/cart/qty', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({sku, qty: cart.items[sku]})});
      await r.json();
      const total = Object.values(cart.items).reduce((s,q2)=>s+q2,0);
      const el = document.querySelector('[data-auto-id="cart-total"]'); if (el) el.textContent = String(total);
      bumpBadge();
    });
  });
}

renderRoute();
`;

const header = `<header>
<a href="/" data-soft data-auto-id="nav-home">Home</a>
<a href="/flights" data-soft data-auto-id="nav-flights">Flights</a>
<a href="/cart" data-soft data-auto-id="nav-cart-link">Cart</a>
<span class="badge" data-auto-id="cart-badge" data-count="0" role="button" aria-label="Cart items">
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4h2l2 10h9l2-7H6" fill="none" stroke="#fff" stroke-width="1.6"/></svg>
  <span class="count" data-auto-id="cart-count">0</span>
</span>
</header>`;

const page = (title, bodyExtra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>${shellHead}${bodyExtra}</head>
<body>${header}<main id="app-root"></main>
<script>const AIRPORTS = ${JSON.stringify(AIRPORTS)}; const FLIGHTS = ${JSON.stringify(FLIGHTS)}; const delay = (ms) => new Promise((r) => setTimeout(r, ms));
${hydrateAndRouter}</script></body></html>`;

const widgetJs = `// async "widget bundle" — builds the search UI late into #search-root
(function () {
  const root = document.getElementById('search-root'); if (!root) return;
  root.innerHTML =
    '<label>From <input id="origin" data-auto-id="search-origin" autocomplete="off" placeholder="City or code"/></label>' +
    '<ul class="opts" id="origin-opts" data-auto-id="origin-options" role="listbox" hidden></ul>' +
    '<label style="display:block;margin-top:.6rem">To <input id="dest" data-auto-id="search-dest" autocomplete="off" placeholder="City or code"/></label>' +
    '<ul class="opts" id="dest-opts" data-auto-id="dest-options" role="listbox" hidden></ul>' +
    '<button class="primary" id="go" data-auto-id="search-flights" style="margin-top:.8rem">Search flights</button>';
  document.getElementById('go').addEventListener('click', () => {
    const f = document.getElementById('origin').value, t = document.getElementById('dest').value;
    softNav('/flights?from=' + encodeURIComponent(f) + '&to=' + encodeURIComponent(t));
  });
  wireTypeahead('origin', 'origin-opts', 'from');
  wireTypeahead('dest', 'dest-opts', 'to');
})();`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/widget/search.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(widgetJs); }
  if (u.pathname === '/collect') return json({ ok: true });
  if (u.pathname === '/api/airports') { await delay(250); const q = (u.searchParams.get('q') || '').toLowerCase();
    return json(AIRPORTS.filter(a => a.code.toLowerCase().includes(q) || a.city.toLowerCase().includes(q)).slice(0, 4)); }
  if (u.pathname === '/api/flights') { await delay(900); return json(FLIGHTS); }
  if (u.pathname === '/api/cart/add') { await delay(500); return json({ ok: true, sku: 'MEAL', qty: 1 }); }
  if (u.pathname === '/api/cart/qty') { await delay(600); return json({ ok: true }); }
  if (u.pathname === '/api/cart') { const seed = Number(u.searchParams.get('seed') || 0);
    await delay(400);
    return json({ items: seed ? [{sku:'SKU-A',qty:1},{sku:'SKU-B',qty:1},{sku:'SKU-C',qty:1}] : [] }); }
  if (u.pathname.startsWith('/flights')) { res.writeHead(200, {'content-type':'text/html'}); return res.end(page('Flights — One Travel')); }
  if (u.pathname.startsWith('/cart')) { res.writeHead(200, {'content-type':'text/html'}); return res.end(page('Cart — One Travel')); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(page('One Travel — Home'));
}).listen(PORT, '127.0.0.1', () => console.log('clone on', PORT));
