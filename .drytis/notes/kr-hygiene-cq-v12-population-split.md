# KR Hygiene — Click Qualification v1.2 population split (D3 companion note)

Required by `.drytis/specs/click-capture-qualification-v1.md` §13.3: the owner-accepted D3
ruling (no migration, no version bump, no anchoring change) requires a written record so
future divergence reads are diagnosable. Written 2026-08-29, after CQ v1.2 Step 1 + Step 2
landed (suite 5,096/5,096; real-Chrome matrices 10/10 facts, 20/20 behavior).

## 1. What changed on 2026-08-29

Before CQ v1.2, an event became `Unclassified` when it failed the Click definition's four
inclusion gates (isInteractiveElement → open-surface ancestry → auto-id →
pointer-cursor/onclick). After Step 2, an interaction becomes `Unclassified` for exactly
one reason: its capture-time verdict is `provably-invalid` (see
`src/tap/click-qualification.ts` — causes: `disabled-native`, `fieldset-disabled`,
`inert-subtree`, `hit-test-miss`, `pointer-events-none`, `aria-disabled`,
`disabled-attr-non-native`, joint-gated `zero-size-lifted`/`pointer-events-none`).

This is a VOCABULARY FLIP in what `Unclassified` means, not an app-behavior change. The
KR signature key embeds `actionType` (frozen D1: `appId|actionType|normalizedTarget|
anchorViewId` → FNV-1a), so the two populations never collide — they split.

## 2. Dormant population A — legacy "looks-uninteractive" Unclassified signatures

- **Origin:** sessions recorded before 2026-08-29 where a trusted click on a plain
  div / non-semantic element failed the inclusion gates and minted
  `actionType: 'Unclassified'` signatures (mostly via projection-minted cards; per-key
  keydowns likewise).
- **What happens now:** no new sessions mint this population (qualified plain-div clicks
  are `Click` since Step 2). Existing rows keep aging: `sessionsSinceSeen` grows each
  recording on that app origin. After `STALE_AFTER_SESSIONS = 10` the signature status
  flips to `stale`. Consequence entries on them hit `DIVERGENCE_AFTER_SESSIONS = 3` and
  flag `diverged` — flag-only, never deleted (CP6 doctrine: divergence means vocabulary
  changed, not app behavior).
- **Diagnostic signature:** a `Unclassified`-actionType signature whose last session predates
  2026-08-29 (compare `lastSeenAtMs` against this note's date) is dormant-by-flip. It is
  NOT evidence the app regressed. Do not "clean" it — eviction does not exist by design.

## 3. New population B — provably-invalid Unclassified signatures (empty profiles)

- **Origin:** projected invalid-click cards (`endState: completed`, trigger `click` /
  `contextmenu`, ledger row `pending`, `metadata.invalidityCauses` non-empty) are
  anchor-eligible (`ANCHOR_ELIGIBLE` is trigger-event-type keyed, unchanged), so they
  anchor episodes and mint `actionType: 'Unclassified'` signatures under the new meaning.
- **Expected shape:** permanently EMPTY consequence profiles, near-zero `occurrenceCount`
  growth per site, no `KnowledgeEdgeRow`s (see §4 — their evidence strands), no
  provenance links (click consumers join against surface FACTS; invalid clicks have none).
- **Why kept, not filtered:** the D3 ruling — capture guarantees say every trusted physical
  action is stored; filtering anchor-eligibility by invalidity would be a downstream
  re-classification layer, exactly what CQ v1.2 removes. The empty profile IS the honest
  record: "user clicked a provably-disabled control; nothing happened."
- **Deferred (V4 negative-knowledge decision):** whether these empty-profile signatures
  should eventually become first-class negative knowledge ("this control is dead") is an
  open owner decision. Until then they are a named accepted artifact.

## 4. Evidence stranding on invalid clicks (recorded behavior, mostly harmless)

An invalid click still opens an evidence window (`click` ∈ `WINDOW_OPEN_EVENTS`), and its
mutations still accumulate in the INV-C1 global buffer. But no live interaction claims the
event (the universal pre-gate stops all definitions), so `attachEvidenceToInteraction`'
s two-tier join (trigger eventId → member eventId) finds no tier-1/2 match → the delivered
`BehavioralEvidence` waits in `pendingEvidence` and is never attached. The Unclassified
card minted later at STOP projection therefore carries `behavioralEvidence: null`.

Consequences, all verified read-only 2026-08-29:
- No T4-window edges for invalid-click episodes (honest — the causal graph never sees a
  window for them). This is why §3's profiles stay empty.
- The stranded window's facts are NOT misattributed to other interactions: windows
  attribute via `sourceEventId` join, and the invalid click's `sourceEventId` has no live
  claimant. Facts merely drain into the global accumulator where the NEXT window's open
  may carry them — bounded by INV-C1 boundary clearing; adjacent-window inheritance
  is the already-documented Channel A / V3 family condition, unchanged by CQ.
- Network stamps on invalid clicks (`stampClass('click') = primary`, written before
  classification) attach to the ring keyed by the click's `sourceEventId`; with no live
  claimant they surface via the stop-drain as unattributed — the honest V1 floor.

## 5. Read rules for future sessions (the point of this note)

1. A `Unclassified` signature with `lastSeenAtMs` < 2026-08-29 → dormant population A.
   Ignore for behavior-change analysis; it CANNOT recur.
2. A `Unclassified` signature with `firstSeenAtMs` ≥ 2026-08-29 and empty
   `consequenceProfile` → population B (provably-invalid clicks). `invalidityCauses` on
   the episode's anchor card records WHY. Frequency of population B per app is a
   test-quality signal (dead controls being clicked), not an app-regression signal.
3. A `Click` signature with `firstSeenAtMs` ≥ 2026-08-29 includes plain-div / body
   click-away actions (B3 S4) that were previously `Unclassified` population A — the
   growth of `Click` occurrenceCount vs pre-flip sessions is expected and is the flip,
   not churn.
4. Divergence flags on population-A consequences after 3 sessions without re-observation
   are the vocabulary flip expressing itself — do not diagnose as app change.

## 6. Non-goals

No migration, no version bump, no eviction, no anchoring change, no IR change
(`NOISE_TYPES` still drops all `Unclassified` from IR under D2). This note changes no
code; it exists so the two populations are diagnosable from the store alone.
