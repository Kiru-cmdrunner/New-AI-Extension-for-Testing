// End-to-end SIDE PANEL verification — bd8e907 build (6D.0 + 6A/6C).
// Drives the real side panel DOM (not just chrome.storage) to prove the
// Observed Workflow cards + Evidence sections + IR plan render the new semantics.
// Technique: same CDP harness as multipattern; P-CLASSIC + P-REACTISH.
// Read-only diagnosis harness for the recorder product — no product changes.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9561;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`);
  ok ? PASS++ : FAIL++;
};
const DUMP = '/tmp/sidepanel-e2e';
fs.mkdirSync(DUMP, { recursive: true });

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  try { browser = await CDP({ port: PORT }); break; } catch {}
}
if (!browser) { out('FATAL: chrome never came up'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable');
await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => {
  const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value;
  return v === 'null' ? null : JSON.parse(v);
};
const clickSel = async (sel, label) => {
  const p = await center(sel);
  if (!p) { out(`  !! ${sel} not clickable`); return false; }
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  out('  clicked', label || sel);
  return true;
};
const key = async (k) => {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k.length === 1 ? k.charCodeAt(0) : ({ 'Enter': 13, 'ArrowDown': 40 }[k] || 0) });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k.length === 1 ? k.charCodeAt(0) : ({ 'Enter': 13, 'ArrowDown': 40 }[k] || 0) });
};
const typeInto = async (sel, text) => {
  const p = await center(sel);
  if (!p) return false;
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(250);
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await sleep(35);
  }
  return true;
};
const selectOption = async (sel, idx) => {
  await evalApp(`(() => { document.querySelector(${JSON.stringify(sel)}).focus(); return true; })()`);
  await sleep(250);
  await key('Enter');
  await sleep(350);
  for (let i = 0; i < idx; i++) { await key('ArrowDown'); await sleep(150); }
  await key('Enter');
  await sleep(250);
  await clickSel('body', 'blur');
};

const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(400); };
const stopRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'})`).catch(() => {}); await sleep(800); };

// ── Panel DOM inspection (stopped view classes from sidepanel.ts/index.html) ──
const panelSnapshot = async () => await evalPanel(`(() => {
  const txt = (sel) => Array.from(document.querySelectorAll(sel)).map(n => n.textContent.trim().replace(/\\s+/g, ' '));
  const body = document.body;
  return {
    // Observed Workflow: .timeline-event.interaction-event cards (stopped view, detected list)
    cardTitles: Array.from(document.querySelectorAll('.interaction-event')).slice(0, 25).map(n => n.textContent.slice(0, 160).replace(/\\s+/g, ' ')),
    cardTypes: txt('.timeline-event__type'),
    // Evidence sections
    resultingStateHeaders: txt('.evidence-subheader'),
    allEvidenceRows: txt('.evidence-row').slice(0, 80),
    windowMeta: txt('.evidence-window-meta'),
    // IR plan (stopped view): .step-card entries
    irSteps: Array.from(document.querySelectorAll('.step-card')).slice(0, 25).map(n => n.textContent.slice(0, 160).replace(/\\s+/g, ' ')),
    bodyHasResultingState: body.textContent.includes('Resulting State'),
    bodyTextLength: body.textContent.length,
    detectedSectionHidden: !!document.getElementById('detected-interactions-section')?.hidden,
  };
})()`);

// ═══ PATTERN 1: P-CLASSIC — seeded collection flows to side panel ═══
out('\n═══ SIDE-PANEL E2E — P-CLASSIC ═══');
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await typeInto('#q', 'invoice');
await selectOption('#prio', 2);
await clickSel('#btn-search', 'Search');
await sleep(2800);
await stopRec();
await sleep(1500); // stopped-view retry timers

const snap1 = await panelSnapshot();
fs.writeFileSync(`${DUMP}/panel-classic.json`, JSON.stringify(snap1, null, 2));
out('cardTypes:', JSON.stringify(snap1.cardTypes));
out('cardTitles:', JSON.stringify(snap1.cardTitles, null, 1));
out('resultingStateHeaders:', JSON.stringify(snap1.resultingStateHeaders));
out('evidenceRows:', JSON.stringify(snap1.allEvidenceRows, null, 1));
out('irSteps:', JSON.stringify(snap1.irSteps, null, 1));

check('side panel: interaction cards rendered (stopped view)', snap1.cardTitles.length > 0, `${snap1.cardTitles.length} cards`);
check('side panel: "Resulting State" section rendered', snap1.resultingStateHeaders.some(h => /Resulting State/i.test(h)), `headers=${JSON.stringify(snap1.resultingStateHeaders)}`);
check('side panel: seeded collection row visible (6A flows to panel)', snap1.allEvidenceRows.some(r => /collection/i.test(r)),
  JSON.stringify(snap1.allEvidenceRows.filter(r => /collection/i.test(r))));
check('side panel: IR step cards rendered with assertions', snap1.irSteps.length > 0 && snap1.irSteps.some(s => /assert/i.test(s) || /expect/i.test(s)),
  `${snap1.irSteps.length} steps; with-assert: ${snap1.irSteps.filter(s => /assert|expect/i.test(s)).length}`);

// ═══ PATTERN 2: P-REACTISH — DatePicker typed intent card + 6C evidence ═══
out('\n═══ SIDE-PANEL E2E — P-REACTISH ═══');
await evalApp(`location.href = '${APP}/reactish'`);
await sleep(2000);
await startRec();
await typeInto('.date-input', 'Sat, 22 Aug');
await sleep(400);
await typeInto('.origin-input', 'ben');
await sleep(1300);
await clickSel('.options-list .opt', 'typeahead option');
await sleep(900);
await clickSel('.commit-btn', 'Plan trip');
await sleep(2800);
await stopRec();
await sleep(1500);

const snap2 = await panelSnapshot();
fs.writeFileSync(`${DUMP}/panel-reactish.json`, JSON.stringify(snap2, null, 2));
out('cardTypes:', JSON.stringify(snap2.cardTypes));
out('cardTitles:', JSON.stringify(snap2.cardTitles, null, 1));
out('irSteps:', JSON.stringify(snap2.irSteps, null, 1));

check('side panel: DatePicker card visible with typed date intent (6C)', snap2.cardTitles.some(t => /22 Aug/i.test(t)) || snap2.irSteps.some(s => /22 Aug/i.test(s)),
  JSON.stringify([...snap2.cardTitles.filter(t => /Aug/i.test(t)), ...snap2.irSteps.filter(s => /Aug/i.test(s))]));
check('side panel: TextEntry card shows committed value (typeahead ben→Bengaluru)', snap2.cardTitles.some(t => /Bengaluru/i.test(t)) || snap2.irSteps.some(s => /Bengaluru/i.test(s)),
  JSON.stringify([...snap2.cardTitles.filter(t => /Bengaluru/i.test(t)), ...snap2.irSteps.filter(s => /Bengaluru/i.test(s))]));
check('side panel: reactish IR step cards rendered', snap2.irSteps.length > 0, `${snap2.irSteps.length} steps`);

// ═══ SUMMARY ═══
out('\n════ SIDE-PANEL E2E VALIDATION — ' + PASS + ' PASS / ' + FAIL + ' FAIL ════');
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
