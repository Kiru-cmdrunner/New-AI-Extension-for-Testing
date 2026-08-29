// FINAL side-panel E2E — drive the panel through its OWN UI (start via
// direct message as the multipattern harness does — that path IS the panel's
// storage listener path — then STOP via the panel's real stop button so
// handleStopRecording() runs and the stopped view renders).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-final-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9564;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 400) : ''}`);
  ok ? PASS++ : FAIL++;
};
const DUMP = '/tmp/sidepanel-e2e';
fs.mkdirSync(DUMP, { recursive: true });

const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST], { stdio: 'ignore' });
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

// start via the SAME message the panel's UI sends (sidepanel.ts:373)
const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
// STOP via the panel's REAL button → handleStopRecording() → stopped view
const stopViaPanel = async () => { await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 'clicked'; })()`); };

// ═══ P-CLASSIC ═══
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await typeInto('#q', 'invoice');
await selectOption('#prio', 2);
await clickSel('#btn-search', 'Search');
await sleep(3000);

// panel stopped view poll (real button path)
let panelView = null;
await stopViaPanel();
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  panelView = await evalPanel(`(() => ({
    viewHidden: !!document.getElementById('stopped-view')?.hidden,
    cards: Array.from(document.querySelectorAll('.interaction-event')).map(n => ({
      id: n.querySelector('.timeline-event__id')?.textContent || '',
      type: n.querySelector('.timeline-event__type')?.textContent || '',
      hasRS: n.textContent.includes('Resulting State'),
      rsHeader: Array.from(n.querySelectorAll('.evidence-subheader')).map(h => h.textContent).find(t => /Resulting State/i.test(t)) || null,
      rsRows: Array.from(n.querySelectorAll('.evidence-row')).map(r => r.textContent.trim()).filter(t => /counter|collection|notification|badge/i.test(t)),
    })),
    irSteps: Array.from(document.querySelectorAll('.step-card')).map(n => n.textContent.slice(0, 140).replace(/\\s+/g, ' ')),
  }))()`);
  if (!panelView.viewHidden && panelView.cards.length > 0) break;
}

out('\n── PANEL (stopped view, real button) ──');
out('viewHidden:', panelView.viewHidden, 'cards:', panelView.cards.length);
for (const c of panelView.cards) out(` ${c.id} [${c.type}] hasRS=${c.hasRS} header=${c.rsHeader} rsRows=${JSON.stringify(c.rsRows)}`);
fs.writeFileSync(`${DUMP}/panel-final-classic.json`, JSON.stringify(panelView, null, 2));

check('stopped view renders (real stop button)', !panelView.viewHidden && panelView.cards.length > 0, `hidden=${panelView.viewHidden} cards=${panelView.cards.length}`);
check('side panel: Resulting State section on a card (6A → panel)', panelView.cards.some(c => c.hasRS), JSON.stringify(panelView.cards.map(c => ({ id: c.id, hasRS: c.hasRS }))));
check('side panel: seeded/captured semantic rows visible', panelView.cards.some(c => c.rsRows.length > 0), JSON.stringify(panelView.cards.flatMap(c => c.rsRows)));
check('side panel: IR steps rendered', panelView.irSteps.length > 0, `${panelView.irSteps.length} steps`);
const irWithAssert = panelView.irSteps.filter(s => /assert/i.test(s) && !/none/.test(s)).length;
check('side panel: ≥1 IR step shows derived assertions', irWithAssert > 0, `${irWithAssert} with assertions`);

out('\n════ FINAL SIDE-PANEL E2E — ' + PASS + ' PASS / ' + FAIL + ' FAIL ════');
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
