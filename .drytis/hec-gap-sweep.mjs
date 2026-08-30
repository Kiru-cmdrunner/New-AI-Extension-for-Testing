import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CDP_PORT = 9371;
const FIXTURE_PORT = 8821;
const HTTP = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIST = '/tmp/hec-gap-ext';
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

const FIXTURE = `<!doctype html><html><body>
<nav id=appnav>
  <div id=services role=button tabindex=0 aria-haspopup=true aria-expanded=false><span>Services Section</span></div>
  <div id=flyout class=flyout role=menu aria-hidden=true style="display:none"><a id=bookflight role=menuitem tabindex=0 href="#nowhere">Book Flight</a></div>
</nav>
<script>
window.__state = { flyoutOpen:false };
services.onmouseenter = () => { if (!window.__state.flyoutOpen) { flyout.style.display='block'; flyout.setAttribute('aria-hidden','false'); services.setAttribute('aria-expanded','true'); window.__state.flyoutOpen = true; } };
</script></body></html>`;

async function runGap(gapMs) {
  let ws = null, msgId = 0; const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++msgId; pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const USER_DATA = mkdtempSync(join(tmpdir(), 'gap-'));
  const chrome = spawn(CHROME, [
    `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new',
    '--disable-gpu', `--load-extension=${DIST}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});
  await sleep(2200);
  const targets0 = await (await fetch(`${HTTP}/json/list`)).json();
  ws = new WebSocket(targets0.find((t) => t.type === 'page').webSocketDebuggerUrl);
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) { const { resolve, reject, method } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result); }
  });
  await new Promise((r) => { ws.on('open', r); });
  await send('Target.setDiscoverTargets', { discover: true });
  await sleep(1000);
  const { targetInfos } = await send('Target.getTargets');
  const swInfo = targetInfos.find((t) => t.type === 'service_worker' && t.url.endsWith('/service-worker-loader.js'));
  const swS = await send('Target.attachToTarget', { targetId: swInfo.targetId, flatten: true });
  const evalSW = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swS.sessionId)).result?.value ?? null;
  const extOrigin = swInfo.url.split('/').slice(0, 3).join('/');
  const panelT = await send('Target.createTarget', { url: extOrigin + '/src/sidepanel/index.html' });
  const panelS = await send('Target.attachToTarget', { targetId: panelT.targetId, flatten: true });
  await sleep(1200);
  const panelCmd = async (expr) => (await send('Runtime.evaluate', { expression: `(async () => ${expr})()`, awaitPromise: true, returnByValue: true }, panelS.sessionId)).result?.value ?? null;
  const fixtureDir = mkdtempSync(join(tmpdir(), 'gapfix-'));
  writeFileSync(join(fixtureDir, 'g.html'), FIXTURE);
  const httpServer = spawn('python3', ['-m', 'http.server', String(FIXTURE_PORT), '--directory', fixtureDir, '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await sleep(600);
  const pageT = await send('Target.createTarget', { url: 'about:blank' });
  const pageS = await send('Target.attachToTarget', { targetId: pageT.targetId, flatten: true });
  await send('Runtime.enable', {}, pageS.sessionId).catch(() => {});
  const evalPage = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageS.sessionId)).result?.value ?? null;
  await send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/g.html` }, pageS.sessionId);
  await sleep(1400);
  const center = async (sel) => JSON.parse(await (await send('Runtime.evaluate', { expression: `(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`, returnByValue: true }, pageS.sessionId)).result?.value);
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
  const stopAndDump = async () => {
    await panelCmd(`chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })`);
    for (let i = 0; i < 25; i++) {
      await sleep(300);
      const active = await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active ?? null)()`).catch(() => null);
      if (active === false || active === null) break;
    }
    await sleep(2200);
    return JSON.parse(await evalSW(`(async () => JSON.stringify(await chrome.storage.local.get(null)))()`));
  };

  const ok = await startRecording();
  if (!ok) { cleanup(); return { gapMs, error: 'start failed' }; }
  let c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y });
  await sleep(600);
  const bf = await center('#bookflight');
  await input('mouseMoved', { x: bf.x, y: bf.y });
  await sleep(gapMs);
  await input('mousePressed', { x: bf.x, y: bf.y });
  await input('mouseReleased', { x: bf.x, y: bf.y });
  await sleep(700);
  const dump = await stopAndDump();
  const cards = dump['cmdrunner_live_interactions'] ?? [];
  const hover = cards.find((i) => i?.type === 'Hover');
  const click = cards.find((i) => i?.type === 'Link' || i?.type === 'Click');
  const q = hover?.metadata?.hoverQualification ?? hover?.behavioralEvidence?.hoverQualification ?? null;
  cleanup();
  function cleanup() {
    try { chrome.kill(); } catch {}
    try { httpServer.kill(); } catch {}
    try { ws?.close(); } catch {}
  }
  return { gapMs, hover: !!hover, click: !!click, verdict: q?.verdict ?? null, cards: cards.map((i) => i.type).join(',') };
}

const gaps = process.argv[2] ? [Number(process.argv[2])] : [0, 80, 150, 300, 500, 1000];
for (const g of gaps) {
  const r = await runGap(g);
  console.log(JSON.stringify(r));
  await sleep(1200);
}
process.exit(0);
