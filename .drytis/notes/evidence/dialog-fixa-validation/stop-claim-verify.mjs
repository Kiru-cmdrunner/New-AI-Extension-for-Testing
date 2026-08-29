// READ-ONLY diagnostic: does the stop force-close CLAIM the stamp (attribute
// drained from <html>) and does the panel render the dialog card? Also checks
// whether the in-memory attach happened by looking at the storage AFTER a
// post-stop re-read, and whether stamps were stolen at birth (which dialog
// ended up on which click in the rapid cadence).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 8198; const PORT = 9574;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/dlg-stop-' + Date.now();
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
const evalApp = async (e) => (await app.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const center = async (sel) => JSON.parse((await app.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const el=document.querySelector(${JSON.stringify(sel)}); const r=el.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()` })).result.value);
const clickSel = async (sel) => { const p = await center(sel); await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); };

out('START →', await evalPanel(`(async()=>{try{await chrome.runtime.sendMessage({type:'START_RECORDING'});return 'ok'}catch(e){return String(e)}})()`));
await sleep(1500);
await clickSel('#a');
await sleep(400);
await clickSel('#c');
await sleep(400);

out('pre-stop stamp on <html>:', await evalApp(`document.documentElement.getAttribute('data-cmdrunner-dialog')`));

out('STOP →', await evalPanel(`(async()=>{try{await chrome.runtime.sendMessage({type:'STOP_RECORDING'});return 'ok'}catch(e){return String(e)}})()`));
await sleep(3500);

out('post-stop stamp on <html>:', await evalApp(`document.documentElement.getAttribute('data-cmdrunner-dialog')`), '(null/undefined ⇒ stamp WAS claimed by force-close)');

const post = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return (g.cmdrunner_live_interactions || []).map(i => ({
    id: i.interactionId, t: i.type, end: i.endState,
    ev: i.behavioralEvidence ? (i.behavioralEvidence.applicationEvidence && i.behavioralEvidence.applicationEvidence.triggeredDialog ? i.behavioralEvidence.applicationEvidence.triggeredDialog : null) : 'NO-EV',
    wo: i.behavioralEvidence ? i.behavioralEvidence.windowId : null,
    wr: i.behavioralEvidence ? (i.behavioralEvidence.window && i.behavioralEvidence.window.endReason) : null,
  }));
})()`);
out('post-stop production list (storage):');
out(JSON.stringify(post, null, 1));

out('panel dialog cards rendered:', await evalPanel(`(() => { const t = document.body.innerText || ''; return (t.match(/JS Dialog|triggered a/g) || []).length + ' marker-hits; text-snippet=' + t.slice(0,0); })()`), '');
// more precise: count dialog evidence cards in DOM
out('panel DOM scan:', await evalPanel(`(() => { const cards = [...document.querySelectorAll('*')].filter(el => el.children.length===0 && /Dialog|alert|confirm/i.test(el.textContent||'')); return cards.slice(0,6).map(c=>c.textContent.trim().slice(0,60)); })()`));

try { browser.send('Browser.close'); } catch {}
await sleep(800); srv.close(); process.exit(0);
