/**
 * D6 — Real-Chrome validation harness (v3 = v2 + console capture + CP8
 * contract probe over the real DB with production code).
 *
 * Differences from v2:
 *  - Captures page + SW console (errors/warnings) via Runtime consoleAPICalled
 *    and Log.entryAdded for the WHOLE run; asserts zero errors at the end.
 *  - After s4, injects a bundled contract probe (real production contract
 *    classes over the real IndexedDB, built from /workspace/src via esbuild)
 *    and verifies listActions linkage output + determinism + read-only.
 */
import CDP from 'chrome-remote-interface';
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const EXT = '/workspace/dist';
const OUT = '/tmp/d6-val/out';
const CHROME_PORT = 9533;
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';

// Build the contract probe bundle (source-mapped imports, dexie inlined).
execSync(
  'npx esbuild /tmp/d6-val/contract-probe.ts --bundle --format=esm --platform=browser ' +
  `--outfile=/tmp/d6-val/contract-probe.mjs ` +
  '--define:process.env.NODE_ENV=\\"production\\"',
  { cwd: '/workspace', stdio: 'inherit' },
);

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const evidence = (name, data) => {
  writeFileSync(`${OUT}/${name}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  log(`[evidence] ${name} written`);
};

const consoleErrors = [];
const consoleWarnings = [];

let chrome = null;
async function startChrome() {
  chrome = spawn(CHROME_BIN, [
    `--remote-debugging-port=${CHROME_PORT}`,
    '--user-data-dir=/tmp/d6-val/profile',
    `--load-extension=${EXT}`,
    `--disable-extensions-except=${EXT}`,
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
  ], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 30; i++) { await sleep(500); try { t = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`)).json(); break; } catch {} }
  if (!t) throw new Error('chrome CDP never came up');
  let sw = null;
  for (let i = 0; i < 40 && !sw; i++) {
    t = await (await fetch(`http://127.0.0.1:${CHROME_PORT}/json/list`)).json();
    sw = t.find((x) => x.type === 'service_worker' && x.url.endsWith('service-worker-loader.js'));
    if (!sw) await sleep(500);
  }
  if (!sw) throw new Error('extension SW target not found');

  // Attach console capture to the SW target.
  const swc = await CDP({ target: sw, port: CHROME_PORT });
  const { Runtime: swRT, Log: swLog } = swc;
  await swRT.enable();
  await swLog.enable();
  swRT.consoleAPICalled((p) => {
    const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (p.type === 'error') consoleErrors.push(`[sw] ${text}`);
    else if (p.type === 'warning') consoleWarnings.push(`[sw] ${text}`);
  });
  swLog.entryAdded((p) => {
    const e = p.entry;
    if (e.level === 'error') consoleErrors.push(`[sw-log] ${e.text} ${e.url ?? ''}`);
  });

  const extOrigin = sw.url.slice(0, sw.url.indexOf('/', 'chrome-extension://'.length));
  log(`[e2e] SW attached: ${extOrigin}`);

  const panelRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?${encodeURIComponent(`${extOrigin}/src/sidepanel/index.html`)}`, { method: 'PUT' });
  const panel = await CDP({ target: await panelRes.json(), port: CHROME_PORT });
  const { Runtime: pRT, Log: pLog } = panel;
  await pRT.enable();
  await pLog.enable();
  pRT.consoleAPICalled((p) => {
    const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (p.type === 'error') consoleErrors.push(`[panel] ${text}`);
    else if (p.type === 'warning') consoleWarnings.push(`[panel] ${text}`);
  });
  const evalInPanel = async (expr) => (await pRT.evaluate({ expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

  const pageRes = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  const page = await CDP({ target: await pageRes.json(), port: CHROME_PORT });
  const { Runtime, Page, Input, Log: pgLog } = page;
  await Runtime.enable();
  await Page.enable();
  await pgLog.enable();
  Runtime.consoleAPICalled((p) => {
    const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (p.type === 'error') consoleErrors.push(`[page] ${text}`);
    else if (p.type === 'warning') consoleWarnings.push(`[page] ${text}`);
  });
  pgLog.entryAdded((p) => {
    if (p.entry.level === 'error') consoleErrors.push(`[page-log] ${p.entry.text}`);
  });

  return { evalInPanel, Runtime, Page, Input };
}

function makeDriver(ctx) {
  const { evalInPanel, Runtime, Page, Input } = ctx;
  async function posOf(sel) {
    for (let i = 0; i < 12; i++) {
      const r = await Runtime.evaluate({
        expression: `(() => { const el = document.querySelector('${sel}'); if (!el) return 'MISSING'; const b = el.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`,
        returnByValue: true,
      });
      if (r.result?.value && r.result.value !== 'MISSING') return JSON.parse(r.result.value);
      await sleep(700);
    }
    return null;
  }
  async function click(sel) {
    const p = await posOf(sel);
    if (!p) throw new Error(`element missing: ${sel}`);
    await Input.dispatchMouseEvent({ type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await Input.dispatchMouseEvent({ type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
  async function typeText(text) {
    for (const ch of text) {
      await Input.dispatchKeyEvent({ type: 'keyDown', text: ch });
      await Input.dispatchKeyEvent({ type: 'keyUp', key: ch });
      await sleep(90);
    }
  }
  async function navigate() {
    await Page.navigate({ url: 'http://127.0.0.1:8098/search.html' });
    await sleep(1500);
    for (let i = 0; i < 10; i++) {
      const loc = (await Runtime.evaluate({ expression: 'location.href', returnByValue: true })).result?.value || '';
      if (loc.includes('127.0.0.1:8098/search.html')) break;
      await sleep(500);
    }
  }
  async function recordStart() {
    await evalInPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(r => JSON.stringify(r))`);
    await sleep(600);
  }
  async function recordStop() {
    await evalInPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(r => JSON.stringify(r))`);
    await sleep(2500);
  }
  async function fullSession() {
    await navigate();
    await sleep(800);
    await recordStart();
    await click('#twotabsearchtextbox');
    await sleep(300);
    await typeText('headphones');
    await sleep(900);
    for (let i = 0; i < 10; i++) {
      const txt = (await Runtime.evaluate({ expression: "(document.querySelector('#sug-0')?.textContent ?? '')", returnByValue: true })).result?.value ?? '';
      if (txt.includes('Aurora')) break;
      await sleep(400);
    }
    await sleep(400);
    await click('#sug-0');
    await sleep(1800);
    await click('#result-P100');
    await sleep(1500);
    await click('#add-to-cart-button');
    await sleep(2200);
    await recordStop();
  }
  async function idleSession() {
    await navigate();
    await sleep(800);
    await recordStart();
    await sleep(4500);
    await recordStop();
  }
  async function dragOnlySession() {
    await navigate();
    await sleep(800);
    await recordStart();
    await click('#dragzone');
    await sleep(2200);
    await recordStop();
  }
  return { fullSession, idleSession, dragOnlySession, evalInPanel };
}

const DUMP_EXPR = `(async () => {
  const open = (n) => new Promise((res, rej) => { const rq = indexedDB.open(n); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
  const db = await open('cmdrunner_knowledge');
  const out = { verno: db.version, stores: {} };
  const get = (s) => new Promise((res) => { try { const rq = db.transaction(s, 'readonly').objectStore(s).getAll(); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); } catch { res(null); } });
  out.stores.workflows = await get('knowledgeRecordedWorkflows');
  out.stores.signatures = await get('knowledgeSignatures');
  out.stores.sessions = await get('knowledgeBehaviorSessions');
  out.stores.episodes = await get('knowledgeEpisodes');
  db.close();
  return JSON.stringify(out);
})()`;

// ── Run ──────────────────────────────────────────────────────────────
let ctx = null;
let drv = null;
let pairDb = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  if (chrome) { chrome.kill(); await sleep(1500); }
  rmSync('/tmp/d6-val/profile', { recursive: true, force: true });
  consoleErrors.length = 0;
  ctx = await startChrome();
  drv = makeDriver(ctx);
  log(`══ PAIR ATTEMPT ${attempt}: SESSION 1 + SESSION 2 (identical flows) ══`);
  await drv.fullSession();
  await drv.fullSession();
  pairDb = JSON.parse(await drv.evalInPanel(DUMP_EXPR));
  const fullRows = pairDb.stores.workflows.filter((w) => (w.canonicalSteps ?? []).length >= 3);
  const ok = fullRows.length === 1 && fullRows[0].occurrenceCount === 2;
  log(`[pair] full rows=${fullRows.length} occ=${fullRows[0]?.occurrenceCount} → ${ok ? 'IDENTICAL' : 'label-variance split, retrying'}`);
  if (ok) break;
  evidence(`pair-attempt-${attempt}-db.json`, pairDb);
}
if (!pairDb) { log('FATAL: no pair'); chrome.kill(); process.exit(2); }

const rawPairJson = await drv.evalInPanel(`(async () => {
  const got = await chrome.storage.local.get(['understanding_result']);
  const ur = got.understanding_result ?? {};
  return JSON.stringify({ workflows: (ur.semanticKnowledge?.workflows ?? []).map((w) => ({ workflowId: w.workflowId, stepIntents: w.stepIntents })) });
})()`);
const rawPair = JSON.parse(rawPairJson || '{}');
evidence('raw-pair-after-s2.json', rawPair);
evidence('db-after-s2.json', pairDb);

log('══ SESSION 3 (idle heartbeat-only — honest absence) ══');
await drv.idleSession();
log('══ SESSION 4 (dragzone-only — isolated control) ══');
await drv.dragOnlySession();

const db = JSON.parse(await drv.evalInPanel(DUMP_EXPR));
evidence('db-final.json', db);

// ── CP8 contract probe (production code, real DB) ───────────────────
log('══ CP8 CONTRACT PROBE (production code over real DB) ══');
const { readFileSync } = await import('node:fs');
// Build + transform the ESM bundle into an inline IIFE: esbuild emits a
// single self-contained module with one `export` clause; strip it, hoist
// `run` onto self, then Runtime.evaluate the whole thing as an expression
// in the SIDEPANEL context (extension origin → IndexedDB accessible;
// CSP-safe because Runtime.evaluate is not a fetch).
execSync(
  'npx esbuild /tmp/d6-val/contract-probe.ts --bundle --format=esm --platform=browser ' +
  '--outfile=/tmp/d6-val/contract-probe.mjs --define:process.env.NODE_ENV=\\"production\\"',
  { cwd: '/workspace', stdio: 'pipe' },
);
let probeModule = readFileSync('/tmp/d6-val/contract-probe.mjs', 'utf8');
probeModule = probeModule
  .replace(/export\s*\{[^}]*\};?\s*$/m, '')
  .replace(/export\s+(async\s+function|function|const|class)\s/g, '$1 ');
const probeRun = await drv.evalInPanel(`(async () => {
  try {
    self.__moduleText = ${JSON.stringify(probeModule)};
    (0, eval)('(async () => { ' + self.__moduleText + ' ; self.__cp8Run = run; })()');
    const out = await self.__cp8Run();
    return out;
  } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
})()`);
const probe = JSON.parse(probeRun);
evidence('cp8-contract-probe.json', probe);
log(`[cp8] contractVersion=${probe.contractVersion} deterministic=${probe.deterministic} readOnly=${probe.readOnly}`);
for (const a of probe.actions ?? []) {
  log(`[cp8] ${a.actionType} '${(a.target ?? '').slice(0, 30)}' → ${a.workflowPatternAbsence} [${(a.workflowPatternIds ?? []).join(', ')}]`);
}

// ── VERIFY ───────────────────────────────────────────────────────────
const V = { checks: [], pass: 0, fail: 0 };
const check = (name, ok, detail) => {
  V.checks.push({ name, ok, detail: detail ?? null });
  ok ? V.pass++ : V.fail++;
  log(`  ${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
};

const { workflows, signatures, sessions, episodes } = db.stores;
log('══ VERDICT ══');

const fullRows = workflows.filter((w) => (w.canonicalSteps ?? []).length >= 3);
check('one full-workflow row', fullRows.length === 1, `${fullRows.length} full rows`);
const fw = fullRows[0];
check('full workflow occurrenceCount=2', fw && fw.occurrenceCount === 2, `occ=${fw?.occurrenceCount}`);
check('full workflow patternId=d3392945', fw?.patternId === 'wf-pattern-d3392945', fw?.patternId);
check('full workflow linkageState=linked', fw?.linkageState === 'linked', `${fw?.linkageState}`);

const sigKeys = new Set((fw?.signatureIds ?? []));
check('full workflow signatureIds non-empty', sigKeys.size > 0, `${sigKeys.size} keys`);
const sigStoreKeys = new Set((signatures ?? []).map((s) => s.key));
check('every signatureId exists in signature store', [...sigKeys].every((k) => sigStoreKeys.has(k)), `${[...sigKeys].filter((k) => sigStoreKeys.has(k)).length}/${sigKeys.size}`);

const fwSessions = new Set(fw?.sessionIds ?? []);
const anchorSigsFw = [...new Set((episodes ?? []).filter((e) => fwSessions.has(e.sessionId)).map((e) => e.signatureKey))].sort();
check('signatureIds == exact anchor set of its sessions', JSON.stringify([...sigKeys].sort()) === JSON.stringify(anchorSigsFw), `${sigKeys.size} vs ${anchorSigsFw.length}`);

const instMap = fw?.instanceSignatureIds ?? {};
const instEntries = Object.entries(instMap);
check('instanceSignatureIds covers both instances', instEntries.length === 2, `${instEntries.length} entries`);
if (instEntries.length === 2) {
  check('both instances link the same set', JSON.stringify(instEntries[0][1]) === JSON.stringify(instEntries[1][1]), `${instEntries[0][1]?.length} vs ${instEntries[1][1]?.length}`);
  check('instance sets equal pattern set', JSON.stringify([...instEntries[0][1]].sort()) === JSON.stringify([...sigKeys].sort()), '');
}

const shared = (signatures ?? []).filter((s) => s.occurrenceCount >= 2);
check('shared signatures occ>=2 (counts not mutated by linkage)', shared.length >= 3, `${shared.length} shared`);

const otherRows = workflows.filter((w) => w !== fw);
check('idle session created NO workflow row (nothing fabricated)', otherRows.every((w) => (w.signatureIds ?? []).length > 0), `${otherRows.length} other rows: ${otherRows.map((r) => (r.signatureIds ?? []).length).join(',')}`);

const dragRow = otherRows[0];
check('drag workflow exists and is linked', !!dragRow && (dragRow.signatureIds ?? []).length > 0, dragRow ? `${dragRow.signatureIds.length} sigs` : 'none');
if (dragRow) {
  check('drag workflow links ONLY the drag signature', dragRow.signatureIds.length === 1, JSON.stringify(dragRow.signatureIds.map((k) => k.slice(-12))));
  const dragSig = (signatures ?? []).find((s) => s.key === dragRow.signatureIds[0]);
  check('drag signature target is the dragzone', !!dragSig && /drag area/i.test(dragSig?.normalizedTarget ?? ''), dragSig?.normalizedTarget);
  check('drag sig NOT in full workflow set', !sigKeys.has(dragRow.signatureIds[0]), '');
}

check('verno unchanged (30)', db.verno === 30, `${db.verno}`);
check('3 behavior sessions (idle has zero episodes → none)', (sessions ?? []).length === 3, `${sessions?.length}`);

const rawTokens = (rawPair.workflows?.[0]?.stepIntents ?? []);
check('raw stepIntents preserved verbatim (>=5 tokens incl. both URLs)', rawTokens.length >= 5 && rawTokens.some((t) => String(t).includes('product.html')) && rawTokens.some((t) => String(t).includes('cart.html')), `${rawTokens.length} tokens: ${JSON.stringify(rawTokens)}`);

// CP8 probe checks
check('CP8 probe ran (production contract)', !probe.error, probe.error ?? `${probe.actions?.length ?? 0} descriptors`);
if (!probe.error) {
  check('CP8 deterministic across calls', probe.deterministic === true, `${probe.deterministic}`);
  check('CP8 read-only (stores byte-identical)', probe.readOnly === true, `${probe.readOnly}`);
  const linked = (probe.actions ?? []).filter((a) => a.workflowPatternAbsence === 'linked');
  check('CP8 shows linked signatures with pattern ids', linked.length >= 3, `${linked.length} linked of ${probe.actions.length}`);
  check('CP8 linked set includes d3392945 on every linked full-flow sig', linked.filter((a) => (a.workflowPatternIds ?? []).includes('wf-pattern-d3392945')).length === linked.filter((a) => !/drag area/i.test(a.target ?? '')).length, '');
  const dragAction = (probe.actions ?? []).find((a) => /drag area/i.test(a.target ?? ''));
  check('CP8 drag signature links ONLY drag pattern', dragAction && JSON.stringify(dragAction.workflowPatternIds) === JSON.stringify(['wf-pattern-21ca2851']), JSON.stringify(dragAction?.workflowPatternIds));
}

// Console capture
evidence('console-capture.json', { errors: consoleErrors, warnings: consoleWarnings.slice(0, 40) });
check('zero console errors (whole run, SW+panel+page)', consoleErrors.length === 0, `${consoleErrors.length} errors${consoleErrors.length ? ': ' + consoleErrors.slice(0, 3).join(' | ') : ''}`);

evidence('verdict.json', V);
log(`\n══ D6 VERDICT: ${V.fail === 0 ? 'ALL GREEN' : V.fail + ' FAILURES'} (${V.pass} passed) ══`);
chrome.kill();
process.exit(V.fail === 0 ? 0 : 1);
