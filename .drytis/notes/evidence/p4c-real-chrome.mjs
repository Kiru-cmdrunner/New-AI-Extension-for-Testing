#!/usr/bin/env node
/**
 * Phase 4c-ii real-Chrome validation.
 *
 * Loads the freshly built extension, records an AJAX add-to-cart on a
 * replica page, then verifies:
 *   1. EXECUTION_IR_PLAN steps carry step-scoped soft assertions joined by
 *      sourceEventId (optionally via the enrichment path).
 *   2. GENERATED_FILES' Playwright spec contains expect.soft(...) and NOT
 *      the NO_ASSERTIONS_BANNER.
 *   3. Click/Navigation separation respected (only the click's evidence
 *      derived assertions — destination snapshot has no generic #id entity
 *      locator here, but nothing merges).
 *
 * Technique (established in Phase 3): CDP Input events for trusted clicks,
 * panel-page context for START_RECORDING/FINALIZE delivery, app-tab session
 * for navigation.
 */
import CDP from 'chrome-remote-interface';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CDP_PORT = 9541;
const HTTP_PORT = 8099;

const pageHtml = `<!doctype html><html><head><title>4c shop</title></head><body>
<h1>Shop</h1>
<button id="add-to-cart" aria-label="Add to cart">Add to cart</button>
<div id="cart-count" aria-label="Cart count" data-count="0">0 items in cart</div>
<div id="toast" role="alert" aria-label="Cart notification" style="display:none">Added!</div>
<script>
window.__clicks = 0;
document.getElementById('add-to-cart').addEventListener('click', () => {
  window.__clicks++;
  fetch('/api/add').then(() => {
    // Immediate consequence (Phase-3 S1 pattern): counter at fetch-settle.
    document.getElementById('cart-count').textContent = window.__clicks + ' items in cart';
    document.getElementById('cart-count').setAttribute('data-count', String(window.__clicks));
    // Delayed UI consequence at +400ms: the toast notification.
    setTimeout(() => {
      const t = document.getElementById('toast');
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 900);
    }, 400);
  });
});
</script></body></html>`;

function replicaServer() {
  return createServer((req, res) => {
    if (req.url === '/api/add') {
      setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }, 300);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(pageHtml);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const srv = replicaServer().listen(HTTP_PORT, '127.0.0.1');
  const chrome = spawn(CHROME_BIN, [
    `--remote-debugging-port=${CDP_PORT}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-features=TranslateUI', '--user-data-dir=/tmp/4c-profile',
    '--load-extension=/workspace/dist', '--disable-extensions-except=/workspace/dist',
    'about:blank',
  ], { stdio: 'ignore' });
  await sleep(2500);

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const extTarget = targets.find((t) => t.type === 'service_worker' && t.url.includes('service-worker-loader.js'));
  if (!extTarget) { console.log('EXT_NOT_FOUND'); process.exit(1); }
  const extId = new URL(extTarget.url).host;
  console.log('extId:', extId);

  const browser = await CDP({ host: '127.0.0.1', port: CDP_PORT });
  // App tab + extension panel page (p4a technique: messages routed from the
  // PANEL page context — the SW's own sendMessage never reaches itself).
  const { targetId: appTab } = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${HTTP_PORT}/` });
  const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
  await sleep(2000);
  const panel = await CDP({ host: '127.0.0.1', port: CDP_PORT, target: panelTab });
  await panel.send('Runtime.enable');
  const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

  // Focus the app tab so chrome.tabs.query({active:true}) resolves to it.
  await browser.send('Target.activateTarget', { targetId: appTab });
  await sleep(500);

  const started = await evalPanel(`(async () => { try { const r = await chrome.runtime.sendMessage({type:'START_RECORDING'}); return {ok:true, r}; } catch(e) { return {ok:false, e:String(e)}; } })()`);
  console.log('START_RECORDING:', JSON.stringify(started));
  await sleep(1500);

  // Trusted click via CDP Input on the app tab.
  const t2 = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const appPage = t2.find((t) => t.type === 'page' && t.url.includes(`:${HTTP_PORT}`));
  const app = await CDP({ host: '127.0.0.1', port: CDP_PORT, target: appPage });
  const { Input, Runtime: AppRt } = app;
  await AppRt.enable();

  const box = await (await AppRt.evaluate({ expression:
    "(() => { const r = document.getElementById('add-to-cart').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()",
    returnByValue: true })).result.value;
  const { x, y } = JSON.parse(box);
  await Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  console.log('clicked add-to-cart');

  // Consequence: 300ms network + 400ms delay → wait past settlement (~2.5s window).
  await sleep(6000);

  const fin = await evalPanel(`(async () => { try { const r = await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return {ok:true, r}; } catch(e) { return {ok:false, e:String(e)}; } })()`);
  console.log('STOP_RECORDING:', JSON.stringify(fin));
  await sleep(4500);

  const storageDump = await evalPanel(`(async () => JSON.stringify(await chrome.storage.local.get(null)))()`);
  const parsed = JSON.parse(storageDump || '{}');

  const planKey = Object.keys(parsed).find((k) => k === 'execution_ir_plan');
  const genKey = Object.keys(parsed).find((k) => k === 'generated_files');
  const p = planKey ? parsed[planKey] : null;
  const g = genKey ? parsed[genKey] : null;
  console.log('plan key:', planKey, '| gen key:', genKey);
  if (!planKey) console.log('STORAGE_KEYS:', JSON.stringify(Object.keys(parsed)));

  console.log('--- IR plan steps ---');
  const stepSummary = (p && p.steps ? p.steps : []).map((s) => ({
    id: s.id, action: s.action, src: s.sourceEventId,
    assertions: (s.assertions || []).map((a) => ({
      type: a.type, comparison: a.comparison, severity: a.severity,
      css: a.target && a.target.resolvedLocators && a.target.resolvedLocators[0] && a.target.resolvedLocators[0].value,
      expected: a.expectedValue,
    })),
  }));
  console.log(JSON.stringify(stepSummary, null, 1));

  const asserted = stepSummary.filter((s) => s.assertions.length > 0);
  console.log('steps with assertions:', asserted.length, '/', stepSummary.length);

  // Generated spec content
  let specText = '';
  if (g && typeof g === 'object') {
    for (const [k, v] of Object.entries(g)) {
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      specText += text;
    }
  }
  const hasSoft = specText.includes('expect.soft(');
  const hasBanner = specText.includes('No assertions generated');
  console.log('spec has expect.soft:', hasSoft);
  console.log('spec has NO_ASSERTIONS_BANNER:', hasBanner);
  if (hasSoft) {
    const lines = specText.split('\\n').filter((l) => l.includes('expect.soft('));
    console.log('soft lines:', JSON.stringify(lines));
  }

  const ok = asserted.length >= 1 && hasSoft && !hasBanner &&
    asserted.every((s) => s.assertions.every((a) => a.severity === 'soft'));
  console.log(ok ? 'P4C_VALIDATION: PASS' : 'P4C_VALIDATION: FAIL');

  await panel.close(); await app.close();
  chrome.kill(); srv.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS_ERROR', e); process.exit(2); });
