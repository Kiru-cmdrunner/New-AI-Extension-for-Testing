// 7.2-M1 real-Chrome E2E pin ⑫. House CDP pattern (6D.1 … 7.1-W2):
// start recording from panel context → trusted input on the AdaniOne clone
// → STOP → deep-link assertions. Matrix:
//   W1 chip button present with data-app-id matching the session's app
//   W2 chip click → tab opens index.html?app=…&sig=… (URL params, encoded)
//   W3 repository tab: app selector shows session origin selected;
//      focused signature row has .kr-highlight
//   W4 repo-btn (header) click → tab URL carries ?app=
//   W5 regression: stopped-view cards + understanding card unchanged,
//      zero console errors in panel and repository tabs
// Fixture: archived AdaniOne clone (phase-6f-m1-e2e-2026-08-23) on :8190,
// started by this harness, killed at exit.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9500 + Math.floor(Math.random() * 400);
const APP = 'http://127.0.0.1:8190';
const DIST = '/workspace/dist';
const OUT = '/workspace/.drytis/notes/evidence/phase-7-2-m1-e2e-2026-08-24/dumps';
const PROFILE = '/tmp/72m1-profile-' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`);
  ok ? PASS++ : FAIL++;
};
const dump = (name, data) => fs.writeFileSync(`${OUT}/${name}`, JSON.stringify(data, null, 1));
fs.mkdirSync(OUT, { recursive: true });

const fixture = spawn('node', ['/workspace/.drytis/notes/evidence/phase-6f-m1-e2e-2026-08-23/app-verbatim.mjs'], { stdio: 'ignore' });
await sleep(900);

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
const extId = t0.find(t => t.url.includes('service-worker-loader.js')).url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable'); await app.send('Page.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const consoleErrors = { panel: [], repo: [] };
await panel.send('Log.enable');
panel.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') consoleErrors.panel.push(e.entry.text); });
await panel.send('Runtime.consoleAPICalled', undefined).catch(() => {});

const startRecording = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'}).then(() => 'started')`); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopRecording = async () => evalPanel(`chrome.runtime.sendMessage({type:'STOP_RECORDING'}).then(() => 'stopped')`);
const rectOf = async (sel) => (await evalApp(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`));
const dispatch = async (type, x, y) => { await app.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };

// ── Session: one DatePicker gesture so a signature + chip exist ──
await startRecording();
const t = await rectOf('input#onward');
if (t) { await dispatch('mousePressed', t.x + t.w / 2, t.y + t.h / 2); await dispatch('mouseReleased', t.x + t.w / 2, t.y + t.h / 2); }
await sleep(700);
const cell = await rectOf('.react-datepicker__day:not(.react-datepicker__day--disabled)');
if (cell) { await dispatch('mousePressed', cell.x + cell.w / 2, cell.y + cell.h / 2); await dispatch('mouseReleased', cell.x + cell.w / 2, cell.y + cell.h / 2); }
await sleep(1200);
out('STOP →', await stopRecording());
await sleep(2500);

// ── Diagnostic dump: what does the panel context actually see? ──
const pre = await evalPanel(`(async () => {
  const o = await chrome.storage.local.get(null);
  let dbs = null;
  try { dbs = (await indexedDB.databases()).map(d => d.name); } catch (e) { dbs = 'err:' + e.message; }
  return JSON.stringify({
    sess: o.repo_session_id || null,
    liveLen: (o.cmdrunner_live_interactions || []).length,
    und: !!o.understanding_result,
    ui: o.ui_state && o.ui_state.recordingState,
    dbs,
    cardsNow: document.querySelectorAll('.interaction-event').length,
    view: !document.getElementById('stopped-view').hidden ? 'stopped' : (!document.getElementById('home-view').hidden ? 'home' : '?'),
  });
})()`);
out('PRE-RELOAD ::', pre);
fs.writeFileSync(`${OUT}/pre-reload.json`, JSON.stringify(JSON.parse(pre), null, 1));

await panel.send('Page.reload');
await sleep(3000);

// ── Diagnostic dump 2: card IDs vs episode member IDs in the live DB ──
const dbg = await evalPanel(`(async () => {
  const cards = [...document.querySelectorAll('.interaction-event')].map(c => ({
    id: c.querySelector('.timeline-event__id')?.textContent || null,
    chips: [...c.querySelectorAll('.interaction-chip--kr')].map(x => x.tagName + ':' + x.textContent.slice(0, 40)),
  }));
  const o = await chrome.storage.local.get(['understanding_result']);
  const undSid = o.understanding_result && o.understanding_result.sessionId;
  return await new Promise(res => {
    const req = indexedDB.open('cmdrunner_knowledge');
    req.onsuccess = async () => {
      const db = req.result;
      const out = { cards, undSid };
      try {
        const tx = db.transaction(['knowledgeBehaviorSessions', 'knowledgeEpisodes', 'knowledgeSignatures'], 'readonly');
        const bs = tx.objectStore('knowledgeBehaviorSessions').getAll();
        const eps = tx.objectStore('knowledgeEpisodes').getAll();
        const sigs = tx.objectStore('knowledgeSignatures').getAll();
        bs.onsuccess = () => { out.sessions = bs.result.map(r => ({ key: r.key, appId: r.appId, sessionId: r.sessionId })); };
        eps.onsuccess = () => { out.episodes = eps.result.map(e => ({ key: e.key, appId: e.appId, sessionId: e.sessionId, sigKey: e.signatureKey, members: (e.members || []).map(m => m.interactionId) })); };
        sigs.onsuccess = () => { out.sigs = sigs.result.map(s => ({ key: s.key, appId: s.appId, occ: s.occurrenceCount })); };
        tx.oncomplete = () => res(JSON.stringify(out));
      } catch (e) { out.txErr = e.message; res(JSON.stringify(out)); }
    };
    req.onerror = () => res('open-fail:' + req.error?.message);
  });
})()`);
fs.writeFileSync(`${OUT}/dbg-cards-vs-episodes.json`, JSON.stringify(JSON.parse(dbg), null, 1));
out('DBG (see dbg-cards-vs-episodes.json)');

// ── W1: chip button with data-app-id ──
// Wait for the async chip attach (display-paced, best-effort) before probing.
for (let i = 0; i < 12; i++) {
  const n = await evalPanel(`document.querySelectorAll('.interaction-chip--kr').length`);
  if (n > 0) break;
  await sleep(500);
}
const w1 = await evalPanel(`(() => {
  const chips = [...document.querySelectorAll('.interaction-chip--kr')];
  const btn = chips.find(c => c.tagName === 'BUTTON' && c.dataset.appId && c.dataset.signatureKey);
  return { total: chips.length, buttons: chips.filter(c => c.tagName === 'BUTTON').length,
           appId: btn?.dataset.appId, sig: btn?.dataset.signatureKey, text: btn?.textContent };
})()`);
dump('w1-chips.json', w1);
check('W1 chip BUTTON with data-app-id + data-signature-key (producer enrichment)',
  w1 && w1.buttons >= 1 && !!w1.appId && !!w1.sig,
  JSON.stringify(w1));
const targetAppId = w1?.appId; const targetSig = w1?.sig;

// ── W2: chip click opens deep-linked tab ──
const before = (await browser.send('Target.getTargets')).targetInfos.length;
if (targetAppId && targetSig) {
  await evalPanel(`(() => { const b = [...document.querySelectorAll('button.interaction-chip--kr')][0]; if (!b) return 'none'; b.click(); return 'clicked'; })()`);
  await sleep(1500);
  const after = (await browser.send('Target.getTargets')).targetInfos;
  const repoTabInfo = after.find(t => t.url.includes('src/repository/index.html') && t.url.includes('app='));
  dump('w2-repo-url.json', { url: repoTabInfo?.url });
  check('W2 chip click → repository tab with ?app=&sig= params',
    !!repoTabInfo && repoTabInfo.url.includes(`app=${encodeURIComponent(targetAppId)}`) && repoTabInfo.url.includes('sig='),
    repoTabInfo?.url || 'no tab');

  // ── W3: selector + highlight in the repository tab ──
  if (repoTabInfo) {
    const repo = await CDP({ target: repoTabInfo.targetId, port: PORT });
    await repo.send('Runtime.enable');
    await repo.send('Log.enable');
    repo.on('Log.entryAdded', (e) => { if (e.entry.level === 'error') consoleErrors.repo.push(e.entry.text); });
    await sleep(1800);
    const w3 = await repo.send('Runtime.evaluate', { expression: `(() => {
      const sel = document.querySelector('#kr-root select') || document.querySelector('select');
      const selected = sel ? sel.options[sel.selectedIndex]?.textContent : null;
      const hl = document.querySelector('.kr-highlight');
      return { selected, hlText: hl ? hl.textContent.slice(0, 120) : null,
               sigRows: document.querySelectorAll('[data-signature-key]').length };
    })()`, returnByValue: true }).then(r => r.result.value);
    dump('w3-repo-dom.json', w3);
    check('W3a app selector shows session app (origin) selected',
      !!w3?.selected && w3.selected.includes('127.0.0.1:8190'), JSON.stringify(w3));
    check('W3b focused signature row highlighted (.kr-highlight)',
      !!w3?.hlText && !!w3?.sigRows, JSON.stringify({ hl: w3?.hlText, rows: w3?.sigRows }));
  }
} else {
  check('W2 (skipped — W1 did not produce link data)', false, 'producer enrichment missing');
}

// ── W4: repo-btn carries session app context ──
await browser.send('Target.activateTarget', { targetId: panelTab });
await sleep(300);
const tabsBefore = (await browser.send('Target.getTargets')).targetInfos.filter(t => t.url.includes('src/repository/index.html')).length;
await evalPanel(`(() => { const b = document.getElementById('repo-btn'); if (!b) return 'none'; b.click(); return 'clicked'; })()`);
await sleep(1500);
const tabsAfter = (await browser.send('Target.getTargets')).targetInfos.filter(t => t.url.includes('src/repository/index.html'));
dump('w4-repo-btn-tabs.json', tabsAfter.map(t => t.url));
check('W4 header repo-btn opens app-scoped tab (?app= present)',
  tabsAfter.length > tabsBefore && tabsAfter[tabsAfter.length - 1].url.includes('app='),
  tabsAfter.map(t => t.url).join(' | '));

// ── W5: regression — cards + understanding intact, zero console errors ──
const w5 = await evalPanel(`(() => {
  const cards = document.querySelectorAll('.interaction-event').length;
  const und = document.querySelector('.understanding-card') ? true : false;
  const dupe = [...document.querySelectorAll('.interaction-chip--kr')].length !== new Set([...document.querySelectorAll('.interaction-chip--kr')].map(c => c.textContent)).size;
  return { cards, und, dupe };
})()`);
dump('w5-panel.json', w5);
check('W5a stopped view intact (cards ≥1, understanding card present, no chip duplication)',
  w5.cards >= 1 && w5.und && !w5.dupe, JSON.stringify(w5));
check('W5b zero console errors in panel + repository tabs',
  consoleErrors.panel.length === 0 && consoleErrors.repo.length === 0,
  JSON.stringify({ panel: consoleErrors.panel.slice(0, 3), repo: consoleErrors.repo.slice(0, 3) }));

out(`\n════ 7.2-M1 E2E pin ⑫ — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
try { chrome.kill('SIGTERM'); } catch {}
try { fixture.kill('SIGKILL'); } catch {}
setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} }, 2000);
process.exit(FAIL === 0 ? 0 : 1);
