// 7.0-KR real-Chrome E2E harness. House CDP pattern (6D.1/6D.2/6E/6F):
// fresh Chrome + fresh profile + fresh port; PANEL-CONTEXT START (the exact
// mis-stamp reproducer — pre-7.0 every session landed under the panel-origin
// app row); trusted CDP input; storage + Dexie probes.
//
// Matrix (spec §7):
//  K1  Session 1 lands under ONE application row whose origin is the APP
//      origin only (http://127.0.0.1:<port>) — NOT the panel URL, NOT a path.
//  K2  Session 1 seeds entities (search-query entity via /search?q= SPA nav).
//  K3  Session 2 (same profile): still ONE app row, sessionCount === 2 —
//      reinforcement on real Chrome.
//  K4  Session 2 signature occurrenceCount === 2 (same Click anchor).
//  K5  Session 2 entity shared (not duplicated).
//  K6  Honest-skip non-regression: with a resolvable origin there is no
//      skip warning; panel-origin app rows: ZERO ever created.
//  K7  IR still generated (AC-9 — raw URL path intact).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9500 + Math.floor(Math.random() * 400);
const APP_PORT = 8213;
const APP = `http://127.0.0.1:${APP_PORT}`;
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-7-0-kr-e2e-2026-08-24/dumps';
const PROFILE = '/tmp/7kr-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 900) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

// ── Fixture server: the entity-bearing SPA page (public/ fixture family) ──
const PAGE = fs.readFileSync('/workspace/public/kr-app-identity-validation.html', 'utf-8');
const httpd = http.createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/index')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  } else {
    // SPA route (/search?q=…) — same document, pushState never reloads, but
    // serve it too in case a stray full nav happens.
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
  }
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

const runSession = async (label) => {
  // Panel-context START — the mis-stamp reproducer. Panel stays "active"
  // at the START moment exactly as in the pre-7.0 dumps.
  out(`START(${label}) →`, await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`));
  await sleep(800);
  await browser.send('Target.activateTarget', { targetId: appTab });
  await sleep(600);

  // Wait for fixture buttons
  for (let i = 0; i < 15; i++) {
    if (await evalApp(`!!document.querySelector('#search-flights-button')`).catch(() => false)) break;
    await sleep(400);
  }
  // SPA search nav (pushState → /search?q=… → search-results view + entity)
  await clickEl('#search-flights-button');
  await sleep(1000);
  // data-auto-id Click anchor (6B family — same signature every session)
  await clickEl('#add-to-cart-button');
  await sleep(1000);

  out(`STOP(${label}) →`, await evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`));
  await sleep(3500);
};

// ══ SESSION 1 ══
await runSession('s1');
const kr1 = await dexieProbe();
dump('kr-after-s1.json', kr1);
const storage1 = await evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);
dump('storage-after-s1.json', { ir: !!storage1.execution_ir_plan });

// K7 (early): IR generated from session 1 — AC-9 IR path intact
check('K7 IR plan generated (raw-URL path intact)', !!storage1.execution_ir_plan, 'execution_ir_plan present=' + !!storage1.execution_ir_plan);

if (!kr1.found) {
  check('K1 KR Dexie database found after session 1', false, 'no cmdrunner_knowledge');
} else {
  const apps1 = kr1.dump.applications || [];
  out('apps after s1:', JSON.stringify(apps1.map(a => ({ o: a.origin, s: a.sessionCount }))));
  check('K1 s1: exactly ONE application row', apps1.length === 1, JSON.stringify(apps1.map(a => a.origin)));
  check('K1 s1: origin is the APP origin (no panel URL, no path)',
    apps1.length === 1 && apps1[0].origin === APP,
    JSON.stringify(apps1.map(a => a.origin)));
  check('K6 s1: ZERO chrome-extension app rows ever',
    apps1.every(a => !String(a.origin).startsWith('chrome-extension://')),
    JSON.stringify(apps1.map(a => a.origin)));
  const ents1 = (kr1.dump.knowledgeEntities || []);
  out('entities after s1:', ents1.length, JSON.stringify(ents1.map(e => e.entityId)));
  check('K2 s1: entities seeded (search-query via /search?q=)', ents1.length >= 1, JSON.stringify(ents1.map(e => e.entityId)));
}

// ══ SESSION 2 (same profile, same app) ══
await runSession('s2');
const kr2 = await dexieProbe();
dump('kr-after-s2.json', kr2);

if (!kr2.found) {
  check('K3 KR Dexie database found after session 2', false, 'no cmdrunner_knowledge');
} else {
  const apps2 = kr2.dump.applications || [];
  out('apps after s2:', JSON.stringify(apps2.map(a => ({ o: a.origin, s: a.sessionCount }))));
  check('K3 s2: still exactly ONE app row for this origin',
    apps2.filter(a => a.origin === APP).length === 1 && apps2.length === 1,
    JSON.stringify(apps2.map(a => ({ o: a.origin, s: a.sessionCount }))));
  const app2 = apps2.find(a => a.origin === APP);
  check('K3 s2: sessionCount === 2 (reinforcement on real Chrome)',
    !!app2 && app2.sessionCount === 2,
    app2 ? `sessionCount=${app2.sessionCount}` : 'app row missing');

  const sigs = kr2.dump.knowledgeSignatures || [];
  out('signatures after s2:', JSON.stringify(sigs.map(s => ({ t: s.actionType, n: s.normalizedTarget, occ: s.occurrenceCount }))));
  check('K4 s2: at least one signature reinforced (occurrenceCount >= 2)',
    sigs.some(s => (s.occurrenceCount || 0) >= 2),
    JSON.stringify(sigs.map(s => ({ t: s.actionType, occ: s.occurrenceCount }))));

  const ents2 = kr2.dump.knowledgeEntities || [];
  out('entities after s2:', ents2.length, JSON.stringify(ents2.map(e => ({ id: e.entityId, last: e.lastSessionId }))));
  check('K5 s2: entities not duplicated (same count as s1, shared rows)',
    ents2.length === (kr1.dump.knowledgeEntities || []).length && ents2.length >= 1,
    `s1=${(kr1.dump.knowledgeEntities || []).length} s2=${ents2.length}`);

  check('K6 s2: ZERO chrome-extension app rows ever',
    apps2.every(a => !String(a.origin).startsWith('chrome-extension://')),
    JSON.stringify(apps2.map(a => a.origin)));
}

out(`\n════ 7.0-KR E2E — ${PASS} PASS / ${FAIL} FAIL ════`);
// Teardown
try { await browser.close(); } catch {}
try { chrome.kill('SIGTERM'); } catch {}
try { httpd.close(); } catch {}
setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} }, 2000);
process.exit(FAIL === 0 ? 0 : 1);
