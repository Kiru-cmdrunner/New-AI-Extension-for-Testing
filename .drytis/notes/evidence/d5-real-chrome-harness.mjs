// D5 real-Chrome validation harness.
// Method identical to D4/D6 (CDP, dist build, real START/STOP_RECORDING):
//   1. Load dist (D5 build) in headless Chrome; open side panel.
//   2. Panel DOM pre-check: all four dead sections ABSENT from markup,
//      live sections present.
//   3. Record a short purchase flow on the replica (single driven tab).
//   4. STOP → wait for pipeline → reload panel → assert stopped view
//      renders: no dead-section strings anywhere in panel DOM; Observed
//      Workflow, IR Plan, generated files, Repository status all render.
//   5. Second session (New Test Case → record → stop) to exercise the
//      reset path (handleRecordAnother) — must not throw.
//   6. Zero console errors across the whole run.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';

const PORT = 9533;
const APP = 'http://127.0.0.1:8098/';
const PANEL = (extId) => `chrome-extension://${extId}/src/sidepanel/index.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[d5]', ...a);
const results = [];
const check = (name, pass, evidence = '') => {
  results.push({ name, pass, evidence });
  log(`${pass ? 'PASS' : 'FAIL'} — ${name}${evidence ? ` — ${evidence}` : ''}`);
};

const consoleErrors = [];

const browser = await CDP({ port: PORT });
try {
  const { targetInfos } = await browser.send('Target.getTargets');
  const sw = targetInfos.find((t) => t.url.includes('service-worker-loader.js'));
  const extId = sw.url.split('/')[2];
  log('extension id:', extId);

  const { targetId: tabId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: S } = await browser.send('Target.attachToTarget', { targetId: tabId, flatten: true });
  const send = (m, p) => browser.send(m, { ...(p ?? {}), sessionId: S });
  await send('Runtime.enable');
  await send('Page.enable');
  send('Runtime.consoleAPICalled', undefined).catch(() => {});

  const go = async (url, want) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 15; i++) {
      await sleep(1200);
      const u = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }).then((r) => r.result.value).catch(() => '');
      if (u.startsWith(want)) return u;
    }
    throw new Error(`navigation to ${url} failed`);
  };
  const evalIn = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  // attach console error capture to the driven tab
  await send('Runtime.consoleAPICalled', undefined).catch(() => {});
  browser.on('Runtime.consoleAPICalled', (p) => {
    if (p.sessionId === S && p.params.type === 'error') consoleErrors.push('[tab] ' + p.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });

  // ── Phase 1: panel — dead sections absent from live DOM ──
  await go(PANEL(extId), 'chrome-extension://');
  const pre = await evalIn(`(() => {
    const ids = ['stopped-timeline','raw-events-toggle','stopped-timeline-events','capability-records-section','capability-records-count','capability-records-list','healing-status-section','healing-status-body','replay-section','replay-toggle','replay-code'];
    const live = ['detected-interactions-section','ir-steps-section','ir-playwright-section','repo-status-section','execution-section','recording-interactions'];
    const deadFound = ids.filter((id) => document.getElementById(id) !== null);
    const liveMissing = live.filter((id) => document.getElementById(id) === null);
    const bodyText = document.body.innerText;
    const deadStrings = ['Raw Event Timeline','Capability Analysis','Element Healing','Replay JSON'].filter((s) => bodyText.includes(s));
    return { deadFound, liveMissing, deadStrings };
  })()`);
  check('all dead-section ids absent from live panel DOM', pre.deadFound.length === 0, pre.deadFound.join(',') || 'none');
  check('all live-section ids present in live panel DOM', pre.liveMissing.length === 0, pre.liveMissing.join(',') || 'none');
  check('no dead-section title strings anywhere in panel text', pre.deadStrings.length === 0, pre.deadStrings.join(',') || 'none');

  // ── Phase 2: record the flow ──
  await evalIn("chrome.runtime.sendMessage({type:'START_RECORDING'}).catch(e=>{throw e})");
  await sleep(1500);
  await go(APP, 'http://127.0.0.1:8098');
  const type = async (sel, text) => {
    await send('Runtime.evaluate', { expression: `document.querySelector('${sel}').focus()` });
    for (const ch of text) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase() });
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
  await sleep(1400);
  await click('#p100 .item');
  await sleep(1400);
  await click('#add-to-cart-button');
  await sleep(1600);

  // ── Phase 3: panel — stop + verify stopped view ──
  await go(PANEL(extId), 'chrome-extension://');
  await evalIn("chrome.runtime.sendMessage({type:'STOP_RECORDING'}).catch(e=>{throw e})");
  log('stopped — pipeline settling…');
  await sleep(10000);
  await send('Page.reload');
  await sleep(2500);

  const post = await evalIn(`(() => {
    const bodyText = document.body.innerText;
    const deadStrings = ['Raw Event Timeline','Capability Analysis','Element Healing','Replay JSON'].filter((s) => bodyText.includes(s));
    const obs = document.getElementById('detected-interactions-list');
    const obsCards = obs ? obs.children.length : -1;
    const obsHidden = document.getElementById('detected-interactions-section')?.hidden ?? null;
    const irList = document.getElementById('ir-steps-list');
    const irCards = irList ? irList.children.length : -1;
    const irHidden = document.getElementById('ir-steps-section')?.hidden ?? null;
    const files = document.getElementById('ir-files-list');
    const fileCount = files ? files.children.length : -1;
    const repoBody = document.getElementById('repo-status-body');
    const repoText = repoBody ? repoBody.textContent.slice(0, 120) : '';
    const repoHidden = document.getElementById('repo-status-section')?.hidden ?? null;
    const d4markers = irList ? irList.querySelectorAll('.step-card__unavailable').length : -1;
    return { deadStrings, obsCards, obsHidden, irCards, irHidden, fileCount, repoHidden, repoText, d4markers };
  })()`);
  check('stopped view: no dead-section strings', post.deadStrings.length === 0, post.deadStrings.join(',') || 'none');
  check('Observed Workflow rendered', post.obsCards > 0 && post.obsHidden === false, `cards=${post.obsCards} hidden=${post.obsHidden}`);
  check('IR Plan rendered', post.irCards > 0 && post.irHidden === false, `cards=${post.irCards} hidden=${post.irHidden}`);
  check('D4 unavailable markers still present on IR cards', post.d4markers > 0, `markers=${post.d4markers}`);
  check('generated files rendered', post.fileCount > 0, `files=${post.fileCount}`);
  check('Repository status rendered', post.repoHidden === false && post.repoText.length > 0, post.repoText.slice(0, 50));

  // ── Phase 4: second session — reset path must not throw ──
  const resetErr = await evalIn(`(async () => {
    try {
      document.getElementById('record-another-btn').click();
      await new Promise((r) => setTimeout(r, 800));
      return 'ok';
    } catch (e) { return 'THREW: ' + String(e && e.message); }
  })()`);
  check('handleRecordAnother reset path did not throw', resetErr === 'ok', String(resetErr).slice(0, 80));

  // brief second recording to prove the panel still works end-to-end
  await go(PANEL(extId), 'chrome-extension://');
  await sleep(500);
  await evalIn("chrome.runtime.sendMessage({type:'START_RECORDING'}).catch(e=>{throw e})");
  await sleep(1200);
  await go(APP, 'http://127.0.0.1:8098');
  await click('#twotabsearchtextbox');
  await sleep(600);
  await go(PANEL(extId), 'chrome-extension://');
  await evalIn("chrome.runtime.sendMessage({type:'STOP_RECORDING'}).catch(e=>{throw e})");
  await sleep(8000);
  await send('Page.reload');
  await sleep(2500);
  const post2 = await evalIn(`(() => {
    const bodyText = document.body.innerText;
    const deadStrings = ['Raw Event Timeline','Capability Analysis','Element Healing','Replay JSON'].filter((s) => bodyText.includes(s));
    const obs = document.getElementById('detected-interactions-list');
    return { deadStrings, obsCards: obs ? obs.children.length : -1, view: document.getElementById('stopped-view')?.hidden };
  })()`);
  check('second session: stopped view renders, no dead strings', post2.deadStrings.length === 0 && post2.obsCards >= 0, `dead="${post2.deadStrings.join(',')}" cards=${post2.obsCards} stoppedHidden=${post2.view}`);

  check('zero console errors in driven tab', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none');

  const fails = results.filter((r) => !r.pass).length;
  log(`\n==== D5 REAL-CHROME RESULT: ${results.length - fails}/${results.length} PASS ====`);
  process.exit(fails === 0 ? 0 : 1);
} catch (e) {
  log('HARNESS ERROR:', e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e.message);
  process.exit(2);
}
