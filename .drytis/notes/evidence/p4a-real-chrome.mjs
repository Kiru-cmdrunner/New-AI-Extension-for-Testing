// Phase 4a real-Chrome confirmation (see header in git history of prior run).
import CDP from 'chrome-remote-interface';
import http from 'node:http';
import { spawn } from 'node:child_process';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/p4a-chrome-profile';
const DIST = '/workspace/dist';
const PORT = 9537;
const APP_PORT = 8101;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);

const shell = (body) => `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui;margin:2rem}
[role="alert"]{background:#e8f0fe;padding:6px;border-radius:4px;margin-top:6px}
button{cursor:pointer}</style></head><body>${body}</body></html>`;

const S1 = shell(`<h1>S1 Add-to-cart</h1>
<p>Cart: <span id="cart-count" data-count="0" aria-label="Cart count">0</span></p>
<button id="add1">Add to cart</button>
<div id="dialog" role="alert" hidden style="margin-top:8px;padding:8px;background:#e8f0fe;border-radius:6px"></div>
<script>
let cart = 0;
document.getElementById('add1').addEventListener('click', () => {
  fetch('/api/cart', { method: 'POST' }).then(r => r.json()).then(() => {
    cart++;
    const c = document.getElementById('cart-count');
    c.textContent = String(cart);
    c.setAttribute('data-count', String(cart));
    setTimeout(() => {
      const d = document.getElementById('dialog');
      d.textContent = 'Item added to cart';
      d.hidden = false;
    }, 500);
  });
});
</script>`);

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/cart')) { res.writeHead(200, {'content-type':'application/json'}); res.end('{"ok":true}'); return; }
  res.writeHead(200, {'content-type':'text/html'}); res.end(S1);
});
await new Promise(r => server.listen(APP_PORT, '127.0.0.1', r));

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
await sleep(2500);

const browser = await CDP({ port: PORT });
const { targetInfos: t0 } = await browser.send('Target.getTargets');
out('--- initial targets ---');
for (const t of t0) out('  ', t.type, (t.url||'').slice(0,70));
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
if (!extSW) { out('FAIL: extension SW not found'); process.exit(1); }
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${REPLICA}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable');
await panel.send('Runtime.enable');

// Panel diagnostics — is this really the extension page with our JS?
const diag = await panel.send('Runtime.evaluate', {
  expression: `(() => ({ href: location.href, title: document.title, hasRuntime: typeof chrome !== 'undefined' && !!chrome.runtime, readyState: document.readyState, scriptCount: document.scripts.length, bodyStart: (document.body?.textContent||'').slice(0,80) }))()`,
  returnByValue: true,
});
out('PANEL DIAG →', JSON.stringify(diag.result.value));

const evalPanel = async (expr) => {
  const r = await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result.value;
};

if (diag.result.value?.hasRuntime) {
  const started = await evalPanel(`(async () => { try { const r = await chrome.runtime.sendMessage({type:'START_RECORDING'}); return {ok:true, r}; } catch(e) { return {ok:false, e:String(e)}; } })()`);
  out('START_RECORDING →', JSON.stringify(started));
  await sleep(800);

  await browser.send('Target.activateTarget', { targetId: appTab });
  await sleep(400);
  const center = await app.send('Runtime.evaluate', {
    expression: `(() => { const el = document.getElementById('add1'); const r = el.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`,
  });
  const { x, y } = JSON.parse(center.result.value);
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  out('clicked #add1');
  await sleep(4000);

  const truth = await evalPanel(`(async () => { const g = await chrome.storage.local.get('cmdrunner_live_interactions'); const is = g.cmdrunner_live_interactions || []; return JSON.stringify(is.map(i => ({ t: i.interactionType ?? i.type, end: i.behavioralEvidence?.window?.endReason, rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? { n: i.behavioralEvidence.applicationEvidence.resultingState.items.length, kinds: i.behavioralEvidence.applicationEvidence.resultingState.items.map(x=>x.kind) } : null }))); })()`);
  out('EVIDENCE →', truth);

  const liveCheck = await evalPanel(`(() => { const t = document.body.textContent || ''; return JSON.stringify({ rs: t.includes('Resulting State'), counter: /counter:\\s*1\\s*\\(/.test(t), notif: t.includes('Item added to cart'), scanned: t.includes('scanned:'), window: t.includes('Window:') }); })()`);
  out('PANEL LIVE (pre-recording boot, expected negative) →', liveCheck);

  // Production-order live path: reload panel WHILE recording is active and
  // evidence is persisted → recording view boots → timeline cards render
  // with behavioralEvidence attached → renderEvidence → Resulting State.
  await panel.send('Page.enable');
  await panel.send('Page.reload');
  await sleep(2500);
  const liveReloadCheck = await evalPanel(`(() => { const t = document.body.textContent || ''; return JSON.stringify({ rs: t.includes('Resulting State'), counter: /counter:\\s*1\\s*\\(/.test(t), scanned: t.includes('scanned:'), window: t.includes('Window:'), hasEvidenceContainer: !!document.querySelector('.evidence-container') }); })()`);
  out('PANEL LIVE RELOAD (recording active) →', liveReloadCheck);

  await evalPanel(`(async () => { try { const r = await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return {ok:true}; } catch(e) { return {ok:false, e:String(e)}; } })()`);
  await sleep(2500);
  await panel.send('Page.enable');
  await panel.send('Page.reload');
  await sleep(2500);
  const reloadedCheck = await evalPanel(`(() => { const t = document.body.textContent || ''; return JSON.stringify({ rs: t.includes('Resulting State'), counter: /counter:\\s*1\\s*\\(/.test(t), notif: t.includes('Item added to cart'), scanned: t.includes('scanned:'), hasEvidenceContainer: !!document.querySelector('.evidence-container') }); })()`);
  out('PANEL RELOADED →', reloadedCheck);
}

browser.send('Browser.close').catch(()=>{});
await sleep(1200);
server.close();
process.exit(0);
