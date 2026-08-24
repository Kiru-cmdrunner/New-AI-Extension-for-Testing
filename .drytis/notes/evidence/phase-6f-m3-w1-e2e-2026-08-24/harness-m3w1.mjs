// 6F-M3 Wave 1 real-Chrome E2E harness. House CDP pattern (6D.1/6D.2/6E/6F):
// fresh Chrome + fresh profile + fresh port; panel-context START/STOP; trusted
// CDP input; storage + panel-DOM probes.
//
// Matrix:
//  M1-O13  stopped view: card with NO behavioral evidence renders the terminal
//          note "No behavioral evidence captured for this interaction", and
//          "Collecting behavioral evidence" NEVER appears in the stopped view.
//  M2-O2   DOM-changes evidence: no-op rows (attr-only old==new) are hidden
//          with a "· N no-op hidden" header; material rows render.
//  M3-O12  sw-recovered no-owner path is hard to force deterministically in
//          this harness (needs crash-window timing) — verified by unit pins;
//          here we pin the NON-regression: zero notices on normal cards.
//  M4-O14  navigation to /flights?origin=MAA&dest=DEL&utm_source=test with NO
//          title → card label shows origin+path only (query params absent).
//  M5      regression: DatePicker round-trip + 6B data-auto-id click intact
//          (same fixture family as 6E-M2/6F-M1) and zero twin Click cards.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9500 + Math.floor(Math.random() * 400);
const APP = 'http://127.0.0.1:8191';
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-6f-m3-w1-e2e-2026-08-24/dumps';
const PROFILE = '/tmp/6fm3-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 900) : ''}`);
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
// Wait for the fixture DOM to be present (the fresh tab may still be loading)
for (let i = 0; i < 15; i++) {
  const ready = await evalApp(`!!document.querySelector('#onward')`).catch(() => false);
  if (ready) break;
  await sleep(500);
}
out('app ready =', await evalApp(`!!document.querySelector('#onward')`));
out('START →', await startRecording());
await sleep(1000);

// ── M5 regression: DatePicker round-trip (6E-M2/6F-M1 fixture family) ──
await clickEl('#onward');
await sleep(500);
await clickEl('#month-onward .react-datepicker__day', 1);
await sleep(900);
const depVal = await evalApp(`document.getElementById('onward').value`);
out('depart value =', JSON.stringify(depVal));

// ── M2-O2: no-op attribute churn click ──
await clickEl('#noop-churn');
await sleep(900);

// ── M5 regression: 6B data-auto-id ──
await clickEl('#go');
await sleep(600);

// ── M4-O14: real navigation with query URL and NO title ──
await clickEl('#nav-away');
await sleep(1800);

await sleep(1200);
out('STOP →', await stopRecording());
await sleep(3000);

const storage = await evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);
dump('m3-storage.json', storage);
const ix = storage.cmdrunner_live_interactions || [];
const cards = ix.map(i => ({
  type: i.type,
  name: i.metadata?.targetName || null,
  dateValue: i.metadata?.dateValue || i.metadata?.textValue || null,
  pageUrl: i.metadata?.pageUrl || null,
  pageTitle: i.metadata?.pageTitle || null,
  sel: i.trigger?.cssSelector || null,
  dataAutoId: i.trigger?.dataAutoId || null,
  ev: i.behavioralEvidence ? {
    endReason: i.behavioralEvidence?.window?.endReason || null,
    domChanges: (i.behavioralEvidence?.applicationEvidence?.domChanges || []).map(c => ({
      attrs: c.changedAttributes, deltas: c.attributeDeltas,
      added: c.addedNodesCount, removed: c.removedNodesCount,
      text: c.characterDataDelta ? true : false,
    })),
  } : null,
}));
dump('m3-cards.json', cards);
out('cards:', JSON.stringify(cards.map(c => ({ t: c.type, n: (c.name || '').slice(0, 40), u: (c.pageUrl || '').slice(0, 60) }))));

// ── M5: DatePicker + 6B regression ──
const dp = cards.filter(c => c.type === 'DatePicker');
check('M5 DatePicker completed with selected date', dp.length >= 1 && dp.some(c => String(c.dateValue || '').includes('Sep')), `${dp.length} DatePicker cards`);
const e4 = cards.filter(c => c.dataAutoId === 'search-flights');
check('M5 6B regression: data-auto-id search-flights → exactly one Click', e4.length === 1 && e4[0].type === 'Click', JSON.stringify(e4.map(c => c.type)));
const twinClicks = cards.filter(c => c.type === 'Click' && /Choose (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/i.test(c.name || ''));
check('M5 6F-M1 regression: zero twin Click cards on calendar cells', twinClicks.length === 0, `${twinClicks.length} twin clicks`);

// ── M2-O2: DOM-change display behavior via the live panel DOM ──
// (renderDomChanges is exercised by rendering; we assert on the stopped view
//  DOM below after switching the panel to stopped.)
const noopChurn = cards.find(c => c.type === 'Click' && /Churn/i.test(c.name || ''));
check('M2 fixture: no-op churn Click captured', !!noopChurn, JSON.stringify(cards.map(c => ({ t: c.type, n: c.name }))));

// ── M4-O14: navigation card with query URL, no title ──
const navs = cards.filter(c => c.type === 'Navigation');
check('M4 fixture: Navigation card captured',
  navs.length >= 1 && /origin=MAA/.test(String(navs[0].pageUrl || '')),
  JSON.stringify(navs.map(n => ({ t: n.type, u: n.pageUrl, ti: n.pageTitle }))));

// ── Panel stopped-view DOM assertions (M1-O13, M2-O2 header, M4-O14 label) ──
await panel.send('Page.reload');
await sleep(2500);
const panelText = await evalPanel(`document.body.innerText`);
fs.writeFileSync(`${OUT}/m3-panel-stopped.txt`, panelText);

// M4-O14: the CARD label must be the display form. The IR Playwright section
// legitimately keeps the full raw URL (AC6 machine-record guarantee), so the
// assertion scopes to the interaction card text, not the whole panel body.
const navCardText = await evalPanel(`(() => {
  const cards = [...document.querySelectorAll('.interaction-event')];
  return cards.map(c => c.innerText).filter(t => t && t.includes('Navigate')).join('\\n') || '';
})()`);
fs.writeFileSync(`${OUT}/m3-nav-card.txt`, navCardText);
check('M4-O14: nav card label shows origin+path, query params ABSENT',
  (() => {
    // Scope to the CARD LABEL line (the business-meaning text), not the whole
    // card body: the evidence section legitimately shows a TRUNCATED URL
    // ("?origin=MAA…") inside the navigation row — that's display-truncated
    // raw evidence, allowed. Only the label line is asserted display-form.
    const lines = navCardText.split('\n').map(l => l.trim());
    const label = lines.find(l => l.startsWith('Navigate to ')) || '';
    const labelOk = label === 'Navigate to http://127.0.0.1:8191/flights';
    // The label must never carry the raw query
    return labelOk && !label.includes('origin=MAA') && !label.includes('utm_source');
  })(),
  navCardText.slice(0, 500));
check('M4-O14b: IR section KEEPS the full raw URL (AC6 machine record)',
  panelText.includes('origin=MAA') && panelText.includes('utm_source'),
  'raw URL expected in IR/playwright section');
check('M1-O13: stopped view NEVER shows "Collecting behavioral evidence"',
  !panelText.includes('Collecting behavioral evidence'),
  panelText.includes('Collecting behavioral evidence') ? 'found live placeholder in stopped view' : 'clean');

const terminalCount = (panelText.match(/No behavioral evidence captured for this interaction/g) || []).length;
out('terminal notes in stopped view:', terminalCount);
check('M1-O13: terminal note present where evidence is absent (≥1 card)',
  terminalCount >= 1 || cards.every(c => c.ev !== null),
  terminalCount === 0 && cards.some(c => c.ev === null)
    ? 'evidence-less card exists but no terminal note rendered'
    : `${terminalCount} notes; evidence-less cards: ${cards.filter(c => !c.ev).length}`);

check('M2-O2: no-op hidden header present in panel DOM',
  panelText.includes('no-op hidden') || !panelText.includes('DOM Changes'),
  panelText.split('\n').filter(l => l.includes('DOM Changes')).join(' | ').slice(0, 400));

// ── M3-O12 non-regression: zero recovered notices on normal cards ──
check('M3-O12 non-regression: no recovered-after-unload notice on this normal flow',
  !panelText.includes('recovered after page unload'),
  'unexpected notice in a no-crash flow');

// console errors?
const errors = await evalPanel(`(window.__errs || []).length`).catch(() => 0);
out('panel js error count probe:', errors);

out(`\n════ 6F-M3 W1 E2E — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
try { chrome.kill('SIGTERM'); } catch {}
setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} }, 2000);
process.exit(FAIL === 0 ? 0 : 1);
