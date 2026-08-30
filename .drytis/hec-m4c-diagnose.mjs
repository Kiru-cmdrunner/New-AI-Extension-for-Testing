// M4c DIAGNOSIS — read-only: drives the PACKAGED ZIP build in real Chrome and
// dumps the RAW evidence-ledger hover row for the SAME reveal scenario with
// churn OFF vs churn ON. Observes chrome.storage only; modifies nothing.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CDP_PORT = 9353;
const FIXTURE_PORT = 8803;
const HTTP = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ZIP_DIR = mkdtempSync(join(tmpdir(), 'hec-zip-diag-'));
execSync(`unzip -q /workspace/cmdrunner-extension.zip -d ${ZIP_DIR}`);

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
  .carousel { overflow:hidden; height:60px; border:1px solid #ccc; }
  .carousel .track { display:flex; }
  .carousel .slide { min-width:120px; padding:16px; }
  .badge { position:fixed; top:0; right:0; padding:4px 8px; background:#eee; }
</style></head><body>
<nav id=appnav>
  <div id=services role=button tabindex=0 aria-haspopup=true aria-expanded=false>
    <span>Services Section</span>
    <svg aria-hidden=true width=12 height=12><path d="M1 1"/></svg>
  </div>
  <div id=flyout class=flyout role=menu aria-hidden=true>
    <a id=bookflight role=menuitem tabindex=0 href="#nowhere">Book Flight</a>
  </div>
</nav>
<div id=dropwrap>
  <button id=dropbtn aria-haspopup=menu aria-expanded=false type=button>Menu</button>
  <div id=dropmenu hidden role=menu><div role=menuitem tabindex=0 id=opt1>Alpha Option</div></div>
</div>
<div id=carousel class=carousel aria-roledescription=carousel>
  <div class=track id=ctrack>
    <div class=slide>Slide 1</div><div class=slide>Slide 2</div><div class=slide>Slide 3</div>
  </div>
</div>
<div class=badge id=badge>live: 0</div>
<div id=loghost></div>
<script>
window.__state = { flyoutOpen:false, dropOpen:false, rot:0, poll:0, badge:0 };
services.onmouseenter = () => { if (!window.__state.flyoutOpen) { flyout.style.display='block'; flyout.setAttribute('aria-hidden','false'); services.setAttribute('aria-expanded','true'); window.__state.flyoutOpen = true; } };
dropbtn.onclick = () => { if (dropmenu.hasAttribute('hidden')) { dropmenu.removeAttribute('hidden'); dropbtn.setAttribute('aria-expanded','true'); } else { dropmenu.setAttribute('hidden',''); dropbtn.setAttribute('aria-expanded','false'); } };
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
  const USER_DATA = mkdtempSync(join(tmpdir(), 'hec-diag-'));
  const chrome = spawn(CHROME, [
    `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new',
    '--disable-gpu', `--load-extension=${ZIP_DIR}`, 'about:blank',
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
  const swS = await send('Target.attachToTarget', { targetId: swInfo.targetId, flatten: true });
  await send('Runtime.enable', {}, swS.sessionId).catch(() => {});
  const evalSW = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swS.sessionId);
    if (r.exceptionDetails) throw new Error('SW eval: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value ?? null;
  };

  const extOrigin = swInfo.url.split('/').slice(0, 3).join('/');
  const panelT = await send('Target.createTarget', { url: extOrigin + '/src/sidepanel/index.html' });
  const panelS = await send('Target.attachToTarget', { targetId: panelT.targetId, flatten: true });
  await send('Runtime.enable', {}, panelS.sessionId).catch(() => {});
  await sleep(1500);
  const panelCmd = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => ${expr})()`, awaitPromise: true, returnByValue: true }, panelS.sessionId);
    return r.result?.value ?? null;
  };

  const fixtureDir = mkdtempSync(join(tmpdir(), 'hec-diagfix-'));
  writeFileSync(join(fixtureDir, 'diag.html'), FIXTURE);
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
  const navigate = async () => { await send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/diag.html` }, pageS.sessionId); await sleep(1500); };
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
  const readStorage = () => evalSW(`(async () => JSON.stringify(await chrome.storage.local.get(null)))()`).then(JSON.parse);

  async function runScenario(label, churn) {
    await navigate(); await startRecording();
    if (churn) await evalPage(`window.__carouselOn = true; true`);
    const c = await center('#services');
    await input('mouseMoved', { x: c.x, y: c.y }); await sleep(1500);
    await input('mouseMoved', { x: 5, y: 5 }); await sleep(600);
    if (churn) await evalPage(`window.__carouselOn = false; true`);
    // Read storage BEFORE STOP — ledger + pending as drained at window close.
    const preStop = await readStorage();
    await panelCmd(`chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })`);
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const active = await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active ?? null)()`).catch(() => null);
      if (active === false || active === null) break;
    }
    await sleep(2500);
    const post = await readStorage();

    const dump = {
      label,
      preStop: {
        ledgerHovers: (preStop['cmdrunner_evidence_ledger'] ?? []).filter((w) => w?.sourceEventType === 'mouseenter' || w?.hoverQualification).map(summarize),
        pending: (preStop['cmdrunner_pending_evidence'] ?? []).filter((w) => w?.hoverQualification).map(summarize),
        liveHoverCards: (preStop['cmdrunner_live_interactions'] ?? []).filter((i) => i?.type === 'Hover').length,
      },
      postStop: {
        hoverCards: (post['cmdrunner_live_interactions'] ?? []).filter((i) => i?.type === 'Hover').map((i) => ({
          type: i.type, target: i.metadata?.targetName ?? i.trigger?.accessibleName,
          q: i.metadata?.hoverQualification ?? i.behavioralEvidence?.hoverQualification ?? null,
        })),
        ledgerHovers: (post['cmdrunner_evidence_ledger'] ?? []).filter((w) => w?.hoverQualification).map(summarize),
      },
    };
    console.log('══ ' + label + ' ══');
    console.log(JSON.stringify(dump, null, 1));
  }

  function summarize(w) {
    const q = w.hoverQualification;
    const app = w.applicationEvidence ?? w.evidence?.applicationEvidence ?? {};
    return {
      sourceEventType: w.sourceEventType,
      qualification: q ? { verdict: q.verdict, evidenceClass: q.evidenceClass, evidenceReason: q.evidenceReason, factSummary: q.factSummary, anchorFacts: q.anchorFacts } : null,
      domChangesCount: (app.domChanges ?? []).length,
      domChangeOverflow: app.domChangeOverflow ?? 0,
      coarseMode: app.coarseMode ?? null,
      newSurfacesCount: (app.newSurfaces ?? []).length,
      ariaFlipDeltas: (app.domChanges ?? [])
        .filter((d) => d.attributeDeltas && Object.keys(d.attributeDeltas).length)
        .map((d) => ({ path: d.targetPath, deltas: d.attributeDeltas })),
      joinedSurfacePaths: (app.newSurfaces ?? []).map((s) => ({ path: s.path, emergence: s.emergence, kind: s.kind })),
    };
  }

  await runScenario('R1: reveal, churn OFF', false);

  // Reproduce the audit's exact predecessor session (M4a: churn-hover on
  // #dropbtn with NO leave-earn, then STOP) before the M4c scenario.
  await navigate(); await startRecording();
  await evalPage(`window.__carouselOn = true; true`);
  const cd = await center('#dropbtn');
  await input('mouseMoved', { x: cd.x, y: cd.y }); await sleep(2000);
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(500);
  await evalPage(`window.__carouselOn = false; true`);
  await panelCmd(`chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })`);
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const active = await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active ?? null)()`).catch(() => null);
    if (active === false || active === null) break;
  }
  await sleep(2500);

  await runScenario('R2: reveal, churn ON', true);

  try { chrome.kill(); } catch {}
  try { httpServer.kill(); } catch {}
  process.exit(0);
}
main().catch((e) => { console.error('DIAG ERROR:', e); process.exit(2); });
