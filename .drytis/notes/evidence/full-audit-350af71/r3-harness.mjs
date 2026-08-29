// R3 — full-capability real-Chrome E2E harness @ 350af71 (read-only audit).
// Same methodology as prior gates: pinned Chrome 148, --load-extension=dist,
// CDP trusted input, sidepanel-page runtime messages, storage-local reads.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
await import('/workspace/.drytis/notes/evidence/full-audit-350af71/r3-bookshop-app.mjs');

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/r3-profile-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9555;
const APP = 'http://127.0.0.1:8177';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const DUMP = '/workspace/.drytis/notes/evidence/full-audit-350af71/r3-dumps';
// CP8 probe: production contract classes bundled from src (IIFE, CSP-safe eval)
import { execSync } from 'node:child_process';
execSync("npx esbuild /tmp/cp8-probe-src/probe.ts --bundle --format=iife --global-name=__cp8probe --outfile=/tmp/cp8-probe-iife.js --define:process.env.NODE_ENV='\"production\"'", { cwd: '/workspace', stdio: 'pipe' });
const CP8_CODE = fs.readFileSync('/tmp/cp8-probe-iife.js', 'utf8');
fs.mkdirSync(DUMP, { recursive: true });
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 1200) : ''}`);
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
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { out('FATAL: chrome never came up'); process.exit(1); }
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find((t) => t.url.includes('service-worker-loader.js'));
if (!extSW) { out('FATAL: extension SW not found'); process.exit(1); }
const extId = extSW.url.split('/')[2];
out('extId =', extId);
check('L1: extension SW loaded', !!extSW, extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;

// dialogs: auto-accept so alert/confirm complete and the page-world wrappers fire
await app.send('Page.enable');
app.on('Page.javascriptDialogOpening', async () => { try { await app.send('Page.handleJavaScriptDialog', { accept: true }); } catch {} });

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
  await app.send('Runtime.evaluate', { expression: `(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`, returnByValue: true });
  out('  selected', value, 'in', sel);
  return true;
};

// ══ BOOT CHECK ══
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(1500);
const boot = await evalApp(`(() => ({ home: !!document.querySelector('#go'), cart: document.querySelector('#cart-count')?.textContent }))()`);
out('boot:', JSON.stringify(boot));
check('R3 app: home page boots', boot && boot.home === true, JSON.stringify(boot));

// ══ RECORD WORKFLOW ══
out('START_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'START_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(800);
await browser.send('Target.activateTarget', { targetId: appTab });

// 1. typeahead-ish search + skeleton → results (fetch + late render)
await typeInto('#q', 'war');
await sleep(300);
await clickSel('#go', 'Search button');
await sleep(3500); // skeleton 400ms + fetch 250 + render + settle

// 2. toggle advanced options (icon-only aria-label button) — checkbox + select
await clickSel('#adv-toggle', 'advanced options icon button');
await sleep(400);
await clickSel('#gift', 'gift-wrap checkbox');
await sleep(300);
await selectOption('#fmt', 'hc');
await sleep(400);

// 3. add two different books (two distinct entity buttons)
await clickSel('[data-sku-btn="SKU-WAR"]', 'Add War and Peace');
await sleep(1800); // POST 300ms + toast render
await clickSel('[data-sku-btn="SKU-ANA"]', 'Add Anna Karenina');
await sleep(1800);

// 4. MPA navigation to /order (link? none — use goto via address-bar equivalent: location)
await app.send('Page.navigate', { url: `${APP}/order` });
await sleep(2200);

// 5. dialogs: place order (alert) + cancel (confirm)
await clickSel('#place-order', 'Place order (alert dialog)');
await sleep(1200);
await clickSel('#cancel-order', 'Cancel order (confirm dialog)');
await sleep(1200);

const live = await evalApp(`(() => ({ cart: document.querySelector('#cart-count')?.textContent, toast: document.querySelector('.toast-message')?.textContent ?? null, alertFired: !!window.__alertFired }))()`);
out('live state end:', JSON.stringify(live));
dump('live-end-state', live);

// ══ EVIDENCE (pre-STOP) ══
const evidence = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('cmdrunner_live_interactions');
  const is = g.cmdrunner_live_interactions || [];
  return JSON.stringify(is.map(i => ({
    t: i.interactionType ?? i.type,
    end: i.behavioralEvidence?.window?.endReason,
    dlg: i.behavioralEvidence?.applicationEvidence?.triggeredDialog ?? i.triggeredDialog ?? null,
    dlgMsg: i.behavioralEvidence?.applicationEvidence?.dialogMessage ?? null,
    net: i.behavioralEvidence?.applicationEvidence?.networkActivity?.length ?? 0,
    rs: i.behavioralEvidence?.applicationEvidence?.resultingState ? {
      url: i.behavioralEvidence.applicationEvidence.resultingState.url,
      items: i.behavioralEvidence.applicationEvidence.resultingState.items.map(x => ({k:x.kind,n:x.numericValue,e:x.entityId,p:x.domPath,attrs:x.attributes,uniq:x.uniqueInSnapshot}))
    } : null
  })));
})()`);
out('\n=== EVIDENCE (pre-STOP) ===');
out(evidence);
let evArr = []; try { evArr = JSON.parse(evidence); } catch {}
dump('evidence-prestop', evArr);
check('evidence: interactions captured', evArr.length >= 8, `${evArr.length} interactions`);
check('evidence: network activity (search fetch + cart POSTs)', evArr.some(i => i.net > 0), `total net rows = ${evArr.reduce((s,i)=>s+i.net,0)}`);
const withRS = evArr.filter(i => i.rs && i.rs.items.length);
check('evidence: resultingState items', withRS.length >= 2, `${withRS.length} w/ RS`);
out('RS detail: ' + JSON.stringify(withRS.map(w => ({ t: w.t, url: (w.rs.url||'').replace(APP,''), items: w.rs.items.map(x => x.k + (x.n != null ? '=' + x.n : '') + '@' + x.p) }))));
const kinds = new Set(withRS.flatMap(w => w.rs.items.map(x => x.k)));
out('observed kinds: ' + [...kinds].join(','));
check('evidence: counter kind observed', kinds.has('counter'), [...kinds].join(','));
check('evidence: collection kind observed', kinds.has('collection'), '');
check('evidence: entity kind observed', kinds.has('entity'), '');
check('evidence: notification kind observed', kinds.has('notification'), '');
check('evidence: status-badge kind observed', kinds.has('status-badge'), '');
const dialogs = evArr.filter(i => i.dlg);
out('dialog evidence: ' + JSON.stringify(dialogs.map(d => ({ t: d.t, dlg: d.dlg, msg: d.dlgMsg }))));
check('evidence: dialog captured (alert or confirm)', dialogs.length >= 1, JSON.stringify(dialogs.map(d => d.dlg)));

// ══ STOP → IR ══
out('STOP_RECORDING →', await evalPanel(`(async () => { try { await chrome.runtime.sendMessage({type:'STOP_RECORDING'}); return 'ok'; } catch(e) { return String(e); } })()`));
await sleep(8000);

const planJson = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get('execution_ir_plan');
  const p = g.execution_ir_plan;
  if (!p) return JSON.stringify({ error: 'NO PLAN' });
  return JSON.stringify({
    env: p.environment?.baseUrl, n: p.steps.length,
    steps: p.steps.map(s => ({ id: s.id, action: s.action, src: s.sourceEventId, loc: s.target?.resolvedLocators?.[0]?.value,
      assertions: (s.assertions ?? []).map(a => ({ type: a.type, exp: a.expectedValue, loc: a.target?.resolvedLocators?.[0]?.value, from: a.derivedFrom })) }))
  });
})()`);
out('\n=== IR PLAN ===');
out(planJson);
dump('ir-plan', (() => { try { return JSON.parse(planJson); } catch { return { raw: planJson }; } })());
let plan; try { plan = JSON.parse(planJson); } catch { plan = { error: 'unparseable' }; }
check('IR: plan generated', !plan.error, String(planJson).slice(0, 200));
if (!plan.error) {
  const allAsr = plan.steps.flatMap(s => s.assertions ?? []);
  const byKind = {};
  allAsr.forEach(a => { byKind[a.from] = (byKind[a.from] || 0) + 1; });
  out('assertion kinds derived: ' + JSON.stringify(byKind) + ' | types: ' + JSON.stringify(allAsr.reduce((m,a)=>{m[a.type]=(m[a.type]||0)+1;return m;},{})));
  check('IR: assertions derived', allAsr.length >= 3, `${allAsr.length} assertions`);
  check('IR: textMatch (counter) derived', allAsr.some(a => a.type === 'textMatch'), '');
  check('IR: COUNT (collection) derived', allAsr.some(a => a.type === 'count'), JSON.stringify(allAsr.filter(a=>a.type==='count')));
  check('IR: presence (entity/notification) derived', allAsr.some(a => a.type === 'presence'), '');
  const sbAsr = allAsr.filter(a => a.type==='textMatch' && (String(a.loc).includes('stock-status') || String(a.exp)==='In stock'));
  const notifAsr = allAsr.filter(a => a.type === 'presence' && a.exp === null && (a.loc ?? '').includes('toast-slot'));
  check('IR: status-badge textMatch derived', sbAsr.length >= 1, JSON.stringify(sbAsr.map(a=>({loc:a.loc,exp:a.exp}))));
  check('IR: notification presence derived (expectedValue=null, presence of region)', notifAsr.length >= 1, JSON.stringify(notifAsr.map(a=>({loc:a.loc,exp:a.exp}))));
  const entityAsr = allAsr.filter(a => a.type === 'presence' && /data-sku|data-asin|data-product-id/.test(String(a.loc)) || (a.type==='presence' && a.loc==='#results'));
  check('IR: entity presence derived (identity-attribute OR #id-fallback locator)', entityAsr.length >= 1, JSON.stringify(entityAsr.map(a=>({loc:a.loc}))));
  const srcs = plan.steps.map(s => s.src);
  check('IR: distinct sourceEventIds', new Set(srcs).size === srcs.length, srcs.join('|').slice(0,200));
  const navSteps = plan.steps.filter(s => /nav/i.test(s.action));
  check('IR: navigation step present', navSteps.length >= 1, JSON.stringify(navSteps.map(s=>({a:s.action,l:s.loc}))));
  const selSteps = plan.steps.filter(s => /select/i.test(s.action));
  out('select steps: ' + JSON.stringify(selSteps.map(s => ({ a: s.action, l: s.loc }))));
}

// ══ RUN_TEST ══
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
  out('step statuses: ' + JSON.stringify(sr.map(s => ({ id: s.stepId ?? s.id, st: s.status, err: String(s.error?.message ?? '').slice(0, 80) }))));
  check('RUN_TEST: run completed', exec.status !== 'error', `status=${exec.status} passed=${exec.passedSteps}/${exec.stepCount}`);
  let eP = 0, eF = 0;
  for (const s of sr) for (const a of (s.assertionResults ?? [])) a.passed ? eP++ : eF++;
  check('RUN_TEST: soft assertions evaluated', (eP + eF) >= 3, `pass=${eP} fail=${eF}`);
  const failedAsr = sr.flatMap(s => (s.assertionResults ?? []).filter(a => !a.passed).map(a => ({ step: s.stepId, type: a.type, exp: a.expectedValue, act: a.actualValue, msg: String(a.message ?? '').slice(0, 140) })));
  dump('failed-assertions', failedAsr);
  out('failed assertions: ' + JSON.stringify(failedAsr));
} else {
  check('RUN_TEST: run completed', false, 'no execution_result');
}

// ══ CODEGEN ══
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
  check('codegen: expect.soft present', s.includes('expect.soft'), '');
  check('codegen: aria/label locators present', /aria-label|getByLabel|getByRole/.test(s), '');
  check('codegen: toHaveCount present', s.includes('toHaveCount'), '');
  out('--- spec excerpt ---'); out(s.slice(0, 1200));
}

// ══ UNDERSTANDING / KNOWLEDGE (IndexedDB via panel context) ══
const kdb = await evalPanel(`(async () => {
  try {
    const dbs = await indexedDB.databases();
    const ours = dbs.filter(d => /cmdrunner|knowledge/i.test(d.name)).map(d => d.name);
    return JSON.stringify({ dbs: ours });
  } catch (e) { return JSON.stringify({ err: String(e) }); }
})()`);
out('knowledge DBs: ' + kdb);
dump('knowledge-dbs', kdb);
const und = await evalPanel(`(async () => {
  const g = await chrome.storage.local.get(null);
  const keys = Object.keys(g).filter(k => /understand|knowledge|workflow|repo/i.test(k));
  return JSON.stringify(keys.map(k => ({ k, size: JSON.stringify(g[k]).length, hint: JSON.stringify(g[k]).slice(0, 150) })));
})()`);
out('understanding/knowledge storage keys: ' + und);
dump('knowledge-storage-keys', (() => { try { return JSON.parse(und); } catch { return und; } })());
check('knowledge: understanding_result written', /understanding_result/.test(und), und.slice(0, 200));

// ══ CP8: knowledge/contract over the REAL DB (same browser session) ══
try {
  await panel.send('Runtime.evaluate', { expression: CP8_CODE, returnByValue: true });
  const pr = await panel.send('Runtime.evaluate', { expression: '(async () => { try { return await __cp8probe.run(); } catch (e) { return JSON.stringify({probeError: String(e), stack: String(e && e.stack).slice(0, 500)}); } })()', awaitPromise: true, returnByValue: true });
  let cp8; try { cp8 = JSON.parse(pr.result.value); } catch { cp8 = { probeError: String(pr.result?.value).slice(0, 400) }; }
  dump('cp8-probe-result', cp8);
  out('CP8 probe: ' + JSON.stringify(cp8).slice(0, 1500));
  check('CP8: applications listed from real DB', Array.isArray(cp8.apps) && cp8.apps.length >= 1, JSON.stringify(cp8.apps));
  check('CP8: behavior sessions enumerable', Array.isArray(cp8.sessions) && cp8.sessions.length >= 1, `${cp8.sessions?.length ?? 0} sessions`);
  check('CP8: actions linked to workflow patterns', Array.isArray(cp8.actions) && cp8.actions.length >= 1 && cp8.actions.some(a => a.wf > 0), JSON.stringify((cp8.actions ?? []).slice(0, 8)));
  check('CP8: application descriptor present (signatures/sessions/gaps)', cp8.describe && cp8.describe.signatures > 0, JSON.stringify(cp8.describe));
  // D3: repository healing wrote element rows in THIS session
  const d3 = await panel.send('Runtime.evaluate', { expression: `(async () => {
    try {
      const names = await indexedDB.databases();
      const repo = names.find(n => /repository/i.test(n.name));
      if (!repo) return JSON.stringify({ repoDb: false });
      return new Promise((resolve) => {
        const req = indexedDB.open(repo.name);
        req.onsuccess = () => {
          const db = req.result;
          const stores = [...db.objectStoreNames];
          let store = stores.find(s => /element/i.test(s));
          if (!store) { resolve(JSON.stringify({ repoDb: true, stores })); db.close(); return; }
          const tx = db.transaction(store, 'readonly');
          const all = tx.objectStore(store).getAll();
          all.onsuccess = () => { resolve(JSON.stringify({ repoDb: true, stores, elementCount: all.result.length, sample: all.result.slice(0, 3).map(e => ({ id: e.id ?? e.elementId, name: e.name ?? e.logicalName, loc: (e.locators && e.locators[0] && (e.locators[0].value ?? e.locators[0].css)) ?? e.primaryLocator ?? null, heal: e.healCount ?? e.healedCount ?? e.lastHealedAt ?? null })) })); db.close(); };
          all.onerror = () => { resolve(JSON.stringify({ repoDb: true, stores, err: 'read err' })); db.close(); };
        };
      });
    } catch (e) { return JSON.stringify({ err: String(e) }); }
  })()`, awaitPromise: true, returnByValue: true });
  let d3r; try { d3r = JSON.parse(d3.result.value); } catch { d3r = { err: String(d3.result?.value).slice(0, 200) }; }
  dump('d3-repository-elements', d3r);
  out('D3 repository elements: ' + JSON.stringify(d3r));
  check('D3: repository elements table populated by healFromRecording', d3r.elementCount > 0, JSON.stringify(d3r.sample ?? d3r));
} catch (e) { check('CP8: probe executed', false, String(e).slice(0, 300)); }

out(`\n════ R3 FULL-AUDIT — ${PASS} PASS / ${FAIL} FAIL ════`);
fs.writeFileSync(`${DUMP}/summary.txt`, `PASS=${PASS} FAIL=${FAIL}`);
try { browser.send('Browser.close'); } catch {}
await sleep(1200);
process.exit(0);
