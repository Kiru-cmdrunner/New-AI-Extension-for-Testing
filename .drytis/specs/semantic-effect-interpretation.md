# Semantic Effect Interpretation — Effect Rules + Confidence Engine

## Scope

Immediate phase only: pure-function interpretation engine. No SW integration, no UI, no Capability Model.

## Files

- `src/semantics/effect-types.ts` — SemanticEffect, EffectCategory, Confidence, ConfidenceBasis, AffectedTarget
- `src/semantics/interpretation-context.ts` — InterpretationContext
- `src/semantics/effect-rules.ts` — 7 rule functions + helpers
- `src/semantics/effect-interpreter.ts` — interpret() orchestrator
- `tests/semantics/fixtures.ts` — test data builders
- `tests/semantics/effect-rules.test.ts` — per-rule unit tests
- `tests/semantics/effect-interpreter.test.ts` — integration tests

## Decisions

1. `unclassified` fires ONLY when effects.length === 0 AND mutations exist. Not when some mutations are unexplained alongside a matched rule.
2. `visibility-change` fires ONLY for `endReason='element-removed'`. No "appeared" inference from childList.
3. `no-observable-effect`: HIGH for completed window, LOW for early-close.
4. Direct property rules (aria*/checked/disabled): always HIGH, noise-immune.
5. Structural rules: MEDIUM baseline, degrade to LOW on noise/early-close.
6. Multi-target aggregation: ≤5 distinct paths = individual effects, >5 = one aggregated effect.
7. MAX_DISTINCT_PATHS = 5.

## Confidence Matrix

| Rule | Completed+Clean | +Noise | +EarlyClose | +Both |
|---|---|---|---|---|
| state-toggle | HIGH | HIGH | HIGH | HIGH |
| expand-collapse | HIGH | HIGH | HIGH | HIGH |
| enable-disable | HIGH | HIGH | HIGH | HIGH |
| content-change (≤5 paths) | MEDIUM | LOW | LOW | LOW |
| content-change (>5 paths) | LOW | LOW | LOW | LOW |
| visibility-change | MEDIUM | LOW | LOW | LOW |
| no-observable-effect | HIGH | HIGH | LOW | LOW |
| unclassified | LOW | LOW | LOW | LOW |

## Acceptance Criteria

- [ ] effect-types.ts defines all types
- [ ] interpretation-context.ts defines InterpretationContext
- [ ] effect-rules.ts implements all 7 rules as pure functions
- [ ] effect-interpreter.ts implements interpret() orchestrator
- [ ] All per-rule unit tests pass (54 tests)
- [ ] All integration tests pass (14 tests)
- [ ] Full regression: 3,470 baseline + ~68 new = ~3,538, 0 failed
- [ ] Zero existing files modified
