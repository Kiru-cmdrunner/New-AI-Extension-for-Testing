// HEC v2.1 real-Chrome validation harness (CDP + built extension in dist/).
// Drives REAL physical mouse input via CDP Input domain against
// serve/public/hec-validation.html and reads interactions from the panel.
// Usage: CDP_PORT=9333 HEV_PORT=4173 node hec-cdp-matrix.mjs
import WebSocket from 'ws';

const PORT = process.env.CDP_PORT || '9333';
const HTTP = `http://127.0.0.1:${PORT}`;
const SITE = process.env.HEC_SITE || `http://127.0.0.1:${process.env.HEV_PORT || '4173'}/public/hec-validation.html`;
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`${HTTP}/json/version`)).json();
const bWsUrl = list.webSocketDebuggerUrl;
if (!bWsUrl) throw new Error('no browser websocket — start Chrome with --remote-debugging-port');

const ws = new WebSocket(bWsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

let seq = 1;
const pending = new Map();
const sessions = new Map();
const swConsole = [];

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m)) { /* noop */ }
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message + ' ' + JSON.stringify(m.error.data ?? ''))) : resolve(m.result);
  } else if (m.method === 'Target.attachedToTarget') {
    const info = m.params.targetInfo;
    sessions.set(info.type + ':' + info.url, m.params.sessionId);
    if (info.type === 'service_worker') sessions.set('SW', m.params.sessionId);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    swConsole.push('[' + m.params.type + '] ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
  }
});

function send(method, params = {}, sessionId) {
  const id = seq++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 25000);
  });
}

async function evalOn(sessionId, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

// ---- attach to the MV3 service worker via autoAttach ----------------------
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
await PAUSE(1200);
// The SW idles out constantly; we only ever need the EXTENSION ID, which any
// chrome-extension:// target URL reveals (SW, page, whatever). START/STOP via
// the panel wakes the SW on demand.
const targets1 = (await send('Target.getTargets')).targetInfos;
const extTarget = targets1.find((t) => t.url.startsWith('chrome-extension://'));
if (!extTarget) { throw new Error('no extension target — extension not loaded in this Chrome'); }
const EXT_ID = extTarget.url.split('/')[2];
console.log('[harness] extension id:', EXT_ID);

let swSession = null;
{
  const sw = targets1.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
  if (sw) {
    const { sessionId } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId).catch(() => {});
    swSession = sessionId;
    console.log('[harness] SW attached (optional, for console capture)');
  }
}

// ---- open page + panel ----------------------------------------------------
const panelT = await send('Target.createTarget', { url: `chrome-extension://${EXT_ID}/src/sidepanel/index.html` });
const { sessionId: panelSession } = await send('Target.attachToTarget', { targetId: panelT.targetId, flatten: true });
await send('Runtime.enable', {}, panelSession);
await PAUSE(1200);
console.log('[harness] panel attached');

const site = await send('Target.createTarget', { url: SITE });
await PAUSE(2500);
const { sessionId: siteSession } = await send('Target.attachToTarget', { targetId: site.targetId, flatten: true });
await send('Runtime.enable', {}, siteSession);
console.log('[harness] page attached');

// ---- helpers --------------------------------------------------------------
async function realMouseMove(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); }
async function realClick(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function interactionSnapshot(label) {
  const probe = await evalOn(panelSession, `(async () => {
    const S = await chrome.storage.local.get('cmdrunner_live_interactions');
    const live = S['cmdrunner_live_interactions'];
    return JSON.stringify((live || []).map((i) => ({
      id: i.id, type: i.interactionType, label: i.label,
      verdict: i.metadata?.hoverQualification?.verdict ?? null,
      reason: i.metadata?.hoverQualification?.evidenceReason ?? null,
      ecl: i.metadata?.hoverQualification?.evidenceClass ?? null,
      disclosures: i.metadata?.evidenceDisclosures
        ? Object.entries(i.metadata.evidenceDisclosures).filter(([k, v]) => v && (Array.isArray(v) ? v.length : true)).map(([k]) => k) : [],
      anchor: i.anchor ? { tag: i.anchor.tagName, id: i.anchor.id ?? null, text: (i.anchor.textContent || '').slice(0, 20) } : null,
      claimed: i.claimedLedgerEventIds?.length ?? 0,
    })));
  })()`);
  const parsed = JSON.parse(probe);
  console.log('\n=== ' + label + ' ===');
  for (const i of parsed) {
    console.log(` ${String(i.type).padEnd(14)} ${String(i.label || '').slice(0, 28).padEnd(28)} v=${i.verdict ?? '-'} c=${i.ecl ?? '-'} claimed=${i.claimed} disc=[${i.disclosures.join(',')}]`);
    if (i.reason) console.log(`      why: ${String(i.reason).slice(0, 110)}`);
  }
  return parsed;
}

async function startRecording() {
  const r = await evalOn(panelSession, `(async () => {
    const r = await new Promise((res) => chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (x) => res(x)));
    await new Promise((w) => setTimeout(w, 300));
    return JSON.stringify(r ?? null);
  })()`);
  console.log('[harness] START ->', String(r).slice(0, 100));
  await PAUSE(1500);
}
async function stopRecording() {
  const r = await evalOn(panelSession, `(async () => {
    const r = await new Promise((res) => chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (x) => res(x)));
    await new Promise((w) => setTimeout(w, 300));
    return JSON.stringify(r ?? null);
  })()`);
  console.log('[harness] STOP  ->', String(r).slice(0, 100));
  await PAUSE(7000);
}
async function clearLive() {
  await evalOn(panelSession, `(async () => { await chrome.storage.local.remove('cmdrunner_live_interactions'); })()`).catch(() => {});
}

// ---- geometry -------------------------------------------------------------
const geo = JSON.parse(await evalOn(siteSession, `(() => {
  const g = (id) => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; };
  return JSON.stringify({ services: g('services'), servicesIcon: g('services-icon'), bookflight: g('bookflight'), hovercardBtn: g('hovercard-btn'), hovercardPanel: g('hovercard-panel'), pureWrap: g('pure-wrap'), dpTrigger: g('dp-trigger'), iconBtn: g('icon-btn'), plain: g('plain'), navlink: g('navlink'), invis: g('invis'), churn: g('churn-area') });
})()`));
console.log('[harness] geometry ok:', Object.keys(geo).join(','));

// ═══ PHASE 1: R2b Services → Book Flight ═════════════════════════════════
console.log('\n[harness] ===== R2b: hover Services → click Book Flight =====');
await clearLive();
await startRecording();
await realMouseMove(geo.services.x, geo.services.y);
await PAUSE(900);
const menuOpen = await evalOn(siteSession, `document.getElementById('menu').classList.contains('open')`);
console.log('[harness] menu opened by hover:', menuOpen);
await realClick(geo.bookflight.x, geo.bookflight.y);
await PAUSE(1500);
const snap1 = await interactionSnapshot('R2b result');
const hoverRows = snap1.filter((i) => i.type === 'Hover');
const clickRows = snap1.filter((i) => i.type === 'Click');
console.log('\n[verdict R2b] Hover rows:', hoverRows.length, '| Click rows:', clickRows.length,
  '| click absorbed hover?', clickRows.some((c) => c.claimed > 1 && hoverRows.length === 0));
await stopRecording();
const snap1b = await interactionSnapshot('R2b after STOP');
const hv = snap1b.filter((i) => i.type === 'Hover');
const cv = snap1b.filter((i) => i.type === 'Click');
console.log('\n[verdict R2b STOP] Hover:', hv.length, 'Click:', cv.length,
  '| bookflight click survived STOP?', cv.some((c) => /book flight/i.test(c.label || '')));

// ═══ PHASE 2: R1 icon click, R2 hover+click same element, R6 icon-only ══
console.log('\n[harness] ===== R1/R2/R6: icon + same-element click =====');
await clearLive();
await startRecording();
// R1: physical click on the ICON (svg) inside Services
await realMouseMove(geo.servicesIcon.x, geo.servicesIcon.y);
await PAUSE(400);
await realClick(geo.servicesIcon.x, geo.servicesIcon.y);
await PAUSE(900);
// R6: icon-only button
await realMouseMove(geo.iconBtn.x, geo.iconBtn.y);
await PAUSE(400);
await realClick(geo.iconBtn.x, geo.iconBtn.y);
await PAUSE(900);
const snap2 = await interactionSnapshot('R1/R6 result');
await stopRecording();
const snap2b = await interactionSnapshot('R1/R6 after STOP');

// ═══ PHASE 3: R3 reveal, R3b baseline, R5 pure CSS, R7 DatePicker ═══════
console.log('\n[harness] ===== R3/R3b/R5/R7: reveals + pure CSS + DatePicker =====');
await clearLive();
await startRecording();
// R3: genuine reveal-on-hover
await realMouseMove(geo.hovercardBtn.x, geo.hovercardBtn.y);
await PAUSE(1000);
// R5: pure CSS hover reveal
await realMouseMove(geo.pureWrap.x, geo.pureWrap.y);
await PAUSE(1000);
// R7: DatePicker trigger click (aria-expanded flip + gridcell children)
await realClick(geo.dpTrigger.x, geo.dpTrigger.y);
await PAUSE(900);
const snap3 = await interactionSnapshot('R3/R5/R7 result');
await stopRecording();
const snap3b = await interactionSnapshot('R3/R5/R7 after STOP');

// ═══ PHASE 4: R4 churn, R8 plain div, R9 nav link, R10 CQ-invalid ═══════
console.log('\n[harness] ===== R4/R8/R9/R10 =====');
await clearLive();
await startRecording();
// R4: hover services while unrelated churn mutates elsewhere
await realMouseMove(geo.services.x, geo.services.y);
await PAUSE(300);
await evalOn(siteSession, `(() => {
  const area = document.getElementById('churn-area');
  let n = 0; const t = setInterval(() => { if (n++ > 8) return clearInterval(t);
    const s = document.createElement('span'); s.textContent = 'tick ' + n; area.appendChild(s); }, 120);
})()`);
await PAUSE(1600);
// move away to close the hover window WITHOUT clicking (churn-only hover)
await realMouseMove(geo.plain.x, geo.plain.y);
await PAUSE(600);
// R8: plain div click
await realClick(geo.plain.x, geo.plain.y);
await PAUSE(600);
// R9: nav link click
await realClick(geo.navlink.x, geo.navlink.y);
await PAUSE(600);
// R10: CQ-invalid invisible click
await realClick(geo.invis.x, geo.invis.y);
await PAUSE(600);
const snap4 = await interactionSnapshot('R4/R8/R9/R10 result');
await stopRecording();
const snap4b = await interactionSnapshot('R4/R8/R9/R10 after STOP');

console.log('\n--- SW console errors (if any) ---');
console.log(swConsole.filter((l) => l.includes('error') || l.includes('Error')).slice(0, 15).join('\n') || '(none)');
console.log('\n[harness] done');
process.exit(0);
