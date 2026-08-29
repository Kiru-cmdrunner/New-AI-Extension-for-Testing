// Direct selector probe: does the observer's config actually match the R3
// DOM post-render? Runs the EXACT config selectors in-page (no extension).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
await import('/workspace/.drytis/notes/evidence/full-audit-350af71/r3-bookshop-app.mjs');
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME_BIN, [
  '--remote-debugging-port=9665', `--user-data-dir=/tmp/r3probe-${Date.now()}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: 9665 }); break; } catch {} }
const { targetId } = await browser.send('Target.createTarget', { url: 'http://127.0.0.1:8177/' });
const c = await CDP({ target: targetId, port: 9665 });
await c.send('Runtime.enable');
await sleep(1500);
// type 'war', click Go, wait for render
await c.send('Runtime.evaluate', { expression: `document.getElementById('q').value='war'; document.getElementById('sf').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`, returnByValue: true });
await sleep(2500);
const res = await c.send('Runtime.evaluate', {
  returnByValue: true,
  expression: `(() => {
    const sels = [
      ['counter',  '[data-testid*="cart-count" i], [aria-label*="cart" i][class*="count" i]'],
      ['counter-auto', '[data-auto-id*="count" i], [data-auto-id*="total" i]'],
      ['notif',    '[role="alert"], [role="status"]'],
      ['toast',    '[data-testid*="toast" i], [class*="toast-message" i]'],
      ['coll-ul',  'ul[data-testid], ol[data-testid], [role="list"][data-testid]'],
      ['coll-res', '[data-testid*="results" i], [class*="results-container" i]'],
      ['entity-generic', '[data-product-id], [data-item-id], [data-sku]'],
      ['entity-alt', '[data-auto-id][data-sku], [data-auto-id][data-item-id], [data-auto-id][data-product-id]'],
      ['status-badge', '[class*="badge" i][class*="status" i], [data-testid*="status" i]'],
      ['pill', '[class*="pill" i], [class*="chip" i]'],
    ];
    const out = {};
    for (const [name, sel] of sels) {
      try { out[name] = [...document.querySelectorAll(sel)].map(e => e.tagName + '|' + (e.getAttribute('data-sku') ?? e.getAttribute('data-testid') ?? e.className) + '|path=' + (()=>{let p=[],n=e;while(n&&n.nodeType===1&&p.length<4){p.unshift(n.tagName+(n.id?'#'+n.id:''));n=n.parentElement}return p.join('>')})()).slice(0,4); }
      catch (e) { out[name] = 'ERR ' + e.message; }
    }
    out.__liHTML = document.querySelector('#results li')?.outerHTML?.slice(0, 300) ?? 'NO LI';
    out.__ulCount = document.querySelectorAll('#results li').length;
    return JSON.stringify(out, null, 1);
  })()`,
});
console.log(res.result.value);
try { browser.send('Browser.close'); } catch {}
await sleep(800);
process.exit(0);
