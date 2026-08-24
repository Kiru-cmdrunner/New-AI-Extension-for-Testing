// 7.1-W1 real-Chrome E2E harness (pin ⑩). House CDP pattern (7.0-KR
// harness-7kr.mjs): fresh Chrome + fresh profile + fresh ports; PANEL-FIRST
// START (also re-proves the 7.0 identity recovery); trusted CDP input;
// Dexie probes + view-layer assertions.
//
// Matrix (spec §5 E2E):
//  V1  s1: knowledgeViews >= 2 (incl. search-results from /search?q=)
//  V2  s1: knowledgeViewTransitions >= 1 (home ↔ search-results)
//  V3  s1: 7.0 identity regression — exactly ONE origin-only app row
//  V4  s2: sessionCount === 2, view rows shared (not duplicated)
//  V5  s2: signature occurrenceCount === 2 still holds
//  V6  observation (not AC): unattr-ui gap count; NAVIGATE IR presence
//      recorded honestly either way.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9500 + Math.floor(Math.random() * 400);
const APP_PORT = 8223;
const APP = `http://127.0.0.1:${APP_PORT}`;
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-7-1-w1-e2e-2026-08-24/dumps';
const PROFILE = '/tmp/71w1-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 900) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

// ── Fixture: the entity-bearing SPA page (7.0-KR fixture family) ──
const PAGE = fs.readFileSync('/workspace/public/kr-app-identity-validation.html', 'utf8');
const httpd = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE); // same document for every route — SPA pushState never reloads
});
await new Promise((r) => httpd.listen(APP_PORT, '127.0.0.1', r));
out(`fixture on ${APP}`);

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

// PANEL FIRST (mis-stamp reproducer), then the app tab.
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
await sleep(2000);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
await app.send('Page.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

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
  await sleep(700);
};

// Pre-flight: MAIN-world nav asset actually loaded in the app tab.
const navReady = await evalApp(`!!document.documentElement.getAttribute('data-cmdrunner-nav-ready')`);
check('V0 pre-flight: nav-inject MAIN-world marker present in app tab', navReady === true,
  `data-cmdrunner-nav-ready=${navReady}`);

const runSession = async (label) => {
  out(`START(${label}) →`, await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`));
  await sleep(800);
  await browser.send('Target.activateTarget', { targetId: appTab });
  await sleep(600);
  for (let i = 0; i < 15; i++) {
    if (await evalApp(`!!document.querySelector('#search-flights-button')`).catch(() => false)) break;
    await sleep(400);
  }
  // SPA search nav (pushState → /search?q=… — the URL change the isolated
  // world could never see pre-7.1-W1)
  await clickEl('#search-flights-button');
  await sleep(1000);
  await clickEl('#add-to-cart-button');
  await sleep(1000);
  // Fixture's documented flow: "→ back to /" (popstate → home view).
  // Two view changes = home resolves as before-view → transition row.
  await evalApp(`history.back()`);
  await sleep(1000);
  out(`STOP(${label}) →`, await evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`));
  await sleep(3500);
};

const summarizeKr = (kr) => ({
  apps: (kr.dump.applications || []).map(a => ({ o: a.origin, s: a.sessionCount })),
  views: (kr.dump.knowledgeViews || []).map(v => v.viewId),
  viewTransitions: (kr.dump.knowledgeViewTransitions || []).map(t => `${t.fromViewId}->${t.toViewId}(x${t.count})`),
  gaps: (kr.dump.knowledgeGaps || []).filter(g => String(g.reason).includes('no-live-horizon')).length,
  entities: (kr.dump.knowledgeEntities || []).map(e => e.entityId),
  signatures: (kr.dump.knowledgeSignatures || []).map(s => ({ t: s.actionType, n: s.normalizedTarget, occ: s.occurrenceCount })),
});

// ══ SESSION 1 ══
await runSession('s1');
const kr1 = await dexieProbe();
dump('kr-after-s1.json', kr1);
const ir1 = await evalPanel(`new Promise(res => chrome.storage.local.get(['execution_ir_plan'], all => res(all)))`).catch(() => ({}));
const irTypes = (raw) => {
  if (!raw) return null;
  const plan = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const steps = Array.isArray(plan) ? plan : plan.steps || [];
  return steps.map(s => s.type || s.actionType || '?');
};
dump('storage-after-s1.json', { irPlanTypes: irTypes(ir1 && ir1.execution_ir_plan) });
const s1 = summarizeKr(kr1);
out('s1 summary:', JSON.stringify(s1));

if (!kr1.found) {
  check('V1 s1: KR Dexie found', false, 'no cmdrunner_knowledge');
} else {
  const views1 = kr1.dump.knowledgeViews || [];
  check('V1 s1: knowledgeViews >= 2', views1.length >= 2, JSON.stringify(views1.map(v => v.viewId)));
  check('V1 s1: search-results view present', views1.some(v => v.viewId === 'search-results'), JSON.stringify(views1.map(v => v.viewId)));
  const vt1 = kr1.dump.knowledgeViewTransitions || [];
  check('V2 s1: viewTransitions >= 1 (home ↔ search-results)', vt1.length >= 1, JSON.stringify(vt1.map(t => `${t.fromViewId}->${t.toViewId}`)));
  const apps1 = kr1.dump.applications || [];
  check('V3 s1: exactly ONE origin-only app row (7.0 regression)',
    apps1.length === 1 && apps1[0].origin === APP,
    JSON.stringify(apps1.map(a => a.origin)));
}

// ══ SESSION 2 (same profile, same app) ══
await runSession('s2');
const kr2 = await dexieProbe();
dump('kr-after-s2.json', kr2);
const s2 = summarizeKr(kr2);
out('s2 summary:', JSON.stringify(s2));
dump('summary.txt', { s1, s2 });

if (!kr2.found) {
  check('V4 s2: KR Dexie found', false, 'no cmdrunner_knowledge');
} else {
  const apps2 = kr2.dump.knowledgeApplications || kr2.dump.applications || [];
  const app2 = apps2.find(a => a.origin === APP);
  check('V4 s2: sessionCount === 2, one app row', !!app2 && app2.sessionCount === 2 && apps2.length === 1,
    JSON.stringify(apps2.map(a => ({ o: a.origin, s: a.sessionCount }))));
  const views2 = kr2.dump.knowledgeViews || [];
  const views1 = kr1.dump.knowledgeViews || [];
  check('V4 s2: view rows shared, not duplicated', views2.length === views1.length && views2.length >= 2,
    `s1=${views1.length} s2=${views2.length} ids=${JSON.stringify(views2.map(v => v.viewId))}`);
  const sigs2 = kr2.dump.knowledgeSignatures || [];
  check('V5 s2: signature occurrenceCount === 2', sigs2.some(s => (s.occurrenceCount || 0) >= 2),
    JSON.stringify(sigs2.map(s => ({ t: s.actionType, occ: s.occurrenceCount }))));
}

// V6 — honest observations (NOT ACs)
out('V6 obs: unattr-ui no-live-horizon gaps  s1=' + s1.gaps + '  s2=' + s2.gaps);
const irPlanTypes = irTypes(ir1 && ir1.execution_ir_plan);
out('V6 obs: IR plan s1 types: ' + JSON.stringify(irPlanTypes));

out(`\n════ 7.1-W1 E2E — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
try { chrome.kill('SIGTERM'); } catch {}
try { httpd.close(); } catch {}
setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} }, 2000);
process.exit(FAIL === 0 ? 0 : 1);
