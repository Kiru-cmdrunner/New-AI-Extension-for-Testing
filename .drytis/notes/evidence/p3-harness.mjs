// Phase 3 real-Chrome CDP end-to-end validation.
// Complete flow: capture (Phase 1 hooks) → resultingState on evidence →
// D2 merge → coordinator → StateBuilder → transitions/outcomes.
//
// 8 scenarios (spec Phase 3 §3):
//   S1 AJAX add-to-cart + delayed dialog (delayed UI consequence)
//   S2 Vivo-style form-submit full-reload navigation
//   S3 multi-item cart (entityId dedup across siblings)
//   S4 delayed UI consequence (600ms badge, no nav)
//   S5 polling page (background activity, cap-close + scan)
//   S6 slow causal network (1.2s fetch settle)
//   S7 no-consequence action (scan runs, empty semantics → absent)
//   S8 overlapping interactions (two clicks, separate windows)
//
// Technique per .drytis/notes/real-chrome-cdp-validation-technique.md.
// Interactions: chrome.storage.local['cmdrunner_live_interactions'].
// Understanding: chrome.storage.local['understanding_result'].
import CDP from 'chrome-remote-interface';
import http from 'node:http';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/p3-chrome-profile';
const DIST = '/workspace/dist';
const PORT = 9533;
const APP_PORT = 8099;
const REPLICA = `http://127.0.0.1:${APP_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Replica server ─────────────────────────────────────────────────────
const shell = (body) => `<!doctype html><html><head><meta charset="utf-8">
<style>body{font-family:system-ui;margin:2rem}
.cart-badge{background:#08c;color:#fff;border-radius:10px;padding:2px 8px}
#status{margin-top:8px;min-height:1em}
ul[data-testid="cart-items"]{border:1px solid #ccc;padding:8px;max-width:300px}
ul[data-testid="cart-items"] li{border-bottom:1px solid #eee;padding:4px}
[role="status"],[role="alert"]{background:#e8f0fe;padding:6px;border-radius:4px;margin-top:6px}
button{cursor:pointer}</style></head><body>${body}</body></html>`;

const S1 = shell(`<h1>S1 AJAX Add-to-cart</h1>
<p>Cart: <span id="cart-count" data-count="0" aria-label="Cart count">0</span></p>
<button id="add1">Add to cart</button>
<div id="dialog" role="alert" hidden style="margin-top:8px;padding:8px;background:#e8f0fe;border-radius:6px"></div>
<script>
let cart = 0;
document.getElementById('add1').addEventListener('click', () => {
  fetch('/api/cart', { method: 'POST' }).then(r => r.json()).then(() => {
    cart++;
    document.getElementById('cart-count').textContent = String(cart);
    document.getElementById('cart-count').setAttribute('data-count', String(cart));
    // Delayed UI consequence — 500ms after the fetch settles.
    setTimeout(() => {
      const d = document.getElementById('dialog');
      d.textContent = 'Item added to cart';
      d.hidden = false;
    }, 500);
  });
});
</script>`);

const S2 = shell(`<h1>S2 Vivo Form Submit</h1>
<form method="GET" action="/s2-target">
  <label>Name <input name="name" value="Kiru"></label>
  <button type="submit" id="submit-btn">Submit</button>
</form>`);

const S2T = shell(`<h1>S2 Confirmation</h1>
<div data-testid="order-confirmation">Order 12345 confirmed</div>
<span data-order-id="12345">Order 12345</span>
<p>[data-count]: <span data-count="1" aria-label="Orders">1</span></p>`);

const S3 = shell(`<h1>S3 Multi-item Cart</h1>
<p>Cart: <span id="cart-count" data-count="3" aria-label="Cart count">3</span></p>
<ul data-testid="cart-items">
  <li data-asin="B0VAL1">Widget A</li>
  <li data-asin="B0VAL2">Widget B</li>
  <li data-asin="B0VAL3">Widget C</li>
</ul>
<button id="add-widget-d">Add Widget D</button>
<script>
document.getElementById('add-widget-d').addEventListener('click', () => {
  const ul = document.querySelector('ul[data-testid="cart-items"]');
  const li = document.createElement('li');
  li.setAttribute('data-asin', 'B0VAL4');
  li.textContent = 'Widget D';
  ul.appendChild(li);
  const c = document.getElementById('cart-count');
  const n = parseInt(c.textContent, 10) + 1;
  c.textContent = String(n);
  c.setAttribute('data-count', String(n));
});
</script>`);

const S4 = shell(`<h1>S4 Delayed Consequence</h1>
<button id="save">Save</button>
<div id="badge" data-testid="status-badge" hidden>✓ Saved</div>
<script>
document.getElementById('save').addEventListener('click', () => {
  setTimeout(() => {
    const b = document.getElementById('badge');
    b.textContent = '✓ Saved';
    b.hidden = false;
  }, 600);
});
</script>`);

const S5 = shell(`<h1>S5 Polling</h1>
<p>Status: <span id="status" role="status">idle</span></p>
<button id="act">Do thing</button>
<script>
// Background polling every 300ms — network + DOM churn without user action.
let n = 0;
setInterval(() => {
  n++;
  fetch('/api/poll?t=' + n).then(r => r.text()).then(() => {
    document.getElementById('status').textContent = 'poll ' + n;
  });
}, 300);
document.getElementById('act').addEventListener('click', () => {
  document.getElementById('status').textContent = 'acted';
});
</script>`);

const S6 = shell(`<h1>S6 Slow Causal Network</h1>
<p>Result: <span id="result" role="status">waiting…</span></p>
<button id="go">Go</button>
<script>
document.getElementById('go').addEventListener('click', () => {
  fetch('/api/slow').then(r => r.json()).then((d) => {
    document.getElementById('result').textContent = 'done ' + d.ok;
  });
});
</script>`);

const S7 = shell(`<h1>S7 No Consequence</h1>
<p>Nothing here matches any semantic selector, and clicking does nothing.</p>
<button id="inert">Inert button</button>
<script>
document.getElementById('inert').addEventListener('click', () => {
  // Intentionally no DOM mutation, no network, nothing.
});
</script>`);

const S8 = shell(`<h1>S8 Overlapping Interactions</h1>
<p>A: <span id="ca" data-count="0" aria-label="A count">0</span>
   B: <span id="cb" data-count="0" aria-label="B count">0</span></p>
<button id="btn-a">Button A</button>
<button id="btn-b">Button B</button>
<div id="out-a" role="status" hidden></div>
<div id="out-b" role="status" hidden></div>
<script>
const bump = (which) => {
  const c = document.getElementById(which === 'a' ? 'ca' : 'cb');
  const n = parseInt(c.textContent, 10) + 1;
  c.textContent = String(n);
  c.setAttribute('data-count', String(n));
  const o = document.getElementById(which === 'a' ? 'out-a' : 'out-b');
  o.textContent = which === 'a' ? 'A done' : 'B done';
  o.hidden = false;
};
document.getElementById('btn-a').addEventListener('click', () => {
  fetch('/api/a').then(() => bump('a'));
});
document.getElementById('btn-b').addEventListener('click', () => {
  fetch('/api/b').then(() => bump('b'));
});
</script>`);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, REPLICA);
  res.setHeader('content-type', 'text/html; charset=utf-8');
  const route = url.pathname;
  if (route === '/' || route === '/s1') { res.end(S1); return; }
  if (route === '/s2') { res.end(S2); return; }
  if (route === '/s2-target') { res.end(S2T); return; }
  if (route === '/s3') { res.end(S3); return; }
  if (route === '/s4') { res.end(S4); return; }
  if (route === '/s5') { res.end(S5); return; }
  if (route === '/s6') { res.end(S6); return; }
  if (route === '/s7') { res.end(S7); return; }
  if (route === '/s8') { res.end(S8); return; }
  if (route === '/api/cart') {
    setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }, 150);
    return;
  }
  if (route === '/api/slow') {
    setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }, 1200);
    return;
  }
  if (route.startsWith('/api/poll') || route === '/api/a' || route === '/api/b') {
    res.setHeader('content-type', 'text/plain'); res.end('ok'); return;
  }
  res.statusCode = 404; res.end('nf');
});

// ── CDP helpers (per the technique note) ────────────────────────────────
let chromeProc = null;
async function launchChrome() {
  const { spawn } = await import('node:child_process');
  chromeProc = spawn(CHROME_BIN, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--load-extension=${DIST}`,
    `--disable-extensions-except=${DIST}`,
    '--headless=new', '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check',
  ], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) return;
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error('Chrome CDP not reachable');
}

async function getTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

async function evalIn(client, expr) {
  const r = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  return r?.result?.value;
}

// ── Main flow ──────────────────────────────────────────────────────────
async function main() {
  await launchChrome();
  console.log('[harness] chrome up');
  await new Promise((r) => server.listen(APP_PORT, '127.0.0.1', r));
  console.log('[harness] replica on', APP_PORT);
  await sleep(1000);

  // Browser-level connection to wake the SW and create tabs (d9 recipe).
  const browser = await CDP({ port: PORT });
  await browser.send('Target.setDiscoverTargets', { discover: true, flatten: true }).catch(() => {});
  const KNOWN_ID = 'gndjidfncanlhlonpcabokbdhnikglpn'; // stable for this dist
  let sw = null;
  for (let i = 0; i < 30 && !sw; i++) {
    const { targetInfos } = await browser.send('Target.getTargets');
    sw = targetInfos.find((t) => t.url.includes('service-worker-loader.js'));
    if (!sw) {
      if (i === 3) await browser.send('Target.createTarget', { url: `chrome-extension://${KNOWN_ID}/src/sidepanel/index.html` }).catch(() => {});
      await sleep(1000);
    }
  }
  if (!sw) throw new Error('extension service worker not found after 30s');
  const extId = sw.url.split('/')[2];
  console.log('[harness] extId =', extId);

  // Tab 1: app (recording target). Tab 2: panel (runtime message sender).
  const { targetId: appTab } = await browser.send('Target.createTarget', { url: 'about:blank' });
  await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
  await sleep(1200);

  // Panel = the extension page we just opened (dedicated ws).
  let panelWs = null;
  for (let i = 0; i < 20 && !panelWs; i++) {
    const targets = await getTargets();
    const panel = targets.find(
      (t) => t.url.includes('chrome-extension://') && t.url.includes('sidepanel/index.html'),
    );
    if (panel) panelWs = panel.webSocketDebuggerUrl;
    else await sleep(400);
  }
  if (!panelWs) throw new Error('panel page target not found');

  const panel = await CDP({ target: panelWs, port: PORT });
  await panel.send('Runtime.enable');

  const app = await CDP({ target: appTab, port: PORT });
  await app.send('Runtime.enable');
  await app.send('Page.enable');
  try { await browser.send('Target.setDiscoverTargets', { discover: false, flatten: false }).catch(() => {}); } catch {}
  // NOTE: browser connection stays OPEN — focusAppTab needs it for
  // Target.activateTarget throughout the run.

  const evalPanel = (expr) => evalIn(panel, expr);
  const evalApp = (expr) => evalIn(app, expr);

  // Focus + navigate the app tab. Focus via browser-level
  // Target.activateTarget — chrome.tabs.update from the panel page does NOT
  // stick in headless=new, and the SW's sendFinalizeEvidence targets
  // tabs.query({active:true,currentWindow:true})[0]. If that query resolves
  // to the panel tab, FINALIZE_EVIDENCE is silently consumed there and the
  // recorder window never enters settle mode (endReason stays 'stabilized').
  const focusAppTab = async () => {
    try {
      await browser.send('Target.activateTarget', { targetId: appTab });
    } catch (e) { console.log('  (activateTarget err:', e.message, ')'); }
    await sleep(250);
  };

  const nav = async (url) => {
    // Direct CDP navigation on the app session (panel tabs.update is
    // unreliable in headless across scenario boundaries).
    await app.send('Page.navigate', { url });
    await sleep(900);
    const href = await evalApp('location.href');
    // Focus the app tab (recorder needs the ACTIVE tab = app at START/STOP).
    await evalPanel(`(async () => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => !x.url.startsWith('chrome-extension://'));
      if (t) await chrome.tabs.update(t.id, { active: true });
      return true;
    })()`);
    await sleep(200);
    // Re-activate the app tab (panel-target creation can steal focus).
    try { await browser.send('Target.activateTarget', { targetId: appTab }); } catch {}
    await sleep(150);
    return String(href).includes(String(new URL(url).pathname));
  };

  const sendCmd = async (type) => {
    await focusAppTab();
    await sleep(500);
    const r = await evalPanel(`(async () => {
      try {
        const resp = await chrome.runtime.sendMessage({ type: ${JSON.stringify(type)} });
        return { ok: true, resp };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()`);
    await sleep(300);
    return r;
  };

  const readStorage = async (key) =>
    evalPanel(`(async () => (await chrome.storage.local.get('${key}'))['${key}'] ?? null)()`);

  const results = [];
  // Ground truth from the SW's own context: what does
  // chrome.tabs.query({active:true,currentWindow:true}) resolve to there?
  // sendFinalizeEvidence targets tabs[0] of exactly this query.
  let swDump = null;
  try {
    const targets = await getTargets();
    const swt = targets.find((t) => t.url.includes('service-worker-loader.js') || t.type === 'service_worker');
    if (swt && swt.webSocketDebuggerUrl) {
      const swc = await CDP({ target: swt.webSocketDebuggerUrl, port: PORT });
      const r = await swc.send('Runtime.evaluate', {
        expression: `(async () => {
          const t = await chrome.tabs.query({ active: true, currentWindow: true });
          const all = await chrome.tabs.query({});
          return { active0: t[0] ? { id: t[0].id, url: (t[0].url || '').slice(0, 50) } : null,
                   all: all.map(x => ({ id: x.id, active: x.active, url: (x.url || '').slice(0, 40) })) };
        })()`,
        awaitPromise: true, returnByValue: true,
      });
      swDump = r.result.value;
      await swc.close();
    }
  } catch (e) { swDump = 'ERR ' + e.message; }
  console.log('  [swtabs]', JSON.stringify(swDump));
  // Per-interaction diagnostic — which close path delivered each window.
  const dumpInteractions = async (tag) => {
    const inter = await readStorage('cmdrunner_live_interactions');
    for (const i of inter ?? []) {
      const be = i.behavioralEvidence ?? {};
      console.log(`  [diag ${tag}] ${i.interactionType || i.type} endReason=${be.window?.endReason} rs=${be.applicationEvidence?.resultingState ? 'Y(' + be.applicationEvidence.resultingState.items?.length + ')' : 'N'} surfaces=${(be.applicationEvidence?.newSurfaces || []).length} dom=${(be.applicationEvidence?.domChanges || []).length} net=${(be.applicationEvidence?.networkActivity || []).length} winKeys=${Object.keys(be.window || {}).join('|')}`);
    }
  };
  const record = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  };

  async function runScenario(id, path, actions, settleMs = 3500, postMs = 2500) {
    console.log(`\n[scenario ${id}] ${path}`);
    // Fix C (3.3b): clear the previous scenario's understanding result so
    // assertions can't read a stale pipeline write.
    await evalPanel(`chrome.storage.local.remove(['understanding_result'])`);
    await nav(REPLICA + path);
    const started = await sendCmd('START_RECORDING');
    if (!started?.ok) console.log('  (start resp:', JSON.stringify(started).slice(0, 120), ')');
    await sleep(800);
    await actions();
    await sleep(settleMs);
    await sendCmd('STOP_RECORDING');
    await sleep(1500);
    await dumpInteractions(id);
    await sleep(1000);
    await sleep(postMs); // understanding pipeline + persistence
    const interactions = await readStorage('cmdrunner_live_interactions');
    const understanding = await readStorage('understanding_result');
    return { interactions, understanding };
  }

  // Real trusted input events (synthetic .click() is isTrusted:false and
  // deliberately ignored by the recorder — d9-harness lesson).
  const clickEv = async (sel) => {
    const box = await evalApp(`(() => { const e = document.getElementById('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
    if (!box) throw new Error('selector not found: ' + sel + ' @ ' + (await evalApp('location.href')));
    const [x, y] = box;
    await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(1100);
  };

  // S1 — AJAX add-to-cart + delayed dialog
  {
    const { interactions, understanding } = await runScenario('S1', '/s1', async () => {
      await clickEv('add1');
      await sleep(2500); // fetch 150ms + dialog at +500ms
    });
    const clicks = (interactions ?? []).filter((i) => /^click$/i.test(String(i.type)));
    const rs = clicks[0]?.behavioralEvidence?.applicationEvidence?.resultingState ?? null;
    const counters = rs?.items?.filter?.((x) => x.kind === 'counter') ?? [];
    const notifs = rs?.items?.filter?.((x) => x.kind === 'notification') ?? [];
    record('S1: click interaction exists', clicks.length >= 1, 'clicks=' + clicks.length);
    record('S1: resultingState present on click evidence', !!rs, rs ? 'items=' + rs.items.length : 'ABSENT');
    record('S1: counter value = 1', counters.some((c) => c.numericValue === 1), JSON.stringify(counters.map((c) => c.numericValue)));
    record('S1: delayed dialog notification captured', notifs.some((n) => (n.text || '').includes('added')), JSON.stringify(notifs.map((n) => n.text)));
    const trans = understanding?.transitions ?? [];
    // Fix C: serialized applicationKnowledge.counters is an ARRAY of
    // {counterId, currentValue, historyLength}; the counter lands there as
    // an absolute value (the transition string comes from the in-window
    // counterChanges via the counterPaths skip-guard — by design).
    const akCounters = understanding?.applicationKnowledge?.counters ?? [];
    const counterOk = (Array.isArray(akCounters) ? akCounters : Object.values(akCounters)).some(
      (c) => String(c.currentValue) === '1' || (Array.isArray(c.values) && c.values.some((v) => v.value === 1)),
    );
    record('S1: D2→AK: counter lands in applicationKnowledge', counterOk, 'counters=' + JSON.stringify(akCounters.map((c) => c.counterId + '=' + c.currentValue)) + ' trans=' + trans.length);
  }

  // S2 — Vivo form-submit full reload
  {
    console.log('\n[scenario S2] /s2');
    await evalPanel(`chrome.storage.local.remove(['understanding_result'])`);
    await nav(REPLICA + '/s2');
    await sendCmd('START_RECORDING');
    await sleep(800);
    await clickEv('submit-btn');
    await sleep(4000); // form GET → /s2-target full reload + post-nav window
    await sendCmd('STOP_RECORDING');
    await sleep(1500);
    await dumpInteractions('S2');
    await sleep(1000);
    const interactions = await readStorage('cmdrunner_live_interactions');
    const understanding = await readStorage('understanding_result');
    const clicks = (interactions ?? []).filter((i) => /^click$/i.test(String(i.type)));
    const navs = (interactions ?? []).filter((i) => /nav/i.test(String(i.type)));
    // Robust row pick: the post-nav window's windowId is `ev-<navEventId>` —
    // NOT `synthetic-nav-...`. The synthetic placeholder and the real
    // post-nav evidence may land in either arrival order; pick the row
    // whose windowId is NOT synthetic.
    const navRow = navs.find((n) => !/^synthetic-nav-/.test(String(n.behavioralEvidence?.windowId ?? ''))) ?? navs[0];
    const navRs = navRow?.behavioralEvidence?.applicationEvidence?.resultingState ?? null;
    const clickRs = clicks[0]?.behavioralEvidence?.applicationEvidence?.resultingState ?? null;
    record('S2: click evidence has NO resultingState (unloaded)', clickRs == null, clickRs ? 'PRESENT items=' + clickRs.items.length : 'absent');
    record('S2: navigation evidence carries destination state', !!navRs, navRs ? 'items=' + navRs.items.length : 'ABSENT — navInts=' + navs.length);
    const orderEntity = navRs?.items?.some?.((x) => x.kind === 'entity' && x.entityId === '12345') ?? false;
    record('S2: destination entity order:12345 observed', orderEntity, '');
    const trans = understanding?.transitions ?? [];
    // Fix C: serialized applicationKnowledge.entities is an ARRAY of
    // {entityId, type, source, attributes} — check the destination order
    // entity landed there (source 'content-observed').
    const akEntities = understanding?.applicationKnowledge?.entities ?? [];
    const orderOk = (Array.isArray(akEntities) ? akEntities : Object.values(akEntities)).some(
      (e) => String(e.entityId ?? '').includes('12345') || JSON.stringify(e).includes('12345'),
    );
    record('S2: D2→AK destination entity in applicationKnowledge', orderOk, 'entities=' + JSON.stringify((Array.isArray(akEntities) ? akEntities : Object.values(akEntities)).map((e) => e.entityId)) + ' trans=' + trans.length);
  }

  // S3 — multi-item cart
  {
    const { interactions } = await runScenario('S3', '/s3', async () => {
      await clickEv('add-widget-d');
      await sleep(2500);
    });
    const clicks = (interactions ?? []).filter((i) => /^click$/i.test(String(i.type)));
    const rs = clicks[0]?.behavioralEvidence?.applicationEvidence?.resultingState ?? null;
    const ents = rs?.items?.filter?.((x) => x.kind === 'entity') ?? [];
    record('S3: 4 sibling entities each captured (entityId dedup)', ents.length === 4, JSON.stringify(ents.map((e) => e.entityId)));
    record('S3: counter = 4', (rs?.items ?? []).some((x) => x.kind === 'counter' && x.numericValue === 4), '');
    record('S3: collection count = 4', (rs?.items ?? []).some((x) => x.kind === 'collection' && x.numericValue === 4), '');
  }

  // S4 — delayed consequence
  {
    const { interactions } = await runScenario('S4', '/s4', async () => {
      await clickEv('save');
      await sleep(3000); // badge at +600ms
    });
    const clicks = (interactions ?? []).filter((i) => /^click$/i.test(String(i.type)));
    const rs = clicks[0]?.behavioralEvidence?.applicationEvidence?.resultingState ?? null;
    const badges = rs?.items?.filter?.((x) => x.kind === 'status-badge') ?? [];
    record('S4: delayed badge captured', badges.some((b) => (b.text || '').includes('Saved')), JSON.stringify(badges.map((b) => b.text)));
  }

  // S5 — polling
  {
    const { interactions } = await runScenario('S5', '/s5', async () => {
      await clickEv('act');
      await sleep(2500); // polling continues during window
    });
    const clicks = (interactions ?? []).filter((i) => /^click$/i.test(String(i.type)));
    const rs = clicks[0]?.behavioralEvidence?.applicationEvidence?.resultingState ?? null;
    record('S5: scan lands under polling (settle/cap close)', !!rs, rs ? 'items=' + rs.items.length : 'ABSENT');
    if (rs) record('S5: bounded (items ≤ 50)', rs.items.length <= 50, 'items=' + rs.items.length);
  }

  // S6 — slow causal network
  {
    const { interactions } = await runScenario('S6', '/s6', async () => {
      await clickEv('go');
      await sleep(3500); // 1200ms fetch + settle
    });
    const clicks = (interactions ?? []).filter((i) => /^click$/i.test(String(i.type)));
    const rs = clicks[0]?.behavioralEvidence?.applicationEvidence?.resultingState ?? null;
    const notifs = rs?.items?.filter?.((x) => x.kind === 'notification') ?? [];
    record('S6: slow-request consequence captured', notifs.some((n) => (n.text || '').includes('done')), JSON.stringify(notifs.map((n) => n.text)));
  }

  // S7 — no consequence
  {
    const { interactions } = await runScenario('S7', '/s7', async () => {
      await clickEv('inert');
      await sleep(2500);
    });
    const clicks = (interactions ?? []).filter((i) => /^click$/i.test(String(i.type)));
    const rs = clicks[0]?.behavioralEvidence?.applicationEvidence?.resultingState ?? null;
    record('S7: no semantic content → field ABSENT', rs == null, rs ? 'PRESENT items=' + rs.items.length : 'absent');
  }

  // S8 — overlapping interactions
  {
    const { interactions } = await runScenario('S8', '/s8', async () => {
      await clickEv('btn-a');
      await sleep(250);
      await clickEv('btn-b');
      await sleep(3000);
    });
    const clicks = (interactions ?? []).filter((i) => /^click$/i.test(String(i.type)));
    record('S8: two click interactions recorded', clicks.length === 2, 'count=' + clicks.length);
    const a = clicks[0]?.behavioralEvidence?.applicationEvidence?.resultingState;
    const b = clicks[1]?.behavioralEvidence?.applicationEvidence?.resultingState;
    record('S8: A and B each have their own resultingState', !!a && !!b, `A=${a ? a.items.length : '∅'} B=${b ? b.items.length : '∅'}`);
    const aCounters = (a?.items ?? []).filter((x) => x.kind === 'counter');
    const bCounters = (b?.items ?? []).filter((x) => x.kind === 'counter');
    record('S8: A sees a=1', aCounters.some((c) => c.numericValue === 1), JSON.stringify(aCounters.map((c) => c.numericValue)));
    record('S8: B sees b=1 (own window)', bCounters.some((c) => c.numericValue === 1), JSON.stringify(bCounters.map((c) => c.numericValue)));
  }

  // ── Summary ──
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== PHASE 3 REAL-CHROME RESULTS: ${results.length - fails.length}/${results.length} PASS =====`);
  for (const f of fails) console.log('  FAIL:', f.name, '—', f.detail);

  try { await panel.close(); } catch {}
  try { await app.close(); } catch {}
  server.close();
  if (chromeProc?.pid) { try { process.kill(chromeProc.pid, 'SIGKILL'); } catch {} }
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error('[harness] fatal:', e);
  if (chromeProc?.pid) { try { process.kill(chromeProc.pid, 'SIGKILL'); } catch {} }
  process.exit(2);
});
