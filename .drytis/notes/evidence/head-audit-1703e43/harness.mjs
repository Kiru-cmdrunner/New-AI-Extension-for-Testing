// HEAD 1703e43 real-Chrome E2E audit — read-only vs product; replica + harness only.
// Pipeline under test: record (fill+click+nav+ATC) → evidence (target/app/network/resultingState)
// → STOP → IR plan → step assertions → Playwright codegen → RUN_TEST → execution_result.
import CDP from 'chrome-remote-interface';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/head-audit-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9545;
const APP_PORT = 8121;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const DUMP = '/tmp/e2e-head-audit/dumps';
fs.mkdirSync(DUMP, { recursive: true });
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 900) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, obj) => fs.writeFileSync(`${DUMP}/${name}.json`, JSON.stringify(obj, null, 2));

// ── Replica ──
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
document.getElementById('add1').addEventListener('click', (future) => {
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
      `document.getElementById('add1').addEventListener('click', (future) => {`,
      `for (let i=1;i<=3;i++){const li=document.createElement('li');li.setAttribute('data-testid','cart-item');li.textContent='Item '+i;document.getElementById('cart-items').appendChild(li);}
document.getElementById('cart-count').textContent='3 items';
document.getElementById('cart-count').setAttribute('data-count','3');
document.getElementById('add1').textContent='Save for later';
document.getElementById('add1').addEventListener('click', (future) => { return;`));
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

// ── Workflow ──
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(600);
out('START_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(800);

// 1) FILL: type 'headphones' into #q
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

// 2) CLICK 'Go' → AJAX results (no navigation)
const gpos = await centerOf(app, 'go');
await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gpos.x, y: gpos.y, button: 'left', clickCount: 1 });
await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gpos.x, y: gpos.y, button: 'left', clickCount: 1 });
out('clicked #go (AJAX results)');
await sleep(3500);

// 3) NAVIGATE to /cart (location.href)
await evalApp(`location.href = '${REPLICA}/cart'`);
out('navigated to /cart');
await sleep(4000);

// 4) ADD TO CART x2 (state-changing)
for (let i = 0; i < 2; i++) {
  await browser.send('Target.activateTarget', { targetId: appTab });
  await sleep(400);
  const apos = await centerOf(app, 'add1');
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: apos.x, y: apos.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: apos.x, y: apos.y, button: 'left', clickCount: 1 });
  out(`clicked #add1 (${i + 1}/2)`);
  await sleep(3500);
}

// ── Evidence inspection (before STOP) ──
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
  check('IR plan: steps ≥ 3 (fill/click + nav + ATC)', plan.n >= 3, `n=${plan.n}`);
  const atcStep = plan.steps.find(s => (s.locator ?? '').includes('add1'));
  check('IR plan: ATC step present w/ #add1 locator', !!atcStep, JSON.stringify(plan.steps.map(s => ({a: s.action, l: s.locator}))));
  const totalAsr = plan.steps.flatMap(s => s.assertions ?? []);
  check('IR plan: step assertions derived', totalAsr.length >= 1, `${totalAsr.length} assertions: ${JSON.stringify(totalAsr.map(a => ({t:a.type,e:a.exp,l:a.loc})))}`);
  const countAsr = totalAsr.find(a => a.type === 'count');
  check('IR plan: COUNT assertion present (cart-items > *)', !!countAsr, JSON.stringify(countAsr));
  if (countAsr) check('IR plan: COUNT expected 2 (two ATC clicks)', countAsr.exp === 2, `exp=${countAsr.exp} loc=${countAsr.loc}`);
  const counterAsr = totalAsr.find(a => a.type === 'textMatch' && (a.loc ?? '').includes('cart-count'));
  check('IR plan: cart-count textMatch present', !!counterAsr, JSON.stringify(counterAsr));
  if (counterAsr) check('IR plan: cart-count expected "2 items"', counterAsr.exp === '2 items', `exp="${counterAsr.exp}"`);
  // separation: nav step vs click steps have distinct sourceEventIds
  const srcs = plan.steps.map(s => s.src);
  const uniq = new Set(srcs);
  check('IR plan: each step distinct sourceEventId', uniq.size === srcs.length, srcs.join(' | '));
  // assertions attach to the step whose src equals their src? (step-scoped)
  let attachOk = true, attachDetails = [];
  for (const s of plan.steps) {
    for (const a of (s.assertions ?? [])) {
      if (a.src && a.src !== s.src) { attachOk = false; attachDetails.push(`${s.id}: asr src ${a.src} != step src ${s.src}`); }
    }
  }
  check('IR plan: assertions scoped to owning step (sourceEventId match)', attachOk, attachDetails.join('; ') || 'all match');
}

// ── Generated Playwright files ──
const filesJson = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('generated_files');
  const r = g.generated_files;
  if (!r?.files) return JSON.stringify({ error: 'NO FILES', keys: Object.keys(g) });
  return JSON.stringify({ n: r.files.length, files: r.files.map(f => ({ path: f.path, bytes: f.content?.length })) });
})()`);
out('\n=== GENERATED FILES ===');
out(filesJson);
let files; try { files = JSON.parse(filesJson); } catch { files = { error: 'unparseable' }; }
check('codegen: files generated', !files.error && files.n >= 5, filesJson.slice(0, 300));
const testSpec = files.files?.find(f => (f.path ?? '').includes('spec') || (f.path ?? '').includes('test'));
check('codegen: test spec file present', !!testSpec, testSpec?.path);
// dump full spec content
const specContent = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('generated_files');
  const f = g.generated_files?.files?.find(x => (x.path ?? '').includes('spec') || (x.path ?? '').includes('test'));
  return f ? f.content : 'NOT FOUND';
})()`);
fs.writeFileSync(`${DUMP}/generated-spec.playwright.ts`, String(specContent));
out('spec written to dumps/generated-spec.playwright.ts (' + String(specContent).length + ' chars)');
const hasExpect = /expect\(/.test(String(specContent));
check('codegen: spec contains expect() calls', hasExpect, String(specContent).slice(0, 200));
const hasCount2 = /toHaveCount\(2\)|count.*2/.test(String(specContent));
out(`(info) spec contains count/2 pattern: ${hasCount2}`);

// ── RUN_TEST ──
await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'RUN_TEST'}); return 'ok'; })()`);
await sleep(12000);
const execJson = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_result'); return JSON.stringify(g.execution_result ?? null); })()`);
out('\n=== EXECUTION RESULT ===');
out(execJson);
let exec; try { exec = JSON.parse(execJson); } catch { exec = null; }
dump('execution-result', exec);
if (exec) {
  check('RUN_TEST: run completed', exec.status !== 'error', `status=${exec.status} steps=${exec.stepCount}`);
  check('RUN_TEST: all steps passed', exec.status === 'passed' && exec.passedSteps === exec.stepCount, `passed=${exec.passedSteps}/${exec.stepCount}`);
  const sr = exec.stepResults ?? [];
  let softEvaluated = 0, softPassed = 0, softFailed = 0, contradiction = [], countResults = [];
  for (const s of sr) {
    for (const a of (s.assertionResults ?? [])) {
      if (a.severity === 'soft' || a.soft === true) {
        softEvaluated++;
        a.passed ? softPassed++ : softFailed++;
      }
      if (a.type === 'count') countResults.push({ step: s.stepId ?? s.id, loc: a.locator ?? a.target, actual: a.actualValue, exp: a.expectedValue, passed: a.passed });
    }
  }
  dump('assertion-results', sr.flatMap(s => (s.assertionResults ?? []).map(a => ({ step: s.stepId ?? s.id, ...a }))));
  check('RUN_TEST: soft assertions evaluated + recorded', softEvaluated >= 1, `evaluated=${softEvaluated} passed=${softPassed} failed=${softFailed}`);
  out('COUNT results: ' + JSON.stringify(countResults));
  // contradictory pairs: same locator, different expected, both hard
  const hard = sr.flatMap(s => (s.assertionResults ?? []).filter(a => a.severity !== 'soft'));
  const byLoc = {};
  for (const a of hard) { const k = a.locator ?? a.target ?? '?'; (byLoc[k] ??= []).push(a.expectedValue); }
  for (const [k, vs] of Object.entries(byLoc)) if (new Set(vs).size > 1) contradiction.push(`${k}: [${vs.join(', ')}]`);
  check('RUN_TEST: no contradictory same-locator expectations', contradiction.length === 0, contradiction.join(' | ') || 'none');
  // live DOM parity
  const domCounts = await evalApp(`JSON.stringify({ cart: document.querySelectorAll('#cart-items > *').length, counter: document.getElementById('cart-count')?.textContent })`);
  out('live DOM after run: ' + domCounts);
  const dc = JSON.parse(domCounts);
  const runCount = countResults.at(-1);
  check('RUN_TEST: live COUNT parity', !runCount || Number(dc.cart) === runCount.actual, `dom=${dc.cart} evaluated=${runCount?.actual}`);
} else {
  check('RUN_TEST: run completed', false, 'no execution_result in storage');
}

// ══ Scenario B: pre-seeded 3-item cart, click leaves it unchanged (true COUNT>1) ══
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
const planBJson = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_ir_plan'); const p = g.execution_ir_plan; if (!p) return JSON.stringify({error:'NO PLAN'}); const s = p.steps.find(x => (x.target?.resolvedLocators?.[0]?.value ?? '').includes('add1')) ?? p.steps[0]; return JSON.stringify({ n: p.steps.length, atc: { loc: s.target?.resolvedLocators?.[0]?.value, assertions: (s.assertions ?? []).map(a => ({t:a.type,e:a.expectedValue,l:a.target?.resolvedLocators?.[0]?.value})) } }); })()`);
out('IR PLAN (B) → ' + planBJson);
dump('ir-plan-b', (() => { try { return JSON.parse(planBJson); } catch { return { raw: planBJson }; } })());
let pb; try { pb = JSON.parse(planBJson); } catch { pb = null; }
if (pb && !pb.error) {
  const c = (pb.atc?.assertions ?? []).find(a => a.t === 'count');
  check('B: derived COUNT = 3 on #cart-items > *', !!c && c.e === 3 && c.l === '#cart-items > *', JSON.stringify(pb.atc?.assertions));
  const allAsr = pb.atc?.assertions ?? [];
  const countLike = allAsr.filter(a => a.t === 'count');
  check('B: no duplicate/contradictory count assertions on same locator', new Set(countLike.map(a => a.l)).size === countLike.length || countLike.every(a => a.e === countLike[0].e), JSON.stringify(countLike));
}
await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'RUN_TEST'}); return 'ok'; })()`);
await sleep(12000);
const resB = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_result'); return JSON.stringify(g.execution_result ?? null); })()`);
out('EXECUTION RESULT (B) → ' + resB);
let rb; try { rb = JSON.parse(resB); } catch { rb = null; }
dump('execution-result-b', rb);
if (rb) {
  check('B: run status passed', rb.status === 'passed', rb.status);
  const cb = rb.stepResults?.flatMap(s => s.assertionResults ?? [])?.find(a => a.type === 'count');
  check('B: COUNT actual = 3 (genuine multi-match, not element?1:0)', cb?.actualValue === 3, `actual=${cb?.actualValue} exp=${cb?.expectedValue}`);
  check('B: COUNT passed', cb?.passed === true, `passed=${cb?.passed}`);
  const domB = await appB.send('Runtime.evaluate', { expression: 'document.querySelectorAll("#cart-items > *").length', returnByValue: true });
  check('B: live parity', Number(domB.result.value) === cb?.actualValue, `dom=${domB.result.value}`);
}

out(`\n════ SCENARIO A — ${PASS} PASS / ${FAIL} FAIL ════`);
try { browser.send('Browser.close'); } catch {}
await sleep(1200);
server.close();
process.exit(0);
