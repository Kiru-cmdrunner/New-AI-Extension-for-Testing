# Phase 3 — Behavioral Recognition (Tier 2)

> **Objective:** Validate that `ObservedTransition` and the component lifecycle model
> naturally support behavioral recognition — recognizing components through observed
> interaction sequences and DOM mutations when ARIA structure is absent.
>
> **Architecture constraint:** The implementation must remain generic, evidence-driven,
> and pattern-driven. No component-specific logic in the recognizer itself.
> Three foundational entities must remain sufficient.

## Problem

Many real-world UIs use `<div>` and `<span>` with CSS classes instead of ARIA roles.
A Bootstrap dropdown, a jQuery datepicker, a custom modal — all produce recognizable
behavioral patterns even without semantic roles. These cannot be recognized by Tier 1
(structural) but produce observable evidence:

1. Click trigger → mutation shows a popup became visible
2. Popup contains clickable children (options)
3. Click on child → trigger's text/value changed
4. → Recognize: this is a dropdown

## Design: Behavioral Signatures

Each pattern defines a **behavioral signature** — a declarative set of evidence
conditions that, when met across a sequence of interactions, indicate the pattern.

### Signature structure

```typescript
interface BehavioralSignature {
  // The sequence of evidence conditions that must be satisfied (in order).
  conditions: SignatureCondition[];

  // How many conditions must match (all = full lifecycle, subset = partial).
  // If omitted, all conditions must match.
  minConditionsMet?: number;

  // Confidence assigned when all conditions match.
  fullMatchConfidence: number;

  // Confidence assigned when minConditionsMet (but not all) match.
  partialMatchConfidence: number;
}

interface SignatureCondition {
  // Unique condition ID for tracking which matched.
  id: string;

  // Human-readable description of what this condition checks.
  description: string;

  // What evidence type this condition requires.
  signal: EvidenceSignal;

  // Optional: which transition operation triggers this check.
  // If null, any operation can satisfy.
  expectedOperation?: TransitionOperation;

  // Optional: minimum number of times this signal must be observed.
  minOccurrences?: number;
}

type EvidenceSignal =
  | 'childElementBecameVisible'   // A child element appeared via DOM mutation
  | 'childContainsClickableElements' // The visible child has clickable descendants
  | 'triggerValueChanged'         // The interacted element's value/text changed
  | 'triggerStateChanged'         // checked/expanded/selected flipped
  | 'popupClosed'                 // A previously-visible element became hidden
  | 'siblingValueChanged'         // Another element in same parent changed value
  | 'elementBecameModal'          // Element appeared with modal-like behavior (overlay, focus trap)
  | 'groupMutualExclusivity';     // Selecting one element deselects a sibling
```

### How conditions map to ObservedTransition evidence

The behavioral recognizer receives a sequence of `ObservedTransition` objects
(ordered by timestamp) for the same root element or its DOM descendants. Each
condition is evaluated against the evidence fields on these transitions:

| EvidenceSignal | Evaluated from |
|---|---|
| `childElementBecameVisible` | `cascadeEffects` with effect=VISIBILITY, or `evidence` with type=MUTATION and description containing "visible"/"appeared" |
| `childContainsClickableElements` | Heuristic: presence of multiple sibling elements that received CLICK operations in the transition sequence |
| `triggerValueChanged` | `evidence` with type=VALUE_CHANGE on the root/trigger element |
| `triggerStateChanged` | `evidence` with type=STATE_CHANGE on the root/trigger element |
| `popupClosed` | `evidence` with type=MUTATION with description containing "hidden"/"closed", or STATE_CHANGE with expanded false→null |
| `siblingValueChanged` | `cascadeEffects` with effect=VALUE on a different elementId |
| `elementBecameModal` | `cascadeEffects` with effect=VISIBILITY + evidence MUTATION with "overlay"/"modal"/"backdrop" |
| `groupMutualExclusivity` | STATE_CHANGE evidence on element A + STATE_CHANGE cascade on element B (one checked, other unchecked) |

### Why this is generic

The recognizer does NOT contain any pattern-specific code. It:
1. Iterates patterns that have behavioral signatures
2. For each pattern, checks each condition against the transition evidence
3. Counts matching conditions, assigns confidence based on match ratio
4. Returns the best-matching pattern (or null)

Adding a new pattern's behavioral recognition is additive: register a signature
in the pattern catalogue. No recognizer code changes.

## V1 Behavioral Signatures

### Dropdown (custom, no ARIA)

```
Conditions (lifecycle: open → interact → close):
  1. childElementBecameVisible (operation: click)
  2. childContainsClickableElements
  3. triggerValueChanged (operation: select/click on child)
  4. popupClosed
fullMatchConfidence: 0.75
partialMatchConfidence: 0.50 (min 2 of 4)
```

### Modal (custom, no ARIA)

```
Conditions:
  1. elementBecameModal (operation: click)
  2. childElementBecameVisible
fullMatchConfidence: 0.70
partialMatchConfidence: 0.45 (min 1 of 2)
```

### Accordion

```
Conditions:
  1. triggerStateChanged (operation: click — expanded or class toggle)
  2. childElementBecameVisible
  3. popupClosed (on second interaction with same trigger)
fullMatchConfidence: 0.65
partialMatchConfidence: 0.45 (min 2 of 3)
```

### Radio Group (custom, no ARIA)

```
Conditions:
  1. groupMutualExclusivity (click on element A deselects sibling B)
  2. triggerStateChanged (operation: click)
fullMatchConfidence: 0.70
partialMatchConfidence: 0.45 (min 1 of 2)
```

### Checkbox (custom div, no ARIA)

```
Conditions:
  1. triggerStateChanged (operation: click — checked/selected flipped)
fullMatchConfidence: 0.65
partialMatchConfidence: N/A (single condition)
```

## Recognition Result

The behavioral recognizer returns the same `RecognitionResult` type as the
structural recognizer, but with `recognitionSource = RecognitionSource.BEHAVIORAL`.

If the best match is below threshold (no pattern reaches even partial confidence),
return NULL_RESULT (same as structural recognizer).

## Input Shape

```typescript
interface BehavioralRecognitionInput {
  // The element that triggered the interaction sequence.
  rootElementId: string;

  // All element IDs that are DOM descendants of the root (or the root itself).
  // Used to filter which transitions are relevant.
  relatedElementIds: string[];

  // Transitions observed on the root element and its descendants,
  // ordered by timestamp ascending.
  transitions: ObservedTransition[];
}
```

## Files

| File | Action | Purpose |
|---|---|---|
| `src/recorder/recognition/pattern-catalogue.ts` | Extend | Add `BehavioralSignature` type, add `behavioralSignature?` field to `PatternDefinition`, add signatures to existing patterns + add ACCORDION pattern |
| `src/recorder/recognition/behavioral-recognizer.ts` | Create | Generic Tier 2 recognizer |
| `tests/recognition/behavioral-recognizer.test.ts` | Create | Unit tests with real-world behavioral fixtures |

## Acceptance Criteria

- [ ] BehavioralSignature type defined in pattern-catalogue.ts
- [ ] PatternDefinition extended with optional behavioralSignature (additive)
- [ ] Behavioral signatures registered for: dropdown, modal, accordion, radioGroup, checkbox
- [ ] ACCORDION pattern registered in catalogue (structural + behavioral)
- [ ] behavioral-recognizer.ts exports `recognizeBehaviorally(input)` returning RecognitionResult
- [ ] Recognizer is fully generic — zero pattern-specific conditionals
- [ ] Returns RecognitionSource.BEHAVIORAL on match
- [ ] Returns NULL_RESULT when no pattern matches above threshold
- [ ] Confidence assigned from signature (fullMatchConfidence or partialMatchConfidence)
- [ ] All existing tests pass (no regressions)
- [ ] New test file covers: dropdown lifecycle, modal appearance, accordion toggle,
      radio group mutual exclusivity, custom checkbox toggle, noise rejection
- [ ] Tests use real-world-style fixtures (Bootstrap-style, jQuery-style patterns)
- [ ] No new core entities introduced

## Out of Scope

- ComponentRegistry (Phase 4) — this phase validates the recognizer in isolation
- ConstituentResolver (Phase 5) — relatedElementIds provided as input
- AI-assisted recognition (Tier 3) — stub only
- Integration with the live recording pipeline
- Recognition orchestrator (Phase 4 coordinates Tier 1 → Tier 2 → Tier 3)
