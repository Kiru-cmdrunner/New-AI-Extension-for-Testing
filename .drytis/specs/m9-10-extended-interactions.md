# M9.10 — Extended Interaction Coverage

## Goal
Ensure the Application Understanding layer can correctly represent
DragDrop, KeyboardShortcut, and Compound interactions that the evidence
pipeline can already capture but that are currently lost or misclassified.

## Audit Findings

### What evidence already exists but is lost

1. **Drag & Drop**: The Phase 1 deterministic-recorder.ts (lines 2652, 2693)
   already captures `dragstart` and `drop` DOM events with full target
   identity and DOM context. However:
   - These are in the legacy recorder (ElementRecordedEvent), NOT in the
     Component Runtime pipeline (BrowserEventType has no dragstart/drop).
   - The Component Runtime never sees them → they never become
     ComponentInteractions → never reach M9.

2. **Keyboard Shortcuts**: `keydown` IS in BrowserEventType and EventTap
   and IS captured as an ObservedEvent with `key`, `code`, `shiftKey`,
   `ctrlKey`, `altKey`, `metaKey`. It's even in DISCRETE_ACTION_TYPES.
   However: NO definition claims keydown events (they're only consumed
   as part of TextEntry lifecycles). So a Cmd+K or Ctrl+S produces an
   `Unclassified` interaction, losing the shortcut semantics entirely.

3. **Compound/Multi-step**: The current architecture is strictly one
   definition = one interaction = one lifecycle. There is no mechanism
   to group multiple interactions into a single compound action (e.g.,
   "select text → drag → drop" as one compound DnD action).

### What needs to change (minimal surface)

Since M1–M8 behavior must be preserved, the approach is strictly additive:

**A. InteractionType union** (src/shared/component-types.ts):
  - Add `'DragDrop'`, `'KeyboardShortcut'`, `'CompoundInteraction'`

**B. BrowserEventType** (src/shared/component-types.ts):
  - Add `'dragstart'`, `'drop'`, `'submit'`

**C. EventTap** (src/tap/event-tap.ts):
  - Add `'dragstart'`, `'drop'` to the eventTypes listener array

**D. Evidence Ledger** (src/runtime/evidence-ledger.ts):
  - Add `'dragstart'`, `'drop'` to DISCRETE_ACTION_TYPES

**E. New Component Definitions**:
  - `src/definitions/drag-drop.ts`: lifecycle from dragstart → drop
  - `src/definitions/keyboard-shortcut.ts`: keydown with modifier keys

**F. Definition Registry** (src/definitions/index.ts):
  - Register both new definitions

**G. IR Bridge** (src/generation/ir-bridge.ts):
  - Add new types to INTERACTION_TO_IR_ACTION map
  - Add IRAction.DRAG_DROP, IRAction.KEYBOARD_SHORTCUT to IRAction enum
  - Add descriptions for new types

**H. Compound Interaction Detection** (NEW, in src/understanding/):
  - `src/understanding/enrichment/compound-detector.ts`
  - Post-hoc analysis over a sequence of ComponentInteractions
  - Detects patterns like "select + drag + drop" and groups them
  - Does NOT modify the interactions — produces a derived CompoundAction
  - report alongside other M9.7 SemanticKnowledge

## What does NOT change
- M1–M8 behavior: existing 14 definitions unchanged
- M9.1–M9.9: StateBuilder, OutcomeDeterminer, Persistence, Consolidation
  all treat InteractionType as data — new values flow through naturally
- No schema changes, no env changes, no service changes

## Acceptance Criteria
- [ ] InteractionType includes DragDrop, KeyboardShortcut, CompoundInteraction
- [ ] BrowserEventType includes dragstart, drop, submit
- [ ] EventTap captures dragstart and drop events
- [ ] DISCRETE_ACTION_TYPES includes dragstart and drop
- [ ] DragDrop definition: triggers on dragstart, completes on drop
- [ ] KeyboardShortcut definition: triggers on keydown with modifier keys
- [ ] Both definitions registered in ALL_DEFINITIONS
- [ ] IR Bridge maps all new types to IRAction values
- [ ] IRAction enum includes DRAG_DROP and KEYBOARD_SHORTCUT
- [ ] CompoundDetector groups consecutive interactions into compound actions
- [ ] New types flow through M9.2 (state builder), M9.3 (outcome), M9.7 (semantic)
- [ ] Existing Amazon/OrangeHRM behavior unchanged
- [ ] TSC = 0 errors
- [ ] Full test suite passes
- [ ] Focused tests: DragDrop lifecycle, KeyboardShortcut detection, Compound grouping,
      IR mapping, backward compat
- [ ] Clean build

## Out of Scope
- M9.11 (Multi-Domain Config), M9.12 (Production Wiring)
- AI/LLM
- Modifying existing definitions or their priorities
- UI display config for new types (optional, cosmetic)
