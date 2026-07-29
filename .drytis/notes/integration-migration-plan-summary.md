# Integration Migration Plan — Summary

## 7 Stages, Each Producing a Working Extension

| Stage | What Changes | Old Code Still Used? | Rollback |
|-------|-------------|---------------------|----------|
| 1. Production Control Model | Extract validated algorithms to src/recorder/v2/ | Yes (all) | Delete dir |
| 2. New Content Script | Control Model capture replaces resolveTarget() | V1/V2 classifier | Toggle flag |
| 3. New Classifier | InteractionRecognizer replaces V1+V2+merge | Domain adapter | Toggle flag |
| 4. Domain Adapter | Simplified SemanticAction→Entity mapping | Enrichment+IR | Toggle flag |
| 5. Parallel Validation | A/B comparison: old vs new side-by-side | Both run | Toggle flag |
| 6. Cutover | Flag defaults to 'control', old code disabled | Dead code | Re-add to manifest |
| 7. Cleanup | Delete old recorder + classifier (4,870 lines) | Gone | Git revert |

## What Gets Replaced (4,870 lines)
- deterministic-recorder.ts (2,739) — capture layer
- interaction-detector.ts V1 (807) — classifier
- evidence/detector.ts V2 (80) — classifier
- evidence/engine.ts (534) — classifier
- evidence/merge-layer.ts (188) — merge
- evidence/combination.ts (154) — merge
- evidence/types.ts (168) — types

## What Stays Unchanged (5,500+ lines)
- generation/ir-bridge.ts (716) — IR plan generation
- domain/locator-ranking.ts (349) — locator quality
- adapters/playwright/* (~2,100) — code generation
- domain/entities/* (~1,500) — domain model
- sidepanel/* (~1,950) — UI
- storage/* — persistence

## What's New (~1,470 lines)
- recorder/v2/control-model.ts (~350)
- recorder/v2/identity-extractor.ts (~200)
- recorder/v2/framework-adapters.ts (~100)
- recorder/v2/event-tap.ts (~250)
- recorder/v2/interaction-recognizer.ts (~300)
- recorder/v2/control-recorder.ts (~150)
- recorder/v2/recognizer-adapter.ts (~120)

## Feature Flag
chrome.storage.local key `recorder_engine: 'legacy' | 'control'`
Checked at START_RECORDING (which CS to inject) and STOP_RECORDING (which
classifier to run). Toggleable between recordings without reload.

## Key Insight
Enrichment, IR bridge, and Playwright generation are NEVER replaced.
They receive better input data but their logic stays. The replacement is
scoped to capture + classify only.
