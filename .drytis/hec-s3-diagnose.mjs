// S3-loss diagnosis: same tab, three sessions (S1 shape → S2 shape → S3 shape),
// instrument what the collector knows at each step.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CDP_PORT = 9387;
const FIXTURE_PORT = 8837;
const HTTP = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIST = '/tmp/hec-s3-ext';
execSync(`rm -rf ${DIST} && mkdir -p ${DIST} && unzip -q /workspace/cmdrunner-extension.zip -d ${DIST}`);

let ws = null, msgId = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++msgId; pending.set(id, { resolve, reject, method });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const FIXTURE = `<!doctype html><html><body>
<nav id=appnav>
  <div id=services role=button tabindex=0 aria-haspopup=true aria-expanded=false><span>Services Section</span></div>
  <div id=flyout class=flyout role=menu aria-hidden=true style="display:none"><a id=bookflight role=menuitem tabindex=0 href="#nowhere">Book Flight</a></div>
  <div id=slowservices role=button tabindex=0 aria-haspopup=true aria-expanded=false>Slow Services</div>
  <div id=slowfly class=flyout role=menu aria-hidden=true style="display:none"><a id=slowlink role=menuitem tabindex=0 href="#slow">Slow Link</a></div>
</nav>
<div id=carousel class=carousel aria-roledescription=carousel style="overflow:hidden;height:60px;border:1px solid #ccc;margin-top:20px"><div class=track id=ctrack><div class=slide>Slide 1</div><div class=slide>Slide 2</div></div></div>
<div class=badge id=badge>live: 0</div><div id=loghost></div>
<script>
window.__state = { flyoutOpen:false, slowOpen:false, rot:0, poll:0, badge:0 };
services.onmouseenter = () => { if (!window.__state.flyoutOpen) { flyout.style.display='block'; flyout.setAttribute('aria-hidden','false'); services.setAttribute('aria-expanded','true'); window.__state.flyoutOpen = true; } };
slowservices.onmouseenter = () => { if (!window.__state.slowOpen) { window.__state.slowOpen = true; setTimeout(() => { slowfly.style.display='block'; slowfly.setAttribute('aria-side','x'), slowfly.setAttribute('aria-hidden','false'); slowservices.setAttribute('aria-expanded','true'); }, window.__slowDelayMs ?? 2500); } };
window.__carouselOn = false;
setInterval(() => { if (!window.__carouselOn) return; window.__state.rot++; ctrack.appendChild(ctrack.firstElementChild); badge.textContent = 'live: ' + (++window.__state.badge); const el = document.createElement('div'); el.textContent = 'poll ' + (++window.__state.poll); window.__churnCount = (window.__churnCount ?? 0) + 1; loghost.appendChild(el); }, 400);
</script></body></html>`;

async function main() {
  const USER_DATA = mkdtempSync(join(tmpdir(), 's3-'));
  const chrome = spawn(CHROME, [`--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`, '--no-first-run', '--no-default-browser-check', '--headless=new', '--disable-gpu', `--load-extension=${DIST}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', (d) => { const s = String(d); if (s.includes('DevTools') || s.includes('ERROR') || s.includes('bind')) console.log('CHROME-STDERR:', s.slice(0, 200)); });
  await sleep(4000);
  const t0 = await (await fetch(`${HTTP}/json/list`)).json();
  ws = new WebSocket(t0.find((t) => t.type === 'page').webSocketDebuggerUrl);
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { resolve, reject, method } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result); } });
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
  const fixtureDir = mkdtempSync(join(tmpdir(), 's3fix-'));
  writeFileSync(join(fixtureDir, 'd.html'), FIXTURE);
  const httpServer = spawn('python3', ['-m', 'http.server', String(FIXTURE_PORT), '--directory', fixtureDir, '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await sleep(600);
  const pageT = await send('Target.createTarget', { url: 'about:blank' });
  const pageS = await send('Target.attachToTarget', { targetId: pageT.targetId, flatten: true });
  await send('Runtime.enable', {}, pageS.sessionId).catch(() => {});
  const evalPage = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageS.sessionId)).result?.value ?? null;
  await send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/d.html` }, pageS.sessionId);
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

  const plan = (process.argv[2] ?? 'A,B,C').split(',');
  let c = { x: 0, y: 0 };
  // Session A = S1 shape (slow reveal, slow services)
  if (!plan.includes('A')) { /* skip A */ }
  await evalPage(`window.__slowDelayMs = 2500; true`);
  if (plan.includes('A')) {
    c = await center('#slowservices');
    await input('mouseMoved', { x: c.x, y: c.y });
    await sleep(4500);
    await stopAndDump();
    console.log('A done');
  }

  // Session B = S2 shape (churn + services + immediate STOP)
  if (plan.includes('B')) {
    await evalPage(`window.__carouselOn = true; true`);
    c = await center('#services');
    await input('mouseMoved', { x: c.x, y: c.y });
    await sleep(800);
    const bDump = await stopAndDump();
    await evalPage(`window.__carouselOn = false; window.__state.flyoutOpen = false; flyout.style.display = 'none'; services.setAttribute('aria-expanded', 'false'); flyout.setAttribute('aria-hidden', 'true'); true`);
    console.log('B cards:', JSON.stringify((bDump['cmdrunner_live_interactions'] ?? []).map((c) => ({ id: c.interactionId ?? c.id, t: c.type, hasEv: !!c.behavioralEvidence }))));
    const bPend = await evalSW(`(async () => { const r = await chrome.storage.local.get('cmdrunner_pending_evidence'); const v = r['cmdrunner_pending_evidence']; return v ? (Array.isArray(v) ? v.length + ':' + v.map((p) => String(p[0]).slice(-6)).join(',') : 'shape:' + Object.keys(v).slice(0,5).join(',')) : 'none'; })()`);
    console.log('B pending:', bPend);
    console.log('B done');
  }

  // Session C = S3 shape (hover services → click bookflight)
  await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y });
  await sleep(600);
  const bf = await center('#bookflight');
  await input('mouseMoved', { x: bf.x, y: bf.y });
  await sleep(80);
  await input('mousePressed', { x: bf.x, y: bf.y });
  await input('mouseReleased', { x: bf.x, y: bf.y });
  await sleep(700);
  const midC = await evalSW(`(async () => { const r = await chrome.storage.local.get('cmdrunner_live_interactions'); const v = r['cmdrunner_live_interactions'] ?? []; return JSON.stringify(v.map((c) => ({ id: c.interactionId ?? c.id, t: c.type, hasEv: !!c.behavioralEvidence, hq: (c.metadata?.hoverQualification?.verdict) ?? (c.behavioralEvidence?.hoverQualification?.verdict ?? null) }))); })()`);
  console.log('C MID (pre-STOP) interactions:', midC);
  const dump = await stopAndDump();
  // inspect EVERYTHING the SW kept: live interactions + pending + session store
  const pend = await evalSW(`(async () => { const r = await chrome.storage.local.get('cmdrunner_pending_evidence'); return JSON.stringify(r['cmdrunner_pending_evidence'] ?? null).slice(0, 800); })()`);
  console.log('C pending evidence RAW:', pend);
  const ledger = await evalSW(`(async () => { const r = await chrome.storage.local.get('cmdrunner_evidence_ledger'); const v = r['cmdrunner_evidence_ledger']; if (!v) return 'null'; const rows = v.rows ?? v; if (!rows.slice) return 'shape:' + Object.keys(v).slice(0,10).join(','); return JSON.stringify(rows.map((row) => { const ev = row.evidence ?? row; const src = ev.sourceEventId ?? row.sourceEventId ?? null; const hq = (ev.hoverQualification ?? row.hoverQualification) ?? null; return { src: src ? String(src).slice(-14) : null, type: ev.sourceEventType ?? null, hq: hq ? hq.verdict : null, claim: row.claimedBy ?? row.claimed ?? row.consumerInteractionId ?? null }; })); })()`);
  console.log('C ledger:', ledger);
  const sessInts = await evalSW(`(async () => { const r = await chrome.storage.local.get('cmdrunner_live_interactions'); const v = r['cmdrunner_live_interactions'] ?? []; return JSON.stringify(v.map((c) => ({ id: c.interactionId ?? c.id, t: c.type, trig: c.triggerEvent?.eventId ? String(c.triggerEvent.eventId).slice(-14) : null, members: (c.memberEvents ?? []).map((m) => String(m.eventId).slice(-14)), hasEv: !!c.behavioralEvidence }))); })()`);
  console.log('C interactions:', sessInts);
  const hoverCards = (dump['cmdrunner_live_interactions'] ?? []);
  console.log('C all cards:', JSON.stringify(hoverCards.map((c) => ({ t: c.type, trig: c.triggerEvent?.eventType, target: c.metadata?.targetName, hasEv: !!c.behavioralEvidence }))));
  const cards = dump['cmdrunner_live_interactions'] ?? [];
  console.log('C cards:', cards.map((i) => i.type).join(','));
  const hover = cards.find((i) => i?.type === 'Hover');
  console.log('C hover:', JSON.stringify(hover)?.slice(0, 200) ?? 'MISSING');

  try { chrome.kill(); } catch {}
  try { httpServer.kill(); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error('DIAG ERROR:', e.message); process.exit(2); });
