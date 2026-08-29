// Read-only validation harness: Surface detection (5a + 5b) in real Chrome.
// Loads /workspace/cmdrunner-extension.zip (fresh build with 5a/5b — see
// build timestamp vs run timestamp in surface-rca-run.log).
//
// S1 = pre-existing popover, toggled by inline style display.
// S2 = pre-existing popover, toggled by class.
// S3 = wrapper plain div added, role=dialog on DESCENDANT.
// S4 = control: directly-added role=dialog node.
import CDP from 'chrome-remote-interface';
import fs from 'node:fs';
import http from 'node:http';
import { execSync } from 'node:child_process';

const ZIP = '/workspace/cmdrunner-extension.zip'; // fresh build with 5a/5b
const PROFILE = '/tmp/surface-rca-profile';
const EXTDIR = '/tmp/surface-rca-ext';
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9553;
const APP_PORT = 8099;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Unzip shipped build
fs.rmSync(EXTDIR, { recursive: true, force: true });
execSync(`unzip -q -o ${ZIP} -d ${EXTDIR}`);
const manifest = JSON.parse(fs.readFileSync(`${EXTDIR}/manifest.json`, 'utf8'));
console.log(`[harness] shipped build: ${manifest.name} v${manifest.version}`);

// Replica pages (Amazon-shaped; no third-party fetches)
const css = [
  'body{font-family:system-ui;margin:2rem}',
  '#attach-popover{position:fixed;top:60px;right:20px;width:280px;border:1px solid #ddd;border-radius:8px;padding:12px;background:#fff;display:none}',
  '#attach-popover.a-popover-shown:not([aria-hidden="true"]){display:block}',
  '#attach-popover[aria-hidden="true"]{display:none}',
  '.a-button-input{background:#ffa41c;border:1px solid #ff8f00;border-radius:8px;padding:8px 18px;cursor:pointer}',
  '#cart-count{font-weight:700;color:#b12704}',
].join('\n');

const popoverOpen = {
  style: `popover.style.display = 'block';`,
  class: `popover.setAttribute('aria-hidden','false'); popover.classList.add('a-popover-shown');`,
  rstyle: `popover.setAttribute('role','dialog'); popover.style.display = 'block';`,
  rclass: `popover.setAttribute('role','dialog'); popover.setAttribute('aria-hidden','false'); popover.classList.add('a-popover-shown');`,
  wrap: [
    `const w=document.createElement('div'); w.id='attach-wrapper';`,
    `const d=document.createElement('div'); d.setAttribute('role','dialog'); d.setAttribute('aria-label','Added to cart'); d.textContent='Added to cart';`,
    `w.appendChild(d); document.body.appendChild(w);`,
  ].join('\n'),
  direct: [
    `const d=document.createElement('div'); d.id='added-to-cart-dialog';`,
    `d.setAttribute('role','dialog'); d.setAttribute('aria-label','Added to cart'); d.textContent='Added to cart';`,
    `document.body.appendChild(d);`,
  ].join('\n'),
};

const page = (mode) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>ATC surface RCA (${mode})</h1>
<p>Cart count: <span id="cart-count">0</span></p>
<form id="addToCart" method="post" action="#">
  <span class="a-button-primary"><input type="submit" value="Add to Cart" id="add-to-cart-button" class="a-button-input" aria-labelledby="add-to-cart-button-announce"></span>
</form>
<div id="attach-popover" role="region" aria-hidden="true">
  <strong>Added to cart</strong>
  <p>Cart subtotal (2 items).</p>
</div>
<div id="buybox"></div>
<script>
const popover = document.getElementById('attach-popover');
window.__atcRun = function(){
  document.getElementById('cart-count').textContent = '2';
  const bb = document.getElementById('buybox');
  for (let i=0;i<6;i++){ const s=document.createElement('span'); s.textContent='q'+i; bb.appendChild(s); }
  for (let i=0;i<34;i++){ setTimeout(()=>{ fetch('/__api/burst/'+i+'?r='+Math.floor(Math.random()*1e6)).catch(()=>{}); }, 400+i*15); }
  fetch('/__api/add?slow=800').then(() => {
    window.__openAt = Math.round(performance.now());
    ${popoverOpen[mode]}
  });
};
document.getElementById('addToCart').addEventListener('submit', (e) => { e.preventDefault(); window.__atcRun(); });
<\/script></body></html>`;

const vivoPage = () => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<h1>Vivo ATC (navigation shape)</h1>
<form id="addToCart" method="post" action="/cart/add">
  <span class="a-button-primary"><input type="submit" value="Add to Cart" id="add-to-cart-button" class="a-button-input"></span>
</form>
</body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${APP_PORT}`);
  if (url.pathname.startsWith('/__api/add')) {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); }, 800);
    return;
  }
  if (url.pathname.startsWith('/__api/burst')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (url.pathname === '/vivo') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(vivoPage());
    return;
  }
  if (url.pathname.startsWith('/cart')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><body><h1>Vivo cart</h1><p>Added.</p></body></html>');
    return;
  }
  const mode = url.pathname.split('/').pop() || 'style';
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page(mode));
});
await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));

// Chrome with SHIPPED extension
fs.rmSync(PROFILE, { recursive: true, force: true });
const { spawn } = await import('node:child_process');
const chromeProc = spawn(CHROME_BIN, [
  `--load-extension=${EXTDIR}`, `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox',
  '--disable-gpu', '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });
await sleep(4000);

const browserClient = await CDP({ port: PORT });
await browserClient.send('Target.setDiscoverTargets', { discover: true, flatten: true }).catch(() => {});

// Find extension id via service worker
let extId = null;
for (let i = 0; i < 40 && !extId; i++) {
  await sleep(500);
  try {
    const infos = (await browserClient.send('Target.getTargets')).targetInfos;
    const sw = infos.find((t) => t.url.includes('service-worker-loader.js'));
    if (sw) extId = sw.url.split('/')[2];
  } catch {}
}
if (!extId) throw new Error('extension SW not found');
console.log('[harness] extId:', extId);

const { targetId: appTab } = await browserClient.send('Target.createTarget', { url: 'about:blank' });
const { targetId: panelTab } = await browserClient.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
const attach = async (id) => (await browserClient.send('Target.attachToTarget', { targetId: id, flatten: true })).sessionId;
const A = await attach(appTab);
const sendA = (m, p) => browserClient.send(m, { ...(p ?? {}), sessionId: A });
await sendA('Runtime.enable'); await sendA('Page.enable');

const evalApp = async (e) => {
  const r = await sendA('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('app eval failed: ' + (r.exceptionDetails.exception?.description ?? '').slice(0, 200));
  return r.result.value;
};

const WS = (await import('/workspace/node_modules/ws/index.js')).default;
async function evalPanelRaw(e) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const p = list.find((t) => t.type === 'page' && t.url.includes('src/sidepanel/index.html'));
  if (!p?.webSocketDebuggerUrl) throw new Error('panel ws not found');
  const w = new WS(p.webSocketDebuggerUrl);
  await new Promise((res, rej) => { w.on('open', res); w.on('error', rej); });
  let idc = 0;
  const call = (method, params = {}) => new Promise((resolve) => {
    const mid = ++idc;
    const onMsg = (d) => { const m = JSON.parse(d.toString()); if (m.id === mid) { w.off('message', onMsg); resolve(m); } };
    w.on('message', onMsg); w.send(JSON.stringify({ id: mid, method, params }));
  });
  const r = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
  w.close();
  if (r.exceptionDetails) throw new Error('panel eval failed: ' + (r.exceptionDetails.exception?.description ?? '').slice(0, 250));
  return r.result?.result?.value;
}
const evalPanel = async (e) => {
  for (let i = 0; i < 10; i++) {
    const ok = await evalPanelRaw("typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? 'ready' : 'no'").catch(() => 'no');
    if (ok === 'ready') break;
    await sleep(600);
  }
  return evalPanelRaw(e);
};

const storageKey = 'cmdrunner_live_interactions';
const readInteractions = () => evalPanel(`(async () => {
  const all = await chrome.storage.local.get(null);
  const li = all['${storageKey}'] ?? all['live_interactions'] ?? [];
  return li.map(i => {
    const bev = i.behavioralEvidence; const ae = bev?.applicationEvidence;
    return { id: i.interactionId, type: i.type,
      triggerCss: i.triggerEvent?.target?.cssSelector ?? null,
      endReason: bev?.window?.endReason ?? null,
      durationMs: bev?.window?.durationMs ? Math.round(bev.window.durationMs) : null,
      targetCss: bev?.targetEvidence?.identity?.cssSelector ?? null,
      dom: ae?.domChanges?.length ?? 0,
      domOverflow: ae?.domChangeOverflow ?? 0,
      newSurfaces: (ae?.newSurfaces ?? []).map(s => ({ tag: s.tagName, role: s.ariaRole, name: (s.accessibleName ?? '').slice(0,30), emergence: s.emergence ?? null })),
      visChanges: (ae?.visibilityChanges ?? []).map(v => ({ path: (v.path ?? '').slice(0,50), prop: v.property, old: (v.oldValue ?? '').slice(0,12), neu: (v.newValue ?? '').slice(0,12) })),
      nav: ae?.navigation?.length ?? 0,
      net: ae?.networkActivity?.length ?? 0 };
  });
})()`);

const clearInteractions = () => evalPanel(`(async () => { await chrome.storage.local.remove('${storageKey}').catch(()=>{}); await chrome.storage.local.remove('live_interactions').catch(()=>{}); return 1; })()`).catch(() => {});

const panelClickButton = (pattern) => evalPanel(`(() => { const b = [...document.querySelectorAll('button')].find(b => ${pattern}.test(b.textContent)); if (b) b.click(); return !!b; })()`);


const focusAppAndCmd = async (type_) => {
  await evalPanel(`(async () => {
    const id = parseInt('${appTab}', 16);
    let tab = (await chrome.tabs.query({})).find((t) => t.id === id);
    if (!tab) tab = (await chrome.tabs.query({ url: '${REPLICA}/*' })).pop();
    if (!tab) throw new Error('app tab not found');
    await chrome.tabs.update(tab.id, { active: true });
    return 'ok';
  })()`);
  await sleep(600);
  await evalPanel(`chrome.runtime.sendMessage({type:'${type_}'}).then(()=>'sent',e=>{throw e})`);
  await sleep(400);
};

const click = async (sel) => {
  const box = await evalApp(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
  if (!box) throw new Error('selector not found: ' + sel);
  await sendA('Input.dispatchMouseEvent', { type: 'mousePressed', x: box[0], y: box[1], button: 'left', clickCount: 1 });
  await sendA('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box[0], y: box[1], button: 'left', clickCount: 1 });
  await sleep(500);
};

const runScenario = async (name, mode, waitMs) => {
  await sendA('Page.navigate', { url: `${REPLICA}/p/${mode}` });
  await sleep(1500);
  await clearInteractions();
  await focusAppAndCmd('START_RECORDING');
  await sleep(1200);
  await click('#add-to-cart-button');
  await sleep(waitMs);
  await focusAppAndCmd('STOP_RECORDING');
  await sleep(3500);
  const ints = await readInteractions();
  console.log(`\n===== ${name} =====`);
  console.log(JSON.stringify(ints, null, 1));
  return ints;
};

const results = [];
const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${name}${detail ? ' — ' + detail : ''}`); };

// RC-S1/S2 controls (region popover reveals → NO surface, visibility only)
try {
  const r1 = await runScenario('RC-S1 control: region popover inline style (no surface expected)', 'style', 6000);
  const ci = r1.find((i) => ((i.triggerCss ?? '') + (i.targetCss ?? '')).includes('add-to-cart-button'));
  check('RC-S1a', 'endReason=consequence-settled', ci?.endReason === 'consequence-settled', String(ci?.endReason));
  check('RC-S1b', 'region popover: NO surface record (deferred decision)', (ci?.newSurfaces ?? []).length === 0, JSON.stringify(ci?.newSurfaces ?? []));
  check('RC-S1c', 'visibility row still captured', (ci?.visChanges ?? []).some(v => v.path.includes('attach-popover') && v.prop === 'display'), JSON.stringify(ci?.visChanges ?? []).slice(0,160));
} catch (e) { check('RC-S1x', 'RC-S1 ran', false, e.message); }

try {
  const r2 = await runScenario('RC-S2 control: region popover class reveal (no surface expected)', 'class', 6000);
  const ci = r2.find((i) => ((i.triggerCss ?? '') + (i.targetCss ?? '')).includes('add-to-cart-button'));
  check('RC-S2a', 'endReason=consequence-settled', ci?.endReason === 'consequence-settled', String(ci?.endReason));
  check('RC-S2b', 'region popover: NO surface record', (ci?.newSurfaces ?? []).length === 0, JSON.stringify(ci?.newSurfaces ?? []));
  check('RC-S2c', 'visibility row still captured', (ci?.visChanges ?? []).some(v => v.path.includes('attach-popover')), JSON.stringify(ci?.visChanges ?? []).slice(0,160));
} catch (e) { check('RC-S2x', 'RC-S2 ran', false, e.message); }

// RC-S5: hidden role=dialog revealed via inline style (the Amazon iPhone flow, recognized role)
try {
  const r5 = await runScenario('RC-S5: role=dialog popover inline style reveal', 'rstyle', 6000);
  const ci = r5.find((i) => ((i.triggerCss ?? '') + (i.targetCss ?? '')).includes('add-to-cart-button'));
  check('RC-S5a', 'endReason=consequence-settled', ci?.endReason === 'consequence-settled', String(ci?.endReason));
  const dlg = (ci?.newSurfaces ?? []).find(s => s.role === 'dialog');
  check('RC-S5b', 'dialog surface recorded with emergence=revealed', !!dlg && dlg.emergence === 'revealed', JSON.stringify(ci?.newSurfaces ?? []).slice(0,200));
  check('RC-S5c', 'visibility row also present', (ci?.visChanges ?? []).some(v => v.path.includes('attach-popover') && v.prop === 'display'));
} catch (e) { check('RC-S5x', 'RC-S5 ran', false, e.message); }

// RC-S6: hidden role=dialog revealed via class swap (computed-style path in real Chrome)
try {
  const r6 = await runScenario('RC-S6: role=dialog popover class reveal', 'rclass', 6000);
  const ci = r6.find((i) => ((i.triggerCss ?? '') + (i.targetCss ?? '')).includes('add-to-cart-button'));
  check('RC-S6a', 'endReason=consequence-settled', ci?.endReason === 'consequence-settled', String(ci?.endReason));
  const dlg = (ci?.newSurfaces ?? []).find(s => s.role === 'dialog');
  check('RC-S6b', 'dialog surface recorded with emergence=revealed', !!dlg && dlg.emergence === 'revealed', JSON.stringify(ci?.newSurfaces ?? []).slice(0,200));
} catch (e) { check('RC-S6x', 'RC-S6 ran', false, e.message); }

// RC-S7: wrapper-inserted descendant dialog (was RCA S3 FAIL)
try {
  const r7 = await runScenario('RC-S7: wrapper div + descendant role=dialog', 'wrap', 6000);
  const ci = r7.find((i) => ((i.triggerCss ?? '') + (i.targetCss ?? '')).includes('add-to-cart-button'));
  check('RC-S7a', 'endReason=consequence-settled', ci?.endReason === 'consequence-settled', String(ci?.endReason));
  const dlg = (ci?.newSurfaces ?? []).find(s => s.role === 'dialog');
  check('RC-S7b', 'descendant dialog surface recorded with emergence=inserted', !!dlg && dlg.emergence === 'inserted', JSON.stringify(ci?.newSurfaces ?? []).slice(0,200));
} catch (e) { check('RC-S7x', 'RC-S7 ran', false, e.message); }

// RC-S4: control — direct role=dialog insert still works
try {
  const r4 = await runScenario('RC-S4 control: direct role=dialog node added', 'direct', 6000);
  const ci = r4.find((i) => ((i.triggerCss ?? '') + (i.targetCss ?? '')).includes('add-to-cart-button'));
  check('RC-S4a', 'endReason=consequence-settled', ci?.endReason === 'consequence-settled', String(ci?.endReason));
  check('RC-S4b', 'direct dialog surface captured', (ci?.newSurfaces ?? []).some(s => s.role === 'dialog'), JSON.stringify(ci?.newSurfaces ?? []).slice(0,200));
} catch (e) { check('RC-S4x', 'RC-S4 ran', false, e.message); }

// RC-V1: Vivo regression — real form-submit navigation: Click page-reload + separate Navigation
try {
  await sendA('Page.navigate', { url: `${REPLICA}/vivo` }).catch(() => {});
  // vivo page: form posts to /cart (server returns a simple page)
  await clearInteractions();
  await focusAppAndCmd('START_RECORDING');
  await sleep(1200);
  await click('#add-to-cart-button'); // submits the form → navigation
  await sleep(3500);
  await focusAppAndCmd('STOP_RECORDING');
  await sleep(3500);
  const ints = await readInteractions();
  console.log('\n===== RC-V1 Vivo navigation =====');
  console.log(JSON.stringify(ints, null, 1));
  const clickInt = ints.find((i) => (i.type === 'Click') && ((i.triggerCss ?? '') + (i.targetCss ?? '')).includes('add-to-cart-button'));
  const navInt = ints.find((i) => (i.type === 'Navigation') || /navigate/i.test(String(i.type)));
  check('RC-V1a', 'Click window finalized page-reload', clickInt?.endReason === 'page-reload', String(clickInt?.endReason));
  check('RC-V1b', 'separate Navigation interaction exists', !!navInt, JSON.stringify(ints.map(i => ({t: i.type, e: i.endReason}))));
  check('RC-V1c', 'Click window carries NO navigation evidence', (clickInt?.nav ?? 0) === 0, String(clickInt?.nav));
} catch (e) { check('RC-V1x', 'RC-V1 ran', false, e.message); }

const pass = results.filter(r => r.ok).length;
console.log(`\n==== SUMMARY: ${pass}/${results.length} PASS ====`);
fs.writeFileSync('/workspace/.drytis/notes/evidence/surface-rca-run.log',
  `surface RCA (shipped ZIP) ${new Date().toISOString()}\n` +
  results.map(r => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}: ${r.name}`).join('\n') + '\n');

try { await browserClient.send('Browser.close'); } catch {}
try { chromeProc.kill('SIGKILL'); } catch {}
process.exit(0);
