# Semantic Preservation Audit — End-to-End Boundary Trace

**Status:** Assessment / audit result — NOT an approved design decision
**Date:** 2025-08-02
**Source:** Production source code (frozen baseline a59dc52)
**Scope:** Read-only analysis of the question: does the current architecture
satisfy the invariant that a correctly understood interaction (known semantic
type + novel implementation) can travel through the complete pipeline WITHOUT
requiring a hard-coded PatternDefinition?

---

## 1. The Invariant Under Test

**Invariant:** A correctly understood interaction — meaning one that the
ComponentRuntime + R3 evidence engine has successfully classified into a known
InteractionType — should be able to travel through the complete pipeline:

```
observation → semantic recognition → domain representation →
application understanding → capability knowledge
```

...WITHOUT requiring a hard-coded PatternDefinition for its specific control type.

If the architecture satisfies this invariant, then understanding a new
implementation of a checkbox does not require registering a new pattern — the
existing evidence-based classification suffices.

If the architecture does NOT satisfy this invariant, then PatternDefinition is
an unintended gate: understanding cannot reach capability knowledge without it.

---

## 2. Boundary-by-Boundary Trace

### Boundary 1: ComponentInteraction → UiElement/ObservedTransition

**What enters:** ComponentInteraction (type, identity, DomContext, evidence,
intent, confidence, evidenceTrail, lifecyclePhase, surface).

**What survives:**
- InteractionType → mapped to TransitionOperation (via
  domain-adapter-v2.ts InteractionType→TransitionOperation table).
- ElementIdentity → copied to UiElement.identity.
- Value transitions (fromValue, toValue) → copied to ObservedTransition.
- Tag, role → copied to UiElement.

**What is LOST:**
- **Validation constraints** (required, min, max, step, pattern, inputType,
  minLength, maxLength): Captured as individual DomContext fields but NOT
  aggregated into UiElement.domAttributes.
  domain-adapter-v2.ts:393–394 reads `firstEvent.domContext?.domAttributes`
  which is a Record<string,string> property that exists on the
  recorded-event.ts DomContext type but NOT on the component-types.ts
  DomContext type. The adapter reads a property that doesn't exist on the
  object it receives. UiElement.domAttributes is always `{}`.
  **Classification: A (implementation defect).**

- **R3 metadata** (intent, confidence, evidenceTrail): The annotated
  ComponentInteraction carries behavioral evidence from R3. These fields are
  not carried forward into UiElement or ObservedTransition. The downstream
  enrichment layer has no access to the R3 confidence or evidence trail.
  **Classification: C (architectural dependency) — enrichment must re-derive
  behavioral contracts from the raw interaction evidence, not from the
  annotated entity.**

- **ancestorRoles (full chain):** The DomContext captures up to 10 ancestor
  roles. The Domain Adapter extracts them into UiElement.ancestorRoles. BUT
  pipeline-runner.ts:109 passes only the target element's role to the
  recognition orchestrator (ancestorRoles: [roleInfo]), not the full chain.
  The full ancestor chain exists on the UiElement but is truncated before
  recognition.
  **Classification: A (implementation defect).**

- **componentId:** The Domain Adapter creates ObservedTransition but does NOT
  set componentId. assignToComponent() exists in ui-element.ts but is NEVER
  called in the production pipeline. All transitions enter the semantic
  aggregator with componentId=null.
  **Classification: A (implementation defect) — UNIVERSAL BLOCKER.**

**Does next layer require PatternDefinition?** No — the Domain Adapter and
UiElement/ObservedTransition are pure structural transformations.

**Can a behaviorally recognized interaction continue without one?** Yes, at
this boundary. The issue is data loss, not pattern dependency.

---

### Boundary 2: UiElement/Transition → Component Recognition

**What enters:** UiElement[] + ObservedTransition[] (with componentId=null,
ancestorRoles truncated, domAttributes empty).

**What survives:**
- UiElement identity, tag, role.
- Transition operation, values.
- Structural recognizer checks ARIA roles (Tier 1, confidence 0.95).
- Behavioral recognizer checks evidence patterns (Tier 2, confidence 0.50–0.75).

**What is LOST or BLOCKED:**
- **ancestorRoles truncation:** RADIO_GROUP pattern root is 'radiogroup'
  container. The radio button's target element alone (role='radio') won't
  match without the ancestor 'radiogroup' in the chain. The full chain exists
  on UiElement but is not passed.
  **Classification: A (implementation defect).**

- **Lifecycle mismatches (multiple):**
  - RadioButton → domain adapter maps to TOGGLE. RADIO_GROUP.expectedLifecycle
    = [SELECT]. isLifecycleComplete never matches. Radio groups stuck
    DEVELOPING.
    **Classification: A (implementation defect).**
  - Dropdown → adapter produces one transition with SELECT.
    DROPDOWN.expectedLifecycle = [CLICK, SELECT]. Single-transition adapter
    can't produce two operations. Dropdowns stuck DEVELOPING.
    **Classification: A (implementation defect).**
  - Checkbox → CHECKBOX behavioral signature expects expectedOperation='click'
    but adapter maps Checkbox → TOGGLE. Behavioral recognizer never matches.
    **Classification: A (implementation defect).**

**Does next layer require PatternDefinition?** YES — the Recognition Orchestrator
iterates over registered patterns. With only 6 patterns (DROPDOWN, CHECKBOX,
RADIO_GROUP, MODAL, TABS, ACCORDION), interactions of other types (Slider,
DatePicker, FileUpload, TextBox, etc.) have no pattern to match against and
receive no component-level recognition.

**Can a behaviorally recognized interaction continue without one?** NO — even
for the 6 types with patterns, lifecycle mismatches prevent CONFIRMED status.
For types without patterns, recognition is structurally impossible.

---

### Boundary 3: Recognition → ComponentGrouping → Enrichment

**What enters:** RecognizedComponent[] with lifecycle states.

**What survives:**
- Only CONFIRMED components pass to enrichment (enrichment-orchestrator.ts:74).
- TENTATIVE and DEVELOPING components are excluded.

**What is LOST or BLOCKED:**
- **CONFIRMED gating:** All components stuck at DEVELOPING (due to lifecycle
  mismatches above) never reach enrichment. Even if lifecycle mismatches were
  fixed, single-element interactions (checkbox toggle, slider change, text
  input) that don't form multi-element components have no pattern to match
  and never become CONFIRMED.
  **Classification: C (architectural dependency) — the enrichment layer is
  designed to operate on CONFIRMED components only. This is an intentional
  design choice that makes PatternDefinition a prerequisite for enrichment.**

**Does next layer require PatternDefinition?** YES — only CONFIRMED components
are enriched, and CONFIRMED requires pattern matching.

**Can a behaviorally recognized interaction continue without one?** NO — this
is the hard gate. Without a matching pattern that reaches CONFIRMED, no
enrichment occurs.

---

### Boundary 4: Enrichment → ApplicationKnowledgeFragment → LogicalAction

**What enters:** CONFIRMED ComponentGrouping (if any reach this stage).

**What survives:**
- LogicalAction is produced (semantic action description).
- InteractionContract is produced (but constraints null — see domAttributes defect).
- BehavioralContract is produced (behavioral evidence summary).

**What is LOST or BLOCKED:**
- **businessField is null:** Enrichment step 1 (deriveBusinessField) uses
  option-set-extractor.ts:124–128 which queries
  `inspector.querySelector(elementId)?.accessibleName`. In production,
  NoOpDomInspector is used, which returns null for all queries. BUT
  UiElement.identity.accessibleName already has the value. The function
  circumvents the entity and reads from a dead source.
  **Classification: A (implementation defect).**

- **InteractionContract.constraints null:** Because domAttributes is always
  `{}` (Boundary 1 defect), no required/min/max/step/pattern constraints are
  derived. InteractionContract is produced but carries no validation info.
  **Classification: A (implementation defect) — consequence of upstream
  domAttributes defect.**

**Does next layer require PatternDefinition?** Indirectly yes — enrichment
requires CONFIRMED which requires pattern matching. But the enrichment logic
itself does not query PatternDefinition.

**Can a behaviorally recognized interaction continue without one?** NO — must
pass through enrichment which requires CONFIRMED.

---

### Boundary 5: LogicalAction → CapabilityCandidate / CapabilityInput

**What enters:** ApplicationKnowledgeFragment (LogicalAction[], InteractionContract,
BehavioralContract, businessField).

**What survives:**
- CapabilityCandidate is produced (name, description, source types).
- CapabilityInput derivation is attempted.

**What is LOST or BLOCKED:**
- **All actions skipped:** capability-deriver.ts:202:
  `if (!action.businessField) continue`. Because businessField is null for ALL
  interactions (Boundary 4 defect), ALL actions are skipped. The resulting
  CapabilityCandidate has inputs=[].
  **Classification: A (implementation defect) — consequence of upstream
  businessField defect.**

- **componentId null → standalone actions:** Because componentId is never set
  on transitions (Boundary 1 defect), all transitions go to standalone[] in
  the semantic aggregator. Standalone actions get businessField=null and
  sourceInteractionType=null.
  **Classification: A (implementation defect) — UNIVERSAL BLOCKER.**

**Does next layer require PatternDefinition?** Indirectly yes — must have
enriched LogicalActions with businessField.

**Can a behaviorally recognized interaction continue without one?** NO —
businessField is null for all interactions.

---

### Boundary 6: CapabilityCandidate → DataRequirement → Capability Review → Side Panel

**What enters:** CapabilityCandidate (with inputs=[]).

**What survives:**
- CapabilityCandidate is persisted and displayed in the side panel.
- Review lifecycle works (candidate → review → Capability + Version).
- DataRequirements are derived (but lack field bindings due to businessField null).

**What is LOST or BLOCKED:**
- DataRequirements lack field bindings (field=null) and validation constraints.
- P2CapabilityContract is stored but never consumed by production code.

**Does next layer require PatternDefinition?** No — persistence and review are
mechanical operations on whatever CapabilityCandidate they receive.

**Can a behaviorally recognized interaction continue without one?** Yes —
persistence, review, and side panel display work regardless of input quality.
They faithfully display empty inputs.

---

## 3. Per-Interaction-Type Trace

### Native Checkbox (`<input type="checkbox">`)

| Stage | What Happens | Reaches? |
|---|---|---|
| Capture | DomContext extracted with type=checkbox, checked=true/false | ✅ |
| ElementIdentity | 18 fields extracted | ✅ |
| ComponentRuntime | Classified as Checkbox (structural match) | ✅ |
| Evidence (R3) | aria-checked toggle evidence generated | ✅ |
| Annotation | Annotated with evidence trail | ✅ |
| Domain Adapter | Checkbox → TOGGLE transition. domAttributes empty. componentId=null. | ✅ |
| Recognition | CHECKBOX behavioral signature mismatch (expects 'click', gets 'toggle'). Stuck DEVELOPING. | ❌ |
| Enrichment | Never reached (not CONFIRMED) | ❌ |
| Capability Derivation | Never reached | ❌ |
| IR Bridge | Generates Playwright `check()` code | ✅ |
| Side Panel | Shows timeline + Playwright code | ✅ |

**Defects blocking capability path:** (1) behavioral signature mismatch, (2)
componentId=null, (3) businessField null via NoOpDomInspector, (4) domAttributes empty.

### Custom Toggle (`<a href="#" class="toggle-filter">On Sale</a>`)

| Stage | What Happens | Reaches? |
|---|---|---|
| Capture | DomContext extracted: tag=a, role=link, class=toggle-filter | ✅ |
| ElementIdentity | Extracted from anchor element | ✅ |
| ComponentRuntime | Classified as Click (no structural match for checkbox) | ✅ |
| Evidence (R3) | Post-click: aria-checked toggled OR class toggled. Evidence weight ≥ 0.5 → reclassify to Checkbox/Toggle. | ✅ |
| Annotation | Reclassified. Intent set. Confidence set. | ✅ |
| Domain Adapter | Reclassified type → TOGGLE transition. domAttributes empty. componentId=null. | ✅ |
| Recognition | Same CHECKBOX behavioral signature mismatch. Stuck DEVELOPING. | ❌ |
| Enrichment | Never reached (not CONFIRMED) | ❌ |
| Capability Derivation | Never reached | ❌ |
| IR Bridge | Generates Playwright `click()` code | ✅ |
| Side Panel | Shows timeline + Playwright code | ✅ |

**Defects blocking capability path:** Same as native checkbox. R3 reclassification
works correctly (the understanding IS achieved), but the understanding cannot
travel through the pipeline.

### Custom DIV Slider

| Stage | What Happens | Reaches? |
|---|---|---|
| Capture | DomContext with slider geometry (min, max, step, value, orientation) | ✅ |
| ElementIdentity | Extracted from thumb element | ✅ |
| ComponentRuntime | Classified as Slider (R2 geometry-based detection) | ✅ |
| Evidence (R3) | Value change evidence generated | ✅ |
| Annotation | Annotated | ✅ |
| Domain Adapter | Slider → ? (needs verification of mapping). componentId=null. | ✅ |
| Recognition | No SLIDER pattern registered. No recognition. | ❌ |
| Enrichment | Never reached (not CONFIRMED) | ❌ |
| Capability Derivation | Never reached | ❌ |
| InteractionContract | Never derived (no enrichment) | ❌ |
| IR Bridge | Generates Playwright code for slider | ✅ |
| Side Panel | Shows timeline + Playwright code | ✅ |

**Defects blocking capability path:** (1) No SLIDER pattern, (2) componentId=null,
(3) businessField null, (4) domAttributes empty (slider geometry captured but lost).

### Novel Custom Control (click → something happens)

| Stage | What Happens | Reaches? |
|---|---|---|
| Capture | DomContext extracted | ✅ |
| ElementIdentity | Extracted | ✅ |
| ComponentRuntime | Classified as Click (universal fallback) | ✅ |
| Evidence (R3) | Behavioral evidence generated. If weight ≥ 0.5, reclassify to closest type. If < 0.3, flag unrecognized. | ✅ |
| Annotation | Reclassified or flagged unrecognized | ✅ |
| Domain Adapter | Mapped to corresponding transition | ✅ |
| Recognition | If reclassified to a type with a pattern, attempt recognition (likely stuck DEVELOPING). If unrecognized, no recognition. | ❌ |
| Enrichment | Never reached | ❌ |
| Capability Derivation | Never reached | ❌ |
| IR Bridge | Generates Playwright `click()` code | ✅ |
| Side Panel | Shows timeline + Playwright code | ✅ |

**Defects blocking capability path:** Same universal blockers + no matching pattern.

---

## 4. Classification of Each Loss

| # | Loss | Classification | Details |
|---|---|---|---|
| 1 | domAttributes always `{}` | **A (defect)** | Domain adapter reads property not on source type. Validation constraints lost. |
| 2 | componentId never assigned | **A (defect)** | assignToComponent() never called in pipeline. Universal blocker. |
| 3 | businessField reads wrong source | **A (defect)** | Queries NoOpDomInspector instead of entity.identity.accessibleName. |
| 4 | ancestorRoles truncated | **A (defect)** | Only target role passed, not full ancestor chain. |
| 5 | Checkbox behavioral signature mismatch | **A (defect)** | CHECKBOX expects 'click', adapter produces 'toggle'. |
| 6 | RadioGroup lifecycle mismatch | **A (defect)** | RadioButton→TOGGLE vs RADIO_GROUP expects [SELECT]. |
|  DomDropdown lifecycle over-specified | **A (defect)** | Single-transition adapter can't produce [CLICK, SELECT]. |
| 8 | Missing catalogue patterns | **B (missing pattern coverage)** | No SLIDER, DATE_PICKER, FILE_UPLOAD. |
| 9 | CONFIRMED-only enrichment gating | **C (architectural dependency)** | Enrichment designed for multi-element CONFIRMED components. Single-element interactions excluded. |
| 10 | Non-data types produce no DataRequirements | **D (intentional boundary)** | Clicks, navigations, scrolls are not data-driven. Correct behavior. |

---

## 5. Is PatternDefinition a Complement or an Unintended Gate?

**Design intent:** PatternDefinition is a **complement** — a data-driven registry
for recognizing multi-element component structures. Single-element interactions
(checkbox toggle, slider change, text input) should be handled by
ComponentDefinitions + evidence engine and should not require a pattern.

**Current implementation:** PatternDefinition is an **unintended gate**. The
enrichment orchestrator only processes CONFIRMED components (line 74). Only
components that match a registered pattern can reach CONFIRMED. Therefore, no
interaction can reach enrichment without a matching pattern — even if it was
correctly classified by ComponentRuntime + R3 evidence.

**However:** Even if patterns were added for all types and lifecycle mismatches
were fixed, the componentId disconnect (defect #2) would still block all
transitions from being associated with components. componentId=null is a
universal blocker that prevents the semantic aggregator from routing transitions
to component actions. This means the pattern gate is compounded by a data-flow
defect.

**Conclusion:** PatternDefinition is currently an unintended gate (due to
CONFIRMED-only enrichment gating), but even resolving that gate would not fix
the pipeline because componentId=null independently blocks all transitions.

---

## 6. Where Understanding Is Preserved vs Lost

### Understanding IS Preserved (End-to-End)
- **Observation → Classification:** Fully preserved. ComponentRuntime + evidence
  engine correctly classify interactions.
- **Classification → IR Bridge:** Fully preserved. IR Bridge consumes
  ComponentInteraction[] directly and generates working Playwright code.
- **Classification → Timeline:** Fully preserved. Side panel shows typed
  interactions with correct types.

### Understanding IS LOST (Capability Path)
- **Domain Adapter:** Validation constraints lost (domAttributes empty). R3
  annotations not carried forward. componentId not set.
- **Recognition:** Lifecycle mismatches prevent CONFIRMED. ancestorRoles
  truncated prevents structural matching.
- **Enrichment:** businessField null (reads wrong source). InteractionContract
  constraints null (domAttributes empty).
- **Aggregation:** componentId=null → all transitions become standalone with
  businessField=null.
- **Capability Derivation:** businessField=null → all actions skipped →
  inputs=[].

---

## 7. Universal Blocker Analysis

The **componentId=null** defect is a universal blocker: it blocks ALL
interactions regardless of type, classification quality, or pattern coverage.

Even if every other defect were fixed (domAttributes populated, businessField
reading from entity, lifecycle mismatches resolved, patterns added for all
types), the componentId disconnect would still cause the semantic aggregator to
treat every transition as standalone. Standalone transitions get
businessField=null and sourceInteractionType=null, which means deriveInputs
skips them all.

This is the earliest defect in the pipeline that has a universal effect.
However, it is not the first defect chronologically — the domAttributes loss
happens at the domain adapter (earlier in the pipeline), but its effect
(constraints null) is not universal because non-data types don't need
constraints. componentId=null affects ALL types.

---

## 8. Answers to Required Questions

### (1) Does the architecture satisfy the invariant?

**PARTIALLY.** The design satisfies the invariant — ComponentDefinitions + R3
evidence engine can correctly classify novel implementations of known types
without a pattern. But the implementation does NOT allow that understanding to
reach capability knowledge, because:

1. CONFIRMED-only enrichment gating makes PatternDefinition a prerequisite for
   enrichment (architectural dependency).
2. componentId=null is a universal blocker that prevents all transitions from
   reaching component-level processing (implementation defect).
3. businessField=null prevents all actions from contributing to capability
   inputs (implementation defect).

### (2) Where understanding is preserved

- Observation → Classification (fully)
- Classification → IR Bridge → Playwright code (fully)
- Classification → Timeline display (fully)
- R3 behavioral reclassification works correctly for supported types

### (3) Where understanding is lost

- Domain Adapter: validation constraints (domAttributes), R3 annotations,
  componentId
- Recognition: lifecycle mismatches, ancestorRoles truncation
- Enrichment: businessField (wrong source), constraints (domAttributes empty)
- Aggregation: componentId=null → standalone → businessField=null
- Capability Derivation: businessField=null → all actions skipped → inputs=[]

### (4) Classification of each loss

| Loss | Classification |
|---|---|
| domAttributes empty | A (implementation defect) |
| componentId never assigned | A (implementation defect) |
| businessField reads wrong source | A (implementation defect) |
| ancestorRoles truncated | A (implementation defect) |
| Checkbox behavioral signature mismatch | A (implementation defect) |
| RadioGroup lifecycle mismatch | A (implementation defect) |
| Dropdown lifecycle over-specified | A (implementation defect) |
| Missing catalogue patterns | B (missing pattern coverage) |
| CONFIRMED-only enrichment gating | C (architectural dependency) |
| Non-data types no DataRequirements | D (intentional boundary) |

### (5) Whether PatternDefinition is complement or unintended gate

**Currently an unintended gate.** Designed as a complement for multi-element
recognition, but CONFIRMED-only enrichment makes it a prerequisite for ANY
interaction to reach capability knowledge. However, even if patterns were added
for all types, componentId=null would still block everything.

### (6) What must be resolved before implementation changes

1. **How componentId gets assigned to transitions** (universal blocker — all
   transitions currently have componentId=null).
2. **How domAttributes gets populated** (validation constraints currently lost).
3. **Whether businessField reads from entity fields or DomInspector** (currently
   reads from NoOpDomInspector which returns null).
4. **Lifecycle/signature mismatches** (checkbox 'click' vs 'toggle', radio
   SELECT vs TOGGLE, dropdown [CLICK, SELECT]).
5. **ancestorRoles full chain** (currently truncated to target only).
6. **ARCHITECTURAL DECISION:** Should single-element interactions contribute to
   capability knowledge WITHOUT component-level recognition? Options:
   - (a) Add patterns for all types (makes PatternDefinition exhaustive).
   - (b) Allow enrichment for standalone transitions with known semantic type
       (removes the pattern gate).
   - (c) Create synthetic single-element components (auto-promote to CONFIRMED
       for known types).
   
   This decision determines whether PatternDefinition remains a complement or
   becomes an exhaustive gate.
