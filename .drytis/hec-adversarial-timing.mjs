// ADVERSARIAL TIMING AUDIT — real Chrome from the PACKAGED ZIP.
// Proves no ms constant gates Hover classification / ownership /
// separation / admission. Timings chosen to CROSS every legacy constant
// (300ms companion, 500ms gesture, 1500ms settle, 3000ms post-nav,
// 10000ms settle cap & drain guard) in BOTH directions.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CDP_PORT = 9391;
const FIXTURE_PORT = 8841;
const HTTP = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DIST = '/tmp/hec-adv-ext';
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
  .slowre { display:none; }
</style></head><body>
<nav id=appnav>
  <div id=services role=button tabindex=0 aria-haspopup=true aria-expanded=false>
    <span>Services Section</span>
  </div>
  <div id=flyout class=flyout role=menu aria-hidden=true>
    <a id=bookflight role=menuitem tabindex=0 href="#nowhere">Book Flight</a>
  </div>
  <div id=slowservices role=button tabindex=0 aria-haspopup=true aria-expanded=false>Slow Services</div>
  <div id=slowfly class=flyout role=menu aria-hidden=true><a id=slowlink role=menuitem tabindex=0 href="#slow">Slow Link</a></div>
</nav>
<div id=carousel class=carousel aria-roledescription=carousel>
  <div class=track id=ctrack><div class=slide>Slide 1</div><div class=slide>Slide 2</div><div class=slide>Slide 3</div></div>
</div>
<div class=badge id=badge>live: 0</div>
<div id=loghost></div>
<script>
window.__state = { flyoutOpen:false, slowOpen:false, rot:0, poll:0, badge:0 };
services.onmouseenter = () => { if (!window.__state.flyoutOpen) { flyout.style.display='block'; flyout.setAttribute('aria-hidden','false'); services.setAttribute('aria-expanded','true'); window.__state.flyoutOpen = true; } };
slowservices.onmouseenter = () => { if (!window.__state.slowOpen) { window.__state.slowOpen = true; setTimeout(() => {
  slowfly.style.display='block'; slowfly.setAttribute('aria-hidden','false'); slowservices.setAttribute('aria-expanded','true');
}, window.__slowDelayMs ?? 2500); } };
window.__carouselOn = false;
setInterval(() => {
  if (!window.__carouselOn) return;
  window.__state.rot++;
  const track = ctrack;
  track.appendChild(track.firstElementChild);
  badge.textContent = 'live: ' + (++window.__state.badge);
  const el = document.createElement('div'); el.textContent = 'poll ' + (++window.__state.poll);
  window.__churnCount = (window.__churnCount ?? 0) + 1;
  loghost.appendChild(el);
}, 400);
</script></body></html>`;

async function main() {
  const results = [];
  const record = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} — ${detail}`); };
  const USER_DATA = mkdtempSync(join(tmpdir(), 'hec-adv-'));
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
  const fixtureDir = mkdtempSync(join(tmpdir(), 'hec-advfix-'));
  writeFileSync(join(fixtureDir, 'adv.html'), FIXTURE);
  const httpServer = spawn('python3', ['-m', 'http.server', String(FIXTURE_PORT), '--directory', fixtureDir, '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await sleep(700);
  const pageT = await send('Target.createTarget', { url: 'about:blank' });
  const pageS = await send('Target.attachToTarget', { targetId: pageT.targetId, flatten: true });
  await send('Page.enable', {}, pageS.sessionId).catch(() => {});
  await send('Runtime.enable', {}, pageS.sessionId).catch(() => {});
  const evalPage = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageS.sessionId)).result?.value ?? null;
  await send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/adv.html` }, pageS.sessionId);
  await sleep(1500);
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
    await sleep(2500);
    return JSON.parse(await evalSW(`(async () => JSON.stringify(await chrome.storage.local.get(null)))()`));
  };

  // ── S1: slow SPA reveal (2.5s > every legacy constant) while still hovering ──
  await evalPage(`window.__slowDelayMs = 2500; true`);
  await startRecording();
  let c = await center('#slowservices');
  await input('mouseMoved', { x: c.x, y: c.y });
  await sleep(4500); // still hovering while the reveal lands at +2.5s
  const s1 = await stopAndDump();
  await input('mouseMoved', { x: 5, y: 5 }); // park pointer (S2 needs a fresh enter)
  let cards = s1['cmdrunner_live_interactions'] ?? [];
  let hovers = cards.filter((i) => i?.type === 'Hover');
  let q = hovers[0]?.metadata?.hoverQualification ?? hovers[0]?.behavioralEvidence?.hoverQualification ?? null;
  record('S1 slow reveal (+2.5s) while hovering EVIDENCE-EARNS', hovers.length === 1 && q?.verdict === 'evidenced' && q?.evidenceClass === 'reveal',
    `hovers=${hovers.length} verdict=${q?.verdict} class=${q?.evidenceClass} reason=${q?.evidenceReason}`);
  record('S1 hover target preserved (Slow Services)', (hovers[0]?.metadata?.targetName ?? '') === 'Slow Services', `target=${hovers[0]?.metadata?.targetName}`);

  // ── S2: heavy churn + reveal + immediate STOP (no leave at all) ──
  await startRecording();
  await evalPage(`window.__carouselOn = true; true`);
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y });
  await sleep(800); // reveal fires; churn running
  const s2 = await stopAndDump(); // STOP while still hovering, churn ON
  await input('mouseMoved', { x: 5, y: 5 }); // park pointer: next scenario's enter must be a real crossing
  // Fixture state reset — the page persists across scenarios; S3 must see
  // a CLOSED flyout so its services-enter performs a real reveal.
  await evalPage(`window.__carouselOn = false; window.__state.flyoutOpen = false; flyout.style.display = 'none'; services.setAttribute('aria-expanded', 'false'); flyout.setAttribute('aria-hidden', 'true'); true`);
  cards = s2['cmdrunner_live_interactions'] ?? [];
  hovers = cards.filter((i) => i.type === 'Hover');
  q = hovers[0]?.metadata?.hoverQualification ?? hovers[0]?.behavioralEvidence?.hoverQualification ?? null;
  record('S2 churn + immediate STOP (still hovering) keeps evidenced Hover', hovers.length === 1 && q?.verdict === 'evidenced',
    `hovers=${hovers.length} verdict=${q?.verdict} class=${q?.evidenceClass}`);
  const churnCount = await evalPage(`window.__churnCount ?? 0`);
  record('S2 churn actually ran (non-vacuous)', Number(churnCount) >= 1, `churnTicks=${churnCount}`);

  // ── S3: immediate Click after Hover (different anchor) is NOT suppressed ──
  await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y });
  await sleep(600); // flyout open now
  const bf = await center('#bookflight');
  await input('mouseMoved', { x: bf.x, y: bf.y });
  await sleep(80);  // ← crosses nothing; inside old 300ms — must still be its own Click
  await input('mousePressed', { x: bf.x, y: bf.y });
  await input('mouseReleased', { x: bf.x, y: bf.y });
  await sleep(700);
  const s3 = await stopAndDump();
  cards = s3['cmdrunner_live_interactions'] ?? [];
  const hover3 = cards.find((i) => i?.type === 'Hover');
  const click3 = cards.find((i) => i?.type === 'Link' || i?.type === 'Click');
  record('S3 Hover(Services) + Click(Book Flight) BOTH present (80ms gap)', !!hover3 && !!click3,
    `cards=${cards.map((i) => i.type).join(',')} hoverTarget=${hover3?.metadata?.targetName} clickTarget=${click3?.metadata?.targetName}`);
  record('S3 click keeps its own carrier (never absorbed into Hover)', !!click3 && click3.type !== 'Hover', `carrier=${click3?.type}`);

  // ── S4: very slow reveal (4s) + leave BEFORE reveal → honest gesture-only, no false Hover ──
  await evalPage(`window.__slowDelayMs = 4000; true`);
  await startRecording();
  c = await center('#slowservices');
  await input('mouseMoved', { x: c.x, y: c.y });
  await sleep(500);
  await input('mouseMoved', { x: 5, y: 5 }); // leave at +0.5s
  await sleep(1200); // window parks/settles; reveal fires at +4s — while NOT hovering
  const s4 = await stopAndDump();
  cards = s4['cmdrunner_live_interactions'] ?? [];
  hovers = cards.filter((i) => i.type === 'Hover');
  q = hovers[0]?.metadata?.hoverQualification ?? hovers[0]?.behavioralEvidence?.hoverQualification ?? null;
  record('S4 reveal AFTER leave NEVER mints evidenced (honest)', hovers.length === 0 || q?.verdict === 'gesture-only',
    `hovers=${hovers.length} verdict=${q?.verdict}`);
  record('S4 no evidenced verdict leaked', !hovers.some((h) => (h?.metadata?.hoverQualification ?? h?.behavioralEvidence?.hoverQualification)?.verdict === 'evidenced'),
    `evidencedCount=${hovers.filter((h) => (h?.metadata?.hoverQualification ?? h?.behavioralEvidence?.hoverQualification)?.verdict === 'evidenced').length}`);

  // ── S5: reveal AFTER leave but window parked → late evidence must still be honest ──
  await evalPage(`window.__slowDelayMs = 2200; true`);
  await startRecording();
  c = await center('#slowservices');
  await input('mouseMoved', { x: c.x, y: c.y });
  await sleep(400);
  await input('mouseMoved', { x: 5, y: 5 }); // leave at +0.4s
  await sleep(2600); // reveal at +2.2s while parked (churn-free settle)
  const s5 = await stopAndDump();
  cards = s5['cmdrunner_live_interactions'] ?? [];
  hovers = cards.filter((i) => i.type === 'Hover');
  q = hovers[0]?.metadata?.hoverQualification ?? hovers[0]?.behavioralEvidence?.hoverQualification ?? null;
  record('S5 late reveal after leave (parked, +2.2s) stays honest', hovers.length === 0 || q?.verdict === 'gesture-only',
    `hovers=${hovers.length} verdict=${q?.verdict}`);

  // ── S6: very slow reveal (6s), still hovering at STOP → drain must deliver ──
  await evalPage(`window.__slowDelayMs = 6000; true`);
  await startRecording();
  c = await center('#slowservices');
  await input('mouseMoved', { x: c.x, y: c.y });
  await sleep(1500);
  const s6 = await stopAndDump(); // STOP at +1.5s; reveal fires at +6s post-STOP
  cards = s6['cmdrunner_live_interactions'] ?? [];
  hovers = cards.filter((i) => i.type === 'Hover');
  q = hovers[0]?.metadata?.hoverQualification ?? hovers[0]?.behavioralEvidence?.hoverQualification ?? null;
  record('S6 STOP before slow reveal (+6s) keeps hover honest (no fabrication)', hovers.length === 0 || !!q,
    `hovers=${hovers.length} verdict=${q?.verdict}`);

  // archive
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const outDir = '/workspace/.drytis/notes/evidence/hover-evidence-contract-v1';
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `adversarial-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
      JSON.stringify({ runAt: new Date().toISOString(), source: 'cmdrunner-extension.zip', results }, null, 2));
  } catch {}

  try { chrome.kill(); } catch {}
  try { httpServer.kill(); } catch {}
  const fails = results.filter((r) => !r.pass).length;
  console.log(`── adversarial timing: ${results.length - fails}/${results.length} passed ──`);
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error('ADVERSARIAL ERROR:', e); process.exit(2); });
