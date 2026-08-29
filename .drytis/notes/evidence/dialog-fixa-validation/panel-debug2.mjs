// READ-READ debug2: is the start button click reaching its handler? What's topmost?
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 8196; const PORT = 9579;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/dlg-dbg2-' + Date.now();
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
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const panel = await CDP({ target: panelTab, port: PORT });
await panel.send('Runtime.enable');
panel.on('Runtime.consoleAPICalled', (e) => out('[console]', e.type, (e.args||[]).map(a=>a.value??a.description??'').join(' ').slice(0,300)));
panel.on('Runtime.exceptionThrown', (e) => out('[EXC]', JSON.stringify(e.exceptionDetails).slice(0,400)));

const evalPanel = async (e) => (await panel.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const center = async (sel) => JSON.parse((await panel.send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; const r=el.getBoundingClientRect(); if (r.width===0||r.height===0) return null; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()` })).result.value);
const clickAt = async (p) => {
  await panel.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await panel.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
};
const typeSel = async (sel, text) => {
  await panel.send('Runtime.evaluate', { expression: `(() => { const el=document.querySelector(${JSON.stringify(sel)}); el.focus(); })()` });
  for (const ch of text) await panel.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
};

await evalPanel(`document.querySelector('#new-tc-btn').click()`);
await sleep(600);
// instrument: log any click that reaches the start button, capture phase
await evalPanel(`(() => { window.__hits = []; const b = document.querySelector('#tc-start-recording-btn'); ['pointerdown','mousedown','click'].forEach(t => b.addEventListener(t, () => window.__hits.push(t), true)); return 'instrumented'; })()`);
await panel.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 50, y: 50 });

await evalPanel(`document.querySelector('#tc-project-create').click()`);
await sleep(300);
await typeSel('#tc-project-new-name', 'P1');
await sleep(200);
await evalPanel(`document.querySelector('#tc-project-create-btn').click()`);
await sleep(800);
await evalPanel(`document.querySelector('#tc-feature-create').click()`);
await sleep(300);
await typeSel('#tc-feature-new-name', 'F1');
await sleep(200);
await evalPanel(`document.querySelector('#tc-feature-create-btn').click()`);
await sleep(800);
await evalPanel(`document.querySelector('#tc-scenario-create').click()`);
await sleep(300);
await typeSel('#tc-scenario-new-name', 'S1');
await sleep(200);
await evalPanel(`document.querySelector('#tc-scenario-create-btn').click()`);
await sleep(800);
await typeSel('#tc-name', 'Probe');
await sleep(300);

const p = await center('#tc-start-recording-btn');
out('start btn center:', JSON.stringify(p));
out('elementFromPoint:', await evalPanel(`(() => { const b=document.querySelector('#tc-start-recording-btn'); const r=b.getBoundingClientRect(); const el=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return el ? el.tagName + '#' + el.id + '.' + el.className : 'null'; })()`));
await clickAt(p);
await sleep(2500);
out('hits on start btn:', JSON.stringify(await evalPanel(`window.__hits`)));
out('views:', await evalPanel(`JSON.stringify({home:document.querySelector('#home-view').hidden,newtc:document.querySelector('#new-tc-view').hidden,rec:document.querySelector('#recording-view').hidden,stopped:document.querySelector('#stopped-view').hidden})`));
out('viewport:', await evalPanel(`JSON.stringify({w:innerWidth,h:innerHeight,scrollY:scrollY,dh:document.documentElement.scrollHeight})`));
// try programmatic click as fallback comparison
await evalPanel(`document.querySelector('#tc-start-recording-btn').click()`);
await sleep(2000);
out('after programmatic click — views:', await evalPanel(`JSON.stringify({home:document.querySelector('#home-view').hidden,newtc:document.querySelector('#new-tc-view').hidden,rec:document.querySelector('#recording-view').hidden,stopped:document.querySelector('#stopped-view').hidden})`));
out('recording?', await evalPanel(`(async()=>{const r=await chrome.runtime.sendMessage({type:'PING'});return JSON.stringify(r)})()`));
try { browser.send('Browser.close'); } catch {}
await sleep(800); srv.close(); process.exit(0);
