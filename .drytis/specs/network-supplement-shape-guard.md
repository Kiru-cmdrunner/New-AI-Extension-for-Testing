# Spec: Network-Supplement Shape Guard (evidence replace destroys target identity)

**Date:** 2026-08-18
**Status:** Approved for implementation (read-only RCA reported and approved)
**Scope guard:** Click and subsequent Navigation remain SEPARATE interactions — no merging, removal, or rewriting of either event anywhere in this change.

## Problem

`scheduleLateNetworkReCollect()` (G3, `src/tap/evidence-collector.ts` ~:1339–1386)
delivers a **display-only network supplement** ~1s after every lifecycle-finalized
window: hardcoded `targetEvidence: null`, `durationMs: 1000`,
`endReason: 'stabilized'`. The design intent is that this supplement only
enriches the NETWORK rows of evidence already delivered.

`attachEvidenceToInteraction()` / `tryAttach()` in `src/runtime/sw-integration.ts`
classifies a supplement via `isNetworkSupplement()`, which requires
`scoreEvidenceRichness(incoming) <= 2`. Score counts network entries at ×2, so:

- 1 entry → score 2 → recognized → merged (correct).
- **34 entries (iPhone add-to-cart XHR burst) → score 68 → NOT recognized** →
  falls into the richness-REPLACE branch → `interaction.behavioralEvidence` is
  replaced by the supplement whose `targetEvidence` is `null` → Side Panel shows
  "No target evidence available", window "1000ms / stabilized", network 34.

Real AJAX clicks (accordion buybox, dynamic controls) lose their target
identity/evidence. Form-submit flows (Vivo shape) are unaffected only because
the page reload kills the G3 timer before it fires.

The RCA confirmed: no product/Vivo/iPhone-specific logic exists or is needed;
the defect is purely the score-based supplement classification.

## Fix (smallest, generic)

`src/runtime/sw-integration.ts` ONLY — `evidence-collector.ts` untouched:

1. `isNetworkSupplement()` classifies by **structural shape**, regardless of
   entry count: network-only ⇔ `!targetEvidence` AND all other
   applicationEvidence arrays empty AND `networkActivity.length > 0`.
2. `tryAttach()` replace branch gains a **target-preservation guard**: an
   incoming evidence with `targetEvidence == null` must NEVER replace an
   existing evidence that has `targetEvidence`. (Belt-and-braces for any other
   synthetic/derived producer with a null target.)

`mergeNetworkEvidence()` already dedups by requestId — unchanged.

## Acceptance criteria

- [ ] A 34-entry network-only supplement merges its rows into existing
      evidence and does NOT replace `targetEvidence` (iPhone reproduction).
- [ ] A 1-entry supplement still merges (old behavior preserved).
- [ ] Existing evidence's `window` (duration / endReason) is preserved when a
      supplement merges — no `1000ms / stabilized` replacement.
- [ ] Richer REAL evidence (with target) can still replace weaker real
      evidence (drainPendingEvidence richness semantics unchanged).
- [ ] Null-target evidence never replaces evidence carrying a target, even if
      its raw richness score is higher.
- [ ] Click and Navigation remain separate interactions (no lifecycle/ledger
      changes; tests assert both interactions coexist).
- [ ] D2/D3 element harvesting intact — harvest reads `interaction.trigger`,
      unaffected by `behavioralEvidence`; suite stays green.
- [ ] No product-name/URL/DOM-structure special cases introduced.
- [ ] `tsc --noEmit` clean; full suite green.
- [ ] Real Chrome AJAX accordion Add-to-cart: click retains Target Evidence
      identity + state diff + merged NETWORK rows; endReason not `stabilized`.
- [ ] Real Chrome form-submit/reload Add-to-cart (Vivo shape): post-nav BODY
      evidence still captured; reload path unregressed.
- [ ] Zero console errors in both Chrome runs.

## Tests

New `tests/runtime/network-supplement-shape-guard.test.ts` (red phase first):
structural classifier unit tests; attach path: 1-entry merge, 34-entry merge
(the iPhone failure), identity preservation, window preservation,
target-preservation guard, real-evidence richness replace still works.

## Out of scope

- `evidence-collector.ts` (G3 producer, targetEvidence:null by design).
- Lifecycle/disposition/ledger logic.
- E1, executor-content-script defect, preview-URL defect, D2/D3 harvest code.
