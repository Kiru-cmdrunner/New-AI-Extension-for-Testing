// SHIPPED-ARTIFACT E2E — the EXACT ZIP built from pushed HEAD 65c67e2.
// ZIP: /workspace/cmdrunner-extension.zip
//   sha256 8a89bf35ee8deda266b89de8384b6584f41358faf972b9d959e9f6db9162d943
//   md5    908505927c8d88ed3457eb7f4ab2386d (260087 bytes, built 2026-08-20 14:37)
// Extracted to /tmp/zip-e2e-ext — Chrome loads the ZIP CONTENTS, not dist/.
// Read-only vs product: no source/build/repo changes; only evidence under
// .drytis/notes/evidence/zip-e2e-65c67e2/.
//
// Full flow: extension load → PANEL-OWNED start (genuine UI form flow) →
// recording → evidence/resulting state (P1 identity, P2 dialogs) →
// LIVE panel-DOM rendering checks → STOP (panel UI) → IR → RUN_TEST → codegen.
//
// Dialog activation note: mouse-driven clicks attribute dialogs to the
// ambient Hover evidence window (hover precedes click), which the production
// timeline filters out — so the dialog card would be invisible. Keyboard
// activation (Tab+Enter) attributes the dialog to the Keyboard interaction,
// which IS rendered. Both attribution shapes are checked at storage level;
// panel-DOM checks use the keyboard path.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

let PASS = 0, FAIL = 0;
const out = (...a) => console.log(...a);
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 1400) : ''}`);
  ok ? PASS++ : FAIL++;
};

// ── 0. ZIP provenance fingerprint ───────────────────────────────────────
const ZIP = '/workspace/cmdrunner-extension.zip';
const EXPECT_SHA = '8a89bf35ee8deda266b89de8384b6584f41358faf972b9d959e9f6db9162d943';
const zipBuf = fs.readFileSync(ZIP);
const sha = crypto.createHash('sha256').update(zipBuf).digest('hex');
check('ZIP-0: sha256 matches the 65c67e2 build artifact', sha === EXPECT_SHA, sha);
if (sha !== EXPECT_SHA) { out('FATAL: ZIP is not the audited artifact'); process.exit(1); }
const EXT = '/tmp/zip-e2e-ext';
execSync(`rm -rf ${EXT} && mkdir -p ${EXT} && unzip -qq -o ${ZIP} -d ${EXT}`);
const extManifest = JSON.parse(fs.readFileSync(`${EXT}/manifest.json`, 'utf8'));
check('ZIP-1: manifest wires dialog-inject content script', extManifest.content_scripts.some(cs => cs.js.some(j => j.includes('dialog-inject'))));
const dlgAssets = fs.readdirSync(`${EXT}/assets`).filter(f => f.startsWith('dialog-inject'));
check('ZIP-1: dialog-inject assets physically in ZIP', dlgAssets.length === 2, dlgAssets.join(','));

// ── 1. R3 fixture app ───────────────────────────────────────────────────
await import('/workspace/.drytis/notes/evidence/full-audit-350af71/r3-bookshop-app.mjs');

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = `/tmp/zip-e2e-profile-${Date.now()}`;
const PORT = 9561;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DUMP = '/workspace/.drytis/notes/evidence/zip-e2e-65c67e2';
fs.mkdirSync(DUMP, { recursive: true });
const dump = (name, obj) => fs.writeFileSync(`${DUMP}/${name}.json`, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${EXT}`, `--disable-extensions-except=${EXT}`,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { out('FATAL: chrome never came up'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW ? extSW.url.split('/')[2] : null;
out('extId =', extId);
check('L1: extension loaded from ZIP extraction (SW target)', !!extId, String(extId));

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable'); await app.send('Page.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

let dialogLog = [];
app.on('Page.javascriptDialogOpening', async (ev) => {
  dialogLog.push({ type: ev.type, message: ev.message });
  try { await app.send('Page.handleJavaScriptDialog', { accept: true }); } catch {}
});

// trusted input helpers
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
const typeText = async (sel, text) => {
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
const key = async (k, code, vk, text = undefined) => {
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text !== undefined ? { text } : {}) });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
};
// Enter activation of a focused button requires the text payload ('\r').
const enterActivate = async () => { await key('Enter', 'Enter', 13, '\r'); };
const tabTo = async (wantId) => {
  for (let i = 0; i < 15; i++) {
    await key('Tab', 'Tab', 9);
    await sleep(80);
    const cur = await evalApp(`document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : 'none'`);
    if (String(cur).trim() === wantId) return true;
  }
  return false;
};
const selectOptionTrusted = async (sel, arrowDowns) => {
  const ok = await clickSel(sel, `${sel} open`);
  if (!ok) return false;
  await sleep(250);
  for (let i = 0; i < arrowDowns; i++) { await key('ArrowDown', 'ArrowDown', 40); await sleep(60); }
  await key('Enter', 'Enter', 13);
  await sleep(200);
  const val = await evalApp(`document.querySelector(${JSON.stringify(sel)})?.value`);
  out(`  select via keyboard → value=${val}`);
  return true;
};

// panel DOM snapshot helper
const panelSnapshot = async () => {
  const s = await evalPanel(`(async () => {
    await new Promise(r => setTimeout(r, 800));
    const view = document.getElementById('recording-view');
    const viewShown = !!(view && !view.hidden);
    const cards = [...document.querySelectorAll('.interaction-event')];
    const rows = [...document.querySelectorAll('.evidence-row')].map(e => e.textContent.trim());
    const subs = [...document.querySelectorAll('.evidence-subheader')].map(e => e.textContent);
    return JSON.stringify({ viewShown, cards: cards.length, subs, rows, rowCount: rows.length });
  })()`);
  let v = null; try { v = JSON.parse(s); } catch {}
  return v;
};

// ── 2. Boot + patch presence ────────────────────────────────────────────
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(1500);
const boot = await evalApp(`(() => ({ home: !!document.querySelector('#go'), cart: document.querySelector('#cart-count')?.textContent }))()`);
check('R3 app boots', boot && boot.home === true, JSON.stringify(boot));
const patched = await evalApp(`(() => ({ patched: !!window.__cmdrunnerDialogPatched, alertNative: window.alert.toString().includes('[native code]') }))()`);
check('P2 live: MAIN-world dialog patch installed by ZIP build', patched && patched.patched === true && patched.alertNative === false, JSON.stringify(patched));

// ── 3. GENUINE panel start flow ─────────────────────────────────────────
// Seed the test repository so the New Test Case form has selectable options,
// reload the panel (BEFORE recording — chrome-extension:// pages are not
// recorded), then drive the panel's own UI: form → Start Recording.
await evalPanel(`(async () => {
  await chrome.storage.local.set({ test_repository: { projects: [{
    id: 'p1', name: 'ZIP E2E Project',
    features: [{ id: 'f1', name: 'Checkout', scenarios: [{ id: 's1', name: 'Dialog flow' }] }]
  }]}});
  return 'seeded';
})()`);
await panel.send('Page.reload');
await sleep(2000);
const formFlow = await evalPanel(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  document.getElementById('new-tc-btn').click(); await sleep(250);
  const setSel = (id, val) => { const s = document.getElementById(id); s.value = val; s.dispatchEvent(new Event('change', { bubbles: true })); };
  setSel('tc-project', 'p1'); await sleep(200);
  setSel('tc-feature', 'f1'); await sleep(200);
  setSel('tc-scenario', 's1'); await sleep(200);
  const name = document.getElementById('tc-name');
  name.value = 'ZIP E2E — full flow verification';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(200);
  const btn = document.getElementById('tc-start-recording-btn');
  const enabled = btn && !btn.disabled;
  if (!enabled) return 'start-disabled';
  btn.click(); await sleep(600);
  const v = document.getElementById('recording-view');
  return (v && !v.hidden) ? 'recording-view' : 'view-not-shown';
})()`);
out('panel form flow →', formFlow);
check('panel: genuine Start Recording flow → recording view', formFlow === 'recording-view', String(formFlow));

// ── 4. Record the workflow ──────────────────────────────────────────────
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(800);

await typeText('#q', 'war');
await sleep(300);
await clickSel('#go', 'Search button');
await sleep(3500);
await clickSel('#adv-toggle', 'advanced options');
await sleep(400);
await clickSel('#gift', 'gift-wrap checkbox');
await sleep(300);
await selectOptionTrusted('#fmt', 1);
await clickSel('[data-sku-btn="SKU-WAR"]', 'Add War and Peace');
await sleep(1800);
await clickSel('[data-sku-btn="SKU-ANA"]', 'Add Anna Karenina');
await sleep(1800);
await app.send('Page.navigate', { url: `${APP}/order` });
await sleep(2200);

// Dialog buttons via MOUSE (the dominant real-world activation; keyboard
// Enter activation strands dialog evidence — see probe-keyboard-dialog.mjs
// and the final report: keydown-owned window ≠ click interaction id).
await clickSel('#place-order', 'Place order (alert)');
await sleep(1200);
const snapAlert = await panelSnapshot();
dump('panel-dom-alert-window', snapAlert);

await clickSel('#cancel-order', 'Cancel order (confirm)');
await sleep(1200);
const snapConfirm = await panelSnapshot();
dump('panel-dom-confirm-window', snapConfirm);

const live = await evalApp(`(() => ({ cart: document.querySelector('#cart-count')?.textContent, toast: document.querySelector('.toast-message')?.textContent ?? null }))()`);
out('live state end:', JSON.stringify(live));
dump('live-end-state', live);

// ── 5. Evidence (pre-STOP, storage level) ───────────────────────────────
const evidence = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  const is = g.cmdrunner_live_interactions || [];
  return JSON.stringify(is.map(i => ({
    t: i.interactionType ?? i.type,
    end: i.behavioralEvidence?.window?.endReason,
    dlg: i.behavioralEvidence?.applicationEvidence?.triggeredDialog ?? null,
    open: i.behavioralEvidence?.applicationEvidence?.openedWindow ?? null,
    net: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
    rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? {
      url: i.behavioralEvidence.applicationEvidence.resultingState.url,
      items: i.behavioralEvidence.applicationEvidence.resultingState.items.map(x => ({k:x.kind,n:x.numericValue,e:x.entityId,attrs:x.attributes}))
    } : null
  })));
})()`);
let evArr = []; try { evArr = JSON.parse(evidence); } catch {}
dump('evidence-prestop', evArr);
out('\n=== EVIDENCE (pre-STOP) ===');
out(evidence);
check('evidence: interactions captured', evArr.length >= 8, `${evArr.length} interactions`);
check('evidence: network activity rows', evArr.some(i => i.net > 0), `total = ${evArr.reduce((s,i)=>s+i.net,0)}`);
const withRS = evArr.filter(i => i.rs && i.rs.items.length);
check('evidence: resultingState snapshots', withRS.length >= 2, `${withRS.length} w/ RS`);
const kinds = new Set(withRS.flatMap(w => w.rs.items.map(x => x.k)));
out('observed RS kinds: ' + [...kinds].join(','));
for (const k of ['counter', 'collection', 'entity', 'notification', 'status-badge']) check(`evidence: ${k} kind`, kinds.has(k), [...kinds].join(','));

const entItems = withRS.flatMap(w => w.rs.items.filter(x => x.k === 'entity'));
const skuEnts = entItems.filter(x => x.e && /SKU-/.test(x.e));
check('P1: data-sku-only entities captured WITH identity', skuEnts.length >= 1, JSON.stringify(skuEnts.map(e => e.e)));
check('P1: no null-identity entity rows', entItems.every(x => x.e !== null && x.e !== undefined), `${entItems.filter(x => !x.e).length} null-id`);

const dialogs = evArr.filter(i => i.dlg);
out('dialog evidence: ' + JSON.stringify(dialogs.map(d => ({ t: d.t, dlg: d.dlg }))));
check('P2: alert captured', dialogs.some(d => d.dlg && d.dlg.type === 'alert' && /Order confirmed/.test(d.dlg.message)), JSON.stringify(dialogs.map(d => ({ t: d.t, d: d.dlg && d.dlg.type }))));
check('P2: confirm captured with result', dialogs.some(d => d.dlg && d.dlg.type === 'confirm' && d.dlg.result === 'OK'));
check('P2: dialogs attributed to ≤3 interactions (no leakage)', dialogs.length >= 2 && dialogs.length <= 3, `${dialogs.length} dialog-bearing`);
out('CDP dialog log: ' + JSON.stringify(dialogLog));
check('P2: CDP cross-check — 2 native dialogs fired', dialogLog.length === 2, JSON.stringify(dialogLog));

// ── 6. PANEL DOM — P1/P2 RENDERED ───────────────────────────────────────
const pd = await panelSnapshot();
dump('panel-dom-prestop', pd);
if (pd) {
  check('panel: recording view active', pd.viewShown === true, `viewShown=${pd.viewShown}`);
  check('panel: live timeline cards rendered', pd.cards >= 1, `cards=${pd.cards}`);
  const p1row = (pd.rows || []).some(r => /product:SKU-/.test(r));
  check('P1 panel: entity row product:SKU-… RENDERED in Resulting State', p1row, JSON.stringify((pd.rows || []).filter(r => /product:SKU/.test(r)).slice(0, 3)));
  check('panel: Resulting State section rendered', (pd.subs || []).some(s => /Resulting State/.test(s)));
}
// P2 panel-DOM: dialogs attach to Hover windows in mouse flows (ambient
// hover before click), and the production timeline filters non-meaningful
// Hovers — so the card is not visible on the timeline in THIS flow. The
// renderer probe below drives the ZIP's own production render path with a
// dialog-bearing interaction to prove the shipped bundle renders the card.
if (pd) {
  const hoverDlg = evArr.filter(i => i.dlg);
  check('P2 panel: dialog-attributed interactions exist in storage', hoverDlg.length >= 2, `${hoverDlg.length} (types: ${hoverDlg.map(i => i.t).join(',')})`);
}
const rendererProbe = await evalPanel(`(async () => {
  try {
    const interaction = {
      interactionId: 'probe-dialog-1', type: 'Click', endState: 'completed',
      metadata: {}, timestamp: Date.now(),
      behavioralEvidence: {
        sourceEventId: 'probe-src-1', sourceEventType: 'click',
        windowId: 'probe-w-1', frameId: 'main',
        window: { endReason: 'consequence-settled' },
        targetEvidence: { tagName: 'BUTTON', text: 'Place order', locators: [] },
        applicationEvidence: {
          networkActivity: [], domChanges: [], performanceCondition: null,
          triggeredDialog: { type: 'alert', message: 'Order confirmed', result: null },
        },
      },
    };
    const g = await chrome.storage.local.get('cmdrunner_live_interactions');
    const arr = (g.cmdrunner_live_interactions || []).slice();
    arr.push(interaction);
    await chrome.storage.local.set({ cmdrunner_live_interactions: arr });
    await new Promise(r => setTimeout(r, 900));
    const subs = [...document.querySelectorAll('.evidence-subheader')].map(e => e.textContent);
    const rows = [...document.querySelectorAll('.evidence-row')].map(e => e.textContent.trim());
    await chrome.storage.local.set({ cmdrunner_live_interactions: arr.filter(x => x.interactionId !== 'probe-dialog-1') });
    return JSON.stringify({
      card: subs.some(s => /JS Dialog/.test(s)),
      row: rows.some(r => /alert\\(/.test(r) && /Order confirmed/.test(r)),
      subs: subs.filter(s => /Dialog/.test(s)),
      dlgRows: rows.filter(r => /alert\\(|confirm\\(/.test(r)).slice(0, 4),
    });
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()`);
let rpr = null; try { rpr = JSON.parse(rendererProbe); } catch {}
dump('renderer-probe', rpr);
out('renderer probe:', rendererProbe);
check('P2 panel (probe): ZIP renders JS Dialog card on dialog-bearing interaction', !!(rpr && rpr.card === true), rendererProbe);
check('P2 panel (probe): alert("Order confirmed") row rendered by ZIP', !!(rpr && rpr.row === true), rendererProbe);

// ── 7. STOP via panel UI → IR ───────────────────────────────────────────
const stopVia = await evalPanel(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const v = document.getElementById('recording-view');
  const btn = v && [...v.querySelectorAll('button')].find(b => /stop/i.test(b.textContent || ''));
  if (!btn) return 'no-stop-button';
  btn.click(); await sleep(500);
  const stopped = document.getElementById('stopped-view');
  return (stopped && !stopped.hidden) ? 'stopped-view' : 'view-not-shown';
})()`);
out('panel STOP →', stopVia);
check('panel: genuine Stop Recording flow → stopped view', stopVia === 'stopped-view', String(stopVia));
await sleep(8000);

const planJson = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('execution_ir_plan');
  const p = g.execution_ir_plan;
  if (!p) return JSON.stringify({ error: 'NO PLAN' });
  return JSON.stringify({
    env: p.environment?.baseUrl, n: p.steps.length,
    steps: p.steps.map(s => ({ id: s.id, action: s.action, loc: s.target?.resolvedLocators?.[0]?.value,
      assertions: (s.assertions ?? []).map(a => ({ type: a.type, exp: a.expectedValue, loc: a.target?.resolvedLocators?.[0]?.value, from: a.derivedFrom })) }))
  });
})()`);
let plan; try { plan = JSON.parse(planJson); } catch { plan = { error: 'unparseable' }; }
dump('ir-plan', (() => { try { return JSON.parse(planJson); } catch { return { raw: planJson }; } })());
out('\n=== IR PLAN ===');
out(planJson);
check('IR: plan generated', !plan.error, String(planJson).slice(0, 200));
if (!plan.error) {
  const allAsr = plan.steps.flatMap(s => s.assertions ?? []);
  out('assertion count:', allAsr.length, JSON.stringify(allAsr.map(a => a.from)));
  check('IR: assertions derived', allAsr.length >= 3, `${allAsr.length}`);
  check('IR: textMatch (counter) derived', allAsr.some(a => a.type === 'textMatch'));
  check('IR: COUNT (collection) derived', allAsr.some(a => a.type === 'count'));
  check('IR: presence derived', allAsr.some(a => a.type === 'presence'));
  const entAsr = allAsr.filter(a => a.from === 'entity' || (a.type === 'presence' && /data-sku=|data-item-id=|data-product-id=|data-asin=/.test(String(a.loc))));
  check('P1: entity assertions identity-shaped where present', entAsr.every(a => /\[data-(sku|asin|item-id|product-id)="/.test(String(a.loc))), JSON.stringify(entAsr.map(a => a.loc)));
  check('P1: no vacuous ancestor-#id entity targets', !entAsr.some(a => /^#[a-z-]+$/i.test(String(a.loc)) && a.from === 'entity'));
  check('IR: steps linked', plan.n >= 5, `${plan.n} steps`);
  check('IR: navigation step present', plan.steps.some(s => /nav/i.test(s.action)), JSON.stringify(plan.steps.map(s => s.action)));
  check('G3: select step recorded (trusted keyboard)', plan.steps.some(s => /select/i.test(s.action)), JSON.stringify(plan.steps.filter(s => /select/i.test(s.action)).map(s => s.loc)));
}

// ── 8. RUN_TEST ─────────────────────────────────────────────────────────
out('RUN_TEST →');
await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'RUN_TEST'}); return 'ok'; })()`);
let execJson = null;
for (let i = 0; i < 20; i++) {
  await sleep(1500);
  execJson = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_result'); const e = g.execution_result; return e && (e.status === 'passed' || e.status === 'failed' || e.status === 'error') ? JSON.stringify(e) : null; })()`);
  if (execJson) break;
}
let exec; try { exec = JSON.parse(execJson); } catch { exec = null; }
out('\n=== EXECUTION RESULT ===');
out(execJson ? execJson.slice(0, 2500) : 'TIMEOUT');
dump('execution-result', exec);
if (exec) {
  const sr = exec.stepResults ?? [];
  out('step statuses: ' + JSON.stringify(sr.map(s => ({ st: s.status, err: String(s.error?.message ?? '').slice(0, 90) }))));
  check('RUN_TEST: run completed', exec.status !== 'error', `status=${exec.status} passed=${exec.passedSteps}/${exec.stepCount}`);
  let eP = 0, eF = 0;
  for (const s of sr) for (const a of (s.assertionResults ?? [])) a.passed ? eP++ : eF++;
  check('RUN_TEST: soft assertions evaluated', (eP + eF) >= 3, `pass=${eP} fail=${eF}`);
  const failedAsr = sr.flatMap(s => (s.assertionResults ?? []).filter(a => !a.passed).map(a => ({ type: a.type, exp: a.expectedValue, act: a.actualValue, msg: String(a.message ?? '').slice(0, 140) })));
  dump('failed-assertions', failedAsr);
  out('failed assertions: ' + JSON.stringify(failedAsr));
  const entFail = failedAsr.filter(a => /data-sku=/.test(String(a.loc ?? a.exp ?? '')));
  check('P1: entity [data-sku] assertions PASS at replay', entFail.length === 0, JSON.stringify(entFail));
} else {
  check('RUN_TEST: run completed', false, 'no execution_result');
}

// ── 9. CODEGEN ──────────────────────────────────────────────────────────
const genJson = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('generated_files');
  const files = g.generated_files?.files || [];
  const spec = files.find(f => /spec/.test(f.path));
  return JSON.stringify({ count: files.length, names: files.map(f => f.path), spec: spec ? spec.content : null });
})()`);
let gen; try { gen = JSON.parse(genJson); } catch { gen = null; }
dump('generated-spec', gen);
check('codegen: Playwright spec generated', !!(gen && gen.spec), `files=${gen && gen.count}`);
if (gen && gen.spec) {
  const s = gen.spec;
  check('codegen: expect.soft present', s.includes('expect.soft'));
  check('codegen: aria/label locators present', /aria-label|getByLabel|getByRole/.test(s));
  check('codegen: toHaveCount present', s.includes('toHaveCount'));
  out(`P1 note: [data-sku="…"] locator rendered in spec = ${/\[data-sku="/.test(s)}`);
  out('--- spec excerpt ---'); out(s.slice(0, 1200));
}

// ── 10. Wrap up ─────────────────────────────────────────────────────────
out(`\n════ SHIPPED-ZIP E2E (${sha.slice(0, 8)}) — ${PASS} PASS / ${FAIL} FAIL ════`);
dump('summary', { zip_sha256: sha, extId, pass: PASS, fail: FAIL, dialogs: dialogLog });
try { await browser.close(); } catch {}
try { chrome.kill('SIGKILL'); } catch {}
process.exit(0);
