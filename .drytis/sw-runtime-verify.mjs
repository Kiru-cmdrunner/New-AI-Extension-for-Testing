// REAL Chrome MV3 runtime verification: load dist/, drive START then STOP via
// the sidepanel, capture SW console, then probe chrome.storage.local.
// Layer-2 verification: with dynamic imports inlined, no stage may fail.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const EXT = '/workspace/dist';
const chromePath = '/usr/bin/google-chrome' /* fallback set below */;
const fs = await import('fs');
const exe = fs.existsSync(chromePath)
  ? chromePath
  : fs.existsSync('/usr/bin/chromium')
    ? '/usr/bin/chromium'
    : '/usr/bin/chromium-browser';

const userDataDir = mkdtempSync(join(tmpdir(), 'swverify-'));
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});

const consoleLines = [];
try {
  // Find the extension's service worker target.
  let swTarget = null;
  // Kick the SW awake: open any extension-origin page (runtime wakes SW for messaging).
  try {
    const t0 = await browser.waitForTarget((t) => t.url().startsWith('chrome-extension://'), { timeout: 10000 });
    const base = new URL(t0.url()).origin;
    const wake = await browser.newPage();
    await wake.goto(base + '/src/sidepanel/index.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
    // Force SW registration awake via runtime message from the extension page.
    await wake.evaluate(async () => {
      try { await chrome.runtime.sendMessage({ type: 'PING_SW' }); } catch (e) {}
    }).catch(() => {});
  } catch (e) { consoleLines.push('[wake] ' + e.message); }
  for (let i = 0; i < 40 && !swTarget; i++) {
    const ts = await browser.targets();
    consoleLines.push('[targets] ' + ts.map((t) => t.type() + ':' + t.url().slice(0, 80)).join(' | '));
    swTarget = ts.find((t) => t.type() === 'service_worker' && t.url().includes('service-worker'));
    if (!swTarget) await new Promise((r) => setTimeout(r, 500));
  }
  if (!swTarget) throw new Error('no service_worker target');

  const sw = await swTarget.worker();
  console.log('[harness] SW target:', sw.url());

  // Attach console capture inside the worker.
  const cdp = await sw.createCDPSession();
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (e) => {
    const text = e.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    consoleLines.push(`[console.${e.type}] ${text}`);
  });
  cdp.on('Runtime.exceptionThrown', (e) => {
    const d = e.exceptionDetails;
    consoleLines.push(
      `[exception] ${d.text} ${d.exception?.description ?? ''}`
    );
  });

  // --- drive START/STOP through the real sidepanel UI --------------------
  // The sidepanel cannot be opened in headless; instead, trigger the same
  // message path the panel uses: chrome.runtime.sendMessage to the SW.
  const panelUrl = sw.url().replace(/service-worker-loader\.js.*/, 'src/sidepanel/index.html');
  const page = await browser.newPage();
  await page.goto(panelUrl, { waitUntil: 'domcontentloaded' });

  // Evaluate inside the EXTENSION PAGE (same origin as the SW) — send the
  // exact runtime messages the sidepanel buttons emit.
  const startResult = await page.evaluate(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'START_RECORDING' });
    return res;
  });
  consoleLines.push(`[harness] START_RECORDING -> ${JSON.stringify(startResult)}`);

  await new Promise((r) => setTimeout(r, 1500));

  const stopResult = await page.evaluate(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    return res;
  });
  consoleLines.push(`[harness] STOP_RECORDING -> ${JSON.stringify(stopResult)}`);

  await new Promise((r) => setTimeout(r, 4000)); // let M9 + persistence settle

  // --- Layer-0 probe: UNDERSTANDING_RESULT + LIVE_INTERACTIONS -----------
  const probe = await page.evaluate(async () => {
    const S = await chrome.storage.local.get(['understanding_result', 'cmdrunner_live_interactions']);
    return S;
  });
  consoleLines.push(`[harness] storage keys present: understanding_result=${!!probe.understanding_result} live=${!!probe.cmdrunner_live_interactions}`);

  // Deep-dive: interaction + outcome/entity/domain/intent summary.
  const digest = await page.evaluate(async () => {
    const S = await chrome.storage.local.get(['understanding_result', 'cmdrunner_live_interactions']);
    const ur = S.understanding_result;
    const live = S.cmdrunner_live_interactions;
    const out = { understanding: null, interactions: 0, sample: null };
    if (ur) {
      out.understanding = {
        keys: Object.keys(ur),
        domain: ur.semanticKnowledge?.domain ?? ur.domain ?? null,
        warnings: ur.knowledgeWarnings ?? null,
      };
    }
    if (live) {
      const arr = Array.isArray(live) ? live : live.interactions ?? [];
      out.interactions = arr.length;
      out.sample = arr.slice(0, 3).map((i) => ({ id: i.id, type: i.interactionType ?? i.type }));
    }
    return out;
  });
  consoleLines.push(`[harness] digest: ${JSON.stringify(digest).slice(0, 900)}`);
} catch (e) {
  consoleLines.push(`[harness] ERROR: ${e.message}`);
} finally {
  console.log(consoleLines.join('\n'));
  await browser.close();
}
