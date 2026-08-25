// 7.4-B1 Expander — real-Chrome E2E pin (spec phase-7-4-b1-expander.md AC-11).
// House CDP pattern (6F-M1 … 7.4-M1): start recording from panel context →
// trusted clicks on the GENERIC accordion fixture → STOP → storage + IR + KR
// assertions. Zero-dependency fixture server (:8242) + pure-Node http probe
// (execSync(curl) deadlocks in this ESM top-level-await context — 7.4-M1 truth).
//
// Matrix (all generic — the ONLY signal is the W3C disclosure convention):
//   X1 <button aria-expanded> → card type Expander
//   X2 div role=button aria-expanded → Expander
//   X3 bare div aria-expanded → Expander (affordance/ARIA carries it)
//   X4 each Expander card: expandedAtTrigger=false (pre-flip) + flip TRUE
//   X5 state rows: control-state-change property=expanded false→true (×3)
//   X6 IR plan: every step action=click, count 3, expander locators used
//   X7 InteractionContract.expanded true for each (understanding layer)
//   X8 zero console errors in panel context
// Regression harnesses (6E-M2 / 6F-M1 / 7.4-M1) run separately after this.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9900 + Math.floor(Math.random() * 300);
const APP = 'http://127.0.0.1:8242';
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-7-4-b1-e2e-2026-08-25/dumps';
const PROFILE = '/tmp/74b1-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

// Zero-dependency static server — container lacks http-server this session.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const fixture = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  let file = '/workspace/public' + (p === '/' ? '/expander-validation.html' : p);
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((res, rej) => { fixture.once('error', rej); fixture.listen(8242, '127.0.0.1', res); });
out('fixture listening on 8242');
setTimeout(() => { out('FATAL: watchdog fired'); try { chrome?.kill(); } catch {} process.exit(2); }, 240000).unref();
// Pure-Node readiness probe (execSync(curl) deadlocks in this ESM context).
const probe = () => new Promise((res) => {
  http.get('http://127.0.0.1:8242/expander-validation.html', (r) => { r.resume(); res(String(r.statusCode)); }).on('error', () => res('000'));
});
let fixtureUp = false;
for (let i = 0; i < 30; i++) {
  if (await probe() === '200') { fixtureUp = true; break; }
  await sleep(500);
}
out('fixture up:', fixtureUp);
if (!fixtureUp) { out('FATAL: fixture never answered'); process.exit(1); }

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

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/expander-validation.html` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable'); await app.send('Page.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const consoleErrors = [];
await panel.send('Log.enable');
panel.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') consoleErrors.push(e.entry.text); });

const probePage = await evalApp(`(() => ({ url: location.href, heads: document.querySelectorAll('.head').length, ready: document.readyState }))()`);
out('page probe:', JSON.stringify(probePage));
if (!probePage || probePage.heads < 3) { out('FATAL: fixture page missing'); process.exit(1); }

await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(400);

const startRecording = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
const rectOf = async (sel) => (await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`));
const dispatch = async (type, x, y) => { await app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const clickAt = async (r) => { await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2); await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2); };

// ── Record: expand each of the three shapes (aria-expanded false→true) ──
await startRecording();
for (const sel of ['#s1', '#s2', '#s3']) {
  const r = await rectOf(sel);
  check(`fixture: ${sel} found`, !!r);
  if (r) { await clickAt(r); await sleep(900); }
}
// (run-2 correction: getElementById takes the RAW id — '#s1' returns null and
// threw, printing "undefined" in run 1. The flips themselves were already
// triple-confirmed by domChange deltas + stateChanges + contracts.)
const ariaEcho = await evalApp(`(() => ['s1','s2','s3'].map(id => document.getElementById(id).getAttribute('aria-expanded')).join(','))()`);
out('fixture aria-expanded after clicks:', ariaEcho); // expect "true,true,true"
out('STOP →', await stopRecording());
await sleep(2500);

// (run-4/5 correction for X4c): the panel tab was created BEFORE recording
// started, so it booted with recordingState=Idle → home view (no card list).
// Reload it AFTER stop: it then boots with recordingState=Stopped and renders
// the stopped view, whose cards carry the 🔽 Expander badges.
await panel.send('Page.reload');
await sleep(2500);

// ── Engine truth: live interactions + IR plan in chrome.storage.local ──
const storage = await evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);
dump('b1-storage.json', storage);
const ix = storage.cmdrunner_live_interactions || [];
const cards = ix.map(i => ({
  type: i.type,
  name: i.metadata?.targetName || null,
  sel: i.trigger?.cssSelector || null,
  expandedAtTrigger: i.metadata?.expandedAtTrigger ?? null,
  endReason: i.endReason || null,
}));
dump('b1-cards.json', cards);
out('cards:', JSON.stringify(cards, null, 1));

// X1/X2/X3: three Expander cards, one per shape
const exp = cards.filter(c => c.type === 'Expander');
check('X1 <button aria-expanded> → Expander', exp.filter(c => c.sel === '#s1').length === 1, JSON.stringify(exp.map(c => ({ s: c.sel, t: c.type }))));
check('X2 role=button div aria-expanded → Expander', exp.filter(c => c.sel === '#s2').length === 1, '');
check('X3 bare div aria-expanded → Expander', exp.filter(c => c.sel === '#s3').length === 1, '');
check('X4a exactly three Expander cards total', exp.length === 3, `${exp.length}`);
check('X4b expandedAtTrigger=false pre-flip on all three', exp.every(c => c.expandedAtTrigger === false), JSON.stringify(exp.map(c => c.expandedAtTrigger)));

// X4c (added 2026-08-25, reviewer WARN-3): the panel actually RENDERS the
// Expander badge — probe the live sidepanel DOM. Cards live in
// #timeline-events (recording view) or #detected-interactions-list (stopped
// view) depending on UI state; probe both.
const badgeProbe = await evalPanel(`(() => {
  const sels = ['#recording-interactions-list', '#detected-interactions-list'];
  let cardCount = 0, expanderBadges = 0;
  for (const s of sels) {
    const list = document.querySelector(s);
    if (!list) continue;
    const cards = list.querySelectorAll('.interaction-event');
    cardCount += cards.length;
    expanderBadges += [...cards].filter(c => (c.textContent || '').includes('Expander')).length;
  }
  return { cardCount, expanderBadges };
})()`);
check('X4c panel renders Expander badges (≥3)', badgeProbe && badgeProbe.expanderBadges >= 3,
  JSON.stringify(badgeProbe));

// X5: state rows — understanding outcome stateChanges carry the flip
// (run-1 correction: rows live at understanding_result.outcomes[].stateChanges,
// string form "control: <label> (expanded) false → true" — NOT raw signals).
const ur = storage.understanding_result;
const stateRows = ((ur && ur.outcomes) || []).flatMap(o => o.stateChanges || []);
const expandedRows = stateRows.filter(r => String(r).includes('expanded'));
check('X5 state rows property=expanded false→true (×3)', expandedRows.length >= 3,
  JSON.stringify(stateRows));

// X6: IR plan — all steps click, 3 steps
const plan = storage.execution_ir_plan || null;
if (plan) {
  dump('b1-ir-plan.json', plan);
  const steps = plan.steps || [];
  const acts = steps.map(s => s.action);
  out('IR steps:', JSON.stringify(acts));
  check('X6 IR plan: 3 steps, every action=click (Expander maps to CLICK)', steps.length === 3 && acts.every(a => a === 'click'),
    `${steps.length} steps: ${JSON.stringify(acts)}`);
  // no "toggle" in the plan — the checkbox-specific landmine pinned absent
  check('X6b IR plan has ZERO toggle actions', !acts.includes('toggle'), JSON.stringify(acts));
} else {
  check('X6 IR plan present', false, 'execution_ir_plan missing');
}

// X7: understanding contract — expanded=true per Expander card.
// (run-1 correction: contracts live at understanding_result.semanticKnowledge.
// contracts[].expanded, not on the interaction objects.)
const contracts = (ur && ur.semanticKnowledge && ur.semanticKnowledge.contracts) || [];
const expContracts = contracts.filter(c => c.expanded === true);
check('X7 InteractionContract.expanded=true for each Expander (×3)', expContracts.length >= 3,
  JSON.stringify(contracts.map(c => ({ l: c.label, e: c.expanded }))));

// X8: zero console errors
check('X8 zero console errors in panel context', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// KR probe (states + signatures) — house pattern from 7.0 KR harness
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
try {
  const kr = await dexieProbe();
  dump('b1-kr-dexie.json', kr);
  if (kr.found) {
    // (run-1 correction: state flips persist to knowledgeStateTransitions —
    // there is no knowledgeStates table; the transition table is the truth.)
    const transitions = kr.dump.knowledgeStateTransitions || [];
    const expanded = transitions.filter(t => JSON.stringify(t).includes('expanded'));
    out('KR expanded state transitions:', expanded.length);
    check('X5b KR state transitions carry expanded (≥3)', expanded.length >= 3, `${expanded.length}`);
    const sigs = kr.dump.knowledgeSignatures || [];
    const expSigs = sigs.filter(s => String(s.actionType || '').includes('Expander'));
    check('X7b KR signatures minted for Expander (signature fragmentation accepted, pinned)', expSigs.length >= 1, `${expSigs.length}`);
  } else { check('X5b KR probe', false, 'no cmdrunner_knowledge db'); }
} catch (e) { check('X5b KR probe', false, String(e).slice(0, 120)); }

dump('console-74b1.json', { errors: consoleErrors });
out(`\nRESULT: ${PASS} PASS / ${FAIL} FAIL`);
try { chrome.kill(); } catch {}
try { fixture.close(); } catch {}
process.exit(FAIL ? 1 : 0);
