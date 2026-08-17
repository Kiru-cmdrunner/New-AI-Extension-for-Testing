/**
 * CP6 — Behavior Knowledge Merge
 *
 * Pure merge functions for Stratum 2 (cross-session generalized knowledge).
 * No clock, no randomness, no I/O. All arithmetic derives from stored seq
 * values and the session manifest's generatedAtMs.
 *
 * Merge model (per approved design + R8):
 * - The repository folds ONE input per EPISODE, sequentially, inside the
 *   write transaction; later episodes of a session see earlier results.
 * - A "session boundary" fold is the first fold whose sessionId differs
 *   from the signature's lastSeenAtSession. Only boundary folds increment
 *   signature occurrenceCount and consequence missedObservations — so a
 *   session with several episodes of the same signature counts exactly
 *   once, and misses are counted per signature-observed session, never
 *   per episode.
 * - Replay of a whole session is prevented upstream by the session-manifest
 *   idempotency gate (repository step 1); merge assumes each session folds
 *   once. Within-session re-folds of the same episode are still safe for
 *   every session-guarded counter (occurrenceCount, hitCount, misses).
 *
 * Architecture: .drytis/specs/cp6-knowledge-repository.md
 */

import type {
  KnowledgeActionSignatureRow,
  KnowledgeConsequence,
  KnowledgeEvidenceSample,
} from './knowledge-types';
import {
  MAX_CONSEQUENCES_PER_SIGNATURE,
  MAX_EVIDENCE_SAMPLES,
  DIVERGENCE_AFTER_SESSIONS,
} from './knowledge-types';

// ── Merge input (produced by the repository from mapper output) ────────

/** One consequence observation, generalized by the mapper. */
export interface SignatureConsequenceInput {
  /** `${tier}|${kind}|${targetIdentity}` (FROZEN v1 grammar). */
  identity: string;
  tier: string;
  kind: string;
  targetIdentity: string;
  observedVia: string;
  /** Stratum-1 edge row key — the evidence pointer for this observation. */
  edgeKey: string;
}

/**
 * One episode's contribution to its signature.
 * The repository produces these from mapper output; mergeSignature consumes
 * them inside the write transaction, grouped by signature key.
 */
export interface SignatureMergeInput {
  key: string;
  appId: string;
  actionType: string;
  normalizedTarget: string;
  anchorViewId: string | null;
  /** Manifest seq of the observing session. */
  sessionSeq: number;
  sessionId: string;
  /** Session manifest generatedAtMs — the ONLY time source. */
  generatedAtMs: number;
  consequences: SignatureConsequenceInput[];
}

// ── Confidence (deterministic recurrence formula) ───────────────────────

/**
 * Recurrence confidence from hit count and miss recency.
 * observationScore = min(hitCount / 5, 1)      // saturation at 5 sessions
 * recencyScore     = missed == 0 ? 1 : max(1 − 0.15·missed, 0.1)
 * score            = (observation + recency) / 2
 *
 * One observing pipeline → no "distinct sources" axis. Rounded to 3
 * decimals; monotonic in observations at fixed recency.
 */
export function recurrenceConfidence(hitCount: number, missed: number): number {
  const observationScore = Math.min(hitCount / 5, 1);
  const recencyScore =
    missed === 0 ? 1 : Math.max(1 - 0.15 * missed, 0.1);
  return round3((observationScore + recencyScore) / 2);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── Consequence status ──────────────────────────────────────────────────

/**
 * Consequence lifecycle from missedObservations (exact count of consecutive
 * signature-observed sessions since the last hit):
 *   0               → 'active'   (observed in the latest observing session)
 *   1 .. DIVERGENCE−1 → 'stale'  (aged out of the latest session — warning band)
 *   ≥ DIVERGENCE    → 'diverged' (absent 3+ sessions while the signature was
 *                                  observed — a change signal, retained forever)
 * A hit always restores 'active'.
 */
function consequenceStatus(missed: number): KnowledgeConsequence['status'] {
  if (missed >= DIVERGENCE_AFTER_SESSIONS) return 'diverged';
  if (missed > 0) return 'stale';
  return 'active';
}

// ── Evidence sample ring ────────────────────────────────────────────────

/**
 * Append a sample only for a session not already sampled (first-wins per
 * session — deterministic across replays). Bounded to the last
 * MAX_EVIDENCE_SAMPLES entries.
 */
function appendSample(
  samples: KnowledgeEvidenceSample[],
  sample: KnowledgeEvidenceSample,
): KnowledgeEvidenceSample[] {
  if (samples.some((s) => s.sessionId === sample.sessionId)) {
    return samples;
  }
  const next = [...samples, sample];
  if (next.length > MAX_EVIDENCE_SAMPLES) {
    return next.slice(next.length - MAX_EVIDENCE_SAMPLES);
  }
  return next;
}

// ── Consequence profile merge ───────────────────────────────────────────

/**
 * Fold one episode's consequence set into an existing profile.
 *
 * `boundary` marks the first fold of a NEW session for this signature —
 * the only point where misses may accrue for unobserved consequences.
 *
 * Rules:
 * - Identity match → occurrenceCount++ (per-observation counter);
 *   hitCount++ only on the FIRST hit of this session
 *   (per-consequence session guard = lastSeenAtSession);
 *   a hit resets missedObservations to 0.
 * - New identity → inserted with hitCount 1 (this session contains it).
 * - Same-identity inputs within ONE session collapse to a single entry
 *   (F2): a session observing the same consequence more than once counts
 *   as one observation for hitCount/insertion (no duplicate entries, no
 *   amplification on later folds), while occurrenceCount still counts
 *   every observation.
 * - Unobserved existing identity at a boundary → missedObservations++,
 *   confidence and status recomputed (decay, never delete).
 * - Inputs never mutated; every output object is fresh.
 */
export function mergeConsequenceProfile(
  existing: KnowledgeConsequence[],
  inputs: SignatureConsequenceInput[],
  sessionId: string,
  sessionSeq: number,
  boundary: boolean,
): KnowledgeConsequence[] {
  const byIdentity = new Map(existing.map((c) => [c.identity, c]));
  // F2: collapse same-identity inputs within this fold to a single
  // observation (first occurrence wins — deterministic sample). Without
  // this, duplicate identities in one session insert parallel entries and
  // amplify on every subsequent hit-fold.
  const collapsed: SignatureConsequenceInput[] = [];
  const seenInFold = new Set<string>();
  for (const input of inputs) {
    if (seenInFold.has(input.identity)) continue;
    seenInFold.add(input.identity);
    collapsed.push(input);
  }
  const observedIdentities = new Set(collapsed.map((c) => c.identity));

  // 1) Existing entries (ordered by first insertion — profile order is stable).
  const merged: KnowledgeConsequence[] = existing.map((c) => {
    const hit = observedIdentities.has(c.identity);
    if (!hit) {
      if (!boundary) return c;
      const missed = c.missedObservations + 1;
      return {
        ...c,
        missedObservations: missed,
        confidence: recurrenceConfidence(c.hitCount, missed),
        status: consequenceStatus(missed),
      };
    }
    const wasHitThisSession = c.lastSeenAtSession === sessionId;
    const missed = 0; // a hit resets the miss run
    return {
      ...c,
      occurrenceCount: c.occurrenceCount + 1,
      hitCount: wasHitThisSession ? c.hitCount : c.hitCount + 1,
      missedObservations: missed,
      firstSeenAtSession: c.firstSeenAtSession,
      lastSeenAtSession: sessionId,
      lastSeenSeq: sessionSeq,
      confidence: recurrenceConfidence(
        wasHitThisSession ? c.hitCount : c.hitCount + 1,
        missed,
      ),
      status: consequenceStatus(missed),
      // observedVia: keep first observation (stable provenance label)
      evidenceSamples: appendSample(c.evidenceSamples, sampleFor(c.identity)),
    };
  });

  // 2) New identities (input order — deterministic). `collapsed` is
  // identity-unique by construction, so each insert is a genuinely new
  // identity — duplicate inserts are structurally impossible.
  for (const input of collapsed) {
    if (byIdentity.has(input.identity)) continue;
    merged.push({
      identity: input.identity,
      tier: input.tier,
      kind: input.kind,
      targetIdentity: input.targetIdentity,
      occurrenceCount: 1,
      hitCount: 1,
      missedObservations: 0,
      firstSeenAtSession: sessionId,
      lastSeenAtSession: sessionId,
      lastSeenSeq: sessionSeq,
      confidence: recurrenceConfidence(1, 0),
      status: 'active',
      evidenceSamples: [{ sessionId, edgeKey: input.edgeKey }],
      observedVia: input.observedVia,
    });
  }

  return merged;

  function sampleFor(identity: string): KnowledgeEvidenceSample {
    const input = collapsed.find((c) => c.identity === identity);
    return { sessionId, edgeKey: input?.edgeKey ?? '' };
  }
}

// ── Profile bounding ────────────────────────────────────────────────────

/**
 * Bound the profile to MAX_CONSEQUENCES_PER_SIGNATURE while NEVER evicting
 * diverged or stale entries (knowledge is demoted, not destroyed). If
 * active entries exceed the budget, the weakest (lowest occurrenceCount,
 * then identity asc) are evicted.
 */
export function boundConsequences(
  profile: KnowledgeConsequence[],
): KnowledgeConsequence[] {
  if (profile.length <= MAX_CONSEQUENCES_PER_SIGNATURE) return profile;

  const retained = profile.filter(
    (c) => c.status === 'diverged' || c.status === 'stale',
  );
  const active = profile
    .filter((c) => c.status === 'active')
    .sort(
      (a, b) =>
        b.occurrenceCount - a.occurrenceCount || (a.identity < b.identity ? -1 : 1),
    );
  const budget = Math.max(0, MAX_CONSEQUENCES_PER_SIGNATURE - retained.length);
  const evicted = new Set(
    active.slice(budget).map((c) => c.identity),
  );

  // Preserve original profile order among retained entries.
  return profile.filter(
    (c) => !evicted.has(c.identity) || c.status !== 'active',
  );
}

// ── mergeSignature ──────────────────────────────────────────────────────

/**
 * Fold ONE episode's observation into its signature. The repository calls
 * this once per (signature, episode) pair inside the write transaction,
 * sequentially, so within a session later episodes see earlier results.
 *
 * Session-guarded arithmetic (R1/R8, approved):
 * - occurrenceCount counts DISTINCT SESSIONS observing the signature.
 * - hitCount counts DISTINCT SESSIONS containing the consequence.
 * - missedObservations increments only at session boundaries where the
 *   signature was observed WITHOUT the consequence, and resets on a hit —
 *   the exact divergence denominator (seq distance over-counts across
 *   recording gaps).
 * - Replaying the same session can never inflate any session-guarded
 *   counter (the manifest gate prevents whole-session replay upstream).
 */
export function mergeSignature(
  existing: KnowledgeActionSignatureRow | undefined,
  input: SignatureMergeInput,
): KnowledgeActionSignatureRow {
  if (!existing) {
    return {
      key: input.key,
      appId: input.appId,
      actionType: input.actionType,
      normalizedTarget: input.normalizedTarget,
      anchorViewId: input.anchorViewId,
      firstSeenAtSession: input.sessionId,
      lastSeenAtSession: input.sessionId,
      firstSeenSeq: input.sessionSeq,
      lastSeenSeq: input.sessionSeq,
      firstSeenAtMs: input.generatedAtMs,
      lastSeenAtMs: input.generatedAtMs,
      occurrenceCount: 1,
      sessionsSinceSeen: 0,
      status: 'active',
      source: 'behavior',
      consequenceProfile: mergeConsequenceProfile(
        [],
        input.consequences,
        input.sessionId,
        input.sessionSeq,
        true,
      ),
      divergenceFlags: [],
    };
  }

  const boundary = existing.lastSeenAtSession !== input.sessionId;

  const profile = mergeConsequenceProfile(
    existing.consequenceProfile,
    input.consequences,
    input.sessionId,
    input.sessionSeq,
    boundary,
  );

  return {
    ...existing,
    lastSeenSeq: input.sessionSeq,
    lastSeenAtMs: input.generatedAtMs,
    lastSeenAtSession: input.sessionId,
    occurrenceCount: boundary
      ? existing.occurrenceCount + 1
      : existing.occurrenceCount,
    sessionsSinceSeen: 0,
    status: 'active',
    consequenceProfile: boundConsequences(profile),
    divergenceFlags: profile
      .filter((c) => c.status === 'diverged')
      .map((c) => c.identity),
  };
}
