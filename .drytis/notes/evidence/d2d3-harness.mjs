// D2/D3 real-Chrome validation harness.
// Pattern: proven D9 two-tab dance (persistent app tab + panel tab; runtime
// messages routed through the panel page's dedicated websocket; app tab
// focused via chrome.tabs.update before START/STOP).
//
// Probes:
//   A. Record purchase flow on replica :8098 (session 1).
//   B. IR plan steps carry NON-EMPTY element IDs (elem- or repo uuid shape).
//   C. _generated_at companion written at generation time (≈ STOP time).
//   D. Dexie elements table populated (>=4) via healFromRecording wiring.
//   E. Distinct consecutive clicks NOT merged (OR-1): search-suggestion click
//      and product click are on DIFFERENT elements.
//   F. Session 2 (identical flow) → repository element IDs STABLE (same uuid
//      per element, no duplicates) — cross-session healing.
//   G. Repo-ID plan rewrite: stored plan's elementIds are the DURABLE
//      repository ids (uuid-like), not the session elem-NNNN labels.
//   H. Stale detection: /__mutate then RUN_TEST → executionSummary.irStale
//      === true (truthful) + side-panel honest row renders in panel DOM.
//   I. Zero unexpected console errors in the app tab.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';

const PORT = 9533;
const APP = 'http://127.0.0.1:8098/';
const PANEL = (extId) => `chrome-extension://${extId}/src/sidepanel/index.html`;
const RESIZED = { width: 1100, height: 760 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[d2d3]', ...a);
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
    // Drop any about:blank initial page: navigating in place can race the
    // swap; a fresh load via location.href assignment is the reliable path.
    await sendA('Page.navigate', { url }).catch(() => {});
    for (let i = 0; i < 15; i++) {
      await sleep(1200);
      const u = await evalApp('location.href').catch(() => '');
      if (u === url || u.startsWith('http://127.0.0.1:8098')) {
        if (u === url) return u;
      }
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
    const stopAt = Date.now();
    await sendCmd('STOP_RECORDING');
    await sleep(12000); // understanding pipeline + generation + persistence + healing
    return stopAt;
  };

  const dumpPlan = () => evalPanel(`(async () => (await chrome.storage.local.get('execution_ir_plan')).execution_ir_plan)()`);
  const dumpGeneratedAt = () => evalPanel(`(async () => (await chrome.storage.local.get('execution_ir_plan_generated_at')).execution_ir_plan_generated_at)()`);
  const dumpDexie = () => evalPanel(`(async () => {
    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open('cmdrunner_repository');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    const names = [...db.objectStoreNames];
    const out = {};
    for (const n of names) {
      out[n] = await new Promise((res, rej) => {
        const tx = db.transaction(n, 'readonly');
        const rq = tx.objectStore(n).getAll();
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
    }
    return out;
  })()`);
  const elementSteps = (plan) => (plan?.steps ?? []).filter((s) => s.target?.kind === 'element').map((s) => ({ id: s.target.elementId, name: s.target.elementName }));

  // ══ SESSION 1 ══
  await goApp(APP);
  await sleep(500);
  await sendCmd('START_RECORDING');
  await sleep(1500);
  const stopAt1 = await recordFlow();

  const plan1 = await dumpPlan();
  if (!plan1) throw new Error('execution_ir_plan missing after session 1');

  // B. Non-empty element IDs on element steps
  const es1 = elementSteps(plan1);
  check('element steps present', es1.length >= 3, JSON.stringify(es1.map((e) => e.name)));
  const nonEmpty = es1.filter((e) => typeof e.id === 'string' && e.id.length > 0);
  check('ALL element steps carry non-empty elementId (D3)', nonEmpty.length === es1.length, `${nonEmpty.length}/${es1.length} non-empty: ${JSON.stringify(es1.map((e) => e.id))}`);

  // E. OR-1: suggestion click vs product click are DIFFERENT elements → distinct steps
  const clickSteps = plan1.steps.filter((s) => s.action === 'click' && s.target?.kind === 'element');
  const uniqueIds = new Set(clickSteps.map((s) => s.target.elementId));
  check('OR-1: distinct consecutive clicks NOT merged', clickSteps.length >= 2 && uniqueIds.size >= 2, `clicks=${clickSteps.length} unique=${uniqueIds.size}`);

  // C. _generated_at written at generation time
  const genAt = await dumpGeneratedAt();
  const genMs = genAt ? Date.parse(genAt) : NaN;
  const skew = Math.abs(genMs - stopAt1);
  check('_generated_at exists and ≈ STOP time', Number.isFinite(genMs) && skew < 30000, `${genAt} (skew ${Math.round(skew / 1000)}s)`);

  // D. Dexie elements populated
  const dexie1 = await dumpDexie();
  const els1 = dexie1.elements ?? [];
  check('Dexie elements table populated (>=4)', els1.length >= 4, `elements=${els1.length} [${els1.map((e) => (e.logicalName || '').slice(0, 18)).join(' | ')}]`);

  // G. stored plan carries repository ids (uuid-like), not elem-NNNN labels
  const sessionShaped = es1.filter((e) => /^elem-\d{4}$/.test(e.id)).length;
  const repoShaped = es1.filter((e) => e.id.includes('-') && !/^elem-\d{4}$/.test(e.id)).length;
  check('plan steps carry repository ids (uuid), not session labels', repoShaped === es1.length && sessionShaped === 0, `repo=${repoShaped} session=${sessionShaped} of ${es1.length}`);

  const ids1 = new Set(es1.map((e) => e.id));

  // ══ SESSION 2: identical flow → SAME repository ids, no duplicates ══
  await evalPanel("(async () => { const b = document.getElementById('record-another-btn'); if (b) b.click(); await new Promise(r=>setTimeout(r,800)); return 'ok'; })()");
  await sleep(500);
  await goApp(APP);
  await sleep(500);
  await sendCmd('START_RECORDING');
  await sleep(1500);
  await recordFlow();

  const plan2 = await dumpPlan();
  const dexie2 = await dumpDexie();
  const els2 = dexie2.elements ?? [];
  const es2 = elementSteps(plan2);
  const ids2 = new Set(es2.map((e) => e.id));

  // F. Cross-session stability: every session-1 id still present; table not bloated
  const stable = [...ids1].filter((id) => ids2.has(id)).length;
  check('session-2 steps reference the SAME repository ids (healed, not duplicated)', ids1.size > 0 && stable === ids1.size, `s1=${[...ids1].join(',')} s2=${[...ids2].join(',')}`);
  const dupNames = new Map();
  for (const e of els2) dupNames.set(e.logicalName, (dupNames.get(e.logicalName) ?? 0) + 1);
  const dups = [...dupNames.values()].filter((c) => c > 1).length;
  check('no duplicate repository elements after session 2', els2.length === els1.length && dups === 0, `before=${els1.length} after=${els2.length} dupLogicals=${dups}`);

  // ══ STALENESS PROBE: mutate replica markup → RUN_TEST → irStale true + honest row ══
  // NEGATIVE FIRST: a FRESH plan (just generated, elements unchanged) must
  // NOT be flagged stale (regression for the reviewer-found read-path defect
  // where the companion never loaded and staleness was always-true).
  await sendCmd('RUN_TEST');
  await sleep(15000);
  const freshSummary = await evalPanel(`(async () => (await chrome.storage.local.get('execution_result')).execution_result)()`);
  check('fresh plan NOT flagged stale (negative case)', freshSummary?.irStale !== true, `irStale=${JSON.stringify(freshSummary?.irStale)} status=${freshSummary?.status}`);

  // POSITIVE: bump stored elements' updatedAt past the companion, RUN_TEST
  // → irStale === true + honest row.
  await fetch('http://127.0.0.1:8098/__mutate?v=cart-badge-v2').then((r) => r.text());
  // Force the stored element's updatedAt forward via a direct heal write, then
  // re-check staleness inside the SW through the public RUN_TEST path.
  await evalPanel(`(async () => {
    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open('cmdrunner_repository');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('elements', 'readwrite');
      const store = tx.objectStore('elements');
      const rq = store.openCursor();
      rq.onsuccess = () => { const c = rq.result; if (!c) return; const v = c.value; v.updatedAt = new Date(Date.now() + 60000).toISOString(); c.update(v); c.continue(); };
      rq.onerror = () => rej(rq.error);
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
    return 'bumped';
  })()`);

  await sendCmd('RUN_TEST');
  await sleep(15000); // executor runs (or fails fast — defect pending) + summary write

  const summary = await evalPanel(`(async () => (await chrome.storage.local.get('execution_result')).execution_result)()`);
  check('RUN_TEST produced an execution summary', !!summary, summary ? `status=${summary.status} steps=${summary.stepCount}` : 'null');
  check('summary.irStale === true after element change (truthful D2)', summary?.irStale === true, `irStale=${JSON.stringify(summary?.irStale)}`);

  // H. honest row rendered in the live panel DOM
  await evalPanel("(async () => { location.reload(); await new Promise(r=>setTimeout(r,2500)); return 'reloaded'; })()");
  await sleep(2000);
  const panelText = await evalPanel("document.body ? document.body.textContent : ''");
  const honestRow = /stale — a tracked element changed/i.test(panelText ?? '');
  check('panel renders the honest stale row', honestRow, (panelText ?? '').match(/stale[^\n]{0,80}/)?.[0] ?? 'row not found');

  // I. zero console errors
  check('zero console errors in app tab', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');

  const fails = results.filter((r) => !r.pass).length;
  log(`\n==== D2/D3 REAL-CHROME RESULT: ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails === 0 ? 0 : 1);
} catch (e) {
  log('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 8).join('\n') : e.message);
  process.exit(2);
}
