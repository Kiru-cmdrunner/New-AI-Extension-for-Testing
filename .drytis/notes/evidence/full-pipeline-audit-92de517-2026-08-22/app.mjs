// Generic multi-pattern validation app — 2026-08-21 6A+6C pre-implementation cycle.
//
// NOT a site clone. Three distinct generic application patterns, each stressing a
// different family of real-world conventions. No AdaniOne/Amazon tokens.
//
//   P-CLASSIC  — classic server-rendered app: plain #id inputs/buttons, native
//                <select>, <table>, zero framework, id-only counters (no
//                data-* attrs, no aria where a plain app wouldn't have it).
//   P-REACTISH — React/Vue-style SPA: className-only elements, controlled
//                input that REWRITES user text on commit (the 6C divergence
//                case: type "Sat, 22 Aug" → app commits "Sat, 05 Sep"),
//                debounced typeahead, virtual-ish list, state badges with
//                generic class names.
//   P-SHOP     — vanilla e-commerce page: cart list, quantity steppers,
//                total, aria-labeled icon buttons, id-less product cards
//                keyed by href/query, toasts.
//
// Each page serves the SAME workflow shape (search → refine/commit → observe
// state change → navigate → change quantity → observe totals) so per-pattern
// deltas in capture/understanding/generation are attributable to the pattern,
// not the workflow.
import http from 'node:http';

const PORT = 8177;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const CSS = `
*{box-sizing:border-box}body{font-family:system-ui;margin:0;color:#111}
header{display:flex;align-items:center;gap:1rem;padding:.6rem 1.2rem;background:#233;color:#fff}
header a{color:#fff;text-decoration:none;font-size:.95rem;cursor:pointer}
main{max-width:860px;margin:0 auto;padding:1.1rem}
label{display:block;font-size:.85rem;margin:.5rem 0 .15rem;color:#445}
input,select{font-size:1rem;padding:.45rem;border:1px solid #ccd;border-radius:6px;width:100%}
button{font-size:.95rem;padding:.45rem .9rem;border:1px solid #ccd;border-radius:6px;background:#fff;cursor:pointer}
button.primary{background:#0b6;border-color:#0b6;color:#fff}
table{border-collapse:collapse;width:100%;margin:.6rem 0}
td,th{border:1px solid #dde;padding:.45rem .6rem;text-align:left;font-size:.92rem}
.card{border:1px solid #dde;border-radius:8px;padding:.7rem .9rem;margin:.5rem 0;display:flex;gap:1rem;align-items:center}
.qty{display:grid;grid-template-columns:34px 1fr 34px;gap:.4rem;align-items:center}
.qty button{width:34px;height:34px;padding:0;display:grid;place-items:center}
.total{font-size:1.1rem;font-weight:600;margin:.8rem 0}
.toast{position:fixed;bottom:14px;right:14px;background:#233;color:#fff;padding:.6rem 1rem;border-radius:8px}
.badge{margin-left:auto;font-weight:600}
.muted{color:#778;font-size:.8rem}
[hidden]{display:none !important}
`;

// ─────────────────────────────────────────────────────────────
// P-CLASSIC: server-rendered feel, #id everywhere, NO data-* attrs.
// Counters/labels rely on element #id only (the O8 selector-widening gap).
// ─────────────────────────────────────────────────────────────
function classicPage() {
  return `<!doctype html><html><head><title>Classic Desk</title><style>${CSS}</style></head>
<body>
<header><strong>Classic Desk</strong><a data-route="/shop">Shop</a><a data-route="/reactish">Modern</a></header>
<main>
  <h3>Support ticket search</h3>
  <label for="q">Keyword</label>
  <input id="q" name="q" placeholder="e.g. invoice" data-auto-id="search-input">
  <label for="prio">Priority</label>
  <select id="prio" name="prio">
    <option value="">Any</option><option value="low">Low</option>
    <option value="high">High</option><option value="urgent">Urgent</option>
  </select>
  <button id="btn-search" class="primary" data-cy="search-btn">Search</button>
  <p class="muted" id="result-count">0 tickets</p>
  <table id="results"><thead><tr><th>Ticket</th><th>Subject</th><th>Status</th></tr></thead>
  <tbody></tbody></table>
  <div id="status-line" class="muted">Ready</div>
</main>
<script>
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const TICKETS = [
  {id:'T-101', s:'Invoice not generated', st:'open', p:'high'},
  {id:'T-102', s:'Refund pending', st:'open', p:'urgent'},
  {id:'T-103', s:'Address change', st:'closed', p:'low'},
  {id:'T-104', s:'Invoice mismatch', st:'open', p:'high'},
  {id:'T-105', s:'Duplicate charge', st:'closed', p:'urgent'},
];
window.__renderedRows = 0;
function rows(prio){ return prio ? TICKETS.filter(t=>t.p===prio) : TICKETS; }
function run(){
  const prio = document.getElementById('prio').value;
  const out = rows(prio);
  document.querySelector('#results tbody').innerHTML =
    out.map(t=>'<tr><td>'+t.id+'</td><td>'+t.s+'</td><td>'+t.st+'</td></tr>').join('');
  document.getElementById('result-count').textContent = out.length + ' tickets';
  window.__renderedRows = out.length;
}
document.getElementById('btn-search').addEventListener('click', async () => {
  document.getElementById('status-line').textContent = 'Searching…';
  await delay(150);
  run();
  document.getElementById('status-line').textContent = 'Search complete';
});
function nav(route){ history.pushState({}, '', route); location.hash=''; window.__route=route; renderRoute(); }
document.querySelectorAll('header a').forEach(a=>a.addEventListener('click', e=>{e.preventDefault();nav(a.dataset.route);}));
window.addEventListener('popstate', renderRoute);
function renderRoute(){ /* single-page shell; classic pattern keeps all in one page */ }
</script></body></html>`;
}

// ─────────────────────────────────────────────────────────────
// P-REACTISH: className-only elements; controlled input REWRITES typed text
// on commit (type "Sat, 22 Aug" → commits "Sat, 05 Sep"); debounced
// typeahead; hydration-style re-render; state badge with generic classes.
// ─────────────────────────────────────────────────────────────
function reactishPage() {
  return `<!doctype html><html><head><title>Modern Portal</title><style>${CSS}</style></head>
<body>
<header><strong>Modern Portal</strong><a data-route="/" class="nav-link">Desk</a><a data-route="/shop" class="nav-link">Shop</a></header>
<main id="app">
  <div class="skel" style="height:120px"></div>
</main>
<script>
// "SSR shell" then hydration-style swap
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => {
  document.getElementById('app').innerHTML = \`
    <h3 class="form-title">Trip planner</h3>
    <div class="field">
      <label class="field-label">Departure date</label>
      <input class="field-input date-input" placeholder="Choose a date">
    </div>
    <div class="field">
      <label class="field-label">From</label>
      <input class="field-input origin-input" placeholder="Type a city">
      <ul class="options-list" hidden></ul>
    </div>
    <button class="btn btn-primary commit-btn">Plan trip</button>
    <p class="state-badge state-pill" data-state="idle">Idle</p>
    <div class="trips"></div>\`;
  wire();
}, 350);

const CITIES = ['Mumbai','Bengaluru','Delhi','Chennai','Hyderabad'];
function wire(){
  // Controlled-input divergence: user types a date, app REWRITES it on blur.
  const dateEl = document.querySelector('.date-input');
  dateEl.addEventListener('input', () => {});
  dateEl.addEventListener('blur', () => {
    // App normalizes any typed date to the next available departure (Sep 5).
    dateEl.value = 'Sat, 05 Sep';
  });
  // Debounced typeahead
  const originEl = document.querySelector('.origin-input');
  const listEl = document.querySelector('.options-list');
  let t; originEl.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      await delay(60);
      if (!originEl.value.trim()) { listEl.hidden = true; return; }
      fetch('/api/cities?q=' + encodeURIComponent(originEl.value.trim())).then(r => r.json()).then(list => {
        listEl.innerHTML = list.map((c,i)=>'<li class="opt" data-idx="'+i+'">'+c+'</li>').join('');
        listEl.hidden = !list.length;
      });
    }, 250);
  });
  listEl.addEventListener('click', (e)=>{ if(e.target.classList.contains('opt')){ originEl.value = e.target.textContent; listEl.hidden = true; } });
  // Typeahead commit: app overwrites the typed query with the chosen city label
  // (canonical controlled-input divergence — user intent is the typed prefix).
  // Rewrite BEFORE the blur value is read (capture-phase, ahead of focus shift) —
  // mirrors real controlled components that normalize during the commit path.
  window.addEventListener('mousedown', (e) => {
    if (e.target instanceof Element && e.target.classList.contains('opt')) {
      const v = originEl.value.trim();
      const exact = CITIES.find(c => c.toLowerCase().startsWith(v.toLowerCase()));
      if (v && exact) originEl.value = exact;
    }
  }, true);
  // Commit: badge flips through pending→planned, trips render
  document.querySelector('.commit-btn').addEventListener('click', async () => {
    const badge = document.querySelector('.state-badge');
    badge.setAttribute('data-state','pending'); badge.textContent='Planning…';
    await delay(400);
    badge.setAttribute('data-state','planned'); badge.textContent='Trip planned';
    document.querySelector('.trips').innerHTML =
      '<div class="card"><span>Trip A</span><span class="badge">6E-5233</span></div>'+
      '<div class="card"><span>Trip B</span><span class="badge">AI-887</span></div>';
  });
}
function nav(route){ history.pushState({}, '', route); window.__route=route; renderRoute(); }
document.querySelectorAll('header a').forEach(a=>a.addEventListener('click', e=>{e.preventDefault();nav(a.dataset.route);}));
window.addEventListener('popstate', renderRoute);
function renderRoute(){ /* hydration shell swaps below */ }
</script></body></html>`;
}

// ─────────────────────────────────────────────────────────────
// P-SHOP: cart with steppers, aria-labeled icon buttons, id-less cards,
// toasts, totals; native form controls where a plain shop would use them.
// ─────────────────────────────────?????───────────────────────
function shopPage() {
  return `<!doctype html><html><head><title>Corner Shop</title><style>${CSS}</style></head>
<body>
<header><strong>Corner Shop</strong><span class="cart-count" aria-label="Cart items">0</span><button aria-label="Open filters" class="icon-filter" style="border:none;background:none;font-size:1.1rem">✚</button><a data-route="/" class="nav-link">Desk</a></header>
<main>
  <h3>Cart</h3>
  <div class="products">
    <div class="card" data-sku="SKU-A"><div><strong>Notebook</strong><div class="muted">SKU-A</div></div>
      <div class="qty"><button aria-label="Decrease quantity of Notebook" class="step-down">−</button>
      <span class="qty-value">1</span>
      <button aria-label="Increase quantity of Notebook" class="step-up" data-testid="qty-up-notebook">+</button></div>
    </div>
    <div class="card" data-sku="SKU-B"><div><strong>Pen set</strong><div class="muted">SKU-B</div></div>
      <div class="qty"><button aria-label="Decrease quantity of Pen set" class="step-down">−</button>
      <span class="qty-value">1</span>
      <button aria-label="Increase quantity of Pen set" class="step-up">+</button></div>
    </div>
  </div>
  <div class="total" id="cart-total">Total ₹ 0</div>
  <button id="checkout" class="primary">Checkout</button>
</main>
<script>
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const cart = { 'SKU-A': 1, 'SKU-B': 1 };
const PRICE = { 'SKU-A': 120, 'SKU-B': 80 };
function render(){
  let total = 0, count = 0;
  for (const [sku, q] of Object.entries(cart)) { total += PRICE[sku]*q; count += q; }
  document.querySelector('.cart-count').textContent = String(count);
  document.getElementById('cart-total').textContent = 'Total ₹ ' + total;
  document.querySelectorAll('.card').forEach(c=>{
    c.querySelector('.qty-value').textContent = String(cart[c.dataset.sku]);
  });
  window.__cartTotal = total; window.__cartCount = count;
}
document.querySelectorAll('.step-up').forEach(b=>b.addEventListener('click', async () => {
  const sku = b.closest('.card').dataset.sku; cart[sku]++;
  render();
  await delay(80);
  toast('Added ' + sku);
}));
document.querySelectorAll('.step-down').forEach(b=>b.addEventListener('click', () => {
  const sku = b.closest('.card').dataset.sku; cart[sku] = Math.max(0, cart[sku]-1); render();
}));
function toast(msg){
  const t = document.createElement('div'); t.className='toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(), 1500);
}
document.getElementById('checkout').addEventListener('click', async () => {
  toast('Order placed');
  document.getElementById('cart-total').textContent = 'Total ₹ 0';
  cart['SKU-A']=0; cart['SKU-B']=0; render();
});
function nav(route){ history.pushState({}, '', route); window.__route=route; renderRoute(); }
document.querySelectorAll('header a').forEach(a=>a.addEventListener('click', e=>{e.preventDefault();nav(a.dataset.route);}));
window.addEventListener('popstate', renderRoute);
function renderRoute(){ /* static page per route in this pattern */ }
</script></body></html>`;
}

const ROUTES = { '/': classicPage, '/reactish': reactishPage, '/shop': shopPage };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/cities') {
    await delay(120);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(['Bengaluru', 'Belagavi', 'Bhopal', 'Chennai'].filter(c => !url.searchParams.get('q') || c.toLowerCase().includes(url.searchParams.get('q').toLowerCase()))));
    return;
  }
  const page = ROUTES[url.pathname] ?? classicPage;
  await delay(30);
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page());
}).listen(PORT, () => console.log('multi-pattern app on :' + PORT));
