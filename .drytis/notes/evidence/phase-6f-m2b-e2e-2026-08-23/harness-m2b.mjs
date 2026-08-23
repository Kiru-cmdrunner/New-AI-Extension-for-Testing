// 6F-M2b real-Chrome E2E harness — sw-recovered identity seed (F4-D).
// Spec: .drytis/specs/phase-6f-m2b-sw-recovered-identity.md AC-9.
//
// House CDP pattern (verbatim from harness-6f.mjs / 6D.1/6D.2/6E-M1):
//   puppeteer-cached Chrome 148 + --no-sandbox + --disable-extensions-except,
//   chrome-remote-interface module, app tab + PANEL tab, recording started
//   from the panel context (chrome.runtime.sendMessage), trusted input via
//   Input.dispatchMouseEvent, storage read from the panel context.
//
// WHY AN ATTEMPT LOOP (runs 1–7 findings, all logged below):
//   run-1..4  no injection / graceful close: the content script's pagehide
//             emergency flush DELIVERS the evidence ('page-reload', real
//             before/after) — the M9 fast-flush feature working as designed;
//             the SW-recovery path (synthesizeMinimalEvidence) never runs.
//   run-5..7  Page.crash at +50..150 ms: Chrome RE-DELIVERS the unacked
//             click to the RESTARTED renderer (the twin 'Unclassified' card),
//             so the evidenced Click card came from the reloaded page.
//   => The kill must land in the [card-commit ~T+5ms, first evidence delivery
//      ~T+80ms] window, where T (click processing) is itself ~60–100 ms after
//      the CDP dispatch with ±60 ms jitter in headless. A fixed offset cannot
//      hit it; a jittered attempt loop can. Each attempt is a fresh tab; the
//      first attempt that produces an endReason 'sw-recovered-form-submit'
//      card stops the loop (that card is the artifact under test).
//
// Scenario: START → per attempt {fresh m9 tab, clear storage, trusted click
// on #add-to-cart-button (GET submit → navigation), crash renderer at offset}
// → STOP (drains the durable ledger → attach → synthesizeMinimalEvidence) →
// assert the recovered card's targetEvidence.identity names the REAL element.
//
// Checks (on the sw-recovered card of the successful attempt):
//   C1  recovered Click card on #add-to-cart-button exists
//   C2  its evidence endReason is 'sw-recovered-form-submit' (recovery hit)
//   C3  targetEvidence.identity is SEEDED (not null)            ← the fix
//   C4  identity names the REAL element (stableId/accessibleName)
//   C5  identity.tag is the real captured tag (BUTTON)
//   C6  before/after remain null (honesty — no fabricated state)
//   C7  network evidence attached (ledger recovery worked)
//   C8  NO sw-recovered card with an element-shaped trigger renders null
//       identity (the "Unknown element" bug is gone on this path)
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9500 + Math.floor(Math.random() * 400);   // fresh debug port per run
const APP_PORT = 8191;
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-6f-m2b-e2e-2026-08-23/dumps';
const PROFILE = '/tmp/6fm2b-profile-' + Date.now();
const ATTEMPTS = 8;          // conjunction-triggered crashes; see attempt loop
const CPU_THROTTLE = 6;      // 6× (run-11/15): the flush (heavy serialize) is slowed far more
                             // than the native crash dispatch → after the conjunction fires,
                             // the crash reliably lands BEFORE the flush at 6×; at 2× the
                             // flush won the race (run-14: card landed 'page-reload' anyway)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 700) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

// ── Serve the COMMITTED m9 pages verbatim (fast form-submit → navigation) ──
const PAGE_A = fs.readFileSync('/workspace/public/m9-form-submit-validation.html');
const PAGE_B = fs.readFileSync('/workspace/public/m9-cart-landed.html');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(req.url.startsWith('/m9-cart-landed') ? PAGE_B : PAGE_A);
});
await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { out('FATAL: chrome never came up'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
let swUrl = t0.find((t) => t.url.includes('service-worker-loader.js'))?.url;
for (let i = 0; i < 10 && !swUrl; i++) {
  await sleep(500);
  const { targetInfos: tx } = await browser.send('Target.getTargets');
  swUrl = tx.find((t) => t.url.includes('service-worker-loader.js'))?.url;
}
if (!swUrl) { out('FATAL: no service-worker-loader target'); process.exit(1); }
const extId = swUrl.split('/')[2];
out('extId =', extId);

const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const panel = await CDP({ target: panelTab, port: PORT });
await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const storage = () => evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);
const clearSession = () => evalPanel(`new Promise(res => chrome.storage.local.set({'cmdrunner_live_interactions': [], 'cmdrunner_evidence_ledger': []}, () => res(true)))`);
const readCards = async () => {
  const s = await storage();
  return (s.cmdrunner_live_interactions || []).map((i) => ({
    type: i.type,
    endReason: i.behavioralEvidence?.window?.endReason ?? null,
    identity: i.behavioralEvidence?.targetEvidence?.identity ?? null,
    before: i.behavioralEvidence?.targetEvidence?.before ?? null,
    after: i.behavioralEvidence?.targetEvidence?.after ?? null,
    netRows: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
    triggerTag: i.trigger?.tag ?? null,
    triggerStableId: i.trigger?.stableId ?? null,
    triggerName: i.trigger?.accessibleName ?? null,
  }));
};

await sleep(1000);
out('START →', await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`));
await sleep(800);

// ── Attempt loop: crash the renderer inside the commit→deliver gap ──
let attemptLog = [];
let hit = false;
for (let n = 0; n < ATTEMPTS && !hit; n++) {
  out(`— attempt ${n + 1}/${ATTEMPTS}: stamp-triggered crash —`);
  await clearSession();
  await sleep(300);
  const { targetId: appTab } = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${APP_PORT}/m9-form-submit-validation.html` });
  const app = await CDP({ target: appTab, port: PORT });
  await app.send('Runtime.enable'); await app.send('Page.enable');
  // WINDOW WIDENING (runs 8–12): the commit→deliver gap is ~40 ms at 1× CPU.
  // 2× throttle stretches the content-script flush JS (heavy serialize +
  // persist) while leaving the native nav chain untouched.
  await app.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  await sleep(1500); // content script injected + recording armed

  // STAMP TRIGGER + PRECONDITION DETECTION (run-12 finding):
  //  · The crash must land AFTER the durable stamp write and BEFORE the
  //    flush → watch chrome.storage.onChanged in the panel for the
  //    cmdrunner_evidence_ledger write and crash the same tick.
  //  · 'sw-recovered-form-submit' ONLY materializes at STOP drain — checking
  //    for it in-loop (run-12) never hits. The in-loop precondition is the
  //    OBSERVABLE half: click card durable (endReason null) + stamp present.
  //  · CRITICAL (run-12 bug): clearSession wiped the durable stamp before
  //    STOP could drain it, so hit-attempts 4–10 produced perfect crash
  //    shapes that were then destroyed. clearSession runs ONLY before each
  //    attempt's click — never after a hit.
  await evalPanel(`new Promise(res => {
    (globalThis).__m2bStampHit = false;
    chrome.storage.onChanged.addListener(function m2b(changes, area) {
      if (area !== 'local' || !changes.cmdrunner_evidence_ledger) return;
      const rows = changes.cmdrunner_evidence_ledger.newValue || [];
      if (rows.length >= 1) { (globalThis).__m2bStampHit = true; chrome.storage.onChanged.removeListener(m2b); }
    });
    res('watcher armed');
  })`);
  const rect = JSON.parse(await app.send('Runtime.evaluate', {
    expression: `(() => { const el = document.getElementById('add-to-cart-button'); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }); })()`,
    returnByValue: true,
  }).then((r) => r.result.value));
  const x = rect.x + rect.w / 2, y = rect.y + rect.h / 2;
  // CONJUNCTION TRIGGER (run-13 finding): crashing on the stamp ALONE fires
  // before the ORIGINAL click-card commit reaches the SW; the bare Click
  // that survives is the re-delivered TWIN from the reloaded renderer (new
  // eventId) — the stamp's sourceEventId then has NO owner → join unresolved
  // → no synthesis. The correct window is the CONJUNCTION:
  //   (a) durable stamp present (ledger rows ≥ 1) AND
  //   (b) a Click card for #add-to-cart-button persisted WITHOUT evidence
  // Both are visible in chrome.storage BEFORE the flush updates the card.
  // 2× throttle stretches (stamp → flush) to ~100+ ms → a 5 ms poll catches
  // the conjunction with near-certainty; if the flush wins, the card gains
  // endReason and the attempt honestly fails → next attempt.
  const clickT0 = Date.now();
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(30);
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  let conj = false, conjAtMs = 0;
  for (let i = 0; i < 400 && !conj; i++) {
    const s = await storage();
    const stamp = (s.cmdrunner_evidence_ledger || []).length >= 1;
    const bareClick = (s.cmdrunner_live_interactions || []).some(
      (ix) => ix.trigger?.stableId === 'add-to-cart-button' && !ix.behavioralEvidence,
    );
    if (stamp && bareClick) { conj = true; conjAtMs = Date.now() - clickT0; break; }
    await sleep(5);
  }
  out(`   conjunction ${conj ? 'observed' : 'NOT observed'}${conj ? ` at +${conjAtMs} ms` : ' after 2 s'} — crashing`);
  await Promise.race([app.send('Page.crash').catch(() => {}), sleep(2500)]);
  await sleep(1800); // reload settles; the durable stamp + bare click card remain
  const cards = await readCards();
  attemptLog.push({ attempt: n + 1, conj, conjAtMs, shapes: cards.map((c) => ({ t: c.type, er: c.endReason })) });
  out(`   cards: ${JSON.stringify(cards.map((c) => ({ t: c.type, er: c.endReason, ident: c.identity ? 'SEEDED' : 'null' })))}`);
  if (conj) { hit = true; out('   ✓ conjunction met (durable stamp + evidence-less click) — proceeding to STOP drain'); }
  else { try { await browser.send('Target.closeTarget', { targetId: appTab }); } catch {} await sleep(700); }
}
dump('m2b-attempts.json', attemptLog);

out('STOP →', await evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`));
await sleep(2500);

// ── Inspect persisted interactions from the panel context ──
const finalStorage = await storage();
dump('m2b-storage.json', finalStorage);
const ix = finalStorage.cmdrunner_live_interactions || [];
const cardOf = (i) => ({
  type: i.type,
  endReason: i.behavioralEvidence?.window?.endReason ?? null,
  identity: i.behavioralEvidence?.targetEvidence?.identity ?? null,
  // C6 honesty probe: hasTargetEvidence distinguishes "targetEvidence present,
  // before/after honestly null" (the synthetic shape) from "no evidence block
  // at all" (in-flight cards from attempts that never hit).
  hasTargetEvidence: !!i.behavioralEvidence?.targetEvidence,
  before: i.behavioralEvidence?.targetEvidence?.before ?? null,
  after: i.behavioralEvidence?.targetEvidence?.after ?? null,
  netRows: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
  triggerTag: i.trigger?.tag ?? null,
  triggerStableId: i.trigger?.stableId ?? null,
  triggerName: i.trigger?.accessibleName ?? null,
});
const cards = ix.map(cardOf);
dump('m2b-cards.json', cards);
out('final cards:', JSON.stringify(cards.map((c) => ({ t: c.type, er: c.endReason, id: c.triggerStableId, ident: c.identity ? { tag: c.identity.tag, id: c.identity.stableId, name: c.identity.accessibleName } : null })), null, 1));

check('E0 recovery precondition exercised (durable stamp + bare click, renderer killed)', hit,
  JSON.stringify(attemptLog.map((a) => ({ a: a.attempt, conj: a.conj, shapes: a.shapes }))));

const atc = cards.find((c) => c.triggerStableId === 'add-to-cart-button' && c.endReason === 'sw-recovered-form-submit');
check('C1 recovered Click card on #add-to-cart-button exists', !!atc,
  JSON.stringify(cards.map((c) => ({ t: c.type, er: c.endReason, id: c.triggerStableId }))));
if (atc) {
  check("C2 endReason is 'sw-recovered-form-submit'", atc.endReason === 'sw-recovered-form-submit', String(atc.endReason));
  check('C3 targetEvidence.identity is SEEDED (not null) — THE FIX', atc.identity !== null,
    'identity=' + JSON.stringify(atc.identity).slice(0, 140));
  check('C4 identity names the REAL element',
    !!atc.identity && (atc.identity.stableId === 'add-to-cart-button' || atc.identity.accessibleName === 'Add to cart'),
    `stableId=${atc.identity?.stableId} name=${JSON.stringify(atc.identity?.accessibleName)}`);
  check('C5 identity.tag is the real captured tag (BUTTON)', atc.identity?.tag === 'BUTTON', String(atc.identity?.tag));
  check('C6 before/after remain null (no fabricated state)',
    atc.hasTargetEvidence && atc.before === null && atc.after === null,
    `targetEvidence=${atc.hasTargetEvidence} before=${JSON.stringify(atc.before)?.slice(0, 40)} after=${JSON.stringify(atc.after)?.slice(0, 40)}`);
  check('C7 network evidence attached (ledger recovery worked)', atc.netRows >= 1, `netRows=${atc.netRows}`);
}
const orphanRecovered = cards.filter((c) => c.endReason === 'sw-recovered-form-submit' && c.triggerTag && !c.identity);
check('C8 zero sw-recovered element cards with null identity ("Unknown element" gone on this path)',
  orphanRecovered.length === 0, JSON.stringify(orphanRecovered.map((c) => ({ t: c.type, tag: c.triggerTag }))));

out(`\n════ 6F-M2b E2E — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
try { chrome.kill('SIGTERM'); } catch {}
server.close();
setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} }, 2000);
process.exit(FAIL === 0 ? 0 : 1);
