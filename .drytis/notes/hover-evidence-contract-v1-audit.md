# Hover Capture-Time Evidence Contract v1 — root-cause audit + spec pointer

**Date:** 2026-08-30 · **Branch:** `capability-surgical-removal` · **Status:** spec **rev 2.1, DECISIONS LOCKED — implementation-ready**, awaiting final owner approval. NO code written.

## Spec
`.drytis/specs/hover-capture-evidence-contract-v1.md` (679 lines, rev 2.1) — AC-1…AC-28, real-Chrome matrix (13 rows), 10 new unit pins, integration plan.

## Rev 2.1 final audit results (all PASS)
- **Chain coherent:** mouseenter → CANDIDATE (D-HEC-8, §0) → T1b baseline at enter (§4) → NEW target-local T3 transition (§4) → frozen verdict + deterministic reason at window close (§5, R-Q1–R-Q9) → STOP projects only (§9). No stage rewrites history; no thresholds anywhere.
- **Services→Book Flight:** §5b R-I1…R-I6 + AC-22 + matrix 2b + unit pin 7 — two independent interactions, no absorption either direction, generic structural guarantee, order preserved.
- **Decisions locked & propagated:** D1 nav never earns (never-qualify list + matrix row 9 + AC-26); D2 legacy ⇒ gesture-only, no fallback (R-Q9 + AC-27); D3 reason ≤200 chars deterministic (R-Q7 + AC-28). Zero open markers.
- **Preserved contracts** §10 table intact (CQ v1.2, B6/B6.1, B7-P1…P5, P3/P4, R-1, F-5, M5); §16 prohibitions intact.

## Rev 2 additions (user-mandated)
- Candidate doctrine D-HEC-8; T1b enter-time baseline (owned-surface state attrs + membership; T1b-R transition rule: from=baseline, to=window); never-qualify expanded (pre-existing visible, already-open, unrelated mutations).
- §5b R-I1…R-I6 independence case; §9b D-HEC-9 universal evidenceDisclosures (available flags + honest counts for domChanges/visibilityChanges/newSurfaces/collections/counters/network/navigation; presentation-only).

## Root causes (read-only trace, verified line refs)
- **RC-A** `hover.ts:99` unconditional click terminal + `component-runtime.ts:431-448` `!handled` guard skips memberEvents.pop → click stays Hover member, ledger row Hover-claimed (`absorbed→claimed` terminal, irreversible).
- **RC-B** `event-tap.ts:245-260` enter uses `resolveHoverTarget`, click uses `resolveTarget` — divergent anchors → Hover+Click pair that never joins.
- **RC-C** `evidence-collector.ts:536-547` companion suppression → consuming click gets no own evidence window; its consequences become the hover's admission evidence.
- **RC-D** `projection-engine.ts:317-342` `coveredEventIds` built pre-admission → dropped Hover suppresses the click's twin → click has no carrier.
- **RC-E** `output-adapter.ts:67-178` STOP-time `deriveConsequenceClasses` admission — page-global insertion/removal qualifies Hover; pure-CSS reveals yield nothing.
- **RC-F** `ir-bridge.ts:98` NOISE_TYPES drops Unclassified from IR — documented, out of scope.

## Core design
Capture-time `HoverQualification {verdict, evidenceClass, evidenceReason (deterministic ≤200 chars), anchorFacts{anchorKey, clickAnchorKey, resolution}, factSummary}` frozen at window close. T3 earning strictly target-local AND baseline-relative. Click precedence R-C1…R-C5 (click never Hover member/claim; unconditional pop for non-retaining defs on discrete events — B6/B6.1 safe since `handled` only OR-ed). HEC-G STOP self-consistency (AC-6). Dead seam revived: `understanding-badge.ts:123` evidenceReason.

## Next step (blocked on owner approval)
Implementation per §11 change map + §14 test plan; no code until approved.
