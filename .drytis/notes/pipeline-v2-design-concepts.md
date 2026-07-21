# Pipeline-V2 Design Concepts — For Future Feature Reference

**Extracted:** July 2026, before archiving `src/recorder/pipeline-v2/`  
**Status:** Code archived to `legacy/pipeline-v2/`. Concepts preserved for:
- Validation Engine
- Capability Engine
- AI Workflow Generation

---

## Key Architectural Ideas

### 1. Observable-Behavior Abstraction (Framework Agnosticism)

The pipeline-v2 approach observed the DOM *effect* (state changes), not the framework *cause*. A native `<select>` and a div-based custom dropdown both produce the same `ValueChange` in a `StateDiff`. This is the core principle for a **capability engine**: probe what a page *can do* by observing DOM effects.

### 2. State Diff Engine (Pure Functions)

**Concept:** Two decoupled halves:
- `snapshotState()` — DOM-coupled capture pass that queries every interactive element (native + ARIA)
- `computeDiff(before, after)` — pure function, zero DOM access, produces a structured `StateDiff`

**StateSnapshot structure:** url, inputs[], checkboxes[], radios[], toggles[], ranges[], focusedElement, openSurfaces[], activeTab, expandedAccordions[], interactiveElementCount

**StateDiff structure:** valueChanges[], toggleChanges[], radioChanges[], rangeChanges[], focusChange, surfaceChanges[], tabChange, urlChange, structuralChangeDetected

**Reuse — Validation Engine:** After executing a generated action, take a second snapshot and compute the diff against the expected one. If valueChanges/surfaceChanges don't match expectations, the action failed. The pure-function nature of `computeDiff` means it can run in a headless test runner without browser event machinery.

### 3. Canonical Event Schema (Closed Vocabulary)

**Concept:** A closed event vocabulary (`RECORDED_EVENT_TYPES as const`) where adding/removing a type causes a compile error across the entire codebase via exhaustive switch statements. Single source of truth for all shared types.

**Key types:**
- `PipelineEvent` — normalized event with element, targetTag, payload
- `InteractionUnit` — grouped events with boundaryReason
- `ResolvedAction` — { behavior, sessionEventType, confidence, elementIdentity, fields, description, rationale }
- `InteractionBehavior` — 12-behavior set: single-selection-from-set, multi-selection-from-set, boolean-toggle, text-entry-commit, date-time-selection, expand-collapse, context-switch, navigation, hover-intent, simple-click, form-submit, generic-fallback

**Reuse — AI Workflow Generation:** An AI generator would produce `ResolvedAction` sequences using `InteractionBehavior` + `ResolvedActionFields`. The AI describes *what* to do; the deterministic engine handles *how*. The `confidence` + `rationale` fields provide explainability.

**Reuse — Capability Engine:** Map each `InteractionBehavior` to the capabilities a target site offers.

### 4. Pattern Registry (Confidence-Scored Matching)

**Concept:** A prioritized list of `InteractionPattern` objects, each with a pure `evaluate(unit, diff)` function. All patterns are evaluated (no early return); the highest confidence match above threshold (0.50) wins. Patterns describe *behaviors*, not components — `'single-selection-from-set'` covers native select, MUI Select, radio groups, and custom dropdowns.

**Resilience property:** The intent resolver can produce an action from StateDiff alone even if no pattern matches (via `generic-fallback`). Unknown controls still get resolved, just at lower confidence.

**Reuse — AI Workflow Generation:** Patterns as deterministic fallback / confidence anchor. When AI is uncertain, the pattern registry provides a baseline match. The AI can override, but the pattern's confidence + rationale provide a sanity check.

### 5. Boundary Detection (Event-Stream Segmentation)

**Concept:** A stateful class that groups raw events into atomic `InteractionUnit`s using 5 boundary strategies (priority order):
1. Navigation (immediate close)
2. Surface lifecycle (open→close groups composite interactions like dropdown selection)
3. Temporal gap (default 2000ms — closes simple interactions)
4. Focus continuity (implicit)
5. Explicit flush (on Stop Recording)

Each unit gets a `boundaryReason` explaining why it closed. `surfaceDepth` counter handles nested surfaces.

**Reuse — AI Workflow Generation:** The boundary detector's grouping logic defines **what constitutes one "step"** in the workflow. An AI needs atomic interaction boundaries to reason about individual steps. The `boundaryReason` tells the AI *why* a step ended.

**Reuse — Validation Engine:** The surface-lifecycle logic defines the **expected interaction lifecycle**. When a workflow step says "select from dropdown," the validator verifies that a surface_open → surface_close boundary occurred with correct depth transitions.

---

## Design Principles (from code comments)

1. "The state diff is the PRIMARY SIGNAL for intent resolution. State leads; patterns confirm."
2. "Patterns are accelerators, not gatekeepers."
3. "All layers read element info from the same field names" (single contract).
4. "Adding an event type is a compile error, not a silent runtime drop" (closed vocabulary).

## Why Pipeline-V2 Was Superseded

The evidence-engine approach (V2) won because:
- Provider-pluggable architecture is more extensible than a fixed pattern list
- Weighted voting handles conflicting signals better than single-pattern matching
- The evidence engine works on the existing RecordedEvent type system, while pipeline-v2 required a complete schema migration

However, the pipeline-v2 *concepts* (especially state-diff and behavior abstraction) are superior for validation and capability use cases that the evidence engine was never designed for.
