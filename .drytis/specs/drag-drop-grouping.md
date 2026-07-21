# Drag & Drop Grouping — Engine Coordinator

## Goal
Fix the V2 Evidence Engine to group `dragstart` + `drop` events into a single DragDrop interaction instead of producing two separate interactions. Add source element metadata and improve display phrasing.

## Problem
Both `dragstart` and `drop` are in `STANDALONE_EVENT_TYPES` in engine.ts, so each one immediately flushes and commits as a separate single-event interaction. V1 already groups them correctly. V2 should too.

## Architecture

### Phase 1: Engine Grouping Fix (engine.ts)

Remove `dragstart` and `drop` from `STANDALONE_EVENT_TYPES`. Add a **drag coordinator** — a pending-drag state machine inside the engine:

- **dragstart arrives**: Instead of standalone commit, start a pending drag buffer. Store the dragstart event in `this.currentBuffer`. The buffer uses the dragstart element's key as the `elementKey`.
- **drop arrives**: Check if `this.currentBuffer` contains a `dragstart` event. If yes → add drop to the same buffer. If no → commit as standalone (orphaned drop).
- **Intervening events**: If any non-drag event arrives while a drag is pending, flush the dragstart buffer first (incomplete drag), then process the new event normally.
- **End of stream**: `flush()` handles pending dragstart as a standalone DragDrop.

The key insight: once `dragstart` is removed from `STANDALONE_EVENT_TYPES`, it enters the normal buffer flow. A `dragstart` event starts a buffer. The `isRelatedToBuffer` method needs a new case: **if the buffer contains a dragstart and the incoming event is a drop, they're related**.

### Phase 2: Metadata & Display

**InteractionMetadata** — add `sourceElement` field:
```typescript
// Drag & Drop
dropTarget?: string;      // already exists
sourceElement?: string;   // NEW: the dragged element's accessible name
```

**EventSequenceProvider** — extract `sourceElement` from dragstart events:
```typescript
case 'dragstart':
  return [{
    provider: this.name,
    suggestedType: 'DragDrop',
    confidence: 0.85,  // boosted from 0.7
    weight: 0.8,       // boosted from 0.6
    metadata: event.target.accessibleName
      ? { sourceElement: event.target.accessibleName }
      : {},
    reason: 'dragstart event detected',
  }];
```

**timeline-renderer.ts** — new phrasing:
```
Drag "Task Card A" to "In Progress"
```
With sourceElement and dropTarget both available. Falls back to just target name if either is missing.

### Phase 3: Tests

1. **dragstart + drop → 1 interaction** (the core fix)
2. **dragstart without drop → 1 DragDrop** (incomplete, flushed at end)
3. **drop without dragstart → 1 DragDrop** (orphaned drop)
4. **dragstart + intervening click + drop → 2 interactions** (click breaks the drag)
5. **Two separate drags → 2 interactions** (dragstart₁ + drop₁ + dragstart₂ + drop₂)
6. **sourceElement metadata extracted** from dragstart
7. **dropTarget metadata extracted** from drop
8. **Existing graceful-failure test updated** (was 2, now 1)
9. **Merge layer still works** (V2 now produces 1, V1 fallback rare)
10. **Timeline rendering** shows `Drag "X" to "Y"`

## Acceptance Criteria

- [ ] dragstart + drop produces exactly 1 DragDrop interaction
- [ ] The interaction contains both event IDs
- [ ] sourceElement metadata is populated from the dragstart element
- [ ] dropTarget metadata is populated from the drop element
- [ ] dragstart without drop produces 1 incomplete DragDrop
- [ ] drop without dragstart produces 1 orphaned DragDrop
- [ ] Intervening events break the drag grouping
- [ ] Timeline renders as `Drag "X" to "Y"` when both names available
- [ ] graceful-failure test updated to expect 1 interaction
- [ ] All 2339+ existing tests still pass
- [ ] No regressions in merge layer or other interaction types
