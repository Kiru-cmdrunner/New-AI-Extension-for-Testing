import CDP from 'chrome-remote-interface';
const PORT = 9533;
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const panel = targets.find((t) => t.url.includes('chrome-extension://') && t.url.includes('sidepanel/index.html'));
if (!panel) { console.log('no panel; targets:', targets.map(t => t.type + ':' + t.url.slice(0, 60))); process.exit(0); }
const c = await CDP({ target: panel.webSocketDebuggerUrl, port: PORT });
await c.send('Runtime.enable');
const r = await c.send('Runtime.evaluate', {
  expression: `(async () => {
    const inter = await chrome.storage.local.get('cmdrunner_live_interactions');
    const ur = await chrome.storage.local.get('understanding_result');
    const arr = inter.cmdrunner_live_interactions || [];
    const out = arr.map((i) => ({
      type: i.interactionType || i.type,
      endReason: i.behavioralEvidence?.endReason,
      hasRS: i.behavioralEvidence?.applicationEvidence?.resultingState != null,
      rsItems: i.behavioralEvidence?.applicationEvidence?.resultingState?.items?.length ?? null,
      appEvKeys: Object.keys(i.behavioralEvidence?.applicationEvidence || {}),
      surfaces: (i.behavioralEvidence?.applicationEvidence?.newSurfaces || []).map(s => s.kind + '@' + (s.domPath||'').slice(0,40)),
    }));
    const u = ur.understanding_result;
    return { n: arr.length, out, trans: u?.transitions?.length ?? null, outcomes: u?.outcomes?.length ?? null };
  })()`,
  awaitPromise: true, returnByValue: true,
});
console.log(JSON.stringify(r.result.value, null, 1));
