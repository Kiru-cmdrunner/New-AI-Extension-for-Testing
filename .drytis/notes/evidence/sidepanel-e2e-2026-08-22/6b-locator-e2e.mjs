// 6B real-Chrome E2E — AC7 + AC10 (family-tagged locators end-to-end).
// Pattern proven in final-panel-button.mjs: CDP, extension loaded from
// /workspace/dist, start via panel message path, stop via real stop button.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const PAGE = `<!DOCTYPE html><html><head><title>6B</title></head><body><main>
<h1>Locator durability playground</h1>
<label for="q">Search</label>
<input id="q" name="q" placeholder="Search items" data-auto-id="search-input" />
<button data-cy="search-btn" class="btn btn-primary">Search</button>
<button data-testid="clear-btn">Clear</button>
<i class="icon-plus" role="button" style="display:inline-block;width:24px;height:24px"></i>
<table id="results"><tbody>
<tr><td>invoice-1001</td><td>$42.00</td></tr>
<tr><td>invoice-1002</td><td>$7.50</td></tr>
</tbody></table>
</main></body></html>`;
const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
await new Promise(r => server.listen(8190, '127.0.0.1', r));

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/6b-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9567;
const APP = 'http://127.0.0.1:8190';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`);
  ok ? PASS++ : FAIL++;
};
const DUMP = '/tmp/6b-e2e-dumps';
fs.mkdirSync(DUMP, { recursive: true });

const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId:', extId);
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
const sw = await CDP({ target: extSW.targetId, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable'); await sw.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalSW = async (expr) => (await sw.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => { const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value; return v === 'null' ? null : JSON.parse(v); };
const clickSel = async (sel, label) => { const p = await center(sel); if (!p) { out('  !!', sel, 'not clickable'); return false; }
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  out('  clicked', label || sel); return true; };
const typeInto = async (sel, text) => { const p = await center(sel); if (!p) return false;
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(250);
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) }); await sleep(35); } return true; };

const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopViaPanel = async () => { await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 'clicked'; })()`); };

// ── Record ──
await sleep(600);
await startRec();
await typeInto('#q', 'invoice');
await clickSel('[data-cy="search-btn"]', 'Search (data-cy)');
await clickSel('[data-testid="clear-btn"]', 'Clear (data-testid)');
await clickSel('i.icon-plus', 'icon-plus (class-only)');
await sleep(2600);
await stopViaPanel();

// ── Collect panel stopped view ──
let panelView = null;
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  panelView = await evalPanel(`(() => ({
    cards: Array.from(document.querySelectorAll('.interaction-event')).map(n => ({
      id: n.querySelector('.timeline-event__id')?.textContent || '',
      type: n.querySelector('.timeline-event__type')?.textContent || '',
    })),
    irSteps: Array.from(document.querySelectorAll('.step-card')).map(n => n.textContent.slice(0, 160).replace(/\\s+/g, ' ')),
  }))()`).catch(() => null);
  if (panelView && panelView.cards.length > 0) break;
}
fs.writeFileSync(`${DUMP}/6b-panel.json`, JSON.stringify(panelView, null, 2));
out('\n── CARDS ──');
for (const c of panelView?.cards ?? []) out(' ', c.id, `[${c.type}]`);
out('── IR STEPS ──');
for (const s of panelView?.irSteps ?? []) out(' ', s);

// ── Generated code from the SW's generated_files storage key ──
let codeFromPanel = '';
for (let attempt = 0; attempt < 6; attempt++) {
  const gf = await evalSW(`(async () => {
    const all = await chrome.storage.local.get(['generated_files']);
    const gf = all.generated_files;
    return gf ? JSON.stringify(gf).slice(0, 14000) : null;
  })()`).catch(e => 'SW-ERR: ' + e.message);
  if (gf && !String(gf).startsWith('SW-ERR')) { codeFromPanel = String(gf); break; }
  await sleep(1500);
}
const spec = codeFromPanel ? { key: 'sw-generated-files', value: codeFromPanel } : null;
if (spec) fs.writeFileSync(`${DUMP}/6b-generated.txt`, JSON.stringify(spec, null, 2)); else fs.writeFileSync(`${DUMP}/6b-generated.txt`, 'NO generated_files');
out('── GENERATED SPEC (first 1200) ──');
out(String(spec?.value ?? 'NONE').slice(0, 1200));

// spec.value is a JSON.stringify'd array — its contents have escaped quotes.
// Parse the real file contents out before matching.
const codeText = (() => {
  try {
    const parsed = JSON.parse(String(spec?.value ?? '{}'));
    const files = parsed?.files ?? parsed ?? [];
    return (Array.isArray(files) ? files : Object.values(files)).map((f) => f?.content ?? '').join('\n');
  } catch { return String(spec?.value ?? ''); }
})();
check('recording produced cards', (panelView?.cards?.length ?? 0) >= 3, `${panelView?.cards?.length ?? 0} cards`);
check('IR steps rendered', (panelView?.irSteps?.length ?? 0) >= 3, `${panelView?.irSteps?.length ?? 0} steps`);

// AC10: family-tagged + bare + icon-class locators in generated code
check('AC10: data-auto-id renders page.locator([data-auto-id=…])', codeText.includes(String.raw`locator('[data-auto-id="search-input"]')`));
check('AC10: data-cy renders page.locator([data-cy=…])', codeText.includes(String.raw`locator('[data-cy="search-btn"]')`));
check('AC10: data-testid stays getByTestId (bare, STAB)', codeText.includes(`getByTestId('clear-btn')`));
check('AC10: class-only icon uses class~ CSS', codeText.includes(String.raw`locator('[class~="icon-plus"]')`), codeText.includes('icon-plus') ? 'icon-plus present' : 'absent');
check('AC10: no nth-of-type fallback anywhere', !codeText.includes('nth-of-type'));

out('\n════ 6B E2E — ' + PASS + ' PASS / ' + FAIL + ' FAIL ════');
try { await browser.close(); } catch {}
chrome.kill();
server.close();
process.exit(FAIL ? 1 : 0);
