// MS-U5 diagnostic — why is the forward block absent? Probes the live panel
// understanding section + runs the exact lookup chain in the panel context.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import '/tmp/multipattern/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/msu5diag-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9565;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extId = t0.find(t => t.url.includes('service-worker-loader.js')).url.split('/')[2];

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const evalApp = async (e) => (await app.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (e) => (await panel.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result.value;

const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => JSON.parse((await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value);
const clickSel = async (sel) => { const p = await center(sel); await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); };
const typeInto = async (sel, text) => { const p = await center(sel); await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(200); for (const ch of text) { await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, windowsVirtualKeyCode: ch.charCodeAt(0) }); await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: ch.charCodeAt(0) }); await sleep(30); } };

await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`);
await sleep(600);
await typeInto('#q', 'invoice');
await clickSel('#btn-search');
await sleep(2800);
await evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'})`);
await sleep(4000);

// 1. What does the panel understanding section contain?
const sect = await evalPanel(`(() => {
  const s = document.getElementById('understanding-section') || document.querySelector('[id*="understanding"]');
  const card = document.querySelector('.understanding-card, #understanding-body');
  return {
    sectionFound: !!s, sectionHidden: s ? !!s.hidden : null,
    cardText: card ? card.textContent.replace(/\\s+/g,' ').slice(0, 600) : null,
    forward: !!document.querySelector('.understanding-card__forward'),
  };
})()`);
out('PANEL understanding section:', JSON.stringify(sect, null, 2));

// 2. What sessionId did understanding_result carry?
const sessionId = await evalPanel(`(async () => {
  const r = await chrome.storage.local.get('understanding_result');
  return r.understanding_result?.sessionId ?? null;
})()`);
out('understanding_result.sessionId =', sessionId);

// 3. Run the exact lookup chain in the panel context (same Dexie DB).
const probe = await evalPanel(`(async () => {
  try {
    const { createKnowledgeDatabase } = await import(chrome.runtime.getURL('src/understanding/persistence/knowledge-database.ts'));
    const db = createKnowledgeDatabase();
    const behaviorSession = await db.knowledgeBehaviorSessions.where('sessionId').equals(${JSON.stringify('')}+window.__sid).first();
    return 'imported-ok';
  } catch (e) { return 'ERR ' + (e && e.message); }
})()`);
out('import probe:', probe);

// Simpler: read raw Dexie via indexedDB in panel context.
const raw = await evalPanel(`(async () => {
  const sid = ${JSON.stringify('__SID__')};
  const dbs = await indexedDB.databases();
  const names = dbs.map(d => d.name);
  // open cmdrunner_knowledge directly
  function getAll(dbName, store) {
    return new Promise((resolve) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(store)) { resolve('no-store'); return; }
        const tx = db.transaction(store, 'readonly');
        const rq = tx.objectStore(store).getAll();
        rq.onsuccess = () => { db.close(); resolve(rq.result); };
        rq.onerror = () => resolve('read-err');
      };
      req.onerror = () => resolve('open-err');
    });
  }
  const bs = await getAll('cmdrunner_knowledge', 'knowledgeBehaviorSessions');
  const eps = await getAll('cmdrunner_knowledge', 'knowledgeEpisodes');
  const sigs = await getAll('cmdrunner_knowledge', 'knowledgeSignatures');
  const gaps = await GetAllSafe('cmdrunner_knowledge', 'knowledgeGaps');
  async function GetAllSafe() { return bs; }
  return {
    dbs: names,
    behaviorSessions: Array.isArray(bs) ? bs.map(r => ({ key: r.key, sessionId: r.sessionId, appId: r.appId })) : bs,
    episodes: Array.isArray(eps) ? eps.map(r => ({ key: r.key, sessionId: r.sessionId, appId: r.appId, signatureKey: r.signatureKey })) : eps,
    signatures: Array.isArray(sigs) ? sigs.map(r => ({ key: r.key, actionType: r.actionType, occurrenceCount: r.occurrenceCount, status: r.status })) : sigs,
    gaps: Array.isArray(gaps) ? gaps.length : gaps,
  };
})()`);
out('RAW knowledge tables:', JSON.stringify(raw, null, 2).slice(0, 3000));
process.exit(0);
