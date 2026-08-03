# Milestone – Enterprise Drag & Drop Recording

## Objective
Implement Drag & Drop recording through the existing Interaction Registry. Capture a complete drag-and-drop as ONE meaningful action with source + destination, not separate dragstart/dragover/drop events.

## Research Findings

### HTML5 Native Drag & Drop
- Event sequence: `dragstart` (on dragged item) → `drag` (continuous) → `dragenter`/`dragover` (on targets) → `drop` (on target) → `dragend` (on dragged item)
- `dataTransfer` data set in `dragstart` is only readable during `drop`
- `preventDefault()` needed in `dragover` for drop to fire
- File drags from OS: do NOT fire `dragstart`/`dragend` — only `dragenter`/`drop`
- Supported by: Trello, Jira (classic), Google Drive, SharePoint, native HTML5 apps

### Framework-Based Drag & Drop (dnd-kit, react-beautiful-dnd, Pragmatic DnD)
- Do NOT fire native HTML5 drag events
- Use Pointer Events (mousedown → mousemove → mouseup)
- dnd-kit: PointerSensor, uses CSS transforms, adds `aria-grabbed`/`aria-roledescription`
- react-beautiful-dnd: deprecated, uses similar pointer approach
- Pragmatic DnD: Atlassian's library, also pointer-based
- Detection: monitor mousedown on draggable elements, track mousemove, detect drop target on mouseup

### Dual Detection Strategy
1. **HTML5 path**: Listen to `dragstart` → store source → `drop` → identify destination → emit single event
2. **Pointer path**: Listen to `mousedown` on elements with draggable attributes/ARIA → track `mousemove` → on `mouseup`, find element under cursor → emit single event

## Files to Change

### types.ts
- Add `DragDropEvent`: `{ actionId, type:'drag_drop', timestamp, elementIdentity (source), sourceName, destinationName, dragDropVariant }`
- Widen `SessionEvent`, `ActionType`, `ExecutionJson`
- Add `DRAG_DROP_DETECTED` message, `DragDropPayload`
- Update isAppMessage

### interaction-types.ts
- Register `dragDropConfig` (#0891b2, 'DRAG', 'drag-drop')

### recording-session.ts, service-worker.ts, step-builder.ts, timeline-renderer.ts, ai-understanding.ts
- Standard registry widening

### New file: src/recorder/drag-drop-content-script.ts
- Dual detection: HTML5 events + pointer-based fallback

### manifest.json v1.15.0, sidepanel.css badge

## Plain English
- `Move "Task A" to "Done"`
- `Move "Invoice.pdf" into the "Approved" folder`
- `Upload "Resume.pdf" by dragging it into the upload area`

## Execution JSON
```json
{ "action": "drag_drop", "source": "Task A", "destination": "Done" }
```

## Acceptance Criteria
- [ ] Complete drag-and-drop = ONE action (not multiple events)
- [ ] Source element identified correctly
- [ ] Destination element identified correctly
- [ ] Works with native HTML5 drag-and-drop
- [ ] Works with pointer-based frameworks (dnd-kit, etc.)
- [ ] Duplicate drag events prevented
- [ ] Plain English: "Move X to Y"
- [ ] Execution JSON: action + source + destination
- [ ] Action IDs: drag-drop-NNNN
- [ ] All 423 existing tests pass
- [ ] New tests added
