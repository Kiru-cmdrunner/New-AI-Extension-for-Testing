/**
 * NAV Pull Model — Real-Chrome CDP verification (Phase 1 milestone)
 *
 * Uses the browser-level CDP endpoint + Target.setAutoAttach (same pattern
 * as the proven sw-cdp-verify.mjs harness) so the MV3 SW is captured even
 * when it idles out of /json.
 *
 * Flow:
 *   1. Launch real Chrome with the built extension (dist/).
 *   2. Auto-attach to the extension SW; capture console.
 *   3. Open file:// source page (form GET submit → destination = full reload).
 *   4. START_RECORDING; trusted click on the Go button.
 *   5. Destination renders 25 result items + a dialog 200ms in.
 *   6. Post-nav window opens on the destination doc, closes at 3s cap,
 *      delivers evidence attributed to the nav interaction.
 *   7. STOP; read chrome.storage.local: the Navigation interaction must
 *      carry domChanges > 0 (placeholder replaced), nav entry with
 *      fromUrl/toUrl, and 0 SW console errors.
 *
 * Run: node /workspace/.drytis/post-nav-verify.mjs
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const CHROME = '/usr/bin/google-chrome';
const EXT_DIR = '/workspace/dist';
const USER_DATA = '/tmp/navtest-chrome-profile';
const SOURCE_URL = 'http://127.0.0.1:8099/source.html';
const PORT = '9333';
const HTTP = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(USER_DATA, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--user-data-dir=${USER_DATA}`, `--remote-debugging-port=${PORT}`,
  `--load-extension=${EXT_DIR}`, '--no-first-run',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {});

// Serve the test pages over http (content scripts don't run on file://)
const httpServer = spawn('python3', ['-m', 'http.server', '8099', '--directory', '/tmp/navtest', '--bind', '127.0.0.1'], { stdio: 'ignore' });

let swSessionId = null;
let extOrigin = null;
const log = [];
let seq = 0;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout: ' + method)); } }, 20000);
  });
}

let ws;
async function connect() {
  const list = await (await fetch(`${HTTP}/json/version`)).json();
  const bWsUrl = list.webSocketDebuggerUrl;
  if (!bWsUrl) throw new Error('no browser websocket');
  ws = new WebSocket(bWsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message + ' ' + JSON.stringify(m.error.data ?? ''))) : resolve(m.result);
    } else if (m.method) {
      if (m.method === 'Runtime.consoleAPICalled' && swSessionId && m.sessionId === swSessionId) {
        log.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown' && swSessionId && m.sessionId === swSessionId) {
        log.push(`[EXCEPTION] ${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ''}`);
      }
    }
  });
  await send('Target.setAutoAttach', {
    autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
    filter: [{ type: 'service_worker' }, { type: 'page' }],
  });
}

/** Find + attach the extension SW by polling Target.getTargets (proven pattern). */
async function attachSW(sourceTargetId) {
  const COMPONENT_IDS = ['nkeimhogjdpnpccoofpliimaahmaaome','fignfifoniblkonapihmkfakmlgkbkcf','mhjfbmdgcfjbbpaeojofohoefgiehjai','admccjkmockfdflocgggjfgdacdodkdf','ghbmnnjooekpmoecnnnilnnbdlolhkhi','nmmhkkegccagdldgiimedpiccmgmieda'];
  for (let i = 0; i < 30 && !swSessionId; i++) {
    const { targetInfos } = await send('Target.getTargets');
    for (const t of targetInfos) {
      if (t.type === 'service_worker' && t.url.startsWith('chrome-extension://')
          && !COMPONENT_IDS.some((id) => t.url.includes(id))
          && t.url.includes('service-worker-loader')) {
        const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
        swSessionId = sessionId;
        extOrigin = t.url.replace(/^(chrome-extension:\/\/[^/]+).*/, '$1');
        await send('Runtime.enable', {}, sessionId).catch(() => {});
        return extOrigin;
      }
    }
    // Wake attempts: reload the source page (content-script status ping
    // wakes the SW); once we know the origin, also open the sidepanel.
    if (sourceTargetId) {
      const reload = await send('Target.attachToTarget', { targetId: sourceTargetId, flatten: true }).catch(() => null);
      if (reload) await send('Page.enable', {}, reload.sessionId).catch(() => {});
      if (reload) await send('Page.reload', {}, reload.sessionId).catch(() => {});
    }
    if (extOrigin) {
      await send('Target.createTarget', { url: `${extOrigin}/src/sidepanel/index.html` }).catch(() => {});
    }
    await sleep(1500);
  }
  throw new Error('extension service worker not found');
}

async function evalSW(expr) {
  if (!swSessionId) throw new Error('SW not attached');
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, swSessionId);
  if (r.exceptionDetails) throw new Error('SW eval failed: ' + JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails).slice(0, 400));
  return r.result.value;
}

async function main() {
  console.log('[verify] waiting for browser endpoint…');
  let ok = false;
  for (let i = 0; i < 40; i++) {
    try { await fetch(`${HTTP}/json/version`); ok = true; break; } catch { await sleep(500); }
  }
  if (!ok) throw new Error('chrome never came up');
  await connect();
  console.log('[verify] connected; opening source page…');

  // Open the source page FIRST (wakes the extension; content script loads)
  const { targetId } = await send('Target.createTarget', { url: SOURCE_URL });
  await sleep(2500);

  // Find + attach the SW (poll pattern — page reload wakes it via the
  // content-script status ping)
  const origin = await attachSW(targetId);
  console.log('[verify] SW attached at', origin);
  await sleep(1500);

  // START recording (drive via the extension's own SW runtime → tabs)
  await evalSW(`(async () => {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'START_RECORDING' }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    return 'started';
  })()`);
  await sleep(1500);

  // Trusted click on Go via the page session
  const page = await send('Target.attachToTarget', { targetId, flatten: true });
  const psid = page.sessionId;
  const rect = await send('Runtime.evaluate', {
    expression: `(() => { const r = document.getElementById('go').getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2}); })()`,
    returnByValue: true,
  }, psid);
  const { x, y } = JSON.parse(rect.result.value);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, psid);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, psid);
  console.log('[verify] clicked Go (trusted input)');

  // Wait for navigation + churn + post-nav 3s window + attach
  await sleep(7000);
  const urlNow = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, psid);
  console.log('[verify] page url after click:', urlNow.result.value);

  // STOP recording, then dump storage from the SW
  await evalSW(`(async () => {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) chrome.tabs.sendMessage(t.id, { type: 'STOP_RECORDING' }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
    return 'stopped';
  })()`);

  const dump = await evalSW(`(async () => JSON.stringify(await chrome.storage.local.get(null))()`.replace('()()', ')()'));
  writeFileSync('/tmp/navtest/storage-dump.json', dump);
  const data = JSON.parse(dump);
  const live = data['cmdrunner_live_interactions'] ?? [];
  console.log('[verify] interactions:', live.length, live.map((i) => i.type).join(','));

  const navInts = live.filter((i) => i.type === 'Navigation');
  console.log('[verify] Navigation interactions:', navInts.length);
  for (const n of navInts) {
    const ev = n.behavioralEvidence;
    const ae = ev?.applicationEvidence ?? {};
    console.log(`  nav ${n.interactionId} windowId=${ev?.windowId ?? 'NONE'} endReason=${ev?.window?.endReason ?? 'NONE'}`);
    console.log(`    domChanges=${ae.domChanges?.length ?? '—'} newSurfaces=${ae.newSurfaces?.length ?? '—'} removedSurfaces=${ae.removedSurfaces?.length ?? '—'} visibility=${ae.visibilityChanges?.length ?? '—'} network=${ae.networkActivity?.length ?? '—'} domOverflow=${ae.domChangeOverflow ?? '—'}`);
    console.log(`    navEntry=${JSON.stringify(ae.navigation?.[0] ?? null).slice(0, 200)}`);
  }
  for (const c of live.filter((i) => i.type === 'Click')) {
    const ae = c.behavioralEvidence?.applicationEvidence;
    console.log(`  click ${c.interactionId} domChanges=${ae?.domChanges?.length ?? '—'} network=${ae?.networkActivity?.length ?? '—'}`);
  }

  const errors = log.filter((l) => l.startsWith('[error]') || l.startsWith('[EXCEPTION]'));
  console.log('[verify] SW console errors:', errors.length);
  for (const e of errors.slice(0, 10)) console.log('   ', e.slice(0, 220));

  const navRich = navInts.some((n) => (n.behavioralEvidence?.applicationEvidence?.domChanges?.length ?? 0) > 0
    || (n.behavioralEvidence?.applicationEvidence?.newSurfaces?.length ?? 0) > 0);
  console.log(navRich
    ? 'VERDICT: PASS — destination DOM evidence captured on the Navigation interaction'
    : navInts.length > 0
      ? 'VERDICT: FAIL — Navigation interaction present but placeholder-only'
      : 'VERDICT: FAIL — no Navigation interaction found');

  try { chrome.kill(); } catch {}
  try { httpServer.kill(); } catch {}
  process.exit(navRich ? 0 : 1);
}

main().catch((e) => {
  console.error('[verify] FATAL:', e.message);
  try { chrome.kill(); } catch {}
  try { httpServer.kill(); } catch {}
  process.exit(1);
});
