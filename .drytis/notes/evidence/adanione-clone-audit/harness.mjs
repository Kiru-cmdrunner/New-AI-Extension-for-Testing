// AdaniOne-tech-clone E2E audit — real Chrome 148 + current dist build.
// Records on http://127.0.0.1:8166 (clone reproducing adanione.com technical
// characteristics), then verifies: evidence → IR plan → codegen → RUN_TEST.
// Diagnosis only: NO product changes; failures = documented findings.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
await import('/tmp/adanione-clone/app.mjs'); // embedded clone server (port 8166)

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/clone-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9553;
const APP = 'http://127.0.0.1:8166';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const DUMP = '/tmp/clone-dumps';
fs.mkdirSync(DUMP, { recursive: true });
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 900) : ''}`);
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
  try { browser = await CDP({ port: PORT }); break; } catch { /* retry */ }
}
if (!browser) { out('FATAL: chrome never came up on', PORT); try { chrome.kill('SIGKILL'); } catch {} process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
if (!extSW) { out('FATAL: extension SW not found'); process.exit(1); }
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable');
await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

// ── Verify clone behaviours actually fire before recording ──
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(2600); // hydration swap 300ms + late widget 700ms + settle
const boot = await evalApp(`(() => ({
  origin: !!document.querySelector('[data-auto-id="search-origin"]'),
  grid: !!document.querySelector('[data-auto-id="services-grid"]'),
  beacons: performance.getEntriesByType('resource').filter(r => r.name.includes('/collect')).length
}))()`);
out('clone boot:', JSON.stringify(boot));
check('clone: late widget search UI present', boot && boot.origin === true, JSON.stringify(boot));
check('clone: hydration target present', boot && boot.grid === true, '');

// ── helpers ──
const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => {
  const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value;
  return v === 'null' ? null : JSON.parse(v);
};
const clickSel = async (sel, label) => {
  const p = await center(sel);
  if (!p) { out(`  !! ${sel} not clickable (null/hidden)`); return false; }
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

// ══ RECORD THE ADANIONE-STYLE WORKFLOW ══
out('START_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(800);
await browser.send('Target.activateTarget', { targetId: appTab });

// 1. typeahead on late-injected widget input (AJAX + dynamic options)
await sleep(1200); // ensure widget present
await typeInto('[data-auto-id="search-origin"]', 'mum');
await sleep(1600); // debounce 400 + fetch 250 + options render
const optOk = await evalApp(`!!document.querySelector('[data-auto-id="airport-opt-0"]')`);
out('  typeahead options rendered:', optOk);
await clickSel('[data-auto-id="airport-opt-0"]', 'dynamic typeahead option (BOM — Mumbai)');
await sleep(900);

// 2. search flights → SOFT navigation to /flights (skeleton → content 900ms)
await clickSel('[data-auto-id="search-flights"]', 'Search flights button');
await sleep(1400); // within skeleton window? give it the transition
const skelVisible = await evalApp(`!!document.querySelector('[data-auto-id="skel-0"]')`);
out('  skeletons visible post-softnav:', skelVisible);
await sleep(1600); // content swap done

// 3. icon-only button with aria-label (extras disclosure)
await clickSel('[data-auto-id="extras-F2"]', 'icon-only extras button (aria-label)');
await sleep(700);
// 4. state-changing action behind it (POST /api/cart/add) + delayed 1.2s follow-up
await clickSel('[data-auto-id="add-meal-F2"]', 'Add meal (AJAX POST state change)');
await sleep(3000); // POST 500ms + delayed mutation 1200ms + settle

// 5. soft-nav to cart via header link
await clickSel('[data-auto-id="nav-cart-link"]', 'header Cart link (soft nav)');
await sleep(2500); // cart skeleton + fetch

// 6. qty + button on cart (repeated 2x → repeated-action semantics)
await clickSel('[data-auto-id="qty-plus-MEAL"]', 'qty plus (1st)');
await sleep(2200);
await clickSel('[data-auto-id="qty-plus-MEAL"]', 'qty plus (2nd — repeated identical)');
await sleep(3000);

const liveCart = await evalApp(`(() => ({ count: document.querySelector('[data-auto-id="cart-count"]')?.textContent, qty: document.querySelector('[data-auto-id="qty-SKU-A"]')?.textContent, total: document.querySelector('[data-auto-id="cart-total"]')?.textContent, meals: document.querySelector('[data-auto-id="meal-status-CART"]')?.hidden }))()`);
out('live cart state after workflow:', JSON.stringify(liveCart));
dump('live-cart-state', liveCart);

// ── EVIDENCE inspection ──
const evidence = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  const is = g.cmdrunner_live_interactions || [];
  return JSON.stringify(is.map(i => ({
    t: i.interactionType ?? i.type,
    end: i.behavioralEvidence?.window?.endReason,
    net: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
    rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? {
      url: i.behavioralEvidence.applicationEvidence.resultingState.url,
      items: i.behavioralEvidence.applicationEvidence.resultingState.items.map(x => ({k:x.kind,n:x.numericValue,e:x.entityId,p:x.domPath}))
    } : null
  })));
})()`);
out('\n=== EVIDENCE (pre-STOP) ===');
out(evidence);
let evArr = []; try { evArr = JSON.parse(evidence); } catch {}
dump('evidence-prestop', evArr);
check('evidence: interactions captured', evArr.length >= 4, `${evArr.length} interactions`);
check('evidence: network activity recorded (AJAX seen)', evArr.some(i => i.net > 0), `total net rows = ${evArr.reduce((s, i) => s + i.net, 0)}`);
const withRS = evArr.filter(i => i.rs && i.rs.items.length);
check('evidence: ≥1 resultingState with items', withRS.length >= 1, `${withRS.length} w/ RS`);
out('interactions w/ RS: ' + JSON.stringify(withRS.map(w => ({ t: w.t, url: (w.rs.url||'').replace(APP,''), items: w.rs.items.map(x => x.p + (x.n != null ? '=' + x.n : '')) }))));
const softNavs = evArr.filter(i => i.t === 'Navigation' || (i.rs && i.rs.url && i.rs.url.includes('/flights')));
check('evidence: soft navigation captured', softNavs.length >= 1, JSON.stringify(softNavs.map(s => ({ t: s.t, url: (s.rs?.url || '').replace(APP, '') }))));

// ── STOP → IR ──
out('STOP_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(7000);

const planJson = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('execution_ir_plan');
  const p = g.execution_ir_plan;
  if (!p) return JSON.stringify({ error: 'NO PLAN' });
  return JSON.stringify({
    env: p.environment?.baseUrl,
    n: p.steps.length,
    steps: p.steps.map(s => ({
      id: s.id, action: s.action, src: s.sourceEventId,
      loc: s.target?.resolvedLocators?.[0]?.value,
      assertions: (s.assertions ?? []).map(a => ({ type: a.type, comp: a.comparison, exp: a.expectedValue, loc: a.target?.resolvedLocators?.[0]?.value, src: a.sourceEventId }))
    }))
  });
})()`);
out('\n=== IR PLAN ===');
out(planJson);
dump('ir-plan', (() => { try { return JSON.parse(planJson); } catch { return { raw: planJson }; } })());
let plan; try { plan = JSON.parse(planJson); } catch { plan = { error: 'unparseable' }; }
check('IR plan: generated', !plan.error, String(planJson).slice(0, 250));
if (!plan.error) {
  check('IR plan: ≥4 steps', plan.n >= 4, `n=${plan.n}`);
  const srcs = plan.steps.map(s => s.src);
  check('IR plan: distinct sourceEventIds', new Set(srcs).size === srcs.length, srcs.join(' | ').slice(0, 300));
  const qtySteps = plan.steps.filter(s => (s.loc || '').toLowerCase().includes('increase quantity'));
  check('IR plan: repeated identical qty-plus clicks stay separate (OR-1)', qtySteps.length === 2, JSON.stringify(plan.steps.map(s => ({ a: s.action, l: s.loc }))));
  const softNavStep = plan.steps.filter(s => /nav|goto|navigate/i.test(s.action) || (s.loc || '').toLowerCase().includes('cart'));
  check('IR plan: cart soft-nav represented', softNavStep.length >= 1, '');
  const mealStep = plan.steps.filter(s => (s.loc || '').toLowerCase().includes('meal'));
  check('IR plan: aria-labeled meal button step present', mealStep.length >= 1, '');
  const allAsr = plan.steps.flatMap(s => s.assertions ?? []);
  check('IR plan: assertions derived', allAsr.length >= 3, `${allAsr.length} assertions`);
  out('assertions detail: ' + JSON.stringify(allAsr));
  const cartCountAsr = allAsr.find(a => (a.loc || '').includes('cart-count'));
  const cartTotalAsr = allAsr.find(a => (a.loc || '').includes('cart-total'));
  check('IR plan: header cart-count assertion derived', !!cartCountAsr, cartCountAsr ? `exp=${cartCountAsr.exp}` : 'none');
  check('IR plan: cart-total assertion derived', !!cartTotalAsr, cartTotalAsr ? `exp=${cartTotalAsr.exp}` : 'none');
  // skeleton-era assertions would be false-positive risks
  const skelAsr = allAsr.filter(a => (a.loc || '').includes('skel'));
  check('IR plan: no skeleton-state assertions (would be false positives)', skelAsr.length === 0, JSON.stringify(skelAsr));
  // contradictory same-locator expectations
  const byLoc = {};
  allAsr.forEach(a => { const k = (a.loc || '') + '|' + a.type; (byLoc[k] = byLoc[k] || []).push(a.exp); });
  const contrad = Object.entries(byLoc).filter(([k, v]) => new Set(v).size > 1);
  check('IR plan: no contradictory same-locator expectations', contrad.length === 0, JSON.stringify(contrad));
}

// ── RUN_TEST ──
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
out(execJson ? execJson.slice(0, 3000) : 'TIMEOUT waiting execution_result');
dump('execution-result', exec);
if (exec) {
  check('RUN_TEST: run completed', exec.status !== 'error', `status=${exec.status} steps=${exec.stepCount} passed=${exec.passedSteps}`);
  const sr = exec.stepResults ?? [];
  dump('assertion-results', sr.flatMap(s => (s.assertionResults ?? []).map(a => ({ step: s.stepId ?? s.id, ...a }))));
  out('step statuses: ' + JSON.stringify(sr.map(s => ({ id: s.stepId ?? s.id, st: s.status, err: s.error?.type ?? null }))));
  let softE = 0, softP = 0, softF = 0;
  for (const s of sr) for (const a of (s.assertionResults ?? [])) { softE++; a.passed ? softP++ : softF++; }
  check('RUN_TEST: soft assertions evaluated + recorded', softE >= 3, `evaluated=${softE} pass=${softP} fail=${softF}`);
  const failedAsr = sr.flatMap(s => (s.assertionResults ?? []).filter(a => !a.passed).map(a => ({ step: s.stepId, type: a.type, exp: a.expectedValue, act: a.actualValue, msg: String(a.message ?? '').slice(0, 160) })));
  dump('failed-assertions', failedAsr);
  out('failed assertions: ' + JSON.stringify(failedAsr));
} else {
  check('RUN_TEST: run completed', false, 'no execution_result');
}

// ── Codegen ──
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
  check('codegen: aria-locator or role usage for icon buttons', /aria-label|getByRole|getByLabel/.test(s), '');
  check('codegen: soft assertions present', s.includes('expect.soft'), '');
  out('--- spec excerpt ---');
  out(s.slice(0, 1600));
}

out(`\n════ ADANIONE-CLONE AUDIT — ${PASS} PASS / ${FAIL} FAIL ════`);
fs.writeFileSync(`${DUMP}/summary.txt`, `PASS=${PASS} FAIL=${FAIL}`);
try { browser.send('Browser.close'); } catch {}
await sleep(1200);
process.exit(0);
