// Real-Chrome CDP investigation: where does the "Added to cart" DIALOG
// evidence go? (read-only RCA — no source changes; runs against /workspace/dist)
//
// Scenario A (Amazon iPhone shape): click #add-to-cart-button → 34-fetch
//   burst at +400..890ms → role=dialog div inserted at +500ms AND
//   pre-rendered #attach-popover aria-hidden toggled at +500ms.
// Scenario B (timing control): same page, dialog at +100ms (within the
//   evidence window) — does the pipeline capture it then?
// Scenario C (classifier probe): ROLELESS dialog div at +100ms — is a
//   plain-div dialog ever classified as a surface?
//
// Dumps the FULL applicationEvidence of every recorded interaction.
import CDP from 'chrome-remote-interface';
import fs from 'node:fs';
import http from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/dialog-rca-profile';
const DIST = '/workspace/dist';
const PORT = 9544;
const APP_PORT = 8098;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const PANEL = (extId) => `chrome-extension://${extId}/src/sidepanel/index.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// page(dialogDelayMs, dialogHasRole) — Amazon-shaped ATC page
const page = (dialogDelayMs, dialogHasRole) => `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui;margin:2rem}
#attach-popover{position:fixed;top:60px;right:20px;width:280px;border:1px solid #ddd;border-radius:8px;padding:12px;background:#fff}
#attach-popover[aria-hidden="true"]{display:none}
.a-button-input{background:#ffa41c;border:1px solid #ff8f00;border-radius:8px;padding:8px 18px;cursor:pointer}
#cart-count{font-weight:700;color:#b12704}</style></head><body>
<h1>Product (iPhone shape)</h1>
<p>Cart count: <span id="cart-count">0</span></p>
<form id="addToCart" method="post" action="#">
  <span class="a-button-primary"><input type="submit" value="Add to Cart" id="add-to-cart-button" class="a-button-input" aria-labelledby="add-to-cart-button-announce"></span>
</form>
<div id="attach-popover" aria-hidden="true" role="region">
  <strong>Added to cart</strong>
  <p>Cart subtotal (2 items).</p>
</div>
<div id="buybox"></div>
<script>
let cart=0;
const popover = document.getElementById('attach-popover');
window.__dialogOpenAt = null; window.__dialogEl = null;
window.fireBurst=function(){for(let i=0;i<34;i++){setTimeout(()=>{fetch('/__api/burst/'+i+'?r='+Math.floor(Math.random()*1e6)).catch(()=>{});},400+i*15);}};
window.openDialog=function(){
  window.__dialogOpenAt = Math.round(performance.now());
  popover.setAttribute('aria-hidden','false');            // visibility signal
  const d = document.createElement('div');
  d.id = 'added-to-cart-dialog';
  if (${dialogHasRole}) d.setAttribute('role','dialog');
  d.setAttribute('aria-label','Added to cart');
  d.textContent = 'Added to cart — Cart subtotal (2 items)';
  document.body.appendChild(d);                            // surface signal
  window.__dialogEl = d;
};
document.getElementById('addToCart').addEventListener('submit', (e) => {
  e.preventDefault();                                      // NO navigation — dialog stays on page
  cart++;
  document.getElementById('cart-count').textContent = cart; // early churn (within window)
  const bb = document.getElementById('buybox');
  for (let i=0;i<6;i++){ const s=document.createElement('span'); s.textContent='qty '+(i+1); bb.appendChild(s); }
  window.fireBurst();
  setTimeout(window.openDialog, ${dialogDelayMs});
});
</script></body></html>`;

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${APP_PORT}`);
  if (u.pathname === '/a' || u.pathname === '/b' || u.pathname === '/c') {
    const delay = u.pathname === '/a' ? 500 : 100;
    const role = u.pathname === '/c' ? false : true;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page(delay, role));
    return;
  }
  if (u.pathname.startsWith('/__api/')) {
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }, 350);
    return;
  }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => srv.listen(APP_PORT, r));
console.log('[rca] replica on', APP_PORT);

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

const browser = await CDP({ port: PORT });
const consoleErrors = [];
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
  console.log('[rca] extension id:', extId);

  const { targetId: appTab } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { targetId: panelTab } = await browser.send('Target.createTarget', { url: PANEL(extId) });
  const attach = async (id) => (await browser.send('Target.attachToTarget', { targetId: id, flatten: true })).sessionId;
  const A = await attach(appTab);
  const sendA = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: A });
  await sendA('Runtime.enable'); await sendA('Page.enable');

  const evalApp = async (e) => {
    const r = await sendA('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('app eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 250));
    return r.result.value;
  };

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
    const box = await evalApp(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
    if (!box) throw new Error(`selector not found: ${sel} @ ${await evalApp('location.href')}`);
    const [x, y] = box;
    await sendA('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sendA('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(1000);
  };

  // FULL applicationEvidence dump — the actual stored object the panel renders
  const dumpAll = () => evalPanel(`(async () => {
    const all = await chrome.storage.local.get(null);
    const li = all['live_interactions'] ?? all['cmdrunner_live_interactions'] ?? [];
    return li.map(i => {
      const bev = i.behavioralEvidence;
      const app = bev?.applicationEvidence;
      return {
        id: i.interactionId, type: i.type,
        triggerCss: i.triggerEvent?.target?.cssSelector ?? null,
        endReason: bev?.window?.endReason ?? null,
        durationMs: bev?.window?.durationMs ? Math.round(bev.window.durationMs) : null,
        targetCss: bev?.targetEvidence?.identity?.cssSelector ?? null,
        domChanges: app?.domChanges?.length ?? 0,
        domChangeOverflow: app?.domChangeOverflow ?? 0,
        coarseMode: app?.coarseMode ?? false,
        newSurfaces: (app?.newSurfaces ?? []).map(s => ({ tag: s.tagName, role: s.ariaRole, name: (s.accessibleName ?? '').slice(0,40), path: (s.path ?? '').slice(0,80), t: s.relativeTime })),
        removedSurfaces: (app?.removedSurfaces ?? []).map(s => ({ tag: s.tagName, role: s.ariaRole, name: (s.accessibleName ?? '').slice(0,40) })),
        visibilityChanges: (app?.visibilityChanges ?? []).map(v => ({ path: (v.path ?? '').slice(0,80), prop: v.property, old: (v.oldValue ?? '').slice(0,20), neu: (v.newValue ?? '').slice(0,20), t: v.relativeTime })),
        nav: app?.navigation?.length ?? 0,
        net: app?.networkActivity?.length ?? 0,
      };
    });
  })()`);

  const runScenario = async (name, path) => {
    await goApp(REPLICA + path);
    await sleep(1500);
    await focusAppAndCmd('START_RECORDING');
    await sleep(1200);
    await click('#add-to-cart-button');
    const openedAt = await evalApp('window.__dialogOpenAt');
    await sleep(5000);
    await focusAppAndCmd('STOP_RECORDING');
    await sleep(3500);
    const ints = await dumpAll();
    console.log(`\n═══ ${name} (dialog opened at +${openedAt}ms) ═══`);
    console.log(JSON.stringify(ints, null, 1));
    await evalPanel(`(async () => { await chrome.storage.local.remove('live_interactions'); return 'cleared'; })()`).catch(() => {});
    return ints;
  };

  const A_ints = await runScenario('A: Amazon shape (dialog +500ms, AFTER window close)', '/a');
  const B_ints = await runScenario('B: control (dialog +100ms, INSIDE window)', '/b');
  const C_ints = await runScenario('C: classifier probe (roleless dialog +100ms, INSIDE window)', '/c');

  // ── verdicts ─────────────────────────────────────────────────────────
  const atcOf = (ints) => ints.find((i) => (i.triggerCss ?? '').includes('add-to-cart-button'));
  const hasDialogSurface = (ints) => ints.some((i) => i.newSurfaces.some((s) => (s.path ?? '').includes('added-to-cart-dialog')));
  const hasPopoverVis = (ints) => ints.some((i) => i.visibilityChanges.some((v) => (v.path ?? '').includes('attach-popover')));

  const aAtc = atcOf(A_ints);
  console.log('\n── VERDICTS ──');
  console.log(`A dialog(+500ms) captured as newSurface ANYWHERE: ${hasDialogSurface(A_ints) ? 'YES' : 'NO — never captured'}`);
  console.log(`A popover visibility change captured ANYWHERE: ${hasPopoverVis(A_ints) ? 'YES' : 'NO — never captured'}`);
  if (aAtc) console.log(`A atc click: window=${aAtc.endReason}/${aAtc.durationMs}ms dom=${aAtc.domChanges} new=${aAtc.newSurfaces.length} vis=${aAtc.visibilityChanges.length} net=${aAtc.net}`);
  console.log(`B control dialog(+100ms) captured as newSurface: ${hasDialogSurface(B_ints) ? 'YES — pipeline works when inside window' : 'NO — classifier/pipeline defect'}`);
  if (atcOf(B_ints)) console.log(`B atc click: window=${atcOf(B_ints).endReason}/${atcOf(B_ints).durationMs}ms dom=${atcOf(B_ints).domChanges} new=${atcOf(B_ints).newSurfaces.length} vis=${atcOf(B_ints).visibilityChanges.length} net=${atcOf(B_ints).net}`);
  console.log(`C roleless dialog(+100ms) in newSurfaces: ${hasDialogSurface(C_ints) ? 'YES' : 'NO — direct-node role/tag classifier misses roleless divs'}`);
  console.log(`console errors in app tab: ${consoleErrors.length === 0 ? 'none' : consoleErrors.slice(0,3).join(' | ')}`);
} catch (e) {
  console.error('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e.message);
} finally {
  try { await browser.close(); } catch {}
  chrome.kill('SIGKILL');
  srv.close();
  process.exit(0);
}
