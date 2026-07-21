# Toggle Switch Recording

## Objective
Add Toggle Switch support using the Interaction Registry — no architectural changes.

## Type Definitions
- `ToggleEvent` with `toggleAction: 'on' | 'off'`, `isEnabled: boolean`
- `TOGGLE_SWITCHED` message + `TogglePayload`
- `ActionType` widened to include `'toggle'`
- `ExecutionJson` gains `toggleAction?` and `isEnabled?`

## Interaction Registry
Register `toggleConfig`:
- `idPrefix: 'toggle'`, `badgeColor: '#e11d48'`, `badgeLabel: 'TOGGLE'`
- `buildPrompt`: includes toggle state (enabled/disabled)
- `toPlainEnglish`: `Turn on "X"` / `Turn off "X"` / `Enable "X"` / `Disable "X"`
- `renderTitle`: `⏻ Toggle ON: X` / `⏻ Toggle OFF: X`
- `executionExtras`: `{ toggleAction, isEnabled }`
- `addToSession`: `session.addAction(rawIdentity, 'toggle', { isEnabled })`

## Content Script Detection Patterns
1. `input[type=checkbox]` with switch-like class/role (ARIA `role="switch"` on self or parent)
2. Elements with `role="switch"` (Material UI, custom React components)
3. Material UI Switch: `button[class*="MuiSwitch"]` or parent `.MuiSwitch-root`
4. Ant Design Switch: `button[class*="ant-switch"]`
5. Generic `[role="switch"]` with aria-checked state
6. Checkbox-based switches: `input[type=checkbox]` wrapped by `[role="switch"]` parent

**State detection**: `aria-checked` attribute, `aria-selected`, Material `.Mui-checked`, AntD `.ant-switch-checked`, native `checked`.

## Acceptance Criteria
- [ ] Toggle ON captured: `toggleAction: "on"`, `isEnabled: true`
- [ ] Toggle OFF captured: `toggleAction: "off"`, `isEnabled: false`
- [ ] Plain English: `Turn on "Dark Mode"`, `Turn off "Email Notifications"`, etc.
- [ ] Execution JSON correct
- [ ] AI prompt includes toggle state
- [ ] Action ID: `toggle-0001` sequence
- [ ] Element ID, iframeContext, Screenshot reused
- [ ] All 307 existing tests pass unmodified
- [ ] New tests for toggle
- [ ] Registry validation: only registration + content script + types + minimal wiring

## Out of Scope
Date Picker, Slider, Multi-select, File Upload, Hover, Scroll, Right Click, Double Click, Drag & Drop, Keyboard Shortcuts.
