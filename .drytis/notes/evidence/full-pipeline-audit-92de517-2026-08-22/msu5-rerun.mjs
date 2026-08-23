// MS-U5 E2E — forward links driven by REAL recordings in ONE profile.
// Flow: load extension → record P-CLASSIC #1 → check side panel forward
// block shows '◆ new signature' lines → STOP → record #2 on the same app →
// forward block shows '◆ reinforced ×2' → repository page Knowledge tab
// shows Action signatures + honest F3 locator-durability state → zero
// console errors. Read-only vs KR (rendering only).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/msu5-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9576;
const APP = 'http://127.0.0.1:8177';
const DUMP = '/tmp/msu5-rerun/dumps';
fs.mkdirSync(DUMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`);
  ok ? PASS++ : FAIL++;
};

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
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const consoleErrors = [];
panel.on('Runtime.consoleAPICalled', (e) => {
  if (e.type === 'error') consoleErrors.push(e.args?.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});

const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => {
  const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value;
  return v === 'null' ? null : JSON.parse(v);
};
const clickSel = async (sel) => {
  const p = await center(sel);
  if (!p) { out(`  !! ${sel} not clickable`); return false; }
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  return true;
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

const panelForwardText = async () => await evalPanel(`(() => {
  const el = document.querySelector('.understanding-card__forward');
  return el ? el.textContent.replace(/\\s+/g, ' ') : null;
})()`);

// ── Recording #1 ── (STOP via the panel's REAL stop button — this drives
// handleStopRecording → showView('stopped') → renderSessionUnderstanding;
// the raw SW message alone bypasses the panel render path, as MS-U3 proved.)
await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {});
await sleep(600);
await typeInto('#q', 'invoice');
await clickSel('#btn-search');
await sleep(2800);
await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
await sleep(6000); // understanding pipeline + KR writes + late storage listener re-render

const fwd1 = await panelForwardText();
out('\n── forward block after recording #1:');
out(fwd1 ?? '(absent)');
fs.writeFileSync(`${DUMP}/forward-1.txt`, fwd1 ?? '(absent)');
check('R1: forward block present after first recording', fwd1 !== null);
check('R1: new-signature line shown', !!fwd1 && fwd1.includes('◆ new signature'));
check('R1: summary = all-new session', !!fwd1 && fwd1.includes('No signatures existed before this session'));
check('R1: F2 gap guidance present (multipattern has unattributed consequences)', !!fwd1 && /observation\(s\) could not be attributed/.test(fwd1));

// ── Recording #2 (same profile, same app → reinforcement) ──
await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {});
await sleep(600);
await typeInto('#q', 'invoice');
await clickSel('#btn-search');
await sleep(2800);
await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
await sleep(6000);

const fwd2 = await panelForwardText();
out('\n── forward block after recording #2:');
out(fwd2 ?? '(absent)');
fs.writeFileSync(`${DUMP}/forward-2.txt`, fwd2 ?? '(absent)');
check('R2: forward block present after second recording', fwd2 !== null);
check('R2: reinforced ×2 line shown', !!fwd2 && fwd2.includes('◆ reinforced ×2'));
check('R2: reinforced summary (not all-new)', !!fwd2 && fwd2.includes('reinforced existing knowledge'));
check('R2: instant-recognition forward claim for active sig', !!fwd2 && fwd2.includes('recognized instantly next session'));

// ── Repository page: F3 locator durability honest state ──
const { targetId: repoTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/repository/index.html` });
await sleep(3000);
const repo = await CDP({ target: repoTab, port: PORT });
await repo.send('Runtime.enable');
const evalRepo = async (expr) => (await repo.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const repoText = await evalRepo(`document.body.textContent.replace(/\\s+/g, ' ')`);
fs.writeFileSync(`${DUMP}/repo-after-2.txt`, repoText.slice(0, 4000));
check('F3: signatures render on Knowledge tab', repoText.includes('Action signatures'));
const healIdx = repoText.indexOf('Locator healing');
out('\nF3 heal region:', healIdx >= 0 ? repoText.slice(healIdx, healIdx + 220) : '(absent)');
check('F3: heals line renders one honest state (elements exist → never-observed line, or absent if no elements)',
  repoText.includes('Locator healing: not yet observed') || !repoText.includes('Locator healing'),
  healIdx >= 0 ? repoText.slice(healIdx, healIdx + 120) : 'no line');

await sleep(800);
out('\npanel console errors:', consoleErrors.length === 0 ? 'none' : JSON.stringify(consoleErrors));
check('zero console errors on panel', consoleErrors.length === 0);

out(`\n===== RESULT: ${PASS} PASS / ${FAIL} FAIL =====`);
fs.writeFileSync(`${DUMP}/summary.txt`, `PASS ${PASS} / FAIL ${FAIL}\n`);
process.exit(0);
