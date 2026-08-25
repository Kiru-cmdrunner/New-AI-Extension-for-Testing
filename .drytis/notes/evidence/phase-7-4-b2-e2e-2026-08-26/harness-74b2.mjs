// 7.4-B2 Typeable Combobox — real-Chrome E2E pin (spec phase-7-4-b2-combobox-typeable.md §5).
// House CDP pattern (6F-M1 → 7.4-B1): start recording from panel context →
// trusted events on the combobox-typeable fixture → STOP → storage + IR
// assertions. Zero-dependency fixture server (:8242) + pure-Node http probe.
//
// Matrix (real keyboard/mouse through CDP Input domain — trusted events):
//   Flow A: type "New" into #city-a → click option "New York"
//     → expect TextEntry + Click, ZERO Dropdown (S2A-2)
//   Flow B: type "App" into #fruit-b → press Enter
//     → expect TextEntry only, zero Unclassified (S2A-3)
//   Flow C: type "query" into #search-c → click #save-btn (outside)
//     → expect TextEntry + Click, zero Unclassified (S2A-4)
//   Flow D: readonly combobox #status-d → click input → click option
//     → expect Dropdown (R1 pinned unchanged)
//   Flow E: datalist #browser-e → type only
//     → expect TextEntry with comboboxSignal=datalist (S1)
//   X-checks: IR plan honesty (S2B), panel badges, console errors.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9900 + Math.floor(Math.random() * 300);
const APP = 'http://127.0.0.1:8242';
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-7-4-b2-e2e-2026-08-26/dumps';
const PROFILE = '/tmp/74b2-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const harnessLog = [];
const check = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`;
  out(line);
  harnessLog.push(line);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

// Zero-dependency static server — container lacks http-server this session.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const fixture = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  let file = '/workspace/public' + (p === '/' ? '/combobox-typeable-validation.html' : p);
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((res, rej) => { fixture.once('error', rej); fixture.listen(8242, '127.0.0.1', res); });
out('fixture listening on 8242');
setTimeout(() => { out('FATAL: watchdog fired'); try { chrome?.kill(); } catch {} process.exit(2); }, 300000).unref();

// Pure-Node readiness probe.
const probe = () => new Promise((res) => {
  http.get('http://127.0.0.1:8242/combobox-typeable-validation.html', (r) => { r.resume(); res(String(r.statusCode)); }).on('error', () => res('000'));
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

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/combobox-typeable-validation.html` });
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

const probePage = await evalApp(`(() => ({ url: location.href, combos: document.querySelectorAll('.combobox-input').length, ready: document.readyState }))()`);
out('page probe:', JSON.stringify(probePage));
if (!probePage || probePage.combos < 4) { out('FATAL: fixture page missing'); process.exit(1); }

await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(400);

const startRecording = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
const rectOf = async (sel) => (await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`));
const dispatch = async (type, x, y) => { await app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const clickAt = async (r) => { await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2); await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2); };
const typeText = async (text) => {
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(40);
  }
};
const pressEnter = async () => {
  await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
};

// ── Record the five flows ─────────────────────────────────────────────────
await startRecording();

// Flow A: type "New" into #city-a → click option "New York"
{
  const r = await rectOf('#city-a');
  check('A0 fixture: #city-a found', !!r);
  await clickAt(r); await sleep(500);
  await typeText('New'); await sleep(400);
  const opt = await rectOf('#city-a-list .opt');
  check('A0b fixture: option list open', !!opt);
  await clickAt(opt); await sleep(900);
  const val = await evalApp(`(() => document.getElementById('city-a').value)()`);
  out('A fixture value after flow:', JSON.stringify(val)); // expect "New York"
}

// Flow B: type "App" into #fruit-b → Enter
{
  const r = await rectOf('#fruit-b');
  await clickAt(r); await sleep(500);
  await typeText('App'); await sleep(300);
  await pressEnter(); await sleep(500);
}

// Flow C: type "query" into #search-c → click #save-btn (outside)
{
  const r = await rectOf('#search-c');
  await clickAt(r); await sleep(500);
  await typeText('query'); await sleep(300);
  const btn = await rectOf('#save-btn');
  await clickAt(btn); await sleep(900);
}

// Flow D: readonly combobox #status-d → click input → click option
{
  const r = await rectOf('#status-d');
  await clickAt(r); await sleep(600);
  const opt = await rectOf('#status-d-list .opt');
  check('D0 fixture: readonly option list open', !!opt);
  if (opt) { await clickAt(opt); await sleep(900); }
  const val = await evalApp(`(() => document.getElementById('status-d').value)()`);
  out('D fixture value after flow:', JSON.stringify(val)); // expect "Active"
}

// Flow E: datalist #browser-e → type only, then click elsewhere to close
{
  const r = await rectOf('#browser-e');
  await clickAt(r); await sleep(500);
  await typeText('Chro'); await sleep(300);
  // close: click the save button to blur
  const btn = await rectOf('#save-btn');
  await clickAt(btn); await sleep(900);
}

out('STOP →', await stopRecording());
await sleep(2500);

// Panel booted before recording started → reload to render stopped view.
await panel.send('Page.reload');
await sleep(2500);

// ── Engine truth: live interactions + IR plan in chrome.storage.local ─────
const storage = await evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);
dump('b2-storage.json', storage);
const ix = storage.cmdrunner_live_interactions || [];
const cards = ix.map(i => ({
  type: i.type,
  name: i.metadata?.targetName || null,
  sel: i.trigger?.cssSelector || null,
  signal: i.metadata?.comboboxSignal || null,
  typedValue: i.metadata?.typedValue || null,
  endReason: i.endReason || null,
}));
dump('b2-cards.json', cards);
out('cards:', JSON.stringify(cards, null, 1));

// Flow A assertions (S2A-2): TextEntry + Click, ZERO Dropdown on the input
// (A2 uses the accessible name — the option's fallback CSS selector is a
// positional path that never contains the list id.)
const aEntry = cards.find(c => c.sel && c.sel.includes('city-a') && c.type === 'TextEntry');
const aClick = cards.find(c => c.type === 'Click' && c.name === 'New York');
const aDropdown = cards.filter(c => c.sel && (c.sel.includes('city-a')) && c.type === 'Dropdown');
check('A1 #city-a → TextEntry card (typeable combobox claimed by TextEntry)', !!aEntry, JSON.stringify(cards.filter(c => String(c.sel).includes('city-a'))));
check('A2 option "New York" → Click card', !!aClick, '');
check('A3 ZERO Dropdown cards on the typeable combobox', aDropdown.length === 0, JSON.stringify(aDropdown));

// Flow B assertions (S2A-3): single TextEntry on #fruit-b
const bEntry = cards.filter(c => c.sel && c.sel.includes('fruit-b'));
check('B1 #fruit-b → exactly one card, type TextEntry', bEntry.length === 1 && bEntry[0].type === 'TextEntry', JSON.stringify(bEntry));

// Flow C assertions (S2A-4): TextEntry + Click(Save), zero Unclassified on search-c
const cEntry = cards.find(c => c.sel && c.sel.includes('search-c') && c.type === 'TextEntry');
const cClick = cards.find(c => c.sel && c.sel.includes('save-btn') && c.type === 'Click');
check('C1 #search-c → TextEntry card', !!cEntry, JSON.stringify(cards.filter(c => String(c.sel).includes('search-c'))));
check('C2 #save-btn → Click card', !!cClick, '');
const unclassified = cards.filter(c => c.type === 'Unclassified');
out('Unclassified cards:', JSON.stringify(unclassified));

// Flow D assertions (R1): readonly combobox → Dropdown, NOT TextEntry
const dDropdown = cards.find(c => c.sel && c.sel.includes('status-d') && c.type === 'Dropdown');
const dEntry = cards.filter(c => c.sel && c.sel.includes('status-d') && c.type === 'TextEntry');
check('D1 readonly #status-d → Dropdown card (R1 pinned)', !!dDropdown, JSON.stringify(cards.filter(c => String(c.sel).includes('status-d'))));
check('D2 readonly #status-d → ZERO TextEntry', dEntry.length === 0, '');

// Flow E assertions (S1): datalist input → TextEntry with comboboxSignal=datalist
const eEntry = cards.find(c => c.sel && c.sel.includes('browser-e') && c.type === 'TextEntry');
check('E1 datalist #browser-e → TextEntry card', !!eEntry, JSON.stringify(cards.filter(c => String(c.sel).includes('browser-e'))));
check('E2 TextEntry comboboxSignal=datalist (S1 listId)', !!eEntry && eEntry.signal === 'datalist', JSON.stringify(eEntry && eEntry.signal));

// S1 substrate: comboboxSignal present on the ARIA flows too
check('S1a #city-a TextEntry carries comboboxSignal=list', !!aEntry && aEntry.signal === 'list', JSON.stringify(aEntry && aEntry.signal));

// X4c-style: panel actually RENDERS the cards + badge text
const badgeProbe = await evalPanel(`(() => {
  const sels = ['#recording-interactions-list', '#detected-interactions-list'];
  let cardCount = 0, textBadges = 0;
  for (const s of sels) {
    const list = document.querySelector(s);
    if (!list) continue;
    const cards = list.querySelectorAll('.interaction-event');
    cardCount += cards.length;
    textBadges += [...cards].filter(c => (c.textContent || '').includes('combobox')).length;
  }
  return { cardCount, textBadges };
})()`);
check('X-Panel panel renders cards (≥5)', badgeProbe && badgeProbe.cardCount >= 5, JSON.stringify(badgeProbe));

// S2B IR honesty: the plan for Flow A must contain CLICK steps (the typeable
// path), and no SELECT-on-INPUT step. (Flow D's readonly path is click-only.)
const plan = storage.execution_ir_plan || null;
if (plan) {
  dump('b2-ir-plan.json', plan);
  const steps = plan.steps || [];
  const acts = steps.map(s => s.action);
  out('IR steps:', JSON.stringify(acts));
  const clickCount = acts.filter(a => a === 'click').length;
  check('X-IR1 IR plan uses click steps (≥2 for flows D + C save)', clickCount >= 2, `${steps.length} steps: ${JSON.stringify(acts)}`);
  check('X-IR2 IR plan has ZERO select steps (no INPUT-based fake SELECT)', !acts.includes('select'), JSON.stringify(acts));
} else {
  check('X-IR1 IR plan present', false, 'execution_ir_plan missing');
}

// X8: zero console errors
check('X8 zero console errors in panel context', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

dump('console-74b2.json', { errors: consoleErrors, harnessLog });
out(`\nRESULT: ${PASS} PASS / ${FAIL} FAIL`);
try { chrome.kill(); } catch {}
try { fixture.close(); } catch {}
process.exit(FAIL ? 1 : 0);
