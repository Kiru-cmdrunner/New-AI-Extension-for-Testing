# Critical Architecture Assessment: Should the Capability Model Move Earlier?

**Date:** 2026-07-29
**Question:** Are component identity, session identity, surface identity, and lifecycle all attempting to infer what capability the user is exercising? Would more lifecycle heuristics just postpone a problem the Capability Model is designed to solve?
**Status:** Assessment only — no roadmap changes proposed

---

## Executive Summary

**No — accelerating the Capability Model would not resolve the Adani One issues.** The problems are foundational observation-layer failures, not semantic-layer gaps. The Capability Model operates post-recording on already-captured interactions; it cannot fix interactions that were never captured, captured with the wrong trigger, or cross-wired to the wrong session.

However, the investigation does reveal that **some lifecycle heuristics we're tempted to build are Capability Model concerns masquerading as observation-layer logic**. The distinction matters and determines what work belongs in Phase 0 vs. Phase 2+.

---

## The Core Distinction: Observation vs. Interpretation

The architecture enforces a strict boundary:

```
EventTap → Component Runtime → ComponentInteraction[] (OBSERVATION)
                                        ↓
                    V1/V2/Reasoner → SemanticInteraction[] (OBSERVED SEMANTICS)
                                        ↓
                    Capability Deriver → CapabilityCandidate (INTERPRETED CAPABILITY)
```

The Capability Model (Phase 2+) operates on `SemanticInteraction[]` — **already-captured, already-classified interactions**. It answers "what business capability did this recording session exercise?" by pattern-matching on the sequence of interactions. It is a **consumer of observations**, not a **producer of them**.

The Adani One problems occur in the **observation layer** — specifically in the Component Runtime, which is responsible for producing `ComponentInteraction[]`. These failures mean the raw material the Capability Model would later consume is wrong:

- **Missing interactions** (Trip Type change not captured) → no interaction to interpret
- **Cross-wired interactions** (Cabin Class attributed to Trip Type trigger) → wrong observation fed to the capability deriver
- **Stale labels** ("From - DEL" when user typed Chennai) → wrong element identity persisted
- **Duplicate interactions** (same selection twice) → inflated interaction count, confusing capability derivation

**No amount of capability model sophistication can fix these.** The Capability Model would produce wrong capabilities because it would be deriving from wrong observations. This is the "garbage in, garbage out" principle.

---

## Answering Each Question

### Q1: Are component identity, session identity, surface identity, and lifecycle all attempting to infer what capability the user is exercising?

**No. They are attempting to correctly observe what the user DID, not interpret what they MEANT.**

The distinction is critical:

| Layer | Question It Answers | Example |
|-------|---------------------|---------|
| Component Identity | "Which DOM element did the user interact with?" | "The user clicked the 'Premium Economy' option inside the cabin class popover" |
| Session Identity | "Which lifecycle does this event belong to?" | "This click completes the Cabin Class dropdown session, not the Trip Type session" |
| Surface Identity | "Which popover/overlay was open?" | "The cabin class popover was open, not the trip type popover" |
| Lifecycle | "When did this interaction start and end?" | "The user opened the dropdown at T+2s, selected at T+4s, the popover closed" |

None of these ask "what was the user trying to accomplish?" — that's the Capability Model's question. The observation layer answers "what physically happened in the DOM?" — a prerequisite fact, not an interpretation.

The Adani One failures are **observation correctness** failures: the recorder observed the wrong thing, not the wrong interpretation of the right thing.

### Q2: Would implementing more lifecycle and surface-management logic simply postpone a problem the Capability Model is intended to solve?

**Partially yes — but the postponed problem is different from the one causing the Adani One failures.**

There are two separate concerns that surface identity and lifecycle management could address:

**Concern A (Observation correctness — the Adani One problem):**
"Is this click inside THIS dropdown's popover or THAT dropdown's popover?" This is a factual question about DOM structure at capture time. The Capability Model cannot answer it because it runs post-recording — the DOM state is gone. This MUST be solved in the observation layer.

**Concern B (Semantic grouping — the temptation):**
"Should these three interactions (open dropdown → select option → click Done) be treated as one logical 'configure cabin class' action?" This IS a capability-level question. Building lifecycle heuristics that try to answer it in the observation layer would indeed be postponing Capability Model work.

The risk is real: if we build increasingly sophisticated surface-management logic that tries to group interactions semantically (e.g., "these three clicks are one cabin-class configuration"), we're doing capability inference at the wrong layer. The SemanticInteraction boundary exists precisely to prevent this — `componentSessionId` and `surfaceContext` are observation facts, not semantic groupings.

**The principle:** Surface identity should answer "which popover was open?" (factual), not "what was the user configuring?" (semantic). The former is observation; the latter is capability.

### Q3: Should some of this work move earlier in the roadmap, or does it still make sense to stabilise the current recorder first?

**Stabilise the observation layer first. The Capability Model depends on correct observations.**

The dependency chain is:

```
Phase 0a (dead code removal)
    → Phase 0b (type unification — SemanticInteraction needs correct ComponentInteractions as input)
        → Phase 0c (classifier consolidation — V1/V2 merge needs correct session boundaries)
            → Phase 0d (SemanticInteraction materialization — the 22-field contract includes surfaceContext and overlayContext)
                → Phase 1 (persistence — SemanticInteraction[] must be queryable)
                    → Phase 2 (Capability Model — composes from SemanticInteraction[])
```

The Capability Model (Phase 2) is five phases removed from the observation layer. If Phase 0b produces incorrect SemanticInteractions (because the Component Runtime cross-wires dropdown sessions), then:
- Phase 1 persists wrong data
- Phase 2 derives wrong capabilities
- Phase 3 generates wrong IR plans from wrong capabilities
- Phase 4 generates wrong tests

Every downstream phase amplifies the error.

**What should move earlier:** The **surface-bound session identity** concept I recommended in the investigation. This is NOT capability work — it's observation correctness work. The SemanticInteraction contract already has `surfaceContext` (field 13) and `overlayContext` (field 10) as observation fields. The Component Runtime needs to produce correct values for these fields. That's Phase 0 work, not Phase 2 work.

**What should NOT move earlier:** Capability-aware recording (having the runtime know "the user is configuring cabin class" and use that knowledge to guide capture). This would violate the observation/interpretation boundary and couple the recorder to capability semantics.

### Q4: If we accelerated the Capability Model, would it naturally resolve some of the current Adani One issues?

**No. Here's why for each issue:**

| Adani One Issue | Would Capability Model Fix It? | Why Not |
|-----------------|-------------------------------|---------|
| Trip Type change not captured | No | The interaction was never observed. The Capability Model operates on observed interactions — it can't infer an interaction that was never captured. (Future AI analysis could hypothesize it, but that's a different, unreliable path.) |
| Passenger count not captured | No | Same reason — missing observation, not missing interpretation. |
| Cabin class attributed to Trip Type trigger | No | The Capability Model would receive a Dropdown interaction with trigger="One Way" and selectedValue="Premium Economy". It would derive a capability like "Select Premium Economy from One Way" — wrong, because the observation is wrong. |
| Inconsistent capture (sometimes works, sometimes not) | No | The Capability Model would see different interactions on different recordings of the same flow. It would either create different capabilities (fragmentation) or fail to match (low confidence). The root cause is timing-dependent observation failure. |
| Duplicate date picker entries | No | The Capability Model would see two identical DatePicker interactions. It can't know they're duplicates of one action — both look like valid observations. |
| Stale field labels ("From - DEL") | No | The Capability Model would use the stale label as the field name. The capability would reference "From - DEL" when it should be "From - Chennai". |

**The Capability Model is not a remedy for observation-layer failures. It is a consumer of observations. Its value depends entirely on observation quality.**

---

## The Real Risk: Building Capability Logic at the Wrong Layer

The investigation did identify a genuine risk: some of the lifecycle heuristics we're tempted to build ARE premature capability inference. Specifically:

### What belongs in the observation layer (Phase 0):
- **Surface identity capture**: "Which popover was open when this click happened?" — factual, DOM-based, captured at event time
- **Session boundary disambiguation**: "Does this event belong to the Cabin Class dropdown session or the Trip Type dropdown session?" — determined by checking if the event target is inside THIS session's surface container
- **Stale label prevention**: "Re-extract accessibleName after React state flush" — capture-time accuracy
- **Post-click poll specificity**: "Only complete the session that was actually focused" — correctness of the synthetic change event

### What would be premature capability inference (should stay in Phase 2+):
- **Semantic grouping**: "These three interactions are one 'configure cabin class' action" — this is what the Capability Model does
- **Intent-based disambiguation**: "The user probably meant to select cabin class, not trip type" — this is interpretation
- **Cross-component relationship inference**: "The Done button confirms the cabin class selection" — this is capability structure

The surface-bound session identity I recommended is firmly in the first category. It answers "which DOM surface was this event inside?" — a factual question that can be answered at capture time by checking element ancestry. It does NOT require knowing what the user intended.

---

## Architectural Recommendation

**Do NOT accelerate the Capability Model. Stabilise the observation layer first.**

### Rationale

1. **The dependency is one-directional**: The Capability Model depends on correct observations. Correct observations do not depend on the Capability Model. Accelerating capabilities would build a sophisticated interpretation layer on top of a broken observation layer.

2. **The SemanticInteraction contract already has the fields**: `surfaceContext` (field 13), `overlayContext` (field 10), and `componentSessionId` (field 15) are designed to carry surface identity. The problem is that the Component Runtime doesn't populate them correctly. That's a Phase 0 fix, not a Phase 2 acceleration.

3. **The observation/interpretation boundary exists for good reason**: If the runtime starts making capability-level decisions during recording, it becomes coupled to application semantics. A change in how capabilities are defined would require changes to the recorder. The current boundary keeps the recorder generic (any SPA, any framework) and the capability model specific (business-level understanding).

4. **The engineering risk of accelerating is higher than the risk of waiting**: The Capability Model requires Phase 1 (persistent SemanticInteraction repository) which requires Phase 0d (SemanticInteraction materialization) which requires Phase 0c (classifier consolidation) which requires Phase 0b (type unification). Skipping ahead would mean building capabilities on a type system that's about to change, requiring a rewrite.

### What should change in the roadmap

**Nothing structurally.** The phase ordering is correct. But Phase 0b should explicitly include:

1. **Surface-bound session identity** — the Component Runtime must track which surface container a session belongs to and use it in `isInScope`
2. **Concurrent session resolution** — when a new session activates while another of the same type is active, resolve by checking surface containment
3. **Post-click poll specificity** — bind synthetic change events to the specific session, not a global `lastFocusedEl`

These are observation-layer correctness fixes that make the SemanticInteraction contract's `surfaceContext` and `overlayContext` fields actually correct. They are prerequisites for Phase 0d (materialization) because the 22-field contract includes these fields — if the runtime can't populate them correctly, the materialization is meaningless.

### Why not just tighten the CSS regex?

Tightening `DROPDOWN_TRIGGER_CLASS_RE` would reduce false positives but wouldn't solve:
- The concurrent session problem (two real dropdowns still conflict)
- The 15s timeout inconsistency
- The post-click poll race condition
- The stale label problem

These are lifecycle issues, not identification issues. The CSS regex should be tightened, but that's a secondary fix, not the primary one.

### The one thing the Capability Model WOULD help with (eventually)

Once the observation layer is stable, the Capability Model would add **cross-session consistency**: if the same Adani One flow is recorded twice and the observations are slightly different (one captured the Trip Type change, the other didn't), the Capability Matcher could detect this and flag the missing interaction. But this is a validation/comparison feature, not a capture-correctness feature. It requires the observations to be correct in the first place to be useful.

---

## Conclusion

The Adani One issues are **observation-layer failures** that the Capability Model cannot fix. The Capability Model is a consumer of observations, not a producer. Accelerating it would build interpretation on top of incorrect facts.

The correct path is: fix the observation layer (surface-bound sessions, concurrent session resolution, post-click poll specificity) as part of Phase 0b, then proceed through the roadmap as planned. The SemanticInteraction contract's `surfaceContext` and `overlayContext` fields are already designed to carry the information needed — the Component Runtime just needs to populate them correctly.

**The roadmap ordering is correct. Do not accelerate the Capability Model. Stabilise the observation layer first.**
