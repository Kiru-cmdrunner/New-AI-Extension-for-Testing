# Phase 5 — Post-Recording Enrichment, Semantic Aggregation & Workflow Derivation

> **Status:** Complete — implemented, tested (145 tests, 8 files), verified.
>
> **Architectural reference:** This spec is measured against
> `docs/architecture-review.md`, `docs/architecture-validation.md`, and
> `docs/architecture-walkthrough.md`. Every decision below traces to a principle
> in those documents. No new foundational entities. No changes to the three
> foundations. Derived views only.

## Objective

Materialize the derived views from the foundational entities and assemble the
`ApplicationKnowledgeFragment`. This is the stage that bridges **observed**
(what the user interacted with) to **inferred** (what the application is).

Three concerns, in dependency order:

1. **Post-Recording Enrichment** — per-element and per-component derived views
   (InteractionContract, BehavioralContract) via read-only DOM inspection and
   transition synthesis.
2. **Semantic Aggregation** — groups transitions into logical user actions
   (LogicalAction[]). Generic, driven by the knowledge model, derived computation.
3. **RecordedWorkflow & Fragment Assembly** — orders logical actions, detects
   workflow boundaries, assembles the final fragment.

## Architectural Constraints (inviolate)

These constraints come directly from the validated architecture and the project
owner's explicit requirements for Phase 5:

1. **No new foundational entities.** UiElement, ObservedTransition,
   ComponentGrouping are the only persisted entities. All Phase 5 output is derived
   views.
2. **No changes to the three foundational entities.** Phase 5 reads existing fields
   (`domAttributes`, `observedTransitionIds`, `optionSet`, `businessField`). The only
   entity mutations are populating schema-ready fields (`optionSet`, `businessField`)
   that were designed to be null until enrichment.
3. **Foundational entities only carry deterministic observation-derived knowledge.**
   AI opinions, probabilistic inference, or semantic interpretations remain OUTSIDE
   the persisted foundational entities unless the model is intentionally redesigned.
   The fields Phase 5 populates (`optionSet` from DOM inspection, `businessField`
   from accessibleName/label) are deterministic observations, not interpretations.
4. **Semantic Aggregation is generic.** Zero pattern-specific logic. All pattern
   knowledge comes from `PatternDefinition.expectedLifecycle` in the catalogue.
5. **Semantic Aggregation is driven by the existing knowledge model.** It reads
   `ComponentGrouping.observedTransitionIds` + `expectedLifecycle` + enriched data
   (`businessField`, `optionSet`). It does not capture new information.
6. **Semantic Aggregation is a derived computation.** LogicalAction is a derived-view
   type (like InteractionContract), not a foundational entity. It references
   foundational entities by ID but does not mutate them.
7. **Logical actions are structurally described, not classified.** No actionType
   enum. A logical action is described by {component, transitions, business field,
   resulting change, completeness}. Consumers derive classifications from this
   structural data — the model does not impose a taxonomy.
8. **Read-only DOM inspection.** The enrichment pass inspects the current page state
   to extract option sets. It does not simulate interactions, dispatch events, or
   modify the DOM.
9. **If any part of the architecture genuinely needs to evolve, STOP and discuss
   before implementing.** (Project owner's explicit instruction.)

## Scope

### In scope

| # | Concern | Type | New types? |
|---|---------|------|-----------|
| 1 | InteractionContract derivation | Enrichment | No (type exists) |
| 2 | BehavioralContract derivation | Enrichment | No (type exists) |
| 3 | Option set extraction | Enrichment | No (field exists on ComponentGrouping) |
| 4 | BusinessField population | Enrichment | No (field exists on ComponentGrouping) |
| 5 | LogicalAction type + aggregation | Semantic Aggregation | Yes (new derived type) |
| 6 | RecordedWorkflow type + derivation | Workflow | Yes (new derived type) |
| 7 | ApplicationSurface type + derivation | View | Yes (new derived type) |
| 8 | Fragment assembly (extend existing type) | Assembly | No (type exists, extend) |
| 9 | Enrichment orchestrator (the pass itself) | Computation | New module |

### Out of scope (deferred)

| Concern | Why deferred |
|---------|-------------|
| Wiring enrichment into the live recording pipeline | Recognition (`processInteraction`) is not yet wired into the recorder. Enrichment will be tested against fixtures. Pipeline wiring is a separate task. |
| SemanticRelationship graph | On-demand computation, lower priority. Can be added later without architectural change. |
| Persistence of the fragment | IndexedDB storage layer is a separate concern. Fragment is produced in-memory. |
| Tier 3 AI recognition | Separate phase; interface is ready. |

## Design

### 1. InteractionContract Derivation

**Input:** `UiElement.domAttributes`
**Output:** `InteractionContract`
**Status:** Type exists in `application-knowledge.ts`.

A pure function that parses DOM attributes into semantic constraints:

```
deriveInteractionContract(element: UiElement): InteractionContract
```

Parsing rules (all derived from `domAttributes`):
- `required` present → `constraints.required = true`
- `type="email"` → `constraints.inputType = 'email'`, `constraints.format = 'email'`
- `type="number"` + `min`/`max`/`step` → `constraints.valueRange = {min, max, step}`
- `minlength`/`maxlength` → `constraints.lengthRange = {min, max}`
- `pattern` attribute → `constraints.format = pattern value`
- Element is part of a component with `optionSet` → `constraints.validOptions = optionSet`

No DOM inspection needed — `domAttributes` is already captured on the UiElement.

### 2. BehavioralContract Derivation

**Input:** `ComponentGrouping` + its `ObservedTransition[]` + `PatternDefinition`
**Output:** `BehavioralContract`
**Status:** Type exists in `application-knowledge.ts`.

A pure function that synthesizes a state machine from observed transitions:

```
deriveBehavioralContract(
  component: ComponentGrouping,
  transitions: ObservedTransition[],
  pattern: PatternDefinition,
): BehavioralContract
```

Synthesis:
- **StateMachine:** infer states from `stateBefore`/`stateAfter` of observed
  transitions. States are derived from observed `ElementState` values (e.g.,
  `expanded: false` → "closed", `expanded: true` → "open", `selected: true` →
  "selected"). Terminal states = final observed state.
- **ValidationBehavior:** extract from transitions where `validationResult.triggered
  === true`. Derive `triggerTiming` (onBlur/onChange/onSubmit) from transition
  evidence, `responseType` from `validationResult.responseType`.
- **CascadeEffects:** summarize from `ObservedTransition.cascadeEffects` — group by
  trigger element + affected element.
- **SuccessIndicators:** derive from cascade effects and state changes (e.g., trigger
  text changed → `valueDisplay` success indicator).

### 3. Option Set Extraction

**Input:** `ComponentGrouping` (confirmed, with constituent elements)
**Output:** Populates `ComponentGrouping.optionSet` and `businessField`

The enrichment pass inspects the component's container constituent in the DOM to
extract all options (not just the one the user selected). This is the stage that
discovers options the user never interacted with.

**Design decision — DOM access abstraction:** The enrichment pass needs to read the
DOM. Rather than calling `document.querySelector` directly (which couples the
enrichment logic to the browser environment and makes it untestable in jsdom), the
pass will accept a **DOM inspector interface**:

```
interface DomInspector {
  querySelector(elementId: string): DomElementInfo | null;
  querySelectorAll(parentId: string, selector: string): DomElementInfo[];
}

interface DomElementInfo {
  elementId: string;
  attributes: Record<string, string>;
  textContent: string | null;
  children: DomElementInfo[];
}
```

This interface is implemented by a browser adapter (production) and a fixture adapter
(tests). The enrichment logic is pure computation over `DomElementInfo`.

**Why this matters:** It keeps the enrichment logic testable without a real browser,
and it preserves the pattern from the architectural walkthrough where enrichment is
"pure computation over foundations." The DOM inspector is an input source, not a
dependency on browser APIs.

### 4. Semantic Aggregation (the key concern)

**Input:**
- All confirmed `ComponentGrouping`s (with enriched `businessField`, `optionSet`)
- All `ObservedTransition`s (ordered by timestamp)
- `PatternDefinition.expectedLifecycle` (from catalogue)

**Output:** `LogicalAction[]`
**Status:** New derived-view type.

**The aggregation algorithm (generic, zero pattern-specific logic):**

The algorithm operates on four generic concepts — component boundaries, lifecycle
expectations, state changes, and time — without referencing any specific pattern type.

```
aggregateActions(
  components: ComponentGrouping[],
  transitions: ObservedTransition[],
  catalogue: PatternCatalogue,
): LogicalAction[]
```

**Step 1 — Component boundary detection (grouping).**
Every transition carries a `componentId` (set by the orchestrator during recognition).
Transitions sharing a `componentId` are candidates for aggregation. Transitions with
`componentId === null` are standalone — each forms its own action.

*Concept: component boundaries partition the transition stream. Only transitions
within the same boundary can aggregate.*

**Step 2 — Lifecycle occurrence segmentation (within a component).**

*Why segmentation, not naive set-membership:* A naive check
(`expectedLifecycle ⊆ allObservedOperations`) treats operations as a set, discarding
temporal ordering and occurrence count. For a dropdown with
`expectedLifecycle = [CLICK, SELECT]`, reopening and selecting again produces
`{CLICK, SELECT, CLICK, SELECT}` — the set collapses to `{CLICK, SELECT}`, making it
look like one lifecycle when it's actually two. Segmentation splits the transition
stream into discrete lifecycle **occurrences** before checking completeness, so
independent user actions are never merged.

Walk the component's transitions in timestamp order. Maintain a `currentOccurrence`
buffer (a list of transitions). Apply three boundary rules to decide when to close
the current occurrence and start a new one:

  **Rule A — Restart (multi-operation lifecycles only).**
  When `expectedLifecycle.length > 1` AND the current transition's operation equals
  `expectedLifecycle[0]` (the lifecycle's initial operation) AND `currentOccurrence`
  is non-empty → close `currentOccurrence` as one occurrence, start a new one with
  this transition. This detects "reopen dropdown," "expand a second accordion
  section," etc.

  For single-operation lifecycles (`expectedLifecycle.length === 1`), Rule A does
  **not** apply — consecutive same-operations aggregate into one occurrence. This is
  correct because typing `jo` → `john` → `john@example.com` is one incremental
  action (one net state change), not three.

  **Rule B — Gap (intervening operation).**
  When the current transition's operation is NOT in `expectedLifecycle` → close
  `currentOccurrence` as one occurrence, record a gap, start a new one when an
  expected operation reappears. This handles "user clicked something else in
  between."

  **Rule C — Temporal gap (optional heuristic, disabled by default).**
  A configurable time threshold between transitions. Off by default; can be enabled
  if real-world testing shows it's needed.

After segmentation, each occurrence is checked for completeness independently.

**Step 3 — Lifecycle completion flag (per occurrence).**
For each occurrence, check whether the observed operations satisfy the expected
lifecycle:

```
observedOps = set(t.operation for t in occurrence)
expectedOps = set(expectedLifecycle)
lifecycleComplete = expectedOps ⊆ observedOps
```

An occurrence where some expected operations were never observed (e.g., opened a
dropdown but clicked away without selecting) is still emitted as a logical action,
but marked `lifecycleComplete: false`. Consumers can choose to handle or discard
incomplete actions.

*Concept: completeness is a boolean derived from per-occurrence set containment of
operations, not a classification.*

**Representative scenarios (validated against the algorithm):**

  *Reopening the same dropdown* (CLICK, SELECT, CLICK, SELECT with
  expectedLifecycle=[CLICK,SELECT]): Rule A splits at the second CLICK → two
  complete occurrences → two LogicalActions with distinct values.

  *Changing a value multiple times via typing* (TYPE, TYPE, TYPE with
  expectedLifecycle=[TYPE]): Rule A does not apply (length 1) → one occurrence →
  one LogicalAction with the final value. Intermediate values are traceable via
  `transitionIds`.

  *Typing, leaving, returning* (TYPE, CLICK-elsewhere, TYPE with
  expectedLifecycle=[TYPE]): Rule B (CLICK ∉ {TYPE}) closes occ #1, then occ #2
  starts at the second TYPE → two LogicalActions.

  *Partially completing an interaction* (CLICK only, with
  expectedLifecycle=[CLICK,SELECT]): one incomplete occurrence → one LogicalAction
  with `lifecycleComplete: false`.

  *Abandoning halfway through a re-opened interaction* (CLICK, SELECT, CLICK with
  expectedLifecycle=[CLICK,SELECT]): Rule A splits at the third CLICK → occ #1
  complete, occ #2 incomplete → two LogicalActions.

  *Interleaved components* (CLICK-A, CLICK-B, SELECT-B, SELECT-A): handled
  naturally — aggregation processes per-component via `observedTransitionIds`, so
  temporal interleaving across components does not cause cross-component merging.

  *Checkbox toggled multiple times* (TOGGLE, TOGGLE, TOGGLE with
  expectedLifecycle=[TOGGLE]): Rule A does not apply (length 1) → one occurrence →
  one LogicalAction with the final checked state. Net effect captured; individual
  toggles traceable.

**Step 4 — Resulting change derivation.**
For each action group, derive the net state change on the component's root element
by reading the first transition's `stateBefore` and the last transition's
`stateAfter`. This captures what changed as a result of the action: which state
field (value, checked, expanded, selected) moved from what to what.

*Concept: the state change is observed data read from transition boundaries —
the first `stateBefore` and last `stateAfter` of the group. No inference.*

**Step 5 — Temporal ordering.**
Actions are ordered by their first transition's timestamp. This produces the
sequence that feeds RecordedWorkflow.

*Concept: time is the ordering key, derived from transition timestamps.*

**Workflow boundary detection (for RecordedWorkflow):**
A workflow boundary occurs when a transition's operation is `NAVIGATE` (or carries
navigation evidence). Each navigation splits the ordered actions into phases.

*Concept: navigation transitions are natural workflow boundaries, detected by
operation type, not by pattern.*

**Why this is generic:** The algorithm never references any specific pattern type.
It asks "did the observed operations satisfy the expected lifecycle?" — whatever
pattern the component was recognized as, the same logic applies. Adding a new
pattern with a new lifecycle is handled automatically.

**Why this is a derived computation:** LogicalAction references foundational entities
by ID (`componentId`, `transitionIds`) but creates no new persisted data. It can be
recomputed at any time from the same inputs.

**The LogicalAction type (structural description, no action-type taxonomy):**

A logical action is described structurally — by what it acted on, what transitions
composed it, what field it affected, and what state change resulted. It does NOT
carry a classification label (no `actionType` enum). Consumers derive whatever
classification they need from the structural data.

```typescript
interface LogicalAction {
  readonly actionId: string;
  readonly componentId: string | null;       // null for standalone transitions
  readonly businessField: string | null;     // from enrichment (null if not enriched)
  readonly transitionIds: readonly string[]; // the transitions that compose this action
  readonly lifecycleComplete: boolean;       // did observed ops satisfy expectedLifecycle?
  readonly resultingChange: ResultingChange | null;  // net state delta (null if no observable change)
  readonly timestamp: number;                // first transition's timestamp (for ordering)
}

interface ResultingChange {
  readonly targetElementId: string;           // which element's state changed (root/trigger)
  readonly field: 'value' | 'checked' | 'expanded' | 'selected';  // which state field
  readonly from: string | boolean | null;
  readonly to: string | boolean | null;
}
```

**Why no actionType enum:** A predefined action-type taxonomy (SET_VALUE, TOGGLE,
etc.) is a growing classification scheme — the same coupling problem that plagued
the legacy recorder. Instead, the action is described by its structural effects.
The transitions already carry their operations (via `transitionIds` →
`ObservedTransition.operation`). A consumer that needs to classify the action
derives the classification from the structural data — it's not stored on the action.

This means: adding a new pattern or interaction style never requires adding an
action type. The action is always described by {component, transitions, business
field, resulting change, completeness} — regardless of pattern.

### 5. RecordedWorkflow Derivation

**Input:** Ordered `LogicalAction[]` + all `ObservedTransition`s
**Output:** `RecordedWorkflow`
**Status:** New derived-view type.

```
interface RecordedWorkflow {
  readonly surfaceTransitions: SurfaceTransition[];
  readonly logicalActions: LogicalAction[];
  readonly branchPoints: BranchPoint[];
  readonly optionalSteps: LogicalAction[];   // actions from relevance=supporting transitions
}

interface SurfaceTransition {
  readonly fromUrl: string;
  readonly toUrl: string;
  readonly triggeredByTransitionId: string;
}

interface BranchPoint {
  readonly componentId: string;
  readonly availableOptions: string[];
  readonly chosenOption: string;
}
```

**Boundary detection:** A workflow boundary occurs when an `ObservedTransition` has
`operation === NAVIGATE` (or evidence of `NAVIGATION`). Each navigation splits the
workflow into phases. The `fromUrl`/`toUrl` come from the `UiElement.sourceUrl` of
the elements involved.

**Branch point detection:** For each confirmed component with an `optionSet` where
the user selected one option, the unchosen options form a branch point. This reveals
alternate flows the user didn't take.

### 6. ApplicationSurface Derivation

**Input:** All `UiElement`s
**Output:** `ApplicationSurface[]`
**Status:** New derived-view type.

```
interface ApplicationSurface {
  readonly url: string;
  readonly elementIds: string[];
  readonly componentIds: string[];
}
```

Pure grouping: `GROUP BY sourceUrl` over all UiElements. Each surface is a page-level
view of what elements and components exist on that URL.

### 7. Fragment Assembly

**Input:** All foundations + all materialized derived views
**Output:** `ApplicationKnowledgeFragment` (extended)
**Status:** Type exists, will be extended.

The existing `ApplicationKnowledgeFragment` type will be extended with the new derived
views:

```
ApplicationKnowledgeFragment {
  // ... existing fields (sessionId, generatedAt, schemaVersion,
  //     elements[], transitions[], components[],
  //     interactionContracts[], behavioralContracts[])

  // NEW (Phase 5):
  logicalActions: LogicalAction[];      // from Semantic Aggregation
  recordedWorkflow: RecordedWorkflow;   // from Workflow derivation
  applicationSurfaces: ApplicationSurface[];  // from Surface derivation
}
```

### 8. Enrichment Orchestrator

A new module that runs all the above in order:

```
src/recorder/enrichment/enrichment-orchestrator.ts

enrichSession(input: EnrichmentInput): ApplicationKnowledgeFragment

EnrichmentInput {
  elements: UiElement[];
  transitions: ObservedTransition[];
  components: ComponentGrouping[];       // confirmed only
  domInspector: DomInspector;            // abstraction over browser DOM
}
```

Flow:
1. For each confirmed component: extract optionSet + businessField (DOM inspection)
2. For each UiElement: derive InteractionContract
3. For each confirmed component: derive BehavioralContract
4. Semantic Aggregation → LogicalAction[]
5. Workflow derivation → RecordedWorkflow
6. Surface derivation → ApplicationSurface[]
7. Assemble ApplicationKnowledgeFragment

## File Structure

```
src/recorder/enrichment/
├── enrichment-orchestrator.ts       # The enrichment pass (entry point)
├── interaction-contract-deriver.ts  # domAttributes → InteractionContract
├── behavioral-contract-deriver.ts   # transitions → BehavioralContract
├── option-set-extractor.ts          # DOM inspection → optionSet + businessField
├── dom-inspector.ts                 # DomInspector interface + browser adapter
├── semantic-aggregator.ts           # transitions + lifecycle → LogicalAction[]
├── workflow-deriver.ts              # logical actions → RecordedWorkflow
├── surface-deriver.ts               # elements → ApplicationSurface[]
└── fragment-assembler.ts            # foundations + views → ApplicationKnowledgeFragment

src/domain/entities/
└── application-knowledge.ts         # EXTEND: add LogicalAction, RecordedWorkflow,
                                     #   ApplicationSurface, BranchPoint, etc.

tests/enrichment/
├── interaction-contract-deriver.test.ts
├── behavioral-contract-deriver.test.ts
├── option-set-extractor.test.ts
├── semantic-aggregator.test.ts
├── workflow-deriver.test.ts
├── surface-deriver.test.ts
├── fragment-assembler.test.ts
└── enrichment-orchestrator.test.ts  # End-to-end: fixtures → fragment
```

## Testing Strategy

Per the blueprint-first workflow (TDD per phase):

1. **Unit tests** for each deriver (interaction-contract, behavioral-contract,
   option-set, aggregator, workflow, surface, assembler). Each tested in isolation
   with synthetic fixtures.
2. **Integration test** for the enrichment orchestrator: full pipeline from
   foundations → fragment, using the flight booking scenario from
   `architecture-walkthrough.md` as the test fixture.
3. **Semantic Aggregation tests** specifically verify:
   - Generic behavior: same algorithm works for dropdown (CLICK+SELECT), checkbox
     (TOGGLE), accordion (CLICK+TOGGLE) — no pattern-specific code paths.
   - Derived computation: LogicalAction references transition IDs, not copies.
   - Lifecycle completeness: complete vs partial lifecycles produce correct
     `complete` flag.
   - Standalone transitions: transitions without components get their own actions.

## Acceptance Criteria

- [x] InteractionContract correctly derives constraints from domAttributes
- [x] BehavioralContract correctly synthesizes state machines from transitions
- [x] Option set extraction discovers options the user didn't interact with
- [x] BusinessField populated from accessibleName/label of component root
- [x] Semantic Aggregation produces LogicalAction[] from confirmed components
- [x] Semantic Aggregation is generic (zero PatternType.* references)
- [x] Semantic Aggregation is a derived computation (LogicalAction references IDs, not copies)
- [x] LogicalAction is a structural description (no actionType enum — consumers classify)
- [x] ResultingChange captures net state delta from transition boundaries (first stateBefore → last stateAfter)
- [x] Semantic Aggregation segments transitions into lifecycle occurrences (not naive set-membership)
- [x] Rule A (restart) splits multi-operation lifecycles on initial-operation reappearance
- [x] Rule A does NOT apply to single-operation lifecycles (consecutive ops aggregate)
- [x] Rule B (gap) closes occurrences on intervening non-lifecycle operations
- [x] Rule C (temporal gap) is configurable and disabled by default
- [x] Reopened dropdown (CLICK, SELECT, CLICK, SELECT) produces TWO logical actions
- [x] Incremental typing (TYPE, TYPE, TYPE) produces ONE logical action with final value
- [x] Typing, leaving, returning (TYPE, CLICK, TYPE) produces TWO logical actions
- [x] Partial lifecycle (CLICK only, expected [CLICK,SELECT]) produces incomplete action
- [x] Abandoned re-open (CLICK, SELECT, CLICK) produces one complete + one incomplete
- [x] Interleaved components do not cross-merge
- [x] Single-operation lifecycles produce one action
- [x] Standalone transitions produce individual actions
- [x] Partial lifecycles marked lifecycleComplete: false
- [x] RecordedWorkflow detects navigation boundaries
- [x] RecordedWorkflow identifies branch points from option sets
- [x] ApplicationSurface groups elements by sourceUrl
- [x] ApplicationKnowledgeFragment assembles all foundations + views
- [x] Enrichment uses DomInspector abstraction (no direct browser API calls in logic)
- [x] Foundational entities only enriched with deterministic observation-derived knowledge
- [x] Zero changes to foundational entity structure (only schema-ready field population)
- [x] Zero new foundational entities
- [x] All existing tests pass (3179+ tests)

## Implementation Phases

| Phase | Content | Depends on |
|-------|---------|-----------|
| 5.1 | Type definitions (LogicalAction, RecordedWorkflow, ApplicationSurface, etc.) | Nothing |
| 5.2 | InteractionContract deriver + tests | 5.1 |
| 5.3 | Option set extractor + DomInspector + tests | 5.1 |
| 5.4 | BehavioralContract deriver + tests | 5.1 |
| 5.5 | Semantic Aggregator + tests | 5.1, 5.3 (needs enriched data) |
| 5.6 | Workflow deriver + tests | 5.5 |
| 5.7 | Surface deriver + tests | 5.1 |
| 5.8 | Fragment assembler + tests | 5.2–5.7 |
| 5.9 | Enrichment orchestrator (end-to-end) + integration tests | 5.2–5.8 |
| 5.10 | Full verification (infra gate + reviewer + tester) | 5.9 |

## Risk Register

| Risk | Mitigation |
|------|-----------|
| State machine synthesis is harder than expected (irregular state patterns) | Start with simple before/after state mapping; refine based on test fixtures. The type allows partial state machines. |
| DOM inspector abstraction adds complexity | Keep the interface minimal (querySelector, querySelectorAll, textContent). The abstraction is necessary for testability. |
| Aggregation edge cases (overlapping lifecycles, interrupted interactions) | Mark incomplete lifecycles with `complete: false`. Don't force aggregation of ambiguous cases. |
| Enrichment needs enriched data from earlier in the same pass | Sequence carefully: optionSet extraction (DOM) → InteractionContract (domAttributes) → BehavioralContract (transitions) → Aggregation (needs optionSet + businessField) → Workflow → Fragment. |
