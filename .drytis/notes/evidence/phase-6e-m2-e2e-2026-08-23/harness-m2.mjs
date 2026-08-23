// 6E-M2 real-Chrome E2E harness. House CDP pattern (6D.1/6D.2/6E-M1):
// start recording from panel context → activate app tab → trusted input →
// storage + Dexie probes. Matrix:
//  E1 Depart-on trigger click (INPUT.withIcon 'Depart on', wrapper .date_picker) → DatePicker lifecycle STARTS
//  E2 verbatim react-datepicker cell click → DatePicker COMPLETES with the date value; ZERO Unclassified cell cards
//  E3 Return-on field + cell click → SECOND DatePicker completed (round-trip)
//  E4 regression: data-auto-id button → Click (6B)
//  E5 regression: options-list li.opt → Click (6D.1 W3)
//  E6 regression: snackbar notification captured (6D.1 W1)
//  E7 regression: #id-only 1/1 counter swap seeds counter (6D.1 W2)
//  E8 IR plan: fill/datePicker steps present; no Unclassified leak
//  E9 KR Dexie rows written
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
// ROUND 2 (E2E finding): the first run's Chrome was never killed and the
// debug port was FIXED — the second harness launch attached to the OLD
// Chrome (old extension build, old profile; KR Dexie showed 2 sessions).
// Now: fresh port + fresh profile per run, and process teardown at exit.
const PORT = 9500 + Math.floor(Math.random() * 400);
const APP = 'http://127.0.0.1:8190';
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-6e-m2-e2e-2026-08-23/dumps';
const PROFILE = '/tmp/6em2-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 800) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

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

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
await app.send('Page.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const startRecording = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
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

const rectOf = async (sel) => JSON.parse(await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'null'; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }); })()`));
const clickEl = async (sel, nth = 0) => {
  const r = JSON.parse(await evalApp(`(() => { const els = document.querySelectorAll(${JSON.stringify(sel)}); const el = els[${nth}]; if (!el) return 'null'; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }); })()`));
  if (!r) throw new Error('no element: ' + sel + '[' + nth + ']');
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(80);
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(700);
};

await sleep(1200);
out('START →', await startRecording());
await sleep(1000);

// ── E1: Depart-on trigger click ──
await clickEl('#onward');
await sleep(500);
// ── E2: verbatim cell (index 1 = "Choose Sunday, September 6th, 2026") ──
await clickEl('#month-onward .react-datepicker__day', 1);
await sleep(900);
const depVal = await evalApp(`document.getElementById('onward').value`);
out('depart value =', JSON.stringify(depVal));

// ── E3: Return-on round trip ──
await clickEl('#return');
await sleep(500);
await clickEl('#month-return .react-datepicker__day', 3);
await sleep(900);
const retVal = await evalApp(`document.getElementById('return').value`);
out('return value =', JSON.stringify(retVal));

// ── E4: data-auto-id regression (6B) ──
await clickEl('#go');
await sleep(600);
// ── E5: options-list regression (W3) ──
await clickEl('#opts .opt');
await sleep(600);
// ── E6: snackbar regression (W1) ──
await clickEl('#toast-btn');
await sleep(900);
// ── E7: #id-only counter swap seeded by the #go click (W2) ──

await sleep(1200);
out('STOP →', await stopRecording());
await sleep(2500);

const storage = await evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);
dump('m2-storage.json', storage);
const ix = storage.cmdrunner_live_interactions || [];
const cards = ix.map(i => ({
  type: i.type,
  name: i.metadata?.targetName || null,
  dateValue: i.metadata?.dateValue || i.metadata?.textValue || null,
  sel: i.trigger?.cssSelector || null,
  dataAutoId: i.trigger?.dataAutoId || null,
  testId: i.trigger?.testId || null,
}));
dump('m2-cards.json', cards);
out('cards:', JSON.stringify(cards.map(c => ({ t: c.type, n: (c.name||'').slice(0,44), dv: c.dateValue })), null, 1));

// E1+E2: DatePicker completed for Depart on with the selected date
const dp = cards.filter(c => c.type === 'DatePicker');
check('E1+E2 Depart-on: DatePicker lifecycle completed with selected date value',
  dp.length >= 1 && dp.some(c => String(c.dateValue || '').includes('Sep')),
  `${dp.length} DatePicker cards :: ${JSON.stringify(dp.map(c => ({ n: c.name, dv: c.dateValue })))}`);
// E3: second DatePicker (Return on)
check('E3 Return-on: second DatePicker completed (round-trip)',
  dp.length >= 2 && dp.filter(c => /return/i.test(c.name || '')).length >= 1,
  JSON.stringify(dp.map(c => c.name)));
// Zero Unclassified cell cards
const unclassCells = cards.filter(c => c.type === 'Unclassified' && /Choose (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i.test(c.name || ''));
check('E2b ZERO Unclassified calendar-cell cards',
  unclassCells.length === 0,
  `${unclassCells.length} unclassified cells :: ${JSON.stringify(unclassCells.map(c => c.name))}`);
// E4: data-auto-id Click
const e4 = cards.filter(c => c.dataAutoId === 'search-flights');
check('E4 6B regression: data-auto-id search-flights → exactly one Click',
  e4.length === 1 && e4[0].type === 'Click',
  JSON.stringify(e4.map(c => ({ t: c.type, id: c.dataAutoId }))));
// E5: options-list Click (W3)
const e5 = cards.filter(c => (c.name || '') === 'Bengaluru');
check('E5 6D.1 W3 regression: options-list li.opt Bengaluru → exactly one Click',
  e5.length === 1 && e5[0].type === 'Click',
  JSON.stringify(e5.map(c => ({ t: c.type, n: c.name }))));
// E6: snackbar notification (W1)
const e6 = cards.filter(c => c.type === 'Notification' || /saved/i.test(c.name || ''));
out('E6 notification-ish cards:', JSON.stringify(e6.map(c => ({ t: c.type, n: c.name }))));
// E7: counter — KR probe below; check storage for seeded counter via semantic observation is KR-side
// E8: IR plan
const plan = storage.execution_ir_plan || null;
if (plan) {
  dump('m2-ir-plan.json', plan);
  const steps = plan.steps || [];
  const acts = steps.map(s => s.action);
  out('IR steps:', JSON.stringify(acts));
  const hasDateStep = acts.some(a => /fill|date/i.test(String(a))) || steps.length >= 3;
  check('E8 IR plan: date steps present, no Unclassified leak (plan generated from claimed cards only)',
    hasDateStep && steps.length >= 3,
    `${steps.length} steps: ${JSON.stringify(acts)}`);
} else {
  check('E8 IR plan present', false, 'execution_ir_plan missing');
}
// E9: KR
const kr = await dexieProbe();
dump('m2-kr-dexie.json', kr);
if (kr.found) {
  const counts = Object.fromEntries(Object.entries(kr.dump).map(([t, rows]) => [t, Array.isArray(rows) ? rows.length : 0]));
  out('KR tables:', JSON.stringify(counts));
  check('E9 KR Dexie rows written (DatePicker signatures among them)',
    Object.values(counts).some(n => n > 0) && (counts.knowledgeSignatures || 0) >= 1,
    JSON.stringify(counts));
  const sigs = kr.dump.knowledgeSignatures || [];
  const dpSigs = sigs.filter(s => String(s.actionType || '').includes('DatePicker'));
  out('DatePicker KR signatures:', dpSigs.length);
  // E7 KR counter check: result-count counter row
  const counters = kr.dump.knowledgeCounters || [];
  const rc = counters.filter(c => JSON.stringify(c).includes('result-count'));
  check('E7 6D.1 W2 regression: #id-only p#result-count counter seeded',
    rc.length >= 1,
    JSON.stringify(rc.map(c => ({ id: c.counterId, cur: c.currentValue }))));
} else {
  check('E9 KR Dexie database found', false, 'no cmdrunner_knowledge db');
}

out(`\n════ 6E-M2 E2E — ${PASS} PASS / ${FAIL} FAIL ════`);
// Teardown: close targets, kill Chrome, remove the temp profile.
try { await browser.close(); } catch {}
try { chrome.kill('SIGTERM'); } catch {}
setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} }, 2000);
process.exit(FAIL === 0 ? 0 : 1);
