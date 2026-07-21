# Milestone – Enterprise Right Click & Double Click Recording

## Objective
Implement Right Click and Double Click recording through the existing Interaction Registry. Critical: proper deduplication — a double-click must generate ONE double_click action, not two clicks + a double-click. A right-click must not generate a normal click.

## Browser Event Sequence
- **Normal click:** `mousedown(0) → mouseup(0) → click` → record `click`
- **Double click:** `mousedown(0) → mouseup(0) → click → mousedown(0) → mouseup(0) → click → dblclick` → record ONLY `double_click`, suppress both `click` events
- **Right click:** `mousedown(2) → mouseup(2) → contextmenu` → record `right_click` (no `click` event fires for right-click in standard browsers)

## Deduplication Strategy
### Click → Double-Click suppression
Modify click-content-script.ts:
1. On each `click` event, store `{ element, timestamp }` in a `pendingClick` variable
2. Set a 300ms timer. If timer fires (no second click arrived), emit `CLICK_CAPTURED`
3. If a second `click` arrives within 300ms on the same element, cancel the pending click and wait for `dblclick`
4. On `dblclick` event, emit `DOUBLE_CLICK_DETECTED` instead

### Right-Click isolation
- `contextmenu` event fires separately from `click`
- Standard browsers do NOT fire `click` for `button === 2`
- No modification needed to click-content-script for right-click — but we add a guard in click handler: `if (event.button !== 0) return;` (already present)
- Right-click content script listens to `contextmenu` event

## Files to Change

### types.ts
- Add `RightClickEvent` interface: `{ actionId, type:'right_click', timestamp, elementIdentity }`
- Add `DoubleClickEvent` interface: `{ actionId, type:'double_click', timestamp, elementIdentity }`
- Widen `SessionEvent`, `ActionType`, `ExecutionJson`
- Add messages: `RIGHT_CLICK_CAPTURED`, `DOUBLE_CLICK_DETECTED`
- Add payloads, update isAppMessage

### interaction-types.ts
- Register `rightClickConfig` (#dc2626, 'RIGHT CLICK', 'right-click')  
- Register `doubleClickConfig` (#ea580c, 'DOUBLE CLICK', 'dblclick')

### recording-session.ts
- Add generators, addAction switch cases

### service-worker.ts
- Add RIGHT_CLICK_CAPTURED and DOUBLE_CLICK_DETECTED routing

### step-builder.ts, timeline-renderer.ts, ai-understanding.ts
- Widen unions

### click-content-script.ts (MODIFY)
- Add delayed click emission with 300ms debounce
- Add dblclick listener that cancels pending click and emits double-click
- This is the ONLY modification to an existing file

### New files
- `src/recorder/right-click-content-script.ts`
- (double-click handled within click-content-script.ts since they share the click event)

### manifest.json
- Add right-click content script entry
- Bump to v1.14.0

### sidepanel.css
- Add badge colors

## Plain English
- Right-click: `Right-click the "Customer Record".`
- Double-click: `Double-click the "Invoice.pdf" file.`

## Execution JSON
```json
{ "action": "right_click" }
{ "action": "double_click" }
```

## Acceptance Criteria
- [ ] Right-click is detected via contextmenu event
- [ ] Double-click is detected via dblclick event
- [ ] Double-click does NOT produce two click events (dedup)
- [ ] Right-click does NOT produce a click event
- [ ] Normal single click still works (300ms delay is acceptable)
- [ ] Plain English: "Right-click the X" / "Double-click the X"
- [ ] Execution JSON correct
- [ ] Action IDs: right-click-NNNN, dblclick-NNNN
- [ ] All 402 existing tests pass
- [ ] New tests added
