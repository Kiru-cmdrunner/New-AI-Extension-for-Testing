// Phase 6D.1 real-Chrome E2E — W1–W4 validation + 6A/6B regression proof.
// CDP harness (same proven pattern as the 92de517 full-audit v2).
// App patches vs the audit app: classic +aria-live toast/snackbar/role=log; reactish
// date input stripped to placeholder-only (W4); reactish badge is class-free data-state (W1).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/audit6d1-profile-6d1-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9581;
const APP = 'http://127.0.0.1:8177';
const OUT = '/workspace/.drytis/notes/evidence/phase-6d1-e2e-2026-08-23/dumps';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 600) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));

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
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
await app.send('Page.enable'); await app.send('DOM.enable'); await app.send('CSS.enable').catch(() => {});
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const errors = [];
panel.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') errors.push('panel:' + String((e.args || []).map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 150)); });
app.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') errors.push('app:' + String((e.args || []).map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 150)); });

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
const storageProbe = async () => evalPanel(`(async () => {
  const li = (await chrome.storage.local.get('cmdrunner_live_interactions'))['cmdrunner_live_interactions'] || [];
  const ledger = (await chrome.storage.local.get('cmdrunner_evidence_ledger'))['cmdrunner_evidence_ledger'] || null;
  return {
    interactions: li.map(i => ({
      id: i.interactionId, type: i.type,
      hasBE: !!i.behavioralEvidence,
      win: i.behavioralEvidence?.window ? { endReason: i.behavioralEvidence.window.endReason } : null,
      target: i.trigger ?? null,
      metadata: i.metadata ?? null,
      resultingState: (i.behavioralEvidence?.applicationEvidence?.resultingState?.items || []).map(it => ({ kind: it.kind, text: (it.text || '').slice(0, 50), domPath: it.domPath, numericValue: it.numericValue ?? null, matchedSelector: it.matchedSelector })),
    })),
    ledgerLen: Array.isArray(ledger) ? ledger.length : (ledger ? Object.keys(ledger).length : 0),
  };
})()`);

// ══ RUN 1: CLASSIC — W1 notifications + W2 counter + 6A/6C/6B regression ══
out('\n── RUN 1: classic (W1 + W2 + regression) ──');
await sleep(600);
await startRec();
await selectOption('#prio', 2); await sleep(500);          // Dropdown (6C regression)
await typeInto('#q', 'invoice'); await sleep(400);          // TextEntry (dual-sample)
await clickSel('#btn-search', 'Search'); await sleep(2200); // Click → counter swap + toasts
const probe1 = await storageProbe();
dump('run1-storage.json', probe1);
out('  types:', probe1.interactions.map(i => i.type).join(','));

const drop1 = probe1.interactions.find(i => i.type === 'Dropdown');
check('R1-6C-DROPDOWN', !!drop1 && /high|urgent/i.test(JSON.stringify(drop1.metadata ?? {})), JSON.stringify(drop1?.metadata ?? null));
const text1 = probe1.interactions.find(i => i.type === 'TextEntry');
check('R1-6C-TEXTENTRY', !!text1, JSON.stringify(text1?.metadata ?? null));
const click1 = probe1.interactions.find(i => i.type === 'Click');
const counter = click1?.resultingState?.find(i => i.kind === 'counter' && /tickets|result-count/.test(`${i.text}${i.domPath}`));
check('R1-W2-COUNTER-#id-only', !!counter && counter.numericValue === 2, counter ? `path=${counter.domPath} num=${counter.numericValue} sel=${counter.matchedSelector} text="${counter.text}"` : 'no counter item; rs=' + JSON.stringify(click1?.resultingState ?? []).slice(0, 400));
const coll = click1?.resultingState?.find(i => i.kind === 'collection');
check('R1-6A-COLLECTION-REGRESSION', !!coll, coll ? `text="${coll.text.slice(0, 60)}"` : 'collection item missing');
const notes1 = (click1?.resultingState ?? []).filter(i => i.kind === 'notification');
const liveToast = notes1.find(i => /live-toast/.test(i.domPath ?? ''));
const snack = notes1.find(i => /live-snack/.test(i.domPath ?? ''));
const log = notes1.find(i => /act-log/.test(i.domPath ?? ''));
check('R1-W1-ARIA-LIVE', !!liveToast, liveToast ? `path=${liveToast.domPath} text="${liveToast.text}"` : 'notifications: ' + JSON.stringify(notes1).slice(0, 300));
check('R1-W1-SNACKBAR', !!snack, snack ? `text="${snack.text}"` : 'not captured');
check('R1-W1-ROLE-LOG', !!log, log ? `text="${log.text}"` : 'not captured');

// ══ RUN 2: REACTISH — W3 options click + W4 placeholder DatePicker + W1 data-state badge ══
out('\n── RUN 2: reactish (W3 + W4 + W1 badge) ──');
await app.send('Page.navigate', { url: `${APP}/reactish` }); await sleep(1200);
for (let i = 0; i < 25; i++) { const t = await evalApp('document.title'); if (t === 'Modern Portal') { const c = await center('.commit-btn'); if (c) break; } await sleep(300); }
out('  hydration done:', await evalApp('document.title'), 'commit:', !!await center('.commit-btn'));
const dpSel = 'input[placeholder="Choose a date"]';
await typeInto(dpSel, '05092026'); await sleep(300);
await key('Tab'); await sleep(700);                          // blur → app rewrites value; DatePicker completes
await typeInto('.origin-input', 'ben'); await sleep(1600);   // debounce + fetch
await clickSel('ul.options-list li.opt', 'Bengaluru option'); await sleep(800);
await clickSel('.commit-btn', 'Plan trip'); await sleep(2600);
const probe2 = await storageProbe();
dump('run2-storage.json', probe2);
out('  types:', probe2.interactions.slice(-8).map(i => i.type).join(','));

const dp = probe2.interactions.filter(i => i.type === 'DatePicker').pop();
check('R2-W4-DATEPICKER-PLACEHOLDER-ONLY', !!dp, dp ? `meta=${JSON.stringify(dp.metadata ?? null).slice(0, 200)}` : 'no DatePicker');
const optClick = [...probe2.interactions].reverse().find(i => i.type === 'Click' && /opt/i.test(JSON.stringify(i.target ?? {})));
check('R2-W3-OPTIONS-LIST-CLICK', !!optClick, optClick ? `trigger=${JSON.stringify(optClick.target ?? null).slice(0, 180)}` : 'no options click captured');
const unc = probe2.interactions.filter(i => i.type === 'Unclassified');
check('R2-W3-NO-UNCLASSIFIED-OPTION', !unc.some(u => /opt/i.test(JSON.stringify(u.target ?? {}))), unc.length ? 'unc: ' + JSON.stringify(unc.map(u => JSON.stringify(u.target ?? null).slice(0, 80))) : 'none');
const commit = [...probe2.interactions].reverse().find(i => i.type === 'Click' && /commit/i.test(JSON.stringify(i.target ?? {})));
const badges = (commit?.resultingState ?? []).filter(i => i.kind === 'status-badge');
check('R2-W1-DATA-STATE-BADGE', badges.some(b => /Trip planned|plan-badge/.test(`${b.text}${b.domPath}`)), 'badges: ' + JSON.stringify(badges).slice(0, 300));

// ══ RUN 3: SHOP — 6B locator families + aria icon regression ══
out('\n── RUN 3: shop (6B regression) ──');
await app.send('Page.navigate', { url: `${APP}/shop` }); await sleep(1200);
for (let i = 0; i < 25; i++) { const t = await evalApp('document.title'); if (t === 'Corner Shop') { const c = await center('[data-testid="qty-up-notebook"]'); if (c) break; } await sleep(300); }
out('  shop loaded:', await evalApp('document.title'), 'qty:', !!await center('[data-testid="qty-up-notebook"]'));
await clickSel('[data-testid="qty-up-notebook"]', 'qty up'); await sleep(600);
await clickSel('[aria-label="Open filters"]', 'filters icon'); await sleep(900);
const probe3 = await storageProbe();
dump('run3-storage.json', probe3);
const all3 = probe3.interactions;
const stepUp = [...all3].reverse().find(i => JSON.stringify(i.target ?? {}).includes('qty-up-notebook'));
check('R3-6B-TESTID-CAPTURE', !!stepUp, stepUp ? JSON.stringify(stepUp.target).slice(0, 120) : 'qty-up not captured');
const filt = [...all3].reverse().find(i => JSON.stringify(i.target ?? {}).includes('Open filters'));
check('R3-ARIA-ICON-CAPTURE', !!filt, filt ? JSON.stringify(filt.target).slice(0, 120) : 'icon not captured');
const shopClick = [...all3].reverse().find(i => i.type === 'Click' && /qty/.test(JSON.stringify(i.target ?? {})));
const shopCounter = shopClick?.resultingState?.find(i => i.kind === 'counter');
check('R3-COUNTER-REGRESSION', !!shopCounter, shopCounter ? `num=${shopCounter.numericValue} text="${shopCounter.text}"` : 'cart counter missing');

// Generated spec (locators 6B families)
const specGen = await evalPanel(`(async () => {
  const li = (await chrome.storage.local.get('cmdrunner_live_interactions'))['cmdrunner_live_interactions'] || [];
  return { count: li.length, lastIds: li.slice(-4).map(i => i.interactionId) };
})()`).catch(() => null);
dump('spec-probe.json', specGen);
check('HARNESS-STORAGE-OK', probe3.interactions.length >= 6, `total interactions captured: ${probe3.interactions.length}`);

check('CONSOLE-CLEAN', errors.length === 0, errors.length ? errors.slice(0, 3).join(' || ') : 'no console errors');

dump('results.json', { PASS, FAIL });
await chrome.kill();
out(`\n=== TOTAL: ${PASS} PASS / ${FAIL} FAIL ===`);
process.exit(FAIL ? 1 : 0);
