# Phase 5: Lifecycle Engine

## Summary

The lifecycle engine takes RecognitionResults (from Phase 4) and groups them into
**SemanticActions** — the meaningful test steps a QA engineer would expect to see.

A SemanticAction represents one complete user intent:
- "Select 'India' from the Country dropdown" (not "click combobox" + "click option")
- "Enter 'john@example.com' in the email field" (not "focus" + "input" + "blur")
- "Toggle the 'Remember me' checkbox" (single immediate action)
- "Dismiss the dialog by pressing Escape" (cancel lifecycle)

## Design: Correct Interaction Lifecycle Models

### Definition: What is a SemanticAction?

A SemanticAction is the smallest unit of user behaviour that a QA engineer would
write as a single test step. If an engineer would write it as one assertion or
action in a test script, it's one SemanticAction.

### Lifecycle Patterns by Interaction Type

#### Immediate Actions (no lifecycle needed)
**Checkbox toggle, Radio select, Link click, Button click, Generic click, Navigation**

These complete instantly — one event = one SemanticAction. The recognition
pipeline already identifies them correctly. The lifecycle engine passes them
through directly.

**Decision: Adopted from working-better.** Immediate completion is correct —
no improvement needed.

#### Text Entry Lifecycle
**focus → input+ → blur**

A QA engineer expects: "Enter 'hello' in the name field" — one step.

Lifecycle:
1. ACTIVATE: focus on text input
2. INTERMEDIATE: input events (value changes)
3. COMMIT: blur (user moved away) OR focus on different element

**No-op rejection:** If no input events occurred (user focused then blurred
without typing), this is NOT a SemanticAction. A QA engineer would not write
"focus on field and do nothing."

**Decision: Improved over working-better.** Working-better emits it as
`completed` with `userTyped=false` and defers filtering to the presentation
layer. We reject it at the lifecycle level — cleaner, no downstream filtering.

**Decision: Adopted from working-better.** The `shouldCancelOnOutside: only
on 'click' not 'mousedown'` pattern. This correctly handles the browser event
order (mousedown → blur → click) so TextEntry completes on blur before the
click triggers cancellation.

#### Dropdown / Select Lifecycle
**click(trigger) → [intermediate: option hover/navigation] → click(option)**

A QA engineer expects: "Select 'India' from the Country dropdown" — one step.

Lifecycle:
1. ACTIVATE: click on combobox/select trigger
2. INTERMEDIATE: events within the dropdown surface (option hover, scroll)
3. COMMIT: click on an option OR native SELECT change event
4. CANCEL: click outside, Escape key, or stale timeout

**Outside-click cancellation:**
A QA engineer does NOT expect "Open dropdown, click away" to appear as a test
step. This should produce NO SemanticAction (cancelled).

**Escape cancellation:**
A QA engineer does NOT expect "Open dropdown, press Escape" to appear as a test
step. This should produce NO SemanticAction (cancelled).

**Decision: Improved over working-better.** Working-better NEVER cancels
dropdowns (`shouldCancelOnOutside: false`) and relies on 15s passive stale
timeout. This produces zombie interactions and abandoned entries. We implement
proper cancellation: outside-click and Escape both cancel the lifecycle.

**Decision: Rejected (working-better incorrect).** Working-better's comment
says "portal-rendered overlays break DOM-boundary checks." This is true but
irrelevant — we don't need DOM-boundary checks. We use event semantics: if a
click event's target is NOT in the dropdown's scope (trigger, option, or
semantically related), the lifecycle is cancelled. This works regardless of
portal rendering.

#### Date Picker Lifecycle
**click/focus(trigger) → [calendar navigation] → click(date cell) OR change(native)**

A QA engineer expects: "Select date '2024-01-15' from the date picker" — one step.

Lifecycle: Same as Dropdown — ACTIVATE → INTERMEDIATE → COMMIT/CANCEL.

**Calendar navigation buttons (prev/next month, today):**
These are INTERMEDIATE events — they don't commit or cancel. The user is
navigating within the calendar to find the right date.

**Decision: Improved over both references.** Working-better has no cancellation
and detects calendar nav buttons via CSS class regex (fragile). We use ARIA
roles (gridcell, grid, navigation within a dialog surface) and treat
prev/next/today buttons as intermediate events based on their accessible names.

#### Hover Lifecycle
**mouseenter → [dwell] → observable UI change (tooltip/menu appears) → mouseleave**

A QA engineer expects: "Hover over the 'Help' button to see the tooltip" —
ONLY if the hover produced a visible UI change.

**Critical design decision: Rejected (working-better incorrect).**

Working-better's hover model produces false positives:
- Sustained dwell (3s stationary) fires even when the user was just thinking
  with their cursor resting on an element. A QA engineer would NOT write
  "hover for 3 seconds" as a test step unless a tooltip actually appeared.
- The 50-point threshold is reachable by sustained-dwell alone (weight 50),
  which is the weakest and most error-prone signal.

**Correct behaviour:** A hover is a SemanticAction ONLY when it produces an
observable UI state change:
- `aria-expanded` transitions from false to true (menu/tooltip opened)
- An overlay surface appears (detected via MutationObserver/Channel D)
- `aria-haspopup` element opens a popup that is detected by surface evidence

If the user hovers and nothing visible happens, there is no SemanticAction.
This eliminates false positives entirely.

**Decision: Improved over working-better.** We require observable UI change
evidence, not just dwell time. The hover pattern from Phase 4 already checks
`ariaAttribute contains 'haspopup'` OR `expanded:true` OR `overlayOpen` —
this is the correct approach.

#### Scroll Lifecycle
**scroll+ → natural pause**

A QA engineer expects: "Scroll down to load more content" or may not expect
scroll at all (scroll is often incidental).

Scroll events are standalone in the event grouper (Phase 4). The lifecycle
engine passes them through as individual SemanticActions. Coalescing
consecutive scrolls into a single "scroll gesture" is a concern for the
output/enrichment stage, not the lifecycle engine.

**Decision: Adopted from working-better.** Scroll as immediate action is
correct. No lifecycle state machine needed.

#### Slider Lifecycle
**mousedown(slider handle) → input+ (dragging) → mouseup/change**

A QA engineer expects: "Set the slider to 50" — one step.

Lifecycle: Similar to TextEntry — ACTIVATE(mousedown) → INTERMEDIATE(input) →
COMMIT(change/mouseup).

**Decision: Improved over working-better.** Working-better has no slider
definition registered (isSlider exists but no definition uses it). We implement
it as a lifecycle similar to text entry.

## Cancellation Triggers

| Trigger | Affected Lifecycles | Behaviour |
|---------|--------------------|-----------|
| **Outside click** | Dropdown, DatePicker, Hover | Cancel — emit nothing |
| **Escape key** | Dropdown, DatePicker, TextEntry | Cancel TextEntry only if no typing; Cancel Dropdown/DatePicker always |
| **Navigation** | All active | Flush all — emit completed if committed, cancel otherwise |
| **Stale timeout** | All active | Cancel — 10s (not 15s — faster cleanup) |
| **Recording stop** | All active | Flush all — emit completed if value present, cancel otherwise |

## Declarative Lifecycle Definitions

Instead of procedural ComponentDefinitions (working-better's 6-method contract),
we use **declarative LifecycleDefinitions** — data objects describing the state
machine. The lifecycle engine is a generic interpreter.

```typescript
interface LifecycleDefinition {
  id: string;
  verb: InteractionVerb;
  componentType: ComponentType;
  // Which recognition results activate this lifecycle
  activateOn: { verb: InteractionVerb; componentType?: ComponentType };
  // Which results keep it alive (intermediate)
  sustainOn?: { verb: InteractionVerb; componentType?: ComponentType };
  // Which results commit it
  commitOn: { verb: InteractionVerb; componentType?: ComponentType };
  // Events that cancel it (outside click, escape, navigation)
  cancelOnOutsideClick: boolean;
  cancelOnEscape: boolean;
  cancelOnNavigation: boolean;
  // Max duration before stale timeout (ms)
  maxDurationMs: number;
  // Reject if no intermediate/commit events (no-op)
  rejectIfNoProgress: boolean;
}
```

## Files to Create

### Source Files
1. `src/pipeline/lifecycle/lifecycle-types.ts` — LifecycleDefinition, LifecycleState
2. `src/pipeline/lifecycle/lifecycle-definitions.ts` — declarative definitions
3. `src/pipeline/lifecycle/lifecycle-engine.ts` — generic state machine interpreter
4. `src/pipeline/lifecycle/semantic-action-builder.ts` — builds SemanticAction from lifecycle results
5. `src/pipeline/lifecycle/index.ts` — barrel export

### Test Files
- `tests/unit/pipeline/lifecycle/lifecycle-engine.test.ts`
- `tests/unit/pipeline/lifecycle/lifecycle-definitions.test.ts`
- `tests/unit/pipeline/lifecycle/semantic-action-builder.test.ts`

## Acceptance Criteria

- [ ] Immediate actions (click, toggle, navigate, scroll) pass through directly
- [ ] TextEntry lifecycle: focus→input→blur produces one SemanticAction with value
- [ ] TextEntry no-op: focus→blur without typing produces no SemanticAction
- [ ] Dropdown lifecycle: trigger→option produces one SemanticAction with selected value
- [ ] Dropdown outside-click cancellation produces no SemanticAction
- [ ] Dropdown Escape cancellation produces no SemanticAction
- [ ] DatePicker lifecycle: trigger→date cell produces one SemanticAction
- [ ] Hover only produces SemanticAction when observable UI change detected
- [ ] Slider lifecycle: mousedown→input→change produces one SemanticAction
- [ ] Navigation flushes all active lifecycles
- [ ] Stale timeout (10s) cancels incomplete lifecycles
- [ ] Recording stop flushes all active lifecycles
- [ ] All modules are standalone (no content script or SW dependency)
- [ ] Existing deterministic-recorder.ts is NOT modified
- [ ] Full test suite passes with 0 new failures
- [ ] TypeCheck: 0 new errors
- [ ] Build succeeds
- [ ] Each lifecycle decision classified as adopted/improved/rejected
