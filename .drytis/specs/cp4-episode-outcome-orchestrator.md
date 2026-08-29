# CP4 — Episode Outcome + Orchestrator (spec/repair)

Status: WIP inherited from a prior session; source design-conformant in
shape but never verified. This spec records the audited contract, the
repairs decided after the audit, and the acceptance criteria for CP4
verification. Governing docs: `.drytis/notes/handover-application-behavior-model.md`
(§4, §7, §8) + CP1–CP3 sources (verified).

## Modules

- `src/understanding/behavior-model/episode-outcome.ts` — pure member-vote
  merge mirroring `OutcomeDeterminer` semantics (class NEVER instantiated).
- `src/understanding/behavior-model/behavior-model.ts` — pure orchestrator:
  `buildEpisodes` (CP2) → `deriveCausalGraph` (CP3) → `deriveEpisodeOutcome`
  → `AppBehaviorModel` + `CoverageStats`. `sessionId`/`generatedAtMs`
  injected by caller (boundary C). No I/O, no clock, no input mutation.

## Contracts

### `deriveEpisodeOutcome(input: EpisodeOutcomeInput): EpisodeOutcome | null`

- `EpisodeOutcomeInput = { episode: ActionEpisode; memberOutcomes: Map<string, ActionOutcome>; degraded?: boolean }`
- Votes = each member's recorded `supportingEvidence` entries with
  `result ∈ {success, failure}`; `weight` is the determiner-assigned weight
  (no re-weighting). `unknown`-result evidence never votes.
- **null ⇔ NO member of the episode has a recorded ActionOutcome** (CP1
  type comment: "null while no member has an ActionOutcome"). At least one
  member has an outcome but zero counted votes → `outcome: 'incomplete'`,
  `confidence: 0`, `confidenceLevel: 'inconclusive'` (DDC-8: never
  fabricate; incomplete stays reachable, not dead code).
- Categorize mirrors `OutcomeDeterminer.categorize`: both sides > 0 and
  `min/max ratio > 0.3` → ambiguous; else stronger side; tie with votes →
  ambiguous; zero votes → incomplete.
- Confidence mirrors `OutcomeDeterminer.computeConfidence` exactly:
  success/failure → `min(1, winningSideSum)`; **ambiguous →
  `min(1, (successSum + failureSum) * 0.5)`**; incomplete → 0; degraded →
  ×0.5 when > 0. Rounded to 3 decimals; level via `confidenceToLevel`.
- `contributingMembers` = member ids with ≥ 1 counted vote, CER-5 sorted
  (deduped across votes). `derivation: 'derived-episode-outcome'`.
- `EPISODE_WEIGHTS` mirrors `outcome-determiner.ts` `WEIGHTS` (sum 3.1,
  pinned by tests; any determiner drift requires a mirrored update).

### `deriveBehaviorModel(input: BehaviorModelInput): BehaviorModelResult`

- `BehaviorModelInput extends Omit<EpisodeBuilderInput,'postNavRecords'>`
  plus injected `sessionId`, `generatedAtMs`, optional
  `actionOutcomes?: Array<{interactionId: string; outcome: ActionOutcome}>`,
  and CP3 extras (`postNavRecords` full shape, `stateTransitions`,
  `evidenceWindows`).
- Returns `{ model: AppBehaviorModel; unownedInteractionIds: string[]; warnings }`.
- **Episode `degraded` flag (DDC-5 mirror):** true when any evidence window
  *carried by an episode member (anchor included)* has
  `domChangeOverflow > 0`. This is the DDC-5 signal available in the CP3
  input subset (mainThreadBlocked/coarseMode are not carried). The flag
  halves the merged episode confidence via `deriveEpisodeOutcome`.
- `CoverageStats.memberInteractions` counts NON-anchor member interactions
  (deduped). `anchoredInteractions` = episode count (one anchor each).
  All other counters as in the WIP source (honest accounting).

## Audit findings → repairs (source vs. inherited WIP tests)

| # | Conflict | Resolution |
|---|----------|------------|
| A1 | Tests import `mergeEpisodeOutcome` (nonexistent) | Repair tests to `deriveEpisodeOutcome({episode, memberOutcomes, degraded})` (handover §4 preferred direction) |
| A2 | Tests pass `actionOutcomes: ActionOutcome[]`; input wants `Array<{interactionId, outcome}>` | Repair tests to wrap (source shape is the design-approved interface) |
| A3 | `episodeConfidence` returned 0 for `ambiguous`; determiner gives `min(1,(s+f)*0.5)` | **Source bug** — fix mirror; pin with tests (ambiguous 0.4/0.5 → 0.45) |
| A4 | Source returned null whenever votes empty → `'incomplete'` unreachable; contradicts CP1 comment + module docstring | **Source bug** — null ⇔ no member has an outcome; empty-vote outcomes → `incomplete` |
| A5 | Orchestrator `degraded` keyed on edge refs `capped-window` (edge-existence-dependent, not DDC-5-faithful, and contradicts canonical test's own 0.95) | **Source bug** — member-window `domChangeOverflow > 0` rule; canonical episode outcome becomes 0.95/2 = **0.475 / `inconclusive`** (destination window overflowed 176 mutations — DDC-5: degraded windows must not masquerade as clean) |
| A6 | `memberInteractions` counted anchors too (canonical expects 2, source computed 4) | **Source bug** — count non-anchor members |
| A7 | Canonical test expected view AND counter state edges from one transition; CP3's verified ref-uniqueness test pins the second is skipped (`ref-conflict-skipped`) | **Test bug** — expect exactly 1 state edge (view) + assert the ref-conflict warning |
| A8 | Determinism test impossible (module-level `seq` counter → different eventIds per run); malformed fixture placed outside every horizon yet expected as member | **Test bugs** — per-invocation fixture ids; malformed fixture moved inside the anchor horizon (CP2 epoch-bracket retention path) |

## Acceptance criteria

- [ ] `npx tsc --noEmit` exits 0.
- [ ] `episode-outcome.test.ts` green: signature contract, null vs
      incomplete, categorize ratio rule (incl. ratio = 0.3 boundary →
      stronger side), ambiguous confidence mirror (0.45), cap at 1,
      degraded halving (0.475), unknown-result ignored, CER-5
      contributingMembers, 3-decimal rounding, `EPISODE_WEIGHTS` pinned
      (sum 3.1 + each value).
- [ ] `behavior-model.test.ts` green: canonical Amazon workflow (episodes,
      membership, api T1 / navigation T2 latency 265 / entity T1 / single
      view state edge + ref-conflict warning / notification / 2 ui edges
      with capped-window on destination, all edges owned by ep-int-19,
      outcome success 0.475 inconclusive, coverage exact incl.
      memberInteractions 2, telemetry never claimed), no re-attribution,
      in-flight POST ownership, concurrent stamped rows, late evidence
      unattributed, malformed retained inside horizon, determinism,
      input immutability, empty session, no-outcomes → null.
- [ ] Full behavior-model suite green (CP1–CP3 regressions intact —
      115 pre-existing tests unmodified in behavior).
- [ ] Full project suite green (baseline 166 files / 3,323 tests).
- [ ] Same-input-twice determinism passing (deep-equal).
- [ ] Zero tracked files modified; nothing committed/pushed/built.

## Out of scope (unchanged invariants)

CP1–CP3 sources, capture/attribution/ledger, StateBuilder,
OutcomeDeterminer class internals (weight table mirrored only),
DISCRETE_ACTION_TYPES, confidence floors/caps, constant windows
(ATTRIBUTION_TAIL_MS etc.), determinism rules, R4 retention semantics.
