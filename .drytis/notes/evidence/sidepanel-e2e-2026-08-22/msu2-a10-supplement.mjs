// MS-U2 A10 SUPPLEMENT — real-Chrome E2E for the two drill-down types the
// multipattern harness could not produce:
//   D3 network drill-down (captured POST with requestBody via webRequest)
//   D5 surface drill-down (role=dialog overlay with structural descendants)
// Same skeleton as msu2-drilldown-validation.mjs; app = /tmp/dialogapp (:8188).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/dialogapp/app.mjs'; // in-process app server (:8188) — dies with harness

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/sidepanel-profile-msu2s-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9569;
const APP = 'http://127.0.0.1:8188';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 400) : ''}`);
  ok ? PASS++ : FAIL++;
};
const DUMP = '/tmp/msu2-e2e';
fs.mkdirSync(DUMP, { recursive: true });

const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId:', extId);
const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const panelErrors = [];
panel.on && panel.on('Runtime.consoleAPICalled', (e) => {
  if (e.type === 'error') panelErrors.push(String((e.args || []).map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 200));
});

const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => { const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value; return v === 'null' ? null : JSON.parse(v); };
const clickSel = async (sel, label) => { const p = await center(sel); if (!p) { out(`  !! ${sel} not clickable`); return false; }
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  out('  clicked', label || sel); return true; };
const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopViaPanel = async () => { await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 'clicked'; })()`); };

const drilldownCensus = `(() => {
  const cards = Array.from(document.querySelectorAll('.interaction-event'));
  const drills = document.querySelectorAll('details.evidence-drilldown');
  const raw = document.querySelector('details.raw-evidence');
  const itemDrills = document.querySelectorAll('details.evidence-drilldown--item');
  const netDrills = document.querySelectorAll('details.evidence-drilldown--network');
  const domDrills = document.querySelectorAll('details.evidence-drilldown--dom');
  const surfDrills = document.querySelectorAll('details.evidence-drilldown--surface');
  const winDrills = document.querySelectorAll('details.evidence-drilldown--window');
  return {
    cards: cards.length,
    drills: drills.length,
    allCollapsed: Array.from(drills).every(d => !d.open),
    raw: !!raw, rawSummary: raw ? raw.querySelector('summary')?.textContent : null,
    itemDrills: itemDrills.length, netDrills: netDrills.length, domDrills: domDrills.length,
    surfDrills: surfDrills.length, winDrills: winDrills.length,
    bars: document.querySelectorAll('.stability-bar').length,
  };
})()`;

// ═══ RUN — dialog app: escalate → dialog surface → confirm POST ═══
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await clickSel('#escalate', 'Escalate (opens dialog)');
await sleep(900); // dialog surface mount + settle
await clickSel('#confirm', 'Confirm (fires POST /escalate)');
await sleep(3000); // window settle → consequence-settled + stability trace
await stopViaPanel();
let v = null;
for (let i = 0; i < 15; i++) { await sleep(1000); v = await evalPanel(drilldownCensus); if (v.cards > 0) break; }
await sleep(1200);
v = await evalPanel(drilldownCensus);
out('\n── dialog census ──'); out(JSON.stringify(v, null, 2));
fs.writeFileSync(`${DUMP}/dialog-census.json`, JSON.stringify(v, null, 2));

check('cards render (panel healthy)', v.cards > 0, `cards=${v.cards}`);
check('drill-downs present and ALL collapsed by default', v.drills > 0 && v.allCollapsed, `drills=${v.drills} collapsed=${v.allCollapsed}`);
check('D5: surface drill-downs present (role=dialog overlay captured)', v.surfDrills > 0, `surfDrills=${v.surfDrills}`);
check('D3: network drill-downs present (captured POST)', v.netDrills > 0, `netDrills=${v.netDrills}`);

const surfExpand = await evalPanel(`(() => {
  const d = document.querySelector('details.evidence-drilldown--surface');
  if (!d) return { ok: false, why: 'none' };
  d.open = true;
  const t = d.textContent || '';
  return { ok: /descendants|emergence|batch/.test(t), text: t.slice(0, 200) };
})()`);
check('D5 expanded: surface structural detail visible (descendants/emergence)', surfExpand.ok, JSON.stringify(surfExpand).slice(0, 240));

const netExpand = await evalPanel(`(() => {
  const drills = Array.from(document.querySelectorAll('details.evidence-drilldown--network'));
  for (const d of drills) {
    d.open = true;
    const t = d.textContent || '';
    if (/requestBody|body fields|tid|sev|note/.test(t) || /webRequest/.test(t)) {
      return { ok: true, text: t.slice(0, 240) };
    }
  }
  return { ok: false, why: 'no network detail with body/join content', n: drills.length };
})()`);
check('D3 expanded: network detail shows source/body/join facts', netExpand.ok, JSON.stringify(netExpand).slice(0, 260));

const winExpand = await evalPanel(`(() => {
  const d = document.querySelector('details.evidence-drilldown--window');
  if (!d) return { ok: false, why: 'none' };
  d.open = true;
  const bars = d.querySelectorAll('.stability-bar').length;
  const t = d.textContent || '';
  return { ok: /samples/.test(t), bars, endReason: /endReason/.test(t) || /(consequence-settled|stabilized)/.test(t), text: t.slice(0, 180) };
})()`);
check('D6 expanded: window internals + stability render', winExpand.ok, JSON.stringify(winExpand).slice(0, 240));

// Raw JSON should contain the captured network entry (requestBody in storage)
const rawNet = await evalPanel(`(() => {
  const d = document.querySelector('details.raw-evidence');
  if (!d) return { ok: false, why: 'no raw details' };
  d.open = true;
  const t = d.querySelector('pre')?.textContent || '';
  return { ok: /networkActivity/.test(t) && /escalate/.test(t), len: t.length };
})()`);
check('D7 raw JSON includes captured network activity (storage-side proof)', rawNet.ok, JSON.stringify(rawNet).slice(0, 200));

await sleep(600);
out('\npanel console errors:', panelErrors.length ? panelErrors : 'none');
check('zero panel console errors', panelErrors.length === 0, panelErrors.join(' | '));

out(`\n════ MS-U2 A10 SUPPLEMENT — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
chrome.kill();
process.exit(0);
