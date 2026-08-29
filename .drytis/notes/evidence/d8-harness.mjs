// D8 real-Chrome validation harness — NetworkBridge ready-handshake truth.
// Proven CDP recipe: pinned Chrome 148, replica :8098, two-tab dance,
// panel-websocket routing.
//
// Probes:
//   1. data-cmdrunner-net-ready marker === 'true' on the app tab at load
//      (manifest MAIN-world content script sets it).
//   2. Marker survives navigation (each document's inject sets it fresh).
//   3. During recording a MAIN-world fetch is captured as main-world
//      evidence (the consequence of the interceptor working) — check the
//      network evidence via the bridge's public signal: dispatch a fetch
//      and read it back through BehavioralEvidence storage (indirect) OR
//      the honest direct check: window.__cmdrunnerNetPatched === true in
//      MAIN world.
//   4. After STOP_RECORDING, the marker is CLEARED (stop handler ran) —
//      proves the stop path's marker cleanup in vivo.
//   5. Second recording: marker set again (re-injection guard path).
//   6. Zero console errors.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';

const PORT = 9533;
const APP = 'http://127.0.0.1:8098/';
const PANEL = (extId) => `chrome-extension://${extId}/src/sidepanel/index.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[d8]', ...a);
const results = [];
const check = (name, pass, evidence = '') => {
  results.push({ name, pass, evidence });
  log(`${pass ? 'PASS' : 'FAIL'} — ${name}${evidence ? ` — ${evidence}` : ''}`);
};
const consoleErrors = [];

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
  log('extension id:', extId);

  const { targetId: appTab } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { targetId: panelTab } = await browser.send('Target.createTarget', { url: PANEL(extId) });
  const attach = async (id) => (await browser.send('Target.attachToTarget', { targetId: id, flatten: true })).sessionId;
  const A = await attach(appTab);
  const P = await attach(panelTab);
  const sendA = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: A });
  const sendP = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: P });
  await sendA('Runtime.enable'); await sendA('Page.enable');
  await sendP('Runtime.enable'); await sendP('Page.enable');

  const evalApp = async (e) => {
    const r = await sendA('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('app eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 250));
    return r.result.value;
  };
  async function evalPanelRaw(e) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = list.find((t) => t.type === 'page' && t.url.includes('src/sidepanel/index.html'));
    if (!p?.webSocketDebuggerUrl) throw new Error('panel page ws not found');
    const WS = (await import('/workspace/node_modules/ws/index.js')).default;
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
    if (r.exceptionDetails) throw new Error('panel eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 200));
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
      if (u.startsWith('http://127.0.0.1:8098')) return u;
      if (i === 5) await sendA('Page.navigate', { url }).catch(() => {});
    }
    throw new Error(`app navigation to ${url} failed`);
  };
  const sendCmd = async (type_) => {
    await evalPanel(`(async () => {
      let id = null;
      try { id = parseInt('${appTab}', 16); } catch {}
      let tab = (await chrome.tabs.query({})).find((t) => t.id === id);
      if (!tab) tab = (await chrome.tabs.query({ url: 'http://127.0.0.1:8098/*' })).pop();
      if (!tab) throw new Error('app tab not found');
      await chrome.tabs.update(tab.id, { active: true });
      return 'focused ' + tab.id;
    })()`);
    await sleep(500);
    await evalPanel(`chrome.runtime.sendMessage({type:'${type_}'}).then(()=>'sent',e=>{throw e})`);
    await sleep(300);
  };

  // ── 1. Marker present at document load ──
  await goApp(APP);
  await sleep(1500);
  const markerAtLoad = await evalApp("document.documentElement.getAttribute('data-cmdrunner-net-ready')");
  check('marker data-cmdrunner-net-ready = true at document load', markerAtLoad === 'true', JSON.stringify(markerAtLoad));

  // ── 3. Interceptor genuinely installed in MAIN world ──
  const patched = await evalApp('window.__cmdrunnerNetPatched === true');
  check('MAIN-world interceptor installed (__cmdrunnerNetPatched)', patched === true, String(patched));

  // ── start recording; marker persists; a fetch fires MAIN-world dispatch ──
  await sendCmd('START_RECORDING');
  await sleep(1500);
  const markerDuringRec = await evalApp("document.documentElement.getAttribute('data-cmdrunner-net-ready')");
  check('marker still true during recording', markerDuringRec === 'true', JSON.stringify(markerDuringRec));

  // Direct in-vivo proof the MAIN-world event flows: listen in ISOLATED-ish
  // context (same window dispatch), then trigger a fetch from the page.
  await evalApp(`(() => { window.__d8NetSeen = 0; window.addEventListener('cmdrunner-net', () => { window.__d8NetSeen++; }); return 'listening'; })()`);
  await evalApp(`fetch('/search.html?q=d8probe').catch(() => {})`);
  await sleep(1200);
  const netSeen = await evalApp('window.__d8NetSeen');
  check('cmdrunner-net events flow during recording (fetch observed)', netSeen >= 2, `events=${netSeen}`);

  // record a tiny flow so a real session exists for the stop check
  await sendCmd('STOP_RECORDING');
  await sleep(4000);
  const markerAfterStop = await evalApp("document.documentElement.getAttribute('data-cmdrunner-net-ready')");
  check('marker CLEARED after STOP_RECORDING (stop handler ran)', markerAfterStop === null, JSON.stringify(markerAfterStop));

  // ── 5. Second recording: re-injection guard path re-sets the marker ──
  await evalPanel("(async () => { const b = document.getElementById('record-another-btn'); if (b) b.click(); await new Promise(r=>setTimeout(r,800)); return 'ok'; })()");
  await sleep(500);
  await goApp(APP);
  await sleep(500);
  await sendCmd('START_RECORDING');
  await sleep(2000);
  const markerSession2 = await evalApp("document.documentElement.getAttribute('data-cmdrunner-net-ready')");
  check('second session: marker set again (guard/re-injection path)', markerSession2 === 'true', JSON.stringify(markerSession2));
  const patched2 = await evalApp('window.__cmdrunnerNetPatched === true');
  check('second session: interceptor still installed', patched2 === true, String(patched2));
  await sendCmd('STOP_RECORDING');
  await sleep(6000);

  // ── 6. Zero console errors ──
  check('zero console errors in app tab', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');

  const fails = results.filter((r) => !r.pass).length;
  log(`\n==== D8 REAL-CHROME RESULT: ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails === 0 ? 0 : 1);
} catch (e) {
  log('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e.message);
  process.exit(2);
}
