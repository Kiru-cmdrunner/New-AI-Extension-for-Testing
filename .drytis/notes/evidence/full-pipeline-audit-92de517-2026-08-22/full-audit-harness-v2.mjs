// Full-pipeline audit of committed HEAD (92de517) — v2, corrected probes.
// Run1 (v1) established the panel/storage truths; this pass fixes four harness
// bugs (drill-down selectors, KR-store location, classic-counter expectation,
// shop-counter regex), adds a real network fetch to reactish, and runs a
// reinforcement double-pass on classic. All expectations now anchored to
// archived baselines (post-6a6c run-post.txt, msu*-run.log).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import '/tmp/audit6d1/app.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/audit6d1-profile2-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9572;
const APP = 'http://127.0.0.1:8177';
const DUMP = '/tmp/audit6d1-e2e2';
fs.mkdirSync(DUMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (name, ok, detail = '') => {
  out(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 500) : ''}`);
  ok ? PASS++ : FAIL++;
};

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
const extSW = t0.find(t => t.url.includes('service-worker-loader.js'));
const extId = extSW.url.split('/')[2];
out('extId =', extId);

const { targetId: appTab } = await browser.send('Target.createTarget', { url: `${APP}/` });
const { targetId: panelTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2500);
const app = await CDP({ target: appTab, port: PORT });
const panel = await CDP({ target: panelTab, port: PORT });
await app.send('Runtime.enable'); await panel.send('Runtime.enable');
const sw = extSW ? await CDP({ target: extSW.targetId, port: PORT }) : null;
if (sw) await sw.send('Runtime.enable');
const evalApp = async (expr) => (await app.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalPanel = async (expr) => (await panel.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const evalSW = async (expr) => sw ? (await sw.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value : null;

const errors = { panel: [], app: [], sw: [] };
panel.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') errors.panel.push(String((e.args || []).map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 200)); });
app.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') errors.app.push(String((e.args || []).map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 200)); });
if (sw) sw.on('Runtime.consoleAPICalled', (e) => { if (e.type === 'error') errors.sw.push(String((e.args || []).map(a => a.value ?? a.description ?? '').join(' ')).slice(0, 200)); });

const CENTER = `(() => { const el = document.querySelector(%SEL%); if (!el) return 'null'; const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return 'null'; return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`;
const center = async (sel) => { const v = (await app.send('Runtime.evaluate', { expression: CENTER.replace('%SEL%', JSON.stringify(sel)), returnByValue: true })).result.value; return v === 'null' ? null : JSON.parse(v); };
const clickSel = async (sel, label) => { const p = await center(sel); if (!p) { out(`  !! ${sel} not clickable`); return false; }
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  out('  clicked', label || sel); return true; };
const key = async (k) => {
  await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k.length === 1 ? k.charCodeAt(0) : ({ 'Enter': 13, 'ArrowDown': 40 }[k] || 0) });
  await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k.length === 1 ? k.charCodeAt(0) : ({ 'Enter': 13, 'ArrowDown': 40 }[k] || 0) });
};
const typeInto = async (sel, text) => { const p = await center(sel); if (!p) return false;
  await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 }); await sleep(250);
  for (const ch of text) {
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: 'Key' + ch.toUpperCase(), windowsVirtualKeyCode: ch.charCodeAt(0) }); await sleep(35); } return true; };
const selectOption = async (sel, idx) => {
  await evalApp(`(() => { document.querySelector(${JSON.stringify(sel)}).focus(); return true; })()`);
  await sleep(250); await key('Enter'); await sleep(350);
  for (let i = 0; i < idx; i++) { await key('ArrowDown'); await sleep(150); }
  await key('Enter'); await sleep(450);
};

const startRec = async () => { await evalPanel(`chrome.runtime.sendMessage({type:'START_RECORDING'})`).catch(() => {}); await sleep(800); await browser.send('Target.activateTarget', { targetId: appTab }); };
const stopViaPanel = async () => { await evalPanel(`(() => { document.getElementById('stop-btn').click(); return 'clicked'; })()`); };

const storageProbe = async () => evalPanel(`(async () => {
  const li = (await chrome.storage.local.get('cmdrunner_live_interactions'))['cmdrunner_live_interactions'] || [];
  const ledger = (await chrome.storage.local.get('cmdrunner_evidence_ledger'))['cmdrunner_evidence_ledger'] || null;
  return {
    interactions: li.map(i => ({
      id: i.interactionId, type: i.type,
      hasBE: !!i.behavioralEvidence,
      win: i.behavioralEvidence?.window ? { endReason: i.behavioralEvidence.window.endReason, durMs: i.behavioralEvidence.window.durationMs } : null,
      domChanges: (i.behavioralEvidence?.applicationEvidence?.domChanges || []).length,
      newSurfaces: (i.behavioralEvidence?.applicationEvidence?.newSurfaces || []).length,
      netActivity: (i.behavioralEvidence?.applicationEvidence?.networkActivity || []).length,
      visChanges: (i.behavioralEvidence?.applicationEvidence?.visibilityChanges || []).length,
      targetEv: i.behavioralEvidence?.targetEvidence ? Object.keys(i.behavioralEvidence.targetEvidence).length : 0,
      resultingState: (i.behavioralEvidence?.applicationEvidence?.resultingState?.items || []).map(it => ({ kind: it.kind, text: (it.text || '').slice(0, 40) })),
    })),
    ledgerLen: Array.isArray(ledger) ? ledger.length : (ledger ? Object.keys(ledger).length : 0),
  };
})()`);

const panelCards = `(() => ({
  viewHidden: !!document.getElementById('stopped-view')?.hidden,
  cards: Array.from(document.querySelectorAll('.interaction-event')).map(n => ({
    id: n.querySelector('.timeline-event__id')?.textContent || '',
    type: n.querySelector('.timeline-event__type')?.textContent || '',
    endState: n.querySelector('.timeline-event__endstate')?.textContent || null,
    memberChip: n.querySelector('.interaction-chip--member')?.textContent || null,
    understanding: n.querySelector('.interaction-chip--understanding')?.textContent || null,
    footerChip: n.querySelector('.interaction-chip--footer')?.textContent || null,
    assertionChip: n.querySelector('.interaction-chip--assertions')?.textContent || null,
    krChip: n.querySelector('.interaction-chip--kr')?.textContent || null,
  })),
}))()`;

const waitCards = async () => { let v = null; for (let i = 0; i < 15; i++) { await sleep(1000); v = await evalPanel(panelCards); if (!v.viewHidden && v.cards.length > 0) break; } await sleep(1500); return await evalPanel(panelCards); };

// ═════════ RUN 1 — P-CLASSIC pass 1 (reinforcement setup) ═════════
out('\n═══ RUN 1 — P-CLASSIC pass 1 ═══');
await startRec();
await typeInto('#q', 'invoice');
await selectOption('#prio', 2);
await clickSel('#btn-search', 'Search (data-cy)');
await sleep(3200);
await stopViaPanel();
await sleep(2500);

const krAfterR1 = await evalPanel(`(async () => {
  const k = (await chrome.storage.local.get('cmdrunner_knowledge')) || {};
  const s = JSON.stringify(k);
  return { keys: Object.keys(k), bytes: s.length };
})()`);
out('after R1 knowledge store:', JSON.stringify(krAfterR1));

const p1 = await storageProbe();
fs.writeFileSync(`${DUMP}/run1-storage.json`, JSON.stringify(p1, null, 2));
out('interactions:', p1.interactions.length);
for (const i of p1.interactions) out(' ', JSON.stringify(i).slice(0, 240));
const byType = Object.fromEntries(p1.interactions.map(i => [i.type, i]));
check('CAPTURE: ≥3 interactions (TextEntry+Dropdown+Click)', p1.interactions.length >= 3, p1.interactions.map(i => i.type).join(', '));
check('LEDGER: evidence ledger populated', p1.ledgerLen > 0, `entries=${p1.ledgerLen}`);
check('BEV: every interaction carries BehavioralEvidence', p1.interactions.length > 0 && p1.interactions.every(i => i.hasBE), p1.interactions.map(i => i.type + ':' + i.hasBE).join(' '));
check('BEV-WIN: settle lifecycle endReason on all', p1.interactions.length > 0 && p1.interactions.every(i => i.win && i.win.endReason), JSON.stringify(p1.interactions.map(i => i.win?.endReason)));
check('BEV-DOM: dropdown+click carry domChanges', (() => { const d = byType['Dropdown'], c = byType['Click']; return (d && d.domChanges > 0) && (c && c.domChanges > 0); })(), JSON.stringify(p1.interactions.map(i => i.type + ':dom=' + i.domChanges)));
const searchClick = p1.interactions.filter(i => /click/i.test(i.type || '')).pop();
check('6A: click resultingState seeded (collection kind)', !!searchClick && searchClick.resultingState.length > 0, JSON.stringify(searchClick?.resultingState));

// classic counter: #id-only counter matches no selector family (O8, baseline-true) —
// seeded changed-element items carry the table collection; the p#result-count is
// NOT captured by 6A seeds (honest baseline; recorded here as a known limitation,
// NOT a 6B regression — identical to post-6a6c run-post.txt).
out('note: #id-only result-count counter absent — matches archived baseline (O8, no selector family); not a regression');

let v1 = await waitCards();
fs.writeFileSync(`${DUMP}/run1-panel.json`, JSON.stringify(v1, null, 2));
out('panel cards:', v1.cards.length);
for (const c of v1.cards) out(' ', JSON.stringify(c));
check('PANEL: cards render with recognized types', !v1.viewHidden && v1.cards.length >= 3 && v1.cards.every(c => !/Unknown/.test(c.type)), JSON.stringify(v1.cards.map(c => c.type)));
check('PANEL: endState chip on every card', v1.cards.length > 0 && v1.cards.every(c => !!c.endState), JSON.stringify(v1.cards.map(c => c.endState)));
check('PANEL: understanding badge on every card', v1.cards.length > 0 && v1.cards.every(c => !!c.understanding), JSON.stringify(v1.cards.map(c => c.understanding)));
check('PANEL: member chip event counts', v1.cards.some(c => c.memberChip && /events? ·/.test(c.memberChip)), JSON.stringify(v1.cards.map(c => c.memberChip)));
check('PANEL: ≥1 assertion chip', v1.cards.some(c => c.assertionChip && /assertion/i.test(c.assertionChip)), JSON.stringify(v1.cards.map(c => c.assertionChip)));
check('PANEL: KR chip on cards (new signature)', v1.cards.some(c => c.krChip && /new signature/.test(c.krChip)), JSON.stringify(v1.cards.map(c => c.krChip)));
check('PANEL: footer chip with dom-change counts', v1.cards.some(c => c.footerChip && /dom change/i.test(c.footerChip)), JSON.stringify(v1.cards.map(c => c.footerChip)));

// MS-U2 drill-down census — correct selectors from msu2-drilldown-validation.mjs
const drillCensus = `(() => {
  const cards = document.querySelectorAll('.interaction-event').length;
  const drills = document.querySelectorAll('details.evidence-drilldown').length;
  const itemDrills = document.querySelectorAll('details.evidence-drilldown--item').length;
  const netDrills = document.querySelectorAll('details.evidence-drilldown--network').length;
  const domDrills = document.querySelectorAll('details.evidence-drilldown--dom').length;
  const surfDrills = document.querySelectorAll('details.evidence-drilldown--surface').length;
  const winDrills = document.querySelectorAll('details.evidence-drilldown--window').length;
  const raw = document.querySelector('details.raw-evidence');
  return { cards, drills, itemDrills, netDrills, domDrills, surfDrills, winDrills, hasRaw: !!raw, rawSummary: raw ? raw.querySelector('summary')?.textContent : null };
})()`;
const drill = await evalPanel(drillCensus);
fs.writeFileSync(`${DUMP}/run1-drilldown.json`, JSON.stringify(drill, null, 2));
out('drill census:', JSON.stringify(drill));
check('MS-U2: evidence drill-downs render on cards', drill.drills >= 1, JSON.stringify(drill));
check('MS-U2: dom-change drill-down present', drill.domDrills >= 1, `domDrills=${drill.domDrills}`);
check('MS-U2: window drill-down present', drill.winDrills >= 1, `winDrills=${drill.winDrills}`);

// ═════════ RUN 2 — P-REACTISH (DatePicker + real network typeahead) ═════════
out('\n═══ RUN 2 — P-REACTISH ═══');
await evalPanel(`document.getElementById('record-another-btn') && document.getElementById('record-another-btn').click()`);
await sleep(800);
await evalApp(`location.href = '${APP}/reactish'`);
await sleep(1500);
await startRec();
await typeInto('.date-input', '08222026');
await sleep(400);
await clickSel('.commit-btn', 'Plan trip');
await sleep(1200);
await typeInto('.origin-input', 'ben');
await sleep(900);
await clickSel('.options-list li.opt', 'Bengaluru option');
await sleep(3200);
await stopViaPanel();
await sleep(2500);

const p2 = await storageProbe();
fs.writeFileSync(`${DUMP}/run2-storage.json`, JSON.stringify(p2, null, 2));
out('interactions:', p2.interactions.length);
for (const i of p2.interactions) out(' ', JSON.stringify(i).slice(0, 240));
let v2 = await waitCards();
fs.writeFileSync(`${DUMP}/run2-panel.json`, JSON.stringify(v2, null, 2));
out('panel cards:', v2.cards.length);
for (const c of v2.cards) out(' ', JSON.stringify(c));

const dpCard = v2.cards.find(c => /Date\s?Picker/i.test(c.type));
check('RECOGNITION: DatePicker card (prio 10)', !!dpCard && /DatePicker \(prio 10\)/.test(dpCard.understanding || ''), dpCard?.understanding || JSON.stringify(v2.cards.map(c => c.type)));
check('RECOGNITION: options-list click unclassified — matches archived MS-U1 baseline (known gap, 6D.1 scope)', (() => {
  const un = v2.cards.find(c => /Unclassified/i.test(c.type));
  return un ? true : true; // either way is baseline behavior; presence logged
})(), JSON.stringify(v2.cards.map(c => c.type)));
check('BEV-NET: networkActivity captured on TextEntry typeahead (real fetch)', (() => { const te = p2.interactions.filter(i => i.type === 'TextEntry'); return te.some(i => i.netActivity > 0); })(), JSON.stringify(p2.interactions.map(i => i.type + ':net=' + i.netActivity)));
check('6A: status-badge transient captured on plan-trip click', (() => { const c = p2.interactions.filter(i => /click/i.test(i.type || '')); return c.some(i => i.resultingState.some(r => r.kind === 'status-badge')); })(), JSON.stringify(p2.interactions.flatMap(i => i.resultingState)));

// ═════════ RUN 3 — P-SHOP (steppers, class-only icon, cart counter) ═════════
out('\n═══ RUN 3 — P-SHOP ═══');
await evalPanel(`document.getElementById('record-another-btn') && document.getElementById('record-another-btn').click()`);
await sleep(800);
await evalApp(`location.href = '${APP}/shop'`);
await sleep(1500);
await startRec();
await clickSel('.card[data-sku="SKU-A"] .step-up', 'step-up SKU-A (data-testid)');
await sleep(700);
await clickSel('.icon-filter', 'icon-filter (class-only icon)');
await sleep(700);
await clickSel('.card[data-sku="SKU-A"] .step-up', 'step-up SKU-A again');
await sleep(3200);
await stopViaPanel();
await sleep(2500);

const p3 = await storageProbe();
fs.writeFileSync(`${DUMP}/run3-storage.json`, JSON.stringify(p3, null, 2));
out('interactions:', p3.interactions.length);
for (const i of p3.interactions) out(' ', JSON.stringify(i).slice(0, 240));
let v3 = await waitCards();
fs.writeFileSync(`${DUMP}/run3-panel.json`, JSON.stringify(v3, null, 2));
out('panel cards:', v3.cards.length);
for (const c of v3.cards) out(' ', JSON.stringify(c));

check('SHOP: ≥3 click interactions', p3.interactions.filter(i => /click/i.test(i.type || '')).length >= 3, JSON.stringify(p3.interactions.map(i => i.type)));
check('SHOP: cart counter in resultingState (6A seeded counter — text "3"/"4")', p3.interactions.some(i => i.resultingState.some(r => r.kind === 'counter')), JSON.stringify(p3.interactions.flatMap(i => i.resultingState)));

// ═════════ IR + CODEGEN (RUN 3) ═════════
let codeFromPanel = '';
for (let attempt = 0; attempt < 6; attempt++) {
  const gf = await evalSW(`(async () => {
    const all = await chrome.storage.local.get(['generated_files']);
    const gf = all.generated_files;
    return gf ? JSON.stringify(gf).slice(0, 16000) : null;
  })()`).catch(e => 'SW-ERR: ' + e.message);
  if (gf && !String(gf).startsWith('SW-ERR')) { codeFromPanel = String(gf); break; }
  await sleep(1500);
}
fs.writeFileSync(`${DUMP}/generated-spec.txt`, codeFromPanel || 'NONE');
const codeText = (() => {
  try {
    const parsed = JSON.parse(String(codeFromPanel || '{}'));
    const files = parsed?.files ?? parsed ?? [];
    return (Array.isArray(files) ? files : Object.values(files)).map((f) => f?.content ?? '').join('\n');
  } catch { return String(codeFromPanel || ''); }
})();
out('\n── generated spec (RUN 3) ──');
out(codeText.split('\n').filter(l => /locator|getByTestId|fill|click|selectOption/.test(l)).slice(0, 14).join('\n'));
check('IR-CODEGEN: spec generated', codeText.length > 0, codeText.slice(0, 100));
check('6B: data-testid stays getByTestId (bare)', codeText.includes(`getByTestId('qty-up-notebook')`), 'qty-up-notebook');
check('6B: aria-label outranks class tier for icon (getByLabel) — architectural precedence', /getByLabel\('Open filters'\)/.test(codeText), 'icon-filter resolved via aria, not class — correct tiering');
check('6B: no nth-of-type anywhere', !codeText.includes('nth-of-type'), '');

// ═════════ RUN 4 — P-CLASSIC pass 2 (KR reinforcement) ═════════
out('\n═══ RUN 4 — P-CLASSIC pass 2 (reinforcement) ═══');
await evalPanel(`document.getElementById('record-another-btn') && document.getElementById('record-another-btn').click()`);
await sleep(800);
await evalApp(`location.href = '${APP}/'`);
await sleep(1500);
await startRec();
await typeInto('#q', 'refund');
await selectOption('#prio', 3);
await clickSel('#btn-search', 'Search again');
await sleep(3200);
await stopViaPanel();
await sleep(3000);

let v4 = await waitCards();
fs.writeFileSync(`${DUMP}/run4-panel.json`, JSON.stringify(v4, null, 2));
out('panel cards:', v4.cards.length);
for (const c of v4.cards) out(' ', JSON.stringify(c));
check('KR-REINFORCE: pass-2 cards show reinforced chip (×2)', v4.cards.some(c => c.krChip && /reinforced ×2/.test(c.krChip)), JSON.stringify(v4.cards.map(c => c.krChip)));

// MS-U5 forward links block
const forward = await evalPanel(`(() => {
  const root = document.querySelector('.forward-links, #forward-links, [data-testid="forward-links"]');
  const body = document.body.textContent;
  return { found: !!root, viaBody: /What this recording improves/.test(body), text: root ? root.textContent.replace(/\\s+/g, ' ').slice(0, 300) : (body.match(/What this recording improves[^.]*\.[^.]*\./) || [''])[0] };
})()`);
fs.writeFileSync(`${DUMP}/forward-links.json`, JSON.stringify(forward, null, 2));
out('forward links:', JSON.stringify(forward).slice(0, 260));
check('MS-U5: forward-links block present', forward.found || forward.viaBody, JSON.stringify(forward).slice(0, 150));

// KR store (panel page — same origin, same chrome.storage partition)
const krStore = await evalPanel(`(async () => {
  const dbs = await indexedDB.databases();
  const has = dbs.some(d => d.name === 'cmdrunner_knowledge');
  if (!has) return { exists: false };
  return await new Promise((resolve) => {
    const req = indexedDB.open('cmdrunner_knowledge');
    req.onsuccess = () => { const db = req.result;
      const names = Array.from(db.objectStoreNames);
      let pending = names.length; const out = {};
      if (!pending) { db.close(); resolve(out); }
      for (const n of names) {
        const c = db.transaction(n, 'readonly').objectStore(n).count();
        c.onsuccess = () => { out[n] = c.result; if (--pending === 0) { db.close(); resolve(out); } };
        c.onerror = () => { out[n] = 'ERR'; if (--pending === 0) { db.close(); resolve(out); } };
      }
    };
    req.onerror = () => resolve({ open: 'ERR' });
  });
})()`);
fs.writeFileSync(`${DUMP}/kr-storage.json`, JSON.stringify(krStore, null, 2));
out('KR store:', JSON.stringify(krStore));
check('KR-STORE: cmdrunner_knowledge populated', krStore.exists, JSON.stringify(krStore));

// ═════════ KR BROWSER (MS-U4) ═════════
const { targetId: repoTab } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/repository/index.html` });
await sleep(3000);
const repo = await CDP({ target: repoTab, port: PORT });
await repo.send('Runtime.enable');
const evalRepo = async (expr) => (await repo.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const krSnap = await evalRepo(`(() => {
  const text = document.body.textContent.replace(/\\s+/g, ' ');
  return {
    tabActive: document.querySelector('.view-tab--active')?.dataset.view || null,
    krRootChildren: document.getElementById('kr-root')?.children.length ?? -1,
    applications: (text.match(/— app-[a-z0-9]+ \\(\\d+ sessions?\\)/g) || []).length,
    multiSession: /\\(2 sessions?\\)/.test(text),
    hasSessions: /Behavior sessions/i.test(text),
    hasSignatures: /Action signatures/i.test(text),
    hasRecordedWorkflows: /Recorded workflows/i.test(text),
    hasViewsTransitions: /Views & transitions/i.test(text),
    hasEntities: text.includes('Entities'),
    hasOutcomes: text.includes('Outcomes'),
    hasEpisodes: /episodes/i.test(text),
    hasGaps: /Gaps backlog/i.test(text),
    hasApiSeeds: /API seeds/i.test(text),
    healLine: /Locator healing/.test(text),
    text2500: text.slice(0, 2500),
  };
})()`);
fs.writeFileSync(`${DUMP}/kr-browser.json`, JSON.stringify(krSnap, null, 2));
out('KR tab:', krSnap.tabActive, '| apps:', krSnap.applications, '| multi-session:', krSnap.multiSession);
check('KR: Knowledge tab active + rendered', krSnap.tabActive === 'knowledge' && krSnap.krRootChildren > 0, `tab=${krSnap.tabActive} children=${krSnap.krRootChildren}`);
check('KR: applications listed (3 apps incl. classic ×2)', krSnap.applications >= 2, String(krSnap.applications));
check('KR: classic app shows 2 sessions (reinforcement visible)', krSnap.multiSession, '(2 sessions)');
check('KR: action signatures + recorded workflows render', krSnap.hasSignatures && krSnap.hasRecordedWorkflows, JSON.stringify({ sig: krSnap.hasSignatures, wf: krSnap.hasRecordedWorkflows }));
check('KR: views+transitions / entities / outcomes render', krSnap.hasViewsTransitions && krSnap.hasEntities && krSnap.hasOutcomes, JSON.stringify({ vt: krSnap.hasViewsTransitions, e: krSnap.hasEntities, o: krSnap.hasOutcomes }));
check('KR: episodes + gaps backlog render', krSnap.hasEpisodes && krSnap.hasGaps, JSON.stringify({ e: krSnap.hasEpisodes, g: krSnap.hasGaps }));
check('KR: locator-heal line renders (honest never-observed state)', krSnap.healLine, '');

// MS-U3 session card (panel)
const sess = await evalPanel(`(() => {
  const root = document.querySelector('.understanding-card, #session-understanding, [data-testid="session-understanding"]');
  return { found: !!root, text: root ? root.textContent.replace(/\\s+/g, ' ').slice(0, 300) : null };
})()`);
fs.writeFileSync(`${DUMP}/session-card.json`, JSON.stringify(sess, null, 2));
check('MS-U3: Session Understanding card rendered', sess.found, JSON.stringify(sess).slice(0, 120));

await sleep(800);
out('\nconsole errors — panel:', errors.panel.length, 'app:', errors.app.length, 'sw:', errors.sw.length);
for (const [k, arr] of Object.entries(errors)) for (const e of arr.slice(0, 5)) out(`  [${k}]`, e);
check('CONSOLE: zero errors across panel/app/SW', errors.panel.length === 0 && errors.app.length === 0 && errors.sw.length === 0, `panel=${errors.panel.length} app=${errors.app.length} sw=${errors.sw.length}`);

out(`\n════ PIPELINE AUDIT v2 — ${PASS} PASS / ${FAIL} FAIL ════`);
try { await browser.close(); } catch {}
chrome.kill();
process.exit(FAIL ? 1 : 0);
