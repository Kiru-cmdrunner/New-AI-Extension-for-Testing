// Focused probe: why does keyboard-activated alert not land in evidence?
// Load ZIP ext, start recording (raw msg), navigate /order, Enter-activate
// place-order, then dump: attribute state, interaction list w/ dialog fields.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

// start the fixture app FIRST (probe runs standalone)
await import('/workspace/.drytis/notes/evidence/full-audit-350af71/r3-bookshop-app.mjs');

const EXT = '/tmp/zip-e2e-ext';
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = `/tmp/probe-profile-${Date.now()}`;
const PORT = 9562;
const APP = 'http://127.0.0.1:8177';

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extId = t0.find(t => t.url.includes('service-worker-loader.js')).url.split('/')[2];
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2000);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable'); await app.send('Page.enable');
const evalPanel = async (e) => (await panel.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (e) => (await app.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;

let dialogLog = [];
app.on('Page.javascriptDialogOpening', async (ev) => {
  dialogLog.push({ type: ev.type, message: ev.message });
  try { await app.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
});

await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; })()`);
await sleep(800);
await browser.send('Target.activateTarget', { targetId: appTab });
await app.send('Page.navigate', { url: `${APP}/order` });
await sleep(2000);

const gate = await evalApp(`document.documentElement.getAttribute('data-cmdrunner-net-active')`);
console.log('net-active gate on /order:', JSON.stringify(gate));
const patched = await evalApp(`!!window.__cmdrunnerDialogPatched`);
console.log('dialog patch on /order:', patched);

// keyboard: tab to place-order, Enter with text
for (let i = 0; i < 15; i++) {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await sleep(70);
  const cur = await evalApp(`document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none'`);
  if (String(cur).trim() === 'place-order') break;
}
console.log('focused:', await evalApp(`document.activeElement?.id`));

// Instrument the button: log gate value at handler time
await evalApp(`window.__diag = [];
window.__mut = [];
new MutationObserver(muts => {
  for (const m of muts) window.__mut.push({ attr: m.attributeName, newVal: (m.target.getAttribute(m.attributeName)||'').slice(0,140), t: performance.now() });
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-cmdrunner-dialog','data-cmdrunner-net-active'] });
const b = document.getElementById('place-order');
b.addEventListener('click', () => {
  window.__diag.push({
    gate: document.documentElement.getAttribute('data-cmdrunner-net-active'),
    patched: !!window.__cmdrunnerDialogPatched,
    alertIsPatched: !window.alert.toString().includes('[native code]'),
    t: performance.now()
  });
}, true);`);
await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
await sleep(400);
console.log('diag at handler:', JSON.stringify(await evalApp(`window.__diag`)));
console.log('attr mutations:', JSON.stringify(await evalApp(`window.__mut`)));
console.log('dialogLog:', JSON.stringify(dialogLog));

// Immediately inspect the stamp + interactions
await sleep(800);
const attr = await evalApp(`document.documentElement.getAttribute('data-cmdrunner-dialog')`);
console.log('stamp attr RIGHT AFTER:', JSON.stringify(attr));

const inters = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return JSON.stringify((g.cmdrunner_live_interactions||[]).map(i => ({
    t: i.interactionType ?? i.type,
    dlg: i.behavioralEvidence?.applicationEvidence?.triggeredDialog ?? null,
    end: i.behavioralEvidence?.window?.endReason ?? null
  })));
})()`);
console.log('interactions:', inters);

// wait longer for window to close and re-check
await sleep(3000);
const inters2 = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return JSON.stringify((g.cmdrunner_live_interactions||[]).map(i => ({
    t: i.interactionType ?? i.type,
    dlg: i.behavioralEvidence?.applicationEvidence?.triggeredDialog ?? null
  })));
})()`);
console.log('interactions (3s later):', inters2);
const attr2 = await evalApp(`document.documentElement.getAttribute('data-cmdrunner-dialog')`);
console.log('stamp attr (3s later):', JSON.stringify(attr2));

try { await browser.close(); } catch {}
try { chrome.kill('SIGKILL'); } catch {}
process.exit(0);
