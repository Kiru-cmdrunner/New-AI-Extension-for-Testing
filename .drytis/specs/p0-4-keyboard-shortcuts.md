# P0-4: Keyboard Shortcuts Interaction Type

## Goal
Add a generic, application-independent KeyboardShortcut interaction type to the
Component Runtime pipeline. Captures keyboard shortcuts (modifier+key combos),
single-key actions (Escape, Enter, Tab, Delete, arrow keys), and special key
sequences — with modifier detection and key normalization.

## Problem
Currently, keydown events are captured by EventTap (key, code, shiftKey, ctrlKey,
altKey, metaKey) but no Component Definition claims them. Key presses are lost
— they don't appear in the timeline, aren't represented semantically, and can't
be played back.

## Design Decisions

### D1: Two capture modes
1. **KeyboardShortcut** (modifier+key): Ctrl+S, Cmd+K, Shift+Tab, Ctrl+Shift+P
   - Triggers when keydown has at least one modifier (ctrl, meta, alt) OR shift combined with a non-character key
   - Completes immediately
2. **Special keys** (no modifier, non-printable): Escape, Enter, Tab, F1-F12, Arrow keys, Backspace, Delete
   - Triggers on keydown for keys in a known set
   - Completes immediately
   - Regular typing (single character keys without modifiers) is NOT captured here — TextEntry handles it

### D2: Exclusion of text input typing
KeyboardShortcut does NOT trigger when the target element is a text input, textarea,
or contenteditable — unless a modifier key is involved (Ctrl+B in a text editor IS a shortcut).
This prevents the shortcut definition from interfering with TextEntry capture.

### D3: Key normalization
- Display key: "Ctrl+S", "Cmd+K", "Shift+Tab", "Escape", "Enter"
- Platform-aware: metaKey on Mac (⌘), ctrlKey on Windows/Linux
- Normalized: always show "Ctrl" for ctrlKey, "Cmd" for metaKey (let the renderer decide display)

### D4: Priority 5 (highest priority)
KeyboardShortcut triggers at the start of the event pipeline. It's the most specific
definition — only fires on keydown events with modifier/special keys. No other definition
handles keydown as a trigger.

## Files to Change

### New files
- `src/definitions/keyboard-shortcut.ts` — ComponentDefinition
- `tests/definitions/keyboard-shortcut.test.ts` — unit tests

### Modified files
1. `src/shared/component-types.ts` — Add 'KeyboardShortcut' to InteractionType
2. `src/definitions/index.ts` — Register at priority 5
3. `src/generation/component-to-classifier-adapter.ts` — Map to classifier type
4. `src/sidepanel/interaction-renderer.ts` — Add TYPE_DISPLAY + description
5. `src/domain/execution-ir/types.ts` — Add PRESS_KEY to IRAction enum
6. `src/generation/ir-bridge.ts` — Map KeyboardShortcut → PRESS_KEY
7. `src/adapters/playwright/action-renderer.ts` — Add PRESS_KEY rendering
8. `src/classifier/interaction-types.ts` — Already has KeyboardShortcut in the union? Need to verify

## Acceptance Criteria
- [ ] KeyboardShortcut in InteractionType union
- [ ] Triggers on modifier+key combos (Ctrl+S, Cmd+K, Shift+Tab, etc.)
- [ ] Triggers on special keys (Escape, Enter, Tab, F1-F12, arrows, etc.)
- [ ] Does NOT trigger on regular typing in text fields
- [ ] Modifier keys correctly captured (ctrl, meta/cmd, alt, shift)
- [ ] Key normalized to display format (Ctrl+S, Cmd+K)
- [ ] Registered at priority 5 (first definition checked)
- [ ] Adapter maps to classifier type
- [ ] Renderer shows keyboard icon + shortcut description
- [ ] IRAction.PRESS_KEY added and mapped
- [ ] Playwright renderer generates page.keyboard.press() or locator.press()
- [ ] All existing tests pass (no regressions)
- [ ] New unit tests cover: modifier shortcut, special key, text input exclusion, normalization
