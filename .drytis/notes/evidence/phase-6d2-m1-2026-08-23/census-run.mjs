// M1-B runner: serves the archived clone app + 6D.1 app locally, censuses them
// via real Chrome, then censuses Avis Ford LIVE, and writes the census tables.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { CENSUS_JS } from './census-lib.mjs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const PORT = 9584;
const OUT = '/workspace/.drytis/notes/evidence/phase-6d2-m1-2026-08-23/dumps';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Serve the archived clone app on its own port (8166).
const cloneApp = spawn('node', ['/workspace/.drytis/notes/evidence/adanione-clone-audit/app.mjs'], { stdio: 'ignore' });
await sleep(1500);

// 2) Serve the 6D.1 app on its own port (8177).
const d1App = spawn('node', ['/workspace/.drytis/notes/evidence/phase-6d1-e2e-2026-08-23/app-6d1.mjs'], { stdio: 'ignore' });
await sleep(1500);

// 3) Launch real Chrome (plain, no extension needed for census).
const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/census-profile-${Date.now()}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
if (!browser) { console.log('FATAL: chrome never came up'); process.exit(1); }

// ── CDP page census helper (drives a URL in this browser instance) ──
const census = async (url) => {
  const { targetId } = await browser.send('Target.createTarget', { url });
  await sleep(3500);
  const page = await CDP({ target: targetId, port: PORT });
  await page.send('Runtime.enable');
  const res = await page.send('Runtime.evaluate', {
    expression: CENSUS_JS, returnByValue: true, awaitPromise: true,
  });
  if (res.exceptionDetails) {
    console.log('CENSUS EXCEPTION at', url, JSON.stringify(res.exceptionDetails.exception?.description || res.exceptionDetails.text).slice(0, 400));
  }
  await browser.send('Target.closeTarget', { targetId }).catch(() => {});
  return res.result?.value ?? null;
};

// ── Census the local surfaces ──
const results = {};
results.clone = await census('http://127.0.0.1:8166/');
console.log('CLONE:', JSON.stringify(results.clone?.summary, null, 1));

results.d1app = await census('http://127.0.0.1:8177/');
console.log('D1APP:', JSON.stringify(results.d1app?.summary, null, 1));

// ── Avis Ford LIVE census ──
try {
  results.avis = await census('https://www.avisford.com/');
  console.log('AVIS:', JSON.stringify(results.avis?.summary, null, 1));
} catch (e) {
  console.log('AVIS LIVE FAILED:', e.message);
}

fs.writeFileSync(`${OUT}/census.json`, JSON.stringify(results, null, 1));
console.log('→ dumps/census.json');
process.exit(0);
