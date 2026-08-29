// MS-U2 A10 supplement — storage probe: why winDrills=0 on dialog cards?
// Reuses the same flow, then reads cmdrunner_live_interactions directly.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import '/tmp/dialogapp/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-msu2p-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9571;
const APP = 'http://127.0.0.1:8188';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);

const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const clickSel = async (sel) => { const p = JSON.parse((await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value); await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); };

await startRec(); 
async function startRec(){ await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(()=>{}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); }

await clickSel('#escalate'); await sleep(900);
await clickSel('#confirm'); await sleep(3000);
await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
await sleep(4000);

const data = await evalPanel(`chrome.storage.local.get(['cmdrunner_live_interactions']).then(r => JSON.stringify((r.cmdrunner_live_interactions||[]).map(i => ({
  type: i.interaction?.type ?? i.type,
  label: (i.interaction?.label ?? i.label ?? '').slice(0,40),
  endReason: i.behavioralEvidence?.window?.endReason ?? null,
  samples: i.behavioralEvidence?.window?.stabilityTrace?.length ?? null,
  hasApp: !!i.behavioralEvidence?.applicationEvidence,
  dom: i.behavioralEvidence?.applicationEvidence?.domChanges?.length ?? 0,
  surf: (i.behavioralEvidence?.applicationEvidence?.newSurfaces?.length ?? 0) + (i.behavioralEvidence?.applicationEvidence?.removedSurfaces?.length ?? 0),
  net: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
}))))`);
out('stored interactions:'); out(JSON.stringify(JSON.parse(data), null, 2));
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
