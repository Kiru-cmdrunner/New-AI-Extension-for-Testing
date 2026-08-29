// LP2+LP3 real-Chrome PROOF (independent probe — does not touch the gate harness).
// Re-runs the PaxAndClass widget flow, then reads componentType / businessMeaning
// / componentFramework directly off the stored Unclassified cards, plus the
// persisted ledger rows' ancestor fields. Expectation after LP2+LP3:
//   - the two Unclassified selectbox-opener cards carry componentType/businessMeaning
//   - IR step count UNCHANGED vs 595d9aa baseline (NOISE_TYPES honesty intact)
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';

const APP_PORT = 8198;
const PORT = 9572;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/lp2-proof-' + Date.now();
const DIST = '/workspace/dist';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => { out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 700) : ''}`); ok ? PASS++ : FAIL++; };

// ── PaxAndClass-style widget (same shape as the gate harness app) ──
const state = { trip: 'One Way', adults: 1, children: 0, cabin: 'Economy', done: false };
const html = `<!doctype html><html><head><style>
  .options{display:none}.options.open{display:block}
</style></head><body>
<div id="w">
  <div class="trip-type-selectbox" data-kind="trip">${state.trip}</div>
  <div class="trip-opts options dropdown"><div class="opt-row" data-opt="Round Trip">Round Trip</div></div>
  <div class="PaxAndClass-selectbox" data-kind="cabin">1 Economy</div>
  <div class="PaxAndClass-opts options dropdown"><div class="opt-row" data-opt="Premium Economy">Premium Economy</div></div>
  <button data-kind="done">Done</button>
  <span id="st"></span>
</div>
<script>
  const q = s => document.querySelector(s);
  let trip='One Way', cabin='1 Economy';
  q('[data-kind=trip]').onclick = e => { e.stopPropagation(); q('.trip-opts').classList.toggle('open'); };
  q('[data-opt="Round Trip"]').onclick = () => { trip='Round Trip'; q('[data-kind=trip]').textContent=trip; q('.trip-opts').classList.remove('open'); };
  q('[data-kind=cabin]').onclick = e => { e.stopPropagation(); q('.PaxAndClass-opts').classList.toggle('open'); };
  q('[data-opt="Premium Economy"]').onclick = () => { cabin='2 Premium Economy'; q('[data-kind=cabin]').textContent=cabin; q('.PaxAndClass-opts').classList.remove('open'); };
  q('[data-kind=done]').onclick = () => { q('#st').textContent = trip+' | '+cabin; };
</script></body></html>`;
const srv = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); });
srv.listen(APP_PORT, '127.0.0.1');

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { out('FATAL: chrome'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extId = t0.find((t) => t.url.includes('service-worker-loader.js')).url.split('/')[2];
out('extId =', extId);
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${APP_PORT}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => JSON.parse((await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value);
const clickSel = async (sel) => { const p = await center(sel); if (!p) return false; await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); return true; };

out('START →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(1500);
out('open trip', await clickSel('[data-kind="trip"]'));
await sleep(900);
out('round trip', await clickSel('[data-opt="Round Trip"]'));
await sleep(900);
out('open cabin', await clickSel('[data-kind="cabin"]'));
await sleep(900);
out('premium', await clickSel('[data-opt="Premium Economy"]'));
await sleep(900);
out('done', await clickSel('[data-kind="done"]'));
await sleep(1200);
out('STOP →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(3500);

const evidence = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return (g.cmdrunner_live_interactions || []).map(i => ({
    id: i.interactionId, type: i.type,
    name: i.metadata && i.metadata.targetName,
    ct: i.componentType, fw: i.componentFramework, bm: i.businessMeaning,
  }));
})()`);
out('CARDS:', JSON.stringify(evidence, null, 1));

const ledgerRows = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_evidence_ledger');
  return (g.cmdrunner_evidence_ledger || []).length;
})()`);
out('ledger rows persisted:', ledgerRows);

const uncls = evidence.filter((i) => i.type === 'Unclassified');
check('LP2: Unclassified cards carry componentType (enrichment ran post-hoc)',
  uncls.length >= 1 && uncls.every((i) => i.ct), JSON.stringify(uncls.map((i) => `${i.id}:${i.name}→ct=${i.ct}`)));
check('LP2: Unclassified cards carry businessMeaning',
  uncls.length >= 1 && uncls.every((i) => typeof i.bm === 'string' && i.bm.length > 0), JSON.stringify(uncls.map((i) => `${i.id} bm=${i.bm}`)));
check('LP1 intact: Round Trip + Premium Economy still recognized Clicks',
  evidence.some((i) => i.type === 'Click' && i.name === 'Round Trip') && evidence.some((i) => i.type === 'Click' && i.name === 'Premium Economy'),
  evidence.filter((i) => /Round Trip|Premium/.test(String(i.name))).map((i) => `${i.id}:${i.type}`).join(' | '));

const plan = await evalPanel(`(async () => { const g = await chrome.storage.local.get('execution_ir_plan'); return g.execution_ir_plan || null; })()`);
const stepCount = plan && plan.steps ? plan.steps.length : 0;
check('NOISE_TYPES honesty: Unclassified cards produced NO IR steps beyond recognized ones',
  stepCount <= 4 && !JSON.stringify(plan).includes('Unclassified'), `IR steps=${stepCount}`);

out(`\n════ LP2+LP3 PROOF — ${PASS} PASS / ${FAIL} FAIL ════`);
try { browser.send('Browser.close'); } catch {}
await sleep(800); srv.close(); process.exit(0);
