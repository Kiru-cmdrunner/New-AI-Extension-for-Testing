// MS-U2 real-Chrome E2E — evidence drill-downs through the panel's own UI.
// Reuses msu1-final-validation harness skeleton; adds <details> expansion checks.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-msu2-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9567;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 400) : ''}`);
  ok ? PASS++ : FAIL++;
};
const DUMP = '/tmp/msu2-e2e';
fs.mkdirSync(DUMP, { recursive: true });

const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId:', extId);
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const panelErrors = [];
panel.on && panel.on('Runtime.consoleAPICalled', (e) => {
  if (e.type === 'error') panelErrors.push(String((e.args || []).map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 200));
});

const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => { const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value; return v === 'null' ? null : JSON.parse(v); };
const clickSel = async (sel, label) => { const p = await center(sel); if (!p) { out(`  !! ${sel} not clickable`); return false; }
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  out('  clicked', label || sel); return true; };
const key = async (k) => {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k.length === 1 ? k.charCodeAt(0) : ({ 'Enter': 13, 'ArrowDown': 40 }[k] || 0) });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k.length === 1 ? k.charCodeAt(0) : ({ 'Enter': 13, 'ArrowDown': 40 }[k] || 0) });
};
const typeInto = async (sel, text) => { const p = await center(sel); if (!p) return false;
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(250);
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) }); await sleep(35); } return true; };
const selectOption = async (sel, idx) => {
  await evalApp(`(() => { document.querySelector(${JSON.stringify(sel)}).focus(); return true; })()`);
  await sleep(250); await key('Enter'); await sleep(350);
  for (let i = 0; i < idx; i++) { await key('ArrowDown'); await sleep(150); }
  await key('Enter'); await sleep(450);
};
const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopViaPanel = async () => { await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 'clicked'; })()`); };

// Drill-down census on the stopped view
const drilldownCensus = `(() => {
  const cards = Array.from(document.querySelectorAll('.interaction-event'));
  const drills = document.querySelectorAll('details.evidence-drilldown');
  const raw = document.querySelector('details.raw-evidence');
  const itemDrills = document.querySelectorAll('details.evidence-drilldown--item');
  const netDrills = document.querySelectorAll('details.evidence-drilldown--network');
  const domDrills = document.querySelectorAll('details.evidence-drilldown--dom');
  const surfDrills = document.querySelectorAll('details.evidence-drilldown--surface');
  const winDrills = document.querySelectorAll('details.evidence-drilldown--window');
  return {
    cards: cards.length,
    drills: drills.length,
    allCollapsed: Array.from(drills).every(d => !d.open),
    raw: !!raw, rawSummary: raw ? raw.querySelector('summary')?.textContent : null,
    itemDrills: itemDrills.length, netDrills: netDrills.length, domDrills: domDrills.length,
    surfDrills: surfDrills.length, winDrills: winDrills.length,
    firstItemText: itemDrills[0] ? itemDrills[0].textContent : null,
    bars: document.querySelectorAll('.stability-bar').length,
  };
})()`;

// ═══ RUN — classic (search: TextEntry + Dropdown + Click w/ resulting state) ═══
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await typeInto('#q', 'invoice');
await selectOption('#prio', 2);
await clickSel('#btn-search', 'Search');
await sleep(3000);
await stopViaPanel();
let v1 = null;
for (let i = 0; i < 15; i++) { await sleep(1000); v1 = await evalPanel(drilldownCensus); if (v1.cards > 0) break; }
await sleep(1200);
v1 = await evalPanel(drilldownCensus);
out('\n── classic census ──'); out(JSON.stringify(v1, null, 2));
fs.writeFileSync(`${DUMP}/classic-census.json`, JSON.stringify(v1, null, 2));

check('cards render (panel healthy)', v1.cards > 0, `cards=${v1.cards}`);
check('A1: drill-downs present and ALL collapsed by default', v1.drills > 0 && v1.allCollapsed, `drills=${v1.drills} collapsed=${v1.allCollapsed}`);
check('D2: item drill-downs on resulting-state rows', v1.itemDrills > 0, `itemDrills=${v1.itemDrills}`);
check('D7: raw JSON disclosure present on stopped view', v1.raw && /raw evidence/i.test(v1.rawSummary || ''), `raw=${v1.raw} summary=${v1.rawSummary}`);

// Expand one item drill-down: verify seed/selector provenance visible + textContent-only
const expandCheck = await evalPanel(`(() => {
  const d = document.querySelector('details.evidence-drilldown--item');
  if (!d) return { ok: false, why: 'no item drilldown' };
  d.open = true;
  const t = d.textContent || '';
  return { ok: t.includes('via '), text: t.slice(0, 220) };
})()`);
check('D2 expanded: provenance row `via …` visible', expandCheck.ok && expandCheck.ok !== false, JSON.stringify(expandCheck).slice(0, 300));

// Expand raw JSON: verify parseable + contains behavioralEvidence keys
const rawCheck = await evalPanel(`(() => {
  const d = document.querySelector('details.raw-evidence');
  if (!d) return { ok: false, why: 'none' };
  d.open = true;
  const pre = d.querySelector('pre');
  if (!pre) return { ok: false, why: 'no pre' };
  try {
    const parsed = JSON.parse(pre.textContent);
    return { ok: true, keys: Object.keys(parsed).slice(0, 8), len: pre.textContent.length };
  } catch (e) { return { ok: false, why: 'parse: ' + e.message, head: pre.textContent.slice(0, 80) }; }
})()`);
check('D7 expanded: raw JSON parses as the evidence object', rawCheck.ok, JSON.stringify(rawCheck).slice(0, 300));

// ═══ RUN — shop (stepper clicks: surfaces + dom drills + stability) ═══
await evalPanel(`document.getElementById('record-another-btn') && document.getElementById('record-another-btn').click()`);
await sleep(800);
await evalApp(`location.href = '${APP}/shop'`);
await sleep(1500);
await startRec();
await clickSel('.card[data-sku="SKU-A"] .step-up', 'step-up SKU-A');
await sleep(800);
await clickSel('.card[data-sku="SKU-B"] .step-up', 'step-up SKU-B');
await sleep(3000);
await stopViaPanel();
let v2 = null;
for (let i = 0; i < 15; i++) { await sleep(1000); v2 = await evalPanel(drilldownCensus); if (v2.cards > 0) break; }
await sleep(1200);
v2 = await evalPanel(drilldownCensus);
out('\n── shop census ──'); out(JSON.stringify(v2, null, 2));
fs.writeFileSync(`${DUMP}/shop-census.json`, JSON.stringify(v2, null, 2));

check('D4: dom-change drill-downs on shop clicks', v2.domDrills > 0, `domDrills=${v2.domDrills}`);
const domExpand = await evalPanel(`(() => {
  const d = document.querySelector('details.evidence-drilldown--dom');
  if (!d) return { ok: false };
  d.open = true;
  const t = d.textContent || '';
  return { ok: /mutations/.test(t), text: t.slice(0, 160) };
})()`);
check('D4 expanded: raw mutation count visible', domExpand.ok, JSON.stringify(domExpand).slice(0, 220));

const winExpand = await evalPanel(`(() => {
  const d = document.querySelector('details.evidence-drilldown--window');
  if (!d) return { ok: false, why: 'no window drilldown' };
  d.open = true;
  const bars = d.querySelectorAll('.stability-bar').length;
  const t = d.textContent || '';
  return { ok: bars > 0 && /samples/.test(t), bars, text: t.slice(0, 160) };
})()`);
check('D6 expanded: stability samples + bars render', winExpand.ok, JSON.stringify(winExpand).slice(0, 220));

// Reactish for surface drill (new surfaces on commit)
await evalPanel(`document.getElementById('record-another-btn') && document.getElementById('record-another-btn').click()`);
await sleep(800);
await evalApp(`location.href = '${APP}/reactish'`);
await sleep(1500);
await startRec();
await clickSel('.commit-btn', 'Plan trip');
await sleep(3000);
await stopViaPanel();
let v3 = null;
for (let i = 0; i < 15; i++) { await sleep(1000); v3 = await evalPanel(drilldownCensus); if (v3.cards > 0) break; }
await sleep(1200);
v3 = await evalPanel(drilldownCensus);
out('\n── reactish census ──'); out(JSON.stringify(v3, null, 2));
fs.writeFileSync(`${DUMP}/reactish-census.json`, JSON.stringify(v3, null, 2));

const surfExpand = await evalPanel(`(() => {
  const d = document.querySelector('details.evidence-drilldown--surface');
  if (!d) return { ok: false, why: 'no surface drilldown', surfDrills: ${JSON.stringify(v3.surfDrills)} };
  d.open = true;
  const t = d.textContent || '';
  return { ok: /descendants|emergence|batch/.test(t), text: t.slice(0, 160) };
})()`);
check('D5 expanded: surface structural detail visible', surfExpand.ok, JSON.stringify(surfExpand).slice(0, 220));

await sleep(600);
out('\npanel console errors:', panelErrors.length ? panelErrors : 'none');
check('zero panel console errors', panelErrors.length === 0, panelErrors.join(' | '));

out(`\n════ MS-U2 E2E — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
