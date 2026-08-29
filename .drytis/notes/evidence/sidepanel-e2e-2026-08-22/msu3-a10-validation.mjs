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

// ═══ RUN — classic pattern: text entry + select + search click ═══
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
// type into #q
await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 0, y: 0, button: 'none', clickCount: 0 }); // noop warm
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
await clickSel('#btn-search', 'Search');
await sleep(2500);
await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
await sleep(5000); // understanding pipeline + IR + repo persist

let v = await evalPanel(cardCensus);
out('\n── understanding card census ──'); out(JSON.stringify(v, null, 2).slice(0, 1800));
fs.writeFileSync(`${DUMP}/card-census.json`, JSON.stringify(v, null, 2));

check('A1: section exists and is VISIBLE after stop (live data)', v.sectionExists && v.sectionHidden === false, `exists=${v.sectionExists} hidden=${v.sectionHidden}`);
check('card rendered', v.card === true, `card=${v.card}`);
const t = v.cardText ?? '';
check('card header: Session Understanding + session id', /Session Understanding/.test(t) && /session-/.test(t), t.slice(0, 120));
check('app identity present (appId always; origin only when cross-session knowledge exists)', /App/.test(t) && /[a-z0-9-]{4,}/.test((t.match(/App([^\n]{0,60})/) || ['',''])[1]), (t.match(/App[^\n]{0,50}/) || [''])[0]);
check('outcomes rollup present', /\d+ success|Outcomes/.test(t), (t.match(/Outcomes[^\n]{0,80}/) || [''])[0]);
check('coverage rows present', /anchored|attributed|intent \d+%|contract \d+%/.test(t), (t.match(/(anchored|attributed|intent \d+%)[^\n]{0,60}/) || [''])[0]);
check('no undefined/null text (honesty)', !/\bundefined\b|\bnull\b|\bNaN\b/.test(t), '');

// reopen path: reload the panel (init() Stopped branch must restore the card)
await evalPanel(`location.reload()`);
await sleep(3500);
const v2 = await evalPanel(cardCensus);
check('A1-reopen: card restored after panel reload (init Stopped branch)', v2.sectionExists && v2.sectionHidden === false && v2.card === true, `hidden=${v2.sectionHidden} card=${v2.card}`);

await sleep(600);
out('\npanel console errors:', panelErrors.length ? panelErrors : 'none');
check('zero panel console errors', panelErrors.length === 0, panelErrors.join(' | '));

out(`\n════ MS-U3 A10 — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
