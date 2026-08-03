# B7.2 Design Clarification — Merge Eligibility Principle

**Type:** Implementation Design Clarification (no code)
**Status:** FROZEN
**Date:** 2026-07-15
**Scope:** Architectural separation of same-element detection from merge eligibility

---

## The Principle

The optimizer makes **two independent decisions** for every potential merge:

| Decision | Question | Responsibility |
|---|---|---|
| **Decision 1 — Same Element** | "Do these two interactions target the same logical element?" | Element-matching strategy (`isSameElement()`) |
| **Decision 2 — Merge Eligibility** | "Should these interactions actually be merged?" | Optimization rule (OR-1) |

**A "yes" on Decision 1 does not imply a "yes" on Decision 2.** The merge is performed only when ALL eligibility conditions are satisfied, one of which is same-element.

---

## OR-1 Complete Merge Conditions

The frozen B7.1 §4.2 already defines all conditions for OR-1. This document makes the two-decision architecture explicit by classifying each condition.

### Decision 1 — Same Element Detection

| Condition | Source | Implementation |
|---|---|---|
| Same logical element | B7.1 §4.2 validation condition | `isSameElement(clickStep.elementIdentity, textStep.elementIdentity)` — composite key (tag \| stableId \| cssSelector), per the Same Element Detection clarification |

### Decision 2 — Merge Eligibility Conditions

| # | Condition | Rationale | B7.1 Source |
|---|---|---|---|
| C1 | `clickStep.actionType === 'click'` | Only click events are candidates for focus clicks | §4.2 validation condition |
| C2 | `textStep.actionType === 'text'` | Only text-entry events are candidates for the primary action | §4.2 validation condition |
| C3 | **Adjacency** — text step immediately follows click step in the timeline (zero intervening steps) | If there are intervening interactions, the click was not a simple focus-then-type action | §4.2 validation condition: "no intervening events on different elements" |
| C4 | **Input element** — click target is an input/textarea/select element (tag-based check) | Clicking a non-input element (button, link, div) is a meaningful action, not a focus action | §4.2 "When NOT to apply": "The click target is NOT an input/textarea/select element" |

**All four eligibility conditions AND the same-element match must be satisfied.** If any single condition fails, no merge. The steps remain separate.

### How the Conditions Are Evaluated

```
// Decision 1: Same element?
if (!isSameElement(clickStep.elementIdentity, textStep.elementIdentity)) → NO MERGE

// Decision 2: Merge eligible?
if (clickStep.actionType !== 'click')           → NO MERGE    // C1
if (textStep.actionType !== 'text')             → NO MERGE    // C2
if (textStep.stepNumber !== clickStep.stepNumber + 1) → NO MERGE  // C3
if (!isInputElement(clickStep.elementIdentity.tag)) → NO MERGE    // C4

// All conditions satisfied → MERGE
```

---

## Addressing the User's Examples

### Example 1 — Same Element, Not Adjacent

```
Click Search Box
...
20 other interactions
...
Enter "John"
```

**Outcome: NO MERGE.** Decision 1 (same element) passes — both target the search box. Decision 2 fails on condition C3 (adjacency) — 20 intervening steps exist between the click and the text entry. The click was not a focus action for this text entry; it was a standalone interaction that happened to target the same element much later.

### Example 2 — Same Element, Different Execution Context

```
Click Username
Navigate to another page
Enter Username
```

**Outcome: NO MERGE.** Decision 1 may pass (same element identity on both pages). Decision 2 fails on condition C3 (adjacency) — the navigation event intervenes between the click and the text entry. The execution context has changed.

---

## Independence of the Two Decisions

The two decisions are architecturally independent and will remain so:

| Dimension | Decision 1 (Same Element) | Decision 2 (Merge Eligibility) |
|---|---|---|
| **What it answers** | Are these the same DOM element? | Should these steps be combined? |
| **Who implements it** | `isSameElement()` function | OR-1 rule logic |
| **What it inspects** | `ElementIdentity` fields only | `actionType`, `stepNumber`, element tag, adjacency |
| **Replaceable independently?** | Yes — swap the composite key for a fingerprint | Yes — add/remove eligibility conditions |
| **Future extensibility** | New element-matching strategies (fingerprint, UID) | New merge conditions (context equality, time window) |

### Future Merge Conditions

Additional eligibility conditions may be introduced in future optimization rules **without changing the element-matching strategy**. For example:

- A future rule might require "same page context" (no navigation between the two steps). This is a Decision 2 condition — it does not change how `isSameElement()` works.
- A future rule might require a time window (both interactions within 5 seconds). This is a Decision 2 condition.
- A future recorder might provide a stable element fingerprint. This replaces `isSameElement()`'s implementation — Decision 2 conditions remain unchanged.

### What the Optimizer Must Never Do

> **Merge interactions based solely on matching element identity.**

Same-element is necessary but not sufficient. The merge eligibility conditions (C1–C4) must all pass independently.

---

## Confirmation: No Deviation from Frozen Architecture

This clarification does not modify any frozen decision:

| Frozen Source | What It Says | This Clarification |
|---|---|---|
| B7.1 §4.2 validation conditions | Lists 4 conditions (same element, action types, adjacency) | Classifies them into two decisions — conditions unchanged |
| B7.1 §4.2 "When NOT to apply" | Lists 3 exclusion cases (different element, intervening events, non-input click target) | Maps to Decision 1 failure and Decision 2 failures — exclusions unchanged |
| B7.2 Same Element Detection clarification | Defines `isSameElement()` as composite key | Decision 1 implementation — unchanged |
| Product Foundation, B1–B6 | Pipeline, artifacts, execution model | Not affected — optimizer is internal to Canonical Step Generator |

**No new conditions are introduced.** No existing conditions are removed. This document makes the existing architecture explicit and confirms that the two decisions are — and always were — independent.

---

## Implementation Contract for B7.2

The OR-1 implementation must follow this structure:

```
function applyFocusClickTextEntryMerge(steps: CanonicalStep[]): CanonicalStep[]
{
  // Walk steps left to right
  // For each click step, check if the NEXT step is a text entry that should merge

  if (isInputElement(clickStep.elementIdentity.tag)    // C4: input element
      && nextStep.actionType === 'text'                // C2: text entry
      && nextStep is adjacent (index + 1)              // C3: adjacency
      && isSameElement(                                // Decision 1: same element
           clickStep.elementIdentity,
           nextStep.elementIdentity
         )) {
    // All conditions satisfied — merge
  }
  // Note: C1 (clickStep.actionType === 'click') is implicit —
  // we only check this when iterating over click steps
}
```

The function `isSameElement()` is called as one condition among several. It is never the sole condition.

---

*End of B7.2 Design Clarification — Merge Eligibility Principle*
