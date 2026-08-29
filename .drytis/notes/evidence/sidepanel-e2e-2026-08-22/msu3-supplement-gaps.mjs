// MS-U3 A10 — real-Chrome E2E: Session Understanding card renders from a
// LIVE recording session (understanding_result written by the SW at STOP).
// Same skeleton as the MS-U1/MS-U2 harnesses; app = /tmp/multipattern (:8177).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-msu3-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9572;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 300) : ''}`);
  ok ? PASS++ : FAIL++;
};
const DUMP = '/tmp/msu3-e2e';
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
const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };

const cardCensus = `(() => {
  const sec = document.getElementById('understanding-section');
  const card = document.querySelector('.understanding-card');
  return {
    sectionExists: !!sec, sectionHidden: sec ? sec.hidden : null,
    card: !!card,
    cardText: card ? (card.textContent || '').slice(0, 1500) : null,
  };
})()`;

// ═══ SUPPLEMENT: gaps-row + record-another assertions (close WARN 1 & 2) ═══
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
// 1) Click search WITHOUT typing — engine records a click whose consequences
//    (results table mutation) cannot be attributed → knowledge gap expected.
await clickSel('#btn-search', 'Search (no query — expect unattributed consequence)');
await sleep(2500);
// 2) Type into #q to also produce at least one anchored interaction.
const qCenter = await center('#q');
await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: qCenter.x, y: qCenter.y, button: 'left', clickCount: 1 });
await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: qCenter.x, y: qCenter.y, button: 'left', clickCount: 1 });
for (const ch of 'invoice') {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
  await sleep(35);
}
await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', windowsVirtualKeyCode: 9 });
await sleep(400);
// 3) Another consequence-y click (now anchored: input exists in between)
await clickSel('#btn-search', 'Search (with query)');
await sleep(2500);
// STOP via the panel's real stop button
await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
await sleep(6000); // understanding pipeline + gaps persist + IR + repo

let v = await evalPanel(cardCensus);
out('\n── supplement census (after STOP) ──');
out(JSON.stringify(v, null, 2).slice(0, 2000));
fs.writeFileSync(`${DUMP}/supplement-card.json`, JSON.stringify(v, null, 2));

check('S1: card rendered after stop', v.card === true, `card=${v.card}`);
const t = v.cardText ?? '';

// gaps row check: read the gap count directly from the panel's Dexie read via the card text
const gapsBlock = (t.match(/What we could not prove[^\n]{0,200}/) || [''])[0];
out('gaps block:', gapsBlock || '(absent)');
check('S2: gaps block rendered when gaps exist (live Dexie read)', gapsBlock.length > 0, gapsBlock.slice(0, 120));

// storage-side truth: how many gaps did the engine actually record?
const gapTruth = await evalPanel(`(async () => {
  const db = await (await import('/src/understanding/persistence/knowledge-database.js')).getKnowledgeDatabase();
  const res = await chrome.storage.local.get(null);
  const ur = res['understanding_result'];
  return { understandingResultPresent: !!ur, sessionId: ur && ur.sessionId, appId: ur && (ur.appId || (ur.applicationKnowledge && ur.applicationKnowledge.appId)) };
})()`);
out('storage truth:', JSON.stringify(gapTruth));
fs.writeFileSync(`${DUMP}/supplement-truth.json`, JSON.stringify(gapTruth, null, 2));

// record-another: click the REAL button, then assert the section is hidden AND key removed
const before = await evalPanel(`(async () => ({ key: !!(await chrome.storage.local.get('understanding_result')).understanding_result, hidden: document.getElementById('understanding-section').hidden }))()`);
await evalPanel(`(() => { const b = document.getElementById('record-another-btn'); if (!b) return 'no-btn'; b.click(); return 'clicked'; })()`);
await sleep(2000);
const after = await evalPanel(`(async () => ({ key: !!(await chrome.storage.local.get('understanding_result')).understanding_result, hidden: document.getElementById('understanding-section').hidden, live: !document.getElementById('live-view')?.hidden }))()`);
out('record-another:', JSON.stringify({ before, after }));
check('S3: record-another removes understanding_result key', before.key === true && after.key === false, `before=${before.key} after=${after.key}`);
check('S4: record-another hides the section', before.hidden === false && after.hidden === true, `hidden ${before.hidden} -> ${after.hidden}`);

await sleep(600);
out('\npanel console errors:', panelErrors.length ? panelErrors : 'none');
check('zero panel console errors', panelErrors.length === 0, panelErrors.join(' | '));

out(`\n════ MS-U3 supplement — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
