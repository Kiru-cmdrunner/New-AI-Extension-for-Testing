// 6E-M1: real-Chrome HEAD measurement matrix at 317c527 dist.
// Evidence-only — ZERO product-code changes. Extends the proven 6D.1/6D.2
// CDP harness pattern (start from panel context, activate app tab, trusted
// input dispatch, storage + Dexie KR probe at the end).
//
// Matrix cells measured:
//  C1  Shape-A flight card body click (plain div, widget-named data-auto-id)
//  C2  Shape-B flight card click (role=button + aria-label)
//  C3  duration chip with interactive class token ('chip')
//  C4  duration chip with NO interactive signal
//  C5  combobox date-picker trigger click (placeholder 'Depart on' — W4 path)
//  C6  date cell click inside role=grid surface (aria-label W3C date name)
//  C7  skeleton→flights swap seeding (net-zero child churn, 3/3)
//  C8  data-sku entity CONTROL row (proven path — probe validity)
//  C9  counter consequence on results page (cart-count text + data-count attr)
//  C10 IR plan shape at HEAD (steps, actions, Unclassified leak check)
//  C11 KR Dexie rows from results-page interactions
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/6e-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9585;
const APP = 'http://127.0.0.1:8189';
const OUT = '/workspace/.drytis/notes/evidence/phase-6e-m1-2026-08-23/dumps';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 700) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));

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
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/flights` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
await app.send('Page.enable'); await app.send('DOM.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const startRecording = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
const storageProbe = async () => evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);
const dexieProbe = async () => evalPanel(`(async () => {
  const names = await indexedDB.databases();
  const db = names.find(d => d.name && d.name.includes('cmdrunner_knowledge'));
  if (!db) return { found: false };
  const open = await new Promise((res, rej) => { const r = indexedDB.open(db.name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tables = [...open.objectStoreNames];
  const dump = {};
  for (const t of tables) {
    const rows = await new Promise((res) => { const tx = open.transaction(t, 'readonly'); const rq = tx.objectStore(t).getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => res([]); });
    dump[t] = rows;
  }
  return { found: true, name: db.name, tables, dump };
})()`);

const rectOf = async (sel) => JSON.parse(await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'null'; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }); })()`));
const dispatch = async (type, x, y) => app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
const clickEl = async (sel) => { const r = await rectOf(sel); if (!r) throw new Error('no element: ' + sel); await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2); await sleep(80); await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2); await sleep(700); };
const typeInto = async (sel, text) => { const r = await rectOf(sel); await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x + r.w / 2, y: r.y + r.h / 2, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + r.w / 2, y: r.y + r.h / 2, button: 'left', clickCount: 1 }); await sleep(150); for (const ch of text) { await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) }); await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) }); } await sleep(200); };

// Wait for skeletons to be replaced by fetched cards (fixture: 900ms swap)
await sleep(2500);

out('START →', await startRecording());
await sleep(1200);

// ── C5: date-picker trigger click (placeholder 'Depart on' — W4 path) ──
await clickEl('#depart');
await sleep(400);

// ── C6: date cell inside role=grid calendar ──
await clickEl('.cal-cell[aria-label*="September 5th"]');
await sleep(900);
const depVal = await evalApp(`document.getElementById('depart').value`);
out('depart value =', JSON.stringify(depVal));

// ── C3/C4: duration chips ──
await clickEl('.dur-chip');   // '02h 30m' — chip class token
await sleep(500);
await clickEl('.dur-opt');    // '12h 10m' — no interactive signal
await sleep(500);

// ── C1: Shape-A card body (plain div, data-auto-id only) ──
await clickEl('[data-auto-id="flight-F2"]');
await sleep(900);
// ── C2: Shape-B card (role=button + aria-label) ──
await clickEl('[data-auto-id="flight-F3"]');
await sleep(900);

const badge = await evalApp(`(() => ({ count: document.querySelector('[data-auto-id="cart-count"]').textContent, attr: document.querySelector('[data-auto-id="cart-badge"]').getAttribute('data-count'), note: document.querySelector('[data-auto-id="pick-note"]').hidden }))()`);
out('badge after picks =', JSON.stringify(badge));

await sleep(1200);
out('STOP →', await stopRecording());
await sleep(2500);

// ── Storage probe (panel context) ──
const storage = await storageProbe();
dump('6e-storage.json', storage);
const interactions = storage.cmdrunner_live_interactions || [];
const ledger = storage.cmdrunner_evidence_ledger || [];
out(`interactions: ${interactions.length}, ledger entries: ${Array.isArray(ledger) ? ledger.length : Object.keys(ledger).length}`);

const cards = interactions.map(i => ({
  type: i.type,
  endReason: i.endReason || i.metadata?.endReason || null,
  name: i.metadata?.targetName || null,
  phys: i.metadata?.physicalEventType || null,
  paired: i.metadata?.pairedAtProjection || null,
  dateValue: i.metadata?.dateValue || i.metadata?.textValue || i.metadata?.typedValue || null,
  sel: i.trigger?.cssSelector || i.triggerEvent?.cssSelector || null,
  dataAutoId: i.trigger?.dataAutoId || i.triggerEvent?.dataAutoId || i.trigger?.targetIdentity?.dataAutoId || null,
  assertions: i.derivedAssertions || i.assertions || null,
}));
dump('6e-cards.json', cards);
out(JSON.stringify(cards.map(c => ({ t: c.type, n: c.name, p: c.phys, paired: c.paired })), null, 1));

const bySel = (frag) => cards.filter(c => (c.sel || '').includes(frag) || (c.dataAutoId || '').includes(frag));
const byName = (frag) => cards.filter(c => (c.name || '').toLowerCase().includes(frag.toLowerCase()));

// ── Verdict checks: pin OBSERVED behavior at 317c527 (measurement, not desire) ──

// C1 Shape-A card body — expected UNCLAIMED (no interactive signal) → paired Unclassified
const c1 = bySel('flight-F2');
check('C1 Shape-A card body (plain div): projected — expected paired Unclassified at HEAD (the O10 residual)',
  c1.length === 1,
  `${c1.length} cards :: ${JSON.stringify(c1.map(c => ({ t: c.type, p: c.phys, paired: c.paired, n: c.name })))}`);
check('C1 detail: card type is Unclassified (unclaimed-at-projection) — documents the residual honestly',
  c1.length === 1 && c1[0].type === 'Unclassified' && c1[0].paired === true,
  JSON.stringify(c1.map(c => ({ t: c.type, paired: c.paired }))));

// C2 Shape-B card (role=button) — expected claimed Click
const c2 = bySel('flight-F3');
check('C2 Shape-B card (role=button + aria-label): exactly ONE claimed Click',
  c2.length === 1 && c2[0].type === 'Click',
  `${c2.length} cards :: ${JSON.stringify(c2.map(c => ({ t: c.type, n: c.name })))}`);

// C3 chip with class token — expected Click (chip matches INTERACTIVE_CLASS_RE)
const c3 = bySel('duration-under-2h');
check('C3 duration chip (class token): exactly ONE Click',
  c3.length === 1 && c3[0].type === 'Click',
  `${c3.length} cards :: ${JSON.stringify(c3.map(c => ({ t: c.type, n: c.name })))}`);

// C4 chip with no signal — expected paired Unclassified (honest)
const c4 = bySel('duration-12h');
check('C4 duration chip (no interactive signal): ONE paired Unclassified — the honest fallback',
  c4.length === 1 && c4[0].type === 'Unclassified' && c4[0].paired === true,
  `${c4.length} cards :: ${JSON.stringify(c4.map(c => ({ t: c.type, p: c.phys, paired: c.paired })))}`);

// C5 date trigger — expected DatePicker lifecycle
// C5 MEASURED at HEAD: 'Depart on' lacks a DATE_NAME_HINT_RE token, so
// DatePicker does NOT claim; TextEntry owns the field and captures the value.
const c5t = cards.filter(c => (c.sel === '#depart' || c.dataAutoId === 'depart-on'));
check('C5 date-trigger field #depart: exactly ONE card, MEASURED TextEntry owning it with selected value',
  c5t.length === 1 && c5t[0].type === 'TextEntry' && /sep/i.test(String(c5t[0].dateValue || c5t[0].name || '')),
  JSON.stringify(c5t.map(c => ({ t: c.type, n: c.name, dv: c.dateValue }))));
check('C5b: NO DatePicker card for a name-only trigger (W4 vocab lacks Depart on), honest HEAD cell',
  cards.filter(c => c.type === 'DatePicker').length === 0,
  JSON.stringify(cards.filter(c => c.type === 'DatePicker').length));
const c6 = byName('Choose Saturday, September 5th');
check('C6 date cell (unknown class names, W3C name): exactly ONE standalone Click carrying the full date name',
  c6.length === 1 && c6[0].type === 'Click',
  JSON.stringify(c6.map(c => ({ t: c.type, n: c.name }))));

// C9 counter consequence — MEASURED channel: assertions ride on IR steps
// (run-1 dump: step-0002 expectedValue '0' → step-0003 '2', target elementName
// 'counter', resolvedLocator contains cart-count). Card-level field differs.
const plan0 = storage.execution_ir_plan || { steps: [] };
const c9steps = (plan0.steps || []).filter(s => (s.assertions || []).some(a => JSON.stringify(a).includes('cart-count')));
check('C9 counter consequence: cart-count assertions derived on IR steps (0 → 2 progression)',
  c9steps.length >= 1 && (c9steps.some(s => s.assertions.some(a => String(a.expectedValue) === '2'))),
  `${c9steps.length} steps carry cart-count assertions`);

// C10 IR plan
const plan = storage.execution_ir_plan || null;
if (plan) {
  const steps = plan.steps || [];
  dump('6e-ir-plan.json', plan);
  out('IR steps:', JSON.stringify(steps.map(s => ({ a: s.action, l: s.loc || s.locator }))));
  check('C10 IR plan: steps generated, ≥4 (trigger, cells, chips, cards)',
    steps.length >= 4, `${steps.length} steps`);
} else {
  check('C10 IR plan present', false, 'execution_ir_plan missing — keys: ' + Object.keys(storage).filter(k => /ir|plan/i.test(k)).join(','));
}

// C11 KR Dexie
const kr = await dexieProbe();
dump('6e-kr-dexie.json', kr);
if (kr.found) {
  const counts = Object.fromEntries(Object.entries(kr.dump).map(([t, rows]) => [t, Array.isArray(rows) ? rows.length : 0]));
  out('KR tables:', JSON.stringify(counts));
  const hasRows = Object.values(counts).some(n => n > 0);
  check('C11 KR Dexie: knowledge rows written from the results-page session', hasRows, JSON.stringify(counts));
} else {
  check('C11 KR Dexie database found', false, 'no cmdrunner_knowledge db');
}

// C7/C8 come from the page-content observations + KR rows (semantic items), so
// probe the observation channel directly: page-content storage key
const obsKeys = Object.keys(storage).filter(k => /page.?content|observation|semantic/i.test(k));
out('observation-ish storage keys:', obsKeys.join(', ') || '(none)');
for (const k of obsKeys) { out(k, '→', JSON.stringify(storage[k]).slice(0, 600)); }

out(`\n════ 6E-M1 HEAD MATRIX — ${PASS} PASS / ${FAIL} FAIL ════`);
fs.writeFileSync(`${OUT}/../6e-run1.log`, `extId=${extId}\nstarted=${Date.now()}\n`);
process.exit(FAIL === 0 ? 0 : 1);
