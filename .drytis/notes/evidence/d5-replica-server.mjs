// Replica shop app for D4 real-Chrome validation (same shape as D7/D6 harness replica).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8098;
const dir = path.dirname(new URL(import.meta.url).pathname);

const page = (title, body) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;margin:2rem}.item{padding:.5rem;border:1px solid #ccc;margin:.25rem 0;border-radius:4px}
#suggestions div{padding:.4rem;cursor:pointer;background:#f5f5f5;margin:.15rem 0}</style></head>
<body>${body}<script>
// 1 Hz heartbeat noise (same as D7 replica — ambient timer ticks)
setInterval(()=>{window.__hb=(window.__hb||0)+1;},1000);
</script></body></html>`;

const routes = {
  '/': () => page('Shop', `<h1>Shop Replica</h1>
<form id="searchform" action="/search.html" method="get"><input id="twotabsearchtextbox" name="q" placeholder="Search products"></form>
<div id="suggestions"></div>
<script>
const inp=document.getElementById('twotabsearchtextbox');
const sug=document.getElementById('suggestions');
inp.addEventListener('input',()=>{
  sug.innerHTML='';
  ['wireless headphones','gaming mouse'].filter(s=>inp.value && s.toLowerCase().includes(inp.value.toLowerCase())).forEach(t=>{
    const d=document.createElement('div');d.textContent=t;
    d.addEventListener('click',()=>{location.href='/search.html?q='+encodeURIComponent(t);});
    sug.appendChild(d);});
});
</script>`),
  '/search.html': (q) => page('Search', `<h1>Results for "${q || ''}"</h1>
<a id="p100" href="/product.html?id=P100"><div class="item"><b>Aurora Wireless Headphones</b><br>$89.99</div></a>
<a id="p200" href="/product.html?id=P200"><div class="item"><b>Nimbus Gaming Mouse</b><br>$49.99</div></a>`),
  '/product.html': (id) => page('Product', `<h1>${id === 'P200' ? 'Nimbus Gaming Mouse' : 'Aurora Wireless Headphones'}</h1>
<p>$${id === 'P200' ? '49.99' : '89.99'}</p>
<form action="/cart.html" method="post"><input type="hidden" name="id" value="${id}">
<button id="add-to-cart-button" type="submit">Add to cart</button></form>`),
  '/cart.html': () => page('Cart', `<h1>Cart</h1><div class="item">Aurora Wireless Headphones ×1 — added ✓</div>
<a href="/">Continue shopping</a>`),
};

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  console.log(`[srv] ${req.method} ${u.pathname}${u.search}`);
  if (u.pathname === '/cart.html' && req.method === 'POST') {
    res.writeHead(302, { Location: '/cart.html?added=P100' }); res.end(); return;
  }
  const handler = routes[u.pathname];
  if (handler) { res.writeHead(200, {'Content-Type':'text/html'}); res.end(page2html(handler, u.searchParams.get('q'), u.searchParams.get('id'))); return; }
  res.writeHead(404); res.end('nope');
});
function page2html(h, q, id){ return h(q, id); }
srv.listen(PORT, () => console.log(`[srv] replica on ${PORT}`));
