// D10 (audit D11) real-Chrome validation harness.
// Pattern: proven D9/D2-D3 two-tab dance (persistent app tab + panel tab;
// runtime messages routed through the panel page's dedicated websocket;
// app tab focused via chrome.tabs.update before START/STOP).
//
// Replica: /tmp/d10-val/server.mjs — same shop flow, but page titles carry
//   /                     -> Bob's Shop         (single-quote content, plain)
//   /search.html?q=...    -> Search "Bazaar"    (embedded double quotes)
//   /product.html?id=P100 -> Product            (plain)
//   /cart.html            -> "Cart"             (fully pre-wrapped in quotes)
//
// Probes:
//   A. Record purchase flow; STOP → session interactions persisted.
//   B. Recorded Navigation interactions exist for quoted-title pages.
//   C. Observed Workflow panel DOM: every .interaction-action-text label is
//      free of doubled quotes ("") — the D11 symptom.
//   D. Quoted-title page label renders single-quoted inside ONE pair:
//      Navigate to "Search 'Bazaar'".
//   E. Pre-wrapped title page does NOT double-wrap: Navigate to "Cart".
//   F. Plain-title label unchanged: Navigate to "Product" (regression).
//   G. businessMeaning strings in stored interactions are quote-safe.
//   H. Zero unexpected console errors in the app tab.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';

const PORT = 9533;
const APP = 'http://127.0.0.1:8098/';
const PANEL = (extId) => `chrome-extension://${extId}/src/sidepanel/index.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[d10]', ...a);
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
      if (u === url) return u;
      if (u.startsWith('http://127.0.0.1:8098')) return u;
      if (i === 5) await sendA('Page.navigate', { url }).catch(() => {});
    }
    throw new Error(`app navigation to ${url} failed`);
  };

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
    await sleep(12000); // stop pipeline + persistence; panel keeps live_interactions
  };

  // Reload the panel so the stopped view re-renders from storage (the panel
  // tab existed before STOP; a reload guarantees fresh DOM for probing).
  const reloadPanel = async () => {
    await evalPanelRaw("(async () => { location.reload(); await new Promise(r=>setTimeout(r,2500)); return 'reloaded'; })()").catch(() => {});
    await sleep(1500);
  };

  // ══ SESSION ══
  await goApp(APP);
  await sleep(500);
  await sendCmd('START_RECORDING');
  await sleep(1500);
  await recordFlow();

  // A. interactions persisted (the panel's Observed Workflow source key)
  const stored = await evalPanel(`(async () => (await chrome.storage.local.get('cmdrunner_live_interactions')).cmdrunner_live_interactions)()`);
  const ints = Array.isArray(stored) ? stored : (stored?.interactions ?? []);
  check('session interactions persisted', ints.length >= 5, `interactions=${ints.length}`);

  // B. Navigation interactions exist for quoted-title pages
  const navs = ints.filter((i) => i.type === 'Navigation');
  const titles = navs.map((n) => String(n.metadata?.pageTitle ?? ''));
  check('Navigation interactions recorded with quoted titles', navs.length >= 2, `nav titles: ${JSON.stringify(titles)}`);

  // G. businessMeaning strings are quote-safe (no "" anywhere, single-quote inside)
  const navMeanings = navs.map((n) => String(n.businessMeaning ?? ''));
  const searchMeaning = navMeanings.find((m) => m.includes('Search'));
  const cartMeaning = navMeanings.find((m) => m.toLowerCase().includes('cart'));
  check('stored businessMeaning: quoted-title page label is quote-safe', !!searchMeaning && !searchMeaning.includes('""'),
    searchMeaning ?? 'missing');
  check('stored businessMeaning: pre-wrapped title not double-wrapped', !!cartMeaning && !cartMeaning.includes('""'),
    cartMeaning ?? 'missing');
  if (searchMeaning) check('stored businessMeaning: exact expected label (Search)', searchMeaning === `Navigate to "Search 'Bazaar'"`, searchMeaning);
  if (cartMeaning) check('stored businessMeaning: exact expected label (Cart)', cartMeaning === 'Navigate to "Cart"', cartMeaning);

  // C–F. panel DOM after STOP renders Observed Workflow with quote-safe labels
  await reloadPanel();
  const panelLabels = await evalPanel(`(() => {
    const els = document.querySelectorAll('.interaction-action-text');
    return Array.from(els).map((e) => e.textContent ?? '');
  })()`);
  const joined = (panelLabels ?? []).join(' || ');
  check('Observed Workflow labels rendered', (panelLabels ?? []).length >= 5, `labels=${(panelLabels ?? []).length}`);
  check('NO rendered label contains doubled quotes (D11 symptom gone)', !joined.includes('""'),
    joined.match(/[^|]*""[^|]*/)?.[0]?.slice(0, 90) ?? 'none');
  check('panel label: quoted-title page -> single quotes inside one pair', panelLabels.some((l) => l === `Navigate to "Search 'Bazaar'"`),
    (panelLabels ?? []).filter((l) => l.includes('Search')).join(' ; ') || 'not found');
  check('panel label: pre-wrapped title -> no double-wrap', panelLabels.some((l) => l === 'Navigate to "Cart"'),
    (panelLabels ?? []).filter((l) => l.toLowerCase().includes('cart')).join(' ; ') || 'not found');
  check('panel label: plain title unchanged (regression)', panelLabels.some((l) => l === 'Navigate to "Product"'),
    (panelLabels ?? []).filter((l) => l.includes('Product')).join(' ; ') || 'not found');

  // H. zero console errors
  check('zero console errors in app tab', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');

  const fails = results.filter((r) => !r.pass).length;
  log(`\n==== D10 REAL-CHROME RESULT: ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails === 0 ? 0 : 1);
} catch (e) {
  log('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e.message);
  process.exit(2);
}
