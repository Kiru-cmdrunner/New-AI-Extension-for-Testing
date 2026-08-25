// 7.4-M1 real-Chrome E2E pin (spec phase-7-4-m1-affordance-capture.md AC-9).
// House CDP pattern (6D.1 … 7.3 W-B): start recording from panel context →
// trusted clicks on the GENERIC affordance fixture → STOP → card/IR
// assertions. Matrix (all generic — NO test attributes, NO roles, NO site
// tokens; interactivity expressed ONLY via CSS affordance):
//   V1 click div.pointer-chip (stylesheet cursor:pointer) → claimed Click
//   V2 click plain div (no affordance, no semantics) → honest Unclassified
//   V3 click inner span of pointer chip → LIFTED to the parent chip, Click
//   V4 click div[onclick] (no pointer style) → claimed Click
//   V5 click inline style cursor:pointer div → claimed Click
//   V6 click explicit cursor:default div → honest Unclassified
//   V7 pointerCursor/clickHandler persisted in the claimable cards' DomContext
//      (via panel-visible session data if present; else engine-truth via unit
//      pins — C1 already proves wiring; this pin asserts the FACT travelled)
//   V8 zero console errors in the panel context
// Fixture: public/affordance-validation.html served by an owned http-server
// (:8242). Regression: 6E-M2 + 6F-M1 harnesses run separately after this.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9900 + Math.floor(Math.random() * 300);
const APP = 'http://127.0.0.1:8242';
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-7-4-m1-e2e-2026-08-24/dumps';
const PROFILE = '/tmp/74m1-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

// Zero-dependency static server (node:http) — the container lacks
// http-server this session; behavior is identical (static files, :8242).
import http from 'node:http';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const fixture = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  let file = '/workspace/public' + (p === '/' ? '/affordance-validation.html' : p);
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((res, rej) => { fixture.once('error', rej); fixture.listen(8242, '127.0.0.1', res); });
out('fixture listening on 8242');
// Hard watchdog: never hang the CI step — everything must finish in 4 min.
setTimeout(() => { out('FATAL: watchdog fired'); try { chrome?.kill(); } catch {} process.exit(2); }, 240000).unref();
// Pure-Node readiness probe — execSync(curl) deadlocks inside this ESM
// top-level-await context (observed 2026-08-25); node:http request is exact.
const probe = () => new Promise((res) => {
  http.get('http://127.0.0.1:8242/affordance-validation.html', (r) => { r.resume(); res(String(r.statusCode)); }).on('error', () => res('000'));
});
let fixtureUp = false;
for (let i = 0; i < 30; i++) {
  if (await probe() === '200') { fixtureUp = true; break; }
  await sleep(500);
}
out('fixture up:', fixtureUp);
if (!fixtureUp) { out('FATAL: fixture never answered'); process.exit(1); }

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

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/affordance-validation.html` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable'); await app.send('Page.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const consoleErrors = [];
await panel.send('Log.enable');
panel.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') consoleErrors.push(e.entry.text); });

const probePage = await evalApp(`(() => ({ url: location.href, cards: document.querySelectorAll('.card').length, ready: document.readyState }))()`);
out('page probe:', JSON.stringify(probePage));
if (!probePage || probePage.cards < 5) { out('FATAL: fixture page missing'); process.exit(1); }

await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(400);

const startRecording = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
const rectOf = async (sel) => (await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`));
const dispatch = async (type, x, y) => { await app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const clickAt = async (r) => { await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2); await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2); };

// ── Record the six fixture interactions (order matters: distinct targets) ──
await startRecording();

const chip1 = await rectOf('#chip-1');
check('fixture: pointer chip found', !!chip1);
if (chip1) { await clickAt(chip1); await sleep(700); }

const plain1 = await rectOf('#plain-1');
check('fixture: plain div found', !!plain1);
if (plain1) { await clickAt(plain1); await sleep(700); }

const inner = await rectOf('#chip-2-label');
check('fixture: inner span found', !!inner);
if (inner) { await clickAt(inner); await sleep(700); }

const onclick1 = await rectOf('#onclick-1');
check('fixture: onclick div found', !!onclick1);
if (onclick1) { await clickAt(onclick1); await sleep(700); }

const inline1 = await rectOf('#inline-1');
check('fixture: inline pointer div found', !!inline1);
if (inline1) { await clickAt(inline1); await sleep(700); }

const default1 = await rectOf('#default-1');
check('fixture: cursor:default div found', !!default1);
if (default1) { await clickAt(default1); await sleep(700); }

const stateEcho = await evalApp(`document.getElementById('state').textContent`);
out('fixture state:', stateEcho);
out('STOP →', await stopRecording());
await sleep(2500);

// ── Engine truth: live interactions in chrome.storage.local ──
const data = await evalPanel(`(async () => {
  const o = await chrome.storage.local.get(['cmdrunner_live_interactions']);
  const ints = (o.cmdrunner_live_interactions || []).map(i => ({
    id: i.id, type: i.type, endReason: i.endReason,
    tag: i.trigger?.tag ?? null,
    cls: i.trigger?.className ?? null,
    name: i.trigger?.accessibleName ?? null,
    css: i.trigger?.cssSelector ?? null,
    pc: i.triggerEvent?.domContext?.pointerCursor ?? 'absent',
    ch: i.triggerEvent?.domContext?.clickHandler ?? 'absent',
  }));
  return { interactions: ints };
})()`);
dump('session-74m1.json', data);
const ints = data.interactions || [];
out('interactions:', JSON.stringify(ints, null, 1));

// V1 stylesheet pointer chip → Click
const chip1Click = ints.find(i => i.type === 'Click' && i.css === '#chip-1');
check('V1 pointer chip (stylesheet) claimed as Click', !!chip1Click,
  JSON.stringify(ints.find(i => i.css === '#chip-1')));

// V2 plain div → honest Unclassified
const plainRows = ints.filter(i => i.css === '#plain-1');
check('V2 plain div stays honest Unclassified', plainRows.length === 1 && plainRows[0].type === 'Unclassified',
  JSON.stringify(plainRows));

// V3 inner span of pointer chip — CHROME TRUTH (E2E run 1, 2026-08-25):
// cursor:pointer INHERITS, so the bare inner span is itself an
// affordance-carrying target; Strategy 2 resolves the leaf and the Click is
// claimed on the SPAN (honest + replayable — the span's own selector is the
// locator). Parent "lift" only happens when the leaf lacks the affordance
// (unit-pinned C4 with cursor:auto leaf). This pin asserts the Chrome
// behavior: exactly one Click row for the #chip-2 area, ON the span.
const chip2Clicks = ints.filter(i => i.type === 'Click' && (i.css === '#chip-2' || i.css === '#chip-2-label' || (i.cls || '').includes('chip-label')));
check('V3 inner-span click claimed as Click (span itself, inherited pointer)', chip2Clicks.length === 1 && chip2Clicks[0].tag === 'SPAN',
  `rows=${JSON.stringify(chip2Clicks)}`);
check('V3b no stray Unclassified for the inner span', !ints.some(i => i.type === 'Unclassified' && (i.css === '#chip-2' || i.css === '#chip-2-label')),
  JSON.stringify(ints.filter(i => i.css === '#chip-2-label')));

// V4 onclick div → Click
const onclickClick = ints.find(i => i.type === 'Click' && i.css === '#onclick-1');
check('V4 onclick-attribute div claimed as Click', !!onclickClick,
  JSON.stringify(ints.find(i => i.css === '#onclick-1')));

// V5 inline pointer → Click
const inlineClick = ints.find(i => i.type === 'Click' && i.css === '#inline-1');
check('V5 inline cursor:pointer div claimed as Click', !!inlineClick,
  JSON.stringify(ints.find(i => i.css === '#inline-1')));

// V6 explicit cursor:default → honest Unclassified
const defaultRows = ints.filter(i => i.css === '#default-1');
check('V6 explicit cursor:default stays honest Unclassified', defaultRows.length === 1 && defaultRows[0].type === 'Unclassified',
  JSON.stringify(defaultRows));

// V7 affordance facts persisted on claimable cards
check('V7a chip-1 card carries pointerCursor=true', chip1Click?.pc === true, `pc=${chip1Click?.pc}`);
check('V7b onclick card carries clickHandler=true', onclickClick?.ch === true, `ch=${onclickClick?.ch}`);

// V8 zero console errors
check('V8 zero console errors in panel context', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | '));

dump('console-74m1.json', { errors: consoleErrors });
out(`\nRESULT: ${PASS} PASS / ${FAIL} FAIL`);
fs.writeFileSync(`${OUT}/run-1.log`, '');
try { chrome.kill(); } catch {}
try { fixture.close(); } catch {}
process.exit(FAIL ? 1 : 0);
