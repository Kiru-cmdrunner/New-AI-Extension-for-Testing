import http from 'node:http';
const APP_PORT = 8121;
const PAGE_SEARCH = `<!doctype html><html><head><meta charset="utf-8">
<title>Replica Bazaar — Search</title>
<style>body{font-family:system-ui;margin:2rem}button,input{font-size:1rem}button{cursor:pointer}
ul{list-style:none;padding:0}li{border:1px solid #ccc;margin:4px 0;padding:8px;border-radius:4px}</style></head><body>
<h1>Replica Bazaar</h1>
<form id="sf"><label for="q">Search products</label>
<input id="q" name="q" type="text" placeholder="headphones">
<button type="submit" id="go">Go</button></form>
<ul id="results" data-testid="search-results"></ul>
<script>
document.getElementById('sf').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value || 'all';
  const results = document.getElementById('results');
  results.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const li = document.createElement('li');
    li.setAttribute('data-testid', 'result-item');
    li.setAttribute('data-sku', 'SKU-' + q + '-' + i);
    li.textContent = q + ' product ' + i;
    results.appendChild(li);
  }
});
</script></body></html>`;
const PAGE_CART = `<!doctype html><html><head><meta charset="utf-8">
<title>Replica Bazaar — Cart</title>
<style>body{font-family:system-ui;margin:2rem}button{cursor:pointer}
ul{list-style:none;padding:0}li{border:1px solid #ccc;margin:4px 0;padding:8px;border-radius:4px}</style></head><body>
<h1>Your Cart</h1>
<p>Cart: <span id="cart-count" data-count="0" aria-label="Cart">0 items</span></p>
<button id="add1">Add to cart</button>
<ul id="cart-items" data-testid="cart-items"></ul>
<p><a href="/" id="home-link">Back to search</a></p>
<script>
let n = 0;
document.getElementById('add1').addEventListener('click', (future) => {
  n++;
  const c = document.getElementById('cart-count');
  c.textContent = n + ' items';
  c.setAttribute('data-count', String(n));
  const li = document.createElement('li');
  li.setAttribute('data-testid', 'cart-item');
  li.textContent = 'Item ' + n;
  document.getElementById('cart-items').appendChild(li);
});
</script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/preseeded')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE_CART.replace(
      `document.getElementById('add1').addEventListener('click', (future) => {`,
      `for (let i=1;i<=3;i++){const li=document.createElement('li');li.setAttribute('data-testid','cart-item');li.textContent='Item '+i;document.getElementById('cart-items').appendChild(li);}
document.getElementById('cart-count').textContent='3 items';
document.getElementById('cart-count').setAttribute('data-count','3');
document.getElementById('add1').textContent='Save for later';
document.getElementById('add1').addEventListener('click', (future) => { return;`));
    return;
  }
  if (req.url.startsWith('/cart')) { res.writeHead(200, {'content-type':'text/html'}); res.end(PAGE_CART); return; }
  res.writeHead(200, {'content-type':'text/html'}); res.end(PAGE_SEARCH);
});
await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));
console.log('[replica] listening on ' + APP_PORT);
