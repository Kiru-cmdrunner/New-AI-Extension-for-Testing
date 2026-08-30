// Storage-corruption hunt: attach storage.onChanged in the extension SW and
// dump every change's KEY TYPE as it happens, plus a periodic shape dump.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';

const CHROME = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const DIST = '/workspace/dist';
const CDP_PORT = 9347;
const FIXTURE_PORT = 8797;
const HTTP = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
<div id=services role=button tabindex=0 aria-expanded=false>Services Section</div>
<div id=flyout role=menu aria-hidden=true style=display:none><a id=bookflight role=menuitem href="#nowhere">Book Flight</a></div>
<div id=plaindiv>Plain</div>
<script>
services.onmouseenter = () => { flyout.style.display='block'; flyout.setAttribute('aria-hidden','false'); services.setAttribute('aria-expanded','true'); };
bookflight.onclick = () => { window.__clicked = true; };
</script></body></html>`;

async function main() {
  const USER_DATA = mkdtempSync(join(tmpdir(), 'hec-sw-'));
  const chrome = spawn(CHROME, [
    `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new',
    '--disable-gpu', `--load-extension=${DIST}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});
  await sleep(2500);

  const targets0 = await (await fetch(`${HTTP}/json/list`)).json();
  const bt0 = targets0.find((t) => t.type === 'page');
  ws = new WebSocket(bt0.webSocketDebuggerUrl);
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
  if (!swInfo) throw new Error('no SW target');
  const swS = await send('Target.attachToTarget', { targetId: swInfo.targetId, flatten: true });
  await send('Runtime.enable', {}, swS.sessionId).catch(() => {});
  const evalSW = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swS.sessionId);
    if (r.exceptionDetails) return 'EXC:' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value ?? null;
  };

  // Watch every storage change in the SW context.
  await evalSW(`(async () => {
    window.__changes = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      for (const k of Object.keys(changes)) {
        const nv = changes[k].newValue;
        const t = Array.isArray(nv) ? 'array(' + nv.length + ')' : typeof nv;
        window.__changes.push({ t: Date.now(), k: k.slice(0, 80), type: t });
      }
    });
    return 'listener-on';
  })()`);

  // Panel
  const extOrigin = swInfo.url.split('/').slice(0, 3).join('/');
  const panelT = await send('Target.createTarget', { url: extOrigin + '/src/sidepanel/index.html' });
  const panelS = await send('Target.attachToTarget', { targetId: panelT.targetId, flatten: true });
  await send('Runtime.enable', {}, panelS.sessionId).catch(() => {});
  await sleep(1500);
  const panelCmd = async (expr) => {
    await send('Runtime.evaluate', { expression: `(async () => ${expr})()`, awaitPromise: true, returnByValue: true }, panelS.sessionId).catch(() => {});
  };

  // Fixture
  const fixtureDir = mkdtempSync(join(tmpdir(), 'hec-swfix-'));
  writeFileSync(join(fixtureDir, 'probe.html'), FIXTURE);
  const httpServer = spawn('python3', ['-m', 'http.server', String(FIXTURE_PORT), '--directory', fixtureDir, '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await sleep(700);
  const pageT = await send('Target.createTarget', { url: 'about:blank' });
  const pageS = await send('Target.attachToTarget', { targetId: pageT.targetId, flatten: true });
  await send('Page.enable', {}, pageS.sessionId).catch(() => {});
  await send('Runtime.enable', {}, pageS.sessionId).catch(() => {});
  const evalPage = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageS.sessionId);
    return r.result?.value ?? null;
  };
  await send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/probe.html` }, pageS.sessionId);
  await sleep(1500);
  const box = async (sel) => evalPage(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`);
  const input = (type, params) => send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...params }, pageS.sessionId);
  const center = async (sel) => JSON.parse(await box(sel));

  console.log('START');
  await panelCmd(`chrome.runtime.sendMessage({ type: 'START_RECORDING' })`);
  await sleep(1500);
  console.log('after START, active =', await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active)()`));

  const c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900);
  const c2 = await center('#bookflight');
  await input('mouseMoved', { x: c2.x, y: c2.y }); await sleep(300);
  await input('mousePressed', c2); await sleep(80);
  await input('mouseReleased', c2); await sleep(700);

  console.log('STOP');
  await panelCmd(`chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })`);
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const active = await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active ?? null)()`).catch(() => null);
    if (active === false || active === null) break;
  }
  await sleep(2500);

  const changes = await evalSW(`JSON.stringify(window.__changes)`);
  console.log('CHANGES:', changes);
  const shape = await evalSW(`(async () => { const o = await chrome.storage.local.get(null); const ks = Object.keys(o); return JSON.stringify({ total: ks.length, named: ks.filter(k => !/^\\d+$/.test(k)), numeric: ks.filter(k => /^\\d+$/.test(k)).length, firstNumVal: ks.length && /^\\d+$/.test(ks[0]) ? String(o[ks[0]]) : null }); })()`);
  console.log('SHAPE:', shape);
  const live = await evalSW(`(async () => { const o = await chrome.storage.local.get('cmdrunner_live_interactions'); return JSON.stringify(o).slice(0, 400); })()`);
  console.log('LIVE:', live);

  try { chrome.kill(); } catch {}
  try { httpServer.kill(); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e); process.exit(2); });
