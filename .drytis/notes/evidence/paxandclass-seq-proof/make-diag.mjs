// Diagnostic: dump the RAW ledger + projection + production filter output for
// the PaxAndClass workflow so we can see exactly where Round Trip / Premium
// Economy clicks went. Read-only.
import CDP from '/workspace/node_modules/chrome-remote-interface/index.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const HARNESS = '/workspace/.drytis/notes/evidence/paxandclass-seq-proof/pax-seq-harness.mjs';
const DUMP = '/workspace/.drytis/notes/evidence/paxandclass-seq-proof/raw';
fs.mkdirSync(DUMP, { recursive: true });
const src = fs.readFileSync(HARNESS, 'utf8');

// Patch: replace the analysis tail with a full raw dump.
const cut = src.indexOf('// ══ ANALYZE CAPTURED INTERACTIONS ══');
const head = src.slice(0, cut);
const tail = `
// ── RAW DUMP ──
const raw = await evalPanel(\`(async () => {
  const g = await chrome.storage.local.get(['cmdrunner_live_interactions','cmdrunner_evidence_ledger','cmdrunner_verification_result']);
  return {
    live: g.cmdrunner_live_interactions,
    ledger: g.cmdrunner_evidence_ledger,
    verification: g.cmdrunner_verification_result ? { match: g.cmdrunner_verification_result.match, differences: g.cmdrunner_verification_result.differences, projectedOutput: g.cmdrunner_verification_result.projectedOutput } : null,
  };
})()\`);
fs.writeFileSync('${DUMP}/raw.json', JSON.stringify(raw, null, 2));

const flat = (raw.ledger||[]).map(e => ({ id: e.eventId, type: e.eventType, seq: e.captureSeq, disp: e.disposition, name: e.targetName, tag: e.targetTag, role: e.targetRole, key: e.targetIdentity ? (e.targetIdentity.stableId || e.targetIdentity.cssSelector) : null, cls: e.targetIdentity ? e.targetIdentity.className : null }));
out('LEDGER (' + flat.length + ' entries):');
for (const e of flat) out('  ' + JSON.stringify(e));
out('LIVE (' + ((raw.live)||[]).length + '):');
for (const i of (raw.live||[])) out('  ' + i.interactionId + ' ' + i.type + ' ' + JSON.stringify(i.metadata && i.metadata.targetName) + ' sel=' + (i.trigger && i.trigger.cssSelector));
out('VERIFICATION match=' + (raw.verification && raw.verification.match));
if (raw.verification && !raw.verification.match) out('UNREPRESENTED: ' + JSON.stringify(raw.verification.differences));

try { await browser.close(); } catch {}
chrome.kill('SIGKILL');
srv.close();
process.exit(0);
`;
fs.writeFileSync('/tmp/pax-diag.mjs', head + tail);
