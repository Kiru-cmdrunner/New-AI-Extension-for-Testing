// READ-ONLY DEFINITIVE: real panel flow (programmatic panel clicks + trusted
// app clicks) → dialog clicks → Stop via real handler → dump stopped-view.
// Cadence A: generous settle (windows close DURING recording).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 8196; const PORT = 9580;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/dlg-def-' + Date.now();
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
const clickSelTrusted = async (sel) => { const p = await center(sel); await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); };
const panelClick = async (sel) => await evalPanel(`(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 'missing'; el.scrollIntoView({block:'center'}); el.click(); return 'ok'; })()`);
const typeSel = async (sel, text) => {
  await panel.send('Runtime.evaluate', { expression: `(() => { const el=document.querySelector(${JSON.stringify(sel)}); el.focus(); })()` });
  for (const ch of text) await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
};

// Drive the real panel UI (programmatic — panel buttons aren't recorded)
await panelClick('#new-tc-btn');
await sleep(600);
await panelClick('#tc-project-create');
await sleep(300);
await typeSel('#tc-project-new-name', 'DialogRender');
await sleep(200);
await panelClick('#tc-project-create-btn');
await sleep(800);
await panelClick('#tc-feature-create');
await sleep(300);
await typeSel('#tc-feature-new-name', 'Dialogs');
await sleep(200);
await panelClick('#tc-feature-create-btn');
await sleep(800);
await panelClick('#tc-scenario-create');
await sleep(300);
await typeSel('#tc-scenario-new-name', 'Alerts');
await sleep(200);
await panelClick('#tc-scenario-create-btn');
await sleep(800);
await typeSel('#tc-name', 'Dialog visibility');
await sleep(300);
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(300);
await panelClick('#tc-start-recording-btn');
await sleep(1500);
out('recording?', await evalPanel(`(async()=>{const r=await chrome.runtime.sendMessage({type:'PING'});return JSON.stringify(r)})()`));

await clickSelTrusted('#a');
await sleep(2500); // generous: window closes DURING recording
await clickSelTrusted('#c');
await sleep(2500);

out('pre-stop stamp:', await evalApp(`document.documentElement.getAttribute('data-cmdrunner-dialog')`));
await panelClick('#stop-btn');
await sleep(5000);

const storageDump = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return (g.cmdrunner_live_interactions || []).map(i => ({
    id: i.interactionId, t: i.type,
    name: i.targetName || (i.triggerEvent && i.triggerEvent.targetName),
    dlg: i.behavioralEvidence && i.behavioralEvidence.applicationEvidence && i.behavioralEvidence.applicationEvidence.triggeredDialog,
  }));
})()`);
out('STORAGE:', JSON.stringify(storageDump, null, 1));

const txt = await evalPanel(`document.body.innerText`);
out('PANEL stopped-view text:');
out(txt.slice(0, 4500));
out('---- markers ----');
out('D1 alert present:', txt.includes('D1 alert'), '| D2 confirm present:', txt.includes('D2 confirm'), '| dialog word:', /dialog/i.test(txt));
try { browser.send('Browser.close'); } catch {}
await sleep(800); srv.close(); process.exit(0);
