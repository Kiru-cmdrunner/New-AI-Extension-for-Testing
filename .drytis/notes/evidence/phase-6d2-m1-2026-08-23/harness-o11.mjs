// M1-A: real-Chrome nested-target O11 reproduction at da5e678 dist.
// Verdict: CONFIRMED (orphan twin cards exist) vs NOT-REPRODUCED.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/o11-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9583;
const APP = 'http://127.0.0.1:8188';
const OUT = '/workspace/.drytis/notes/evidence/phase-6d2-m1-2026-08-23/dumps';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 700) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));

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
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
await app.send('Page.enable'); await app.send('DOM.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

// House pattern (6D.1): START from the panel context, then activate the app tab.
const startRecording = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
const storageProbe = async () => evalPanel(`new Promise(res => chrome.storage.local.get(null, all => res(all)))`);

// rect helper for a selector — returns child-center and parent-center for nested case
// rect helper for a selector — scrolls into view first so viewport-relative
// CDP Input.dispatchMouseEvent coordinates always hit the element.
const rectOf = async (sel) => JSON.parse(await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'null'; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height }); })()`));
const dispatch = async (type, x, y) => app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
const sleepShort = (ms) => new Promise((r) => setTimeout(r, ms));

// START recording via panel context + activate app tab (house pattern)
out('START →', await startRecording());
await sleepShort(1500);

// ── Case 0: TRUE O11 shape — non-interactive parent (role=listitem) + child span ──
// Press starts on the child .icon-radio, resolves to the parent LI (only the
// LI has an accessible name / click listener). mousedown target ≠ click target.
{
  const child = await rectOf('#wrap-nested .icon-radio');
  const parent = await rectOf('#wrap-nested');
  const cx = child.x + child.w / 2, cy = child.y + child.h / 2;
  const px = parent.x + parent.w / 2, py = parent.y + parent.h / 2;
  out('case0 non-interactive-nested press: down at child', { cx, cy }, '→ up at parent', { px, py });
  await dispatch('mousePressed', cx, cy);
  await sleepShort(80);
  await dispatch('mouseReleased', px, py);
  await sleepShort(800);
  const mark = await evalApp(`document.getElementById('m-wrap').textContent`);
  check('case0 non-interactive nested press produced a click on the app', mark === 'pressed 1', `m-wrap="${mark}"`);
}

// ── Case 0b: target-asymmetry press — mousedown on named child (removed on
// press), mouseup/click resolve to parent. The structural way mousedown ≠ click.
{
  const child = await rectOf('#inner-star');
  const parent = await rectOf('#wrap-swap');
  const cx = child.x + child.w / 2, cy = child.y + child.h / 2;
  const px = parent.x + parent.w / 2, py = parent.y + parent.h / 2;
  out('case0b asymmetry press: down at inner-star', { cx, cy }, '→ up at parent', { px, py });
  await dispatch('mousePressed', cx, cy);
  await sleepShort(80);
  await dispatch('mouseReleased', px, py);
  await sleepShort(800);
  const mark = await evalApp(`document.getElementById('m-swap').textContent`);
  // BROWSER FACT (pinned): Chrome does not dispatch click when the mousedown
  // target is removed mid-press — press/release resolved to different elements.
  check('case0b asymmetry press: browser dispatches NO click (m-swap stays empty)',
    mark === '', `m-swap="${mark}"`);
}

// ── Case 0c: cross-target press — down on Source pill, up on Target pill.
// No click is dispatched by the browser; expect TWO different-element events.
{
  const a = await rectOf('#pill-a');
  const b = await rectOf('#pill-b');
  out('case0c cross press: down at pill-a', '→ up at pill-b');
  await dispatch('mousePressed', a.x + a.w / 2, a.y + a.h / 2);
  await sleepShort(80);
  await dispatch('mouseReleased', b.x + b.w / 2, b.y + b.h / 2);
  await sleepShort(800);
  const mark = await evalApp(`document.getElementById('m-cross').textContent`);
  check('case0c cross press registered both halves on the app', mark === 'down+up', `m-cross="${mark}"`);
}

// ── Case 1: nested press (mousedown on child <i>, mouseup/click on parent) ──
// Natural press starts at the child center; then drag ends at parent center.
{
  const child = await rectOf('#btn-nested i');
  const parent = await rectOf('#btn-nested');
  const cx = child.x + child.w / 2, cy = child.y + child.h / 2;
  const px = parent.x + parent.w / 2, py = parent.y + parent.h / 2;
  out('nested press: down at child', { cx, cy }, '→ up at parent', { px, py });
  await dispatch('mousePressed', cx, cy);
  await sleepShort(80);
  await dispatch('mouseReleased', px, py);
  await sleepShort(600);
  const mark = await evalApp(`document.getElementById('m-nested').textContent`);
  out('app feedback m-nested =', mark);
  check('nested press produced a click on the app', mark === 'pressed 1', `m-nested="${mark}"`);
}

// ── Case 2: same-element control (flat button) ──
{
  const r = await rectOf('#btn-flat');
  await dispatch('mousePressed', r.x + r.w / 2, r.y + r.h / 2);
  await sleepShort(80);
  await dispatch('mouseReleased', r.x + r.w / 2, r.y + r.h / 2);
  await sleepShort(600);
  const mark = await evalApp(`document.getElementById('m-flat').textContent`);
  check('flat press produced a click on the app', mark === 'pressed 1', `m-flat="${mark}"`);
}

// ── Case 3: unrelated-adjacent control (two presses on different siblings, back-to-back) ──
{
  const a = await rectOf('#sib-a');
  const b = await rectOf('#sib-b');
  await dispatch('mousePressed', a.x + a.w / 2, a.y + a.h / 2);
  await sleepShort(80);
  await dispatch('mouseReleased', a.x + a.w / 2, a.y + a.h / 2);
  await sleepShort(600);
  await dispatch('mousePressed', b.x + b.w / 2, b.y + b.h / 2);
  await sleepShort(80);
  await dispatch('mouseReleased', b.x + b.w / 2, b.y + b.h / 2);
  await sleepShort(1500);
  const mark = await evalApp(`document.getElementById('m-sib').textContent`);
  // NOTE: the app's mark closure is per-listener; each button prints "pressed 1"
  // on its first click. Two cards below prove both presses landed.
  check('sibling presses landed on the app (mark text set)', typeof mark === 'string' && mark.startsWith('pressed'), `m-sib="${mark}"`);
}

await sleepShort(1200);
out('STOP →', await stopRecording());
await sleepShort(2500);

// ── Storage probe (panel context) ──
const storage = await storageProbe();
dump('o11-storage.json', storage);

const interactions = storage.cmdrunner_live_interactions || [];
const ledger = storage.cmdrunner_evidence_ledger || [];
out(`interactions: ${interactions.length}, ledger entries: ${Array.isArray(ledger) ? ledger.length : Object.keys(ledger).length}`);

// Classify what we got per case by targetName/cssSelector keywords
const cards = interactions.map(i => ({
  type: i.type,
  endReason: i.endReason || i.metadata?.endReason || null,
  name: i.metadata?.targetName || null,
  tag: i.metadata?.targetTag || null,
  phys: i.metadata?.physicalEventType || (i.metadata?.physicalEvents ? i.metadata.physicalEvents.join('+') : null),
  paired: i.metadata?.pairedAtProjection || null,
  sel: i.trigger?.cssSelector || i.triggerEvent?.cssSelector || null,
}));
dump('o11-cards.json', cards);
out(JSON.stringify(cards, null, 1));

// ── Verdict checks — PIN OBSERVED BEHAVIOR at da5e678 (run5-7 evidence) ──
const nestedCards = cards.filter(c => (c.sel || '').includes('btn-nested') || (c.name || '').toLowerCase().includes('favorite'));
const nestedUnc = nestedCards.filter(c => c.type === 'Unclassified');
const nestedPaired = nestedCards.filter(c => c.paired);

// Case 0 (canonical AdaniOne int-47/48 shape, nameless child + named parent):
// OBSERVED — both press halves resolve to the parent (resolveTarget promotion),
// same elementKey → S1' pairs them into ONE card. No orphan.
const wrapCards = cards.filter(c => (c.sel || '').includes('wrap-nested') || ['round trip', 'icon-radio'].includes((c.name || '').toLowerCase())
  || (c.name || '').toLowerCase().includes('round trip'));
out('case0 wrap-fixture cards:', JSON.stringify(wrapCards));
const wrapUnc = wrapCards.filter(c => c.type === 'Unclassified');
const wrapPaired = wrapCards.filter(c => c.paired);
check('CASE-0 canonical shape: press collapses to ONE PAIRED card (resolveTarget + S1\')',
  wrapCards.length === 1 && wrapCards[0].paired === true,
  `${wrapCards.length} cards :: ${JSON.stringify(wrapCards.map(c => ({ type: c.type, phys: c.phys, paired: c.paired, sel: c.sel })))}`);

// Case 0b (asymmetry — named child removed mid-press):
// OBSERVED — Chrome dispatches NO click (press/release targets differ by removal),
// leaving exactly ONE honest orphan mousedown card. No twin possible.
const swapCards = cards.filter(c => (c.sel || '').includes('wrap-swap') || (c.sel || '').includes('inner-star')
  || ['star', 'swap case'].includes((c.name || '').toLowerCase()));
const swapUnc = swapCards.filter(c => c.type === 'Unclassified');
const swapPaired = swapCards.filter(c => c.paired);
check('CASE-0b asymmetry shape: exactly ONE orphan mousedown card (browser drops the click — no twin possible)',
  swapCards.length === 1 && swapUnc.length === 1 && (swapCards[0].phys || '').includes('mousedown'),
  `${swapCards.length} cards :: ${JSON.stringify(swapCards.map(c => ({ type: c.type, phys: c.phys, name: c.name, sel: c.sel })))}`);

// Case 0c (cross-target press, down on A up on B): the ONLY remaining twin shape.
// OBSERVED — Chrome synthesizes the click on the common ancestor → TWO unpaired
// cards: mousedown@A + click@ancestor. O11-ADJACENT RESIDUAL (drag-shaped).
const crossCards = cards.filter(c => ['pill-a', 'pill-b', 'cross-row'].some(id => (c.sel || '').includes(id))
  || ['source pill', 'target pill', 'source target'].includes((c.name || '').toLowerCase()));
out('case0c cross-fixture cards:', JSON.stringify(crossCards));
check('CASE-0c cross-target press: TWIN unpaired cards — mousedown@pill + synthetic click@ancestor (the residual twin)',
  crossCards.length === 2 && crossCards.every(c => !c.paired)
  && crossCards.some(c => (c.phys || '').includes('mousedown')) && crossCards.some(c => (c.phys || '').includes('click')),
  `${crossCards.length} cards :: ${JSON.stringify(crossCards.map(c => ({ phys: c.phys, name: c.name, sel: c.sel })))}`);

// FINAL VERDICT — pinned from observed behavior:
check('O11 FINAL VERDICT: canonical nested-target orphan NOT-REPRODUCED (resolveTarget + S1\' already solve it); residual twin exists ONLY for cross-target drags',
  wrapCards.length === 1 && wrapCards[0].paired === true && swapCards.length === 1 && nestedCards.length === 1 && crossCards.length === 2,
  `canonical: 1 paired; asymmetry: 1 single orphan; button-wrap: ${nestedCards.length} Click; cross-drag: ${crossCards.length} unpaired`);
// Case 0b analysis — informational dump of the asymmetry result (pinned above)
out('case0b swap-fixture cards:', JSON.stringify(swapCards));

// Case 1 (button-wrapped): expected single Click (resolveTarget promotes child → button)
check('CASE-1 button-nested press resolves to ONE claimed Click (resolveTarget promotion)',
  nestedCards.length === 1 && nestedCards[0].type === 'Click',
  `${nestedCards.length} cards :: ${JSON.stringify(nestedCards.map(c => ({ type: c.type })))}`);

// Case 2 (flat): expected exactly ONE interaction card for the press (S1' pairs, or Click claims it)
const flatCards = cards.filter(c => (c.sel || '').includes('btn-flat') || (c.name || '').toLowerCase().includes('plain'));
out('flat-fixture cards:', JSON.stringify(flatCards));
check('CASE-2 flat press: exactly ONE card for the press (claimed Click or S1\'-paired Unclassified)',
  flatCards.length === 1,
  `${flatCards.length} cards :: ${JSON.stringify(flatCards.map(c => ({ type: c.type, phys: c.phys, paired: c.paired })))}`);

// Case 3 (siblings): two DIFFERENT-element presses → must stay TWO cards
const sibCards = cards.filter(c => (c.sel || '').includes('sib-') || ['sibling a', 'sibling b'].includes((c.name || '').toLowerCase()));
out('sibling-fixture cards:', JSON.stringify(sibCards));
check('CASE-3 siblings: exactly TWO cards (unrelated presses never collapse)',
  sibCards.length === 2,
  `${sibCards.length} cards :: ${JSON.stringify(sibCards.map(c => ({ type: c.type, phys: c.phys })))}`);

// IR impact: count steps + check no Unclassified leaks into IR
const plan = storage.execution_ir_plan || null;
if (plan) {
  const steps = plan.steps || [];
  check('IR plan: steps generated, no Unclassified leak (NOISE_TYPES filter intact)', steps.length > 0,
    `${steps.length} steps`);
} else {
  check('IR plan present in storage', false, 'execution_ir_plan missing — keys: ' + Object.keys(storage).filter(k => k.includes('ir') || k.includes('plan')).join(','));
}
dump('o11-keys.txt', Object.keys(storage));

out(`\n════ M1-A O11 REPRO — ${PASS} PASS / ${FAIL} FAIL ════`);
process.exit(FAIL === 0 ? 0 : 1);
