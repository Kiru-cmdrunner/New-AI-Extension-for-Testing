// Focused: SAME-RUN storage-vs-panel comparison for resultingState flow.
// Question: does the interaction copy in chrome.storage carry
// behavioralEvidence.applicationEvidence.resultingState, and does the
// side panel DOM render it? Diagnoses whether the gap is capture or panel.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9562;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const DUMP = '/tmp/sidepanel-e2e';
fs.mkdirSync(DUMP, { recursive: true });

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
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
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(250);
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await sleep(35);
  } return true; };
const selectOption = async (sel, idx) => {
  await evalApp(`(() => { document.querySelector(${JSON.stringify(sel)}).focus(); return true; })()`);
  await sleep(250); await key('Enter'); await sleep(350);
  for (let i = 0; i < idx; i++) { await key('ArrowDown'); await sleep(150); }
  await key('Enter'); await sleep(250);
};
const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'})`).catch(() => {}); await sleep(4000); };

// ═══ P-CLASSIC ═══
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await typeInto('#q', 'invoice');
await selectOption('#prio', 2);
await key('Tab'); // blur select naturally, no body click
await sleep(300);
await clickSel('#btn-search', 'Search');
await sleep(3000);
await stopRec();
await sleep(2000);

// STORAGE read (from panel context — same storage the panel reads)
const storage = JSON.parse(await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return JSON.stringify((g.cmdrunner_live_interactions || []).map(i => ({
    id: i.interactionId, t: i.interactionType,
    hasEv: !!i.behavioralEvidence,
    endReason: i.behavioralEvidence?.window?.endReason,
    rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? {
      url: i.behavioralEvidence.applicationEvidence.resultingState.url,
      items: i.behavioralEvidence.applicationEvidence.resultingState.items.map(x => ({k:x.kind, n:x.numericValue, t:(x.text||'').slice(0,25), p:x.domPath, sel:(x.matchedSelector||'').slice(0,40)}))
    } : null,
    domChanges: i.behavioralEvidence?.applicationEvidence?.domChanges?.length ?? null,
  })));
})()`));
fs.writeFileSync(`${DUMP}/storage-classic.json`, JSON.stringify(storage, null, 2));
out('\n── STORAGE (cmdrunner_live_interactions) ──');
for (const i of storage) out(` ${i.id} ${i.t} end=${i.endReason} domChanges=${i.domChanges} rs=${i.rs ? i.rs.items.map(x=>x.k).join(',') : 'NONE'}`);

// PANEL DOM read
const panelView = await evalPanel(`(() => ({
  cards: Array.from(document.querySelectorAll('.interaction-event')).map(n => ({
    id: n.querySelector('.timeline-event__id')?.textContent || '',
    text: n.textContent.slice(0, 100).replace(/\\s+/g, ' '),
    hasRS: n.textContent.includes('Resulting State'),
    rsHeaders: Array.from(n.querySelectorAll('.evidence-subheader')).map(h => h.textContent),
  })),
  bodyHasRS: document.body.textContent.includes('Resulting State'),
}))()`);
fs.writeFileSync(`${DUMP}/panel-classic-v2.json`, JSON.stringify(panelView, null, 2));
out('\n── PANEL DOM ──');
for (const c of panelView.cards) out(` ${c.id} hasRS=${c.hasRS} :: ${c.text}`);
out('bodyHasRS:', panelView.bodyHasRS);

// DIFF
const storageRS = storage.filter(i => i.rs && i.rs.items.length > 0).map(i => i.id);
const panelRS = panelView.cards.filter(c => c.hasRS).map(c => c.id);
out(`\n── DIFF: storage interactions WITH rs = [${storageRS.join(', ')}]; panel cards WITH rs = [${panelRS.join(', ')}]`);
out(storageRS.length > 0 && panelRS.length === 0
  ? 'VERDICT: CAPTURE OK, PANEL GAP — evidence has rs in storage but panel does not render it'
  : storageRS.length === 0
    ? 'VERDICT: CAPTURE GAP — no rs in storage this run (different from multipattern run)'
    : panelRS.length > 0 ? 'VERDICT: FLOWING END-TO-END' : 'VERDICT: PARTIAL');

// ═══ P-REACTISH with fixed typeahead timing ═══
out('\n═══ P-REACTISH (fixed timing) ═══');
await evalApp(`location.href = '${APP}/reactish'`);
await sleep(2000);
await startRec();
await typeInto('.date-input', 'Sat, 22 Aug');
await sleep(400);
await typeInto('.origin-input', 'ben');
await sleep(2000); // longer: options render
const optOk = await evalApp(`!!document.querySelector('.options-list .opt')`);
out('typeahead options rendered:', optOk);
if (optOk) await clickSel('.options-list .opt', 'Bengaluru option');
await sleep(900);
await clickSel('.commit-btn', 'Plan trip');
await sleep(3000);
await stopRec();
await sleep(2000);

const storage2 = JSON.parse(await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return JSON.stringify((g.cmdrunner_live_interactions || []).map(i => ({
    id: i.interactionId, t: i.interactionType,
    textValue: i.metadata?.textValue, typedValue: i.metadata?.typedValue,
    rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? i.behavioralEvidence.applicationEvidence.resultingState.items.map(x => (x.kind||'?') + ':' + (x.text||'').slice(0,20) + ':sel=' + (x.matchedSelector||'').slice(0,30)) : null,
  })));
})()`));
fs.writeFileSync(`${DUMP}/storage-reactish.json`, JSON.stringify(storage2, null, 2));
out('storage:'); for (const i of storage2) out(` ${i.id} ${i.t} textValue=${i.textValue} typedValue=${i.typedValue} rs=${JSON.stringify(i.rs)}`);

const panel2 = await evalPanel(`(() => ({
  cards: Array.from(document.querySelectorAll('.interaction-event')).map(n => ({
    id: n.querySelector('.timeline-event__id')?.textContent || '',
    title: n.querySelector('.timeline-event__title')?.textContent || n.textContent.slice(0, 80),
    hasRS: n.textContent.includes('Resulting State'),
    value: n.querySelector('.timeline-event__value')?.textContent || '',
  })),
}))()`);
out('panel:'); for (const c of panel2.cards) out(` ${c.id} hasRS=${c.hasRS} value="${c.value}" title=${c.title.replace(/\s+/g,' ').slice(0,90)}`);

try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
