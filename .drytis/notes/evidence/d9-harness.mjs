// D9 real-Chrome validation harness (v2 — persistent two-tab dance).
// Fix vs v1: a temp /json/new panel page steals tab focus (becomes ACTIVE
// TAB), so getActiveTab() at START/STOP captured the panel URL. Now we
// create the panel tab ONCE, then toggle activity: activate APP tab → send
// runtime message from the (background) panel tab's session. The panel tab
// never needs to be active to send runtime messages.
//
// Probes (D9):
//   1. Resize window to 1100×760 BEFORE START (viewport capture proof).
//   2. Record purchase flow on replica.
//   3. Assert plan: hex8 IDs, startUrl = recorded page, baseUrl = origin,
//      viewport = captured content-box, config origin baseURL + viewport.
//   4. Second identical session → identical IDs (in-vivo INV-GEN-1).
//   5. Zero console errors.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';

const PORT = 9533;
const APP = 'http://127.0.0.1:8098/';
const PANEL = (extId) => `chrome-extension://${extId}/src/sidepanel/index.html`;
const RESIZED = { width: 1100, height: 760 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[d9]', ...a);
const results = [];
const check = (name, pass, evidence = '') => {
  results.push({ name, pass, evidence });
  log(`${pass ? 'PASS' : 'FAIL'} — ${name}${evidence ? ` — ${evidence}` : ''}`);
};
const consoleErrors = [];

const browser = await CDP({ port: PORT });
try {
  // MV3 SW starts dormant — wake it by opening the panel page once, then scan.
  // Target.getTargets on the browser endpoint may not list service workers;
  // enable discovery with flatten so SW targets appear.
  await browser.send('Target.setDiscoverTargets', { discover: true, flatten: true }).catch(() => {});
  const KNOWN_ID = 'gndjidfncanlhlonpcabokbdhnikglpn'; // stable for this dist
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

  // Clean slate: close every pre-existing tab/page (stray panels from failed
  // runs steal focus and corrupt getActiveTab()), then create our own pair.
  const { targetInfos: allTargets } = await browser.send('Target.getTargets');
  // NOTE: do NOT close the SW-adjacent targets; only stray PAGES. Closing the
  // page that hosts the browser's ws connection kills it — instead just
  // deactivate them by creating our tabs last. Chrome only keeps ONE active
  // tab; our final activateTarget(appTab) fixes focus for good.
  const existing = allTargets.filter((t) => (t.type === 'page') && !t.url.startsWith('devtools') && t.url !== 'about:blank');
  // Tab 1: app (recording target). Tab 2: panel (runtime message sender).
  const { targetId: appTab } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { targetId: panelTab } = await browser.send('Target.createTarget', { url: PANEL(extId) });
  // (Chrome tab id resolved lazily inside sendCmd — evalPanel is defined later.)
  const attach = async (id) => {
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId: id, flatten: true });
    return sessionId;
  };
  const A = await attach(appTab);
  const P = await attach(panelTab);
  const S = await attach(sw.targetId);
  const sendA = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: A });
  const sendP = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: P });
  const sendS = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: S });
  function evalSW(e) { return evalOn(S, e); }
  await sendA('Runtime.enable'); await sendA('Page.enable');
  await sendP('Runtime.enable'); await sendP('Page.enable');
  await sendS('Runtime.enable');


  async function evalOn(sid, expression) {
    const send = sid === A ? sendA : sendP;
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 250));
    return r.result.value;
  }
  const evalApp = (e) => evalOn(A, e);
  async function _evalPanelRawInner(e) {
    // Dedicated ws to the panel page — reliable live bindings.
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p = list.find((t) => t.type === 'page' && t.url.includes(PANEL(extId).replace('chrome-extension://' + extId + '/', '')));
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
    // Direct-ws shape: { result: { result: { value } } }
    return r.result?.result?.value;
  }

  const evalPanelRaw = (e) => _evalPanelRawInner(e);
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
    await sendA('Page.navigate', { url });
    for (let i = 0; i < 15; i++) {
      await sleep(1200);
      const u = await evalApp('location.href').catch(() => '');
      if (u.startsWith('http://127.0.0.1:8098')) return u;
    }
    throw new Error(`app navigation to ${url} failed`);
  };

  // Resize BEFORE anything else.
  const { windowId } = await browser.send('Browser.getWindowForTarget', { targetId: appTab });
  await browser.send('Browser.setWindowBounds', { windowId, bounds: RESIZED });
  await sleep(800);

  const type = async (sel, text) => {
    await sendA('Runtime.evaluate', { expression: `document.querySelector('${sel}').focus()` });
    for (const ch of text) {
      await sendA('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
      await sendA('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase() });
      await sleep(120);
    }
  };
  const click = async (sel) => {
    const box = await evalApp(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
    if (!box) throw new Error(`selector not found: ${sel} @ ${await evalApp('location.href')}`);
    const [x, y] = box;
    await sendA('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sendA('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(1100);
  };
  // START/STOP: activate the APP tab (so getActiveTab() = app), then send the
  // runtime message from the panel session (works while backgrounded).
  const sendCmd = async (type_) => {
    // Route runtime messages through the PANEL PAGE's own websocket (extension
    // pages keep live chrome.runtime bindings; the SW flat session is a
    // dormant preview). Focus the APP tab via chrome.tabs.update — the only
    // focus mechanism that reliably sticks in headless — so getActiveTab()
    // resolves to the app at START/STOP.
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

  const recordFlow = async () => {
    await goApp(APP);
    await type('#twotabsearchtextbox', 'headphones');
    for (let i = 0; i < 10; i++) {
      const has = await evalApp("!!document.querySelector('#suggestions div')");
      if (has === true) break;
      await sleep(400);
    }
    await click('#suggestions div');
    await sleep(1400);
    await click('#p100 .item');
    await sleep(1400);
    await click('#add-to-cart-button');
    await sleep(1600);
    await sendCmd('STOP_RECORDING');
    await sleep(10000);
  };

  // ── Session 1 ──
  // Navigate to the replica FIRST so getActiveTab() at START resolves to the
  // app page (not about:blank).
  await goApp(APP);
  await sleep(500);
  await sendCmd('START_RECORDING');
  await sleep(1500);
  await recordFlow();

  const dump = await evalPanel(`(async () => {
    const plan = (await chrome.storage.local.get('execution_ir_plan')).execution_ir_plan;
    const stored = (await chrome.storage.local.get('generated_files')).generated_files;
    const files = Array.isArray(stored) ? stored : (stored && Array.isArray(stored.files) ? stored.files : Object.values(stored || {}));
    const config = (files || []).find((f) => f && f.path === 'playwright.config.ts');
    const ctx = (await chrome.storage.local.get('session_context')).session_context;
    if (!plan) return { plan: null, storageKeys: Object.keys(await chrome.storage.local.get(null)), config: null, ctx: null };
    return { plan, config: config ? config.content : null, ctx };
  })()`);
  if (!dump || !dump.plan) {
    throw new Error('execution_ir_plan missing — dump=' + JSON.stringify(dump)?.slice(0, 400) + ' keys=' + JSON.stringify(dump?.storageKeys ?? []));
  }
  const plan = dump.plan;
  check('testCaseId is deterministic hex8 (not epoch)', /^tc-[0-9a-f]{8}$/.test(plan.testCaseId), plan.testCaseId);
  check('testCaseVersionId is deterministic hex8 (not epoch)', /^tcv-[0-9a-f]{8}$/.test(plan.testCaseVersionId), plan.testCaseVersionId);
  check('environment.startUrl is the recorded page', plan.environment.startUrl === 'http://127.0.0.1:8098/', JSON.stringify(plan.environment.startUrl));
  check('environment.baseUrl is origin (no path)', plan.environment.baseUrl === 'http://127.0.0.1:8098', JSON.stringify(plan.environment.baseUrl));
  const vp = plan.environment.viewport;
  check('viewport captured from resized window (≠1280×720)', vp && vp.width !== 1280 && vp.height !== 720, JSON.stringify(vp));
  check('viewport width = window width (content box)', vp && vp.width === RESIZED.width, `w=${vp.width} (window ${RESIZED.width})`);
  check('session_context persisted viewport too', dump.ctx && dump.ctx.viewport && dump.ctx.viewport.width === RESIZED.width, JSON.stringify(dump.ctx?.viewport));
  const cfg = dump.config || '';
  check('playwright.config baseURL = origin', cfg.includes("baseURL: 'http://127.0.0.1:8098'"), cfg.split('\n').find((l) => l.includes('baseURL'))?.trim() ?? 'config missing');
  check('playwright.config viewport = measured', cfg.includes(`viewport: { width: ${vp.width}, height: ${vp.height} }`), `expect w:${vp.width} h:${vp.height}`);

  const id1 = { tc: plan.testCaseId, tcv: plan.testCaseVersionId };

  // ── Session 2: identical flow → identical IDs ──
  // Reset the panel (Record another) and navigate the app tab BACK to the
  // start URL so session 2 captures the same startUrl as session 1.
  await evalPanel("(async () => { const b = document.getElementById('record-another-btn'); if (b) b.click(); await new Promise(r=>setTimeout(r,800)); return 'ok'; })()");
  await sleep(500);
  await goApp(APP);
  await sleep(500);
  await sendCmd('START_RECORDING');
  await sleep(1500);
  await recordFlow();

  const dump2 = await evalPanel(`(async () => (await chrome.storage.local.get('execution_ir_plan')).execution_ir_plan)()`);
  check('identical flow → identical testCaseId (in-vivo INV-GEN-1)', dump2.testCaseId === id1.tc, `${id1.tc} → ${dump2.testCaseId}`);
  check('identical flow → identical testCaseVersionId', dump2.testCaseVersionId === id1.tcv, `${id1.tcv} → ${dump2.testCaseVersionId}`);
  check('session 2 startUrl still the recorded page', dump2.environment.startUrl === 'http://127.0.0.1:8098/', JSON.stringify(dump2.environment.startUrl));

  check('zero console errors in app tab', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');

  const fails = results.filter((r) => !r.pass).length;
  log(`\n==== D9 REAL-CHROME RESULT: ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails === 0 ? 0 : 1);
} catch (e) {
  log('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e.message);
  process.exit(2);
}
