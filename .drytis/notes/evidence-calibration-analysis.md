# Evidence Calibration Analysis — Phase 1 Stabilization

## Methodology
23 diverse scenarios across 10+ domains. All classify correctly (0 misclassifications).

## Generator Fire Rates (by frequency)
| Generator         | Fire Rate | Avg Weight | Assessment |
|-------------------|-----------|------------|------------|
| checked-transition| 39%       | +0.60      | ✅ Healthy — fires for all toggle scenarios |
| tag-anchor        | 30%       | +0.40      | ✅ Healthy — sole signal for plain links |
| class-checkbox    | 26%       | +0.20/-0.20| ✅ Useful — disambiguates filter links |
| aria-checked      | 26%       | +0.80      | ✅ Strong — 6/9 toggle wins |
| native-checkbox   | 13%       | +0.90      | ✅ Correct — native inputs |
| aria-pressed      | 4%        | +0.70      | ✅ Rare but correct |
| opens-new-tab     | 4%        | +0.70      | ✅ Rare but correct |

## Critical Issue
**8/8 trigger (Click) scenarios have 0.0 confidence.** No generator votes for 'trigger'.
It wins only as the silent default fallback. This means:
- Empty audit trail for ~35% of interactions
- Zero confidence reported for all button/action clicks
- Any stray weak signal could override trigger (e.g., a button with a checkbox-like CSS class)

## Fix
Add `triggerEvidence` generator: votes 'trigger' +0.3 when element has button-like semantics
(tag=BUTTON, role=button, INPUT[type=button/submit/reset]). Weak enough to be overridden
by aria-checked (+0.8) or checked-transition (+0.6), but gives triggers a baseline confidence
and audit trail.

## Weight Calibration Assessment
Current weights are well-calibrated — 0 misclassifications. No changes to existing generators.

## Confidence Distribution (Before Fix)
| Range       | Count | Notes |
|-------------|-------|-------|
| 0.00        | 8     | ⚠ All trigger cases (will improve to 0.3) |
| 0.01-0.30   | 0     | |
| 0.31-0.60   | 6     | Navigate via tag-anchor (0.4), toggle via transition (0.6) |
| 0.61-0.80   | 1     | aria-checked alone (0.8) |
| 0.81-1.00   | 8     | Multiple toggle signals combining |
