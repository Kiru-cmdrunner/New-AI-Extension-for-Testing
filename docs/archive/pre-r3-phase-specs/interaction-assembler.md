# Interaction Assembler — Architecture C Enhancement

**Blueprint:** `.drytis/architecture-c-production.md` §5 (new layer)
**Depends on:** Architecture C Phase 6 (stable checkpoint `c4e9353`)
**Goal:** Capture completed business actions instead of fragmented interaction events.

## Problem

The pipeline emits one SessionEvent per coalescer snapshot. Composite interactions
(dropdowns, date pickers, dialogs, autocomplete) produce multiple snapshots because
the user performs multiple clicks/inputs to complete one business action. The pipeline
has no mechanism to detect that these snapshots form a single transaction.

## Root Cause

The coalescer closes windows on a 500ms timeout or element-key mismatch. It has no
awareness of transient UI surfaces (dropdowns, calendars, dialogs). The classifier
discards `sessionContext` (line 549 of multi-tier-classifier.ts: `_sessionContext`).
No component collapses multiple classified snapshots into one business action.

## Solution: Interaction Assembler

A new layer between the classifier and the event emitter in the pipeline. It uses a
transaction state machine to detect when a transient UI surface opens, buffers
classified snapshots while the surface is open, and collapses them into one
SessionEvent when the surface closes with a selection.

### Architecture Position

```
Coalescer → Classifier → [INTERACTION ASSEMBLER] → SessionEvent
                           │
                           ├─ No surface open? → emit immediately (IDLE passthrough)
                           ├─ Surface just opened? → emit opener, enter PENDING
                           ├─ Surface still open? → buffer (PENDING)
                           └─ Surface closed? → collapse buffer + update opener (COMMIT)
                                                or emit individually (CANCEL)
```

### Detection Signals

**Primary:** `DeterministicState.openDropdowns` / `openDialogs` from the state tracker
(content script with real DOM access). These transitions indicate surface open/close.

**Fallback (for race conditions where state update hasn't arrived):**
- `ancestorContext.hasListboxAncestor` / `hasMenuAncestor` / `hasCalendarAncestor` / `hasDialogAncestor`
- Element `ariaRole` of 'option', 'menuitem', 'treeitem', 'tab'
- `domMutations.childListAdded > 0` (surface appeared)

### Ancestor Context Enhancement

Before classification, the pipeline enhances the snapshot's `ancestorContext` using
`sessionContext.layer1`. If `openDropdowns` is non-empty, `hasListboxAncestor` is set
to true. This allows R9 (ariaOptionInListbox) to correctly classify option clicks as
'select' instead of 'click' fallback.

### Collapse Logic

When a surface closes with a selection:
1. The last buffered snapshot (the selection) determines the event type and value.
2. If classified as 'click' but inside a surface context → upgrade to 'select' or 'selectDate'.
3. The opener event (already emitted) is updated in-place via `onEventUpdate`.
4. Composite metadata is attached: `{ compositeAction: true, openerLabel, interactionType }`.

When a surface closes without a selection (user clicked away):
- Buffered events are emitted individually (preserving current behavior).

### SessionContext-Triggered Commit

Surface closure may be detected via `setSessionContext()` (when DETERMINISTIC_STATE
arrives between snapshots). The assembler's `onSessionContextUpdate()` checks for
surface transitions and triggers commit/cancel if in PENDING state.

## Files to Change

### New
| File | Purpose |
|------|---------|
| `src/recorder/pipeline/interaction-assembler.ts` | Transaction state machine + collapse logic |
| `tests/interaction-assembler.test.ts` | Unit tests for assembler |

### Modified
| File | Changes |
|------|---------|
| `src/recorder/pipeline/architecture-c-pipeline.ts` | Integrate assembler; add ancestor context enhancement; route through assembler before emitting |
| `tests/architecture-c-pipeline.test.ts` | Integration tests for assembler in pipeline |

## Acceptance Criteria

- [ ] Simple interactions (click, text, checkbox) pass through unchanged (zero regression)
- [ ] Dropdown selection produces one "select" event, not "click trigger + click option"
- [ ] Date picker selection produces one "selectDate" event
- [ ] Dialog interactions are buffered while open
- [ ] Surface close without selection emits buffered events individually
- [ ] SessionContext-triggered commit works (surface closes between snapshots)
- [ ] Ancestor context enhancement allows R9 to classify option clicks as 'select'
- [ ] Composite metadata attached to collapsed events
- [ ] Opener event updated in-place via onEventUpdate
- [ ] All existing tests pass (zero regression)
- [ ] Assembler unit tests cover all state transitions
