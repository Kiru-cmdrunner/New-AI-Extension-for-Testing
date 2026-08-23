
// AC-W2f: KR Dexie probe — does the seeded #id counter land in the KR?
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/kr-6d1-' + Date.now();
const PORT = 9590;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
  '--load-extension=/workspace/dist', '--disable-extensions-except=/workspace/dist'], { stdio: 'ignore' });
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
await app.send('Page.enable'); await app.send('DOM.enable');
const evalApp = async (e) => (await app.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (e) => (await panel.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const clickSel = async (sel) => { const r = (await app.send('Runtime.evaluate', { expression: `(() => { const el = document.querySelector('${sel}'); if (!el) return 'null'; const b = el.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`, returnByValue: true })).result.value; if (r === 'null') return false; const { x, y } = JSON.parse(r);
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); return true; };
const typeInto = async (sel, text) => { await clickSel(sel); await sleep(200);
  for (const ch of text) { await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) }); await sleep(35); } };
await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {});
await sleep(800);
await browser.send('Target.activateTarget', { targetId: appTab });
await typeInto('#q', 'invoice');
await clickSel('#btn-search');
await sleep(3000);
await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
await sleep(7000);
// Dexie dump from the panel context (proven channel)
const kr = await evalPanel(`(async () => {
  const dumps = {};
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (!db.name.includes('knowledge')) continue;
    const d = await new Promise((res, rej) => {
      const req = indexedDB.open(db.name);
      req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
    });
    const storeNames = [...d.objectStoreNames];
    for (const s of storeNames) {
      const rows = await new Promise((res, rej) => {
        const tx = d.transaction(s, 'readonly');
        const rq = tx.objectStore(s).getAll();
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
      dumps[s] = rows;
    }
  }
  return dumps;
})()`).catch((e) => ({ err: String(e) }));
fs.writeFileSync('/workspace/.drytis/notes/evidence/phase-6d1-e2e-2026-08-23/dumps/kr-dexie.json', JSON.stringify(kr, null, 1));
const stores = Object.keys(kr);
out('KR stores:', stores.join(','));
const sigs = kr.actionSignatures ?? kr.signatures ?? [];
const s = JSON.stringify(kr);
out('result-count in KR:', s.includes('result-count'));
out('counter mentions:', (s.match(/counter/g) || []).length);
await chrome.kill();
process.exit(0);
