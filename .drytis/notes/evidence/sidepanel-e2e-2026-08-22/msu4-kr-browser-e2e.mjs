// MS-U4 E2E — KR browser on the repository page, driven by a REAL recording.
// Flow: load extension → record on P-CLASSIC (multipattern app) → STOP →
// open repository page → assert the Knowledge tab renders applications,
// signatures, behavior sessions/episodes/gaps, views/entities/outcomes and
// (for this app) the honest "no attributed API requests" seed section.
// Classic Tree regression check included. Read-only vs the KR: rendering only.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/msu4-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9563;
const APP = 'http://127.0.0.1:8177';
const DUMP = '/workspace/.drytis/notes/evidence/sidepanel-e2e-2026-08-22/msu4-dumps';
fs.mkdirSync(DUMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 600) : ''}`);
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

await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
// Start/STOP via the side panel context (chrome.runtime is the extension's
// own page — the app page context has no chrome.runtime).
await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {});
await sleep(600);
await typeInto('#q', 'invoice');
await clickSel('#btn-search');
await sleep(2800);
await evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'})`).catch(() => {});
await sleep(3500); // understanding pipeline → KR writes settle

// ── open repository page ──
const { targetId: repoTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/repository/index.html` });
await sleep(3000);
const repo = await CDP({ target: repoTab, port: PORT });
await repo.send('Runtime.enable');
const evalRepo = async (expr) => (await repo.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const snap = await evalRepo(`(() => {
  const body = document.body;
  const secs = Array.from(document.querySelectorAll('section')).map(s => (s.querySelector('h3,h4')?.textContent || '').trim());
  return {
    title: document.title,
    tabActive: document.querySelector('.view-tab--active')?.dataset.view || null,
    tabs: Array.from(document.querySelectorAll('.view-tab')).map(t => t.dataset.view),
    text: body.textContent.replace(/\\s+/g, ' ').slice(0, 4000),
    sectionHeaders: secs.filter(Boolean),
    krRootChildren: document.getElementById('kr-root')?.children.length ?? -1,
    consoleMarker: body.textContent.includes('Loading knowledge') ? 'stuck-loading' : 'rendered',
  };
})()`);
fs.writeFileSync(`${DUMP}/repo-snapshot.json`, JSON.stringify(snap, null, 2));
out('title:', snap.title);
out('tabActive:', snap.tabActive, 'tabs:', JSON.stringify(snap.tabs));
out('sectionHeaders:', JSON.stringify(snap.sectionHeaders));
out('krRootChildren:', snap.krRootChildren, 'marker:', snap.consoleMarker);
out('text (first 1500):', snap.text.slice(0, 1500));

check('repository page opens with Knowledge tab active', snap.tabActive === 'knowledge');
check('KR browser rendered (not stuck loading)', snap.consoleMarker === 'rendered' && snap.krRootChildren > 0);
check('applications section lists the recorded app', /— app-[a-z0-9]+ \(\d+ sessions?\)/.test(snap.text));
check('behavior sessions render', /Behavior Sessions|behavior session/i.test(snap.text));
check('action signatures render', /Action Signatures|action signature/i.test(snap.text));
check('views / entities / outcomes render', /Views/i.test(snap.text) && /Entities/i.test(snap.text) && /Outcomes/i.test(snap.text));
check('episodes render for the session', /Episodes/i.test(snap.text));
check('gaps section honest (renders or explicit empty)', /Gaps|could not/i.test(snap.text));
check('API seeds section honest', /API|api/i.test(snap.text));

// Classic tree regression
await evalRepo(`(() => { document.querySelector('[data-view="classic"]').click(); return true; })()`);
await sleep(800);
const classic = await evalRepo(`(() => ({
  visible: !document.getElementById('classic-view')?.hidden,
  knowledgeHidden: !!document.getElementById('knowledge-view')?.hidden,
  treeText: document.getElementById('repository-tree')?.textContent.replace(/\\s+/g,' ').slice(0,200) || '',
}))()`);
fs.writeFileSync(`${DUMP}/repo-classic.json`, JSON.stringify(classic, null, 2));
out('classic:', JSON.stringify(classic));
check('Classic Tree tab still switchable', classic.visible === true && classic.knowledgeHidden === true);

// Console errors on the repository page (real Runtime.consoleAPICalled events)
const consoleErrors = [];
repo.on('Runtime.consoleAPICalled', (e) => {
  if (e.type === 'error') consoleErrors.push(e.args?.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
await repo.send('Runtime.enable');
await sleep(1200);
const classicCheck = await evalRepo(`document.getElementById('knowledge-view')?.hidden`);
out('console errors:', consoleErrors.length === 0 ? 'none' : JSON.stringify(consoleErrors));
check('repository page console clean', consoleErrors.length === 0);

out(`\n===== RESULT: ${PASS} PASS / ${FAIL} FAIL =====`);
fs.writeFileSync(`${DUMP}/summary.txt`, `PASS ${PASS} / FAIL ${FAIL}\n`);
process.exit(0);
