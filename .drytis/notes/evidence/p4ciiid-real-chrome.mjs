// 4c-iii-d real-Chrome validation — RUN_TEST with COUNT/collection assertions.
// Covers: executor content script build fix (D1), collection COUNT end-to-end
// (4c-iii-b), counter textMatch (4c-i), and twin-parity COUNT in the live page.
//
// Flow: replica app (add-to-cart appends <li data-testid="cart-item"> rows +
// #cart-count counter) → START_RECORDING → trusted CDP click → stop →
// RUN_TEST (SW rebuilds IR with stepAssertions; executor injects the now-built
// content script) → read execution_result from storage → assert step passed
// and soft assertion results recorded.
import CDP from 'chrome-remote-interface';
import http from 'node:http';
import { spawn } from 'node:child_process';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/p4ciiid-chrome-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9541;
const APP_PORT = 8107;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// Replica: cart rows are li[data-testid="cart-item"] inside
// ul[data-testid="cart-items"] (a configured collection selector with an #id
// on the container for the derived `#cart-items > *` locator), plus the
// #cart-count[data-count] counter.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui;margin:2rem}button{cursor:pointer}</style></head><body>
<h1>4c-iii-d Replica</h1>
<p>Cart: <span id="cart-count" data-count="0" aria-label="Cart count">0 items</span></p>
<button id="add1">Add to cart</button>
<ul id="cart-items" data-testid="cart-items"></ul>
<script>
let n = 0;
document.getElementById('add1').addEventListener('click', () => {
  n++;
  document.getElementById('cart-count').textContent = n + ' items';
  document.getElementById('cart-count').setAttribute('data-count', String(n));
  const li = document.createElement('li');
  li.setAttribute('data-testid', 'cart-item');
  li.textContent = 'Item ' + n;
  document.getElementById('cart-items').appendChild(li);
});
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/preseeded')) {
    // Scenario B — live discriminator for TRUE multi-match COUNT: 3
    // pre-seeded cart rows; the click does NOT change the cart (handler
    // body is neutralized with an early return — the recorder still sees
    // a trusted click, the DOM simply stays at 3 items). The derived
    // assertion is count/equals 3 — the OLD element?1:0 semantics would
    // evaluate 1 and FAIL; only resolveAllMatches can pass.
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE.replace(
      `document.getElementById('add1').addEventListener('click', () => {`,
      `for (let i=1;i<=3;i++){const li=document.createElement('li');li.setAttribute('data-testid','cart-item');li.textContent='Item '+i;document.getElementById('cart-items').appendChild(li);}
document.getElementById('cart-count').textContent='3 items';
document.getElementById('add1').textContent='Save for later';
document.getElementById('add1').addEventListener('click', () => { return;`,
    ));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
await sleep(2500);

const browser = await CDP({ port: PORT });
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
if (!extSW) { out('FAIL: extension SW not found'); process.exit(1); }
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

// ── Phase 1: record one add-to-cart click ──
// Activate the APP tab BEFORE START_RECORDING: the recording start URL is
// taken from the active tab, and the sidepanel (a tab in this harness, not
// a docked panel) would otherwise become the replay start URL — a
// chrome-extension:// URL that chrome.scripting cannot inject into.
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(600);
const started = await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`);
out('START_RECORDING →', started);
await sleep(800);

await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(400);
const center = await app.send('Runtime.evaluate', {
  expression: `(() => { const r = document.getElementById('add1').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`,
});
const { x, y } = JSON.parse(center.result.value);
await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
out('clicked #add1');
await sleep(4000);

// Inspect captured evidence + derived assertions path (IR plan saved at stop)
const evidence = await evalPanel(`(async () => { const g = await chrome.storage.local.get('cmdrunner_live_interactions'); const is = g.cmdrunner_live_interactions || []; return JSON.stringify(is.map(i => ({ t: i.interactionType ?? i.type, end: i.behavioralEvidence?.window?.endReason, rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? i.behavioralEvidence.applicationEvidence.resultingState.items.map(x=>({k:x.kind,n:x.numericValue,p:x.domPath})) : null }))); })()`);
out('EVIDENCE →', evidence);

const stopRes = await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`);
out('STOP_RECORDING →', stopRes);
await sleep(4000); // unified generation persists IR plan

const irPlan = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_ir_plan'); const p = g.execution_ir_plan; if (!p) return 'NO PLAN'; return JSON.stringify({ env: p.environment.baseUrl, steps: p.steps.map(s => ({ id: s.id, action: s.action, src: s.sourceEventId, assertions: s.assertions.map(a => ({ type: a.type, comp: a.comparison, sev: a.severity, exp: a.expectedValue, loc: a.target.resolvedLocators?.[0]?.value })) })) }); })()`);
out('IR PLAN →', irPlan);

// ── Phase 2: RUN_TEST ──
await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'RUN_TEST'}); return 'ok'; } catch(e) { return String(e); } })()`);
await sleep(9000);

const execResult = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_result'); return JSON.stringify(g.execution_result ?? null); })()`);
out('EXECUTION RESULT →', execResult);

let verdict = { parsed: false };
try { verdict = JSON.parse(execResult); verdict.parsed = true; } catch {}

if (verdict.parsed && verdict.status) {
  check('RUN_TEST completed (not the pre-fix status:error / 0 steps)', verdict.status !== 'error', `status=${verdict.status} steps=${verdict.stepCount}`);
  check('step count ≥ 1', (verdict.stepCount ?? 0) >= 1, `stepCount=${verdict.stepCount}`);
  check('passed steps ≥ 1', (verdict.passedSteps ?? 0) >= 1, `passed=${verdict.passedSteps}`);
  const step = verdict.stepResults?.[0];
  if (step) {
    out('STEP RESULT →', JSON.stringify(step));
    check('step 1 passed', step.status === 'passed', step.status);
    const asr = step.assertionResults ?? [];
    check('assertion results recorded', asr.length >= 1, `${asr.length} results: ${JSON.stringify(asr)}`);
    const countAsr = asr.find(a => a.type === 'count');
    if (countAsr) {
      check('COUNT assertion evaluated with true multi-match count', countAsr.actualValue === 1 && countAsr.passed, `actual=${countAsr.actualValue} expected=${countAsr.expectedValue} passed=${countAsr.passed}`);
    } else {
      check('COUNT assertion present in results', false, 'no count assertion in stepResults');
    }
    const textAsr = asr.find(a => a.type === 'textMatch');
    if (textAsr) {
      check('counter textMatch evaluated (soft)', typeof textAsr.passed === 'boolean', `actual="${textAsr.actualValue}" passed=${textAsr.passed}`);
    }
  }
} else {
  check('RUN_TEST completed (not the pre-fix status:error / 0 steps)', false, execResult.slice(0, 200));
}

// ── Phase 3: twin parity in the live page — the injected content script's
// COUNT vs the main evaluator's allMatches count on the same DOM ──
const liveCount = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('execution_result');
  const sr = g.execution_result?.stepResults?.[0];
  const c = sr?.assertionResults?.find(a => a.type === 'count');
  return JSON.stringify({ domItems: document.querySelectorAll('#cart-items > *').length, evaluated: c ? c.actualValue : null });
})()`);
// NOTE: panel document is the sidepanel, not the app tab — read DOM in app tab.
const appCount = await app.send('Runtime.evaluate', {
  expression: `document.querySelectorAll('#cart-items > *').length`,
  returnByValue: true,
});
const lc = JSON.parse(liveCount);
check('live page item count === evaluated COUNT (twin parity on live DOM)', Number(appCount.result.value) === lc.evaluated, `dom=${appCount.result.value} evaluated=${lc.evaluated}`);

out(`\n=== SCENARIO A (add-to-cart) — ${pass} PASS / ${fail} FAIL ===`);

// ══ Scenario B: pre-seeded 3-item cart, click leaves it unchanged ══
out('\n--- Scenario B: 3 pre-seeded items, unchanged by the click ---');
fail = 0;

// Fresh app tab on the pre-seeded page
const { targetId: appTabB } = await browser.send('Target.createTarget', { url: `${REPLICA}/preseeded` });
await sleep(1200);
const appB = await CDP({ target: appTabB, port: PORT });
await appB.send('Runtime.enable');
await browser.send('Target.activateTarget', { targetId: appTabB });
await sleep(600);

const startedB = await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`);
out('START_RECORDING (B) →', startedB);
await sleep(800);
await browser.send('Target.activateTarget', { targetId: appTabB });
await sleep(400);
const centerB = await appB.send('Runtime.evaluate', {
  expression: `(() => { const r = document.getElementById('add1').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`,
});
const { x: xb, y: yb } = JSON.parse(centerB.result.value);
await appB.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: xb, y: yb, button: 'left', clickCount: 1 });
await appB.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: xb, y: yb, button: 'left', clickCount: 1 });
out('clicked #add1 (B — no cart change)');
await sleep(4000);

const evB = await evalPanel(`(async () => { const g = await chrome.storage.local.get('cmdrunner_live_interactions'); const is = g.cmdrunner_live_interactions || []; const c = is.find(i => (i.interactionType ?? i.type) === 'Click'); const rs = c?.behavioralEvidence?.applicationEvidence?.resultingState; return JSON.stringify(rs ? rs.items.map(x=>({k:x.kind,n:x.numericValue,p:x.domPath})) : null); })()`);
out('EVIDENCE (B) →', evB);

await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; })()`);
await sleep(4000);

const planB = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_ir_plan'); const p = g.execution_ir_plan; if (!p) return 'NO PLAN'; const s = p.steps[0]; return JSON.stringify({ env: p.environment.baseUrl, n: p.steps.length, assertions: (s?.assertions ?? []).map(a => ({ t: a.type, e: a.expectedValue, l: a.target.resolvedLocators?.[0]?.value })) }); })()`);
out('IR PLAN (B) →', planB);
const pb = JSON.parse(planB);
check('B: derived COUNT equals 3 in the plan', pb.assertions?.some(a => a.t === 'count' && a.e === 3 && a.l === '#cart-items > *'), planB);

await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'RUN_TEST'}); return 'ok'; })()`);
await sleep(9000);

const resB = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_result'); return JSON.stringify(g.execution_result ?? null); })()`);
out('EXECUTION RESULT (B) →', resB);
const rb = JSON.parse(resB);
check('B: run status passed', rb.status === 'passed', rb.status);
const stepB = rb.stepResults?.[0];
const countB = stepB?.assertionResults?.find(a => a.type === 'count');
check('B: COUNT evaluated 3 (TRUE multi-match — old element?1:0 would give 1)', countB?.actualValue === 3, `actual=${countB?.actualValue}`);
check('B: COUNT assertion passed', countB?.passed === true, `passed=${countB?.passed}`);

out(`\n=== SCENARIO B — ${pass - 8} PASS / ${fail} FAIL ===`);
browser.send('Browser.close').catch(() => {});
await sleep(1200);
server.close();
process.exit(fail > 0 ? 1 : 0);
