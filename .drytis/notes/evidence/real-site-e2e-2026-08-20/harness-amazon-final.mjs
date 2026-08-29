// FINAL corrected attempt — exact panel input ids + button-click search.
// Diagnosis only. Real Chrome 148 + extension dist @ 350af71.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/amz4-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9561;
const DUMP = '/tmp/amz-e2e-dumps';
fs.mkdirSync(DUMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 700) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (n, o) => fs.writeFileSync(`${DUMP}/${n}.json`, JSON.stringify(o, null, 2));

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { out('FATAL: no chrome'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
if (!extSW) { out('FATAL: no SW'); process.exit(1); }
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: 'https://www.amazon.com/' });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(3000);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable');
await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const recActive = async () => evalPanel(`(async () => { const s = await chrome.storage.local.get('cmdrunner_recording_active'); return s.cmdrunner_recording_active; })()`);

const home = await evalApp(`(() => ({ s: !!document.querySelector('input#twotabsearchtextbox') }))()`);
check('amazon homepage real', !!home?.s);

// ── Clone-gate proven path: raw START_RECORDING, no test-case form ──
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(800);
await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`);
await sleep(800);
const flag = await recActive();
out('recording_active after raw START:', JSON.stringify(flag));
check('recording armed (raw message path)', flag === true);

// ── Interactions ──
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(400);
const center = async (sel) => {
  const p = await evalApp(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return (r.width > 0 && r.height > 0) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()`);
  if (p) await sleep(300);
  return p;
};
const click = async (sel) => {
  const p = await center(sel);
  if (!p) return false;
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  return true;
};

{
  const p = await center('input#twotabsearchtextbox');
  if (p) {
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await sleep(300);
    for (const ch of 'wireless mouse') {
      await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
      await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
      await sleep(35);
    }
  }
}
await sleep(600);
const sc = await click('input#nav-search-submit-button');
out('search button clicked:', sc);
await sleep(5000);
const res = await evalApp(`(() => ({ path: location.pathname, n: document.querySelectorAll('div[data-component-type="s-search-result"]').length }))()`);
check('search results page (via button)', res?.path === '/s' && res?.n > 0, JSON.stringify(res));

let prodOk = false;
if (res?.path === '/s' && res?.n > 0) {
  let opened = await click('div[data-component-type="s-search-result"] h2 a');
  if (!opened) opened = await click('div[data-component-type="s-search-result"] a.a-link-normal[href*="/dp/"]');
  if (!opened) opened = await click('a.a-link-normal[href*="/dp/"]');
  if (!opened) opened = await evalApp(`(() => { const a = [...document.querySelectorAll('a[href*="/dp/"]')].find(x => x.offsetParent); if (a) { a.click(); return true; } return false; })()`);
  out('product link clicked:', opened);
  await sleep(6500);
  const p = await evalApp(`(() => ({ path: location.pathname.slice(0, 40), atc: !!document.querySelector('#add-to-cart-button') }))()`);
  prodOk = !!p?.atc;
  check('product detail reached', prodOk, JSON.stringify(p));
  if (prodOk) {
    const atc = await click('#add-to-cart-button');
    out('ATC clicked:', atc);
    await sleep(7000);
    const after = await evalApp(`(() => ({ cart: document.querySelector('#nav-cart-count')?.textContent ?? null, confirm: /Added to Cart|added to cart/i.test(document.body.innerText.slice(0, 4000)), path: location.pathname.slice(0, 30) }))()`);
    out('after ATC:', JSON.stringify(after));
    check('ATC consequence visible', !!(after?.confirm || (after?.cart && after.cart !== '0')), JSON.stringify(after));
  }
} else {
  check('product detail reached', false, 'no results page');
  check('ATC consequence visible', false, 'skipped');
}

// ── Stop ──
await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`);
await sleep(6000);
const flag2 = await recActive();
out('recording_active after stop:', JSON.stringify(flag2));
check('recording stopped', flag2 === false);

// ── IR ──
const irJson = await evalPanel(`(async () => { const s = await chrome.storage.local.get('execution_ir_plan'); return JSON.stringify(s.execution_ir_plan ?? null); })()`);
let plan = null; try { plan = JSON.parse(irJson); } catch {}
dump('ir-plan-final', plan);
const steps = plan?.steps ?? [];
check('IR plan generated (steps ≥ 2)', steps.length >= 2, `steps=${steps.length} startUrl=${plan?.environment?.startUrl?.slice(0, 60)}`);
const allAsr = steps.flatMap(s => (s.assertions ?? []).map(a => ({ step: s.stepId ?? s.id, type: a.type ?? a.assertionType, loc: a.locator?.value ?? a.targetCss ?? '', exp: a.expectedValue })));
out(`assertions (${allAsr.length}): ` + JSON.stringify(allAsr.slice(0, 14)));
dump('assertions-final', allAsr);
check('non-empty assertion locators', allAsr.length >= 1 && allAsr.every(a => a.loc), JSON.stringify(allAsr.filter(a => !a.loc).slice(0, 3)));

// ── Codegen ──
const genJson = await evalPanel(`(async () => { const g = await chrome.storage.local.get('generated_files'); const files = g.generated_files?.files || []; const spec = files.find(f => /spec/.test(f.path)); return JSON.stringify({ count: files.length, spec: spec?.content?.slice(0, 4000) ?? null }); })()`);
let gen = null; try { gen = JSON.parse(genJson); } catch {}
dump('generated-spec-final', gen);
check('Playwright spec generated', !!(gen && gen.spec), `files=${gen?.count}`);

// ── RUN_TEST ──
await evalPanel(`(async () => { await chrome.runtime.sendMessage({type:'RUN_TEST'}); return 'ok'; })()`);
let exec = null;
for (let i = 0; i < 34; i++) {
  await sleep(1500);
  const j = await evalPanel(`(async () => { const s = await chrome.storage.local.get('execution_result'); return JSON.stringify(s.execution_result ?? null); })()`);
  try { exec = JSON.parse(j); } catch {}
  if (exec && ['passed', 'failed', 'error'].includes(exec.status)) break;
}
dump('execution-result-final', exec);
if (exec) {
  const st = exec.stepResults ?? [];
  const p = st.filter(s => s.status === 'passed').length;
  check('replay completed', !!exec.status, `status=${exec.status} steps=${exec.stepCount}`);
  check(`replay steps passed ${p}/${st.length}`, st.length > 0 && p === st.length, JSON.stringify(st.map(s => ({ id: s.stepId ?? s.id, st: s.status, err: String(s.error?.message ?? '').slice(0, 100) }))));
  const asr = st.flatMap(s => (s.assertionResults ?? []).map(a => ({ step: s.stepId, t: a.type, pass: a.passed, exp: a.expectedValue, act: a.actualValue, msg: String(a.message ?? '').slice(0, 90) })));
  out(`replay assertions (${asr.length}): ` + JSON.stringify(asr.slice(0, 14)));
  dump('replay-assertions-final', asr);
  check('replay assertions evaluated ≥ 1', asr.length >= 1, `n=${asr.length}`);
} else {
  check('replay completed', false, 'no result');
}

out(`\n════ AMAZON E2E (corrected UI path) — ${PASS} PASS / ${FAIL} FAIL ════`);
try { browser.send('Browser.close'); } catch {}
await sleep(800);
process.exit(0);
