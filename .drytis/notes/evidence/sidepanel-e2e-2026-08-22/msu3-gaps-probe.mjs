import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs';
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-gaps3-' + Date.now();
const PORT = 9575;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', `--load-extension=/workspace/dist`, '--disable-extensions-except=/workspace/dist'], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.filter(t => t.url.includes('service-worker-loader.js'))[0];
const extId = extSW.url.split('/')[2];
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => { const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value; return v === 'null' ? null : JSON.parse(v); };
const clickSel = async (sel) => { const p = await center(sel); if (!p) return false;
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); return true; };
const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };

await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await clickSel('#btn-search');
await sleep(2500);
await clickSel('#btn-search');
await sleep(2000);
await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 1; })()`);
await sleep(8000);

// NOTE: evaluate with returnByValue and awaitPromise; probe via a single IIFE.
// Use the BUILT module URL from the panel origin.
const probeExpr = `(async () => {
  try {
    const res = await chrome.storage.local.get(null);
    const ur = res['understanding_result'];
    const sid = res['repository_session_id'];
    const mod = await import('/assets/knowledge-database-0r-EYW7g.js');
    const db = mod.createKnowledgeDatabase();
    const sessions = await db.knowledgeBehaviorSessions.toArray();
    const gaps = await db.knowledgeGaps.toArray();
    return {
      repositorySessionId: sid,
      understandingSessionId: ur && ur.sessionId,
      episodes: ur && ur.behaviorModel ? ur.behaviorModel.episodes.length : 0,
      unattributedInResult: ur && ur.behaviorModel ? (ur.behaviorModel.unattributed||[]).length : 0,
      behaviorSessionRows: sessions.map(s => ({ key: s.key, appId: s.appId, sessionId: s.sessionId, gapCount: s.gapCount })),
      gapRows: gaps.map(g => ({ key: g.key, gapId: g.gapId, observedKind: g.observedKind, reason: g.reason })),
    };
  } catch (e) {
    return { probeError: String(e && e.message || e) };
  }
})()`;
const truth = await panel.send('Runtime.evaluate', { expression: probeExpr, awaitPromise: true, returnByValue: true });
out('TRUTH:', JSON.stringify(truth.result.value, null, 2));
fs.writeFileSync('/tmp/msu3-e2e/gaps-probe.json', JSON.stringify(truth.result.value, null, 2));

// card census with the gaps block
const census = await evalPanel(`(() => { const c = document.querySelector('.understanding-card'); return c ? c.textContent.slice(0, 1600) : null; })()`);
out('CARD:', JSON.stringify(census));
fs.writeFileSync('/tmp/msu3-e2e/gaps-probe-card.txt', census || 'null');

try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
