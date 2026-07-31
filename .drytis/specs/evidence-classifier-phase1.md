# Spec: Evidence-Based Intent Classifier — Phase 1

## Goal
Replace the ambiguous Link/Checkbox/Click decision in the classifier with an evidence-based intent classification engine. Unambiguous types (Navigation, DatePicker, Slider, etc.) stay on existing fast-path rules.

## Architecture (Refined)
- Evidence lives in `src/classifier/evidence/` — evolves the classifier in place, no new top-level package
- `FeatureView` is a lightweight facade over `ElementIdentity` + `DomContext` + event fields — no data duplication
- `fuseEvidence` is a pure function: `Evidence[] → IntentClassification`. One implementation, clear contract
- Intent is preserved as optional field on `DetectedInteraction` — type still derived and always present

## New Modules
```
src/classifier/evidence/
├── types.ts              # SemanticIntent, Evidence, IntentClassification, EvidenceGenerator
├── feature-view.ts       # FeatureView facade + extractFeatureView()
├── generators.ts         # All evidence generators + EVIDENCE_GENERATORS registry
├── intent-inference.ts   # fuseEvidence(Evidence[]) → IntentClassification
├── type-deriver.ts       # deriveType(intent, features) → InteractionType
└── evidence-classifier.ts # classifyByEvidence() orchestrator
```

## Integration Points
1. `src/classifier/interaction-detector.ts` — replace Link/Click/safety-net branches with evidence classifier delegation
2. `src/recorder/v2/interaction-recognizer.ts` — same delegation for V2 path

## Acceptance Criteria
- [ ] All 4,683+ existing tests pass (zero regressions)
- [ ] Amazon filter links (<a> with checked transition) → Checkbox
- [ ] Plain navigation links (<a> without checked signals) → Link
- [ ] Generic button/div clicks → Click
- [ ] Evidence trail is auditable on classified interactions
- [ ] Each new module has dedicated unit tests
- [ ] No new top-level package — evidence lives under src/classifier/
- [ ] DetectedInteraction gains optional `intent?` and `evidenceTrail?` fields (backward compatible)
