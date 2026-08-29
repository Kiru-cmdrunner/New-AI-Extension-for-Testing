// READ-ONLY debug: why didn't the real panel Start click transition views?
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 8196; const PORT = 9578;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/dlg-dbg-' + Date.now();
const DIST = '/workspace/dist';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);

const html = `<!doctype html><html><body><button id="a">Alert</button></body></html>`;
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
panel.on('Runtime.consoleAPICalled', (e) => out('[panel console]', e.type, (e.args||[]).map(a=>a.value??a.description??'').join(' ').slice(0,300)));
panel.on('Runtime.exceptionThrown', (e) => out('[panel EXC]', JSON.stringify(e.exceptionDetails).slice(0,500)));

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
};

await clickSel(panel, '#new-tc-btn');
await sleep(600);
await clickSel(panel, '#tc-project-create');
await sleep(300);
await typeSel(panel, '#tc-project-new-name', 'P1');
await sleep(200);
await clickSel(panel, '#tc-project-create-btn');
await sleep(800);
await clickSel(panel, '#tc-feature-create');
await sleep(300);
await typeSel(panel, '#tc-feature-new-name', 'F1');
await sleep(200);
await clickSel(panel, '#tc-feature-create-btn');
await sleep(800);
await clickSel(panel, '#tc-scenario-create');
await sleep(300);
await typeSel(panel, '#tc-scenario-new-name', 'S1');
await sleep(200);
await clickSel(panel, '#tc-scenario-create-btn');
await sleep(800);
await typeSel(panel, '#tc-name', 'Probe');
await sleep(300);
out('tc-name value:', await evalPanel(`document.querySelector('#tc-name').value`));
out('selects:', await evalPanel(`JSON.stringify({p:document.querySelector('#tc-project').value,f:document.querySelector('#tc-feature').value,s:document.querySelector('#tc-scenario').value})`));
out('start disabled:', await evalPanel(`document.querySelector('#tc-start-recording-btn').disabled`));
const ok = await clickSel(panel, '#tc-start-recording-btn');
out('clicked:', ok);
await sleep(2000);
out('views hidden state:', await evalPanel(`JSON.stringify({home:document.querySelector('#home-view').hidden, newtc:document.querySelector('#new-tc-view').hidden, rec:document.querySelector('#recording-view').hidden, stopped:document.querySelector('#stopped-view').hidden})`));
out('form error text:', await evalPanel(`(() => { const e=document.querySelector('#tc-form-error'); return e && !e.hidden ? e.textContent : '(hidden)'; })()`));
out('active recording?', await evalPanel(`(async()=>{const r=await chrome.runtime.sendMessage({type:'PING'});return JSON.stringify(r)})()`));
try { browser.send('Browser.close'); } catch {}
await sleep(800); srv.close(); process.exit(0);
