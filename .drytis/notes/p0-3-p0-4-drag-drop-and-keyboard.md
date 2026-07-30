# P0-3 (Drag and Drop) + P0-4 (Keyboard Shortcuts) Implementation

## P0-3: Drag and Drop

### Design
- **Priority 15** — before Dropdown (20), after DatePicker (10)
- **Two capture paths**: mouse-based (mousedown→mousemove→mouseup) and HTML5 DnD (dragstart→drop)
- **Displacement threshold**: MIN_DRAG_DISPLACEMENT_PX = 10. Below = discard (Click handles), above = drag
- **Click-after-drag suppression**: DragDrop stays active after mouseup to consume the subsequent click event. `isInScope` only claims click when `dragDetected === true`
- **Exclusion**: Form controls (SELECT, TEXTAREA, INPUT) and ARIA roles (combobox, slider, etc.) excluded from mousedown trigger — prevents blocking Dropdown/Slider/etc.

### Files
- `src/definitions/drag-and-drop.ts` — ComponentDefinition (NEW)
- `src/shared/component-types.ts` — Added 'DragDrop' + 'mouseup'/'dragstart'/'dragover'/'drop'/'dragend'
- `src/tap/event-tap.ts` — Added 5 new event types to listener registration
- `src/domain/execution-ir/types.ts` — Added IRAction.DRAG_DROP
- `src/adapters/playwright/action-renderer.ts` — renderDragDrop (source.dragTo(target))
- `src/sidepanel/interaction-renderer.ts` — 📦 icon, "Drag X to Y" description
- `src/generation/ir-bridge.ts` — DragDrop → DRAG_DROP mapping + description
- `src/generation/component-to-classifier-adapter.ts` — DragDrop subtype + metadata

### Key lessons
- Runtime emits 'discarded' endState interactions — tests must check endState, not absence
- isInScope must NOT claim click events unless drag was actually detected — otherwise ALL clicks get consumed
- shouldCancelOnOutside must include mouseenter/mouseleave/focus/blur to abandon DragDrop early for non-drag interactions

## P0-4: Keyboard Shortcuts

### Design
- **Priority 5** — first definition in the pipeline
- **Two trigger paths**: (1) modifier+key (Ctrl+S, Cmd+K, Shift+Tab), (2) special keys (Escape, Enter, Tab, F1-F12, arrows)
- **Text input exclusion**: Does NOT trigger for special keys inside text inputs/textareas/contenteditable — TextEntry handles those. Exception: Escape always triggers. Modifier+key always triggers (Ctrl+B in editor).
- **Key normalization**: formatShortcut (display "Ctrl+S"), normalizeKeyForPlaywright ("Control+s")
- Space key needs special handling — checked before single-char branch since ' '.length === 1

### Files
- `src/definitions/keyboard-shortcut.ts` — ComponentDefinition (NEW)
- `src/classifier/interaction-types.ts` — Added KeyboardShortcut type, metadata fields, category, TYPE_DISPLAY
- `src/domain/execution-ir/types.ts` — Added IRAction.PRESS_KEY
- `src/generation/ir-bridge.ts` — extractInputValue case for KeyboardShortcut (uses playwrightKey)
- `src/adapters/playwright/action-renderer.ts` — renderPressKey (locator.press or page.keyboard.press)

### Key lessons
- **End-to-end IR gap**: extractInputValue must have a case for every new type — otherwise step.input is null and Playwright code generation uses fallback values. Fixed for both DragDrop and KeyboardShortcut.
- Duplicate TYPE_DISPLAY entries (same key in object literal) are silently overwritten by JS — always add new entries in their proper alphabetical/category position

## Test counts
- P0-3: 15 new tests (drag-and-drop.test.ts)
- P0-4: 31 new tests (keyboard-shortcut.test.ts) + 1 IR bridge test case
- Full suite: 4510 pass, 1 pre-existing JSDOM timing flake (milestone4-performance-scaling)
