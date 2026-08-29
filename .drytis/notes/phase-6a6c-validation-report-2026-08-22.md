# 6A+6C Working-Tree Validation Report (2026-08-22 00:15-01:00 UTC)

Context: unannounced 6A+6C implementation discovered in working tree on top of
committed 568adfe (6D.0). Owner ordered full validation before any further
change. No code modified during this validation (scratch probes removed).

## Provenance (resolved)
- Spec on disk (32,480 B, mtime 23:56 → formalized between 23:56 and the
  implementation window) contains §0 owner-review verdicts, §2.1-§2.5 designs,
  §3b P11, pins P1-P11 (§6), §6a pre-implementation real-Chrome baseline
  (12 PASS / 3 FAIL recorded at 568adfe dist). My 23:41/23:55 addenda intact
  (§ Stage 1 addendum, § Semantic Observation Contract).
- Conclusion: this is the output of the owner-reviewed spec + TDD process from
  the compacted turn window (23:56-00:11), NOT foreign/uncontrolled code.
- The "5-file floor / default-off / gated Stage 2-3" constraints I recalled
  were from my 23:13 minimal proposal; the owner's subsequent five-question
  review (§0) superseded them into the approved full design. Reviewer Q1 WARN
  resolves to: spec-compliant, constraints superseded by recorded review.

## Test evidence
- Full suite: 229 files / 4,162 tests PASS (baseline 568adfe: 221/4,091 — all
  6D.0 pins; net +8 files / +71 tests, all new 6A/6C pins green).
- Targeted 8 new files: 71/71.
- Real-Chrome matrix (this validation, on the 17:06 dist build):
  multipattern 14 PASS / 1 FAIL (the FAIL = stale bug-witness check demanding
  the OLD broken TextEntry shape; witness absent because 6C FIXED the bug);
  clone audit 21/1 (identical to 6D.0 and clean-b31d6c2 baselines — cart
  counter evolution heuristic, pre-existing); int47-probe 8/8 (Premium Economy
  still Click); ZIP-E2E Fix A 5/5; Amazon 8/8; PaxAndClass 17/17.
- E2E chain proof (fresh dumps): classic Click card rs items = [(collection,
  changed-element-seed, n=2)]; IR: fill #q → equality('invoice','value') on
  COMMITTED state; click → count(#results > *, 2) — seeded observation
  derived into assertion. Generated spec contains expect.soft toHaveValue.

## Confirmed defects (pre-existing in the unannounced implementation)
1. E9 / ladder rung 7 VIOLATED (independently reproduced, classification
   layer): class-only element "02h"→"02h 30m" (div.trip-duration, no id/attr)
   yields candidateKinds [counter, notification, status-badge] → pickSeedKind
   → notification. No identity-coordinate gate exists. Consequence: fabricated
   notification observations enter resultingState (→ side panel + KR
   extractor); derivation refuses them (locator tier none) so NO wrong
   assertions — observation-layer honesty violation, bounded.
2. Mixed-numeral demotion (independently reproduced): span#cart "4 items"→
   "5 items" → candidates [counter, notification, status-badge] →
   pickSeedKind guard (counter requires NOT notification AND NOT status-badge)
   → notification. Real-world counters ("5 items") get presence-only instead
   of count assertions. Contract-intent regression, bounded.
3. Reviewer-confirmed WARNs: anchor-less (attribute/childList) seeds resolve
   siblings[0] without ambiguity skip; skeleton rung-0 narrowed from class to
   text; stamp helper duplicated instead of refactored; spec Pins ⑧ (display)
   and ⑨ (KR round-trip) MISSING; O6-STOP path unpinned; unrelated
   consequence-settling.test.ts riding in changeset.

## Verdict
KEEP the implementation; fix defects 1-2 + missing pins ⑧⑨ before commit;
split out the unrelated test file. No rollbacks warranted (protected-test
edits proven legitimate by reviewer's stash experiment; P11 evidence-backed;
all six protected flows re-verified green).
