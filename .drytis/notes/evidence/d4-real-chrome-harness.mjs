// D4 real-Chrome validation harness v3.
// Chrome 148 headless quirk: a second Target.createTarget reuses/steals the
// previous tab, so only ONE tab can be driven at a time. Order:
//   Phase 1 — app tab: START_RECORDING (via extension storage/backdoor? no —
//             chrome.runtime exists only in extension pages)…
// Solution: use TWO phases with a single tab each:
//   Phase A (app tab): we can't send chrome.runtime messages from the page.
//   So instead drive recording via the PANEL tab opened FIRST, then navigate
//   THAT SAME tab to the app (panel survives as a background tab — but then
//   we lose the panel DOM…).
// Final approach: 1) open panel tab, START_RECORDING, close it. 2) open app
// tab (createTarget now reuses the closed slot — fresh), record the flow.
// 3) STOP: open panel tab again (same single-tab dance), read storage + DOM.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';

const PORT = 9533;
const APP = 'http://127.0.0.1:8098/';
const PANEL = (extId) => `chrome-extension://${extId}/src/sidepanel/index.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[d4]', ...a);
const results = [];
const check = (name, pass, evidence = '') => {
  results.push({ name, pass, evidence });
  log(`${pass ? 'PASS' : 'FAIL'} — ${name}${evidence ? ` — ${evidence}` : ''}`);
};

const browser = await CDP({ port: PORT });
try {
  const { targetInfos } = await browser.send('Target.getTargets');
  const sw = targetInfos.find((t) => t.url.includes('service-worker-loader.js'));
  const extId = sw.url.split('/')[2];
  log('extension id:', extId);

  // single driven tab: create once, navigate per phase
  const { targetId: tabId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await browser.send('Target.attachToTarget', { targetId: tabId, flatten: true });
  const send = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: S });
  await send('Runtime.enable');
  await send('Page.enable');

  const go = async (url, want) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 15; i++) {
      await sleep(1200);
      const u = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }).then((r) => r.result.value).catch(() => '');
      if (u.startsWith(want)) return u;
    }
    throw new Error(`navigation to ${url} failed (last: ${await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }).then((r) => r.result.value).catch(() => '?')})`);
  };
  const evalIn = async (expression) => {
    if (expression.trim().startsWith('await ') || expression.includes('await chrome')) {
      expression = `(async () => ${expression.includes('=>') && !expression.startsWith('await') ? `(${expression})` : ` { return (${expression}); }`})()`;
    }
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  // ── Phase 1: panel — start recording ──
  await go(PANEL(extId), 'chrome-extension://');
  await evalIn("chrome.runtime.sendMessage({type:'START_RECORDING'}).catch(e=>{throw e})");
  await sleep(1500);
  const recState = await evalIn("(await chrome.storage.local.get('cmdrunner_recording_active'))['cmdrunner_recording_active']");
  check('recording started (storage flag)', recState === true || recState?.recording === true || recState === 'true', JSON.stringify(recState)?.slice(0, 80));

  // ── Phase 2: app tab (same browser tab) — record the flow ──
  await go(APP, 'http://127.0.0.1:8098');
  const type = async (sel, text) => {
    await send('Runtime.evaluate', { expression: `document.querySelector('${sel}').focus()` });
    for (const ch of text) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
      await sleep(130);
    }
  };
  const click = async (sel) => {
    const box = await evalIn(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
    if (!box) throw new Error(`selector not found: ${sel} @ ${await evalIn('location.href')}`);
    const [x, y] = box;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(1100);
  };
  await type('#twotabsearchtextbox', 'headphones');
  for (let i = 0; i < 10; i++) {
    const has = await evalIn("!!document.querySelector('#suggestions div')");
    if (has === true) break;
    await sleep(400);
  }
  await click('#suggestions div');
  await sleep(1400); // search results
  await click('#p100 .item');
  await sleep(1400); // product page
  await click('#add-to-cart-button');
  await sleep(1600); // cart page
  // ── Phase 3: panel again — stop + inspect ──
  await go(PANEL(extId), 'chrome-extension://');
  await evalIn("chrome.runtime.sendMessage({type:'STOP_RECORDING'}).catch(e=>{throw e})");
  log('stopped — pipeline settling…');
  await sleep(10000);

  const liveRaw = await evalIn("(await chrome.storage.local.get('cmdrunner_live_interactions'))['cmdrunner_live_interactions']");
  const liveCount = Array.isArray(liveRaw) ? liveRaw.length : -1;
  check('interactions captured during recording', liveCount > 0, `live=${liveCount}`);

  const storageKeys = await evalIn('Object.keys(await chrome.storage.local.get(null))');
  log('storage keys after STOP:', JSON.stringify(storageKeys));
  const planKey = storageKeys.find((k) => k.includes('ir_plan'));
  const filesKey = storageKeys.find((k) => k.includes('generated'));
  check('IR plan key present in storage', !!planKey, planKey ?? 'missing');
  check('generated files key present in storage', !!filesKey, filesKey ?? 'missing');

  // reload panel to render post-STOP storage
  await send('Page.reload');
  await sleep(2500);

  const plan = planKey ? await evalIn(`(await chrome.storage.local.get('${planKey}'))['${planKey}'] ?? null`) : null;
  check('IR plan persisted after STOP', !!plan, plan ? `${plan.steps?.length} steps` : 'null');
  if (plan) {
    const lens = plan.steps.map((s) => s.assertions?.length ?? 0);
    check('every IR step carries zero assertions (stub reality)', lens.every((n) => n === 0), lens.join(','));
  }

  const filesRaw = filesKey ? await evalIn(`(await chrome.storage.local.get('${filesKey}'))['${filesKey}']`) : null;
  const filesList = Array.isArray(filesRaw) ? filesRaw : filesRaw?.files ?? [];
  const spec = filesList.find?.((f) => f.path?.endsWith('.spec.ts')) ?? null;
  check('generated spec file present', !!spec, spec?.path ?? 'none');
  if (spec) {
    check('D4 banner present in generated spec', spec.content.includes('No assertions generated — assertion derivation is not available'));
    const body = spec.content.replace(/import \{ test, expect \} from '@playwright\/test';/, '');
    const expectCalls = (body.match(/[^.\w]expect\(/g) ?? []).length;
    check('zero expect() call sites in generated spec body', expectCalls === 0, `count=${expectCalls}`);
  }

  // Panel DOM: IR steps section
  const ps = await evalIn(`(() => {
    const list = document.getElementById('ir-steps-list');
    const section = document.getElementById('ir-steps-section');
    const cards = list ? list.children.length : -1;
    const markers = list ? list.querySelectorAll('.step-card__unavailable').length : -1;
    const realRows = list ? Array.from(list.children).filter(c => (c.textContent||'').includes('Assertions:') && !c.textContent.includes('none —')).length : -1;
    return { hidden: section?.hidden ?? null, cards, markers, realRows };
  })()`);
  check('side panel renders IR step cards', ps.cards > 0, `cards=${ps.cards} sectionHidden=${ps.hidden}`);
  check('every step card shows the D4 none-marker', ps.cards > 0 && ps.markers === ps.cards, `markers=${ps.markers}/cards=${ps.cards}`);
  check('no card shows real assertion rows', ps.realRows === 0, `realRows=${ps.realRows}`);

  // ── Run Test from the panel (real) ──
  // NOTE (pre-existing, out of D4 scope): the executor content script
  // (src/execution/executor-content-script.js) is not part of the dist
  // build, so RUN_TEST in the shipped extension returns status=error with
  // 0 stepResults. We record the honest error render, then seed a realistic
  // replay-only execution_result to validate the D4 row rendering in the
  // real panel (same shape handleRunTest writes for a passing replay).
  await evalIn("document.getElementById('run-test-btn').click()");
  await sleep(11000);

  const errState = await evalIn(`(() => {
    const body = document.getElementById('execution-body');
    return body ? body.textContent.slice(0, 200) : '';
  })()`);
  check('real RUN_TEST renders its error summary honestly (pre-existing executor gap, no assertion implication)', /error/i.test(errState) && !errState.includes('Assertions:'), (errState ?? '').slice(0, 60));

  // Seed a realistic replay-only passed run (5 steps, empty assertionResults)
  const planSteps = plan?.steps ?? [];
  await evalIn(`(async () => {
    const summary = {
      status: 'passed',
      stepCount: ${planSteps.length || 5},
      passedSteps: ${planSteps.length || 5},
      failedSteps: 0,
      errorSteps: 0,
      skippedSteps: 0,
      durationMs: 4200,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      executionRunId: 'seeded-d4-replay-run',
      stepResults: ${JSON.stringify((planSteps.length ? planSteps : [1,2,3,4,5].map((n) => ({ id: 'step-' + n }))).map((s) => ({ stepId: s.id ?? s, status: 'passed', durationMs: 800, assertionResults: [] })))},
    };
    await chrome.storage.local.set({ execution_result: summary });
  })()`);
  await send('Page.reload');
  await sleep(2500);

  const es = await evalIn(`(() => {
    const body = document.getElementById('execution-body');
    const text = body ? body.textContent : '';
    const unavail = body ? body.querySelectorAll('.repo-status__unavailable').length : -1;
    return { text: text.slice(0, 500), unavail };
  })()`);
  check('execution summary rendered', !!es.text && es.text.length > 10, (es.text ?? '').slice(0, 60));
  check('replay-only row present', (es.text ?? '').includes('none evaluated — replay-only run (0 checks)'), `unavailRows=${es.unavail}`);
  check('PASS badge coexists with honest replay-only marker', /passed/i.test(es.text ?? '') && (es.text ?? '').includes('replay-only'), '');

  const fails = results.filter((r) => !r.pass).length;
  log(`\n==== D4 REAL-CHROME RESULT: ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails === 0 ? 0 : 1);
} catch (e) {
  log('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e.message);
  process.exit(2);
}
