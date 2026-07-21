# End-to-End Architecture Walkthrough — From Browser Events to Application Understanding

> **Purpose:** Validate that the implemented architecture (through Phase 4) plus the
> planned Phase 5 enrichment naturally evolves a real user interaction from raw
> browser events into a full `ApplicationKnowledgeFragment` — without redesign, and
> without new foundational entities.
>
> **Method:** A concrete, code-grounded walkthrough of a representative scenario. At
> each stage I show exactly what the implemented code does, which entities are
> created/updated, which views become available, and which capabilities are unlocked.
> Every claim references the actual pattern definitions, entity fields, and
> orchestrator logic in the codebase.
>
> **Scenario:** Booking a premium-economy flight on a travel site. This exercises
> dropdowns, text inputs with validation, checkboxes, a page navigation (workflow
> boundary), and multi-step workflow structure.

---

## Table of Contents

1. [The Scenario](#the-scenario)
2. [Stage 0 — Raw Browser Events](#stage-0--raw-browser-events)
3. [Stage 1 — Universal Observer + Coalescer](#stage-1--universal-observer--coalescer)
4. [Stage 2 — Semantic Classifier](#stage-2--semantic-classifier)
5. [Stage 3 — Foundational Entity Creation](#stage-3--foundational-entity-creation)
6. [Stage 4 — Recognition (per-interaction)](#stage-4--recognition-per-interaction)
7. [Stage 5 — Lifecycle Progression](#stage-5--lifecycle-progression)
8. [Stage 6 — Post-Recording Enrichment (Phase 5)](#stage-6--post-recording-enrichment-phase-5)
9. [Stage 7 — Semantic Aggregation](#stage-7--semantic-aggregation)
10. [Stage 8 — RecordedWorkflow](#stage-8--recordedworkflow)
11. [Stage 9 — ApplicationKnowledgeFragment](#stage-9--applicationknowledgefragment)
12. [Stage 10 — Future Consumer Capabilities](#stage-10--future-consumer-capabilities)
13. [How Higher-Level Understanding Emerges Without New Entities](#how-higher-level-understanding-emerges-without-new-entities)
14. [Why This Validates the Architecture](#why-this-validates-the-architecture)

---

## The Scenario

A user books a premium-economy flight. The full sequence of **physical interactions**:

| # | User action | Element | What happens |
|---|------------|---------|--------------|
| 1 | Clicks the travel class dropdown trigger | `div.travel-class` (ARIA `combobox`) | Dropdown opens; a listbox with 4 options appears |
| 2 | Clicks "Premium Economy" | `div.option-premium` (ARIA `option`) | Option selected; trigger text changes to "Premium Economy"; dropdown closes |
| 3 | Types `user@example.com` into the email field | `input#email` (`type=email`, `required`) | Value changes; on blur, inline validation passes |
| 4 | Checks "Accept terms" | `input#terms` (ARIA `checkbox`) | Checkbox state flips to checked |
| 5 | Clicks "Search flights" | `button#search` | Form submits; **navigation to `/results`** |

This is 5 clicks/types — a flat event log. The architecture will turn it into a
structured understanding of what the application *is* and what the user *did*.

---

## Stage 0 — Raw Browser Events

> **What the browser emits.**

When the user clicks the travel class dropdown, the browser fires a cascade of
low-level events:

```
mousedown on div.travel-class
mouseup on div.travel-class
click on div.travel-class
focus on div.travel-class
[mutation observer fires: child ul.options becomes visible]
```

Typing into the email field fires:

```
focus on input#email
keydown 'u', input event (value: 'u')
keydown 's', input event (value: 'us')
... (key by key)
change on input#email (value: 'user@example.com')
blur on input#email
[validation: input gets class 'valid']
```

**At this stage, there is:**
- A stream of raw DOM events, each carrying a target element and event-specific data.
- Mutation observer records (child appeared, class changed).
- No classification, no semantic meaning, no grouping.

**Observed vs inferred:** Everything here is **raw observation** — physical events as
they occurred. Nothing is inferred yet.

**Foundational entities created:** None.

**Derived views available:** None.

**Knowledge still unavailable:** Everything. These are raw signals with no meaning.

**Future capabilities possible:** None — raw events are not directly consumable.

**Implementation status:** This is the browser itself — the raw input to our pipeline.

---

## Stage 1 — Universal Observer + Coalescer

> **One observer captures everything; the coalescer groups related events into
> interaction snapshots.**

### What happens (implemented — Architecture C)

The **Universal Observer** (one content script) has capture-phase listeners on all
relevant event types. It records every event + DOM context into `RawEvidence`
records, which flow to the service worker's **Coalescer**.

The Coalescer opens a temporal window around each user gesture, groups the related
raw events, and produces an `InteractionSnapshot` with rich pre/post evidence:

```
Snapshot #1 (the dropdown click):
  triggerEvent: click on div.travel-class
  preState:  { value: 'Economy', expanded: false }
  postState: { value: 'Economy', expanded: true }
  valueChange: null
  stateChange: expanded false → true
  mutations:
    - child 'ul.options' visibility: hidden → visible
    - child 'li.option-economy' added to DOM
    - child 'li.option-premium' added to DOM
    - child 'li.option-business' added to DOM
    - child 'li.option-first' added to DOM
  classChanges: []
  timestamp: 1000

Snapshot #2 (the option click):
  triggerEvent: click on div.option-premium
  preState:  { selected: false }
  postState: { selected: true }
  valueChange: null
  stateChange: selected false → true
  mutations:
    - 'div.travel-class' textContent: 'Economy' → 'Premium Economy'
    - 'ul.options' visibility: visible → hidden
  cascadeEffects:
    - elementId: 'div.travel-class', effect: VALUE, detail: 'Economy' → 'Premium Economy'
  timestamp: 1200
```

The coalescer also captures DOM context: the ancestor chain (for structural
recognition) and related element IDs (for behavioral recognition and enrichment).

**At this stage, there is:**
- Grouped, evidence-rich interaction snapshots (not isolated events).
- Pre/post state, mutations, cascades — the raw material for classification and
  behavioral recognition.
- Still no classification, no entity creation.

**Observed vs inferred:** Still **all observed** — but now structured and grouped.
The coalescer doesn't infer meaning; it groups related observations.

**Foundational entities created:** None yet.

**Derived views available:** None.

**Knowledge still unavailable:** "This was a dropdown open" — that's classification
(Stage 2). "These elements form a dropdown" — that's recognition (Stage 4).

**Future capabilities possible:** None directly, but the rich snapshots are the input
to everything downstream.

**Implementation status:** ✅ **Fully implemented** (Architecture C Phases 0–6).

---

## Stage 2 — Semantic Classifier

> **A deterministic pure function assigns a type and relevance to each snapshot.**

### What happens (implemented — Architecture C)

The **Semantic Classifier** applies 16 ordered priority rules across three tiers to
each `InteractionSnapshot`, producing a `ClassifiedInteraction`:

| Snapshot | Type assigned | Relevance | Reasoning |
|----------|--------------|-----------|-----------|
| #1 (dropdown click) | `CLICK` | `deliberate` | Rule R1: click with mutation (child appeared) → deliberate click |
| #2 (option click) | `SELECT` | `deliberate` | Rule R4: click on element with `role=option` (or in a listbox) → SELECT |
| #3 (typing email) | `TYPE` | `deliberate` | Rule R2: input with value change → TYPE |
| #4 (checking terms) | `TOGGLE` | `deliberate` | Rule R3: click on `role=checkbox` → TOGGLE |
| #5 (search click) | `NAVIGATE` | `deliberate` | Rule R5: click causing navigation → NAVIGATE |

The classifier also assigns **relevance** (`deliberate`, `supporting`, `noise`):

- `deliberate` — a user-initiated primary action (the 5 above).
- `supporting` — interactions that provide context but aren't primary (e.g., hovering
  to reveal a tooltip before clicking).
- `noise` — events with no semantic value (e.g., stray mousemoves, focus loss).

**At this stage, there is:**
- Typed, relevance-classified interactions: "this was a SELECT, deliberate."
- The canonical `TransitionOperation` for each interaction (CLICK, SELECT, TYPE,
  TOGGLE, NAVIGATE).
- The `ElementRoleInfo` for each (elementId, ariaRole, tag) and the ancestor chain.
- Still no entities, no component recognition.

**Observed vs inferred:** **Observed** — the classifier applies deterministic rules
to observed evidence. The type is a *categorical observation* ("this click is a
SELECT operation"), not an inference about application structure.

**Foundational entities created:** None yet — the classified interaction is the
input to entity creation.

**Derived views available:** None.

**Knowledge still unavailable:** "These 3 elements form a dropdown" — that's
recognition (Stage 4). "The email field is required and validates as email" — that's
enrichment (Stage 6).

**Future capabilities possible:** Test steps can be generated from typed interactions
(the legacy pipeline does this). But semantic grouping (components, workflows) needs
recognition.

**Implementation status:** ✅ **Fully implemented** (Architecture C).

---

## Stage 3 — Foundational Entity Creation

> **The first two foundational entities appear: UiElement and ObservedTransition.**

### What happens (implemented — Phase 1)

For each classified interaction, the recording pipeline creates or updates two
foundational entities. Let's trace interactions #1 and #2 (the dropdown).

#### Interaction #1: Click on `div.travel-class` (the combobox)

A **UiElement** is created for `div.travel-class`:

```typescript
UiElement {
  elementId: 'div.travel-class',
  identity: ElementIdentity {
    // 18-field identity: locatorStrategies, accessibleName, ariaRole='combobox', ...
    accessibleName: 'Travel Class',
    ariaRole: 'combobox',
    locatorStrategies: [
      { type: 'css', value: 'div.travel-class', rank: 1 },
      { type: 'aria', value: '[aria-label="Travel Class"]', rank: 2 },
      // ... ranked strategies for self-healing
    ],
  },
  domAttributes: {
    'role': 'combobox',
    'aria-expanded': 'false',       // captured pre-click
    'aria-label': 'Travel Class',
    'tabindex': '0',
  },
  sourceUrl: '/search',
  domTreePath: 'html > body > main > form > div.search-filters > div.travel-class',
  intrinsicCapabilities: [CLICK, FOCUS, HOVER],   // derived from tag+role
  componentId: null,                // not yet recognized
  componentRole: null,
}
```

An **ObservedTransition** is created:

```typescript
ObservedTransition {
  transitionId: 't1',
  elementId: 'div.travel-class',
  componentId: null,                // not yet associated
  operation: TransitionOperation.CLICK,
  timestamp: 1000,
  relevance: RelevanceLevel.DELIBERATE,
  stateBefore: ElementState { value: 'Economy', checked: null, expanded: false, selected: null },
  stateAfter:  ElementState { value: 'Economy', checked: null, expanded: true,  selected: null },
  evidence: [
    TransitionEvidence { type: STATE_CHANGE, description: 'expanded false → true',
                         before: 'false', after: 'true' },
    TransitionEvidence { type: MUTATION, description: 'child ul.options became visible',
                         before: 'hidden', after: 'visible' },
  ],
  cascadeEffects: [],               // none for the open click
  validationResult: null,           // no validation involved
}
```

Note what's captured: the **exact before/after state**, the **mutations that
occurred** (the listbox appeared), and the **relevance** (deliberate). This is
empirical fact — impossible to recompute after the page changes.

#### Interaction #2: Click on `div.option-premium` (the option)

A **UiElement** for the option, and another **ObservedTransition**:

```typescript
UiElement {
  elementId: 'div.option-premium',
  identity: { ..., ariaRole: 'option', accessibleName: 'Premium Economy' },
  domAttributes: { 'role': 'option', 'aria-selected': 'false', 'data-value': 'premium' },
  sourceUrl: '/search',
  intrinsicCapabilities: [CLICK],
  componentId: null,                // still not recognized — recognition is Stage 4
  componentRole: null,
}

ObservedTransition {
  transitionId: 't2',
  elementId: 'div.option-premium',
  operation: TransitionOperation.SELECT,
  stateBefore: { selected: false },
  stateAfter:  { selected: true },
  evidence: [
    { type: STATE_CHANGE, description: 'selected false → true' },
    { type: VALUE_CHANGE, description: 'trigger text Economy → Premium Economy',
      before: 'Economy', after: 'Premium Economy' },
    { type: MUTATION, description: 'ul.options became hidden' },
  ],
  cascadeEffects: [
    { elementId: 'div.travel-class', effect: VALUE,
      detail: 'Economy → Premium Economy' },
  ],
}
```

The cascade effect is critical: it records that clicking the option **caused** the
combobox's value to change. This causal link is observed fact that the behavioral
recognizer and the BehavioralContract derivation will both use.

**At this stage, there is:**
- UiElement records for every element interacted with (identity, DOM attributes,
  capabilities, source URL, DOM tree path).
- ObservedTransition records for every interaction (operation, before/after state,
  evidence, cascades).
- Elements and transitions are **not yet associated** with components — `componentId`
  is null on both. They're standalone facts.

**Observed vs inferred:** **All observed.** The entities capture empirical facts:
element attributes at recording time, exact state transitions, observed mutations and
cascades. Nothing is inferred yet.

**Foundational entities created:** ✅ `UiElement` (multiple), `ObservedTransition`
(multiple).

**Derived views available:** None yet — the enrichment pass (Stage 6) hasn't run.

**Knowledge still unavailable:**
- "These elements form a dropdown" → recognition (Stage 4).
- "The dropdown has 4 options" → enrichment (Stage 6, DOM inspection).
- "The email field is required" → enrichment (Stage 6, domAttributes parsing).
- "This was one logical action: set travel class" → aggregation (Stage 7).

**Future capabilities possible at this stage:**
- **Self-healing** can already use `UiElement.identity.locatorStrategies` (ranked
  fallback locators). This is available the moment a UiElement is created.
- **Test steps** (legacy pipeline) can render typed transitions into executable steps.

**Implementation status:** ✅ **Fully implemented** (Phase 1 entities + recording
pipeline entity creation).

---

## Stage 4 — Recognition (per-interaction)

> **The Recognition Orchestrator runs for each classified interaction. Structural
> and behavioral recognizers fire; the Component Registry manages identity.**

### What happens (implemented — Phases 2–4)

When interaction #1 arrives at the orchestrator, it has the element's ancestor chain
(captured by the observer). Let's trace recognition for the dropdown.

#### Interaction #1: Click on `div.travel-class`

The orchestrator calls `processInteraction(input, registry)`:

**Step 1 — Structural recognition.** The structural recognizer iterates the pattern
catalogue. The DROPDOWN pattern defines:

```typescript
// From pattern-catalogue.ts (actual code)
{
  patternType: PatternType.DROPDOWN,
  rootAriaRoles: ['combobox', 'listbox'],
  constituentRoles: [
    { ariaRole: 'combobox', role: ComponentRole.TRIGGER },
    { ariaRole: 'listbox',  role: ComponentRole.CONTAINER },
    { ariaRole: 'option',   role: ComponentRole.OPTION },
  ],
  minConstituents: 2,
  expectedLifecycle: [TransitionOperation.CLICK, TransitionOperation.SELECT],
}
```

The recognizer walks the ancestor chain `[div.travel-class(role=combobox),
ul.options(role=listbox), div.option-premium(role=option)]`:

1. Finds root: `div.travel-class` has `role=combobox` ∈ `rootAriaRoles`. ✓
2. Assigns constituent roles via reverse lookup:
   - `div.travel-class` (combobox) → TRIGGER
   - `ul.options` (listbox) → CONTAINER
   - `div.option-premium` (option) → OPTION
3. Checks minConstituents (2): 3 constituents ≥ 2. ✓
4. Returns `RecognitionResult { patternType: DROPDOWN, rootElementId: 'div.travel-class',
   constituents: [...], confidence: 0.95, source: STRUCTURAL }`.

**Step 2 — Behavioral recognition.** The behavioral recognizer evaluates the dropdown's
behavioral signature against detected signals. For interaction #1 alone, the signals
are limited (one click, one mutation). It may return a partial match or null. This is
fine — structural already fired authoritatively.

**Step 3 — Identity resolution + merge.** The orchestrator calls
`resolveIdentity(structuralResult, registry.getActive())`. No existing components yet
→ creates a new one:

```typescript
ComponentGrouping {
  groupingId: 'comp-0001',
  patternType: PatternType.DROPDOWN,
  rootElementId: 'div.travel-class',
  constituents: [
    { elementId: 'div.travel-class', role: ComponentRole.TRIGGER },
    { elementId: 'ul.options',       role: ComponentRole.CONTAINER },
    { elementId: 'div.option-premium', role: ComponentRole.OPTION },
  ],
  businessField: null,                    // populated at enrichment (Stage 6)
  recognitionSource: RecognitionSource.STRUCTURAL,
  recognitionConfidence: 0.95,
  lifecycleState: ComponentLifecycleState.TENTATIVE,
  optionSet: null,                        // populated at enrichment (Stage 6)
  observedTransitionIds: [],              // populated next
}
```

The registry also seeds **supporting evidence** (recognition is supporting evidence):

```
EvidenceEntry { source: STRUCTURAL, disposition: 'supporting',
  description: 'dropdown recognized by structural', timestamp: 1000 }
```

**Step 4 — Enrichment.** The orchestrator adds transition `t1` to the component:
`observedTransitionIds: ['t1']`. This advances TENTATIVE → DEVELOPING (first
transition observed).

**Step 5 — Lifecycle check.** DROPDOWN's `expectedLifecycle = [CLICK, SELECT]`.
Observed operations so far: `{CLICK}`. Not complete → stays DEVELOPING.

**Step 6 — Rejection check.** Net contradiction = 0 (only supporting evidence). Not
rejected.

The three UiElements involved (`div.travel-class`, `ul.options`, `div.option-premium`)
are now associated: `componentId = 'comp-0001'`, with their respective roles.

#### Interaction #2: Click on `div.option-premium` (the option)

The orchestrator runs again:

**Step 1 — Structural recognition.** The option element's ancestor chain is
`[ul.options(role=listbox), div.option-premium(role=option)]`. The DROPDOWN pattern
matches again (listbox is a root role). Result: DROPDOWN, root = `ul.options`.

**Step 3 — Identity resolution.** The orchestrator resolves identity. The new result's
root (`ul.options`) is in `comp-0001`'s constituents → **root-in-constituents match**.
Same component. The registry merges:

```typescript
// After merge — comp-0001 updated:
constituents: [
  { elementId: 'div.travel-class', role: ComponentRole.TRIGGER },
  { elementId: 'ul.options',       role: ComponentRole.CONTAINER },
  { elementId: 'div.option-premium', role: ComponentRole.OPTION },
  // (no new constituents — option-premium already known)
],
observedTransitionIds: ['t1', 't2'],    // t2 added
lifecycleState: ComponentLifecycleState.DEVELOPING,
```

The merge also seeds another supporting evidence entry ("dropdown recognition
reinforced by structural").

**Step 5 — Lifecycle check.** Observed operations now: `{CLICK, SELECT}`.
`expectedLifecycle = [CLICK, SELECT]`. **Both observed → lifecycle complete!** The
orchestrator promotes:

```typescript
lifecycleState: ComponentLifecycleState.CONFIRMED,
```

Another supporting evidence entry: "Lifecycle complete — component confirmed."

**At this point, the dropdown is CONFIRMED.** The system knows — with structural
authority (confidence 0.95) — that `div.travel-class`, `ul.options`, and
`div.option-premium` form a dropdown, and that the user opened it and selected an
option.

#### Interaction #4: Check the "Accept terms" checkbox

Structural recognition matches the CHECKBOX pattern (`rootAriaRoles: ['checkbox']`):

```typescript
ComponentGrouping {
  groupingId: 'comp-0002',
  patternType: PatternType.CHECKBOX,
  rootElementId: 'input#terms',
  constituents: [{ elementId: 'input#terms', role: ComponentRole.TRIGGER }],
  recognitionSource: RecognitionSource.STRUCTURAL,
  recognitionConfidence: 0.95,
  lifecycleState: ComponentLifecycleState.TENTATIVE,  // → DEVELOPING after t4
  expectedLifecycle: [TransitionOperation.TOGGLE],
}
```

CHECKBOX's `expectedLifecycle = [TOGGLE]`. After `t4` (the toggle), observed operations
= `{TOGGLE}` → lifecycle complete → **CONFIRMED**.

#### Interaction #5: Click "Search flights" — NAVIGATE

The NAVIGATE transition is recorded but no component is recognized for the button
(it's a plain submit button, not a composite widget). The transition is stored with
`relevance: deliberate`. This transition will later serve as a **workflow boundary**
(Stage 8).

**At this stage, there is:**
- Two **confirmed** ComponentGroupings: the dropdown (comp-0001) and the checkbox
  (comp-0002).
- All UiElements and ObservedTransitions are now associated with their components
  (where applicable) via `componentId`.
- The evidence ledger for each component shows the full recognition → confirmation
  trail.

**Observed vs inferred:** Recognition is an **inference** — "these elements form a
dropdown" is a conclusion drawn from observed ARIA structure. But it's an inference
*backed by authoritative evidence* (ARIA roles, the page author's declaration). The
ComponentGrouping persists this inference because it's expensive to recompute
(evidence accumulated across interactions).

**Foundational entities created/updated:** ✅ `ComponentGrouping` (2 created), and
`UiElement`/`ObservedTransition` records updated with `componentId` associations.

**Derived views available:** None yet — enrichment (Stage 6) hasn't run. But the
*foundations* for all derived views are now in place.

**Knowledge still unavailable:**
- "The dropdown has 4 options (Economy, Premium, Business, First)" → enrichment.
  Recognition only knows about the option the user clicked. The other 3 options
  were never interacted with — they'll be discovered by DOM inspection at Stage 6.
- "The email field is required and accepts emails" → enrichment (domAttributes
  parsing).
- "This was one logical action: Set Travel Class to Premium Economy" → aggregation.

**Future capabilities possible at this stage:**
- **Test generation** can now produce *semantic* steps: "Selected Premium Economy in
  Travel Class dropdown" instead of "Clicked div.option-premium." The confirmed
  component provides the semantic grouping.
- **Self-healing** is enhanced: a broken locator for the option can fall back to "the
  option in the Travel Class dropdown" (component context).

**Implementation status:** ✅ **Fully implemented** (Phases 2–4: catalogue,
structural recognizer, behavioral recognizer, registry, orchestrator).

---

## Stage 5 — Lifecycle Progression

> **Components progress from tentative to confirmed as evidence accumulates.**

### What happens (implemented — Phase 4)

This is the stage that happened *during* Stage 4, but it deserves its own
explanation because it's where confidence accumulates.

The dropdown's lifecycle, traced through the evidence ledger:

```
t1 (CLICK on trigger):
  Registry creates comp-0001 (TENTATIVE)
  Evidence: SUPPORTING (structural recognition)
  → addTransition(t1) → TENTATIVE becomes DEVELOPING (first transition)
  Lifecycle check: {CLICK} ≠ {CLICK, SELECT} → not complete

t2 (SELECT on option):
  Identity resolution: root-in-constituents match → merge into comp-0001
  Evidence: SUPPORTING (structural reinforcement)
  → addTransition(t2)
  Lifecycle check: {CLICK, SELECT} = {CLICK, SELECT} → COMPLETE
  → promote to CONFIRMED
  Evidence: SUPPORTING (lifecycle complete)
```

The checkbox's lifecycle:

```
t4 (TOGGLE on checkbox):
  Registry creates comp-0002 (TENTATIVE)
  Evidence: SUPPORTING (structural recognition)
  → addTransition(t4) → DEVELOPING
  Lifecycle check: {TOGGLE} = {TOGGLE} → COMPLETE
  → promote to CONFIRMED
```

Both components reach CONFIRMED within their first interaction cycle. This is typical
for structural recognition — ARIA provides strong, immediate evidence.

**At this stage, there is:**
- Confirmed components with full evidence audit trails.
- The recognition system has done its job — the components are stable semantic
  decisions that won't change unless explicitly rejected.

**Observed vs inferred:** The lifecycle *progression* is an inference ("we're now
confident enough"), but it's driven by **observed operations** matching the pattern's
**declared expectations** (`expectedLifecycle`). The confirmation is deterministic,
not probabilistic.

**Foundational entities updated:** `ComponentGrouping.lifecycleState` → CONFIRMED.

**Derived views available:** None new, but the confirmed state is a prerequisite for
enrichment (Stage 6 only enriches confirmed components).

**Implementation status:** ✅ **Fully implemented** (Phase 4 lifecycle progression).

---

## Stage 6 — Post-Recording Enrichment (Phase 5)

> **On Stop, the enrichment pass runs. It materializes the derived views from the
> foundational entities via read-only DOM inspection.**

### What happens (designed — Phase 5, not yet implemented)

When the user clicks Stop, the recording session ends. The enrichment pass runs over
all confirmed components and all UiElements. It performs **read-only DOM inspection**
— it reads the current page state but does not simulate interactions.

This is the stage that bridges **observed** (what the user interacted with) to
**inferred** (what the application is). Most knowledge in the model is inferred from
DOM structure, not observed from user interaction.

#### 6a — Option set extraction (for the dropdown)

The enrichment pass inspects the dropdown's container element (`ul.options`) in the
DOM. Even though the user only clicked "Premium Economy," the DOM contains all 4
options:

```
DOM inspection of ul.options:
  <li role="option" data-value="economy">Economy</li>
  <li role="option" data-value="premium" aria-selected="true">Premium Economy</li>
  <li role="option" data-value="business">Business</li>
  <li role="option" data-value="first">First Class</li>
```

The enrichment extracts the full option set:

```typescript
// ComponentGrouping comp-0001 updated:
optionSet: [
  { value: 'economy',  label: 'Economy',         selected: false, disabled: false },
  { value: 'premium',  label: 'Premium Economy', selected: true,  disabled: false },
  { value: 'business', label: 'Business',        selected: false, disabled: false },
  { value: 'first',    label: 'First Class',     selected: false, disabled: false },
],
businessField: 'Travel Class',   // inferred from accessibleName of the trigger
```

This is a critical inference: **the model now knows about 3 options the user never
interacted with.** This is the basis for alternate-flow test generation and boundary
testing.

#### 6b — InteractionContract derivation (for the email field)

The enrichment pass reads `input#email`'s `domAttributes`:

```typescript
// From the persisted UiElement:
domAttributes: {
  'type': 'email',
  'required': '',
  'minlength': '5',
  'maxlength': '100',
  'placeholder': 'you@example.com',
  'autocomplete': 'email',
}
```

It parses these into an InteractionContract:

```typescript
InteractionContract {
  appliesTo: 'input#email',
  affordances: [ACCEPT_TEXT, FOCUS],
  constraints: InteractionConstraints {
    required: true,
    inputType: 'email',
    lengthRange: { min: 5, max: 100 },
    format: 'email',                    // inferred from type=email
    validOptions: null,                 // not a select
    dateFormat: null,
  },
}
```

The contract is **pure derivation** from `domAttributes`. If we later improve our
parser (e.g., to recognize `data-validate="email"` as a custom format hint), every
existing recording benefits — we just re-run the enrichment pass.

#### 6c — BehavioralContract derivation (for the dropdown)

The enrichment pass synthesizes the dropdown's ObservedTransitions into a state
machine:

```typescript
BehavioralContract {
  appliesTo: 'comp-0001',
  stateMachine: StateMachine {
    states: ['closed', 'open', 'selected'],
    transitions: [
      { from: 'closed', to: 'open',     operation: CLICK,  observed: true,
        evidence: ['expanded false → true', 'child ul.options visible'] },
      { from: 'open',   to: 'selected', operation: SELECT, observed: true,
        evidence: ['selected false → true', 'trigger text Economy → Premium Economy'] },
    ],
    terminalStates: ['selected'],
  },
  validationBehavior: null,              // dropdowns typically don't validate
  cascadeEffects: [
    { trigger: 'div.option-premium', affectsEntityId: 'div.travel-class',
      effect: 'VALUE', detail: 'Economy → Premium Economy' },
  ],
  successIndicators: [
    { signal: 'trigger text changed to selected option', type: 'valueDisplay' },
  ],
}
```

The state machine is **synthesized from observed transitions** — it's a derivation,
not a new fact. The transitions in the state machine reference the actual
ObservedTransition records (via `evidence` links).

**At this stage, there is:**
- `optionSet` populated on the dropdown component (4 options, including 3 unchosen).
- `businessField` populated ("Travel Class").
- InteractionContracts for input elements (constraints, validation).
- BehavioralContracts for confirmed components (state machines, validation behavior).

**Observed vs inferred:** This stage is **pure inference**. Everything materialized
here is derived from the foundational entities via computation:
- Option sets ← DOM inspection of constituent elements.
- InteractionContracts ← parsing `domAttributes`.
- BehavioralContracts ← synthesizing `ObservedTransition` sequences.

**Foundational entities updated:** `ComponentGrouping.optionSet` and `businessField`
are populated. (These fields were designed to be null until enrichment — they're
"schema-ready" fields on the foundational entity, populated by derivation.)

**Derived views available:** ✅ InteractionContract, ✅ BehavioralContract.

**Knowledge still unavailable:**
- "Set Travel Class to Premium Economy was one logical action" → Semantic Aggregation
  (Stage 7).
- "The workflow was: set class → enter email → accept terms → search" → RecordedWorkflow
  (Stage 8).

**Future capabilities possible at this stage:**
- **Boundary testing:** `InteractionContract.lengthRange` (5–100) and
  `ComponentGrouping.optionSet` (4 options) provide exact boundary values to test.
- **Negative testing:** `InteractionContract.required` and `format: 'email'` define
  invalid inputs to try (empty, malformed email, SQL injection).
- **Accessibility testing:** `UiElement.identity.ariaRole` and `domAttributes`
  provide the ARIA profile to check.

**Implementation status:** 🔵 **Types implemented** (InteractionContract,
BehavioralContract in `application-knowledge.ts`). **Materialization not yet built**
— this is Phase 5, the next implementation phase. No architectural barrier: it's
pure computation over existing foundations.

---

## Stage 7 — Semantic Aggregation

> **Multiple low-level transitions on a confirmed component become one logical
> action.**

### What happens (designed — post-Phase-5, not yet implemented)

After enrichment, the aggregation pass walks each confirmed component's
`observedTransitionIds` and groups them by lifecycle phase.

For the dropdown (comp-0001):

```
observedTransitionIds: ['t1', 't2']

t1: CLICK on div.travel-class (trigger)    → lifecycle phase: OPEN
t2: SELECT on div.option-premium (option)  → lifecycle phase: SELECT

The DROPDOWN pattern's expectedLifecycle = [CLICK, SELECT]
→ These two transitions form one complete lifecycle → one logical action.
```

The aggregator produces:

```typescript
LogicalAction {
  componentId: 'comp-0001',
  actionType: 'SET_VALUE',           // derived from pattern type
  businessField: 'Travel Class',     // from enrichment
  value: 'Premium Economy',          // from the selected option
  transitionIds: ['t1', 't2'],       // the raw transitions that composed it
}
```

For the checkbox (comp-0002):

```
observedTransitionIds: ['t4']
t4: TOGGLE on input#terms
expectedLifecycle = [TOGGLE] → one complete lifecycle → one logical action.
```

```typescript
LogicalAction {
  componentId: 'comp-0002',
  actionType: 'TOGGLE',
  businessField: 'Accept terms',
  value: true,                       // the checked state
  transitionIds: ['t4'],
}
```

For the email input (no component — it's a standalone element):

```
t3: TYPE on input#email
No component → one transition = one logical action (no aggregation needed).
```

```typescript
LogicalAction {
  componentId: null,                 // standalone element
  actionType: 'ENTER_TEXT',
  businessField: 'Email',
  value: 'user@example.com',
  transitionIds: ['t3'],
}
```

For the search button (navigation):

```
t5: NAVIGATE on button#search
```

```typescript
LogicalAction {
  componentId: null,
  actionType: 'NAVIGATE',
  businessField: 'Search flights',   // from accessibleName
  value: '/results',                 // destination URL
  transitionIds: ['t5'],
}
```

**The critical transformation:** 5 raw transitions became 4 logical actions. The two
dropdown transitions (open + select) collapsed into one semantic action. This is
Semantic Aggregation doing exactly what it was designed to do.

**At this stage, there is:**
- Logical actions that represent business-level intent, not mechanical clicks.
- Each action references its source transitions (full traceability to foundations).

**Observed vs inferred:** **Pure inference.** Logical actions are derived from
component lifecycles + observed transitions + enrichment data (businessField, value).

**Foundational entities created/updated:** None. Logical actions are a **derived
view** — they reference foundational entities but don't modify them.

**Derived views available:** LogicalAction[] (new derived type).

**Knowledge still unavailable:** The ordered sequence of actions as a workflow, with
boundaries and branch points → RecordedWorkflow (Stage 8).

**Future capabilities possible at this stage:**
- **Test generation** can now produce workflow-level steps: "Set Travel Class to
  Premium Economy" as a single semantic assertion.

**Implementation status:** ⏸️ **Deferred** (post-Phase-5). Its prerequisites are all
built: `observedTransitionIds` (Phase 4), `expectedLifecycle` (Phase 4), `businessField`
(Phase 6 enrichment), `optionSet` (Phase 6 enrichment). The aggregation computation
itself is a pure function over this data. No architectural barrier.

---

## Stage 8 — RecordedWorkflow

> **Logical actions are ordered and grouped into a workflow, with boundaries and
> branch points.**

### What happens (designed — post-Phase-5, not yet implemented)

The workflow builder takes the ordered LogicalActions and identifies boundaries:

```
Action 1: SET_VALUE 'Travel Class' = 'Premium Economy'   (on /search)
Action 2: ENTER_TEXT 'Email' = 'user@example.com'         (on /search)
Action 3: TOGGLE 'Accept terms' = true                    (on /search)
Action 4: NAVIGATE 'Search flights' → /results            (BOUNDARY: /search → /results)
```

The NAVIGATE action (`t5`) is a **workflow boundary** — the URL changed from
`/search` to `/results`. This divides the recording into two workflow phases:

- Phase 1 (on `/search`): Actions 1–3 (set travel class, enter email, accept terms).
- Boundary: Action 4 (navigation).
- Phase 2 (on `/results`): (empty in this recording — recording stopped).

The workflow builder also identifies **branch points** from option sets — choices
the user *didn't* make:

```typescript
BranchPoint {
  componentId: 'comp-0001',
  availableOptions: ['Economy', 'Premium Economy', 'Business', 'First Class'],
  chosenOption: 'Premium Economy',
  // 3 unchosen options → 3 potential alternate flows
}
```

The result:

```typescript
RecordedWorkflow {
  surfaceTransitions: [
    { fromUrl: '/search', toUrl: '/results', triggeredBy: 't5' },
  ],
  logicalActions: [
    { componentId: 'comp-0001', actionType: 'SET_VALUE',
      businessField: 'Travel Class', value: 'Premium Economy', transitionIds: ['t1','t2'] },
    { componentId: null, actionType: 'ENTER_TEXT',
      businessField: 'Email', value: 'user@example.com', transitionIds: ['t3'] },
    { componentId: 'comp-0002', actionType: 'TOGGLE',
      businessField: 'Accept terms', value: true, transitionIds: ['t4'] },
    { componentId: null, actionType: 'NAVIGATE',
      businessField: 'Search flights', value: '/results', transitionIds: ['t5'] },
  ],
  branchPoints: [
    { componentId: 'comp-0001',
      availableOptions: ['Economy','Premium Economy','Business','First Class'],
      chosenOption: 'Premium Economy' },
  ],
  optionalSteps: [],
}
```

**At this stage, there is:**
- A structured workflow: ordered business-level actions, grouped by page, with
  boundaries and branch points.
- Branch points reveal the space of possible alternate flows (the user could have
  chosen Economy, Business, or First Class).

**Observed vs inferred:** **Pure inference.** The workflow is derived from ordered
LogicalActions + navigation transitions + option sets.

**Foundational entities created/updated:** None. RecordedWorkflow is a derived view.

**Derived views available:** ✅ RecordedWorkflow.

**Knowledge still unavailable:** "The user was booking a premium-economy flight" —
that's user intent (Layer 5), which requires AI reasoning over the workflow.

**Future capabilities possible at this stage:**
- **Workflow generation:** alternate flows from branch points (test Economy, Business,
  First Class selections).
- **Reporting:** workflow-level summaries instead of step lists.

**Implementation status:** ⏸️ **Deferred** (post-Phase-5). Depends on Semantic
Aggregation (Stage 7). Derivation is a pure function over LogicalActions +
transitions. No architectural barrier.

---

## Stage 9 — ApplicationKnowledgeFragment

> **All foundations + all materialized views are assembled into the final output.**

### What happens (designed — Phase 5, not yet implemented)

The fragment is the **dual output** of the recording pipeline — alongside the test
steps. It assembles:

```typescript
ApplicationKnowledgeFragment {
  sessionId: 'session-001',
  generatedAt: 1719...,        // timestamp
  schemaVersion: 1,

  // ── Foundations (the three persisted entities, summarized) ──
  elements: [
    { elementId: 'div.travel-class', tag: 'div', role: 'combobox',
      accessibleName: 'Travel Class', capabilities: [CLICK, FOCUS, HOVER],
      componentId: 'comp-0001', componentRole: 'trigger', sourceUrl: '/search' },
    { elementId: 'ul.options', ..., componentId: 'comp-0001', componentRole: 'container' },
    { elementId: 'div.option-premium', ..., componentId: 'comp-0001', componentRole: 'option' },
    { elementId: 'input#email', tag: 'input', role: null,
      capabilities: [ACCEPT_TEXT, FOCUS], componentId: null, sourceUrl: '/search' },
    { elementId: 'input#terms', tag: 'input', role: 'checkbox',
      capabilities: [CLICK, TOGGLE], componentId: 'comp-0002', sourceRole: 'trigger' },
    { elementId: 'button#search', ..., componentId: null, sourceUrl: '/search' },
  ],

  transitions: [
    { transitionId: 't1', elementId: 'div.travel-class', componentId: 'comp-0001',
      operation: 'click', timestamp: 1000, relevance: 'deliberate' },
    { transitionId: 't2', elementId: 'div.option-premium', componentId: 'comp-0001',
      operation: 'select', timestamp: 1200, relevance: 'deliberate' },
    { transitionId: 't3', elementId: 'input#email', componentId: null,
      operation: 'type', timestamp: 1400, relevance: 'deliberate' },
    { transitionId: 't4', elementId: 'input#terms', componentId: 'comp-0002',
      operation: 'toggle', timestamp: 1600, relevance: 'deliberate' },
    { transitionId: 't5', elementId: 'button#search', componentId: null,
      operation: 'navigate', timestamp: 1800, relevance: 'deliberate' },
  ],

  components: [
    { groupingId: 'comp-0001', patternType: 'dropdown', rootElementId: 'div.travel-class',
      constituentCount: 3, businessField: 'Travel Class', lifecycleState: 'confirmed',
      optionCount: 4 },
    { groupingId: 'comp-0002', patternType: 'checkbox', rootElementId: 'input#terms',
      constituentCount: 1, businessField: 'Accept terms', lifecycleState: 'confirmed',
      optionCount: null },
  ],

  // ── Derived views (materialized at enrichment) ──
  interactionContracts: [
    { appliesTo: 'input#email', constraints: { required: true, inputType: 'email',
      lengthRange: { min: 5, max: 100 }, format: 'email' } },
  ],

  behavioralContracts: [
    { appliesTo: 'comp-0001', stateMachine: { states: ['closed','open','selected'],
      terminalStates: ['selected'] }, cascadeEffects: [...] },
  ],
}
```

(The fragment also includes the RecordedWorkflow and ApplicationSurface once those
views are materialized.)

**At this stage, there is:**
- The complete semantic understanding of the recording: what elements exist, what
  components they form, what inputs they accept, how they behave, and what the user
  did — all in one queryable structure.
- This is the **source of truth** that all future capabilities consume.

**Observed vs inferred:** The fragment contains **both**: foundations (observed) +
views (inferred). But the inferred parts are always recomputable from the observed
parts. The fragment is a convenience assembly, not new knowledge.

**Foundational entities created/updated:** None — the fragment is assembled from
existing entities.

**Derived views available:** ✅ All four (InteractionContract, BehavioralContract,
ApplicationSurface, RecordedWorkflow) once materialized.

**Implementation status:** 🔵 **Type implemented** (ApplicationKnowledgeFragment in
`application-knowledge.ts`). **Assembly not yet built** — depends on enrichment
(Stage 6) and aggregation (Stages 7–8). No architectural barrier.

---

## Stage 10 — Future Consumer Capabilities

> **Each capability reads specific knowledge from the fragment.**

Now that the fragment exists, future capabilities can consume it. Each capability
traces to specific fields:

### Test Generation
```
Reads: components[] (confirmed, with businessField)
       + RecordedWorkflow.logicalActions[]
Produces: "Set Travel Class to 'Premium Economy'" (semantic step)
          instead of "Click div.option-premium" (mechanical step)
```
Available from Stage 5 (confirmed components) + Stage 7 (logical actions).

### Boundary Testing
```
Reads: InteractionContract.constraints.lengthRange {min: 5, max: 100}
       + ComponentGrouping.optionSet (4 options)
Produces: Test email with 4 chars (below min), 5 chars (min boundary),
          100 chars (max boundary), 101 chars (above max).
          Test all 4 dropdown options + no-selection state.
```
Available from Stage 6 (InteractionContract + optionSet).

### Negative Testing
```
Reads: InteractionContract.constraints {required: true, format: 'email'}
       + BehavioralContract.validationBehavior
Produces: Submit with empty email (required violation),
          Enter "not-an-email" (format violation),
          Enter "'; DROP TABLE--" (injection attempt).
```
Available from Stage 6 (InteractionContract + BehavioralContract).

### Accessibility Testing
```
Reads: UiElement.identity.ariaRole + domAttributes for every element
Produces: Verify combobox has aria-expanded, options have aria-selected,
          email field has associated label, checkbox has accessible name.
```
Available from Stage 3 (UiElement with ARIA data).

### Self-Healing
```
Reads: UiElement.identity.locatorStrategies (ranked fallback locators)
       + ComponentGrouping (semantic context for fallback)
Produces: If div.option-premium's CSS selector breaks, try aria selector,
          then try "the option with text 'Premium Economy' in the
          Travel Class dropdown" (semantic fallback).
```
Available from Stage 3 (UiElement) + Stage 5 (confirmed components).

### Workflow Generation (alternate flows)
```
Reads: RecordedWorkflow.branchPoints
Produces: Re-run the recording but select 'Economy' instead of
          'Premium Economy'. Re-run with 'Business'. Re-run with 'First'.
          3 alternate flows from 1 branch point.
```
Available from Stage 8 (RecordedWorkflow with branch points).

### AI Reasoning
```
Reads: ApplicationKnowledgeFragment (the entire model)
Produces: "This is a flight search form. The user selected premium
          economy and entered their email. The form validates the email
          format. Suggest testing edge cases for international phone
          numbers if a phone field is added."
```
Available from Stage 9 (complete fragment). AI is a consumer — it reads the
model, it doesn't define it.

### Reporting
```
Reads: RecordedWorkflow + ApplicationSurface + components[]
Produces: "Travel Booking form (/search): 6 interactive elements,
          1 dropdown (4 options), 1 checkbox, 1 required email field.
          User flow: Set travel class → Enter email → Accept terms → Search.
          Validation: email format (inline, on blur)."
```
Available from Stage 8 + Stage 9.

---

## How Higher-Level Understanding Emerges Without New Entities

The central question: **how do Semantic Aggregation, RecordedWorkflow, and user
intent emerge from the current architecture without new foundational entities?**

The answer: **each layer of understanding is a pure function of the layer below it.**

```
UiElement + ObservedTransition         ← PERSISTED (observed, irreducible)
        │
        │  (recognition: Phases 2-4, implemented)
        ▼
ComponentGrouping                      ← PERSISTED (inferred, expensive to recompute)
        │
        │  (enrichment: Phase 5, materializes views)
        ▼
InteractionContract + BehavioralContract   ← DERIVED (computed from foundations)
        │
        │  (aggregation: groups transitions by lifecycle)
        ▼
LogicalAction                          ← DERIVED (computed from components + transitions)
        │
        │  (workflow building: orders actions, detects boundaries)
        ▼
RecordedWorkflow                       ← DERIVED (computed from logical actions)
        │
        │  (AI reasoning: consumer reads the model)
        ▼
User Intent                            ← CONSUMER OUTPUT (AI reads, doesn't persist)
```

### Why no new entities are needed at each layer

**InteractionContract** reads `UiElement.domAttributes`. It's a parsing function:
`domAttributes → InteractionContract`. No new data is captured; existing data is
reinterpreted.

**BehavioralContract** reads `ComponentGrouping.observedTransitionIds` + the
referenced `ObservedTransition[]`. It's a synthesis function: `transitions →
StateMachine`. No new data is captured; observed transitions are rearranged into a
state machine.

**LogicalAction** (Semantic Aggregation) reads `ComponentGrouping.observedTransitionIds`
+ `PatternDefinition.expectedLifecycle`. It's a grouping function: `transitions +
lifecycle → grouped action`. The lifecycle phases (OPEN, SELECT, CLOSE) are already
declared in the pattern catalogue. No new data is captured; transitions are bucketed
by phase.

**RecordedWorkflow** reads ordered `LogicalAction[]` + navigation transitions. It's
an ordering + boundary-detection function: `actions + navigations → workflow`. No new
data is captured; actions are sequenced and split at navigation boundaries.

**User intent** reads `RecordedWorkflow` + `ApplicationKnowledgeFragment`. It's AI
reasoning: `workflow + model → intent description`. This is a **consumer output** —
it's never persisted. The AI reads the model and produces a description; if the AI
improves, the description improves, but the model is unchanged.

### The key invariant

At every layer, the computation is:
- **Deterministic** (except AI reasoning, which is advisory).
- **Traceable** — each derived record links back to its source entities.
- **Recomputable** — if the foundations exist, the derivation can always be re-run.
- **Non-mutating** — derived views never modify the foundational entities.

This is why the three foundational entities are sufficient. They carry the
**irreducible observed facts** (what elements exist, what transitions occurred, what
components were recognized). Everything above is computation over those facts.

---

## Why This Validates the Architecture

This walkthrough demonstrates five properties that together prove the architecture is
sound and complete-in-design:

### 1. The ladder is continuous — no gaps require new entities

Every layer of understanding (from raw events to user intent) is reachable from the
layer below by **pure computation**. At no point does a layer need information that
isn't already captured in a lower layer or derivable from one. The "six-layer ladder"
is not six separate systems — it's six views of the same data, at increasing levels
of abstraction.

### 2. Observed and inferred are cleanly separated

The split maps exactly onto the persisted/derived boundary:
- **Stages 0–5** produce observed facts (UiElements, ObservedTransitions,
  ComponentGroupings). These are persisted because they're irreducible.
- **Stages 6–8** produce inferred knowledge (contracts, logical actions, workflows).
  These are derived because they're recomputable.

Nothing observed is re-derived, and nothing derived is persisted as if it were
observed. The architecture enforces this structurally (foundational entities have
factory functions + invariant validation; derived views are read-only interfaces).

### 3. The three entities carry exactly the right data

Tracing the walkthrough, every computation at every stage reads only fields that
already exist on the three foundational entities:

| Computation | Reads from |
|-------------|-----------|
| Structural recognition | `UiElement.identity.ariaRole` (ancestor chain) |
| Behavioral recognition | `ObservedTransition.evidence`, `.cascadeEffects` |
| Identity resolution | `ComponentGrouping.rootElementId`, `.constituents` |
| Lifecycle progression | `ComponentGrouping.observedTransitionIds` + `expectedLifecycle` |
| Option set extraction | `ComponentGrouping.constituents` (DOM inspection) |
| InteractionContract | `UiElement.domAttributes` |
| BehavioralContract | `ComponentGrouping.observedTransitionIds` → `ObservedTransition[]` |
| Semantic Aggregation | `ComponentGrouping.observedTransitionIds` + `expectedLifecycle` |
| RecordedWorkflow | Ordered `LogicalAction[]` + `ObservedTransition.operation` (NAVIGATE) |

No computation needed a field that doesn't exist. The entities were designed to carry
exactly the data that all downstream stages need — and they do.

### 4. Deferred stages require no architectural change

Stages 6–8 (enrichment, aggregation, workflow) are **not yet implemented**, but this
walkthrough shows they require:
- **Zero new foundational entities.** (They compute over the three we have.)
- **Zero changes to existing entities.** (They read existing fields; enrichment
  populates schema-ready fields like `optionSet` and `businessField`.)
- **Zero changes to the orchestrator or registry.** (They run post-recording.)
- **One new derived-view type per stage** (LogicalAction, RecordedWorkflow,
  ApplicationSurface) — same status as the existing InteractionContract and
  BehavioralContract.

The architecture was designed for this. The `expectedLifecycle` field on
`PatternDefinition` exists *precisely* so that Semantic Aggregation can group
transitions by lifecycle phase without pattern-specific logic. The `optionSet` field
on `ComponentGrouping` is null *precisely* because it's populated by post-recording
DOM inspection, not by recognition. These design decisions are paying off.

### 5. The application-centric principle holds end-to-end

At every stage, the knowledge describes **the application**, not AI's interpretation
of it:
- UiElements describe elements (application structure).
- ObservedTransitions describe behavior (application dynamics).
- ComponentGroupings describe patterns (application semantics).
- InteractionContracts describe input rules (application constraints).
- BehavioralContracts describe state machines (application behavior).
- RecordedWorkflows describe user flows (application workflows).

AI appears only at the final stage — as a **consumer** that reads the model and
produces advisory reasoning. The model never stores AI's opinion; AI reads the model.
This is the application-centric principle, validated end-to-end.

---

### Conclusion

This walkthrough proves that the current architecture — implemented through Phase 4,
plus the planned Phase 5 enrichment — naturally evolves browser events into
application understanding. The evolution is continuous (no gaps), cleanly separated
(observed vs inferred), and requires no new foundational entities or architectural
changes for the deferred stages.

The three foundational entities (UiElement, ObservedTransition, ComponentGrouping)
carry exactly the data that every downstream stage needs. Semantic Aggregation,
RecordedWorkflow, and higher-level understanding all emerge as pure computations
over these entities — derivations, not new captures.

The architecture is ready for Phase 5.

---

*Document authored: 2026-07-21. Walkthrough grounded in implementation through Phase 4
(commit `c66738d`). Pattern definitions, entity fields, and orchestrator logic
verified against actual source code.*
