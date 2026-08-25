#!/usr/bin/env node
/**
 * Unclassified Census Analyzer — 7.4-B3 S0
 *
 * Classifies every Unclassified card in a chrome.storage.local dump into:
 *
 *   dedup-resurrected   — ledger entry unclaimed with claimedBy=lc-* whose
 *                         lifecycle matched a same-type/same-elementKey
 *                         prior within DEDUP_WINDOW_MS (F1 signature).
 *   gate-rejected       — no dedup signature; no claim-gate signal on the
 *                         element (the honest "we don't know" population).
 *   evidence-consequential — stranded or attached evidence for the card's
 *                         eventId carries ≥1 consequence signal (domChanges,
 *                         newSurfaces, removedSurfaces, visibilityChanges,
 *                         navigation, network with matching sourceEventId).
 *   body-structural     — targetTag BODY/HTML (post-S4 builds).
 *
 * Usage:
 *   node scripts/unclassified-census.mjs <dump.json> [--label <name>]
 *
 * Reads:  cmdrunner_evidence_ledger, cmdrunner_pending_evidence,
 *         cmdrunner_live_interactions
 * Writes: JSON census to stdout (harness/redirect captures it).
 */
import { readFileSync } from 'node:fs';

const DEDUP_WINDOW_MS = 2000;

function die(msg) {
  console.error('census: ' + msg);
  process.exit(2);
}

// ── Inputs ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dumpPath = args[0];
if (!dumpPath) die('usage: node unclassified-census.mjs <dump.json> [--label name]');
const labelIdx = args.indexOf('--label');
const label = labelIdx >= 0 ? args[labelIdx + 1] : dumpPath;

let dump;
try {
  dump = JSON.parse(readFileSync(dumpPath, 'utf8'));
} catch (e) {
  die('cannot parse ' + dumpPath + ': ' + e.message);
}

const ledger = dump.cmdrunner_evidence_ledger ?? [];
const pendingEvidence = Array.isArray(dump.cmdrunner_pending_evidence)
  ? dump.cmdrunner_pending_evidence // [key, value][] (post-drain may be empty)
  : Object.entries(dump.cmdrunner_pending_evidence ?? {});
const interactions = dump.cmdrunner_live_interactions ?? [];

if (!Array.isArray(ledger)) die('cmdrunner_evidence_ledger missing/not array');

// ── Indexes ────────────────────────────────────────────────────────────

const entryById = new Map(ledger.map((e) => [e.eventId, e]));

// Rich key of an interaction's trigger target — same normalization the
// projection engine applies to ledger entries (D1 identity preferred).
function interactionElementKey(i) {
  const t = i.trigger?.tag ?? i.triggerEvent?.target?.tag ?? '';
  const n = i.trigger?.accessibleName ?? i.triggerEvent?.target?.accessibleName ?? '';
  const sel = i.trigger?.cssSelector ?? i.triggerEvent?.target?.cssSelector ?? '';
  return `tag:${t}|name:${n}|sel:${sel}`;
}

function ledgerElementKey(e) {
  if (e.targetIdentity && e.targetIdentity.cssSelector) {
    const id = e.targetIdentity;
    return `tag:${id.tag}|name:${id.accessibleName ?? ''}|sel:${id.cssSelector}`;
  }
  return `tag:${e.targetTag}|name:${e.targetName}|role:${e.targetRole}`;
}

// Completed recognized interactions, in emission order.
const completedRecognized = interactions.filter(
  (i) => i.type !== 'Unclassified' && i.endState === 'completed',
);

// Last recognized completion per (type, elementKey) for dedup-signature
// matching (matches runtime isDuplicate: same type + same key + gap ≤ 2s).
function dedupSignature(entry) {
  if (entry.disposition !== 'unclaimed') return null;
  if (!entry.claimedBy || !/^lc-/.test(entry.claimedBy)) return null;
  const key = ledgerElementKey(entry);
  for (let i = completedRecognized.length - 1; i >= 0; i--) {
    const prior = completedRecognized[i];
    if (prior.type === 'Click' && prior.endTime > 0) {
      const priorKey = interactionElementKey(prior);
      if (priorKey !== key) continue;
      const gap = entry.timestamp - prior.endTime;
      if (gap >= 0 && gap <= DEDUP_WINDOW_MS) {
        return { priorInteractionId: prior.interactionId, gapMs: gap };
      }
    }
  }
  return null;
}

// ── Evidence shapes ────────────────────────────────────────────────────

function hasConsequence(evidenceValue) {
  if (!evidenceValue || typeof evidenceValue !== 'object') return false;
  const a = evidenceValue.applicationEvidence ?? evidenceValue;
  const appArrays = [
    a.domChanges, a.newSurfaces, a.removedSurfaces,
    a.visibilityChanges, a.navigation,
  ];
  for (const arr of appArrays) {
    if (Array.isArray(arr) && arr.length > 0) return true;
  }
  const net = a.networkActivity;
  if (Array.isArray(net) && net.length > 0) return true;
  return false;
}

const pendingBySourceEventId = new Map();
for (const [key, value] of pendingEvidence) {
  if (value && value.sourceEventId) pendingBySourceEventId.set(value.sourceEventId, { key, value });
}

// ── Census over Unclassified cards ─────────────────────────────────────

const unclassifiedCards = interactions.filter((i) => i.type === 'Unclassified');

const rows = [];
for (const card of unclassifiedCards) {
  const evId = card.triggerEvent?.eventId ?? card.metadata?.eventId;
  const entry = evId ? entryById.get(evId) : undefined;
  const pending = evId ? pendingBySourceEventId.get(evId) : undefined;

  let klass = 'gate-rejected';
  let detail = {};

  if (entry && entry.targetTag === 'BODY' || entry?.targetTag === 'HTML') {
    klass = 'body-structural';
    detail = { targetTag: entry.targetTag };
  } else if (entry && dedupSignature(entry)) {
    klass = 'dedup-resurrected';
    detail = dedupSignature(entry);
  } else if (hasConsequence(card.behavioralEvidence)) {
    klass = 'evidence-consequential';
    detail = { attached: true };
  } else if (pending && hasConsequence(pending.value)) {
    klass = 'evidence-consequential';
    detail = { attached: false, stranded: pending.key };
  }

  rows.push({
    interactionId: card.interactionId,
    eventId: evId ?? null,
    physicalEventType: card.metadata?.physicalEventType ?? null,
    targetName: card.metadata?.targetName ?? null,
    targetTag: card.metadata?.targetTag ?? null,
    classification: klass,
    ...detail,
  });
}

// ── Summary ────────────────────────────────────────────────────────────

const counts = {};
for (const r of rows) counts[r.classification] = (counts[r.classification] ?? 0) + 1;

const totalLedger = ledger.length;
const dispositions = {};
for (const e of ledger) {
  dispositions[e.disposition] = (dispositions[e.disposition] ?? 0) + 1;
}

const report = {
  label,
  source: dumpPath,
  unclassifiedTotal: rows.length,
  counts,
  ledger: { total: totalLedger, dispositions },
  pendingEvidenceKeys: pendingEvidence.length,
  cards: rows,
};

console.log(JSON.stringify(report, null, 2));
