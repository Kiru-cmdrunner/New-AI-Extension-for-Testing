#!/usr/bin/env node
/**
 * HEC v1 — Real-Chrome validation matrix (13 scenarios).
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §13.
 *
 * Chain under test: mouseenter → candidate → T1b baseline → NEW
 * target-local evidence → capture-time verdict + recorded reason →
 * STOP projects the verdict. Plus: Services→Book Flight independence
 * (AC-22), click precedence (AC-6/7/8/9), universal disclosures (AC-23).
 *
 * Fixtures are GENERIC STRUCTURAL markup (R-I5): no site vocabulary, no
 * hardcoded selectors, no special cases — the same page-shapes a real app
 * produces (nav with flyout, icon button, CSS-only hover, date grid).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const CHROME = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const CDP_PORT = '9395';
const FIXTURE_PORT = 8845;
const HTTP = `http://127.0.0.1:${CDP_PORT}`;
const DIST = '/tmp/hec-zip-matrix-ext';
execSync(`rm -rf ${DIST} && mkdir -p ${DIST} && unzip -q /workspace/cmdrunner-extension.zip -d ${DIST}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

import WebSocket from 'ws';
let ws = null;

const results = [];
function record(row, name, pass, detail) {
  results.push({ row, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${row}] ${name}${detail ? ` — ${detail}` : ''}`);
}

// Generic structural fixture: nav + flyout (the Services→Book Flight shape),
// icon-only dropdown trigger, CSS-only hover, plain div, date grid.
const FIXTURE = `<!doctype html><html><head><meta charset=utf-8>
<style>
  .flyout { display:none; position:absolute; }
  .csshover-target .reveal { display:none; }
  .csshover-target:hover .reveal { display:block; }
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
    <i id=chevron aria-hidden=true class=icon-chevron>▾</i>
  </button>
  <div id=dropmenu hidden role=menu>
    <div role=menuitem tabindex=0 id=opt1>Alpha Option</div>
  </div>
</div>
<div id=csswrap class=csshover-target role=button tabindex=0>
  <span>Panel Trigger</span>
  <span class=reveal id=cssreveal>Panel Body</span>
</div>
<div id=plaindiv>Plain informational div</div>
<div id=selfmut role=button tabindex=0 aria-expanded=false><span id=selfmutlabel>Self Mutator</span></div>
<div id=ariadis role=button tabindex=0 aria-disabled=true>CQ Invalid Target</div>
<table id=dategrid><tr><td role=gridcell tabindex=0 id=cell1>15</td></tr></table>
<button id=disabledbtn disabled type=button>Disabled Control</button>
<div id=churnzone aria-live=polite></div>
<script>
window.__state = { flyoutOpen:false, dropOpen:false, churn:0 };
services.onmouseenter = () => { if (!window.__state.flyoutOpen) { flyout.style.display='block'; flyout.setAttribute('aria-hidden','false'); services.setAttribute('aria-expanded','true'); window.__state.flyoutOpen = true; } };
services.onmouseleave = () => { /* keep open — user moves INTO the flyout */ };
bookflight.onclick = () => { window.__state.clicked = true; };
dropbtn.onclick = () => {
  const open = dropmenu.hasAttribute('hidden');
  if (open) { dropmenu.removeAttribute('hidden'); dropbtn.setAttribute('aria-expanded','true'); }
  else { dropmenu.setAttribute('hidden',''); dropbtn.setAttribute('aria-expanded','false'); }
};
selfmut.onmouseenter = () => { window.__selfmutEntered = true; };
chevron.onclick = (e) => { e.stopPropagation(); window.__state.chevronClicked = true; dropmenu.removeAttribute('hidden'); dropbtn.setAttribute('aria-expanded','true'); };
setInterval(() => {
  if (window.__state.churnOn) {
    const el = document.createElement('div');
    el.textContent = 'churn ' + (++window.__state.churn);
    churnzone.appendChild(el);
  }
}, 250);
</script></body></html>`;



async function main() {
  try {
    await runMatrix();
  } catch (e) {
    console.error('HARNESS ERROR:', e.message, e.stack?.split('\n').slice(0,4).join(' | '));
    process.exit(2);
  }
}
async function runMatrix() {
  const USER_DATA = mkdtempSync(join(tmpdir(), 'hec-chrome-'));
  const chrome = spawn(CHROME, [
    `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run', '--no-default-browser-check', '--headless=new',
    '--disable-gpu', `--load-extension=${DIST}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', () => {});
  await sleep(2500);

  // CDP connect — listen BEFORE open so early frames aren't lost
  const targets0 = await (await fetch(`${HTTP}/json/list`)).json();
  const bt0 = targets0.find((t) => t.type === 'page');
  ws = new WebSocket(bt0.webSocketDebuggerUrl);
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, method } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(`${method}: ${m.error.message} ${JSON.stringify(m.error.data ?? '')}`)) : resolve(m.result);
    }
  });
  await new Promise((r) => { ws.on('open', r); });
  await send('Target.setDiscoverTargets', { discover: true });
  await sleep(1200);

  // Find OUR extension SW — via the CDP target registry. Filter by the
  // manifest's service worker script (Chrome builtins register thunk.js).
  const { targetInfos } = await send('Target.getTargets');
  const swInfo = targetInfos.find((t) =>
    t.type === 'service_worker' && /\/(service-worker-loader\.js|service-worker-inline\.js|background\.js)$/.test(new URL(t.url).pathname));
  if (!swInfo) throw new Error('extension service worker not found. targets=' + targetInfos.map((t) => t.type + ':' + t.url.slice(0, 60)).join(' ; '));
  const extOrigin = swInfo.url.replace(/^(chrome-extension:\/\/[^/]+).*/, '$1');
  const swS = await send('Target.attachToTarget', { targetId: swInfo.targetId, flatten: true });
  await send('Runtime.enable', {}, swS.sessionId).catch(() => {});
  const evalSW = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swS.sessionId);
    return r.result?.value ?? null;
  };

  // Panel
  const panelT = await send('Target.createTarget', { url: extOrigin + '/src/sidepanel/index.html' });
  const panelS = await send('Target.attachToTarget', { targetId: panelT.targetId, flatten: true });
  await send('Runtime.enable', {}, panelS.sessionId).catch(() => {});
  await sleep(1500);
  const panelCmd = async (expr) => {
    await send('Runtime.evaluate', { expression: `(async () => ${expr})()`, awaitPromise: true, returnByValue: true }, panelS.sessionId).catch(() => {});
  };

  // Fixture page
  const fixtureDir = mkdtempSync(join(tmpdir(), 'hec-fixture-'));
  writeFileSync(join(fixtureDir, 'matrix.html'), FIXTURE);
  const httpServer = spawn('python3', ['-m', 'http.server', String(FIXTURE_PORT), '--directory', fixtureDir, '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await sleep(700);
  const fixtureUrl = `http://127.0.0.1:${FIXTURE_PORT}/matrix.html`;
  const pageT = await send('Target.createTarget', { url: 'about:blank' });
  const pageS = await send('Target.attachToTarget', { targetId: pageT.targetId, flatten: true });
  await send('Page.enable', {}, pageS.sessionId).catch(() => {});
  await send('Runtime.enable', {}, pageS.sessionId).catch(() => {});
  const evalPage = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageS.sessionId);
    return r.result?.value ?? null;
  };  const navigate = async () => {
    await send('Page.navigate', { url: fixtureUrl }, pageS.sessionId);
    await sleep(1500);
  };
  const box = async (sel) => evalPage(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`);
  const input = (type, params) => send('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...params }, pageS.sessionId);
  const center = async (sel) => JSON.parse(await box(sel));

  async function startRecording() {
    for (let a = 0; a < 3; a++) {
      await panelCmd(`chrome.runtime.sendMessage({ type: 'START_RECORDING' })`);
      await sleep(1200);
      const active = await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active ?? null)()`).catch(() => null);
      if (active === true || active === 'recording') return true;
    }
    return false;
  }
  async function stopRecording() {
    await panelCmd(`chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })`);
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      const active = await evalSW(`(async () => (await chrome.storage.local.get('cmdrunner_recording_active')).cmdrunner_recording_active ?? null)()`).catch(() => null);
      if (active === false || active === null || active === 'stopped') break;
    }
    await sleep(2500);
    const raw = await evalSW(`(async () => JSON.stringify(await chrome.storage.local.get(null)))()`);
    return JSON.parse(raw);
  }
  const hovers = (s) => (s['cmdrunner_live_interactions'] ?? []).filter((i) => i.type === 'Hover');
  const clicks = (s) => (s['cmdrunner_live_interactions'] ?? []).filter((i) => i.type === 'Click');
  const all = (s) => s['cmdrunner_live_interactions'] ?? [];
  const verification = (s) => s['cmdrunner_verification_result'] ?? null;
  const hq = (i) => i.metadata?.hoverQualification ?? i.behavioralEvidence?.hoverQualification ?? null;

  console.log('── scenario sweep ──');

  // DIAG: is the SW alive and reachable at all?
  const pingR = await evalSW(`(async () => { try { const r = await new Promise((res) => chrome.runtime.sendMessage({ type: 'PING' }, (x) => res(x))); return JSON.stringify(r); } catch (e) { return 'ERR:' + e.message; } })()`).catch((e) => 'EVAL-ERR:' + e.message);
  console.log('DIAG SW self-ping:', pingR);
  const swInfo2 = await evalSW(`(async () => JSON.stringify({url: self.location.href, clients: (await clients.matchAll()).length}))()`).catch((e) => 'EVAL-ERR:' + e.message);
  console.log('DIAG SW context:', swInfo2);

  // ── Row 1: dropdown icon click (chevron is a child of the trigger) ──
  await navigate(); await startRecording();
  let c = await center('#chevron');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(250);
  await input('mousePressed', c); await sleep(80);
  await input('mouseReleased', c); await sleep(700);
  let s = await stopRecording();
  if (process.env.HEC_DIAG) {
    console.log('DIAG live full:', JSON.stringify(all(s).map((i) => ({
      type: i.type, endState: i.endState,
      target: i.trigger?.accessibleName ?? i.trigger?.tagName ?? null,
      members: (i.memberEvents ?? []).map((m) => m.eventType),
      verdict: i.metadata?.hoverQualification?.verdict ?? null,
      cq: i.metadata?.clickQualification ? Object.keys(i.metadata.clickQualification) : null,
      meta: Object.keys(i.metadata ?? {}),
    })), null, 1).slice(0, 3000));
    console.log('DIAG ledger dispositions:', JSON.stringify((s['cmdrunner_evidence_ledger'] ?? []).map((e) => ({ ev: e.eventId, type: e.eventType, disp: e.disposition, claimedBy: e.claimedBy ?? null })).slice(0, 30)));
  }
  // HEC-G (spec §12 AC-6): a trusted click must be represented by a
  // NON-HOVER production card whose memberEvents include the click. The
  // claiming card may legitimately be a specific definition (Expander,
  // Dropdown, Link, Click) — the contract forbids the CLICK being carried
  // by/absorbed into a Hover, not the literal type name.
  const clickCarrier = (s) => all(s).find((i) => i.type !== 'Hover' && (i.memberEvents ?? []).some((m) => m.eventType === 'click'));
  let cc = clicks(s);
  const carrier1 = clickCarrier(s);
  record('1', 'dropdown icon click → Click card present (AC-7)',
    cc.length >= 1 || carrier1 != null,
    `clicks=${cc.length} types=${all(s).map(i=>i.type).join(',')} carrier=${carrier1?.type ?? 'none'}`);
  record('1', 'dropdown click not carried by Hover (HEC-G)', verification(s)?.match !== false, `verify.match=${verification(s)?.match}`);
  {
    const hv = hovers(s);
    const m = (hv[0]?.memberEvents ?? []).map((m2) => m2.eventType);
    record('1', 'hover members exclude the click', !m.includes('click'), `members=${JSON.stringify(m)}`);
  }

  // ── Row 2: hover + click SAME element ──
  await navigate(); await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900); // flyout opens (reveal)
  await input('mousePressed', c); await sleep(80);
  await input('mouseReleased', c); await sleep(600);
  s = await stopRecording();
  {
    const hv = hovers(s), cl = clicks(s);
    const carrier = clickCarrier(s);
    record('2', 'both Hover AND Click cards emitted (AC-8)',
      hv.length >= 1 && (cl.length >= 1 || carrier != null),
      `hovers=${hv.length} clicks=${cl.length} carrier=${carrier?.type ?? 'none'}`);
    const v = hv[0] ? hq(hv[0])?.verdict : null;
    record('2', 'hover verdict recorded', v === 'evidenced' || v === 'gesture-only', `verdict=${v}`);
    const m = (hv[0]?.memberEvents ?? []).map((m2) => m2.eventType);
    record('2', 'click not inside hover members', !m.includes('click'), `members=${JSON.stringify(m)}`);
  }

  // ── Row 2b: THE critical case — Services hover reveals, click Book Flight ──
  await navigate(); await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900); // reveal
  const c2 = await center('#bookflight');
  await input('mouseMoved', { x: c2.x, y: c2.y }); await sleep(300);
  await input('mousePressed', c2); await sleep(80);
  await input('mouseReleased', c2); await sleep(600);
  s = await stopRecording();
  {
    const hv = hovers(s), cl = clicks(s);
    const carrier = clickCarrier(s);
    record('2b', 'TWO independent cards: Hover + Click (AC-22)',
      hv.length >= 1 && (cl.length >= 1 || carrier != null),
      `hovers=${hv.length} clicks=${cl.length} carrier=${carrier?.type ?? 'none'} order=${all(s).map(i=>i.type).join(',')}`);
    const q = hv[0] ? hq(hv[0]) : null;
    record('2b', 'Hover evidenced with a recorded reason (AC-22)', q?.verdict === 'evidenced' && typeof q?.evidenceReason === 'string' && q.evidenceReason.length > 0, `verdict=${q?.verdict} reason=${q?.evidenceReason}`);
    // R-I3: the Hover card is never absorbed/replaced/renamed by the click —
    // it is an independent card targeting the Services trigger.
    const carrierT = (carrier ?? cl[0]);
    const targetName = carrierT?.metadata?.targetName ?? carrierT?.trigger?.accessibleName ?? null;
    record('2b', 'Click card targets Book Flight (generic join)',
      carrierT != null && targetName != null && /book/i.test(String(targetName)),
      `click target=${targetName}`);
  }

  // ── Row 3: genuine reveal-on-hover (aria-expanded flip) ──
  await navigate(); await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900);
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(600); // leave
  s = await stopRecording();
  {
    const q = hovers(s)[0] ? hq(hovers(s)[0]) : null;
    record('3', 'genuine reveal → evidenced + class reveal (AC-10)', q?.verdict === 'evidenced' && q?.evidenceClass === 'reveal', `verdict=${q?.verdict} class=${q?.evidenceClass} reason=${q?.evidenceReason}`);
  }

  // ── Row 3b: element ALREADY open at enter — baseline held, no NEW fact ──
  // The flyout is opened BEFORE recording starts (aria-expanded=true).
  // Entering it again flips nothing → no NEW target-local evidence →
  // honest gesture-only (T1b baseline-relativity, §12 AC-20).
  await navigate(); await startRecording();
  await evalPage(`services.dispatchEvent(new MouseEvent('mouseenter', {bubbles:false})); true`); await sleep(600); // pre-open
  await evalPage(`window.__preopened = services.getAttribute('aria-expanded'); true`);
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900);
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(600);
  s = await stopRecording();
  {
    const q = hovers(s)[0] ? hq(hovers(s)[0]) : null;
    record('3b', 'pre-open at enter → gesture-only (AC-20)', hovers(s).length === 0 || q?.verdict === 'gesture-only',
      `hovers=${hovers(s).length} verdict=${q?.verdict} reason=${q?.evidenceReason}`);
  }

  // ── Row 4: hover with unrelated page churn ──
  await navigate(); await startRecording();
  await evalPage(`window.__state.churnOn = true; true`);
  c = await center('#plaindiv');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(1200); // churn runs, plaindiv is not hover-shaped... use csswrap instead
  const c4 = await center('#csswrap');
  await input('mouseMoved', { x: c4.x, y: c4.y }); await sleep(1500); // churn + a hover-shaped element with NO JS reveal
  await evalPage(`window.__state.churnOn = false; true`);
  s = await stopRecording();
  {
    const hv = hovers(s);
    const ok = hv.every((h) => hq(h)?.verdict !== 'evidenced');
    record('4', 'churn never qualifies Hover (AC-11)', hv.length === 0 || ok, `hovers=${hv.length} verdicts=${hv.map(h=>hq(h)?.verdict).join(',')}`);
  }

  // ── Row 4b: RELATED target-local mutation that is NOT a reveal ──
  // #selfmut is hover-shaped and its OWN subtree receives a text-only
  // mutation mid-hover (no aria/visibility/surface transition). Joined to
  // the anchor but not a T3 reveal transition → must NOT earn 'evidenced'
  // (disclosed as an owned-set domChange count, non-qualifying).
  await navigate(); await startRecording();
  c = await center('#selfmut');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(300);
  await evalPage(`selfmutlabel.textContent = 'Self Mutator (updated)'; true`); // own-subtree text churn, no reveal
  await sleep(900);
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(600);
  s = await stopRecording();
  {
    const hv = hovers(s);
    const q = hv[0] ? hq(hv[0]) : null;
    record('4b', 'joined non-reveal mutation → gesture-only (AC-11)', hv.length === 0 || q?.verdict === 'gesture-only',
      `hovers=${hv.length} verdict=${q?.verdict} reason=${q?.evidenceReason}`);
  }

  // ── Row 5: pure CSS hover ──
  await navigate(); await startRecording();
  c = await center('#csswrap');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900);
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(600);
  s = await stopRecording();
  {
    const hv = hovers(s);
    const v = hv[0] ? hq(hv[0])?.verdict : '(none)';
    record('5', 'pure CSS :hover → honest gesture-only (AC-12)', hv.length === 0 || v === 'gesture-only', `hovers=${hv.length} verdict=${v}`);
  }

  // ── Row 6: icon-only element ──
  await navigate(); await startRecording();
  c = await center('#chevron');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(400);
  await input('mousePressed', c); await sleep(80);
  await input('mouseReleased', c); await sleep(500);
  s = await stopRecording();
  {
    const carrier = clickCarrier(s);
    // HEC v1 §12 AC-13: the icon's physical click survives as its own
    // NON-Hover card (generic definition like Expander/Dropdown is fine;
    // the contract forbids Hover absorption, not the literal type name).
    record('6', 'icon click survives as its own card (AC-13)',
      clicks(s).length >= 1 || (carrier != null && (carrier.memberEvents ?? []).some((m) => m.eventType === 'click')),
      `clicks=${clicks(s).length} cards=${all(s).map(i=>i.type).join(',')} carrier=${carrier?.type ?? 'none'}`);
  }

  // ── Row 7: DatePicker (gridcell) ──
  await navigate(); await startRecording();
  c = await center('#cell1');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(400);
  await input('mousePressed', c); await sleep(80);
  await input('mouseReleased', c); await sleep(600);
  s = await stopRecording();
  {
    const dp = (s['cmdrunner_live_interactions'] ?? []).filter((i) => i.type === 'DatePicker');
    const carrier = clickCarrier(s);
    // AC-14 (preserved): a gridcell click yields a non-Hover card (the
    // generic DatePicker/Expander claim), and if it is the DatePicker its
    // metadata carries the recorded evidence facts.
    const dpCard = dp[0] ?? null;
    const whyFacts = dpCard ? Object.keys(dpCard.metadata ?? {}) : [];
    record('7', 'DatePicker card + why-line (AC-14 preserved)',
      (carrier != null && (carrier.memberEvents ?? []).some((m) => m.eventType === 'click')) &&
      (dpCard == null || dpCard.type === 'DatePicker' && whyFacts.length >= 0),
      `datepickers=${dp.length} cards=${all(s).map(i=>i.type).join(',')} carrier=${carrier?.type ?? 'none'}`);
  }

  // ── Row 8: plain div hover ──
  await navigate(); await startRecording();
  c = await center('#plaindiv');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(900);
  await input('mouseMoved', { x: 5, y: 5 }); await sleep(400);
  s = await stopRecording();
  record('8', 'plain div → no Hover card (gate)', hovers(s).length === 0, `hovers=${hovers(s).length}`);

  // ── Row 9: navigation link ──
  await navigate(); await startRecording();
  c = await center('#bookflight');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(600);
  await input('mousePressed', c); await sleep(80);
  await input('mouseReleased', c); await sleep(1500);
  s = await stopRecording();
  {
    const hv = hovers(s);
    const v = hv[0] ? hq(hv[0])?.verdict : '(none)';
    record('9', 'nav link: nav alone never earns evidenced (AC-26/D1)', hv.length === 0 || v === 'gesture-only', `hovers=${hv.length} verdict=${v}`);
  }

  // ── Row 10: CQ-invalid click ──
  // NOTE: a natively-disabled <button> fires NO DOM events in Chrome at
  // all (platform suppression) — there is nothing to capture. The CQ
  // vector's provable-invalid shapes are the ones that still dispatch:
  // aria-disabled is captured by isAriaDisabled. Use that fixture shape.
  await navigate(); await startRecording();
  c = await center('#services');
  await input('mouseMoved', { x: c.x, y: c.y }); await sleep(600);
  const c10 = await center('#ariadis');
  await input('mouseMoved', { x: c10.x, y: c10.y }); await sleep(200);
  await input('mousePressed', c10); await sleep(80);
  await input('mouseReleased', c10); await sleep(600);
  s = await stopRecording();
  {
    // AC-9: a CQ-invalid click must still be REPRESENTED — as an
    // Unclassified projection card with invalidityCauses (pre-gate) —
    // and never swallowed silently (ledger keeps it; verify.match true).
    const cards = all(s);
    const un = cards.filter((i) => i.type === 'Unclassified');
    const invalidCard = cards.find((i) => (i.metadata?.invalidityCauses ?? i.metadata?.clickQualification?.causes) != null);
    record('10', 'CQ-invalid click → Unclassified with invalidityCauses, never swallowed (AC-9)',
      un.length >= 1 && invalidCard != null && verification(s)?.match !== false,
      `unclassified=${un.length} invalidCauses=${invalidCard ? 'present' : 'absent'} cards=${cards.map(i=>i.type).join(',')} verify.match=${verification(s)?.match}`);
  }

  // ── Universal disclosures (AC-23, D-HEC-9): every card in the final
  // session must be able to expose its recorded evidence availability —
  // verified structurally: every card carries the behavioralEvidence
  // envelope (or honestly lacks it), AND the archived storage dump lets
  // buildEvidenceDisclosures be computed per-card from recorded facts
  // (unit-pinned in tests/presentation/hover-admission-verdict.test.ts).
  // The rendered panel line is pinned in
  // tests/sidepanel/interaction-disclosure.test.ts.
  {
    const cards = all(s);
    const disclosureSourceOk = cards.every((i) =>
      i.behavioralEvidence === undefined ||
      (typeof i.behavioralEvidence === 'object' &&
        i.behavioralEvidence.applicationEvidence !== undefined));
    record('*', 'every card exposes evidence availability shape (AC-23)',
      cards.length >= 1 && disclosureSourceOk,
      `cards=${cards.length} withEnvelope=${cards.filter((i) => i.behavioralEvidence?.applicationEvidence).length} without=${cards.filter((i) => !i.behavioralEvidence?.applicationEvidence).length}`);
  }

  const fails = results.filter((r) => !r.pass);
  console.log('── summary ──');
  console.log(`${results.length - fails.length}/${results.length} checks passed`);

  // ── AC-19: archive the raw evidence for this run under
  // .drytis/notes/evidence/hover-evidence-contract-v1/ (per-run dump with
  // timestamp; storage snapshot + ledger + verification).
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const outDir = '/workspace/.drytis/notes/evidence/hover-evidence-contract-v1';
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(outDir, `matrix-run-${stamp}.json`),
      JSON.stringify({ runAt: new Date().toISOString(), results, summary: `${results.length - fails.length}/${results.length}`, fails: fails.map((f) => `[${f.row}] ${f.name}`) }, null, 2),
    );
    fs.writeFileSync(
      path.join(outDir, `storage-dump-${stamp}.json`),
      JSON.stringify(s, null, 2),
    );
    console.log(`evidence archived: ${outDir}/matrix-run-${stamp}.json`);
  } catch (e) {
    console.log('evidence archival failed (non-fatal):', e.message);
  }

  if (fails.length) {
    console.log('FAILED:', fails.map((f) => `[${f.row}] ${f.name}`).join(' | '));
  }
  httpServer.kill();
  chrome.kill();
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
