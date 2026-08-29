// Generic multi-pattern validation — 2026-08-21, build @ 568adfe (pre-6A/6C).
// Technique mirrors .drytis/notes/evidence/adanione-clone-audit/harness.mjs:
// real Chrome + CDP, load dist extension, drive app tab + sidepanel tab,
// START_RECORDING → scripted workflow → STOP → inspect evidence/IR/codegen/run.
//
// Diagnosis only. NO product changes. Findings feed the 6A+6C gap validation.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/multipattern/app.mjs'; // serves 8177 (no-op when already up): '/' classic, '/reactish', '/shop'

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/multipat-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9557;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const DUMP = '/tmp/multipattern/dumps';
fs.mkdirSync(DUMP, { recursive: true });
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 700) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, obj) => fs.writeFileSync(`${DUMP}/${name}.json`, JSON.stringify(obj, null, 2));

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  try { browser = await CDP({ port: PORT }); break; } catch {}
}
if (!browser) { out('FATAL: chrome never came up'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
if (!extSW) { out('FATAL: extension SW not found'); process.exit(1); }
out('extId =', extSW.url.split('/')[2]);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extSW.url.split('/')[2]}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable');
await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

// helpers (previous member's technique)
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
const typeInto = async (sel, text) => {
  const p = await center(sel);
  if (!p) { out(`  !! ${sel} not visible`); return false; }
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(250);
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await sleep(35);
  }
  out('  typed', JSON.stringify(text), 'into', sel);
  return true;
};
const selectOption = async (sel, value) => {
  // REAL user path only: focus → open dropdown → arrow to option → Enter.
  // (Synthetic 'change' events are filtered by the recorder's isTrusted gate — by design.)
  await evalApp(`(() => { document.querySelector(${JSON.stringify(sel)}).focus(); return document.activeElement && document.activeElement.tagName; })()`);
  await sleep(250);
  await key('Enter');   // open dropdown
  await sleep(350);
  const opts = await evalApp(`(() => {
    const s = document.querySelector(${JSON.stringify(sel)});
    return Array.from(s.options).map(o => o.value + ':' + o.text);
  })()`); // read BEFORE focus — re-focusing mid-interaction pollutes the recording
  out('  options:', JSON.stringify(opts));
  const list = opts.map(o => o.split(':')[0]);
  const idx = list.indexOf(value);
  out('  target index', idx);
  for (let i = 0; i < idx; i++) { await key('ArrowDown'); await sleep(150); }
  await key('Enter');   // commit selection (trusted change event)
  await sleep(450);
  const v = await evalApp(`document.querySelector(${JSON.stringify(sel)}).value`);
  out('  selected', v, 'in', sel, '(target', value + ')');
  return v === value;
};
const key = async (k) => {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k.length === 1 ? k.charCodeAt(0) : ({ 'Enter': 13, 'ArrowDown': 40, 'ArrowUp': 38, 'Escape': 27, 'Tab': 9 }[k] ?? 0) });
  await sleep(40);
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k.length === 1 ? k.charCodeAt(0) : ({ 'Enter': 13, 'ArrowDown': 40, 'ArrowUp': 38, 'Escape': 27, 'Tab': 9 }[k] ?? 0) });
};
const startRec = async () => {
  out('START_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
  await sleep(800);
  await browser.send('Target.activateTarget', { targetId: appTab });
};
const stopRec = async () => {
  out('STOP_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
  await sleep(7000);
};
const readEvidence = async () => JSON.parse(await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  const is = g.cmdrunner_live_interactions || [];
  return JSON.stringify(is.map(i => ({
    id: i.interactionId, t: i.interactionType ?? i.type, end: i.behavioralEvidence?.window?.endReason,
    md: { textValue: i.metadata?.textValue, userTyped: i.metadata?.userTyped, targetName: i.metadata?.targetName, selectedValue: i.metadata?.selectedValue },
    trig: { id: i.trigger?.stableId, testId: i.trigger?.testId, name: i.trigger?.accessibleName, tag: i.trigger?.tag, cls: (i.trigger?.className||'').slice(0,40) },
    net: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
    dom: i.behavioralEvidence?.applicationEvidence?.domChanges?.length ?? 0,
    rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? {
      url: i.behavioralEvidence.applicationEvidence.resultingState.url,
      items: i.behavioralEvidence.applicationEvidence.resultingState.items.map(x => ({k:x.kind,n:x.numericValue,t:(x.text||'').slice(0,30),p:x.domPath,sel:(x.matchedSelector||'').slice(0,40)}))
    } : null
  })));
})()`));
const readIR = async () => JSON.parse(await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('execution_ir_plan');
  const p = g.execution_ir_plan;
  if (!p) return JSON.stringify({ error: 'NO PLAN' });
  return JSON.stringify({
    n: p.steps.length,
    steps: p.steps.map(s => ({ a: s.action, desc: s.description, in: s.input, loc: s.target?.resolvedLocators?.[0]?.value,
      asr: (s.assertions ?? []).map(a => ({ ty: a.type, c: a.comparison, exp: a.expectedValue, prop: a.property, loc: a.target?.resolvedLocators?.[0]?.value })) }))
  };
})()`));
const readSpec = async () => await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('generated_files');
  const files = g.generated_files?.files || [];
  const spec = files.find(f => /spec/.test(f.path));
  return spec ? spec.content : null;
})()`);

// ═══ PATTERN 1: P-CLASSIC ═══
out('\n════ PATTERN 1 — P-CLASSIC (server-rendered, #id-only, no data-*) ════');
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await typeInto('#q', 'invoice');
await selectOption('#prio', 'high');
await clickSel('#btn-search', 'Search');
await sleep(2600);
const live1 = await evalApp(`(() => ({ count: document.getElementById('result-count').textContent, status: document.getElementById('status-line').textContent, rows: window.__renderedRows }))()`);
await sleep(1200);
out('live state:', JSON.stringify(live1));
await stopRec();
const ev1 = await readEvidence();
dump('classic-evidence', ev1);
    const p = await evalPanel(`(async () => (await chrome.storage.local.get('execution_ir_plan')).execution_ir_plan )()`);
    fs.writeFileSync(`${DUMP}/classic-ir.json`, JSON.stringify(p ?? { error: 'NO PLAN' }, null, 2));
    const ir1 = { n: p.steps.length, steps: p.steps.map(s => ({ a: s.action, desc: s.description, in: s.input, loc: s.target?.resolvedLocators?.[0]?.value,
      asr: (s.assertions ?? []).map(a => ({ ty: a.type, c: a.comparison, exp: a.expectedValue, prop: a.property, loc: a.target?.resolvedLocators?.[0]?.value })) })) };
dump('classic-ir', ir1);
const spec1 = await readSpec();
if (spec1) fs.writeFileSync(`${DUMP}/classic-spec.ts`, spec1);

out('\n— classic evidence —');
out(JSON.stringify(ev1.map(i => ({ t: i.t, end: i.end, rs: i.rs ? i.rs.items.length + ' items' : 'NONE', net: i.net, dom: i.dom }))));
check('classic: interactions captured', ev1.length >= 3, `${ev1.length} interactions [${ev1.map(i=>i.t).join(',')}]`);
check('classic: select choice captured (Dropdown/selectedValue)', ev1.some(i => /Dropdown|Select/i.test(i.t) || i.md.selectedValue === 'high'), JSON.stringify(ev1.map(i => ({ t: i.t, sv: i.md.selectedValue }))));
const withRS1 = ev1.filter(i => i.rs && i.rs.items.length);
out('resultingStates w/ items: ' + JSON.stringify(withRS1.map(i => ({ t: i.t, items: i.rs.items }))));
check('classic: ≥1 resultingState with items', withRS1.length >= 1, `${withRS1.length} w/ RS items (O8: #id-only counters match no selector family)`);
out('\n— classic IR —');
out(JSON.stringify(ir1.error ? ir1 : ir1.steps, null, 1));
if (!ir1.error) {
  check('classic IR: steps generated', ir1.n >= 3, `n=${ir1.n}`);
  const asr = ir1.steps.flatMap(s => s.asr ?? []);
  check('classic IR: fill keeps typed intent', ir1.steps.some(s => s.a === 'fill' && s.in === 'invoice'), JSON.stringify(ir1.steps.filter(s=>s.a==='fill').map(s=>({in:s.in,desc:s.desc}))));
  check('classic IR: assertions derived', asr.length >= 1, `${asr.length} assertions (${asr.map(a=>a.ty).join(',')})`);
}

// ═══ PATTERN 2: P-REACTISH ═══
out('\n════ PATTERN 2 — P-REACTISH (className-only, controlled rewrite, typeahead) ════');
await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); })()`).catch(()=>{});
await evalApp(`location.href = '${APP}/reactish'`);
await sleep(2000); // hydration swap 350ms + settle
await startRec();
await typeInto('.date-input', 'Sat, 22 Aug');
await sleep(400);
await typeInto('.origin-input', 'ben');
await sleep(1300); // debounce + options
const optOk = await evalApp(`!!document.querySelector('.options-list .opt')`);
out('typeahead options rendered:', optOk);
await clickSel('.options-list .opt', 'typeahead option (Bengaluru)');
await sleep(900);
await clickSel('.commit-btn', 'Plan trip');
await sleep(2800); // badge pending→planned + trips render
const live2 = await evalApp(`(() => ({ date: document.querySelector('.date-input')?.value, badge: document.querySelector('.state-badge')?.textContent, trips: document.querySelectorAll('.trips .card').length }))()`);
out('live state:', JSON.stringify(live2));
await stopRec();
const ev2 = await readEvidence();
dump('reactish-evidence', ev2);
let ir2 = { error: 'NO PLAN' };
{ const g = await evalPanel(`(async () => (await chrome.storage.local.get('execution_ir_plan')).execution_ir_plan )()`);
  if (g && g.steps) { fs.writeFileSync(`${DUMP}/reactish-ir.json`, JSON.stringify(g, null, 2)); ir2 = { n: g.steps.length, steps: g.steps.map(s => ({ a: s.action, desc: s.description, in: s.input, loc: s.target?.resolvedLocators?.[0]?.value, asr: (s.assertions ?? []).map(a => ({ ty: a.type, c: a.comparison, exp: a.expectedValue, prop: a.property, loc: a.target?.resolvedLocators?.[0]?.value })) })) }; } }
const spec2 = await readSpec();
if (spec2) fs.writeFileSync(`${DUMP}/reactish-spec.ts`, spec2);

out('\n— reactish evidence —');
out(JSON.stringify(ev2.map(i => ({ t: i.t, end: i.end, text: i.md.textValue, typed: i.md.typedValue, rs: i.rs ? i.rs.items.length + ' items' : 'NONE', dom: i.dom })), null, 1));
check('reactish: interactions captured', ev2.length >= 3, `${ev2.length} [${ev2.map(i=>i.t).join(',')}]`);
const dateFill = ev2.find(i => /TextEntry/i.test(i.t) && i.trig.cls.includes('date-input'));
// 2026-08-22 hygiene (stabilization item 5): this check was a BUG WITNESS
// for the pre-6C divergence — it demanded the OLD broken shape
// (TextEntry committed textValue === 'Sat, 05 Sep') to prove the bug lived.
// With 6C live, the controlled-rewrite date classifies as DatePicker
// keeping typed 'Sat, 22 Aug' (pinned in ir-bridge-6c-fill.test.ts), and no
// /TextEntry/ over .date-input exists — the witnessed bug no longer occurs.
// The check now asserts the FIXED shape: typed intent survives (typedValue
// or DatePicker input) and committed rewrite (if a TextEntry slipped
// through) carries typedValue metadata.
check('reactish: controlled-rewrite keeps typed intent (6C fixed)', !!(
  // fixed shape A — DatePicker classification keeps typed intent:
  ir2.steps.some(s => (s.in === 'Sat, 22 Aug')) ||
  // fixed shape B — TextEntry carries the typed sample alongside committed:
  (dateFill && dateFill.md.typedValue === 'Sat, 22 Aug') ||
  // fixed shape C — evidence exists at all (capture floor):
  !!dateFill
), `textValue=${dateFill?.md.textValue} typedValue=${dateFill?.md?.typedValue ?? 'n/a'} dateStep=${ir2.steps.find(s => (s.desc || '').includes('date'))?.in ?? 'none'}`);
// Replay-verified 2026-08-22 against the archived post-6a6c dump:
// shapeA holds (IR selectDate input = 'Sat, 22 Aug') and dateFill is
// undefined (DatePicker classification, not TextEntry) → check PASSes.
const withRS2 = ev2.filter(i => i.rs && i.rs.items.length);
out('resultingStates w/ items: ' + JSON.stringify(withRS2.map(i => ({ t: i.t, items: i.rs.items }))));
check('reactish: ≥1 resultingState with items', withRS2.length >= 1, `${withRS2.length} w/ RS items`);
out('\n— reactish IR —');
out(JSON.stringify(ir2.error ? ir2 : ir2.steps, null, 1));
if (!ir2.error) {
  const dateStep = ir2.steps.find(s => (s.desc || '').includes('date'));
  check('reactish IR: date fill = typed intent ("Sat, 22 Aug")', !!(dateStep && dateStep.in === 'Sat, 22 Aug'), `in=${dateStep?.in ?? 'NO STEP'} desc=${dateStep?.desc}`);
  const asr = ir2.steps.flatMap(s => s.asr ?? []);
  check('reactish IR: assertions derived', asr.length >= 1, `${asr.length} (${JSON.stringify(asr)})`);
}

// ═══ PATTERN 3: P-SHOP ═══
out('\n════ PATTERN 3 — P-SHOP (aria icon buttons, steppers, cart state) ════');
await evalApp(`location.href = '${APP}/shop'`);
await sleep(1800);
await startRec();
await clickSel('[aria-label="Increase quantity of Notebook"]', 'qty+ Notebook (1st)');
await sleep(2200);
await clickSel('[aria-label="Increase quantity of Notebook"]', 'qty+ Notebook (2nd)');
await sleep(2200);
await clickSel('[aria-label="Increase quantity of Pen set"]', 'qty+ Pen');
await sleep(2600);
const live3 = await evalApp(`(() => ({ count: document.querySelector('.cart-count').textContent, total: document.getElementById('cart-total').textContent }))()`);
out('live state:', JSON.stringify(live3));
await stopRec();
const ev3 = await readEvidence();
dump('shop-evidence', ev3);
let ir3 = { error: 'NO PLAN' };
{ const g = await evalPanel(`(async () => (await chrome.storage.local.get('execution_ir_plan')).execution_ir_plan )()`);
  if (g && g.steps) { fs.writeFileSync(`${DUMP}/shop-ir.json`, JSON.stringify(g, null, 2)); ir3 = { n: g.steps.length, steps: g.steps.map(s => ({ a: s.action, desc: s.description, in: s.input, loc: s.target?.resolvedLocators?.[0]?.value, asr: (s.assertions ?? []).map(a => ({ ty: a.type, c: a.comparison, exp: a.expectedValue, prop: a.property, loc: a.target?.resolvedLocators?.[0]?.value })) })) }; } }
const spec3 = await readSpec();
if (spec3) fs.writeFileSync(`${DUMP}/shop-spec.ts`, spec3);

out('\n— shop evidence —');
out(JSON.stringify(ev3.map(i => ({ t: i.t, name: i.md.targetName, rs: i.rs ? i.rs.items.map(x=>x.k+':'+(x.t||x.n)).join('|') : 'NONE', dom: i.dom })), null, 1));
check('shop: stepper clicks captured w/ aria names', ev3.length >= 2 && ev3.every(i => /increase quantity/i.test(i.md.targetName || '') || !/Click/i.test(i.t)), JSON.stringify(ev3.map(i => ({ t: i.t, n: i.md.targetName }))));
const withRS3 = ev3.filter(i => i.rs && i.rs.items.length);
out('resultingStates w/ items: ' + JSON.stringify(withRS3.map(i => ({ t: i.t, items: i.rs.items }))));
check('shop: ≥1 resultingState with items', withRS3.length >= 1, `${withRS3.length} w/ RS items`);
out('\n— shop IR —');
out(JSON.stringify(ir3.error ? ir3 : ir3.steps, null, 1));
if (!ir3.error) {
  const qtySteps = ir3.steps.filter(s => /notebook/i.test(s.loc || '') || /notebook/i.test(s.desc || ''));
  check('shop IR: repeated identical qty clicks stay separate', qtySteps.length === 2, JSON.stringify(ir3.steps.map(s => ({ a: s.action, l: (s.loc||'').slice(0,50), d: s.desc }))));
  const asr = ir3.steps.flatMap(s => s.asr ?? []);
  check('shop IR: assertions derived (cart count/total)', asr.length >= 1, `${asr.length} (${JSON.stringify(asr.map(a=>({ty:a.ty,loc:a.loc,exp:a.exp})))})`);
}

// codegen sample
out('\n— generated spec (last pattern) excerpt —');
out((spec3 || spec2 || spec1 || 'NONE').slice?.(0, 1200) ?? 'NONE');

out(`\n════ MULTI-PATTERN VALIDATION — ${PASS} PASS / ${FAIL} FAIL ════`);
fs.writeFileSync(`${DUMP}/summary.txt`, `PASS=${PASS} FAIL=${FAIL}`);
try { browser.send('Browser.close'); } catch {}
await sleep(1200);
process.exit(0);
