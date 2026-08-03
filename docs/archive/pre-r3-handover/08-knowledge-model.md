# 8. Knowledge Model

This document explains how the AI Extension transforms raw user interactions into structured application knowledge. It traces the journey from a single click to a complete `ApplicationKnowledgeFragment`.

---

## The Core Insight: State-Centric Understanding

Traditional recorders think in **events**: "user clicked X, then clicked Y." CmdRunner thinks in **state**: "element X transitioned from state A to state B, and this caused element Y to become visible."

This state-centric approach is fundamental. It's why the system can:
- Recognize that 5 separate clicks form a single "select option from dropdown" action
- Understand that typing 10 characters is one "enter text" action, not 10
- Detect that clicking a button caused a dialog to appear (cascade effect)

---

## The Three Foundational Entities

All knowledge is built on three persisted entities. These carry **only deterministic, observation-derived data** — no AI opinions, no probabilistic inference.

### 1. UiElement

The atomic unit of the UI. Created when the user first interacts with an element.

```
UiElement
├── elementId              "elem-001" (session-scoped)
├── identity               18-field signature:
│   ├── tag                "div", "input", "select", "a", ...
│   ├── ariaRole           "combobox", "listbox", "checkbox", ...
│   ├── accessibleName     "Travel Class" (from aria-label, label, text)
│   ├── cssPath            "form > div.dropdown > div.trigger"
│   ├── xpath              "//form/div[2]/div[1]"
│   ├── testId             data-testid value (if present)
│   ├── type               input type (text, email, date, ...)
│   ├── classes            CSS class list
│   ├── iframeContext      frame info (if inside iframe)
│   └── ... (9 more fields)
├── domAttributes          Raw attribute map: { role, aria-expanded, type, ... }
├── sourceUrl              Page URL where element was observed
├── domTreePath            Full DOM path
├── intrinsicCapabilities  [click, focus, acceptText, ...] (derived from tag+role)
├── componentId            null → assigned when recognized as part of a pattern
└── componentRole          null → assigned (trigger, option, container, ...)
```

**What makes this trustworthy:** Every field is directly observable from the DOM. No inference. No guessing. The same element on the same page always produces the same `UiElement`.

### 2. ObservedTransition

An empirical record of a state change. Created every time the user interacts with an element.

```
ObservedTransition
├── transitionId           "trans-001"
├── elementId              References the UiElement
├── componentId            null → assigned when part of a recognized component
├── operation              click | fill | select | toggle | hover | navigate | selectDate
├── timestamp              When it happened
├── relevance              deliberate | supporting | noise
├── stateBefore            { value: null, checked: null, expanded: false, selected: null }
├── stateAfter             { value: "economy", checked: null, expanded: true, selected: null }
├── evidence[]             [
│                             { type: "valueChange", description: "Selected Economy", before: null, after: "economy" },
│                             { type: "stateChange", description: "aria-expanded changed", before: "false", after: "true" }
│                           ]
├── cascadeEffects[]       [{ elementId: "price-display", effect: "value", detail: "Price updated" }]
└── validationResult       null | { triggered: true, responseType: "inline", message: "Required" }
```

**What makes this trustworthy:** State is captured before and after the interaction. Evidence is typed and concrete. Cascade effects are observed DOM mutations, not inferred.

### 3. ComponentGrouping

A recognized UI pattern. Created when the recognition system identifies a group of elements as a pattern (dropdown, checkbox, modal, etc.).

```
ComponentGrouping
├── groupingId             "comp-001"
├── patternType            dropdown | checkbox | radioGroup | datePicker | modal | tabs | ...
├── rootElementId          The trigger element
├── constituents[]         [{ elementId: "trigger", role: "TRIGGER" }, { elementId: "list", role: "CONTAINER" }]
├── businessField          null → populated during enrichment ("Travel Class")
├── recognitionSource      structural | behavioral | ai-assisted
├── recognitionConfidence  0.05 – 0.95
├── lifecycleState         tentative → developing → confirmed | rejected
├── optionSet              null → populated during DOM inspection
│                           [{ value: "economy", label: "Economy", selected: true, disabled: false }, ...]
└── observedTransitionIds  References to transitions that affected this component
```

**Lifecycle:** Components are never created fully formed. They progress:
1. **TENTATIVE** — structural recognizer found a pattern hint
2. **DEVELOPING** — behavioral recognizer found supporting evidence (first transition observed)
3. **CONFIRMED** — sufficient evidence accumulated
4. **REJECTED** — evidence contradicted the initial recognition

**Only CONFIRMED components are enriched.** This is a hard invariant.

---

## Component Recognition (3-Tier)

```
Tier 1: Structural Recognizer (<1ms, ~40-50% coverage)
    └─ Matches ARIA roles and HTML structure against pattern catalogue
    └─ Example: div[role="combobox"] + div[role="listbox"] → DROPDOWN pattern
         │
         ▼
Tier 2: Behavioral Recognizer (~5ms, ~35-45% additional)
    └─ Matches coalescer evidence signatures against pattern definitions
    └─ Example: trigger expanded + children became visible + children are clickable → DROPDOWN
         │
         ▼
Tier 3: AI-Assisted (async, ~10-20% remaining)
    └─ AI interprets unrecognized interaction patterns
    └─ Advisory only, evidence sovereignty applies
```

The pattern catalogue (`pattern-catalogue.ts`) is the declarative source of truth. Each pattern definition includes:
- `rootAriaRoles` — what ARIA roles identify the root element
- `constituentRoles` — mapping of ComponentRole to acceptable ARIA roles
- `behavioralSignature` — ordered conditions for behavioral recognition
- `expectedLifecycle` — the sequence of operations that form a complete interaction (e.g., dropdown = [CLICK, SELECT])
- `affordances` — what the pattern can do (click, select, toggle)

---

## Semantic Aggregation

The core innovation of Phase 5. Groups multiple transitions into single logical actions.

### The Problem
A user selecting "Economy" from a dropdown generates 2+ transitions:
1. CLICK on the trigger (opens the dropdown)
2. SELECT on an option (chooses "Economy")
3. (Optionally) CLICK elsewhere (closes the dropdown)

Without aggregation, these are 2-3 separate test steps. With aggregation, they become one logical action: "Select 'Economy' from the Travel Class dropdown."

### The Solution: Lifecycle Occurrence Segmentation

The algorithm uses each component's `expectedLifecycle` from the pattern catalogue:

```
For each component's transitions (sorted by timestamp):

  expectedLifecycle = pattern.expectedLifecycle  // e.g., [CLICK, SELECT] for dropdown

  Rule A (Restart — multi-op lifecycles only):
    When the initial operation reappears AND buffer is non-empty
    → Close current occurrence, start new one
    Example: CLICK, SELECT, CLICK, SELECT → 2 occurrences

  Rule B (Gap — intervening operations):
    When an operation NOT in expectedLifecycle appears
    → Close current occurrence, skip the transition
    Example: FILL, CLICK, FILL → 2 occurrences (click closes first)

  Rule C (Temporal Gap — configurable, disabled by default):
    When time between consecutive transitions exceeds threshold
    → Close current occurrence

  Single-op lifecycles (e.g., [TOGGLE] for checkbox):
    Rule A doesn't apply (length 1)
    Consecutive operations of the same type aggregate
    Example: TOGGLE, TOGGLE, TOGGLE → 1 occurrence with final state
```

### Output: LogicalAction

```
LogicalAction
├── actionId               "action-1"
├── componentId            "comp-001" (null for standalone transitions)
├── businessField          "Travel Class" (from enriched component)
├── transitionIds          ["trans-001", "trans-002"] (references, not copies)
├── lifecycleComplete      true (all expected operations observed)
├── resultingChange        { targetElementId, field: "value", from: null, to: "economy" }
└── timestamp              First transition's timestamp
```

**Critical design decision:** `LogicalAction` has **no `actionType` enum**. It is a structural description. Consumers derive classifications from the structural data — the model doesn't impose a taxonomy.

---

## Derived Views (Materialized Post-Recording)

### InteractionContract
Derived from DOM attributes. Describes what an element accepts.

```
InteractionContract
├── appliesTo              { type: "element", id: "elem-001" }
├── affordances            ["click", "focus", "acceptText"]
└── constraints
    ├── required           true | false | null
    ├── inputType          "email" | "number" | "text" | null
    ├── valueRange         { min: 0, max: 100, step: 5 } | null
    ├── lengthRange        { minLength: 2, maxLength: 50 } | null
    ├── format             { regex: "[0-9]{4}", description: "PIN pattern" } | null
    ├── validOptions       [{ value, label, selected, disabled }] | null  (from optionSet)
    └── dateFormat         { format: "yyyy-MM-dd", earliest, latest } | null
```

### BehavioralContract
Synthesized from observed transitions. Describes how a component behaves.

```
BehavioralContract
├── appliesTo              { type: "component", id: "comp-001" }
├── stateMachine
│   ├── states             [{ name: "e:false", isInitial: true }, { name: "e:true", isTerminal: false }]
│   ├── transitions        [{ from: "e:false", to: "e:true", operation: "click", observed: true }]
│   └── terminalStates     ["e:false"]
├── validationBehavior     { triggerTiming: "onBlur", responseType: "inline", errorMessages: [...] } | null
├── cascadeEffects         [{ affectsEntityId: "price-1", effect: "value", trigger: "select on trigger-1" }]
└── successIndicators      [{ type: "valueDisplay", signal: "Economy", description: "..." }]
```

### RecordedWorkflow
Derived from transitions + components + logical actions.

```
RecordedWorkflow
├── surfaceTransitions     [{ fromUrl, toUrl, triggeredByTransitionId }] (navigation boundaries)
├── logicalActions         LogicalAction[] (passthrough from aggregator)
├── branchPoints           [{ componentId, availableOptions, chosenOption }] (from option sets)
└── optionalSteps          [{ actionId }] (actions composed entirely of supporting transitions)
```

### ApplicationSurface
Elements grouped by source URL.

```
ApplicationSurface
├── url                    "https://app.com/booking"
├── elementIds             ["elem-001", "elem-002", ...]
└── componentIds           ["comp-001", "comp-002"]
```

---

## ApplicationKnowledgeFragment

The final aggregate output of the enrichment pipeline. Combines foundational entities (as compact summaries) with all derived views.

```
ApplicationKnowledgeFragment
├── sessionId              "session-001"
├── generatedAt            ISO timestamp
├── schemaVersion          1
│
├── elements               UiElementSummary[] (compact: id, tag, role, name, capabilities, component)
├── transitions            TransitionSummary[] (compact: id, elementId, operation, timestamp, relevance)
├── components             ComponentSummary[] (compact: id, patternType, businessField, optionCount)
│
├── interactionContracts   InteractionContract[]
├── behavioralContracts    BehavioralContract[]
├── logicalActions         LogicalAction[]
├── recordedWorkflow       RecordedWorkflow
└── applicationSurfaces    ApplicationSurface[]
```

---

## How Knowledge Evolves: End-to-End Example

**Scenario:** User books a flight — navigates to a booking page, selects "Economy" from a dropdown, types "John Doe" in a name field, and clicks "Search".

```
Step 1: Navigation
  → ObservedTransition: { operation: NAVIGATE, evidence: [{ type: NAVIGATION, after: "/booking" }] }
  → UiElement created for the navigation link

Step 2: Click dropdown trigger
  → UiElement created: { tag: "div", role: "combobox", accessibleName: "Travel Class" }
  → ObservedTransition: { operation: CLICK, stateBefore: { expanded: false }, stateAfter: { expanded: true } }
  → Structural Recognizer: combobox + nearby listbox → DROPDOWN pattern → ComponentGrouping (TENTATIVE)

Step 3: Select "Economy"
  → ObservedTransition: { operation: SELECT, stateAfter: { value: "economy" } }
  → ComponentGrouping advances: TENTATIVE → DEVELOPING → CONFIRMED (full lifecycle observed)

Step 4: Type "John Doe"
  → UiElement created: { tag: "input", type: "text", accessibleName: "Passenger Name" }
  → ObservedTransition: { operation: FILL, stateAfter: { value: "John Doe" } }

Step 5: Post-Recording Enrichment
  → Option Set Extraction: DOM inspection finds 3 options (Economy, Business, First)
    → ComponentGrouping.optionSet populated
    → ComponentGrouping.businessField = "Travel Class"
  → Interaction Contract: name input → { required: true, minLength: 2, maxLength: 50 }
  → Behavioral Contract: dropdown → state machine with expanded/collapsed states
  → Semantic Aggregation:
    → Dropdown: [CLICK, SELECT] → 1 LogicalAction (complete)
    → Name field: [FILL] → 1 LogicalAction (standalone, complete)
  → Workflow Derivation: 1 surface transition (navigation), 1 branch point (dropdown)
  → Fragment Assembly: ApplicationKnowledgeFragment produced
```

The fragment now contains everything needed to generate a high-quality test suite AND understand the application's structure.
