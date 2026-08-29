// S2-only instrumented: where does the post-nav evidence go?
import CDP from 'chrome-remote-interface';
import http from 'node:http';
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9533, APP = 8099, REPLICA = `http://127.0.0.1:${APP}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { spawn } = await import('node:child_process');
const chrome = spawn(CHROME_BIN, [`--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/p3-s2-profile', '--load-extension=/workspace/dist', '--disable-extensions-except=/workspace/dist', '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check'], { stdio: 'ignore' });
for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) break; } catch {} if (i === 59) throw new Error('no cdp'); await sleep(250); }
const shell = (b) => `<!doctype html><html><body>${b}</body></html>`;
const server = http.createServer((q, s) => {
  if (q.url === '/s2') return s.end(shell(`<form method="GET" action="/s2-target"><input name="name" value="K"><button type="submit" id="submit-btn">Submit</button></form>`));
  if (q.url.startsWith('/s2-target')) return s.end(shell(`<div data-testid="order-confirmation">Order 12345 confirmed</div><span data-order-id="12345">Order 12345</span><span data-count="1" aria-label="Orders">1</span>`));
  s.statusCode = 404; s.end('nf');
});
await new Promise((r) => server.listen(APP, '127.0.0.1', r));
const browser = await CDP({ port: PORT });
await browser.send('Target.setDiscoverTargets', { discover: true, flatten: true }).catch(() => {});
await sleep(1500);
const { targetInfos } = await browser.send('Target.getTargets');
const KNOWN = 'gndjidfncanlhlonpcabokbdhnikglpn';
await browser.send('Target.createTarget', { url: `chrome-extension://${KNOWN}/src/sidepanel/index.html` });
await sleep(1000);
const { targetId: appTab } = await browser.send('Target.createTarget', { url: 'about:blank' });
await sleep(800);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const panelT = targets.find((t) => t.url.includes('sidepanel/index.html'));
const panel = await CDP({ target: panelT.webSocketDebuggerUrl, port: PORT });
await panel.send('Runtime.enable');
const app = await CDP({ target: appTab, port: PORT });
await app.send('Runtime.enable'); await app.send('Page.enable');
const evalIn = (c, e) => c.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }).then((r) => r?.result?.value);
const panelCmd = (t) => evalIn(panel, `(async () => { try { return await chrome.runtime.sendMessage({ type: ${JSON.stringify(t)} }); } catch (e) { return 'ERR ' + e.message; } })()`);
// nav + activate + start
await app.send('Page.navigate', { url: REPLICA + '/s2' });
await sleep(1200);
await browser.send('Target.activateTarget', { targetId: appTab });
await sleep(300);
console.log('start:', JSON.stringify(await panelCmd('START_RECORDING')));
await sleep(800);
const box = await evalIn(app, `(() => { const e = document.getElementById('submit-btn'); const r = e.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()`);
await app.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box[0], y: box[1], button: 'left', clickCount: 1 });
await app.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box[0], y: box[1], button: 'left', clickCount: 1 });
await sleep(4000);
console.log('stop:', JSON.stringify(await panelCmd('STOP_RECORDING')));
await sleep(2500);
const dump = await evalIn(panel, `(async () => {
  const all = await chrome.storage.local.get(null);
  const out = { storageKeys: Object.keys(all), interactions: [], pendingEvidence: null, navQueue: null, understanding: null };
  const inter = all['cmdrunner_live_interactions'] || [];
  out.interactions = inter.map((i) => ({ type: i.type, interactionId: i.interactionId, srcEv: i.triggerEvent?.eventId, winId: i.behavioralEvidence?.windowId, endReason: i.behavioralEvidence?.window?.endReason, rs: i.behavioralEvidence?.applicationEvidence?.resultingState?.items?.length ?? null }));
  for (const k of Object.keys(all)) {
    if (/pending/i.test(k)) out.pendingEvidence = (out.pendingEvidence ?? '') + ' ' + k + '=' + JSON.stringify(all[k]).slice(0, 400);
    if (/nav/i.test(k)) out.navQueue = (out.navQueue ?? '') + ' ' + k + '=' + JSON.stringify(all[k]).slice(0, 300);
  }
  out.understanding = all['understanding_result'] ? { transitions: all['understanding_result'].transitions?.length } : null;
  return out;
})()`);
console.log(JSON.stringify(dump, null, 1));
process.exit(0);
