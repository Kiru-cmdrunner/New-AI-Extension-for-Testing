// Real-Chrome CDP validation: consequence-settling (spec §16 RC1–RC7)
// Runs against /workspace/dist. No source changes.
//
// RC1 Amazon-style delayed modal (causal chain: click → 34-fetch burst +
// slow /__api/add → +600ms role=dialog + popover unhides)
// RC2 fast modal (+100ms, in-window effect — no regression)
// RC3 form-submit navigation: Click page-reload + SEPARATE Navigation
// RC4 polling replica (1s causal poll + telemetry noise): bounded settle
// RC5 slow XHR (2.5s causal): response DOM consequence captured
// RC6 no-consequence: settles, empty arrays, no console errors
// RC7 cross: zero console errors; click/navigation never merged; target
//            identity preserved everywhere.
import CDP from 'chrome-remote-interface';
import fs from 'node:fs';
import http from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/settle-rc-profile';
const DIST = '/workspace/dist';
const PORT = 9555;
const APP_PORT = 8097;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shell = (title) => `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui;margin:2rem}
#attach-popover{position:fixed;top:60px;right:20px;width:280px;border:1px solid #ddd;border-radius:8px;padding:12px;background:#fff}
#attach-popover[aria-hidden="true"]{display:none}
.a-button-input{background:#ffa41c;border:1px solid #ff8f00;border-radius:8px;padding:8px 18px;cursor:pointer}
#cart-count{font-weight:700;color:#b12704}</style></head><body><h1>${title}</h1>
<p>Cart: <span id="cart-count">0</span></p>
<form id="addToCart" method="post" action="/nav-submit"><span class="a-button-primary">
<input type="submit" value="Add to Cart" id="add-to-cart-button" class="a-button-input"></span></form>
<div id="attach-popover" aria-hidden="true" role="region"><strong>Added to cart</strong></div>
<div id="buybox"></div></body></html>`;

const srv = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${APP_PORT}`);
  if (u.pathname === '/' || u.pathname.startsWith('/p/')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(shell('Settle RC replica'));
    return;
  }
  if (u.pathname === '/nav-submit') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(shell('Cart (destination)')); return; }
  if (u.pathname.startsWith('/__api/')) {
    const slow = u.searchParams.get('slow');
    const delay = slow ? parseInt(slow, 10) : 350;
    setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }, delay);
    return;
  }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => srv.listen(APP_PORT, r));

fs.rmSync(PROFILE, { recursive: true, force: true });
const { spawn } = await import('node:child_process');
const chrome = spawn(CHROME_BIN, [
  `--load-extension=${DIST}`, `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox',
  '--disable-gpu', '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });
await sleep(4000);

const browser = await CDP({ port: PORT });
const consoleErrors = [];
let consoleErrorHook = null;
const results = [];
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
  const extId = sw.url.split('/')[2];
  const { targetId: appTab } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
  const attach = async (id) => (await browser.send('Target.attachToTarget', { targetId: id, flatten: true })).sessionId;
  const A = await attach(appTab);
  const sendA = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: A });
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

  consoleErrorHook = (p) => {
    if (p.sessionId === A && p.params?.type === 'error') consoleErrors.push('[app] ' + (p.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '));
  };
  browser.on('Runtime.consoleAPICalled', consoleErrorHook);

  const goApp = async (url) => {
    await browser.send('Target.activateTarget', { targetId: appTab });
    await sleep(300);
    await sendA('Page.navigate', { url }).catch(() => {});
    for (let i = 0; i < 15; i++) {
      await sleep(1200);
      const cur = await evalApp('location.href').catch(() => '');
      if (cur.startsWith(url.split('#')[0])) return cur;
      if (i === 5) await sendA('Page.navigate', { url }).catch(() => {});
    }
    throw new Error(`nav failed: ${url}`);
  };

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
    await sleep(800);
  };

  const dumpAll = () => evalPanel(`(async () => {
    const all = await chrome.storage.local.get(null);
    const li = all['live_interactions'] ?? all['cmdrunner_live_interactions'] ?? [];
    return li.map(i => {
      const bev = i.behavioralEvidence; const app = bev?.applicationEvidence;
      return { id: i.interactionId, type: i.type,
        triggerCss: i.triggerEvent?.target?.cssSelector ?? null,
        endReason: bev?.window?.endReason ?? null,
        durationMs: bev?.window?.durationMs ? Math.round(bev.window.durationMs) : null,
        targetCss: bev?.targetEvidence?.identity?.cssSelector ?? null,
        dom: app?.domChanges?.length ?? 0,
        newSurfaces: (app?.newSurfaces ?? []).map(s => ({ tag: s.tagName, role: s.ariaRole, name: (s.accessibleName ?? '').slice(0,30) })),
        visChanges: (app?.visibilityChanges ?? []).map(v => ({ path: (v.path ?? '').slice(0,60), prop: v.property, old: v.oldValue, neu: v.newValue })),
        nav: app?.navigation?.length ?? 0,
        net: app?.networkActivity?.length ?? 0 };
    });
  })()`);

  const clearInteractions = () => evalPanel(`(async () => { await chrome.storage.local.remove('live_interactions'); return 1; })()`).catch(() => {});
  const check = (id, name, ok, detail) => { results.push({ id, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${name}${detail ? ' — ' + detail : ''}`); };

  const runScenario = async (name, setupJs, clickSel, waitMs) => {
    await goApp(REPLICA + '/p/' + Math.random().toString(36).slice(2));
    await sleep(1500);
    await focusAppAndCmd('START_RECORDING');
    await sleep(1200);
    if (setupJs) await evalApp(setupJs).catch((e) => console.log('[setup warn]', e.message));
    if (clickSel) await click(clickSel);
    await sleep(waitMs);
    await focusAppAndCmd('STOP_RECORDING');
    await sleep(3500);
    const ints = await dumpAll();
    console.log(`\n═══ ${name} ═══`);
    console.log(JSON.stringify(ints, null, 1));
    await clearInteractions();
    return ints;
  };

  // ── RC1: Amazon-style delayed modal (causal chain) ─────────────────
  const r1 = await runScenario('RC1 delayed modal (causal burst + slow add → +600ms dialog)', `
    window.__atcRun = () => {
      document.getElementById('cart-count').textContent = '2';
      const bb = document.getElementById('buybox');
      for (let i=0;i<6;i++){ const s=document.createElement('span'); s.textContent='q'+i; bb.appendChild(s); }
      for (let i=0;i<34;i++){ setTimeout(()=>{ fetch('/__api/burst/'+i+'?r='+Math.floor(Math.random()*1e6)).catch(()=>{}); }, 400+i*15); }
      fetch('/__api/add?slow=1200').then(() => {
        const d = document.createElement('div'); d.id='added-to-cart-dialog'; d.setAttribute('role','dialog'); d.setAttribute('aria-label','Added to cart');
        d.textContent='Added to cart'; document.body.appendChild(d);
        document.getElementById('attach-popover').setAttribute('aria-hidden','false');
      });
    };
    document.getElementById('addToCart').addEventListener('submit', (e) => { e.preventDefault(); window.__atcRun(); });
    'armed'`, '#add-to-cart-button', 6500);
  {
    const click = r1.find((i) => (i.triggerCss ?? '').includes('add-to-cart-button'));
    check('RC1.1', 'click interaction captured', !!click);
    check('RC1.2', 'endReason consequence-settled', click?.endReason === 'consequence-settled', `got ${click?.endReason}/${click?.durationMs}ms`);
    check('RC1.3', 'dialog in newSurfaces', click?.newSurfaces?.some((s) => s.role === 'dialog'), JSON.stringify(click?.newSurfaces ?? []));
    check('RC1.4', 'popover visibility change', click?.visChanges?.some((v) => (v.path ?? '').includes('attach-popover') && v.neu === 'false'), JSON.stringify(click?.visChanges ?? []));
    check('RC1.5', 'network burst merged', (click?.net ?? 0) >= 20, `net=${click?.net}`);
    check('RC1.6', 'window spans the dialog (>600ms)', (click?.durationMs ?? 0) > 600, `${click?.durationMs}ms`);
    check('RC1.7', 'target identity preserved', click?.targetCss === '#add-to-cart-button', `target=${click?.targetCss}`);
  }

  // ── RC2: fast modal ────────────────────────────────────────────────
  const r2 = await runScenario('RC2 fast modal (+100ms)', `
    document.getElementById('addToCart').addEventListener('submit', (e) => { e.preventDefault();
      setTimeout(() => { const d = document.createElement('div'); d.setAttribute('role','dialog'); d.setAttribute('aria-label','Added to cart'); document.body.appendChild(d); }, 100);
    });
    'armed'`, '#add-to-cart-button', 4500);
  {
    const c2 = r2.find((i) => (i.triggerCss ?? '').includes('add-to-cart-button'));
    check('RC2.1', 'fast modal captured', c2?.newSurfaces?.some((s) => s.role === 'dialog'));
    check('RC2.2', 'endReason consequence-settled', c2?.endReason === 'consequence-settled', `got ${c2?.endReason}`);
  }

  // ── RC3: form-submit navigation (separate interactions) ────────────
  const r3 = await runScenario('RC3 form-submit navigation (no preventDefault → /nav-submit)', `
    document.getElementById('addToCart').addEventListener('submit', () => {}); 'armed'`,
    '#add-to-cart-button', 6000);
  {
    const types = r3.map((i) => i.type);
    check('RC3.1', 'Click and Navigation both recorded as separate interactions',
      types.includes('Click') && types.includes('Navigation'), JSON.stringify(types));
    const clk = r3.find((i) => i.type === 'Click');
    const nav = r3.find((i) => i.type === 'Navigation');
    check('RC3.2', 'Click window page-reload (unload path, unchanged)', clk?.endReason === 'page-reload', `got ${clk?.endReason}`);
    check('RC3.3', 'Navigation interaction has evidence', !!nav?.endReason, `nav=${nav?.endReason}/${nav?.durationMs}ms`);
  }

  // ── RC4: polling ───────────────────────────────────────────────────
  const r4 = await runScenario('RC4 polling (1s causal poll + telemetry noise, no DOM change)', `
    window.__pollTimer = setInterval(() => { fetch('/__api/poll?r='+Math.floor(Math.random()*1e6)).catch(()=>{}); }, 1000);
    fetch('/__api/telemetry').catch(()=>{});
    document.getElementById('addToCart').addEventListener('submit', (e) => { e.preventDefault(); fetch('/__api/poll?kick=1').catch(()=>{}); });
    'armed'`, '#add-to-cart-button', 5000);
  {
    const c4 = r4.find((i) => (i.triggerCss ?? '').includes('add-to-cart-button'));
    check('RC4.1', 'settles (no cap hit)', c4?.endReason === 'consequence-settled', `got ${c4?.endReason}/${c4?.durationMs}ms`);
    check('RC4.2', 'bounded — well under the 10s cap', (c4?.durationMs ?? 99999) < 6000, `${c4?.durationMs}ms`);
  }

  // ── RC5: slow XHR ──────────────────────────────────────────────────
  const r5 = await runScenario('RC5 slow XHR (2.5s causal fetch → DOM consequence)', `
    document.getElementById('addToCart').addEventListener('submit', (e) => { e.preventDefault();
      fetch('/__api/slowadd?slow=2500').then(() => { const d = document.createElement('div'); d.setAttribute('role','alert'); d.setAttribute('aria-label','Order placed'); document.body.appendChild(d); });
    });
    'armed'`, '#add-to-cart-button', 7000);
  {
    const c5 = r5.find((i) => (i.triggerCss ?? '').includes('add-to-cart-button'));
    check('RC5.1', 'waited for slow request (window > 2.5s)', (c5?.durationMs ?? 0) > 2500, `${c5?.durationMs}ms`);
    check('RC5.2', 'response DOM consequence captured', c5?.newSurfaces?.some((s) => s.role === 'alert'), JSON.stringify(c5?.newSurfaces ?? []));
    check('RC5.3', 'endReason consequence-settled', c5?.endReason === 'consequence-settled', `got ${c5?.endReason}`);
  }

  // ── RC6: no consequence ────────────────────────────────────────────
  const r6 = await runScenario('RC6 no consequence', `
    document.getElementById('addToCart').addEventListener('submit', (e) => { e.preventDefault(); });
    'armed'`, '#add-to-cart-button', 3500);
  {
    const c6 = r6.find((i) => (i.triggerCss ?? '').includes('add-to-cart-button'));
    check('RC6.1', 'settles with empty consequence', c6?.endReason === 'consequence-settled', `got ${c6?.endReason}/${c6?.durationMs}ms`);
    check('RC6.2', 'no surfaces', (c6?.newSurfaces?.length ?? 1) === 0);
    check('RC6.3', 'bounded quick settle', (c6?.durationMs ?? 99999) < 2000, `${c6?.durationMs}ms`);
  }

  // ── RC7: cross-scenario invariants ─────────────────────────────────
  check('RC7.1', 'zero console errors in all scenarios', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));
  check('RC7.2', 'RC1 click/nav never merged (single Click interaction)', r1.filter((i) => i.type === 'Click').length === 1);
  check('RC7.3', 'RC3 click target preserved', r3.find((i) => i.type === 'Click')?.targetCss === '#add-to-cart-button');
} catch (e) {
  console.error('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e.message);
} finally {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n════ RESULT: ${pass}/${results.length} PASS ${pass === results.length ? '' : '— ' + results.filter((r) => !r.ok).map((r) => r.id).join(', ')} ════`);
  try { await browser.close(); } catch {}
  chrome.kill('SIGKILL');
  srv.close();
  process.exit(0);
}
