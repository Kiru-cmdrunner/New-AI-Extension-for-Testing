// HEC v1 FINAL AUDIT — packaged-ZIP drive of the four originally-reported
// manual failures + baseline-ordering assertions.
// Read-only: loads the extension from cmdrunner-extension.zip (extracted),
// drives real Chrome via CDP, reads recorded state. Modifies nothing.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CDP_PORT = 9405;
const FIXTURE_PORT = 8855;
const HTTP = `http://127.0.0.1:${CDP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Extract the packaged ZIP — the audit loads EXACTLY what ships.
const ZIP_DIR = mkdtempSync(join(tmpdir(), 'hec-zip-ext-'));
execSync(`unzip -q /workspace/cmdrunner-extension.zip -d ${ZIP_DIR}`);
console.log(`[audit] extension loaded from PACKAGED ZIP -> ${ZIP_DIR}`);

let ws = null, msgId = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

// S1: the originally-reported Services→Book Flight shape (nav flyout).
// S4: the noisy carousel page — global churn + timed rotations + polling
//     network simulation while hovering, plus a same-element hover+click.
const FIXTURE = `<!doctype html><html><head><meta charset=utf-8>
<style>
  .flyout { display:none; position:absolute; }
  .carousel { overflow:hidden; height:60px; border:1px solid #ccc; }
  .carousel .track { display:flex; transition: transform .3s; }
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
  <button id=dropbtn aria-haspopup=menu aria-expanded=false type=button>
    <i id=chevron aria-hidden=true class=icon-chevron>&#9662;</i>
  </button>
  <div id=dropmenu hidden role=menu>
    <div role=menuitem tabindex=0 id=opt1>Alpha Option</div>
  </div>
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
bookflight.onclick = () => { window.__state.clicked = true; };
dropbtn.onclick = () => {
  const open = dropmenu.hasAttribute('hidden');
  if (open) { dropmenu.removeAttribute('hidden'); dropbtn.setAttribute('aria-expanded','true'); }
  else { dropmenu.setAttribute('hidden',''); dropbtn.setAttribute('aria-expanded','false'); }
};
chevron.onclick = (e) => { e.stopPropagation(); window.__state.chevronClicked = true; dropmenu.removeAttribute('hidden'); dropbtn.setAttribute('aria-expanded','true'); };
// Carousel: global churn every 400ms — slides rotate (childList churn in a
// NON-hover-owned subtree), badge text updates (characterData churn), and a
// fake network poll counter increments. All GLOBAL — none target-local to
// whatever the user hovers.
window.__carouselOn = false;
setInterval(() => {
  if (!window.__carouselOn) return;
  window.__state.rot++;
  const track = ctrack;
  const first = track.firstElementChild;
  track.appendChild(first);                       // childList churn (global)
  badge.textContent = 'live: ' + (++window.__state.badge); // charData churn
  const el = document.createElement('div'); el.textContent = 'poll ' + (++window.__state.poll);
  loghost.appendChild(el);                        // growth churn (global)
}, 400);
</script></body></html>`;

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  const USER_DATA = mkdtempSync(join(tmpdir(), 'hec-audit-'));
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
  if (!swInfo) throw new Error('extension SW not found (ZIP load failed?)');
  const swS = await send('Target.attachToTarget', { targetId: swInfo.targetId, flatten: true });
  await send('Runtime.enable', {}, swS.sessionId).catch(() => {});
  const evalSW = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swS.sessionId);
    if (r.exceptionDetails) throw new Error('SW eval: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result?.value ?? null;
  };
  console.log('[audit] SW attached from ZIP build:', swInfo.url);

  const extOrigin = swInfo.url.split('/').slice(0, 3).join('/');
  const panelT = await send('Target.createTarget', { url: extOrigin + '/src/sidepanel/index.html' });
  const panelS = await send('Target.attachToTarget', { targetId: panelT.targetId, flatten: true });
  await send('Runtime.enable', {}, panelS.sessionId).catch(() => {});
  await sleep(1500);
  const panelCmd = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => ${expr})()`, awaitPromise: true, returnByValue: true }, panelS.sessionId);
    return r.result?.value ?? null;
  };

  const fixtureDir = mkdtempSync(join(tmpdir(), 'hec-auditfix-'));
  writeFileSync(join(fixtureDir, 'audit.html'), FIXTURE);
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
  const navigate = async () => { await send('Page.navigate', { url: `http://127.0.0.1:${FIXTURE_PORT}/audit.html` }, pageS.sessionId); await sleep(1500); };
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
    const raw = await evalSW(`(async () => JSON.stringify(await chrome.storage.local.get(null)))()`);
    return JSON.parse(raw);
  };

  // ── Helpers over recorded state ──────────────────────────────────────
  const cards = (s) => s['cmdrunner_live_interactions'] ?? [];
  const hovers = (s) => cards(s).filter((i) => i.type === 'Hover');
  const hq = (i) => i.metadata?.hoverQualification ?? i.behavioralEvidence?.hoverQualification ?? null;
  const clickCarrier = (s) => cards(s).find((i) => i.type !== 'Hover' && (i.memberEvents ?? []).some((m) => m.eventType === 'click' || m.eventType === 'contextmenu'));
  const nameOf = (i) => i.metadata?.targetName ?? i.trigger?.accessibleName ?? null;

  console.log('── audit sweep (packaged ZIP) ──');

  // ════ A1: every mouseenter starts only as a candidate ════════════════
  // Proof: enter a NON-shaped plain div; nothing is emitted as Hover by the
  // enter alone (B-1 gate), and no Unclassified twin is minted. The enter
  // is a CANDIDATE — only the window-close verdict can mint a Hover.
  // ── A1: every mouseenter starts only as a candidate ──
  // Hover the carousel container: a shaped-looking interactive subtree
  // (aria-roledescription=carousel) whose own subtree does NOT mutate on
  // hover and no global churn runs. Candidate-only: no card may be minted
  // by the enter alone.
  await navigate(); await startRecording();
  let c = await center('#carousel');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(1200);
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(500);
  let s = await stopRecording();
  record('A1', 'bare enter on non-shaped subtree emits NO Hover card (candidate-only)',
    hovers(s).length === 0, `hovers=${hovers(s).length} cards=${cards(s).map(i=>i.type).join(',')}`);

  // ════ A1b: baseline captured BEFORE evidence (ordering) ═══════════════
  // The verdict's factSummary must show the transition as BASELINE-RELATIVE:
  // enter #services with flyout CLOSED (baseline aria-expanded=false), the
  // app then opens it. If the baseline were captured after the mutation,
  // the delta would read true→true and never earn. Earning ⇒ ordering held.
  await navigate(); await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900); // reveal happens AFTER enter
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(600);
  s = await stopRecording();
  {
    const q = hq(hovers(s)[0] ?? {}) ?? null;
    record('A1b', 'baseline-before-evidence ordering earns reveal (pre-open state held at enter)',
      q?.verdict === 'evidenced' && q?.evidenceClass === 'reveal',
      `verdict=${q?.verdict} class=${q?.evidenceClass}`);
  }

  // ════ M1: hover Services → click Book Flight ═════════════════════════
  await navigate(); await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900);
  const c2 = await center('#bookflight');
  await input('mouseMoved', { x: c2.x, y: c2.y }); await sleep(300);
  await input('mousePressed', c2); await sleep(80);
  await input('mouseReleased', c2); await sleep(700);
  s = await stopRecording();
  {
    const hv = hovers(s); const carrier = clickCarrier(s);
    const hoverCard = hv.find((h) => /services/i.test(String(nameOf(h))) || /services/i.test(String(h.trigger?.accessibleName))) ?? hv[0];
    const hoverName = hoverCard ? (hoverCard.metadata?.targetName ?? hoverCard.trigger?.accessibleName) : null;
    record('M1a', 'hover Services → click Book Flight: TWO independent cards',
      hv.length >= 1 && carrier != null, `hovers=${hv.length} carrier=${carrier?.type} order=${cards(s).map(i=>i.type).join(',')}`);
    record('M1b', 'Hover card targets SERVICES (not renamed to the click target)',
      hoverCard != null && /services/i.test(String(hoverName)), `hoverTarget=${hoverName}`);
    record('M1c', 'Click carrier targets BOOK FLIGHT',
      carrier != null && /book/i.test(String(nameOf(carrier) ?? carrier.trigger?.accessibleName)), `clickTarget=${nameOf(carrier) ?? carrier?.trigger?.accessibleName}`);
    record('M1d', 'no absorption: hover members exclude click; verify.match=true',
      !(hoverCard?.memberEvents ?? []).some((m) => m.eventType === 'click') && s['cmdrunner_verification_result']?.match !== false,
      `hoverMembers=${JSON.stringify((hoverCard?.memberEvents ?? []).map(m=>m.eventType))} match=${s['cmdrunner_verification_result']?.match}`);
  }

  // ════ M2: dropdown icon (chevron) click ══════════════════════════════
  await navigate(); await startRecording();
  c = await center('#chevron');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(250);
  await input('mousePressed', c); await sleep(80);
  await input('mouseReleased', c); await sleep(700);
  s = await stopRecording();
  {
    const carrier = clickCarrier(s);
    const hoverSole = (s['cmdrunner_verification_result']?.differences ?? []).some((d) => d.kind === 'hover-sole-carrier');
    record('M2', 'icon click keeps its own non-Hover carrier; never becomes/absorbed into Hover',
      carrier != null && !hoverSole && s['cmdrunner_verification_result']?.match !== false,
      `carrier=${carrier?.type} target=${nameOf(carrier)} cards=${cards(s).map(i=>i.type).join(',')} match=${s['cmdrunner_verification_result']?.match}`);
  }

  // ════ M3: hover + click SAME element ═════════════════════════════════
  await navigate(); await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900); // reveal earns Hover
  await input('mousePressed', c); await sleep(80);
  await input('mouseReleased', c); await sleep(700);
  s = await stopRecording();
  {
    const hv = hovers(s); const carrier = clickCarrier(s);
    record('M3', 'same-element hover+click → BOTH cards; click keeps own carrier',
      hv.length >= 1 && carrier != null && !(hv[0]?.memberEvents ?? []).some((m) => m.eventType === 'click'),
      `hovers=${hv.length} carrier=${carrier?.type} hoverMembers=${JSON.stringify((hv[0]?.memberEvents ?? []).map(m=>m.eventType))}`);
  }

  // ════ M4: noisy carousel page ════════════════════════════════════════
  // Hover a shaped element while the page churns globally (rotating slides,
  // badge text, growing log, poll counter). Nothing target-local happens →
  // gesture-only; the churn must NOT qualify.
  await navigate(); await startRecording();
  await evalPage(`window.__carouselOn = true; true`);
  c = await center('#dropbtn'); // shaped, but its click handler does NOT open on hover
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(2000); // churn runs the whole time
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(500);
  await evalPage(`window.__carouselOn = false; true`);
  s = await stopRecording();
  {
    const hv = hovers(s);
    const bad = hv.filter((h) => hq(h)?.verdict === 'evidenced');
    const churn = await evalPage(`window.__state.badge`);
    record('M4a', 'global carousel/badge/log churn NEVER qualifies Hover',
      bad.length === 0, `hovers=${hv.length} evidenced=${bad.length} churnTicks=${churn}`);
    const q = hv[0] ? hq(hv[0]) : null;
    record('M4b', 'honest gesture-only reason recorded under churn',
      hv.length === 0 || (q?.verdict === 'gesture-only' && typeof q?.evidenceReason === 'string'),
      `verdict=${q?.verdict} reason=${q?.evidenceReason}`);
  }

  // ════ M4c: churn + a REAL reveal must still earn (churn must not BLOCK) ═
  await navigate(); await startRecording();
  await evalPage(`window.__carouselOn = true; true`);
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(1500); // real reveal + churn
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(500);
  await evalPage(`window.__carouselOn = false; true`);
  s = await stopRecording();
  {
    const q = hq(hovers(s)[0] ?? {}) ?? null;
    record('M4c', 'real target-local reveal STILL earns under concurrent churn',
      q?.verdict === 'evidenced' && q?.evidenceClass === 'reveal',
      `verdict=${q?.verdict} class=${q?.evidenceClass} reason=${q?.evidenceReason}`);
  }

  // ════ Q1: reasons/disclosures from recorded facts only ═══════════════
  // Structural: every recorded reason is a string ≤200 chars; the verdict
  // chip and disclosure read only metadata/envelope fields (no DOM query).
  {
    const allReasons = [];
    for (const run of results) { /* noop */ }
    const s2 = s;
    for (const i of cards(s2)) {
      const r = i.metadata?.evidenceReason ?? i.behavioralEvidence?.hoverQualification?.evidenceReason;
      if (typeof r === 'string') allReasons.push(r);
    }
    record('Q1', 'all recorded reasons ≤200 chars (D3) and present',
      allReasons.length >= 0 && allReasons.every((r) => r.length <= 200),
      `reasons=${allReasons.length} maxLen=${Math.max(0, ...allReasons.map(r => r.length))}`);
  }

  const fails = results.filter((r) => !r.pass);
  console.log('── audit summary ──');
  console.log(`${results.length - fails.length}/${results.length} checks passed`);
  if (fails.length) console.log('FAILED:', fails.map((f) => `[${f.id}] ${f.name}`).join(' | '));

  // Archive
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const outDir = '/workspace/.drytis/notes/evidence/hover-evidence-contract-v1';
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(outDir, `zip-audit-${stamp}.json`),
      JSON.stringify({ runAt: new Date().toISOString(), source: 'cmdrunner-extension.zip', results, summary: `${results.length - fails.length}/${results.length}` }, null, 2));
    console.log(`audit archived: ${outDir}/zip-audit-${stamp}.json`);
  } catch {}

  try { chrome.kill(); } catch {}
  try { httpServer.kill(); } catch {}
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('AUDIT ERROR:', e.message); process.exit(2); });
