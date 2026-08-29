// READ-ONLY diagnostic: which evidence object carries the dialog stamp,
// what its sourceEventId/windowId/endReason are, and which interaction it
// attached to. No product files touched.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 8199; const PORT = 9573;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/dlg-diag-' + Date.now();
const DIST = '/workspace/dist';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);

const html = `<!doctype html><html><body>
<button id="a">Alert</button><button id="c">Confirm</button><span id="s"></span>
<script>
document.getElementById('a').addEventListener('click', () => { alert('D1 alert'); });
document.getElementById('c').addEventListener('click', () => { if (confirm('D2 confirm')) document.getElementById('s').textContent='ok'; });
</script></body></html>`;
const srv = http.createServer((q, r) => { r.writeHead(200, {'Content-Type':'text/html'}); r.end(html); });
srv.listen(APP_PORT, '127.0.0.1');

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extId = t0.find((t) => t.url.includes('service-worker-loader.js')).url.split('/')[2];
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${APP_PORT}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
await app.send('Page.enable');
app.on('Page.javascriptDialogOpening', async () => { try { await app.send('Page.handleJavaScriptDialog', { accept: true }); } catch {} });
const evalPanel = async (e) => (await panel.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const center = async (sel) => JSON.parse((await app.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const el=document.querySelector(${JSON.stringify(sel)}); const r=el.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()` })).result.value);
const clickSel = async (sel) => { const p = await center(sel); await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); };

out('START →', await evalPanel(`(async()=>{try{await chrome.runtime.sendMessage({type:'START_RECORDING'});return 'ok'}catch(e){return String(e)}})()`));
await sleep(1500);
await clickSel('#a');   // alert — dismiss auto
await sleep(2500);      // give the click window plenty of settle time
await clickSel('#c');   // confirm — accept auto
await sleep(2500);
// hover over buttons between clicks happens naturally via dispatch (mouseenter)

out('pre-stop evidence:');
const pre = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return (g.cmdrunner_live_interactions || []).map(i => ({
    id: i.interactionId, t: i.type, end: i.endState,
    trig: i.triggerEvent && i.triggerEvent.eventId,
    members: (i.memberEvents||[]).map(m=>m.eventId),
    ev: i.behavioralEvidence ? {
      src: i.behavioralEvidence.sourceEventId,
      srcType: i.behavioralEvidence.sourceEventType,
      win: i.behavioralEvidence.windowId,
      endReason: i.behavioralEvidence.window && i.behavioralEvidence.window.endReason,
      dlg: i.behavioralEvidence.applicationEvidence && i.behavioralEvidence.applicationEvidence.triggeredDialog,
    } : null,
  }));
})()`);
out(JSON.stringify(pre, null, 1));

out('pending evidence keys:', await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_pending_evidence');
  const p = g.cmdrunner_pending_evidence;
  if (!p) return 'none';
  const vals = Array.isArray(p) ? p : Object.values(p);
  return JSON.stringify(vals.map(e => ({ src: e.sourceEventId, srcType: e.sourceEventType, win: e.windowId, endReason: e.window && e.window.endReason, dlg: e.applicationEvidence && e.applicationEvidence.triggeredDialog })));
})()`));

out('STOP →', await evalPanel(`(async()=>{try{await chrome.runtime.sendMessage({type:'STOP_RECORDING'});return 'ok'}catch(e){return String(e)}})()`));
await sleep(3500);
out('post-stop evidence:');
const post = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return (g.cmdrunner_live_interactions || []).map(i => ({
    id: i.interactionId, t: i.type, end: i.endState,
    trig: i.triggerEvent && i.triggerEvent.eventId,
    ev: i.behavioralEvidence ? {
      src: i.behavioralEvidence.sourceEventId,
      srcType: i.behavioralEvidence.sourceEventType,
      win: i.behavioralEvidence.windowId,
      endReason: i.behavioralEvidence.window && i.behavioralEvidence.window.endReason,
      dlg: i.behavioralEvidence.applicationEvidence && i.behavioralEvidence.applicationEvidence.triggeredDialog,
    } : null,
  }));
})()`);
out(JSON.stringify(post, null, 1));
try { browser.send('Browser.close'); } catch {}
await sleep(800); srv.close(); process.exit(0);
