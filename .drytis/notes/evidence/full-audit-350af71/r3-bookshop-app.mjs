// R3 — realistic multi-page app for the full-capability audit @ 350af71.
// Exercises: recording (click/text/select/checkbox), resulting state of every
// derivable kind (counter/collection/status-badge/notification/entity),
// dialogs (alert/confirm), entity identity attrs, dynamic async content,
// navigation, repeated actions, network evidence (fetch/XHR/beacon),
// late-render healing target. Pure Node http — no deps.
import http from 'node:http';

const PORT = 8177;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const page = (title, body, script) => `<!doctype html><html><head><meta charset="utf-8">
<title>${title}</title>
<style>body{font-family:system-ui;margin:2rem;max-width:720px}button,input,select{font-size:1rem;margin:2px}
button{cursor:pointer}.badge{display:inline-block;padding:2px 8px;border-radius:10px;background:#eee}
.status-pill{background:#d4f7d4}.hidden{display:none}ul{list-style:none;padding:0}
li{border:1px solid #ccc;margin:4px 0;padding:8px;border-radius:4px}
[role=alert]{padding:8px;border:1px solid #2a2;background:#eaffea;margin:8px 0}</style></head><body>
${body}
<script>${script || ''}</script></body></html>`;

const PAGE_HOME = page('Bookshop — Home', `
<h1>Bookshop</h1>
<p>Cart: <span id="cart-count" data-count="0" aria-label="Cart items">0 items</span></p>
<form id="sf"><label for="q">Search books</label>
<input id="q" name="q" type="text" placeholder="tolstoy"><button type="submit" id="go">Search</button></form>
<div class="hidden" id="adv"><label><input type="checkbox" id="gift"> Gift wrap</label>
<label for="fmt">Format</label><select id="fmt"><option value="pb">Paperback</option><option value="hc">Hardcover</option><option value="au">Audio</option></select></div>
<button id="adv-toggle" aria-label="Advanced options">⚙</button>
<ul id="results" data-testid="results-list"></ul>
<div id="status-slot" aria-live="polite"></div>
`, `
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.__state = { results: [], gift: false, fmt: 'pb', cart: 0 };
document.getElementById('adv-toggle').addEventListener('click', () => {
  const a = document.getElementById('adv');
  a.classList.toggle('hidden');
  a.classList.contains('hidden') || document.getElementById('gift').focus();
});
document.getElementById('gift').addEventListener('change', (e) => { window.__state.gift = e.target.checked; });
document.getElementById('fmt').addEventListener('change', (e) => { window.__state.fmt = e.target.value; });
document.getElementById('sf').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value || 'all';
  const res = document.getElementById('results');
  res.innerHTML = '<li data-testid="result-item" class="skel">Searching…</li>';
  const r = await fetch('/api/search?q=' + encodeURIComponent(q));
  const books = await r.json();
  await sleep(400);
  res.innerHTML = '';
  for (const b of books) {
    const li = document.createElement('li');
    li.setAttribute('data-testid', 'result-item');
    li.setAttribute('data-sku', b.sku);
    li.innerHTML = '<b>' + b.title + '</b> <span class="badge status-pill" data-auto-id="stock-status">' + b.stock + '</span> <button data-sku-btn="' + b.sku + '" aria-label="Add ' + b.title + ' to cart">Add</button>';
    res.appendChild(li);
  }
});
document.getElementById('results').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sku-btn]');
  if (!btn) return;
  const sku = btn.getAttribute('data-sku-btn');
  window.__state.cart++;
  document.getElementById('cart-count').textContent = window.__state.cart + ' items';
  document.getElementById('cart-count').setAttribute('data-count', String(window.__state.cart));
  fetch('/api/cart/add', { method: 'POST', body: JSON.stringify({ sku }) })
    .then(r => r.json()).then(j => {
      const slot = document.getElementById('status-slot');
      slot.innerHTML = '';
      const alert = document.createElement('div');
      alert.setAttribute('role', 'alert');
      alert.setAttribute('aria-label', 'Cart updated');
      alert.textContent = j.msg + ' (order BW-' + Math.floor(Math.random() * 90000 + 10000) + ')';
      slot.appendChild(alert);
    });
});
`);

const PAGE_ORDER = page('Bookshop — Order', `
<h1>Place order</h1>
<p>Cart: <span id="cart-count" data-count="0" aria-label="Cart items">0 items</span></p>
<button id="place-order">Place order</button>
<button id="cancel-order">Cancel (confirm)</button>
<p id="order-slot"></p>
<div id="toast-slot"></div>
`, `
let n = 0;
document.getElementById('place-order').click; // noop guard
document.getElementById('place-order').addEventListener('click', () => {
  n++;
  document.getElementById('cart-count').textContent = n + ' items';
  document.getElementById('cart-count').setAttribute('data-count', String(n));
  alert('Order confirmed');
});
document.getElementById('cancel-order').addEventListener('click', () => {
  const ok = confirm('Discard order?');
  if (ok) { const t = document.createElement('div'); t.className = 'toast-message'; t.textContent = 'Order discarded'; document.getElementById('toast-slot').appendChild(t); }
});
`);

const BOOKS = [
  { sku: 'SKU-WAR', title: 'War and Peace', stock: 'In stock' },
  { sku: 'SKU-ANA', title: 'Anna Karenina', stock: 'In stock' },
  { sku: 'SKU-RES', title: 'Resurrection', stock: 'Low stock' },
];

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/search') {
    await sleep(250);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(BOOKS.filter((b) => !u.searchParams.get('q') || u.searchParams.get('q') === 'all' || b.title.toLowerCase().includes(u.searchParams.get('q').toLowerCase()))));
    return;
  }
  if (u.pathname === '/api/cart/add') {
    await sleep(300);
    let body = ''; for await (const c of req) body += c;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, msg: 'Added to cart' }));
    return;
  }
  if (u.pathname === '/order') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE_ORDER); return; }
  if (u.pathname === '/late') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page('Bookshop — Late', '<h1>Late page</h1><div id="late-slot"></div>', `
      setTimeout(() => { const d = document.createElement('div'); d.id = 'late-box'; d.textContent = 'Late content ' + Date.now(); document.getElementById('late-slot').appendChild(d); }, 1400);
    `));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE_HOME);
});
server.listen(PORT, '127.0.0.1', () => console.log('R3 bookshop on', PORT));
export { server, sleep };
