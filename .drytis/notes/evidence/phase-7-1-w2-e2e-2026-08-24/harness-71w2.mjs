// 7.1-W2 real-Chrome E2E harness (pin ⑪). House CDP pattern: fresh Chrome
// + fresh profile + fresh ports; PANEL-FIRST START; trusted CDP input; REAL
// form-GET document navigations (content script destroyed at each commit —
// the full-reload path); Dexie view-layer assertions.
//
// Matrix (spec §5 E2E / §3 scope):
//  W1  session 1: knowledgeViews contains 'search-results' AND 'cart' —
//      sourced from the FULL-RELOAD path (form_submit commits), not SPA.
//  W2  session 1: knowledgeViewTransitions contains search-results -> cart
//      (and >= 2 transition rows total: the cart->search-results back-nav).
//  W3  session 1: exactly ONE origin-only app row (7.0-KR regression).
//  W4  session 1: the Navigation interactions exist (full-reload synthetic
//      evidence path produced interactions, not placeholders).
//  W5  7.1-W1 marker regression: data-cmdrunner-nav-ready present in the
//      app tab (MAIN-world nav observer still injected on http pages).
//  W6  session 2 (same profile): view rows SHARED not duplicated,
//      sessionCount === 2, transition count REINFORCED.
//  W7  observation (NOT an AC): no chrome-extension app rows (identity
//      gate honesty under full reloads).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9500 + Math.floor(Math.random() * 400);
const APP_PORT = 8231;
const APP = `http://127.0.0.1:${APP_PORT}`;
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-7-1-w2-e2e-2026-08-24/dumps';
const PROFILE = '/tmp/71w2-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 900) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

// ── Fixture server: serves the REAL public/ fixture files (static, from
// disk — same bytes the preview serves). Every navigation is a REAL
// document replacement: form GET submits destroy the content script and
// land on a new URL, exactly the full-reload path under test.
const PUB = '/workspace/public';
const mime = { '.html': 'text/html', '.js': 'text/javascript' };
const httpd = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p === '/') p = '/search-form.html';
  const file = PUB + p;
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': mime[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  } else {
    res.writeHead(404); res.end('not found: ' + p);
  }
});
await new Promise((r) => httpd.listen(APP_PORT, '127.0.0.1', r));
out(`fixture server on ${APP} (serving /workspace/public — REAL static files, real document navigations)`);

// ── Chrome + extension ──
const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { out('FATAL: chrome never came up'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extId = t0.find(t => t.url.includes('service-worker-loader.js')).url.split('/')[2];
out('extId =', extId);

// PANEL FIRST (7.0 mis-stamp reproducer — keeps the identity regression
// honest under this flow too), then the app tab.
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
await sleep(2000);
let app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
await app.send('Page.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

// A full reload destroys the app-tab CDP session's document; re-attach and
// re-enable after every navigation.
const reattach = async () => {
  try { await app.detach(); } catch {}
  await sleep(400);
  for (let i = 0; i < 10; i++) {
    try { app = await CDP({ target: appTab, port: PORT }); await app.send('Runtime.enable'); await app.send('Page.enable'); return true; }
    catch { await sleep(400); }
  }
  return false;
};

const dexieProbe = async () => evalPanel(`(async () => {
  const names = await indexedDB.databases();
  const db = names.find(d => d.name && d.name.includes('cmdrunner_knowledge'));
  if (!db) return { found: false };
  const open = await new Promise((res, rej) => { const r = indexedDB.open(db.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const dump = {};
  for (const t of [...open.objectStoreNames]) {
    const rows = await new Promise((res) => { const tx = open.transaction(t, 'readonly'); const rq = tx.objectStore(t).getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => res([]); });
    dump[t] = rows;
  }
  return { found: true, name: db.name, dump };
})()`);

const clickEl = async (sel, nth = 0) => {
  const r = JSON.parse(await evalApp(`(() => { const els = document.querySelectorAll(${JSON.stringify(sel)}); const el = els[${nth}]; if (!el) return 'null'; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }); })()`));
  if (!r) throw new Error('no element: ' + sel + '[' + nth + ']');
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(80);
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};

// ── W5 pre-flight (before any navigation): MAIN-world nav observer marker
// present on the http entry page (7.1-W1 regression under this flow). ──
const navReady = await evalApp(`!!document.documentElement.getAttribute('data-cmdrunner-nav-ready')`);
check('W5 pre-flight: nav-inject MAIN-world marker present in app tab (7.1-W1 regression)', navReady === true,
  `data-cmdrunner-nav-ready=${navReady}`);

const runSession = async (label) => {
  out(`START(${label}) →`, await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`));
  await sleep(800);
  await browser.send('Target.activateTarget', { targetId: appTab });
  await sleep(600);

  // Ensure we're on the entry form (session 2 arrives on cart.html via the
  // natural end state — navigate to the entry form first).
  const cur = await evalApp('location.href').catch(() => '');
  out(`${label}: current URL before flow = ${cur}`);
  if (!String(cur).includes('search-form')) {
    await evalApp(`location.href = '${APP}/search-form.html'`);
    await sleep(1200);
    await reattach();
  }

  // FULL-RELOAD 1: submit the search form → /search-results.html?q=…
  // REAL document navigation (form GET): content script destroyed at the
  // commit; onCommitted transitionType 'form_submit'.
  await clickEl('#search-form-submit');
  await sleep(2500); // allow document replacement + new CS boot + NAV pull
  await reattach();
  const onResults = await evalApp('location.href').catch(() => '?');
  out(`${label}: after search submit → ${onResults}`);

  // FULL-RELOAD 2: add to cart → /cart.html?ASIN=…
  await clickEl('#add-to-cart-button');
  await sleep(2500);
  await reattach();
  const onCart = await evalApp('location.href').catch(() => '?');
  out(`${label}: after add-to-cart → ${onCart}`);

  // FULL-RELOAD 3 (observation): back to results via the real link nav.
  await clickEl('a[data-auto-id="back-to-results"]');
  await sleep(2000);
  await reattach();
  out(`${label}: after back link → ${await evalApp('location.href').catch(() => '?')}`);

  out(`STOP(${label}) →`, await evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`));
  await sleep(4000); // 11-step persist at STOP
};

const summarizeKr = (kr) => ({
  apps: (kr.dump.applications || []).map(a => ({ o: a.origin, s: a.sessionCount })),
  views: (kr.dump.knowledgeViews || []).map(v => v.viewId),
  viewTransitions: (kr.dump.knowledgeViewTransitions || []).map(t => `${t.fromViewId}->${t.toViewId}(x${t.count || 1})`),
  navInteractionCount: (kr.dump.applications || []).length ? undefined : undefined,
});

// ══ SESSION 1 ══
await runSession('s1');
const kr1 = await dexieProbe();
dump('kr-after-s1.json', kr1);
const s1 = summarizeKr(kr1);
out('s1 summary:', JSON.stringify(s1));

if (!kr1.found) {
  check('W1 s1: KR Dexie found', false, 'no cmdrunner_knowledge');
} else {
  const views1 = kr1.dump.knowledgeViews || [];
  check('W1 s1: knowledgeViews contains search-results AND cart (full-reload path)',
    views1.some(v => v.viewId === 'search-results') && views1.some(v => v.viewId === 'cart'),
    JSON.stringify(views1.map(v => v.viewId)));

  const vt1 = kr1.dump.knowledgeViewTransitions || [];
  check('W2 s1: viewTransitions contain search-results -> cart',
    vt1.some(t => t.fromViewId === 'search-results' && t.toViewId === 'cart'),
    JSON.stringify(vt1.map(t => `${t.fromViewId}->${t.toViewId}(x${t.count || 1})`)));
  check('W2b s1: >= 2 view transitions total (cart -> search-results back-nav)',
    vt1.length >= 2, JSON.stringify(vt1.map(t => `${t.fromViewId}->${t.toViewId}`)));

  const apps1 = kr1.dump.applications || [];
  check('W3 s1: exactly ONE origin-only app row (7.0 regression)',
    apps1.length === 1 && apps1[0].origin === APP,
    JSON.stringify(apps1.map(a => a.origin)));

  // W4: the full-reload synthetic path produced Navigation interactions.
  const storage = await evalPanel(`new Promise(res => chrome.storage.local.get(['execution_ir_plan','live_interactions'], all => res(all)))`).catch(() => ({}));
  const rawPlan = storage && (storage.execution_ir_plan || storage.live_interactions);
  const plan = rawPlan ? (typeof rawPlan === 'string' ? JSON.parse(rawPlan) : rawPlan) : null;
  const steps = plan ? (Array.isArray(plan) ? plan : plan.steps || []) : [];
  const navSteps = steps.filter(s => String(s.action || s.type || '').toLowerCase() === 'navigate');
  check('W4 s1: NAVIGATE step(s) present in IR plan (full-reload Navigation interactions existed)',
    navSteps.length >= 1,
    `actions=${JSON.stringify(steps.map(s => s.action || '?'))}`);

  // W7 observation: identity honesty under full reloads.
  const extRows = apps1.filter(a => String(a.origin).startsWith('chrome-extension://'));
  out(`W7 obs: chrome-extension app rows = ${extRows.length} (expect 0)`);
}

// ══ SESSION 2 (same profile, same app) ══
await runSession('s2');
const kr2 = await dexieProbe();
dump('kr-after-s2.json', kr2);
const s2 = summarizeKr(kr2);
out('s2 summary:', JSON.stringify(s2));
dump('summary.txt', { s1, s2 });

if (!kr2.found) {
  check('W6 s2: KR Dexie found', false, 'no cmdrunner_knowledge');
} else {
  const apps2 = kr2.dump.applications || [];
  const app2 = apps2.find(a => a.origin === APP);
  check('W6 s2: sessionCount === 2, one app row', !!app2 && app2.sessionCount === 2 && apps2.length === 1,
    JSON.stringify(apps2.map(a => ({ o: a.origin, s: a.sessionCount }))));
  const views2 = kr2.dump.knowledgeViews || [];
  const views1 = kr1.dump.knowledgeViews || [];
  check('W6 s2: view rows shared, not duplicated', views2.length === views1.length && views2.length >= 2,
    `s1=${views1.length} s2=${views2.length} ids=${JSON.stringify(views2.map(v => v.viewId))}`);
  const vt2 = kr2.dump.knowledgeViewTransitions || [];
  const reinforced = vt2.find(t => t.fromViewId === 'search-results' && t.toViewId === 'cart');
  check('W6 s2: search-results -> cart transition REINFORCED (count >= 2)',
    !!reinforced && (reinforced.count || 1) >= 2,
    JSON.stringify(vt2.map(t => `${t.fromViewId}->${t.toViewId}(x${t.count || 1})`)));
}

out(`\n════ 7.1-W2 E2E — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
try { chrome.kill('SIGTERM'); } catch {}
try { httpd.close(); } catch {}
setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} }, 2000);
process.exit(FAIL === 0 ? 0 : 1);
