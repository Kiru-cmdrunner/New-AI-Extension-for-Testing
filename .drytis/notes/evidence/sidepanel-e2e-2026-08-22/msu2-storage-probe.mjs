// MS-U2 probe: does live storage carry window.stabilityTrace / newSurfaces
// on interactions the panel renders? Read-only CDP probe (no recorder run —
// reuses an existing profile is impossible; we do a minimal classic run).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/msu2-probe-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9568;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extId = t0.find(t => t.url.includes('service-worker-loader.js')).url.split('/')[2];
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

await start();
async function start() {
  await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {});
  await sleep(800);
  await browser.send('Target.activateTarget', { targetId: appTab });
  // one click with DOM consequence
  const r = await app.send('Runtime.evaluate', { expression: `(() => { const b = document.querySelector('#btn-search'); const rc = b.getBoundingClientRect(); return JSON.stringify({x: rc.x + rc.width/2, y: rc.y + rc.height/2}); })()`, returnByValue: true });
  const { x, y } = JSON.parse(r.result.value);
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(3000);
  await evalPanel(`document.getElementById('stop-btn').click()`);
  await sleep(3000);

  const probe = await evalPanel(`(async () => {
    const r = await chrome.storage.local.get('cmdrunner_live_interactions');
    const arr = r['cmdrunner_live_interactions'] || [];
    return arr.map(i => ({
      id: i.interactionId, type: i.type,
      hasBE: !!i.behavioralEvidence,
      win: i.behavioralEvidence?.window ? {
        endReason: i.behavioralEvidence.window.endReason,
        durationMs: i.behavioralEvidence.window.durationMs,
        traceLen: (i.behavioralEvidence.window.stabilityTrace || []).length,
      } : null,
      newSurfaces: (i.behavioralEvidence?.applicationEvidence?.newSurfaces || []).length,
      domChanges: (i.behavioralEvidence?.applicationEvidence?.domChanges || []).length,
    }));
  })()`);
  console.log(JSON.stringify(probe, null, 2));
  try { await browser.close(); } catch {}
  chrome.kill();
  process.exit(0);
}
