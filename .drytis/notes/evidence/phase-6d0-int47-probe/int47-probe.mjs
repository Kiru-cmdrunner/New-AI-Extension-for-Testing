// Phase 6D.0 int-47 E2E verification — dialog-contained bare options promoted
// from Unclassified to recognized Clicks via the LP1 role branch.
//
// Scenario (int-47 RCA shape, generic): a modal whose ONLY surface signal is
// role=dialog (NO modal/popup/overlay class tokens — so the class branch of
// LP1 cannot fire), containing bare option rows with NO role, NO class, NO
// tabIndex. Before 6D.0 these were Unclassified (role branch dead vs
// `div[role=dialog]` format). After 6D.0 they must be recognized Clicks.
//
// Secondary check: a popup-class ancestor (DIALOG_RE token that LP1 lacked)
// must also qualify. And negative control: a bare option OUTSIDE any surface
// must remain Unclassified (gate must not become a blanket pass-through).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/probe6d0-' + Date.now();
const DIST = '/workspace/dist';
const CDP_PORT = 9581;
const APP_PORT = 8187;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
fs.mkdirSync('/tmp/probe6d0-dumps', { recursive: true });
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + detail : ''}`);
  ok ? PASS++ : FAIL++;
};

// ── Probe app: role-only dialog + classless bare options ──────────────
const state = { cabin: 'Economy', region: 'Global', plain: null };

const page = () => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Probe</title>
<style>body{font-family:system-ui;margin:2rem}
.dlg{border:2px solid #1a2b4a;border-radius:8px;padding:1rem;max-width:520px}
.t{font-weight:600;margin-bottom:.5rem}
.row{padding:.4rem 0}
.sel{padding:.5rem .75rem;border:1px solid #ccc;border-radius:6px;cursor:pointer;display:inline-block;min-width:200px}
.opts{border:1px solid #1a2b4a;border-radius:6px;margin-top:.35rem;display:none}
.opts.open{display:block}
.pu{position:fixed;top:10px;right:10px;border:1px solid #888;border-radius:6px;padding:.5rem;display:none}
.pu.open{display:block}
</style></head><body>
<h1>Surface vocabulary probe</h1>

<!-- Dialog whose ONLY surface signal is the semantic role. -->
<div class="dlg" role="dialog" aria-label="Cabin selection">
  <div class="t">Cabin</div>
  <div class="row"><span id="cabin-out">Economy</span></div>
  <div class="opts" id="cabin-opts">
    <div data-opt="Premium Economy">Premium Economy</div>
    <div data-opt="Business">Business</div>
  </div>
</div>

<!-- Popup-family surface (DIALOG_RE token 'popup', LP1-class branch). -->
<div class="region-popup" id="region-pu" aria-label="Region">
  <div class="t">Region</div>
  <div id="region-out">Global</div>
  <div class="opts" id="region-opts" style="display:block">
    <div data-ropt="Europe">Europe</div>
  </div>
</div>

<!-- Negative control: bare option OUTSIDE any surface. -->
<div id="outside">
  <div data-plain="orphan">Bare outside</div>
</div>

<script>
const st = ${JSON.stringify(state)};
const cabinOut = document.getElementById('cabin-out');
const cabinOpts = document.getElementById('cabin-opts');
cabinOut.style.cursor = 'pointer';
cabinOut.addEventListener('click', e => { e.stopPropagation(); cabinOpts.classList.toggle('open'); });
cabinOpts.querySelectorAll('[data-opt]').forEach(o => o.addEventListener('click', e => {
  e.stopPropagation(); st.cabin = o.dataset.opt; cabinOut.textContent = st.cabin;
}));
const regionPu = document.getElementById('region-pu');
const regionOut = document.getElementById('region-out');
document.querySelectorAll('[data-ropt]').forEach(o => o.addEventListener('click', e => {
  e.stopPropagation(); st.region = o.dataset.ropt; regionOut.textContent = st.region;
}));
document.querySelector('[data-plain]').addEventListener('click', e => {
  e.stopPropagation(); st.plain = 'clicked';
});
setTimeout(() => { regionPu.classList.add('open'); }, 50);
</script>
</body></html>`;

const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(page());
});
srv.listen(APP_PORT, '127.0.0.1');

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  try { browser = await CDP({ port: CDP_PORT }); break; } catch {}
}
if (!browser) { out('FATAL: no chrome'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `http://127.0.0.1:${APP_PORT}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: CDP_PORT });
const panel = await CDP({ target: panelTab, port: CDP_PORT });
await app.send('Runtime.enable');
await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

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

await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(1500);

out('START_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(800);

// 1. open cabin options; click classless bare option inside role=dialog-only modal
await clickSel('#cabin-out', 'cabin display (opens options)');
await sleep(700);
await clickSel('[data-opt="Premium Economy"]', 'Premium Economy (bare, dialog-only ancestor)');
await sleep(900);

// 2. click bare option inside popup-class surface
await clickSel('[data-ropt="Europe"]', 'Europe (bare, popup-class ancestor)');
await sleep(900);

// 3. negative control: bare option OUTSIDE any surface
await clickSel('[data-plain="orphan"]', 'bare outside (negative control)');
await sleep(1200);

const appState = await evalApp(`(() => ({ cabin: document.getElementById('cabin-out').textContent, region: document.getElementById('region-out').textContent }))()`);
out('app final state:', JSON.stringify(appState));
check('app: dialog option applied (Premium Economy)', appState.cabin === 'Premium Economy', JSON.stringify(appState));
check('app: popup option applied (Europe)', appState.region === 'Europe');

out('STOP_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(3500);

const evidence = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  return JSON.stringify(g['cmdrunner_live_interactions'] ?? null);
})()`);
fs.writeFileSync('/tmp/probe6d0-dumps/interactions.json', evidence);
const inter = JSON.parse(evidence || '[]');
out(`interactions captured: ${inter.length}`);
const summary = inter.map((i, n) => `${i.interactionId || 'int-' + (n + 1)}:${i.type}${i.metadata && i.metadata.targetName ? '(' + i.metadata.targetName + ')' : ''}`).join(' | ');
out('summary:', summary);

const pe = inter.find(i => (i.metadata && i.metadata.targetName === 'Premium Economy') || JSON.stringify(i.metadata || {}).includes('Premium Economy'));
check('int-47 shape: bare option under role=dialog-only modal IS captured (M4)', !!pe, pe ? pe.type : 'missing');

// THE 6D.0 assertion: the dialog-contained bare click is now a recognized Click.
check('int-47 promoted: dialog-contained bare option classified as Click (was Unclassified)', !!pe && pe.type === 'Click', pe ? pe.type : 'missing');

const eu = inter.find(i => JSON.stringify(i.metadata || {}).includes('Europe'));
check('popup-class ancestor: bare option captured', !!eu, eu ? eu.type : 'missing');
check('popup vocabulary: dialog-detector token popup now Click-eligible', !!eu && eu.type === 'Click', eu ? eu.type : 'missing');

const orphan = inter.find(i => JSON.stringify(i.metadata || {}).includes('Bare outside'));
check('negative control: bare option outside any surface still captured', !!orphan, orphan ? orphan.type : 'missing');
check('negative control: bare outside stays Unclassified (gate not loosened)', !!orphan && orphan.type === 'Unclassified', orphan ? orphan.type : 'missing');

// Ledger integrity: entries exist regardless of classification (INV-1).
const ledger = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_evidence_ledger');
  return JSON.stringify({ n: (g['cmdrunner_evidence_ledger'] || []).length });
})()`);
out('ledger:', ledger);

out(`════ 6D.0 INT-47 E2E PROBE — ${PASS} PASS / ${FAIL} FAIL ════`);
process.exit(FAIL > 0 ? 1 : 0);
