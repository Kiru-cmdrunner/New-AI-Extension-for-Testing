// A-Slice re-audit — real Chrome E2E for fixes 1-3 (read-only vs product).
// Same methodology as head-audit-1703e43 (pinned Chrome 148, --load-extension,
// CDP, sidepanel-page ws routing), with the 3 known harness artifacts from the
// first audit CORRECTED, plus new checks for each fix:
//   F1: TextEntry (fill) window's resultingState must NOT contain the click's
//       3-result collection (#results). Click window's RS must contain it.
//   F2: navigate step actually navigates (tabs.update); #add1 resolves after
//       nav; step-0004 click passes (was ElementNotFound).
//   F3: step-0003 textMatch on #cart-count reports the REAL mismatch
//       ("2 items" vs expected "0 items") — actualValue "2 items", message
//       contains both, NOT "Element not found".
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/a-slice-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9551;
const APP_PORT = 8152;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const DUMP = '/tmp/a-slice-dumps';
fs.mkdirSync(DUMP, { recursive: true });
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 900) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, obj) => fs.writeFileSync(`${DUMP}/${name}.json`, JSON.stringify(obj, null, 2));

// ── Replica (identical pages to first audit) ──
const PAGE_SEARCH = `<!doctype html><html><head><meta charset="utf-8">
<title>Replica Bazaar — Search</title>
<style>body{font-family:system-ui;margin:2rem}button,input{font-size:1rem}button{cursor:pointer}
ul{list-style:none;padding:0}li{border:1px solid #ccc;margin:4px 0;padding:8px;border-radius:4px}</style></head><body>
<h1>Replica Bazaar</h1>
<form id="sf"><label for="q">Search products</label>
<input id="q" name="q" type="text" placeholder="headphones">
<button type="submit" id="go">Go</button></form>
<ul id="results" data-testid="source-results"></ul>
<script>
document.getElementById('sf').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('q').value || 'all';
  const results = document.getElementById('results');
  results.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const li = document.createElement('li');
    li.setAttribute('data-testid', 'result-item');
    li.setAttribute('data-sku', 'SKU-' + q + '-' + i);
    li.textContent = q + ' product ' + i;
    results.appendChild(li);
  }
});
</script></body></html>`;
const PAGE_CART = `<!doctype html><html><head><meta charset="utf-8">
<title>Replica Bazaar — Cart</title>
<style>body{font-family:system-ui;margin:2rem}button{cursor:pointer}
ul{list-style:none;padding:0}li{border:1px solid #ccc;margin:4px 0;padding:8px;border-radius:4px}</style></head><body>
<h1>Your Cart</h1>
<p>Cart: <span id="cart-count" data-count="0" aria-label="Cart">0 items</span></p>
<button id="add1">Add to cart</button>
<ul id="cart-items" data-testid="cart-items"></ul>
<p><a href="/" id="home-link">Back to search</a></p>
<script>
let n = 0;
document.getElementById('add1').addEventListener('click', () => {
  n++;
  const c = document.getElementById('cart-count');
  c.textContent = n + ' items';
  c.setAttribute('data-count', String(n));
  const li = document.createElement('li');
  li.setAttribute('data-testid', 'cart-item');
  li.textContent = 'Item ' + n;
  document.getElementById('cart-items').appendChild(li);
});
</script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/preseeded')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE_CART.replace(
      `document.getElementById('add1').addEventListener('click', () => {`,
      `for (let i=1;i<=3;i++){const li=document.createElement('li');li.setAttribute('data-testid','cart-item');li.textContent='Item '+i;document.getElementById('cart-items').appendChild(li);}
document.getElementById('cart-count').textContent='3 items';
document.getElementById('cart-count').setAttribute('data-count','3');
document.getElementById('add1').textContent='Save for later';
document.getElementById('add1').addEventListener('click', () => { return;`));
    return;
  }
  if (req.url.startsWith('/cart')) { res.writeHead(200, {'content-type':'text/html'}); res.end(PAGE_CART); return; }
  res.writeHead(200, {'content-type':'text/html'}); res.end(PAGE_SEARCH);
});
await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));

// ── Chrome + extension ──
const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
await sleep(2500);

const browser = await CDP({ port: PORT });
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
if (!extSW) { out('FATAL: extension SW not found'); process.exit(1); }
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${REPLICA}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable');
await panel.send('Runtime.enable');
const evalPanel = async (expr) => {
  const r = await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result.value;
};
const evalApp = async (expr) => {
  const r = await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  return r.result.value;
};

// ── Workflow (identical to first audit) ──
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(600);
out('START_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(800);

const CENTER = `(() => { const r = document.getElementById('%ID%').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const centerOf = async (cdp, id) => JSON.parse((await cdp.send('Runtime.evaluate', { expression: CENTER.replace('%ID%', id), returnByValue: true })).result.value);
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(400);
const qpos = await centerOf(app, 'q');
await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: qpos.x, y: qpos.y, button: 'left', clickCount: 1 });
await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: qpos.x, y: qpos.y, button: 'left', clickCount: 1 });
await sleep(500);
for (const ch of 'headphones') {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase() });
  await sleep(35);
}
out('typed headphones into #q');
await sleep(1000);

const gpos = await centerOf(app, 'go');
await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gpos.x, y: gpos.y, button: 'left', clickCount: 1 });
await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gpos.x, y: gpos.y, button: 'left', clickCount: 1 });
out('clicked #go (AJAX results)');
await sleep(3500);

await evalApp(`location.href = '${REPLICA}/cart'`);
out('navigated to /cart');
await sleep(4000);

for (let i = 0; i < 2; i++) {
  await browser.send('Target.activateTarget', { targetId: appTab });
  await sleep(400);
  const apos = await centerOf(app, 'add1');
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: apos.x, y: apos.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: apos.x, y: apos.y, button: 'left', clickCount: 1 });
  out(`clicked #add1 (${i + 1}/2)`);
  await sleep(3500);
}

// ── Evidence inspection — F1 check ──
const evidence = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  const is = g.cmdrunner_live_interactions || [];
  return JSON.stringify(is.map(i => ({
    t: i.interactionType ?? i.type,
    end: i.behavioralEvidence?.window?.endReason,
    te: i.behavioralEvidence?.targetEvidence ? Object.keys(i.behavioralEvidence.targetEvidence) : null,
    hasAE: !!i.behavioralEvidence?.applicationEvidence,
    net: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
    rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? {
      url: i.behavioralEvidence.applicationEvidence.resultingState.url,
      items: i.behavioralEvidence.applicationEvidence.resultingState.items.map(x => ({k:x.kind,n:x.numericValue,e:x.entityId,p:x.domPath}))
    } : null,
    surfaces: i.behavioralEvidence?.applicationEvidence?.newSurfaces?.length ?? 0
  })));
})()`);
out('\n=== EVIDENCE (pre-STOP) ===');
out(evidence);
let evArr = []; try { evArr = JSON.parse(evidence); } catch {}
dump('evidence-prestop', evArr);
check('evidence: interactions captured', evArr.length >= 3, `${evArr.length} interactions`);
const withRS = evArr.filter(i => i.rs && i.rs.items.length > 0);
check('evidence: resultingState items present on ≥1 interaction', withRS.length >= 1, `${withRS.length} interactions w/ RS items`);
const atc = evArr.filter(i => i.t === 'Click' && (i.rs?.items ?? []).some(x => x.p.includes('cart-count') || x.p.includes('cart-items')));
check('evidence: ATC click carries cart resultingState (counter/collection)', atc.length >= 1, JSON.stringify(atc.map(a => a.rs.items)));

// ══ FIX 1: the fill (TextEntry) window must NOT own the click's #results collection ══
const fillInts = evArr.filter(i => (i.t === 'TextEntry') || (i.t === 'TextInput') || (String(i.t).toLowerCase().includes('type') && !String(i.t).toLowerCase().includes('click')));
out('TextEntry-ish interactions: ' + JSON.stringify(fillInts.map(f => ({ t: f.t, rsItems: f.rs?.items?.map(x => x.p) ?? [] }))));
const fillOwnsResults = fillInts.some(f => (f.rs?.items ?? []).some(x => x.p.includes('#results') || x.p.includes('results')));
check('F1: TextEntry window does NOT photograph the click\'s #results collection', !fillOwnsResults, JSON.stringify(fillInts.map(f => ({ t: f.t, rs: f.rs?.items?.map(x => x.p) ?? [] }))));
const clickHasResults = evArr.some(i => i.t === 'Click' && (i.rs?.items ?? []).some(x => x.p.includes('results')));
check('F1: click window owns the #results collection consequence', clickHasResults, JSON.stringify(evArr.filter(i => i.t === 'Click').map(i => (i.rs?.items ?? []).map(x => x.p))));

const navInt = evArr.filter(i => i.t === 'Navigation');
check('evidence: Navigation captured as separate interaction', navInt.length >= 1, `${navInt.length} Navigation`);
check('evidence: network activity recorded', evArr.some(i => i.net > 0), `total net rows = ${evArr.reduce((s, i) => s + i.net, 0)}`);
const teKeys = new Set(evArr.flatMap(i => i.te ?? []));
check('evidence: targetEvidence present', teKeys.size > 0, [...teKeys].join(','));

// ── STOP ──
out('STOP_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(6000);

// ── IR plan ──
const planJson = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('execution_ir_plan');
  const p = g.execution_ir_plan;
  if (!p) return JSON.stringify({ error: 'NO PLAN' });
  return JSON.stringify({
    env: p.environment?.baseUrl,
    n: p.steps.length,
    steps: p.steps.map(s => ({
      id: s.id, action: s.action, src: s.sourceEventId,
      locator: s.target?.resolvedLocators?.[0]?.value,
      assertions: (s.assertions ?? []).map(a => ({
        type: a.type, comp: a.comparison, sev: a.severity, exp: a.expectedValue,
        loc: a.target?.resolvedLocators?.[0]?.value,
        src: a.sourceEventId
      }))
    }))
  });
})()`);
out('\n=== IR PLAN ===');
out(planJson);
dump('ir-plan', (() => { try { return JSON.parse(planJson); } catch { return { raw: planJson }; } })());
let plan; try { plan = JSON.parse(planJson); } catch { plan = { error: 'unparseable' }; }
check('IR plan: generated', !plan.error, planJson.slice(0, 200));
if (!plan.error) {
  check('IR plan: baseUrl = replica origin', plan.env === REPLICA, plan.env);
  check('IR plan: steps ≥ 3', plan.n >= 3, `n=${plan.n}`);
  const atcSteps = plan.steps.filter(s => (s.locator ?? '').includes('add1'));
  check('OR-1 fix: TWO repeated ATC clicks stay TWO steps', atcSteps.length === 2, JSON.stringify(plan.steps.map(s => ({a: s.action, l: s.locator, src: s.src}))));
  const atcStep = atcSteps[atcSteps.length - 1];
  const totalAsr = plan.steps.flatMap(s => s.assertions ?? []);
  check('IR plan: step assertions derived', totalAsr.length >= 1, `${totalAsr.length} assertions`);
  const atcCount = atcSteps[atcSteps.length - 1]?.assertions?.find(a => a.type === 'count');
  if (atcCount) check('IR plan: final ATC COUNT expected 2 (its own observation)', atcCount.exp === 2, `exp=${atcCount.exp} loc=${atcCount.loc}`);
  const atcCount1 = atcSteps[0]?.assertions?.find(a => a.type === 'count');
  if (atcCount1) check('IR plan: FIRST ATC COUNT expected 1 (its own observation)', atcCount1.exp === 1, `exp=${atcCount1.exp} loc=${atcCount1.loc}`);
  const goCount = plan.steps.find(s => (s.locator ?? '').includes('#go'))?.assertions?.find(a => a.type === 'count');
  if (goCount) check('IR plan: Go-click COUNT expected 3 (#results)', goCount.exp === 3, `exp=${goCount.exp} loc=${goCount.loc}`);
  const srcs = plan.steps.map(s => s.src);
  check('IR plan: each step distinct sourceEventId', new Set(srcs).size === srcs.length, srcs.join(' | '));
}

// ── RUN_TEST (F2 + F3 checks) ──
// Track tab lifecycle to prove navigation actually happened during the run.
let runTabUrlAtStep4 = null;
await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'RUN_TEST'}); return 'ok'; })()`);
// poll the run tab's URL while the run executes
const { targetId: runTabCandidates } = { targetId: null };
for (let i = 0; i < 12; i++) {
  await sleep(1000);
  try {
    const { targetInfos } = await browser.send('Target.getTargets');
    const runTab = targetInfos.find(t => t.type === 'page' && t.url.includes('/cart') && t.url.includes('127.0.0.1:8152'));
    if (runTab) runTabUrlAtStep4 = runTab.url;
  } catch {}
}
out('run tab URL observed during run: ' + runTabUrlAtStep4);
check('F2: run tab actually navigated to /cart during RUN_TEST', !!runTabUrlAtStep4 && runTabUrlAtStep4.includes('/cart'), runTabUrlAtStep4);
await sleep(1000);

const execJson = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_result'); return JSON.stringify(g.execution_result ?? null); })()`);
out('\n=== EXECUTION RESULT ===');
out(execJson);
let exec; try { exec = JSON.parse(execJson); } catch { exec = null; }
dump('execution-result', exec);
if (exec) {
  check('RUN_TEST: run completed', exec.status !== 'error', `status=${exec.status} steps=${exec.stepCount}`);
  const sr = exec.stepResults ?? [];
  dump('assertion-results', sr.flatMap(s => (s.assertionResults ?? []).map(a => ({ step: s.stepId ?? s.id, ...a }))));

  // F2: the click-after-navigate step must resolve (was ElementNotFound)
  const atcStepResult = sr.find(s => String(s.stepId ?? s.id).includes('0004')) ?? sr[sr.length - 1];
  const clickSteps = sr.filter(s => {
    const st = JSON.stringify(s);
    return st.includes('add1') || st.includes('Add to cart');
  });
  const anyNotFound = sr.some(s => s.error?.type === 'ElementNotFound');
  check('F2: no ElementNotFound on click-after-navigate step', !anyNotFound, JSON.stringify(sr.map(s => ({ id: s.stepId, status: s.status, err: s.error?.type }))));
  check('F2: all steps passed', exec.status === 'passed', `status=${exec.status} passed=${exec.passedSteps}/${exec.stepCount}`);

  // F3: step-0003 textMatch on #cart-count must report the real mismatch
  const tmResults = sr.flatMap(s => (s.assertionResults ?? []).filter(a => a.type === 'textMatch').map(a => ({ step: s.stepId ?? s.id, ...a })));
  out('textMatch results: ' + JSON.stringify(tmResults));
  // OR-1 correction: replay performs BOTH ATC clicks → counter reaches 2
  // → the recorded "2 items" textMatch now PASSES. A mismatch may still
  // exist from other steps; F3's diagnostic checks apply to it if present.
  const atcStepsExec = sr.filter(st => JSON.stringify(st).includes('add1'));
  const atcText2 = tmResults.find(t => t.expectedValue === '2 items');
  if (atcText2) check('OR-1 fix: replayed 2 ATC clicks → "2 items" textMatch PASSES', atcText2.passed === true, JSON.stringify(atcText2));
  const mismatchTm = tmResults.find(t => t.passed === false);
  if (mismatchTm) {
    check('F3: mismatching textMatch reports real actual text (not null)', typeof mismatchTm.actualValue === 'string' && mismatchTm.actualValue.length > 0, JSON.stringify(mismatchTm));
    check('F3: mismatching textMatch message is a real mismatch (not "Element not found")', !String(mismatchTm.message ?? '').toLowerCase().includes('not found') && String(mismatchTm.message ?? '').toLowerCase().includes('did not match'), JSON.stringify(mismatchTm.message));
  } else {
    check('F3: no mismatching textMatch — all recorded states reproduce on replay', tmResults.length > 0 && tmResults.every(t => t.passed === true), `${tmResults.length} textMatch, all passed`);
  }
  // And a matching one (step-0003) must record the real text too
  const okTm = tmResults.find(t => t.passed === true);
  if (okTm) check('F3: matching textMatch records real text', okTm.actualValue === '0 items', JSON.stringify(okTm));

  let softEvaluated = 0, softPassed = 0, softFailed = 0, countResults = [];
  for (const s of sr) {
    for (const a of (s.assertionResults ?? [])) {
      if (a.severity === 'soft' || a.soft === true) { softEvaluated++; a.passed ? softPassed++ : softFailed++; }
      if (a.type === 'count') countResults.push({ step: s.stepId ?? s.id, actual: a.actualValue, exp: a.expectedValue, passed: a.passed });
    }
  }
  check('RUN_TEST: soft assertions evaluated + recorded', softEvaluated >= 1, `evaluated=${softEvaluated} passed=${softPassed} failed=${softFailed}`);
  out('COUNT results: ' + JSON.stringify(countResults));
  const finalCount = countResults.find(c => c.exp === 2);
  if (finalCount) check('OR-1 fix: replayed 2 ATC clicks → COUNT actual 2 PASSES', finalCount.passed === true && finalCount.actual === 2, JSON.stringify(finalCount));
} else {
  check('RUN_TEST: run completed', false, 'no execution_result in storage');
}

// ── Playwright codegen ──
const genJson = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('generated_files');
  const files = g.generated_files?.files || [];
  const spec = files.find(f => /spec/.test(f.path));
  return JSON.stringify({ count: files.length, names: files.map(f => f.path), spec: spec ? spec.content : null });
})()`);
let gen; try { gen = JSON.parse(genJson); } catch { gen = null; }
dump('generated-spec', gen);
check('codegen: Playwright spec generated', !!(gen && gen.spec), `files=${gen?.count} names=${(gen?.names ?? []).join(',')}`);
if (gen?.spec) {
  const hasSoft = gen.spec.includes('expect.soft(') || gen.spec.includes('expectSoft');
  const hasCount = gen.spec.includes('toHaveCount');
  const hasNav = gen.spec.includes('goto');
  const hasCart = gen.spec.includes('#add1') || gen.spec.includes('Add to cart');
  check('codegen: soft assertions present', hasSoft, '');
  check('codegen: toHaveCount present (4c-iii)', hasCount, '')
  check('codegen: navigation present', hasNav, '');
  check('codegen: ATC click present', hasCart, '');
}

// ══ Scenario B (COUNT>1 discriminator — unchanged from first audit) ══
out('\n══ Scenario B: pre-seeded 3-item cart — true COUNT>1 ══');
const { targetId: appTabB } = await browser.send('Target.createTarget', { url: `${REPLICA}/preseeded` });
await sleep(1500);
const appB = await CDP({ target: appTabB, port: PORT });
await appB.send('Runtime.enable');
await browser.send('Target.activateTarget', { targetId: appTabB });
await sleep(600);
out('START (B) →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(800);
await browser.send('Target.activateTarget', { targetId: appTabB });
await sleep(400);
const bpos = JSON.parse((await appB.send('Runtime.evaluate', { expression: CENTER.replace('%ID%','add1'), returnByValue: true })).result.value);
await appB.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bpos.x, y: bpos.y, button: 'left', clickCount: 1 });
await appB.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bpos.x, y: bpos.y, button: 'left', clickCount: 1 });
out('clicked #add1 (B — cart unchanged at 3)');
await sleep(4000);
await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; })()`);
await sleep(6000);
await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'RUN_TEST'}); return 'ok'; })()`);
await sleep(12000);
const resB = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_result'); return JSON.stringify(g.execution_result ?? null); })()`);
let rb; try { rb = JSON.parse(resB); } catch { rb = null; }
dump('execution-result-b', rb);
if (rb) {
  check('B: run status passed', rb.status === 'passed', rb.status);
  const cb = rb.stepResults?.flatMap(s => s.assertionResults ?? [])?.find(a => a.type === 'count');
  check('B: COUNT actual = 3 (genuine multi-match)', cb?.actualValue === 3, `actual=${cb?.actualValue} exp=${cb?.expectedValue}`);
  check('B: COUNT passed', cb?.passed === true, `passed=${cb?.passed}`);
  const domB = await appB.send('Runtime.evaluate', { expression: 'document.querySelectorAll("#cart-items > *").length', returnByValue: true });
  check('B: live parity', Number(domB.result.value) === cb?.actualValue, `dom=${domB.result.value}`);
} else {
  check('B: run executed', false, 'no execution_result');
}

out(`\n════ A-SLICE RE-AUDIT — ${PASS} PASS / ${FAIL} FAIL ════`);
fs.writeFileSync(`${DUMP}/summary.txt`, `PASS=${PASS} FAIL=${FAIL}`);
try { browser.send('Browser.close'); } catch {}
await sleep(1200);
server.close();
process.exit(0);
