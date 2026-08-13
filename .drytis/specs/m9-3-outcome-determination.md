# M9.3 — Outcome Determination + Action/Outcome Relationships

## Scope
Correlate a user interaction with the resulting application changes to
determine semantic outcomes and build explicit action → outcome relationships.

## Files Created
- `src/understanding/outcome/outcome-types.ts` — Outcome types
- `src/understanding/outcome/outcome-determiner.ts` — Weighted-signal outcome determiner
- `src/understanding/outcome/relationship-tracker.ts` — Action-outcome relationship store
- `tests/understanding/outcome-determination.test.ts` — Focused tests

## Files Modified (additive only)
- `src/understanding/index.ts` — barrel exports
- `src/understanding/state-builder/state-builder.ts` — call outcome determiner (optional hook)

## No M1–M8 files touched.

## Architecture

### Outcome Determination
Each interaction is evaluated independently. The determiner collects weighted
votes from all available signals within the interaction's SignalSet + the
StateTransition delta (before vs after).

### Signal → Vote mapping
| Signal Type | Result Vote | Weight | Condition |
|---|---|---|---|
| ApiOperation succeeded=true | success | 0.4 | 2xx status |
| ApiOperation succeeded=false | failure | 0.5 | 4xx/5xx |
| Notification severity=success | success | 0.3 | appeared |
| Notification severity=error | failure | 0.4 | appeared |
| Counter numericDelta > 0 | success | 0.2 | expected direction |
| Counter numericDelta < 0 | failure | 0.2 | unexpected for add-type action |
| View change to confirmation view | success | 0.25 | cart-confirmation, order-confirmation |
| No signals at all | incomplete | — | empty SignalSet |

### Confidence levels
- 0.00–0.49: inconclusive → outcome = 'ambiguous'
- 0.50–0.69: possible
- 0.70–0.84: likely
- 0.85+: confirmed

### Outcome categories
- `success` — action achieved its goal
- `failure` — action failed
- `ambiguous` — conflicting signals, cannot determine
- `incomplete` — no evidence captured (0ms window)

### Relationship model
```
ActionOutcome {
  interactionId, actionType, actionTarget (accessibleName/label),
  outcome, confidence, supportingEvidence: OutcomeEvidence[],
  resultingEntities: string[], stateChanges: string[]
}
```

## Acceptance Criteria
- [x] Determiner produces an ActionOutcome per interaction
- [x] Success/failure/ambiguous/incomplete all handled
- [x] Confidence is computed deterministically from weighted votes
- [x] Supporting evidence recorded with provenance
- [x] Ambiguous outcome when votes conflict (success + failure both > 0)
- [x] Incomplete outcome when no signals present
- [x] Amazon Add-to-cart workflow produces 'success' with ≥2 corroborating signals
- [x] No outcome claimed without evidence (incomplete ≠ success)
- [x] No M1–M8 files modified
