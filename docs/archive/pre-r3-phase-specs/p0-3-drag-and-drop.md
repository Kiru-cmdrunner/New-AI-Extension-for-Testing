# P0-3: Drag and Drop Interaction Type

## Goal
Add a generic, application-independent Drag and Drop interaction type to the
Component Runtime pipeline. Must capture both mouse-based dragging (mousedown →
mousemove* → mouseup) and HTML5 DnD (dragstart → drop). Must integrate cleanly
into all 6 pipeline layers without regressions.

## Problem
Currently, drag-and-drop interactions are captured as individual Click events
(mousedown + click) with no notion of source, destination, or drag semantics.
The IR bridge has a `DragDrop` classifier type but it maps to `IRAction.CLICK` —
lossy and semantically wrong.

## Design Decisions

### D1: Mouse-based primary, HTML5 DnD secondary
Modern web apps predominantly use mouse/touch-based dragging (react-beautiful-dnd,
@dnd-kit, SortableJS, interact.js) rather than the native HTML5 DnD API. Support
both, but mouse-based is the primary path.

### D2: Trigger on ALL mousedowns, classify by displacement
DragDrop triggers on every mousedown (no definition currently claims mousedown
for triggering). Uses a displacement threshold (MIN_DRAG_DISPLACEMENT_PX = 10)
to distinguish a drag from a click. Below threshold → discard (lets Click handle
it). Above threshold → emit DragDrop.

This is fully generic — no app-specific class detection needed.

### D3: Click-after-drag suppression
Mouse interactions fire mousedown → mouseup → click. If DragDrop completes on
mouseup, the subsequent click creates a spurious Click interaction. Solution:
DragDrop stays active through mouseup, then completes on the next click event
(consuming it). If displacement < threshold on mouseup → discard immediately
(Click handles the click normally).

### D4: HTML5 DnD as a separate trigger path
HTML5 drag events (dragstart, drop) don't fire click events, so no dedup issue.
Trigger on dragstart, complete on drop. Records the same metadata shape.

### D5: 'DragDrop' added to InteractionType (component model)
Coarse type. interactionSubtype: 'MouseDragDrop' or 'Html5DragDrop'.

## Files to Change

### New files
- `src/definitions/drag-and-drop.ts` — ComponentDefinition for DragDrop
- `tests/definitions/drag-and-drop.test.ts` — unit tests

### Modified files
1. `src/shared/component-types.ts`
   - Add `'DragDrop'` to `InteractionType` union
   - Add `'mouseup'`, `'dragstart'`, `'dragover'`, `'drop'`, `'dragend'` to `BrowserEventType`

2. `src/tap/event-tap.ts`
   - Add `'mouseup'`, `'dragstart'`, `'dragover'`, `'drop'`, `'dragend'` to registered event types

3. `src/definitions/index.ts`
   - Import and register `dragAndDropDefinition` at priority 15 (before Dropdown=20)

4. `src/generation/component-to-classifier-adapter.ts`
   - Add `DragDrop: 'DragDrop'` to DEFAULT_SUBTYPE

5. `src/sidepanel/interaction-renderer.ts`
   - Add `DragDrop` to TYPE_DISPLAY (icon, label, color)
   - Add `DragDrop` case to `fallbackActionDescription`

6. `src/generation/ir-bridge.ts`
   - Change `DragDrop: IRAction.CLICK` → `DragDrop: IRAction.DRAG_DROP` (new IRAction)

7. `src/domain/execution-ir/types.ts`
   - Add `DRAG_DROP = 'dragAndDrop'` to IRAction enum

8. `src/adapters/playwright/action-renderer.ts`
   - Add `IRAction.DRAG_DROP` rendering case (source → target drag)

## Acceptance Criteria
- [ ] `DragDrop` in InteractionType union
- [ ] `mouseup` + HTML5 drag events in BrowserEventType and EventTap
- [ ] drag-and-drop.ts definition triggers on mousedown/dragstart
- [ ] Displacement threshold (< 10px → discard, ≥ 10px → drag)
- [ ] Click-after-drag suppression (DragDrop consumes the click event)
- [ ] Source element, drop target, and displacement recorded in metadata
- [ ] Registered in ALL_DEFINITIONS at priority 15
- [ ] Adapter maps DragDrop → 'DragDrop' classifier type
- [ ] Renderer shows drag icon + "Drag X to Y" description
- [ ] IRAction.DRAG_DROP added and mapped
- [ ] Playwright action renderer handles DRAG_DROP
- [ ] All existing tests pass (no regressions)
- [ ] New unit tests cover: mouse drag, click-not-drag (discard), HTML5 DnD, no-click-after-drag
