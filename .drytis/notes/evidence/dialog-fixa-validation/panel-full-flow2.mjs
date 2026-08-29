// READ-ONLY: full real-panel flow — create project/feature/scenario → Start
// → dialog clicks on app → Stop via the real #stop-btn → dump stopped-view.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 8196; const PORT = 9577;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/dlg-full2-' + Date.now();
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
const center = async (client, sel) => JSON.parse((await client.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; const r=el.getBoundingClientRect(); if (r.width===0||r.height===0) return null; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()` })).result.value);
const clickAt = async (client, p) => {
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
};
const clickSel = async (client, sel) => { const p = await center(client, sel); if (!p) { out('  missing/hidden:', sel); return false; } await clickAt(client, p); return true; };
const typeSel = async (client, sel, text) => {
  await client.send('Runtime.evaluate', { expression: `(() => { const el=document.querySelector(${JSON.stringify(sel)}); el.focus(); })()` });
  for (const ch of text) await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: text.slice(-1) });
};

await browser.send("Target.activateTarget", { targetId: appTab });
await sleep(400);

// Drive the real panel UI
await clickSel(panel, '#new-tc-btn');
await sleep(600);
// Create project
await clickSel(panel, '#tc-project-create');
await sleep(300);
await typeSel(panel, '#tc-project-new-name', 'DialogRenderProbe');
await sleep(200);
await clickSel(panel, '#tc-project-create-btn');
await sleep(800);
out('project select now:', await evalPanel(`document.querySelector('#tc-project') ? document.querySelector('#tc-project').selectedOptions[0]?.text : 'missing'`));
// Create feature
await clickSel(panel, '#tc-feature-create');
await sleep(300);
await typeSel(panel, '#tc-feature-new-name', 'Dialogs');
await sleep(200);
await clickSel(panel, '#tc-feature-create-btn');
await sleep(800);
out('feature select now:', await evalPanel(`document.querySelector('#tc-feature') ? document.querySelector('#tc-feature').selectedOptions[0]?.text : 'missing'`));
// Create scenario
await clickSel(panel, '#tc-scenario-create');
await sleep(300);
await typeSel(panel, '#tc-scenario-new-name', 'Alerts');
await sleep(200);
await clickSel(panel, '#tc-scenario-create-btn');
await sleep(800);
out('scenario select now:', await evalPanel(`document.querySelector('#tc-scenario') ? document.querySelector('#tc-scenario').selectedOptions[0]?.text : 'missing'`));
// Test case name
await typeSel(panel, '#tc-name', 'Dialog visibility');
await sleep(300);
out('start btn disabled?', await evalPanel(`document.querySelector('#tc-start-recording-btn')?.disabled`));
await browser.send("Target.activateTarget", { targetId: appTab });
await sleep(300);
const started = await clickSel(panel, '#tc-start-recording-btn');
out('start clicked:', started);
await sleep(1500);

await clickSel(app, '#a');
await sleep(2500); // generous: window closes DURING recording (stabilized)
await clickSel(app, '#c');
await sleep(2500);

await clickSel(panel, '#stop-btn');
await sleep(4500);

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
