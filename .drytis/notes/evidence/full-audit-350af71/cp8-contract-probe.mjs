// CP8 knowledge/contract probe at HEAD 350af71 — production contract classes
// over the real extension IndexedDB (D6 methodology), evaluated in the
// SIDEPANEL context of the SAME browser session that just recorded R3.
// Read-only: contract is read-only by construction.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';

const CHROME_BIN = '/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome';
const DIST = '/workspace/dist';
const PORT = 9559;
const PROBE_SRC = '/tmp/cp8-probe-src';
const EV = '/workspace/.drytis/notes/evidence/full-audit-350af71';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (...a) => console.log(...a);
let PASS = 0, FAIL = 0;
const check = (n, ok, d = '') => { out(`${ok ? 'PASS' : 'FAIL'} — ${n}${d ? ' :: ' + String(d).slice(0, 900) : ''}`); ok ? PASS++ : FAIL++; };

// 1. Build the probe bundle from PRODUCTION src (read-only build to /tmp)
fs.mkdirSync(PROBE_SRC, { recursive: true });
fs.writeFileSync(`${PROBE_SRC}/probe.ts`, `
import { KnowledgeDatabase } from '/workspace/src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '/workspace/src/understanding/persistence/knowledge-repository';
import { KnowledgeLoader } from '/workspace/src/understanding/consolidation/knowledge-loader';
import { KnowledgeContract } from '/workspace/src/understanding/contract/knowledge-contract';
export async function run(): Promise<string> {
  const db = new KnowledgeDatabase();
  await db.open();
  const repo = new KnowledgeRepository(db);
  const loader = new KnowledgeLoader(repo);
  const contract = new KnowledgeContract(repo, loader);
  const apps = await contract.listApplications().then(e => e.data);
  const appId = apps[0]?.id ?? null;
  const result: any = { apps: apps.map(a => ({ id: a.id, name: a.name, sessions: a.sessionCount ?? null })) };
  if (appId) {
    const sessions = await contract.listBehaviorSessions(appId).then(e => e.data);
    result.sessions = sessions;
    const actions = await contract.listActions(appId, {}).then(e => e.data);
    result.actions = actions.map((a: any) => ({ type: a.interactionType ?? a.type, name: a.name ?? a.label ?? null, wf: a.workflowPatternIds?.length ?? 0 }));
    const app = await contract.describeApplication(appId).then(e => e.data);
    result.describe = app ? { id: app.id, entities: app.entities?.length ?? 0, workflows: app.workflows?.length ?? 0, nav: app.navigation?.nodes?.length ?? app.navigation?.length ?? 0 } : null;
  }
  db.close();
  return JSON.stringify(result);
}
`);
execSync(
  `npx esbuild ${PROBE_SRC}/probe.ts --bundle --format=esm --platform=browser ` +
  `--outfile=/tmp/cp8-probe.mjs --define:process.env.NODE_ENV='"production"'`,
  { cwd: '/workspace', stdio: 'pipe' },
);
const probeCode = fs.readFileSync('/tmp/cp8-probe.mjs', 'utf8');
out('probe bundle bytes:', probeCode.length);

// 2. Launch Chrome with the extension, open sidepanel, run probe in its context
const chrome = spawn(CHROME_BIN, [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=/tmp/cp8-${Date.now()}`,
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check',
  `--load-extension=${DIST}`, '--disable-extensions-except=' + DIST,
], { stdio: 'ignore' });
let browser = null;
for (let i = 0; i < 20; i++) { await sleep(1000); try { browser = await CDP({ port: PORT }); break; } catch {} }
const { targetInfos } = await browser.send('Target.getTargets');
const extId = targetInfos.find((t) => t.url.includes('service-worker-loader.js')).url.split('/')[2];
const { targetId: panel } = await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/src/sidepanel/index.html` });
await sleep(2000);
const c = await CDP({ target: panel, port: PORT });
await c.send('Runtime.enable');
const r = await c.send('Runtime.evaluate', {
  awaitPromise: true, returnByValue: true,
  expression: `(async () => {
    const mod = await import('data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(${JSON.stringify(probeCode)}))));
    return await mod.run();
  })()`,
});
let probe; try { probe = JSON.parse(r.result.value); } catch { probe = { raw: r.result?.value ?? String(r.exceptionDetails?.text) }; }
out(JSON.stringify(probe, null, 1));
fs.writeFileSync(`${EV}/cp8-probe-result.json`, JSON.stringify(probe, null, 2));
check('CP8: applications listed from real DB', Array.isArray(probe.apps) && probe.apps.length >= 1, JSON.stringify(probe.apps));
check('CP8: behavior sessions enumerable', Array.isArray(probe.sessions) && probe.sessions.length >= 1, `${probe.sessions?.length ?? 0} sessions: ` + JSON.stringify((probe.sessions ?? []).slice(0, 5)));
check('CP8: actions linked to workflow patterns', Array.isArray(probe.actions) && probe.actions.length >= 1 && probe.actions.some(a => a.wf > 0), JSON.stringify((probe.actions ?? []).slice(0, 8)));
check('CP8: application descriptor (entities/workflows/nav)', probe.describe && (probe.describe.workflows > 0 || probe.describe.nav > 0 || probe.describe.entities > 0), JSON.stringify(probe.describe));
out(`\n════ CP8 PROBE — ${PASS} PASS / ${FAIL} FAIL ════`);
try { browser.send('Browser.close'); } catch {}
await sleep(1000);
process.exit(0);
