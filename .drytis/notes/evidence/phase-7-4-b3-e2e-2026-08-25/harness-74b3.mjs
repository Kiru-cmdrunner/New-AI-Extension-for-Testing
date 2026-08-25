#!/usr/bin/env node
/**
 * 7.4-B3 E2E harness — real Chrome (CDP), B1/B2 pattern.
 *
 * Modes:
 *   baseline  — runs against the CURRENT dist build without asserting B3
 *               behaviors (used pre-implementation on the B2 dist to
 *               capture the S0 baseline census).
 *   full      — runs all B3 assertions (post-implementation).
 *
 * Fixtures:
 *   /census-validation.html             (B3 census flows)
 *   /combobox-typeable-validation.html  (B2 flows — regression)
 *
 * Outputs to OUT dir: dumps (storage, cards, ir-plan, console) + census JSON.
 * Exit 0 iff all checks pass (full mode).
 */
import CDP from 'chrome-remote-interface';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import http from 'node:http';

const MODE = process.argv[2] === 'baseline' ? 'baseline' : 'full';
const OUT = process.argv[3] || `b3-${MODE}`;
mkdirSync(OUT, { recursive: true });

const CHROME_BIN =
  '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const DIST = '/workspace/dist';
const FIXTURE_PORT = 8244;
const PORT = 9904 + Math.floor(Math.random() * 40);
const APP = `http://127.0.0.1:${FIXTURE_PORT}`;

const out = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let PASS = 0, FAIL = 0;
function check(name, ok, detail) {
  out(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (ok) PASS++; else FAIL++;
}

// ── Fixture server (zero-dependency) ───────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const fixture = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${FIXTURE_PORT}`);
  const rel = url.pathname === '/' ? '/census-validation.html' : url.pathname;
  const file = '/workspace/public' + rel;
  fs_read(file, res);
});
function fs_read(file, res) {
  if (!existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' });
  res.end(readFileSync(file));
}
await new Promise((res, rej) => { fixture.once('error', rej); fixture.listen(FIXTURE_PORT, '127.0.0.1', res); });
out('fixture listening on', FIXTURE_PORT);

setTimeout(() => { out('FATAL: watchdog fired'); try { chrome?.kill(); } catch {} process.exit(2); }, 240000).unref();

const probe = () => new Promise((res) => {
  http.get(`${APP}/census-validation.html`, (r) => { r.resume(); res(String(r.statusCode)); }).on('error', () => res('000'));
});
let fixtureUp = false;
for (let i = 0; i < 30; i++) {
  if (await probe() === '200') { fixtureUp = true; break; }
  await sleep(500);
}
out('fixture up:', fixtureUp);
if (!fixtureUp) { out('FATAL: fixture never answered'); process.exit(1); }

// ── Chrome spawn (B2 pattern) ──────────────────────────────────────────

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/b3-profile-${Math.random().toString(36).slice(2)}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch { /* chrome not up */ } }
if (!browser) { out('FATAL: chrome never came up'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extId = t0.find((t) => t.url.includes('service-worker-loader.js')).url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/census-validation.html` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable'); await app.send('Page.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

const consoleErrors = [];
await panel.send('Log.enable');
panel.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') consoleErrors.push(e.entry.text); });

const probePage = await evalApp(`(() => ({ url: location.href, ready: document.readyState, boxes: document.querySelectorAll('.box').length }))()`);
out('page probe:', JSON.stringify(probePage));
if (!probePage || probePage.boxes < 4) { out('FATAL: census fixture page missing'); process.exit(1); }

await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(400);

// ── Recording helpers (B2 pattern) ────────────────────────────────────

const startRecording = async () => {
  await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`);
  await sleep(800);
  await browser.send('Target.activateTarget', { targetId: appTab });
};
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
const rectOf = async (sel) => (await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`));
const dispatch = async (type, x, y) => { await app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };
const clickAt = async (selOrRect) => {
  const r = typeof selOrRect === 'string' ? await rectOf(selOrRect) : selOrRect;
  if (!r) throw new Error('no element ' + selOrRect);
  await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2);
  await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2);
};
const clickXY = async (x, y) => { await dispatch('mousePressed', x, y); await dispatch('mouseReleased', x, y); };
const typeInto = async (sel, text) => {
  const r = await rectOf(sel);
  if (!r) throw new Error('no element ' + sel);
  await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2);
  await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2);
  await sleep(250);
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(55);
  }
};
// F3 no-focus typing: key events ONLY — the input is already focused
// (autofocus) and we must NOT click (a click-to-focus would start a real
// TextEntry lifecycle, making the episode claimed instead of unclaimed).
// CDP key events target the focused element.
const typeIntoFocused = async (text) => {
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(55);
  }
};
// Focus an element WITHOUT a click (DOM focus() fires only focus event —
// the content script taps trusted events only, so this stays unclaimed).
const focusViaDom = async (sel) => {
  await evalApp(`document.querySelector(${JSON.stringify(sel)}).focus()`);
  await sleep(120);
};
const pressEnter = async () => {
  await app.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
};
const navigate = async (path) => { await app.send('Page.navigate', { url: `${APP}${path}` }); await sleep(900); };
const reloadPanel = async () => { await panel.send('Page.reload'); await sleep(2500); };

function readCards(storage, tag) {
  const ix = storage.cmdrunner_live_interactions ?? [];
  const cards = ix.map((i) => ({
    type: i.type,
    name: i.metadata?.targetName ?? null,
    tag: i.metadata?.targetTag ?? null,
    sel: i.trigger?.cssSelector ?? i.triggerEvent?.target?.cssSelector ?? null,
    typedValue: i.metadata?.typedValue ?? i.metadata?.sampledValueAfter ?? i.metadata?.valueAfter ?? null,
    physicalEventType: i.metadata?.physicalEventType ?? null,
    repeatCount: i.metadata.repeatCount ?? null,
    actionabilityEvidence: i.metadata.actionabilityEvidence ?? null,
    reason: i.metadata?.reason ?? null,
    hasEvidence: !!i.behavioralEvidence,
    members: (i.memberEvents ?? []).map((m) => m.eventType),
  }));
  writeFileSync(`${OUT}/${tag}-cards.json`, JSON.stringify(cards, null, 1));
  return cards;
}

// ── Flow 1: census fixture ─────────────────────────────────────────────

async function censusFlow() {
  await navigate('/census-validation.html');
  await startRecording();

  // F-pop 5 FIRST (F3 no-lifecycle typing): the autofocus input is focused
  // at page load, BEFORE recording starts — no focus event is ever seen →
  // no TextEntry lifecycle. Every later click would blur it (Chrome moves
  // focus to body on non-focusable mousedown), so this MUST be the first
  // gesture. Type WITHOUT clicking, then blur via true body click.
  await typeIntoFocused('lost text');
  await sleep(200);
  await clickXY(5, 5); // body/HTML background — S4 channel + the F3 blur
  await sleep(1100);   // window stabilize + deliver (S1 attaches at STOP)

  // F-pop 1: plain div click (gate-rejected expected)
  await clickAt('#plain-div');
  await sleep(300);

  // F-pop 2: responding div (evidence-consequential expected)
  await clickAt('#responding-div');
  await sleep(300);

  // F-pop 3: repeat button twice within window
  await clickAt('#repeat-btn');
  await sleep(150);
  await clickAt('#repeat-btn');
  await sleep(300);

  // F-pop 4: popover open + backdrop click-away dismissal.
  // The open-click's FINALIZE arms a 300ms companion-suppression window in
  // the content script — and the finalize itself fires only AFTER the
  // open-click's evidence window stabilizes (~300ms settle + delivery).
  // Net: a dismissal click within roughly click+300ms(settle)+ε+300ms(suppress)
  // ≈ 700–900ms creates NO evidence window (verified: delta runs show the
  // dismissal click absent from pendingEvidence entirely). Sleep 1100ms so
  // the dismissal gets its own window — the suppression is pre-existing
  // A-Slice anti-noise behavior, deliberately not altered by B3.
  await clickAt('#open-popover');
  await sleep(1100);
  await clickXY(5, 5); // backdrop fills viewport (inset 0) → click lands on it
  await sleep(1100);

  await stopRecording();
}

// ── Flow 2: B2 combobox regression ────────────────────────────────────

async function b2RegressionFlow() {
  await navigate('/combobox-typeable-validation.html');
  await startRecording();

  await typeInto('#city-a', 'New');
  await sleep(250);
  await clickAt('li[data-value="New York"]');
  await sleep(250);

  await typeInto('#fruit-b', 'App');
  await pressEnter();
  await sleep(250);

  await typeInto('#search-c', 'hotels');
  await sleep(250);
  await clickAt('#save-btn');
  await sleep(250);

  // Second Save click within 2s → dedup (S2 fold target)
  await clickAt('#save-btn');
  await sleep(250);

  await stopRecording();
}

// ── Run ────────────────────────────────────────────────────────────────

try {
  await censusFlow();
  // RCA probe: allow late-arriving dismissal evidence + the 500ms debounced
  // pendingEvidence persist to land before the dump.
  await sleep(2000);
  const censusStorage = await evalPanel(`chrome.storage.local.get(null)`);
  writeFileSync(`${OUT}/censusflow-storage.json`, JSON.stringify(censusStorage, null, 1));
  // Probe (C3 RCA): the content-script evidence buffer holds every window
  // the collector BUILT+DELIVERED this page lifetime. Read it from the
  // EXTENSION's isolated world — main-world sessionStorage can be partitioned
  // away from the content script's. If the dismissal click's window ever
  // closed, it appears here with sourceEventId evt-59.
  const isoProbe = async () => {
    try {
      const tree = await app.send('Page.getFrameTree');
      const { executionContextId } = await app.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'CR_PROBE', grantUniveralAccess: false });
      return (await app.send('Runtime.evaluate', { expression: `(() => { try { return JSON.parse(sessionStorage.getItem('cmdrunner_evidence_buffer') || '[]').map((e) => ({ src: e.sourceEventId, type: e.sourceEventType, end: e.window?.endReason, dom: (e.applicationEvidence?.domChanges || []).map((d) => d.targetPath) })); } catch (e) { return { err: String(e) }; } })()`, contextId: executionContextId, returnByValue: true })).result.value;
    } catch (e) { return { err: String(e) }; }
  };
  const evBufMain = await evalApp(`(() => { try { return JSON.parse(sessionStorage.getItem('cmdrunner_evidence_buffer') || '[]').length; } catch { return null; } })()`);
  const evBufIso = await isoProbe();
  writeFileSync(`${OUT}/censusflow-evidence-buffer.json`, JSON.stringify({ mainWorldCount: evBufMain, isolatedWorld: evBufIso }, null, 1));
  out(`evidence buffer: main=${evBufMain} iso=${Array.isArray(evBufIso) ? evBufIso.length : JSON.stringify(evBufIso).slice(0, 80)}`);
  const censusCards = readCards(censusStorage, 'censusflow');
  out(`census flow: ${censusCards.length} cards`);

  await reloadPanel();
  await b2RegressionFlow();
  await sleep(400);
  const b2Storage = await evalPanel(`chrome.storage.local.get(null)`);
  writeFileSync(`${OUT}/b2flow-storage.json`, JSON.stringify(b2Storage, null, 1));
  const b2Cards = readCards(b2Storage, 'b2flow');
  out(`b2 flow: ${b2Cards.filter((c) => c.type !== 'Unclassified').length} recognized + ${b2Cards.filter((c) => c.type === 'Unclassified').length} unclassified`);

  const irPlan = b2Storage.execution_ir_plan ?? censusStorage.execution_ir_plan ?? null;
  writeFileSync(`${OUT}/b3-ir-plan.json`, JSON.stringify(irPlan, null, 1));
  writeFileSync(`${OUT}/console-b3.json`, JSON.stringify({ consoleErrors }, null, 1));

  if (MODE === 'full') {
    // A. B2 regression: IR parity
    const steps = irPlan?.steps ?? [];
    const actions = steps.map((s) => s.action);
    check('A1: IR steps present', steps.length > 0, `actions=${JSON.stringify(actions)}`);
    check('A2: zero select steps (B2 parity)', !actions.includes('select'), '');

    // B. S2 dedup fold on B2 flow
    const unclassifiedB2 = b2Cards.filter((c) => c.type === 'Unclassified');
    check('B1: B2 flow zero Unclassified (dedup fold)', unclassifiedB2.length === 0,
      `unc=${JSON.stringify(unclassifiedB2.map((c) => c.name))}`);
    const saveClick = b2Cards.find((c) => c.type === 'Click' && c.name === 'Save');
    check('B2: Save repeat folded (repeatCount ≥ 1)',
      !!saveClick && (saveClick.repeatCount ?? 0) >= 1,
      `save=${JSON.stringify(saveClick && { rc: saveClick.repeatCount, members: saveClick.members })}`);

    // C. census populations
    const unc = censusCards.filter((c) => c.type === 'Unclassified');
    // C1: S4 body/HTML capture — the F-pop-5 body click (5,5). Physical
    // body click now enters the ledger (S4) and projects as an Unclassified
    // card (keydown cards are the CDP typing artifacts hitting body after
    // blur — not S4 subjects).
    const bodyCard = unc.find((c) => (c.tag === 'BODY' || c.tag === 'HTML') && c.physicalEventType === 'click');
    check('C1: backdrop/body click captured (S4)', !!bodyCard,
      `unc=${JSON.stringify(unc.map((c) => ({ n: c.name, t: c.tag, p: c.physicalEventType })))}`);
    if (bodyCard) {
    // C2: the S4 blur-click body card carries JOINED evidence (S1). Its
    // content is consequence-free (blurring an input mutates nothing) —
    // flag=true would be a lie; C3' targets the dismissal card instead.
    check('C2: body card carries evidence (S1)', bodyCard.hasEvidence, '');
    }
    // C3': S5 actionability flag on the BACKDROP DISMISSAL card — the
    // click-away that closes the popover (style display:none + text change
    // land in its window). The backdrop div is the dismissal's actual
    // hit-target (inset:0 fixed overlay); body is the fallback at margins.
    const dismissCard = unc.find((c) => c.tag === 'DIV' && c.sel === '#popover-backdrop' && c.physicalEventType === 'click');
    check('C3: dismissal card actionabilityEvidence (S5)',
      !!dismissCard && dismissCard.actionabilityEvidence === true,
      `dismiss=${JSON.stringify(dismissCard && { hasEv: dismissCard.hasEvidence, flag: dismissCard.actionabilityEvidence })}`);

    const typedCard = unc.find((c) => c.physicalEventType === 'change');
    check('C4: typed-text terminal sample surfaced (S3)', !!typedCard,
      `change=${JSON.stringify(unc.filter((c) => c.physicalEventType === 'check' || c.physicalEventType === 'change').map((c) => ({ n: c.name, v: c.typedValue })))}`);
    if (typedCard) {
      check('C5: terminal value visible', typedCard.typedValue === 'lost text' || /lost text/.test(typedCard.name ?? ''),
        `v=${JSON.stringify(typedCard.typedValue)} n=${JSON.stringify(typedCard.name)}`);
    }

    check('C6: plain div gate-rejected card exists', !!unc.find((c) => /plain div/.test(c.name ?? '')),
      `names=${JSON.stringify(unc.map((c) => c.name))}`);
    const responding = unc.find((c) => /responds/.test(c.name ?? ''));
    check('C7: responding div card exists', !!responding, `names=${JSON.stringify(unc.map((c) => c.name))}`);
    if (responding) {
      check('C8: responding div actionabilityEvidence (S5)', responding.actionabilityEvidence === true,
        `flag=${JSON.stringify(responding.actionabilityEvidence)} hasEv=${responding.hasEvidence}`);
    }

    // D. M5 self-consistency on census flow
    const ver = censusStorage.cmdrunner_verification_result;
    check('D1: M5 verification match', !!ver && ver.match === true,
      `diffs=${JSON.stringify(ver?.differences?.map((d) => d.eventId))}`);

    check('E1: zero panel console errors', consoleErrors.length === 0,
      JSON.stringify(consoleErrors.slice(0, 3)));
  } else {
    out('baseline mode: dumps only, no assertions');
  }
} catch (e) {
  out('HARNESS ERROR:', e?.message ?? e);
  FAIL++;
} finally {
  clearTimeout();
  out(`\n${PASS} PASS / ${FAIL} FAIL`);
  try { chrome.kill(); } catch { /* already dead */ }
  fixture.close();
  process.exit(FAIL ? 1 : 0);
}
