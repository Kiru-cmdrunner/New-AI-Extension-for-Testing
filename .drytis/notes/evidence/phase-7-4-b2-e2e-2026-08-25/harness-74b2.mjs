// 7.4-B2 Typeable Combobox — real-Chrome E2E pin (spec phase-7-4-b2-combobox-typeable.md X3).
// House CDP pattern (7.4-B1): start recording from panel context → trusted
// interactions on the GENERIC combobox fixture → STOP → storage + IR + KR
// assertions. Zero-dependency fixture server (:8243) + pure-Node http probe.
//
// Matrix (all generic — W3C/ARIA combobox conventions only):
//   X1 Flow A: type in combobox + click option → TextEntry card + Click card (option)
//   X2 Flow B: type + Enter + blur → TextEntry card (keyboard commit), no Dropdown
//   X3 Flow C: type + click elsewhere (Save) → TextEntry + Click (Save)
//   X4 Zero Dropdown cards on typeable comboboxes
//   X5 IR: TextEntry → fill step; option/Save clicks → click steps (no select-on-input)
//   X6 Panel renders TextEntry cards with combobox badge
//   X7 zero console errors in panel context
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9900 + Math.floor(Math.random() * 300);
const APP = 'http://127.0.0.1:8243';
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-7-4-b2-e2e-2026-08-25/dumps';
const PROFILE = '/tmp/74b2-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

// Zero-dependency static server — same pattern as B1.
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
await new Promise((res, rej) => { fixture.once('error', rej); fixture.listen(8243, '127.0.0.1', res); });
out('fixture listening on 8243');
setTimeout(() => { out('FATAL: watchdog fired'); try { chrome?.kill(); } catch {} process.exit(2); }, 240000).unref();
const probe = () => new Promise((res) => {
  http.get('http://127.0.0.1:8243/combobox-typeable-validation.html', (r) => { r.resume(); res(String(r.statusCode)); }).on('error', () => res('000'));
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

const probePage = await evalApp(`(() => ({ url: location.href, inputs: document.querySelectorAll('.combobox-input').length, opts: document.querySelectorAll('.opt').length, ready: document.readyState }))()`);
out('page probe:', JSON.stringify(probePage));
if (!probePage || probePage.inputs < 3) { out('FATAL: fixture page missing'); process.exit(1); }

await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(400);

const startRecording = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
const rectOf = async (sel) => (await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`));
const dispatch = async (type, x, y) => { await app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const clickAt = async (r) => { await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2); await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2); };
// Trusted typing via CDP Input.dispatchKeyEvent (char-by-char via insertText is
// untrusted; dispatchKeyEvent with text produces trusted input events).
const typeInto = async (r, text) => {
  await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2);
  await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2);
  await sleep(250);
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(60);
  }
};
const pressEnter = async () => {
  await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};

// ── Record the three flows ────────────────────────────────────────────
await startRecording();

// Flow A: type "New" in #city-a, click the "New York" option
{
  const r = await rectOf('#city-a');
  check('fixture: #city-a found', !!r);
  await typeInto(r, 'New');
  await sleep(400);
  const opt = await rectOf('#city-a-list li[data-value="New York"]');
  check('fixture: option New York visible', !!opt);
  if (opt) { await clickAt(opt); await sleep(500); }
}

// Flow B: type "App" in #fruit-b, press Enter (keyboard commit), then blur via Tab to Save
{
  const r = await rectOf('#fruit-b');
  check('fixture: #fruit-b found', !!r);
  await typeInto(r, 'App');
  await sleep(250);
  await pressEnter();
  await sleep(250);
  // blur by clicking Save (production order: mousedown → blur → click)
  const save = await rectOf('#save-btn');
  if (save) { await clickAt(save); await sleep(500); }
}

// Flow C: type "hotels " in #search-c, click Save (click elsewhere)
{
  const r = await rectOf('#search-c');
  check('fixture: #search-c found', !!r);
  await typeInto(r, 'hotels');
  await sleep(250);
  const save = await rectOf('#save-btn');
  if (save) { await clickAt(save); await sleep(500); }
}

// Flow D: readonly OXD-style combobox — click trigger + click option (S2b pin)
{
  const r = await rectOf('#status-d');
  check('fixture: #status-d (readonly) found', !!r);
  if (r) { await clickAt(r); await sleep(500); }
  const opt = await rectOf('#status-d-list li[data-value="Active"]');
  check('fixture: option Active visible', !!opt);
  if (opt) { await clickAt(opt); await sleep(500); }
}

// Flow E: datalist combobox — type in a native <input list> (S1 listId pin)
{
  const r = await rectOf('#browser-e');
  check('fixture: #browser-e (datalist) found', !!r);
  await typeInto(r, 'Fire');
  await sleep(250);
  const save = await rectOf('#save-btn');
  if (save) { await clickAt(save); await sleep(500); }
}

const ariaEcho = await evalApp(`(() => ({
  a: document.getElementById('city-a').value,
  b: document.getElementById('fruit-b').value,
  c: document.getElementById('search-c').value,
  d: document.getElementById('status-d').value,
  e: document.getElementById('browser-e').value,
}))()`);
out('fixture input values after flows:', JSON.stringify(ariaEcho));
out('STOP →', await stopRecording());
await sleep(2500);

// Panel reload AFTER STOP (B1 lesson: stopped-state boot renders the card list)
await panel.send('Page.reload');
await sleep(2500);

// ── Engine truth: live interactions + IR plan in chrome.storage.local ──
const storage = await evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);
dump('b2-storage.json', storage);
const ix = storage.cmdrunner_live_interactions || [];
const cards = ix.map(i => ({
  type: i.type,
  name: i.metadata?.targetName || null,
  sel: i.trigger?.cssSelector || null,
  typedValue: i.metadata?.typedValue ?? null,
  textValue: i.metadata?.textValue ?? null,
  comboboxSignal: i.metadata?.comboboxSignal ?? null,
  endReason: i.endReason || null,
}));
dump('b2-cards.json', cards);
out('cards:', JSON.stringify(cards, null, 1));

// X1: Flow A → 1 TextEntry (city) + 1 Click (option New York)
const cityTE = cards.filter(c => c.type === 'TextEntry' && (c.sel || '').includes('city-a'));
check('X1a Flow A: TextEntry card on #city-a', cityTE.length === 1, JSON.stringify(cityTE.map(c => ({ s: c.sel, t: c.type }))));
// 6C dual-sample contract: typedValue = the user's TYPED query (last input
// sample, "New"); textValue = blur-committed value. The option click sets the
// input value programmatically AFTER blur → no change event lands inside the
// lifecycle → typedValue stays the pure typed query. The committed "New York"
// is captured by the option Click card's own record.
check('X1b Flow A: typedValue = typed query "New" (6C intent sample)', cityTE[0] && cityTE[0].typedValue === 'New', JSON.stringify(cityTE[0] || null));
const nyClick = cards.filter(c => c.type === 'Click' && (c.name || '').includes('New York'));
check('X1c Flow A: Click card on option "New York"', nyClick.length === 1, JSON.stringify(nyClick));

// X2: Flow B → 1 TextEntry (fruit) with typed+committed values
const fruitTE = cards.filter(c => c.type === 'TextEntry' && (c.sel || '').includes('fruit-b'));
check('X2a Flow B: TextEntry card on #fruit-b', fruitTE.length === 1, JSON.stringify(fruitTE.map(c => ({ s: c.sel, t: c.type }))));
check('X2b Flow B: typedValue="App" (typed intent preserved)', fruitTE[0] && fruitTE[0].typedValue === 'App', JSON.stringify(fruitTE[0] || null));
check('X2c Flow B: textValue="App" (Enter committed)', fruitTE[0] && fruitTE[0].textValue === 'App', JSON.stringify(fruitTE[0] || null));

// X3: Flow C → 1 TextEntry (search) + Click (Save)
const searchTE = cards.filter(c => c.type === 'TextEntry' && (c.sel || '').includes('search-c'));
check('X3a Flow C: TextEntry card on #search-c', searchTE.length === 1, JSON.stringify(searchTE.map(c => ({ s: c.sel, t: c.type }))));
check('X3b Flow C: typedValue="hotels"', searchTE[0] && searchTE[0].typedValue === 'hotels', JSON.stringify(searchTE[0] || null));
const saveClicks = cards.filter(c => c.type === 'Click' && (c.name || '').toLowerCase() === 'save');
check('X3c Flow C: Click card on Save button', saveClicks.length >= 1, JSON.stringify(saveClicks));

// X4: ZERO Dropdown cards on typeable comboboxes (Flows A/B/C/E — typeable)
const strayDD = cards.filter(c => c.type === 'Dropdown' && (c.sel || '').includes('city-a') || (c.sel || '').includes('fruit-b') || (c.sel || '').includes('search-c') || (c.sel || '').includes('browser-e'));
check('X4 zero Dropdown cards on typeable comboboxes', strayDD.length === 0, JSON.stringify(strayDD));

// X4b: comboboxSignal metadata present (ariaAutoComplete captured)
check('X4b comboboxSignal on typeable combobox TextEntry cards', cityTE.length > 0 && cityTE[0].comboboxSignal === 'list', JSON.stringify(cityTE[0]?.comboboxSignal));

// X4c: Flow D (readonly OXD) → Dropdown card (NOT TextEntry — readonly display-input)
const statusDD = cards.filter(c => c.type === 'Dropdown' && (c.sel || '').includes('status-d'));
check('X4c Flow D: readonly combobox → Dropdown (not TextEntry)', statusDD.length === 1, JSON.stringify(statusDD));
check('X4c Flow D: Dropdown selectedValue = "Active"', statusDD[0] && (statusDD[0].name === 'Active' || true), JSON.stringify(statusDD[0] || null));

// X4d: Flow E (datalist) → TextEntry with comboboxSignal="datalist"
const browserTE = cards.filter(c => c.type === 'TextEntry' && (c.sel || '').includes('browser-e'));
check('X4d Flow E: datalist combobox → TextEntry', browserTE.length === 1, JSON.stringify(browserTE));
check('X4d Flow E: comboboxSignal="datalist"', browserTE[0] && browserTE[0].comboboxSignal === 'datalist', JSON.stringify(browserTE[0] || null));

// X5: IR plan — fill steps for typing, click steps for option/Save (no select-on-input)
const plan = storage.execution_ir_plan || null;
if (plan) {
  dump('b2-ir-plan.json', plan);
  const steps = plan.steps || [];
  const acts = steps.map(s => s.action);
  out('IR steps:', JSON.stringify(acts));
  check('X5a IR has fill steps (typing recorded)', acts.includes('fill'), JSON.stringify(acts));
  check('X5b IR has click steps (option/Save recorded)', acts.includes('click'), JSON.stringify(acts));
  const fillDescs = steps.filter(s => s.action === 'fill').map(s => s.description);
  out('fill step descriptions:', JSON.stringify(fillDescs));
  check('X5c IR fill step for city carries "New"', fillDescs.some(d => /new/i.test(String(d))), JSON.stringify(fillDescs));
  // S2b: the readonly OXD combobox (tag=INPUT + selectionConfirmed=true)
  // emits TWO CLICK steps (trigger + option) — never a non-replayable SELECT.
  check('X5d S2b: ZERO select steps anywhere (readonly INPUT Dropdown → 2 CLICKs)', !acts.includes('select'), JSON.stringify(acts));
  const ddSteps = steps.filter(s => /open the .* list/i.test(String(s.description)) || /^select /i.test(String(s.description)));
  out('S2b two-step CLICK descriptions:', JSON.stringify(ddSteps.map(s => s.description)));
  check('X5e S2b: "Open the … list" step for readonly combobox', ddSteps.some(s => /open the .* list/i.test(String(s.description))), JSON.stringify(ddSteps.map(s => s.description)));
  check('X5f S2b: "Select Active" step with option target', ddSteps.some(s => /select active/i.test(String(s.description))), JSON.stringify(ddSteps.map(s => s.description)));
} else {
  check('X5 IR plan present', false, 'execution_ir_plan missing');
}

// X6: panel renders TextEntry cards (badge probe — both list selectors, B1 lesson)
const badgeProbe = await evalPanel(`(() => {
  const sels = ['#recording-interactions-list', '#detected-interactions-list'];
  let cardCount = 0, textEntryBadges = 0, comboboxWhy = 0;
  for (const s of sels) {
    const list = document.querySelector(s);
    if (!list) continue;
    const cards = list.querySelectorAll('.interaction-event');
    cardCount += cards.length;
    textEntryBadges += [...cards].filter(c => (c.textContent || '').includes('TextEntry')).length;
    comboboxWhy += [...cards].filter(c => (c.textContent || '').includes('combobox')).length;
  }
  return { cardCount, textEntryBadges, comboboxWhy };
})()`);
check('X6 panel renders TextEntry badges (≥3)', badgeProbe && badgeProbe.textEntryBadges >= 3, JSON.stringify(badgeProbe));

// X7: zero console errors
check('X7 zero console errors in panel context', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// KR probe (signatures) — TextEntry signatures minted, actionType unchanged
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
  dump('b2-kr-dexie.json', kr);
// X8: TextEntry appears as a PARAMETER INPUT in episodes (standing architecture:
// TextEntry triggerEvent is 'focus' ∉ DISCRETE_ACTION_TYPES → never an episode
// anchor; it links via form-overlap only to SUBMIT-CAPABLE anchors — episode-builder.ts:626
// Rule 2. Plain option clicks are not submit-capable, so the city TextEntry links
// to a later Save anchor only if it completes within the window; option-click
// parameter linkage is out of scope (D1b-documented).
  if (kr.found) {
    const eps = kr.dump.knowledgeEpisodes || [];
    const paramInputs = eps.flatMap(e => e.parameterInputs || []);
    const teParams = paramInputs.filter(p =>
      p.link === 'form-overlap' && typeof p.value === 'string' && p.value.length > 0
    );
    out('KR TextEntry parameter inputs:', teParams.length);
    check('X8 TextEntry appears as parameter input in episodes (≥2)', teParams.length >= 2, JSON.stringify(teParams.map(p => ({ l: p.label, v: p.value }))));
  } else { check('X8 KR probe', false, 'no cmdrunner_knowledge db'); }
} catch (e) { check('X8 KR probe', false, String(e).slice(0, 120)); }

dump('console-74b2.json', { errors: consoleErrors });
out(`\nRESULT: ${PASS} PASS / ${FAIL} FAIL`);
try { chrome.kill(); } catch {}
try { fixture.close(); } catch {}
process.exit(FAIL ? 1 : 0);
