// MS-U3 A10 supplement — SECOND session in the SAME profile: the cross-session
// read-model (applicationKnowledge: origin, sessionCount, views) must now
// exist, so the card renders the full identity + views groups.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-msu3s2-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9573;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => { out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 300) : ''}`); ok ? PASS++ : FAIL++; };

const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/shop` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const center = async (sel) => { const v = (await app.send('Runtime.evaluate', { expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`, returnByValue: true })).result.value; return v === 'null' ? null : JSON.parse(v); };
const clickSel = async (sel) => { const p = await center(sel); if (!p) return false; await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); return true; };

const census = `(() => { const card = document.querySelector('.understanding-card'); return card ? (card.textContent || '').slice(0, 2000) : null; })()`;

// Both sessions START at / (same URL ⇒ same appId; engine hashes the full
// URL). Session 1: search click on /. Session 2: start at /, navigate
// mid-session to /shop (full reload ⇒ view transition), click step-up.
const runSession = async () => {
  await browser.send('Target.activateTarget', { targetId: appTab });
  await sleep(300);
  await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {});
  await sleep(800);
  await clickSel('#btn-search'); // exists on / (classic pattern)
  await sleep(1500);
};
const finishSession = async () => {
  await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
  await sleep(5500);
};

// Session 1: classic flow on /.
await evalApp(`location.href = '${APP}/'`);
await sleep(1200);
await runSession();
await finishSession();
const t1 = await evalPanel(census);
out('── session 1 card ──'); out(String(t1).slice(0, 300));
await evalPanel(`(() => { const b = document.getElementById('record-another-btn'); if (b) b.click(); return 1; })()`).catch(() => {});
await sleep(1500);

// Session 2: start at /, mid-session full navigation to /shop, click step-up.
await evalApp(`location.href = '${APP}/'`);
await sleep(1200);
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(300);
await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {});
await sleep(800);
await clickSel('#btn-search');
await sleep(800);
await evalApp(`location.href = '${APP}/shop'`);
await sleep(2000); // full page reload — view transition
await clickSel('.card[data-sku="SKU-A"] .step-up');
await sleep(1500);
await finishSession();
const t2 = await evalPanel(census);
out('\n── session 2 card ──'); out(String(t2).slice(0, 600));
fs.writeFileSync('/tmp/msu3-e2e/session2-card.txt', String(t2));

const s2 = String(t2 ?? '');
check('session 2: cross-session identity (origin or sessionCount ≥2)', /session [2-9]\d* with this app|8177/.test(s2), (s2.match(/App[^\n]{0,80}/) || [''])[0]);
check('session 2: views group present', /Views & navigation/.test(s2), (s2.match(/Views & navigation[^\n]{0,60}/) || [''])[0]);
check('session 2: entities or state present', /Entities|State & feedback/.test(s2), (s2.match(/(Entities|State & feedback)[^\n]{0,60}/) || [''])[0]);
check('session 2: counters visible (shop cart)', /counter/.test(s2), '');

out(`\n════ MS-U3 A10 SUPPLEMENT (session 2) — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
