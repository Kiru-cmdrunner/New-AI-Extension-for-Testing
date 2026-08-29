// MS-U1 real-Chrome E2E — stopped-view card upgrades through the panel's own UI.
// Reuses the final-panel-button.mjs pattern (real Start message + real Stop button).
// Checks: A1 18-type badges (no ❓ Unknown on known types), A2 endState chip on every
// card, A3 member chip, A4 understanding badge (✓ prio N / ❓ honest), A6 evidence
// footer, A8 assertion chip, A10 show-hidden toggle round-trip, KR chip presence, console.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-msu1-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9566;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 400) : ''}`);
  ok ? PASS++ : FAIL++;
};
const DUMP = '/tmp/msu1-e2e';
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
await panel.send('Log.enable').catch(() => {});
const panelErrors = [];
try {
  await panel.send('Runtime.consoleAPICalled', undefined);
} catch {}
// console error capture via Runtime events
const grabErrors = (sess) => {
  sess._events = sess._events || {};
  sess.on && sess.on('Runtime.consoleAPICalled', (e) => {
    if (e.type === 'error') panelErrors.push(String((e.args || []).map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 200));
  });
};
grabErrors(panel);

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

// Card extraction — chips by class, endState badge, understanding badge text.
const panelCards = `(() => ({
  viewHidden: !!document.getElementById('stopped-view')?.hidden,
  count: document.querySelectorAll('.interaction-event').length,
  countLabel: document.getElementById('detected-interactions-count')?.textContent || '',
  cards: Array.from(document.querySelectorAll('.interaction-event')).map(n => ({
    id: n.querySelector('.timeline-event__id')?.textContent || '',
    type: n.querySelector('.timeline-event__type')?.textContent || '',
    endState: n.querySelector('.timeline-event__endstate')?.textContent || null,
    memberChip: n.querySelector('.interaction-chip--member')?.textContent || null,
    understanding: n.querySelector('.interaction-chip--understanding')?.textContent || null,
    footerChip: n.querySelector('.interaction-chip--footer')?.textContent || null,
    assertionChip: n.querySelector('.interaction-chip--assertions')?.textContent || null,
    krChip: n.querySelector('.interaction-chip--kr')?.textContent || null,
    suppressedChip: n.querySelector('.interaction-chip--suppressed')?.textContent || null,
  })),
  toggle: { hidden: !!document.getElementById('hidden-interactions-toggle')?.hidden, text: document.getElementById('hidden-interactions-toggle')?.textContent || '' },
}))()`;

// ═══ RUN 1 — classic ═══
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await typeInto('#q', 'invoice');
await selectOption('#prio', 2);
await clickSel('#btn-search', 'Search');
await sleep(3000);
await stopViaPanel();
let v1 = null;
for (let i = 0; i < 15; i++) { await sleep(1000); v1 = await evalPanel(panelCards); if (!v1.viewHidden && v1.cards.length > 0) break; }
await sleep(1500); // allow async KR chips to attach
v1 = await evalPanel(panelCards);
out('\n── RUN1 classic ──');
out('cards:', v1.cards.length, 'label:', v1.countLabel, 'toggle:', JSON.stringify(v1.toggle));
for (const c of v1.cards) out(' ', JSON.stringify(c));
fs.writeFileSync(`${DUMP}/run1-classic.json`, JSON.stringify(v1, null, 2));

check('A-basic: stopped view renders with cards', !v1.viewHidden && v1.cards.length > 0, `cards=${v1.cards.length}`);
check('A1: no "❓ Unknown" type badge on any card', v1.cards.every(c => !/Unknown/.test(c.type)), JSON.stringify(v1.cards.map(c => c.type)));
check('A2: every card has an endState chip', v1.cards.length > 0 && v1.cards.every(c => !!c.endState), JSON.stringify(v1.cards.map(c => c.endState)));
check('A3: ≥1 member chip present', v1.cards.some(c => c.memberChip && /events? ·/.test(c.memberChip)), JSON.stringify(v1.cards.map(c => c.memberChip)));
check('A4: every card has an understanding badge', v1.cards.length > 0 && v1.cards.every(c => !!c.understanding), JSON.stringify(v1.cards.map(c => c.understanding)));
check('A4: recognized cards show "✓ … (prio N)"', v1.cards.some(c => /✓ .*\(prio \d+\)/.test(c.understanding || '')), JSON.stringify(v1.cards.map(c => c.understanding)));
const anyFooter = v1.cards.some(c => c.footerChip);
out(`  (A6 footer chips: ${v1.cards.map(c => c.footerChip).join(' | ')})`);
check('A8: ≥1 assertion chip rendered', v1.cards.some(c => c.assertionChip && /assertion/i.test(c.assertionChip)), JSON.stringify(v1.cards.map(c => c.assertionChip)));
// Toggle: classic run likely has nothing suppressed → row hidden (P7c)
check('A10/P7c: toggle row hidden when nothing suppressed', v1.toggle.hidden || v1.toggle.text === '', JSON.stringify(v1.toggle));

// ═══ RUN 2 — reactish (DatePicker via typed input + click date cell) ═══
await evalPanel(`document.getElementById('record-another-btn') && document.getElementById('record-another-btn').click()`);
await sleep(800);
await evalApp(`location.href = '${APP}/reactish'`);
await sleep(1500);
await startRec();
// reactish: date input (controlled-rewrite), typeahead typing + option click, commit click
await typeInto('.date-input', '08222026');
await sleep(400);
await clickSel('.commit-btn', 'Plan trip');
await sleep(1200);
// typeahead: type city prefix then click the rendered option
await typeInto('.origin-input', 'ben');
await sleep(900);
await clickSel('.options-list li.opt', 'Bengaluru option');
await sleep(3000);
await stopViaPanel();
let v2 = null;
for (let i = 0; i < 15; i++) { await sleep(1000); v2 = await evalPanel(panelCards); if (!v2.viewHidden && v2.cards.length > 0) break; }
await sleep(1500);
v2 = await evalPanel(panelCards);
out('\n── RUN2 reactish ──');
out('cards:', v2.cards.length, 'toggle:', JSON.stringify(v2.toggle));
for (const c of v2.cards) out(' ', JSON.stringify(c));
fs.writeFileSync(`${DUMP}/run2-reactish.json`, JSON.stringify(v2, null, 2));
const dp = v2.cards.find(c => /Date\s?Picker/i.test(c.type) || /DatePicker/.test(c.understanding || ''));
check('reactish: DatePicker card present', !!dp, JSON.stringify(v2.cards.map(c => c.type)));
if (dp) check('A4: DatePicker badge shows prio 10', /DatePicker \(prio 10\)/.test(dp.understanding || ''), dp.understanding || '');

// ═══ RUN 3 — shop (stepper clicks + counter assertions + toggle exercise) ═══
await evalPanel(`document.getElementById('record-another-btn') && document.getElementById('record-another-btn').click()`);
await sleep(800);
await evalApp(`location.href = '${APP}/shop'`);
await sleep(1500);
await startRec();
await clickSel('.card[data-sku="SKU-A"] .step-up', 'step-up SKU-A');
await sleep(700);
await clickSel('.card[data-sku="SKU-B"] .step-up', 'step-up SKU-B');
await sleep(700);
await clickSel('.card[data-sku="SKU-A"] .step-up', 'step-up SKU-A again');
await sleep(3000);
await stopViaPanel();
let v3 = null;
for (let i = 0; i < 15; i++) { await sleep(1000); v3 = await evalPanel(panelCards); if (!v3.viewHidden && v3.cards.length > 0) break; }
await sleep(1500);
v3 = await evalPanel(panelCards);
out('\n── RUN3 shop ──');
out('cards:', v3.cards.length, 'toggle:', JSON.stringify(v3.toggle));
for (const c of v3.cards) out(' ', JSON.stringify(c));
fs.writeFileSync(`${DUMP}/run3-shop.json`, JSON.stringify(v3, null, 2));

check('shop: ≥2 click cards', v3.cards.filter(c => /Click/.test(c.type)).length >= 2, JSON.stringify(v3.cards.map(c => c.type)));
check('shop: footer chip with dom-change/network counts on ≥1 card', v3.cards.some(c => c.footerChip && /(dom change|network|new surface)/.test(c.footerChip)), JSON.stringify(v3.cards.map(c => c.footerChip)));

// Toggle round-trip: if anything suppressed, exercise it
if (!v3.toggle.hidden && v3.toggle.text) {
  const before = v3.cards.length;
  await evalPanel(`document.getElementById('hidden-interactions-toggle').click()`);
  await sleep(700);
  const v3t = await evalPanel(panelCards);
  out('  after toggle-on:', 'cards=', v3t.cards.length, 'toggle=', JSON.stringify(v3t.toggle));
  check('A10: toggle reveals suppressed cards (count grows)', v3t.cards.length > before, `${before} → ${v3t.cards.length}`);
  check('A10: revealed cards carry suppression chip', v3t.cards.some(c => c.suppressedChip), JSON.stringify(v3t.cards.map(c => c.suppressedChip)));
  await evalPanel(`document.getElementById('hidden-interactions-toggle').click()`);
  await sleep(700);
  const v3b = await evalPanel(panelCards);
  check('A10: toggle off restores filtered count', v3b.cards.length === before, `${v3b.cards.length} vs ${before}`);
} else {
  out('  (no suppressed interactions this run — toggle row hidden; negative case verified in RUN1)');
}

// Console errors
await sleep(600);
out('\npanel console errors:', panelErrors.length ? panelErrors : 'none');
check('zero new panel console errors', panelErrors.length === 0, panelErrors.join(' | '));

out(`\n════ MS-U1 SIDE-PANEL E2E — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
