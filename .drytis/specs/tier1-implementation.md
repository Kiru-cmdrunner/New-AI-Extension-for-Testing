# Tier 1 Implementation Spec: C1, C2, C3, D1

## Goal
Unblock ALL single-element data-input interactions by restoring 4 designed-but-never-wired data flows through the capability pipeline.

## Changes in dependency order

### C1: sourceInteractionType on ObservedTransition
- Add `sourceInteractionType: InteractionType | null` to `ObservedTransition` + `CreateObservedTransitionInput`
- Populate from `ci.type` in `domain-adapter-v2.ts`
- Pass through in `buildStandaloneAction` instead of hardcoded `null`

### C3: domAttributes Record from typed DomContext fields
- In `domain-adapter-v2.ts`, replace reading non-existent `domContext.domAttributes` with building Record from typed fields

### C2: businessField from accessibleName + displayLabel
- Add `resolveBusinessField(identity)` function
- Add `displayLabel` to `LogicalAction`, `CapabilityInput`
- Pass `elements: readonly UiElement[]` to AggregationInput
- `buildStandaloneAction` resolves businessField from elements map

### D1: Wire standalone enrichment
- Covered by C1 + C2 changes to buildStandaloneAction

## Acceptance Criteria
- [ ] sourceInteractionType populated for all 23 InteractionTypes
- [ ] domAttributes non-empty for elements with validation attributes
- [ ] businessField = accessibleName for standalone data-input interactions
- [ ] displayLabel preserved on LogicalAction and CapabilityInput
- [ ] CapabilityCandidate.inputs non-empty for login form
- [ ] All 3241 existing tests pass
- [ ] Real extension produces capability with inputs
