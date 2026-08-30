// M4c REAL-CHROME REGRESSION — churn ON → Services reveal → mouseleave →
// immediate STOP must keep the earned Hover (evidenced/reveal).
// Loads the PACKAGED ZIP; drives real input; asserts from chrome.storage.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CDP_PORT = 9401;
const FIXTURE_PORT = 8851;
const HTTP = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIST = "/workspace/dist";
execSync(`rm -rf ${DIST} && mkdir -p ${DIST} && unzip -q /workspace/cmdrunner-extension.zip -d ${DIST}`);

let ws = null, msgId = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const FIXTURE = `<!doctype html><html><head><meta charset=utf-8>
<style>
  .flyout { display:none; position:absolute; }
  .carousel { overflow:hidden; height:60px; border:1px solid #ccc; margin-top:20px; }
  .carousel .track { display:flex; }
  .carousel .slide { min-width:120px; padding:16px; }
  .badge { position:fixed; top:0; right:0; padding:4px 8px; background:#eee; }
</style></head><body>
<nav id=appnav>
  <div id=services role=button tabindex=0 aria-haspopup=true aria-expanded=false>
    <span>Services Section</span>
  </div>
  <div id=flyout class=flyout role=menu aria-hidden=true>
    <a id=bookflight role=menuitem tabindex=0 href="#nowhere">Book Flight</a>
  </div>
</nav>
<div id=carousel class=carousel aria-roledescription=carousel>
  <div class=track id=ctrack>
    <div class=slide>Slide 1</div><div class=slide>Slide 2</div><div class=slide>Slide 3</div>
  </div>
</div>
<div class=badge id=badge>live: 0</div>
<div id=loghost></div>
<script>
window.__state = { flyoutOpen:false, rot:0, poll:0, badge:0 };
services.onmouseenter = () => { if (!window.__state.flyoutOpen) { flyout.style.display='block'; flyout.setAttribute('aria-hidden','false'); services.setAttribute('aria-expanded','true'); window.__state.flyoutOpen = true; } };
window.__carouselOn = false;
setInterval(() => {
  if (!window.__carouselOn) return;
  window.__state.rot++;
  const track = ctrack;
  track.appendChild(track.firstElementChild);
  badge.textContent = 'live: ' + (++window.__state.badge);
  const el = document.createElement('div'); el.textContent = 'poll ' + (++window.__state.poll);
  loghost.appendChild(el);
}, 400);
</script></body></html>`;

async function main() {
  const USER_DATA = mkdtempSync(join(tmpdir(), 'hec-m4c-reg-'));
  const chrome = spawn(CHROME, [
    `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new',
    '--disable-gpu', `--load-extension=${DIST}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});
  await sleep(2500);
  const targets0 = await (await fetch(`${HTTP}/json/list`)).json();
  ws = new WebSocket(targets0.find((t) => t.type === 'page').webSocketDebuggerUrl);
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, method } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result);
    }
  });
  await new Promise((r) => { ws.on('open', r); });
  await send('Target.setDiscoverTargets', { discover: true });
  await sleep(1200);
  const { targetInfos } = await send('Target.getTargets');
  const swInfo = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/service-worker-loader.js'));
  if (!swInfo) throw new Error('SW not found');
  const swS = await send('Target.attachToTarget', { targetId: swInfo.targetId, flatten: true });
  await send('Runtime.enable', {}, swS.sessionId).catch(() => {});
  const evalSW = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swS.sessionId)).result?.value ?? null;
  const extOrigin = swInfo.url.split('/').slice(0, 3).join('/');
  const panelT = await send('Target.createTarget', { url: extOrigin + '/src/sidepanel/index.html' });
  const panelS = await send('Target.attachToTarget', { targetId: panelT.targetId, flatten: true });
  await send('Runtime.enable', {}, panelS.sessionId).catch(() => {});
  await sleep(1500);
  const panelCmd = async (expr) => (await send('Runtime.evaluate', { expression: `(async () => ${expr})()`, awaitPromise: true, returnByValue: true }, panelS.sessionId)).result?.value ?? null;
  const fixtureDir = mkdtempSync(join(tmpdir(), 'hec-m4c-regfix-'));
  writeFileSync(join(fixtureDir, 'm4c.html'), FIXTURE);
  const httpServer = spawn('python3', ['-m', 'http.server', String(FIXTURE_PORT), '--directory', fixtureDir, '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await sleep(700);
  const pageT = await send('Target.createTarget', { url: 'about:blank' });
  const pageS = await send('Target.attachToTarget', { targetId: pageT.targetId, flatten: true });
  await send('Page.enable', {}, pageS.sessionId).catch(() => {});
  await send('Runtime.enable', {}, pageS.sessionId).catch(() => {});
  const evalPage = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageS.sessionId)).result?.value ?? null;
  await send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/m4c.html` }, pageS.sessionId);
  await sleep(1500);
  const center = async (sel) => JSON.parse(await evalPage(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`));
  const input = (type, params) => send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...params }, pageS.sessionId);

  const startRecording = async () => {
    for (let i = 0; i < 3; i++) {
      await panelCmd(`chrome.runtime.sendMessage({ type: 'START_RECORDING' })`);
      await sleep(700);
      const active = await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active)()`).catch(() => null);
      if (active === true) return true;
    }
    return false;
  };
  const stopRecording = async () => {
    await panelCmd(`chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })`);
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const active = await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active ?? null)()`).catch(() => null);
      if (active === false || active === null) break;
    }
    await sleep(2500);
    return JSON.parse(await evalSW(`(async () => JSON.stringify(await chrome.storage.local.get(null)))()`));
  };

  // ── The M4c scenario, verbatim ──
  await startRecording();
  await evalPage(`window.__carouselOn = true; true`);
  const c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(1500);
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(500);
  await evalPage(`window.__carouselOn = false; true`);
  const s = await stopRecording();

  const cards = s['cmdrunner_live_interactions'] ?? [];
  const hovers = cards.filter((i) => i?.type === 'Hover');
  const q = hovers[0]?.metadata?.hoverQualification ?? hovers[0]?.behavioralEvidence?.hoverQualification ?? null;
  const results = [];
  const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`); };

  record('M4c: Hover(Services) SURVIVES immediate STOP under churn', hovers.length === 1,
    `hovers=${hovers.length} cards=${cards.map((i) => i?.type).join(',')}`);
  record('M4c: verdict is evidenced/reveal (frozen capture-time verdict)', q?.verdict === 'evidenced' && q?.evidenceClass === 'reveal',
    `verdict=${q?.verdict} class=${q?.evidenceClass}`);
  record('M4c: reason recorded from target-local facts', typeof q?.evidenceReason === 'string' && q.evidenceReason.length > 0,
    `reason=${q?.evidenceReason}`);
  record('M4c: hover targets Services (identity preserved)', (hovers[0]?.metadata?.targetName ?? '') === 'Services Section',
    `target=${hovers[0]?.metadata?.targetName}`);
  record('M4c: no STOP-side reclassification minted junk (churn never earned anything)', cards.every((i) => i.type !== 'Hover' || i === hovers[0]),
    `totalCards=${cards.length}`);

  // Archive
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const outDir = '/workspace/.drytis/notes/evidence/hover-evidence-contract-v1';
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(outDir, `m4c-regression-${stamp}.json`),
      JSON.stringify({ runAt: new Date().toISOString(), source: 'cmdrunner-extension.zip', results, hoverQualification: q, cards: cards.map((i) => ({ type: i.type, target: i.metadata?.targetName })) }, null, 2));
  } catch {}

  try { chrome.kill(); } catch {}
  try { httpServer.kill(); } catch {}
  const fails = results.filter((r) => !r.pass).length;
  console.log(`── M4c regression: ${results.length - fails}/${results.length} passed ──`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('REGRESSION ERROR:', e); process.exit(2); });
