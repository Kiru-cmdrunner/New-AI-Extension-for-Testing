// READ-ONLY diagnostic re-run of the AdaniOne-only real-Chrome test @ HEAD 350af71.
// Methodology reproduced from .drytis/notes/adanione-site-access-blocked.md +
// real-site-e2e-adanione-amazon-2026-08-20.md layer-isolation harness.
// No product changes; no bypass; evidence dumped to 40-*.json / 50-*.log.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/adanione-recheck-' + Date.now();
const DIST = '/workspace/dist';
const PORT = 9661;
const EV = '/workspace/.drytis/notes/evidence/adanione-recheck-350af71';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
const dump = (n, o) => fs.writeFileSync(`${EV}/${n}`, typeof o === 'string' ? o : JSON.stringify(o, null, 2));

const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { out('FATAL: chrome never came up'); process.exit(1); }

// ── L1: extension loads ──
const { targetInfos: t0 } = await browser.send('Target.getTargets');
const extSW = t0.find((t) => t.url.includes('service-worker-loader.js'));
const extId = extSW ? extSW.url.split('/')[2] : null;
out('L1 extension SW target:', extSW ? extSW.url.slice(0, 80) : 'NOT FOUND', '| extId =', extId);

const gather = async (c, label, url) => {
  const r = { label, url, phase: 'navigate' };
  try {
    const navP = c.send('Page.navigate', { url }).catch((e) => ({ err: String(e) }));
    const t0 = Date.now();
    let ev = null;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const s = await c.send('Runtime.evaluate', {
        expression: `(() => ({ url: location.href, readyState: document.readyState, hasDOM: !!document.body, nEls: document.body ? document.body.querySelectorAll('*').length : 0, title: document.title }))()`,
        returnByValue: true,
      }).catch(() => null);
      if (s && s.result && s.result.value) {
        r.lastState = s.result.value;
        if (s.result.value.hasDOM && s.result.value.nEls > 3) { ev = s.result.value; break; }
        if (/chrome-error:/.test(s.result.value.url)) { ev = s.result.value; break; }
      }
    }
    r.elapsedMs = Date.now() - t0;
    r.final = ev || r.lastState || null;
    r.phase = 'done';
  } catch (e) { r.error = String(e); r.phase = 'exception'; }
  try { await navP; } catch {}
  return r;
};

// ── L2: adanione.com only (apex + www) ──
const { targetId: tab } = await browser.send('Target.createTarget', { url: 'about:blank' });
const c = await CDP({ target: tab, port: PORT });
await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Network.enable');
const netLog = [];
c.on('Network.loadingFailed', (p) => netLog.push({ ts: p.timestamp, url: '(net)', err: p.errorText, blocked: p.blockedReason ?? null, type: p.type }));
const reqMap = {};
c.on('Network.requestWillBeSent', (p) => { reqMap[p.requestId] = p.request.url; });
c.on('Network.loadingFailed', (p) => { if (reqMap[p.requestId]) netLog[netLog.length - 1].url = reqMap[p.requestId]; });

const apex = await gather(c, 'adanione.com apex', 'https://adanione.com/');
const www = await gather(c, 'www.adanione.com', 'https://www.adanione.com/');
dump('40-adanione-apex.json', apex);
dump('40-adanione-www.json', www);
dump('41-adanione-netlog.json', netLog);
out('L2 apex  →', JSON.stringify(apex));
out('L2 www   →', JSON.stringify(www));
out('netLog   →', JSON.stringify(netLog.slice(0, 6)));

// ── L3: content-script injection evaluable? (needs a DOM) ──
const onAdani = www.final && www.final.hasDOM && !/chrome-error:/.test(www.final.url);
out('L3 evaluable on adanione:', onAdani);
let l3 = { evaluable: false, reason: 'no DOM ever rendered (chrome-error page) — content-script injection not evaluable' };
if (onAdani) {
  await sleep(2500);
  l3 = (await c.send('Runtime.evaluate', {
    expression: `(() => ({ extMarker: !!document.querySelector('[class*="cmdrunner" i], [id*="cmdrunner" i]'), readyState: document.readyState, nEls: document.body.querySelectorAll('*').length }))()`,
    returnByValue: true,
  })).result.value;
  l3.evaluable = true;
}
dump('42-l3-injection.json', l3);
out('L3 →', JSON.stringify(l3));

// ── Contrast: same extension instance, reachable site (saucedemo.com) ──
const contrast = await gather(c, 'contrast saucedemo.com', 'https://www.saucedemo.com/');
let contrastCS = null;
if (contrast.final && contrast.final.hasDOM && !/chrome-error:/.test(contrast.final.url)) {
  contrastCS = (await c.send('Runtime.evaluate', {
    expression: `(() => ({ url: location.href, nEls: document.body.querySelectorAll('*').length, inputs: document.querySelectorAll('input').length, readyState: document.readyState }))()`,
    returnByValue: true,
  })).result.value;
}
dump('43-contrast-saucedemo.json', { nav: contrast, dom: contrastCS });
out('CONTRAST saucedemo →', JSON.stringify({ nav: contrast, dom: contrastCS }));

// ── Verdict block ──
const verdict = {
  build: 'dist @ 350af71 (manifest 10.9.0, built 2026-08-20 08:59 from HEAD source)',
  L1_extension_loaded: !!extSW,
  L2_adanione_loaded: onAdani,
  L2_observed: { apex: apex.final, www: www.final, netErrors: netLog.slice(0, 4) },
  L3_injection_evaluable: l3.evaluable === true,
  contrast_saucedemo_loaded: !!(contrastCS && contrastCS.nEls > 3),
  classification: null,
};
verdict.classification = verdict.L1_extension_loaded && !verdict.L2_adanione_loaded && verdict.contrast_saucedemo_loaded
  ? 'AdaniOne/environment ACCESS failure — earliest failing layer is site body delivery (pre-DOM). NOT extension behavior; NOT harness behavior.'
  : 'DEVIATION from prior baseline — see dumps.';
dump('44-verdict.json', verdict);
out('VERDICT →', JSON.stringify(verdict, null, 2));

try { browser.send('Browser.close'); } catch {}
await sleep(1000);
process.exit(0);
