// KR appId-derivation discriminator v2: fresh profile, two recordings on the
// SAME tab without navigation, then dump applications + signatures rows
// (via the same panel page that recorded — known-working channel).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/audit6d1/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/kr-v2-' + Date.now();
const PORT = 9575;
const APP = 'http://127.0.0.1:8177';
const DUMP = '/tmp/audit6d1-e2e2';
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
const evalApp = async (e) => (await app.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (e) => (await panel.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;

const clickSel = async (sel) => { const r = (await app.send('Runtime.evaluate', { expression: `(() => { const el = document.querySelector('${sel}'); if (!el) return 'null'; const b = el.getBoundingClientRect(); return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2}); })()`, returnByValue: true })).result.value; if (r === 'null') return false; const { x, y } = JSON.parse(r);
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); return true; };
const typeInto = async (sel, text) => { await clickSel(sel); await sleep(200);
  for (const ch of text) { await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) }); await sleep(35); } };

const recordOnce = async (label) => {
  await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {});
  await sleep(800);
  await browser.send('Target.activateTarget', { targetId: appTab });
  await typeInto('#q', 'invoice');
  await clickSel('#btn-search');
  await sleep(3000);
  await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
  await sleep(6500);
  const chips = await evalPanel(`(() => Array.from(document.querySelectorAll('.interaction-event')).map(n => ({ t: n.querySelector('.timeline-event__type')?.textContent || '', kr: n.querySelector('.interaction-chip--kr')?.textContent || null })))()`);
  const counts = await evalPanel(`(async () => {
    return await new Promise((resolve) => {
      const req = indexedDB.open('cmdrunner_knowledge');
      req.onsuccess = () => { const db = req.result;
        const names = ['applications','knowledgeBehaviorSessions','knowledgeSignatures'];
        let pending = names.length; const out = {};
        for (const n of names) {
          const c = db.transaction(n, 'readonly').objectStore(n).count();
          c.onsuccess = () => { out[n] = c.result; if (--pending === 0) { db.close(); resolve(out); } };
        }
      };
    });
  })()`);
  out(`\n── ${label} ── chips: ${JSON.stringify(chips)}`);
  out('counts:', JSON.stringify(counts));
  return counts;
};

await recordOnce('RECORDING 1');
await evalPanel(`document.getElementById('record-another-btn') && document.getElementById('record-another-btn').click()`).catch(() => {});
await sleep(1500);
await recordOnce('RECORDING 2 (same tab, no navigation)');

// Full row dump
const rows = await evalPanel(`(async () => {
  const get = (db, store) => new Promise((res) => {
    const t = db.transaction(store, 'readonly').objectStore(store).getAll();
    t.onsuccess = () => res(t.result); t.onerror = () => res('ERR');
  });
  return await new Promise((resolve) => {
    const req = indexedDB.open('cmdrunner_knowledge');
    req.onsuccess = async () => {
      const db = req.result;
      const out = {};
      out.applications = (await get(db, 'applications')).map(a => ({ appId: a.appId, origin: a.origin, key: a.key }));
      out.signatures = (await get(db, 'knowledgeSignatures')).map(s => ({ key: s.key, appId: s.appId, actionType: s.actionType, status: s.status, occ: s.occurrenceCount, sess: s.lastSeenAtSession }));
      db.close(); resolve(out);
    };
  });
})()`);
out('\n── ROW DUMP ──');
out(JSON.stringify(rows, null, 1));
fs.writeFileSync(`${DUMP}/kr-rowdump.json`, JSON.stringify(rows, null, 2));
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
