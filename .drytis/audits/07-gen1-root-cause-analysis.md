# Gen 1 Semantic Understanding: Root Cause Analysis

## Methodology

Two parallel deep investigations traced the actual data flow through every Gen 1 layer:
1. **Data availability trace**: What structural/DOM context exists at capture, component runtime, pipeline input, and where it gets lost
2. **Lifecycle/operation/evidence trace**: How transition operations are assigned, how lifecycle checking works, what evidence flows through the adapter, and what enrichment receives

Combined with the 5-domain E2E verification (48 tests, `.drytis/audits/06-gen1-e2e-verification.md`), this document identifies the **general root causes** behind all confirmed Gen 1 failures.

---

## Four General Root Causes

All 11 confirmed Gen 1 disconnects trace back to **four general root causes**, not 11 independent bugs.

### General Root Cause 1: Pipeline runner discards captured structural context

**What the design intended**: The structural recognizer (`structural-recognizer.ts`) needs a role chain (ancestor roles + target element) and optionally sibling elements to match multi-constituent patterns (Dropdown, RadioGroup, Tabs, Accordion). The recognition orchestrator (`orchestrator.ts`) feeds this to both structural and behavioral recognizers.

**What actually happens**: The content script **DOES capture ancestor roles** — `dom-context-extractor.ts:278` walks up to 10 ancestors via `el.parentElement`, storing `ancestorRoles: string[]` in DomContext. Component runtime definitions **DO use** this data extensively (every definition from dropdown.ts to checkbox.ts reads `ancestorClasses`/`ancestorRoles` for classification). The domain adapter **DOES preserve** ancestor roles on `UiElement.ancestorRoles` (`domain-adapter-v2.ts:445`).

But `pipeline-runner.ts:109` **discards it all**:

```typescript
const roleInfo = toRoleInfo(element);  // { elementId, ariaRole, tag } — target only

const input: OrchestratorInput = {
  element: roleInfo,
  ancestorRoles: [roleInfo],  // ← ONLY THE TARGET, not the 10-level chain
  relatedElementIds: [],      // ← ALWAYS EMPTY
  ...
};
```

The `UiElement.ancestorRoles` field holds the full 10-level chain as `string[]` (e.g., `["div[role=combobox]", "form", "body"]`), but the orchestrator expects `ElementRoleInfo[]` (e.g., `[{elementId, ariaRole: "combobox", tag: "div"}, ...]`). This type conversion was **never implemented**.

**Sibling elements** are a different story — they are **never captured at any layer**. No code in the content script, identity extractor, or DomContext extractor walks sibling elements. The `OrchestratorInput.siblingElementRoles` field exists as a forward-looking type definition but has zero implementation feeding it.

**Disconnects caused**:
- D-R1: ancestorRoles truncated to [target] only
- D-R2: relatedElementIds always []
- D-R-DROPDOWN: minConstituents=2 unmet (no siblings available)

### General Root Cause 2: Domain adapter collapses multi-step interactions into single transitions

**What the design intended**: Multi-step interactions (Dropdown: click trigger → open panel → click option → select) produce ONE `ComponentInteraction` with `metadata.subActions[]` containing structured per-step data. The domain adapter should map this into transitions that represent the interaction's lifecycle.

**What actually happens**: The adapter produces exactly **ONE** `ObservedTransition` per `ComponentInteraction`, with a single operation derived from `INTERACTION_TO_OPERATION`. The `metadata.subActions[]` array — which contains structured per-step data (`selectOption`, `increment`, `toggle`, `fillInput`, etc.) with target element info, labels, and values — is **completely ignored**.

For Dropdown:
- ComponentInteraction type=Dropdown, metadata.subActions=[{action:'selectOption', label:'Active', value:'active', targetElementId, targetCssSelector}]
- Adapter: resolveType → 'CustomDropdown' → resolveOperation → SELECT
- ONE transition with operation='select'
- Pattern expects lifecycle [CLICK, SELECT] → {SELECT} ⊄ {CLICK, SELECT} → never CONFIRMED

Additionally, the adapter **also loses R3 evidence**:
- `ComponentInteraction.metadata.evidenceTrail` (IntentVote[]) — never read
- `ComponentInteraction.intent` — never read
- `ComponentInteraction.confidence` — never read
- R3 behavioral observations (panel emergence, attribute changes, value transitions) — never mapped to TransitionEvidence

The adapter's `buildEvidence` function (`domain-adapter-v2.ts:208-281`) only produces three evidence types: `VALUE_CHANGE`, `STATE_CHANGE`, `NAVIGATION`. The `MUTATION` and `CLASS_CHANGE` evidence types — which the behavioral recognizer's `detectSignals()` needs to detect popup visibility changes, modal appearance, and panel emergence — are **never produced**. `cascadeEffects` is always empty because the adapter never passes it to `createObservedTransition`.

This means **5 of 9 behavioral signals can never fire**:
- `CHILD_ELEMENT_BECAME_VISIBLE` — needs MUTATION evidence → never fires
- `ELEMENT_BECAME_MODAL` — needs MUTATION evidence → never fires
- `POPUP_CLOSED` — needs MUTATION evidence → never fires
- `SIBLING_VALUE_CHANGED` — needs CascadeEffectType.VALUE → never fires
- `CHILD_CONTAINS_CLICKABLE_ELEMENTS` — depends on appeared elements (MUTATION) → never fires

These are exactly the signals needed to behaviorally recognize custom dropdowns, modals, and accordions.

**Disconnects caused**:
- D-R4: Multi-operation lifecycles unachievable (Dropdown [CLICK, SELECT], Accordion [CLICK, TOGGLE])
- D-A1: Slider operation='click' (INTERACTION_TO_OPERATION maps Slider→CLICK)
- D-A-RadioButton: RadioButton operation='toggle' but pattern expects SELECT
- D-A-Checkbox-Op: Checkbox behavioral signature expects 'click' but adapter sends 'toggle'
- R3 evidence flow broken (evidenceTrail, intent, confidence lost at adapter boundary)
- 5/9 behavioral signals structurally blinded

### General Root Cause 3: Recognition results never feed back to transitions or enrichment

**What the design intended**: After recognition creates/updates a `ComponentGrouping`, the transitions belonging to that component should be linked via `componentId`. The enrichment orchestrator then partitions transitions by `componentId` — component transitions become component actions (with behavioral contracts, optionSets, workflow context), standalone transitions become standalone actions.

**What actually happens**: The recognition orchestrator calls `registry.addTransition(groupingId, transitionId)` which adds the transition ID to the component's `observedTransitionIds[]`. But this only updates the **component's** reference list — the **transition's** `componentId` field is never updated. The `assignTransitionToComponent()` function exists in `observed-transition.ts:235` but is **never called anywhere** in the codebase (confirmed by grep — zero call sites).

Impact on enrichment:
- `BehavioralContract` derivation (`enrichment-orchestrator.ts:117`): `transitions.filter(t => t.componentId === component.groupingId)` returns **EMPTY array** for every component → state machines, validation behavior, cascade effects all empty
- `Semantic aggregation` (`semantic-aggregator.ts:161-172`): partitions by `componentId` — since all are null, **ALL transitions become standalone actions**
- Component grouping that recognition produced is **disconnected** from the actions

**Disconnects caused**:
- D-R5: componentId never assigned
- D-E2 (partial): BehavioralContract empty even for CONFIRMED components (because compTransitions filter returns empty)
- All actions treated as standalone regardless of recognition

### General Root Cause 4: NoOp DomInspector (MV3 architectural constraint)

**What the design intended**: `STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md` describes a `DomInspector` interface with `querySelector` and `querySelectorAll` for real-time DOM queries during enrichment. This was designed to allow the enrichment layer to discover option elements, inspect DOM structure, and extract optionSets at analysis time.

**What actually happens**: The pipeline runs in the MV3 service worker, which has **no DOM access**. `pipeline-runner.ts:67-72` creates a `NoOpDomInspector` that returns null for all queries. OptionSet extraction (`option-set-extractor.ts:65`) calls `inspector.querySelector(container.elementId)` → always null → optionSet always null.

This is not a wiring bug — it's an architectural constraint. The MV3 service worker cannot access the page DOM. The content script CAN, but there's no messaging channel for on-demand DOM queries from the service worker to the content script.

**Disconnects caused**:
- D-E1: NoOp DomInspector — optionSets always null
- Sibling discovery impossible (no DOM to walk)
- Dynamic structural queries impossible

---

## Root Cause → Disconnect Mapping

| Disconnect | Root Cause 1 (pipeline discards context) | Root Cause 2 (adapter collapses multi-step) | Root Cause 3 (no feedback) | Root Cause 4 (NoOp DomInspector) |
|---|---|---|---|---|
| D-R1: ancestorRoles truncated | ✅ Primary | | | |
| D-R2: relatedElementIds empty | ✅ Primary | | | |
| D-R-DROPDOWN: minConstituents unmet | ✅ (ancestors) + siblings never captured | | | ✅ (can't discover siblings) |
| D-R4: multi-op lifecycles | | ✅ Primary | | |
| D-R5: componentId null | | | ✅ Primary | |
| D-A1: Slider→click | | ✅ (INTERACTION_TO_OPERATION) | | |
| D-A-RadioButton: toggle vs select | | ✅ (INTERACTION_TO_OPERATION) | | |
| D-A-Checkbox-Op: click vs toggle | | ✅ (evidence mismatch) | | |
| D-E1: optionSets null | | | | ✅ Primary |
| D-E2: contracts empty | | | ✅ Primary (componentId) | |
| R3 evidence lost | | ✅ (adapter doesn't read) | | |

---

## Proposed Architectural Fix (Based on Original Gen 1 Design)

The original Gen 1 design assumed DOM access at enrichment time (DomInspector). The MV3 architecture moved processing to the service worker, removing DOM access. The correct fix is NOT to proxy DOM calls to the content script (complex, latency, lifecycle management) but to **capture enough structural context at observation time** (content script HAS DOM access) and **carry it through the pipeline correctly**.

This follows the same principle the design already uses for ancestor roles — extend it to siblings, options, and evidence.

### Fix 1: Bridge captured ancestor roles to recognition (Root Cause 1a)

**What**: Convert `UiElement.ancestorRoles: string[]` (e.g., `["div[role=combobox]", "form"]`) into `ElementRoleInfo[]` (e.g., `[{elementId: "synthetic-0", ariaRole: "combobox", tag: "div"}, {elementId: "synthetic-1", ariaRole: null, tag: "form"}]`) and pass the full chain as `OrchestratorInput.ancestorRoles` instead of `[roleInfo]`.

**Where**: `pipeline-runner.ts:107-113` — replace `ancestorRoles: [roleInfo]` with the parsed chain from `element.ancestorRoles`.

**Restores**: Structural recognition for RadioGroup (radio inside radiogroup), Tabs (tab inside tablist), Accordion (button inside accordion header). These patterns have root ARIA roles on ancestors, not on the interacted element itself.

**Complexity**: Low. String parsing ("div[role=combobox]" → {tag: "div", ariaRole: "combobox"}). Data already exists on UiElement.

### Fix 2: Capture sibling roles at observation time (Root Cause 1b)

**What**: Extend the content script's `DomContext` capture to include sibling element roles, similar to how `ancestorRoles` are already captured. When an element is interacted with, also capture the roles of its siblings (same parent).

**Where**: `dom-context-extractor.ts` — add `siblingRoles: {elementId, ariaRole, tag}[]` field. Walk `el.parentElement.children` to capture siblings.

**Restores**: Structural recognition for Dropdown (trigger + option siblings), RadioGroup (radio siblings). Without siblings, minConstituents=2 can never be met.

**Complexity**: Medium. New DomContext field, content script change, type updates. Follows the exact same pattern as the existing ancestorRoles capture.

**Alternative**: If sibling capture is too expensive (large sibling lists), the content script could capture only siblings with ARIA roles (filter for `role` attribute or known semantic tags), limiting the set to structurally meaningful elements.

### Fix 3: Expand subActions into multiple transitions (Root Cause 2a)

**What**: The domain adapter should produce multiple `ObservedTransition` objects from interactions with `metadata.subActions[]`. For Dropdown: produce a CLICK transition (trigger click) + a SELECT transition (option selection). For Accordion: produce a CLICK transition (header click) + a TOGGLE transition (content toggle).

**Where**: `domain-adapter-v2.ts` — after producing the primary transition, iterate `metadata.subActions[]` and create additional transitions with appropriate operations.

**Restores**: Multi-operation lifecycle satisfaction. Dropdown [CLICK, SELECT] becomes achievable when both transitions exist. Accordion [CLICK, TOGGLE] becomes achievable.

**Complexity**: Medium. The subActions data already exists with structured action types, target elements, and values. The adapter needs to map `subActions.action` → `TransitionOperation` and create transitions with the correct `elementId` (from `subAction.targetElementId`).

### Fix 4: Fix operation mappings (Root Cause 2b)

**What**: Correct the `INTERACTION_TO_OPERATION` mapping for mismatched types:
- `RadioButton` → `SELECT` (not `TOGGLE`) — pattern RADIO_GROUP expects [SELECT]
- `Slider` → new `SLIDE` operation (or `ADJUST`) — semantic correctness
- `Scroll` → `SCROLL` operation (not `CLICK`)

**Where**: `domain-adapter-v2.ts:48-98` — `INTERACTION_TO_OPERATION` map.

**Restores**: Lifecycle matching for RadioButton. Semantic correctness for Slider/Scroll.

**Complexity**: Low. Map value changes. May need to add new `TransitionOperation` enum values (SLIDE, SCROLL).

### Fix 5: Map R3 evidence to transition evidence (Root Cause 2c)

**What**: The domain adapter should read `ComponentInteraction.metadata.evidenceTrail` (IntentVote[]) and map each IntentVote to a `TransitionEvidence` on the corresponding `ObservedTransition`. Additionally, map R3 behavioral observations (panel emergence, attribute changes) to `MUTATION` and `CLASS_CHANGE` evidence types. Populate `cascadeEffects` from R3 cascade observations.

**Where**: `domain-adapter-v2.ts` — `buildEvidence` function (lines 208-281) should be extended to read evidenceTrail and produce the full evidence type vocabulary.

**Restores**: Behavioral recognition capability. 5 of 9 signals become fireable. Custom dropdowns, modals, and accordions can be recognized behaviorally even without ARIA roles.

**Complexity**: Medium-High. Requires mapping between IntentVote structure and TransitionEvidence structure. The R3 evidence types (valueChange, panelEmergence, selectionState, sliderValue) need to be translated to the evidence vocabulary the behavioral recognizer expects (MUTATION, VALUE_CHANGE, STATE_CHANGE, CLASS_CHANGE).

### Fix 6: Wire componentId assignment (Root Cause 3)

**What**: After recognition creates or updates a `ComponentGrouping`, call `assignTransitionToComponent` to set `componentId` on the transition. This links transitions to their components.

**Where**: `orchestrator.ts` — after `registry.addTransition(groupingId, transitionId)`, also call `assignTransitionToComponent(transition, groupingId)`. Or: `pipeline-runner.ts` — after `runRecognition`, iterate components and assign componentId to their transitions.

**Restores**: Enrichment partitioning — component transitions become component actions, standalone transitions become standalone actions. Behavioral contracts get populated for confirmed components. Semantic aggregation respects component grouping.

**Complexity**: Low. The function already exists. It just needs to be called.

### Fix 7: Derive optionSets from captured subActions (Root Cause 4)

**What**: Instead of requiring DomInspector to query the DOM for options at enrichment time, convert the option data already captured in `metadata.subActions[]` into optionSet data. The dropdown definition already captures option labels, values, and target elements in subActions.

**Where**: `enrichment-orchestrator.ts` or `option-set-extractor.ts` — when DomInspector returns null (service worker), fall back to extracting options from `metadata.subActions[]` on the original ComponentInteraction.

**Restores**: OptionSet extraction for dropdowns and radio groups without DOM access.

**Complexity**: Medium. Requires access to the original ComponentInteraction data (currently not passed to enrichment). May require passing interactions[] through to the enrichment orchestrator, or carrying subActions on the ObservedTransition.

---

## Dependency Analysis

```
Fix 1 (ancestor bridge)     ─┐
                             ├──→ Unlocks: RadioGroup, Tabs, Accordion structural recognition
Fix 2 (sibling capture)     ─┘    (Fix 1 alone helps ancestor-rooted patterns; Fix 2 adds multi-constituent)

Fix 3 (subAction expansion) ──→ Unlocks: Dropdown, Accordion lifecycle CONFIRMED
                                    (Needs Fix 6 to link transitions to components)

Fix 4 (operation mapping)   ──→ Unlocks: RadioButton lifecycle, Slider/Scroll semantics
                                    (Independent, low risk)

Fix 5 (evidence mapping)    ──→ Unlocks: Behavioral recognition for custom components
                                    (Independent of Fixes 1-4, but needs Fix 6 for contracts)

Fix 6 (componentId wiring)  ──→ Unlocks: Component actions, behavioral contracts, correct enrichment
                                    (Required by Fixes 3, 5 to take effect downstream)

Fix 7 (optionSet from subActions) ──→ Unlocks: OptionSet data without DOM access
                                    (Depends on Fix 3 for subAction data availability)
```

**Minimum viable path**: Fix 1 + Fix 6 → ancestor-rooted patterns recognized + enrichment partitioned correctly.  
**Full recognition restoration**: Fix 1 + Fix 2 + Fix 3 + Fix 4 + Fix 6 → all existing patterns can be recognized and confirmed.  
**Full behavioral recognition**: Add Fix 5 → custom components without ARIA can be recognized behaviorally.  
**Full optionSets**: Add Fix 7 → option data available without DOM access.

---

## What This Does NOT Change

- **IR Bridge** — continues to consume ComponentInteraction[] directly, bypassing the domain adapter. This is the working Gen 1 path and is not affected by these fixes.
- **Side Panel** — continues to display from IR Bridge output. Recognition/enrichment improvements would add more semantic data (component labels, optionSets, behavioral contracts) but don't change the display mechanism.
- **Component Runtime** — continues to classify interactions. These fixes operate downstream of the runtime, in the pipeline/adapter/recognition/enrichment layers.
- **Pattern catalogue** — no new patterns needed for existing interaction types. Missing patterns (Slider, DatePicker, FileUpload, DragDrop) are a separate concern.

---

## Evidence Sources

- `src/tap/event-tap.ts` — event capture (19 types, assembleObservedEvent)
- `src/definitions/dom-context-extractor.ts:278-321` — ancestor role/class capture (10 levels via parentElement walk)
- `src/shared/component-types.ts:538-598` — ComponentInteraction type (memberEvents carry full domContext)
- `src/recorder/pipeline/domain-adapter-v2.ts:48-98` — INTERACTION_TO_OPERATION mapping
- `src/recorder/pipeline/domain-adapter-v2.ts:208-281` — buildEvidence (only VALUE_CHANGE, STATE_CHANGE, NAVIGATION)
- `src/recorder/pipeline/domain-adapter-v2.ts:445` — ancestorRoles preserved on UiElement
- `src/recorder/pipeline/pipeline-runner.ts:67-72` — NoOp DomInspector
- `src/recorder/pipeline/pipeline-runner.ts:107-113` — ancestorRoles: [roleInfo], relatedElementIds: []
- `src/recorder/recognition/structural-recognizer.ts:126-160` — recognize() iterates patterns against role chain
- `src/recorder/recognition/behavioral-recognizer.ts:111-289` — detectSignals() checks 9 signals, 5 require MUTATION evidence
- `src/recorder/recognition/orchestrator.ts:111-130` — isLifecycleComplete() set-containment check
- `src/recorder/recognition/orchestrator.ts:359-365` — observedOperations from same-elementId transitions only
- `src/domain/entities/observed-transition.ts:235` — assignTransitionToComponent (never called)
- `src/recorder/enrichment/enrichment-orchestrator.ts:112-117` — confirmedComponents filter + compTransitions filter
- `src/recorder/enrichment/semantic-aggregator.ts:161-172` — partition by componentId (all null → all standalone)
- `src/recorder/enrichment/option-set-extractor.ts:65` — inspector.querySelector returns null (NoOp)
- `tests/gen1-e2e-verification.test.ts` — 48 tests across 5 domains confirming all findings
