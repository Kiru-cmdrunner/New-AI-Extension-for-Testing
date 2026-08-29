// Verify WHICH extension targets exist in a clean Chrome (no --load-extension).
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9663;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/adanione-clean-verify-${Date.now()}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos } = await browser.send('Target.getTargets');
const extTargets = targetInfos.filter((t) => t.url.startsWith('chrome-extension://')).map((t) => ({ type: t.type, url: t.url.slice(0, 100) }));
const ours = extTargets.filter((t) => t.url.includes('gndjidfncanlhlonpcabokbdhnikglpn') || t.url.includes('service-worker-loader'));
console.log(JSON.stringify({
  totalTargets: targetInfos.length,
  extensionTargets: extTargets,
  ourExtensionPresent: ours.length > 0,
}, null, 2));
try { browser.send('Browser.close'); } catch {}
await sleep(800);
process.exit(0);
