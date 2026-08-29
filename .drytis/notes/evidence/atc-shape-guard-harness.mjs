// Real-Chrome CDP validation: network-supplement shape guard
// (AJAX accordion add-to-cart — iPhone shape; form-submit — Vivo shape).
//
// Technique per .drytis/notes/real-chrome-cdp-validation-technique.md and
// the d8-harness flat-CDP recipe: pinned Chrome 148 headless=new + dist,
// CDP 9533, runtime messages routed through the extension PANEL page's
// dedicated webSocketDebuggerUrl.
import CDP from 'chrome-remote-interface';
import fs from 'node:fs';
import http from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/atc-chrome-profile';
const DIST = '/workspace/dist';
const PORT = 9533;
const APP_PORT = 8099;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const PANEL = (extId) => `chrome-extension://${extId}/src/sidepanel/index.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 0. replica server (both shapes) ───────────────────────────────────
const page = (body) => `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui;margin:2rem}
.a-accordion{border:1px solid #ccc;border-radius:8px;margin:8px 0}
.a-accordion-header{background:#f0f0f0;padding:8px 12px;cursor:pointer;font-weight:600}
.a-accordion-inner{padding:8px 12px}
.a-button-primary{display:inline-block;background:#ffa41c;border:1px solid #ff8f00;border-radius:8px;padding:8px 18px;cursor:pointer}
#cart-count{font-weight:700;color:#b12704}</style></head><body>${body}</html>`;

const AJAX = page(`<h1>AJAX Accordion Product</h1>
<p>Cart count: <span id="cart-count">0</span></p>
<div class="a-accordion" id="accordion-atc">
  <div class="a-accordion-header" aria-expanded="false">Add to cart</div>
  <div class="a-accordion-inner" id="accordion-inner" hidden>
    <span class="a-button-primary" id="add-to-cart-button" role="button" tabindex="0">Add to cart</span>
    <div id="atc-status" style="margin-top:8px"></div>
  </div>
</div>
<script>
let cart=0;
window.fireBurst=function(){for(let i=0;i<34;i++){setTimeout(()=>{fetch('/__api/burst/'+i+'?r='+Math.floor(Math.random()*1e6)).catch(()=>{});},400+i*15);}};
const hdr=document.querySelector('.a-accordion-header');
hdr.addEventListener('click',()=>{const inner=document.getElementById('accordion-inner');inner.hidden=!inner.hidden;hdr.setAttribute('aria-expanded',String(!inner.hidden));});
const atc=document.getElementById('add-to-cart-button');
atc.addEventListener('click',()=>{cart++;document.getElementById('cart-count').textContent=cart;document.getElementById('atc-status').textContent='Added to cart ('+cart+')';window.fireBurst();});
</script>`);

const FORM_LANDING = page(`<h1>Added to cart (form)</h1><p>The form submit landed here after a full reload.</p><a href="/">back</a>`);
const FORM = page(`<h1>Form-Submit Product (Vivo shape)</h1>
<form method="GET" action="/form-cart"><button id="vivo-atc" type="submit">Add to cart (form submit)</button></form>`);

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${APP_PORT}`);
  if (u.pathname === '/') { res.writeHead(200, {'Content-Type': 'text/html'}); res.end(AJAX); return; }
  if (u.pathname === '/form-product') { res.writeHead(200, {'Content-Type': 'text/html'}); res.end(FORM); return; }
  if (u.pathname === '/form-cart') { res.writeHead(200, {'Content-Type': 'text/html'}); res.end(FORM_LANDING); return; }
  if (u.pathname.startsWith('/__api/')) { setTimeout(() => { res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"ok":true}'); }, 350); return; }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => srv.listen(APP_PORT, r));
console.log('[harness] replica on', APP_PORT);

// ── 1. launch pinned Chrome with the built dist ───────────────────────
fs.rmSync(PROFILE, { recursive: true, force: true });
const { spawn } = await import('node:child_process');
const chrome = spawn(CHROME_BIN, [
  `--load-extension=${DIST}`,
  `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`,
  '--headless=new', '--no-sandbox', '--disable-gpu',
  '--window-size=1280,800',
  'about:blank',
], { stdio: 'ignore' });
await sleep(4000);

const results = [];
const consoleErrors = [];
const check = (name, pass, evidence = '') => {
  results.push({ name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${evidence ? ' — ' + evidence : ''}`);
};

const browser = await CDP({ port: PORT });
try {
  await browser.send('Target.setDiscoverTargets', { discover: true, flatten: true }).catch(() => {});
  const KNOWN_ID = 'gndjidfncanlhlonpcabokbdhnikglpn';
  let sw = null;
  for (let i = 0; i < 30 && !sw; i++) {
    const { targetInfos } = await browser.send('Target.getTargets');
    sw = targetInfos.find((t) => t.url.includes('service-worker-loader.js'));
    if (!sw) {
      if (i === 3) await browser.send('Target.createTarget', { url: `chrome-extension://${KNOWN_ID}/src/sidepanel/index.html` }).catch(() => {});
      await sleep(1000);
    }
  }
  if (!sw) throw new Error('extension service worker not found after 30s');
  const extId = sw.url.split('/')[2];
  console.log('[harness] extension id:', extId);

  const { targetId: appTab } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { targetId: panelTab } = await browser.send('Target.createTarget', { url: PANEL(extId) });
  const attach = async (id) => (await browser.send('Target.attachToTarget', { targetId: id, flatten: true })).sessionId;
  const A = await attach(appTab);
  const P = await attach(panelTab);
  const sendA = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: A });
  await sendA('Runtime.enable'); await sendA('Page.enable');

  const evalApp = async (e) => {
    const r = await sendA('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('app eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 250));
    return r.result.value;
  };

  // Panel messaging via the panel page's dedicated ws (flat-session MV3 SW
  // attach is DORMANT — known technique constraint).
  const WS = (await import('/workspace/node_modules/ws/index.js')).default;
  async function evalPanelRaw(e) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = list.find((t) => t.type === 'page' && t.url.includes('src/sidepanel/index.html'));
    if (!p?.webSocketDebuggerUrl) throw new Error('panel page ws not found');
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
    if (r.exceptionDetails) throw new Error('panel eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 300));
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

  browser.on('Runtime.consoleAPICalled', (p) => {
    if (p.sessionId === A && p.params.type === 'error') consoleErrors.push('[app] ' + p.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });

  const goApp = async (url) => {
    await browser.send('Target.activateTarget', { targetId: appTab });
    await sleep(300);
    await sendA('Page.navigate', { url }).catch(() => {});
    for (let i = 0; i < 15; i++) {
      await sleep(1200);
      const u = await evalApp('location.href').catch(() => '');
      if (u.startsWith(REPLICA)) return u;
      if (i === 5) await sendA('Page.navigate', { url }).catch(() => {});
    }
    throw new Error(`app navigation to ${url} failed`);
  };

  const focusAppAndCmd = async (type_) => {
    await evalPanel(`(async () => {
      const id = parseInt('${appTab}', 16);
      let tab = (await chrome.tabs.query({})).find((t) => t.id === id);
      if (!tab) tab = (await chrome.tabs.query({ url: '${REPLICA}/*' })).pop();
      if (!tab) throw new Error('app tab not found');
      await chrome.tabs.update(tab.id, { active: true });
      return 'focused ' + tab.id;
    })()`);
    await sleep(600);
    await evalPanel(`chrome.runtime.sendMessage({type:'${type_}'}).then(()=>'sent',e=>{throw e})`);
    await sleep(400);
  };

  const click = async (sel) => {
    // Real CDP input events (proven d9/d10 recipe) — scripted el.click()
    // lacks isTrusted capture paths.
    const box = await evalApp(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
    if (!box) throw new Error(`selector not found: ${sel} @ ${await evalApp('location.href')}`);
    const [x, y] = box;
    await sendA('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sendA('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(1000);
  };

  const readStorage = async () => evalPanel(`(async () => {
    const all = await chrome.storage.local.get(null);
    // app keys are UNPREFIXED per the D9 note
    const li = all['live_interactions'] ?? all['cmdrunner_live_interactions'] ?? [];
    return li.map(i => ({
      id: i.interactionId, type: i.type,
      triggerCss: i.triggerEvent?.target?.cssSelector ?? null,
      target: !!i.behavioralEvidence?.targetEvidence,
      targetCss: i.behavioralEvidence?.targetEvidence?.identity?.cssSelector ?? null,
      endReason: i.behavioralEvidence?.window?.endReason ?? null,
      durationMs: i.behavioralEvidence?.window?.durationMs ?? null,
      net: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
      burstRows: (i.behavioralEvidence?.applicationEvidence?.networkActivity ?? []).filter(n => (n.url ?? '').includes('__api/burst')).length,
      navEvidence: i.behavioralEvidence?.applicationEvidence?.navigation?.length ?? 0,
    }));
  })()`);

  // ══ Scenario A: AJAX accordion (iPhone shape) ══════════════════════
  await goApp(REPLICA + '/');
  await sleep(1500);
  await focusAppAndCmd('START_RECORDING');
  await sleep(1200);

  await click('.a-accordion-header');
  await sleep(600);
  await click('#add-to-cart-button');
  console.log('[harness] A: add-to-cart clicked; burst 34 × 400–890ms + G3 re-collect at +1000ms');
  await sleep(4500);

  await focusAppAndCmd('STOP_RECORDING');
  await sleep(3500);

  const intsA = await readStorage();
  console.log('[harness] A interactions:', JSON.stringify(intsA, null, 1));
  const atc = intsA.find((i) => i.triggerCss?.includes('add-to-cart-button'));

  check('A: recording produced interactions', intsA.length > 0, intsA.length + ' interactions');
  check('A: Click on Add-to-cart exists as separate interaction', !!atc, atc ? `${atc.type} trigger=${atc.triggerCss}` : 'not found');
  // The accordion header (no role/tabindex) records as Unclassified —
  // the invariant is that it is a SEPARATE interaction from the ATC click,
  // not that it is classified as Click.
  const atcClicks = intsA.filter((i) => i.triggerCss?.includes('add-to-cart-button'));
  const others = intsA.filter((i) => !i.triggerCss?.includes('add-to-cart-button'));
  check('A: accordion-header action separate from Add-to-cart click (not merged)', atcClicks.length === 1 && others.length > 0, `${atcClicks.length} atc click + ${others.length} separate interactions (${others.map((o) => o.type).join(',')})`);
  if (atc) {
    check('A: Click HAS target evidence (the fix)', atc.target === true, atc.target ? 'identity=' + atc.targetCss : 'NULL — supplement destroyed it');
    check('A: target identity is the Add-to-cart button', atc.targetCss === '#add-to-cart-button', String(atc.targetCss));
    check('A: window NOT 1000ms/stabilized replacement', !(atc.endReason === 'stabilized' && atc.durationMs === 1000), `${atc.endReason} / ${atc.durationMs}ms`);
    check('A: burst network rows merged into click evidence', atc.burstRows > 0, `${atc.burstRows} burst rows of ${atc.net} total`);
  }
  await evalPanel(`(async () => { await chrome.storage.local.remove('live_interactions'); return 'cleared'; })()`).catch(() => {});

  // ══ Scenario B: form-submit reload (Vivo shape) ════════════════════
  await goApp(REPLICA + '/form-product');
  await sleep(1500);
  await focusAppAndCmd('START_RECORDING');
  await sleep(1200);
  await click('#vivo-atc');
  console.log('[harness] B: form submit clicked; waiting for full reload + post-nav evidence window');
  await sleep(6000);
  await focusAppAndCmd('STOP_RECORDING');
  await sleep(3500);

  const intsB = await readStorage();
  console.log('[harness] B interactions:', JSON.stringify(intsB, null, 1));
  const clickB = intsB.find((i) => i.triggerCss?.includes('vivo-atc'));
  const navB = intsB.find((i) => i.type === 'Navigation');

  check('B: interactions recorded through full reload', intsB.length > 0, intsB.length + ' interactions');
  check('B: form click interaction exists', !!clickB, clickB ? clickB.type : 'not found');
  check('B: Navigation interaction exists (separate from click)', !!navB, navB ? navB.id : 'not found');
  if (clickB && navB) check('B: click and navigation are SEPARATE interactions', clickB.id !== navB.id, clickB.id + ' vs ' + navB.id);
  check('B: post-nav evidence captured on the reload path', intsB.some((i) => i.target), intsB.map((i) => `${i.type}:${i.target ? 'target' : 'null'}`).join(', '));
  if (navB) check('B: navigation carries navigation evidence (unregressed)', navB.navEvidence > 0 || navB.net > 0, `nav=${navB.navEvidence} net=${navB.net}`);

  check('zero console errors in app tab', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');

  const fails = results.filter((r) => !r.pass).length;
  console.log(`\n==== SHAPE-GUARD REAL-CHROME RESULT: ${results.length - fails}/${results.length} PASS ====`);
  process.exitCode = fails === 0 ? 0 : 1;
} catch (e) {
  console.error('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e.message);
  process.exitCode = 2;
} finally {
  try { await browser.close(); } catch {}
  chrome.kill('SIGKILL');
  srv.close();
  process.exit(process.exitCode ?? 0);
}
