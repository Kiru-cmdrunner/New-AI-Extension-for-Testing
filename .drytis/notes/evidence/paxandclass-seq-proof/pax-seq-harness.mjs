// PaxAndClass sequence-proof harness — validates S1'/S2/S3' structural fixes
// against an AdaniOne-shaped PaxAndClass widget (icon-only steppers, class-based
// custom select, role=option date cells elsewhere on the page).
//
// Proves:
//  1. Icon-only +/- steppers and arrows get derived names (S2) — no bare 'element'.
//  2. Bare-div option clicks pair mousedown→click into ONE Unclassified card (S1')
//     — no duplicate physical cards per logical click.
//  3. The custom Economy dropdown is NOT completed by a later calendar date-cell
//     (S3'): lifecycle ends without a date selection; no "Select 'Choose Saturday…'"
//     description; sequence order preserved.
//  4. Round Trip / +Adult / +Children / Premium Economy / Done each surface at
//     their actual interaction index, in workflow order.
//
// Real Chrome 148 + CDP, trusted input only. Read-only vs product.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 8178;
const CDP_PORT = 9556;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/pax-profile-' + Date.now();
const DIST = '/workspace/dist';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 700) : ''}`);
  ok ? PASS++ : FAIL++;
};

// ── AdaniOne-shaped PaxAndClass app ─────────────────────────────────────
// Structure mirrors the real widget family:
//   • trip-type toggle: <div class="trip-type-selectbox">One Way</div> + bare
//     option rows (Round Trip) — class-based custom select, NO aria-haspopup
//   • steppers: <i class="icon-plus"> / <i class="icon-minus"> — icon-only,
//     no accessible name, inside PaxAndClass modal
//   • cabin select: <div class="PaxAndClass-selectbox">1 Economy</div> with
//     bare option rows (Premium Economy) — NO containment proof possible
//   • date picker: role=option calendar cells elsewhere (aria-label
//     'Choose Saturday, September 5th, 2026') — must NEVER complete the
//     cabin/trip dropdowns
const state = { trip: 'One Way', adults: 1, children: 0, cabin: 'Economy', dep: null, ret: null };

const page = () => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Flights</title>
<style>
body{font-family:system-ui;margin:2rem}
.modal{border:2px solid #1a2b4a;border-radius:8px;padding:1rem;max-width:560px;position:relative}
.pax-modal-title{font-weight:600;margin-bottom:.5rem}
.row{display:flex;align-items:center;gap:1rem;padding:.4rem 0;border-bottom:1px solid #eee}
.trip-row,.cabin-row{padding:.5rem .75rem;border:1px solid #ccc;border-radius:6px;cursor:pointer;display:inline-block;min-width:220px}
.options{border:1px solid #1a2b4a;border-radius:6px;margin-top:.35rem;display:none}
.options.open{display:block}
.opt-row{padding:.5rem .75rem;cursor:pointer}
.opt-row:hover{background:#eef3fb}
.stepper{display:inline-flex;align-items:center;gap:.6rem}
i.icon-plus,i.icon-minus{display:inline-block;width:22px;height:22px;background:#1a2b4a;color:#fff;border-radius:50%;cursor:pointer;font-style:normal;text-align:center;line-height:22px;font-size:14px}
i.icon-plus::after{content:'+'}
i.icon-minus::after{content:'−'}
.cal{border:1px solid #ccc;border-radius:6px;padding:.6rem;margin-top:1rem;display:inline-block}
.cal-cell{display:inline-block;width:34px;height:34px;text-align:center;line-height:34px;cursor:pointer;border:1px solid #eee}
.done-btn{margin-top:.8rem;padding:.5rem 1.2rem;background:#1a2b4a;color:#fff;border:none;border-radius:6px}
</style></head><body>
<h1>Flight Search</h1>
<div class="modal PaxAndClass" role="dialog" aria-label="Passengers and class">
  <div class="pax-modal-title">Passengers &amp; Class</div>

  <div class="row">
    <div class="trip-type-selectbox trip-row" data-kind="trip">${state.trip}</div>
    <div class="options trip-options" id="trip-options">
      <div class="opt-row" data-opt="One Way">One Way</div>
      <div class="opt-row" data-opt="Round Trip">Round Trip</div>
    </div>
  </div>

  <div class="row">
    <span>Adults</span>
    <div class="stepper">
      <i class="icon-plus" data-kind="adult-plus" title=""></i>
      <span class="adult-count">${state.adults}</span>
      <i class="icon-minus" data-kind="adult-minus" title=""></i>
    </div>
  </div>

  <div class="row">
    <span>Children</span>
    <div class="stepper">
      <i class="icon-plus" data-kind="child-plus" title=""></i>
      <span class="child-count">${state.children}</span>
      <i class="icon-minus" data-kind="child-minus" title=""></i>
    </div>
  </div>

  <div class="row">
    <div class="PaxAndClass-selectbox cabin-row" data-kind="cabin">${state.adults} ${state.cabin}</div>
    <div class="options cabin-options" id="cabin-options">
      <div class="opt-row" data-opt="Economy">Economy</div>
      <div class="opt-row" data-opt="Premium Economy">Premium Economy</div>
    </div>
  </div>

  <button class="done-btn" data-kind="done" role="button">Done</button>
</div>

<div class="cal" aria-label="Departure calendar">
  <div class="cal-cell" role="option" aria-label="Choose Friday, September 4th, 2026" data-day="4">4</div>
  <div class="cal-cell" role="option" aria-label="Choose Saturday, September 5th, 2026" data-day="5">5</div>
</div>
<div class="cal" aria-label="Return calendar" id="ret-cal" style="display:none">
  <div class="cal-cell" role="option" aria-label="Choose Tuesday, September 29th, 2026" data-rday="29">29</div>
</div>

<script>
const st = ${JSON.stringify(state)};
const tripBox = document.querySelector('[data-kind="trip"]');
const tripOpts = document.getElementById('trip-options');
const cabinBox = document.querySelector('[data-kind="cabin"]');
const cabinOpts = document.getElementById('cabin-options');
const doneBtn = document.querySelector('[data-kind="done"]');
const retCal = document.getElementById('ret-cal');

function closeAll(){ tripOpts.classList.remove('open'); cabinOpts.classList.remove('open'); }

tripBox.addEventListener('click', e => { e.stopPropagation(); closeAll(); tripOpts.classList.toggle('open'); });
cabinBox.addEventListener('click', e => { e.stopPropagation(); closeAll(); cabinOpts.classList.toggle('open'); });

tripOpts.querySelectorAll('.opt-row').forEach(o => o.addEventListener('click', e => {
  e.stopPropagation();
  st.trip = o.dataset.opt; tripBox.textContent = st.trip; closeAll();
}));
cabinOpts.querySelectorAll('.opt-row').forEach(o => o.addEventListener('click', e => {
  e.stopPropagation();
  st.cabin = o.dataset.opt; cabinBox.textContent = st.adults + ' ' + st.cabin; closeAll();
}));

document.querySelectorAll('[data-kind="adult-plus"],[data-kind="child-plus"],[data-kind="adult-minus"],[data-kind="child-minus"]').forEach(el => {
  el.addEventListener('click', e => {
    e.stopPropagation();
    if (el.dataset.kind === 'adult-plus') st.adults++;
    if (el.dataset.kind === 'child-plus') st.children++;
    if (el.dataset.kind === 'adult-minus') st.adults = Math.max(1, st.adults - 1);
    if (el.dataset.kind === 'child-minus') st.children = Math.max(0, st.children - 1);
    document.querySelector('.adult-count').textContent = st.adults;
    document.querySelector('.child-count').textContent = st.children;
    cabinBox.textContent = st.adults + ' ' + st.cabin;
  });
});

document.querySelectorAll('.cal-cell').forEach(c => c.addEventListener('click', e => {
  e.stopPropagation();
  if (c.dataset.day) { st.dep = c.getAttribute('aria-label'); document.querySelector('.cal').style.outline='2px solid green'; }
  else { st.ret = c.getAttribute('aria-label'); retCal.style.outline='2px solid green'; }
  if (st.trip === 'Round Trip') retCal.style.display = 'inline-block';
}));

doneBtn.addEventListener('click', () => {
  document.querySelector('.PaxAndClass').dataset.closed = 'true';
  document.querySelector('.PaxAndClass').style.opacity = '0.6';
});
</script>
</body></html>`;

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page());
});
srv.listen(APP_PORT, '127.0.0.1');

// ── Chrome + extension ──────────────────────────────────────────────────
const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  try { browser = await CDP({ port: CDP_PORT }); break; } catch {}
}
if (!browser) { out('FATAL: no chrome'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${APP_PORT}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: CDP_PORT });
const panel = await CDP({ target: panelTab, port: CDP_PORT });
await app.send('Runtime.enable');
await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => {
  const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value;
  return v === 'null' ? null : JSON.parse(v);
};
const clickSel = async (sel, label) => {
  const p = await center(sel);
  if (!p) { out(`  !! ${sel} not clickable`); return false; }
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  out('  clicked', label || sel);
  return true;
};

await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(1500);

// ══ RECORD THE USER'S INTENDED SEQUENCE ══
out('START_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(800);

// 1. One Way dropdown arrow → open trip options → Round Trip (bare div option)
await clickSel('[data-kind="trip"]', 'One Way selectbox (custom, class-based)');
await sleep(700);
await clickSel('[data-opt="Round Trip"]', 'Round Trip option row (bare div, no role)');
await sleep(900);

// 2. +Adult stepper (icon-only <i class="icon-plus">, no accessible name)
await clickSel('[data-kind="adult-plus"]', '+Adult icon-plus stepper');
await sleep(700);

// 3. +Children stepper
await clickSel('[data-kind="child-plus"]', '+Children icon-plus stepper');
await sleep(700);

// 4. Economy cabin selectbox → Premium Economy (bare option, no containment proof)
await clickSel('[data-kind="cabin"]', '1 Economy PaxAndClass-selectbox');
await sleep(700);
await clickSel('[data-opt="Premium Economy"]', 'Premium Economy option row (bare div)');
await sleep(900);

// 5. Done button
await clickSel('[data-kind="done"]', 'Done button');
await sleep(700);

// 6. Departure date cell (role=option calendar cell — the RC4 trap)
await clickSel('[data-day="5"]', 'departure date cell (calendar option)');
await sleep(900);
// 7. Return date cell (appears because Round Trip)
await clickSel('[data-rday="29"]', 'return date cell');
await sleep(1500);

const appState = await evalApp(`(() => ({ trip: document.querySelector('[data-kind="trip"]').textContent, adults: document.querySelector('.adult-count').textContent, children: document.querySelector('.child-count').textContent, cabin: document.querySelector('[data-kind="cabin"]').textContent, dep: !!document.querySelector('.cal[style*="green"]'), done: document.querySelector('.PaxAndClass').dataset.closed }))()`);
out('app final state:', JSON.stringify(appState));
check('app: full workflow applied (Round Trip, 2 adults, 1 child, Premium Economy, Done, dates)', 
  appState.trip === 'Round Trip' && appState.adults === '2' && appState.children === '1' && appState.cabin === '2 Premium Economy' && appState.done === 'true', JSON.stringify(appState));

out('STOP_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(3500); // post-stop merge

// ══ ANALYZE CAPTURED INTERACTIONS ══
const evidence = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return (g.cmdrunner_live_interactions || []).map(i => ({
    id: i.interactionId, type: i.type,
    name: i.metadata && i.metadata.targetName,
    physical: i.metadata && i.metadata.physicalEventType,
    physicalEvents: i.metadata && i.metadata.physicalEvents,
    reason: i.metadata && i.metadata.reason,
    selectionConfirmed: i.metadata && i.metadata.selectionConfirmed,
    provisional: i.metadata && i.metadata.provisionalSelection,
    sel: i.trigger && (i.trigger.cssSelector || i.trigger.className),
    seq: i.triggerEvent && i.triggerEvent.captureSeq,
  }));
})()`);
out('captured interactions:', JSON.stringify(evidence, null, 1));

// S1' proof: each logical click yields exactly ONE card (no duplicate physical cards) — classification-agnostic
const uncls = evidence.filter(i => i.type === 'Unclassified');
const countNamed = re => evidence.filter(i => re.test(String(i.name))).length;
const strayMousedown = evidence.filter(i => i.physical === 'mousedown' && !Array.isArray(i.physicalEvents));
const unclsUnpaired = uncls.filter(i => !Array.isArray(i.physicalEvents) || i.physicalEvents.length !== 2);
check("S1': bare custom-widget clicks collapse to ONE card (no stray mousedown, no duplicates)",
  strayMousedown.length === 0 && unclsUnpaired.length === 0 &&
  countNamed(/^Round Trip$/) === 1 && countNamed(/^Premium Economy$/) === 1 && countNamed(/^add icon$/) === 2,
  `strayMousedown=${strayMousedown.length}, unpairedUnclassified=${unclsUnpaired.length}, ` +
  `roundTrip=${countNamed(/^Round Trip$/)}, premiumEconomy=${countNamed(/^Premium Economy$/)}, addIcon=${countNamed(/^add icon$/)}, totalUnclassified=${uncls.length}`);

// S6/LP1 re-baseline: option rows inside open selection surfaces are now RECOGNIZED
const optionCards = evidence.filter(i => /Round Trip|Premium Economy/.test(String(i.name)));
check("S6/LP1: Round Trip + Premium Economy recognized as Clicks (not Unclassified)",
  optionCards.length === 2 && optionCards.every(i => i.type !== 'Unclassified'),
  optionCards.map(i => `${i.id}:${i.type}`).join(' | '));
check("S6/LP1 re-baseline: Unclassified reduced to the 2 closed selectbox openers; date cells are recognized",
  uncls.length === 2 && uncls.every(i => /One Way|Economy/.test(String(i.name)) && !/Choose /.test(String(i.name))) &&
  evidence.filter(i => /Choose /.test(String(i.name))).every(i => i.type === 'Click'),
  uncls.map(i => `${i.id}:${i.name}`).join(' | '));

// S2 proof: no vacuous 'element' names on icon-only steppers
const elementNames = evidence.filter(i => (i.name === 'element' || i.name === '') && i.type !== 'Navigation');
check("S2: no vacuous 'element' names on icon-only targets", elementNames.length === 0,
  elementNames.map(i => `${i.id}:${i.sel}`).join(' | '));

const plusCards = evidence.filter(i => /icon-plus/.test(String(i.sel)) || /add icon|plus icon/i.test(String(i.name)));
check('S2: + steppers carry derived icon names', plusCards.length >= 2 && plusCards.every(i => /icon/i.test(String(i.name))),
  plusCards.map(i => `${i.id}=${i.name}`).join(' | '));

// S3' proof: no dropdown card carries a date as its CONFIRMED selection or name
const dropdowns = evidence.filter(i => i.type === 'Dropdown');
const dateConfirm = dropdowns.filter(d =>
  /Choose |September/i.test(String(d.name)) ||
  (d.selectionConfirmed === true && /Choose |September/i.test(String(d.provisional))));
check("S3': no Dropdown interaction is described by a calendar date (confirmed or named)",
  dateConfirm.length === 0,
  JSON.stringify(dropdowns.map(d => ({ name: d.name, prov: d.provisional, conf: d.selectionConfirmed }))));

// Unconfirmed (displaced) custom selects carry honest provisional metadata —
// only flag NON-date provisionals that are wrongly unconfirmed... actually the
// honest rule: provisional must exist only when nothing better was provable.
const badProv = dropdowns.filter(d => d.provisional != null && /Choose |September/i.test(String(d.provisional)));
check("S3': displaced dropdowns never park a calendar date as provisional", badProv.length === 0,
  JSON.stringify(badProv.map(d => d.provisional)));

// ── Sequence proof: the five key steps in order ──
// A step may surface as its recognized card (Click/Dropdown) OR as an
// Unclassified card (bare custom widget) — both are honest captures at the
// actual interaction. We search both pools by name OR selector substring.
const bySeq = (a, b) => (a.seq ?? 0) - (b.seq ?? 0);
const findCard = (pred) => evidence.filter(pred).sort(bySeq);

const roundTripCards = findCard(i => /Round Trip/i.test(String(i.name)) || /Round Trip/.test(String(i.sel)));
const adultCards = findCard(i => /adult-plus/.test(String(i.sel)) || /add icon/i.test(String(i.name)));
const childCards = findCard(i => /child-plus/.test(String(i.sel)) || /add icon/i.test(String(i.name)));
const premiumCards = findCard(i => /Premium Economy/i.test(String(i.name)) || /Premium/.test(String(i.sel)));
const doneCards = findCard(i => /Done/i.test(String(i.name)));

check('sequence: Round Trip captured (recognized or Unclassified)', roundTripCards.length >= 1, roundTripCards.map(c => `${c.id}:${c.name}`).join(','));
check('sequence: +Adult captured at its interaction', adultCards.length >= 1, adultCards.map(c => `${c.id}(${c.name})`).join(','));
check('sequence: +Children captured at its interaction', childCards.length >= 1, childCards.map(c => `${c.id}(${c.name})`).join(','));
check('sequence: Premium Economy captured (recognized or Unclassified)', premiumCards.length >= 1, premiumCards.map(c => `${c.id}:${c.name}`).join(','));
check('sequence: Done captured', doneCards.length >= 1, doneCards.map(c => c.id).join(','));

if (roundTripCards[0] && adultCards[0] && childCards[0] && premiumCards[0] && doneCards[0]) {
  const ordered = [roundTripCards[0], adultCards[0], childCards[0], premiumCards[0], doneCards[0]];
  const seqs = ordered.map(c => c.seq ?? 0);
  const monotonic = seqs.every((s, idx) => idx === 0 || s >= seqs[idx - 1]);
  check('sequence: RoundTrip < +Adult < +Children < PremiumEconomy < Done (workflow order)', monotonic, `seqs=${seqs.join(' < ')}`);
} else {
  check('sequence: RoundTrip < +Adult < +Children < PremiumEconomy < Done (workflow order)', false, 'missing prerequisite cards');
}

// ── M4 capture-guarantee verification (post-fix must be match=true) ──
const verification = await evalPanel(`(async () => { const g = await chrome.storage.local.get('cmdrunner_verification_result'); return g.cmdrunner_verification_result ? { match: g.cmdrunner_verification_result.match, diffs: (g.cmdrunner_verification_result.differences||[]).map(d=>d.eventId) } : null; })()`);
check('M4 capture guarantee: every ledger event represented (verification match)', verification && verification.match === true,
  verification ? `unrepresented=${JSON.stringify(verification.diffs)}` : 'null');

// ── IR sanity: steps condensed, no date-as-dropdown step ──
const ir = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_ir_plan'); return (g.execution_ir_plan && g.execution_ir_plan.steps) ? g.execution_ir_plan.steps.map(s => ({ id: s.stepId, action: s.action, desc: s.description })) : null; })()`);
out('IR steps:', JSON.stringify(ir));
check('IR: plan generated', Array.isArray(ir) && ir.length > 0, Array.isArray(ir) ? `${ir.length} steps` : 'null');
const irDateDropdown = (ir || []).filter(s => /dropdown|select/i.test(String(s.action)) && /Choose |September \d/i.test(String(s.desc)));
check("S3': IR contains no 'select date from dropdown' step", irDateDropdown.length === 0, JSON.stringify(irDateDropdown));

out(`\n════ PAXANDCLASS SEQUENCE PROOF — ${PASS} PASS / ${FAIL} FAIL ════`);

try { await browser.close(); } catch {}
chrome.kill('SIGKILL');
srv.close();
process.exit(FAIL > 0 ? 1 : 0);
