// In-page probe: do the default-config selectors match visible elements in
// the fixture DOM? (records what the observer WOULD see)
import CDP from 'chrome-remote-interface';
const PORT = 9533, REPLICA = 'http://127.0.0.1:8099';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const { spawn } = await import('node:child_process');
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const DIST = '/workspace/dist';
const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/p3-probe-profile', `--load-extension=${DIST}`, `--disable-extensions-except=${DIST}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) break; } catch {} if (i === 59) throw new Error('cdp not up'); await sleep(250); }
const http = await import('node:http');
const shell = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/s3') return res.end(shell(`<p>Cart: <span id="cart-count" data-count="3" aria-label="Cart count">3</span></p>
<ul data-testid="cart-items"><li data-asin="B0VAL1">Widget A</li><li data-asin="B0VAL2">Widget B</li><li data-asin="B0VAL3">Widget C</li></ul>`));
  res.statusCode = 404; res.end('nf');
});
await new Promise(r => server.listen(8099, '127.0.0.1', r));
const t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page' && !x.url.startsWith('chrome-extension'));
const c = await CDP({ target: t.webSocketDebuggerUrl, port: PORT });
await c.send('Runtime.enable'); await c.send('Page.enable');
await c.send('Page.navigate', { url: REPLICA + '/s3' });
await sleep(1200);
const r = await c.send('Runtime.evaluate', { expression: `(() => {
  const sels = ['[data-testid*="cart-count" i]','[data-count]','[role="alert"],[role="status"]','ul[data-testid]','[data-testid*="cart-items" i]','[data-asin]','[class*="badge" i][class*="status" i],[data-testid*="status" i]'];
  const out = {};
  for (const s of sels) {
    try { const els = document.querySelectorAll(s);
      out[s] = Array.from(els).map(e => ({ tag: e.tagName, id: e.id, txt: (e.textContent||'').trim().slice(0,25), visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length), attrs: e.getAttributeNames().filter(a => a.startsWith('data-')) }));
    } catch (err) { out[s] = 'ERR ' + err.message; }
  }
  return out;
})()`, returnByValue: true });
console.log(JSON.stringify(r.result.value, null, 1));
process.exit(0);
