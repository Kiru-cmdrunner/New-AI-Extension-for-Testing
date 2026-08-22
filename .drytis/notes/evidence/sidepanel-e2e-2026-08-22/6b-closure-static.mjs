// 6B closure — static dist checks. Suite + tsc logs are archived separately
// (tee'd into the evidence dir by the driver). This script only verifies the
// DIST build the real-Chrome harness loads carries the 6B code. The
// real-Chrome E2E itself lives in 6b-locator-e2e.mjs.
import fs from 'node:fs';
import path from 'node:path';

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ' :: ' + String(detail).slice(0, 400) : ''}`);
  if (!ok) fails++;
};

const assetsDir = '/workspace/dist/assets';
check('dist/assets exists', fs.existsSync(assetsDir));
const assets = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
check('dist/assets non-empty', assets.length > 0, `${assets.length} files`);

// 6B markers must be present in the bundles the extension actually loads.
// Recorder bundle: identity extraction gains dataAutoId.
const recorder = assets.find((f) => /^recorder-entry/.test(f));
check('recorder bundle found', !!recorder, recorder || 'absent');
if (recorder) {
  const txt = fs.readFileSync(path.join(assetsDir, recorder), 'utf8');
  check('6B: data-auto-id identity capture in recorder bundle', txt.includes('data-auto-id'));
}

// Service-worker bundle: IR generation / locator ranking run there.
const swAsset = assets.find((f) => /^service-worker/.test(f));
check('service-worker bundle found', !!swAsset, swAsset || 'absent');
if (swAsset) {
  const sw = fs.readFileSync(path.join(assetsDir, swAsset), 'utf8');
  check('6B: data-auto-id in service-worker bundle', sw.includes('data-auto-id'));
  check('6B: family-tagged selector form in service-worker bundle', /\[data-(cy|qa|auto-id)=/.test(sw), 'CSS family-attr form');
}

// Known pre-existing defect (out of 6B scope): executor content script never
// built into dist. Recorded so its absence is documented, not silent.
const execFiles = assets.filter((f) => /executor/.test(f));
console.log(`note: executor-named assets in dist: ${execFiles.length} (pre-existing Phase 12.4 defect — see DEFECT-executor-content-script-missing-from-dist.md; not a 6B regression)`);

console.log(`\n════ 6B static checks — ${fails === 0 ? 'ALL PASS' : `${fails} FAIL`} ════`);
process.exit(fails ? 1 : 0);
