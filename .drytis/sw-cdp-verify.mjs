// CDP runtime verification: real Chrome + built extension (dist/).
// Attaches to the MV3 service worker via the browser endpoint with
// Target.setAutoAttach (works even when the SW idles out of /json),
// drives START/STOP via the sidepanel page, captures SW console, probes
// chrome.storage.local.
//
// Usage: CDP_PORT=9336 node sw-cdp-verify.mjs
import WebSocket from 'ws';

const PORT = process.env.CDP_PORT || '9333';
const HTTP = `http://127.0.0.1:${PORT}`;

const list = await (await fetch(`${HTTP}/json/version`)).json();
const bWsUrl = list.webSocketDebuggerUrl;
if (!bWsUrl) throw new Error('no browser websocket — start Chrome with --remote-debugging-port');

const ws = new WebSocket(bWsUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

let seq = 0;
const pending = new Map();
const handlers = new Map(); // sessionId -> { console: [], exception: [] }
const log = [];

ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message + ' ' + JSON.stringify(m.error.data ?? ''))) : resolve(m.result);
  } else if (m.method) {
    if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
      const h = handlers.get(m.sessionId);
      if (h) {
        if (m.method === 'Runtime.consoleAPICalled') {
          h.console.push(`[${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
        } else {
          const d = m.params.exceptionDetails;
          h.console.push(`[EXCEPTION] ${d.text} ${d.exception?.description ?? ''}`);
        }
      }
    } else if (m.method === 'Target.attachedToTarget' && m.params.targetInfo.type === 'service_worker') {
      console.log('[harness] attached to SW:', m.params.targetInfo.url);
    }
  }
});

function send(method, params = {}, sessionId) {
  const id = ++seq;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(payload));
  });
}

// Auto-attach to every target incl. service workers, flattened sessions.
await send('Target.setAutoAttach', {
  autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: 'service_worker' }, { type: 'page' }],
});

// Find the extension SW. Refresh each iteration — it may wake late.
let swSession = null, extOrigin = null, targetInfos = [];
let swAttachedURL = null;
for (let i = 0; i < 24 && !swSession; i++) {
  ({ targetInfos } = await send('Target.getTargets'));
  console.log('[harness] pass', i, 'targets:', targetInfos.map((t) => t.type).join(','));
    const COMPONENT_IDS = ['nkeimhogjdpnpccoofpliimaahmaaome','fignfifoniblkonapihmkfakmlgkbkcf','mhjfbmdgcfjbbpaeojofohoefgiehjai','admccjkmockfdflocgggjfgdacdodkdf','ghbmnnjooekpmoecnnnilnnbdlolhkhi','nmmhkkegccagdldgiimedpiccmgmieda'];
for (const t of targetInfos) {
    if (t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && !COMPONENT_IDS.some((id) => t.url.includes(id)) && t.url.includes('service-worker-loader')) {
      const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      handlers.set(sessionId, { console: [] });
      await send('Runtime.enable', {}, sessionId);
      swSession = sessionId;
      extOrigin = t.url.replace(/^(chrome-extension:\/\/[^/]+).*/, '$1'); // URL.origin is 'null' for chrome-extension scheme in Node
      swAttachedURL = t.url;
      console.log('[harness] SW attached:', t.url, '| extOrigin now:', extOrigin);
      break;
    }
  }
  if (!swSession) await new Promise((r) => setTimeout(r, 500));
}
if (!swSession) throw new Error('extension service worker not found');

// Open the sidepanel page as a tab (PUT /json/new), then attach to it.
console.log('[harness] extOrigin:', extOrigin);
// Attach to the sidepanel page directly: create it as a target and attach via CDP.
const created = await send('Target.createTarget', { url: extOrigin + '/src/sidepanel/index.html' });
console.log('[harness] sidepanel target created:', created.targetId);
await new Promise((r) => setTimeout(r, 3000));
// ATTACH DIRECTLY to the created target — no /json lookup needed.
const { sessionId: pageSession0 } = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
const pageSession = pageSession0;
handlers.set(pageSession, { console: [] });
await send('Runtime.enable', {}, pageSession);
await send('Page.enable', {}, pageSession);
const pgUrl = (await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, pageSession)).result.value;
console.log('[harness] sidepanel attached, url =', pgUrl);
if (!pgUrl || !pgUrl.startsWith('chrome-extension://')) throw new Error('sidepanel page not on extension origin: ' + pgUrl);

async function evalOn(session, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
}

// --- open a real web page so recording has a genuine tab & content script ---
const site = await send('Target.createTarget', { url: 'http://example.com/' });
await new Promise((r) => setTimeout(r, 4000));
const sites = (await send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && t.url.startsWith('http://example.com'));
if (sites) {
  const { sessionId: siteSession } = await send('Target.attachToTarget', { targetId: sites.targetId, flatten: true });
  await send('Runtime.enable', {}, siteSession);
  const clicked = await send('Runtime.evaluate', { expression: "document.querySelector('a').click(); 'clicked'", returnByValue: true }, siteSession);
  console.log('[harness] real click on example.com:', clicked.result.value);
  await new Promise((r) => setTimeout(r, 1500));
} else {
  console.log('[harness] WARN: example.com tab not found');
}

// --- drive the real flow ----------------------------------------------------
const start = await evalOn(pageSession, `chrome.runtime.sendMessage({type:'START_RECORDING'})`);
console.log('[harness] START_RECORDING ->', JSON.stringify(start));
await new Promise((r) => setTimeout(r, 2500));
// interact AFTER start so interactions are captured
const sites2 = (await send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page' && (t.url.startsWith('http://example.com') || t.url.startsWith('https://example.com')));
for (const s of sites2) {
  const { sessionId: ss } = await send('Target.attachToTarget', { targetId: s.targetId, flatten: true });
  await send('Runtime.enable', {}, ss);
  const r = await send('Runtime.evaluate', { expression: "document.querySelector('a').click(); 'clicked-again'", returnByValue: true }, ss);
  console.log('[harness] post-start click:', r.result.value);
}
await new Promise((r) => setTimeout(r, 2500));

const stop = await evalOn(pageSession, `chrome.runtime.sendMessage({type:'STOP_RECORDING'})`);
console.log('[harness] STOP_RECORDING ->', JSON.stringify(stop));
await new Promise((r) => setTimeout(r, 9000)); // M9 + IR + persistence settle

const probe = await evalOn(pageSession, `(async () => {
  const S = await chrome.storage.local.get(null);
  const ur = S['understanding_result'];
  const live = S['cmdrunner_live_interactions'];
  // full M9 digest for the report
  const digest = ur ? {
    outcomes: (ur.outcomes || []).map((o) => ({ actionId: o.actionId, outcome: o.outcome, confidence: o.confidence, evidence: (o.evidence || []).map((e) => e.detail || e.kind).slice(0, 3) })),
    transitions: (ur.transitions || []).map((t) => ({ actionId: t.actionId, to: t.to, changes: (t.changes || []).map((c) => c.entityType + ':' + (c.attribute || '') + '=' + JSON.stringify(c.newValue).slice(0, 40)) })),
    entities: ur.entities || ur.state?.entities || null,
    intents: ur.semanticKnowledge?.intents || ur.intents || null,
    sessionCount: (live || []).length,
  } : null;
  const inter = (live || []).map((i) => ({ id: i.id, type: i.interactionType, label: i.label, net: (i.networkActivity || i.evidence?.network || []).length }));
  const keys = Object.keys(S);
  return JSON.stringify({
    allStorageKeys: keys,
    understandingPresent: !!ur,
    understandingKeys: ur ? Object.keys(ur) : null,
    domain: ur?.semanticKnowledge?.domain ?? null,
    warnings: ur?.knowledgeWarnings ?? null,
    liveInteractionCount: Array.isArray(live) ? live.length : (live?.interactions?.length ?? null),
    interactions: inter,
    digest,
  }, null, 1);
})()`);
console.log('[harness] PROBE:', probe);

const swConsole = handlers.get(swSession).console;
console.log('--- SW console (' + swConsole.length + ' lines) ---');
console.log(swConsole.join('\n').slice(0, 6000));
process.exit(0);
