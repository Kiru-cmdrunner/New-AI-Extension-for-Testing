# Phase 5 — Lifecycle Engine: Design Decisions

## Architecture

Generic state machine interpreter driven by declarative `LifecycleDefinition`
objects. No interaction-specific logic in the engine — all behaviour is data.

**Processing order**: nav flush → stale cleanup → escape cancel → commit check
→ outside-click cancel → activation → immediate pass-through.

## Decision Classifications

### [ADOPTED] from working-better (proven technique)
- **Text entry self-commit** (focus→input→blur): activateOn===commitOn triggers
  immediate emit when value is captured. Same intent as working-better's
  immediate-complete pattern.
- **Text entry no-op rejection** (focus→blur without typing): A QA engineer
  would never write a test step "focus field, blur field". Correct.
- **Slider self-commit**: Like text entry — value change is atomic.
- **Stale timeout** (passive cleanup): working-better's 15s passive cleanup
  inspired our active cleanupStale in the processing loop.

### [IMPROVED] over reference (same intent, better implementation)
- **Dropdown/date-picker outside-click cancellation**: working-better's
  `shouldCancelOnOutside` is always `false` for these — zombie components
  persist for 15s. Our `cancelOnOutsideClick: true` + scope detection
  immediately cancels on genuine outside click. Scope detection uses
  evidence-based ARIA roles (option, gridcell) rather than DOM traversal.
- **Escape key cancellation**: NEITHER reference handles Escape. Our
  `cancelOnEscape: true` immediately cancels on Escape press. Escape is
  swallowed (no SemanticAction for the key itself).
- **Active stale timer via cleanupStale**: working-better's stale cleanup is
  passive (only runs on next event). Ours runs on every processResult call.
- **Scope detection via ARIA roles**: references use DOM tree traversal
  (requires content-script access). We use evidence from the batch —
  sufficient because the recognition pipeline already classifies targets.

### [REJECTED] reference behaviour (reference incorrect)
- **Hover sustained-dwell false positive**: working-better emits hover
  actions based on dwell time alone (500ms-3s). Correct behaviour requires
  an observable UI state change (tooltip, menu expansion). Not implemented
  in Phase 5 — deferred to Phase 6 enrichment.

## Scope Detection Logic

- Dropdown options: `ariaRole ∈ {option, menuitem, menuitemcheckbox,
  menuitemradio, treeitem}` or `tag ∈ {OPTION, LI}`
- Date picker days: `ariaRole ∈ {gridcell, cell}` or `tag ∈ {TD}`
- Everything else: treated as outside-scope → cancels the lifecycle

## Known Limitations (deferred to wiring/enrichment)

1. All `pressKey` events treated as Escape (no key identity from recognition)
2. Navigation events don't emit their own SemanticAction (only flush)
3. Module-level `actionCounter` (not instance-scoped)
4. Unquoted single quotes in plainEnglish descriptions
5. `extractValue` falls back to accessibleName — flush of cancelled
   dropdown may use trigger name as value
6. Text entry maxDurationMs=30s (not 10s) — effectively unused since
   self-committing

## Test Coverage: 41 tests across 8 test groups
- Immediate actions (5): click, toggle, navigate, scroll, unrecognised
- Text entry (3): self-commit, no-op rejection, no-batch rejection
- Dropdown (4): activate+commit, outside-click cancel, stale timeout, Escape
- Date picker (3): activate+commit, outside-click cancel, Escape
- Slider (2): with value, without value
- Navigation flush (1)
- Flush on recording stop (2): with value, no-progress discard
- Multi-lifecycle coexistence (2): sequential, interleaved immediate
- SemanticActionBuilder (10): all verb plainEnglish formats + sequential IDs
- Lifecycle definitions (7): find/verify definitions

## Reviewer: 14/14 PASS, 0 FAIL, 7 non-blocking WARN
