// Control arm: same Chrome 148, NO extension — adanione.com only.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PROFILE = '/tmp/adanione-clean-' + Date.now();
const PORT = 9662;
const EV = '/workspace/.drytis/notes/evidence/adanione-recheck-350af71';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  // NOTE: no --load-extension — clean browser
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { console.log('FATAL'); process.exit(1); }
const { targetInfos } = await browser.send('Target.getTargets');
const hasExt = targetInfos.some((t) => t.url.startsWith('chrome-extension://'));
const { targetId: tab } = await browser.send('Target.createTarget', { url: 'about:blank' });
const c = await CDP({ target: tab, port: PORT });
await c.send('Runtime.enable'); await c.send('Network.enable');
const fails = [];
c.on('Network.loadingFailed', (p) => fails.push(p.errorText));
await c.send('Page.navigate', { url: 'https://www.adanione.com/' });
let state = null;
for (let i = 0; i < 16; i++) {
  await sleep(500);
  const s = await c.send('Runtime.evaluate', {
    expression: `(() => ({ url: location.href, readyState: document.readyState, hasDOM: !!document.body, nEls: document.body ? document.body.querySelectorAll('*').length : 0 }))()`,
    returnByValue: true,
  }).catch(() => null);
  if (s && s.result && s.result.value) {
    state = s.result.value;
    if (/chrome-error:/.test(state.url)) break;
    if (state.hasDOM && state.nEls > 3) break;
  }
}
const res = { extensionTargetsPresent: hasExt, finalState: state, netErrors: [...new Set(fails)] };
console.log(JSON.stringify(res, null, 2));
fs.writeFileSync(`${EV}/45-control-clean-chrome.json`, JSON.stringify(res, null, 2));
try { browser.send('Browser.close'); } catch {}
await sleep(800);
process.exit(0);
