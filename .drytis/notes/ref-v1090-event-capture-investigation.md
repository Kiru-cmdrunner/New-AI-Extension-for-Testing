# v10.9.0 Implementation Reference — Event Capture & Value Extraction

Source: Detailed investigation of commit 9976ff8 (v10.9.0), provided by user 2026-07-27.

## Critical Correction to Architecture Understanding

In v10.9.0, `deterministic-recorder.ts` is **DEAD CODE** — NOT wired into the
manifest. The active content script is `src/recorder/phase5/recorder-entry.ts`
which installs the EventTap (`src/tap/event-tap.ts`). The Component Runtime
(`src/runtime/component-runtime.ts`) is the active lifecycle engine.

Our workspace (integration branch) still uses `deterministic-recorder.ts` as
the active recorder. The v10.9.0 reference has already evolved past it.

## Value Capture Timing (CRITICAL)

| Event Type | Field Read | Purpose |
|-----------|-----------|---------|
| focus | valueBefore | Pre-existing value when field gains focus |
| click | valueBefore | Current state at click time |
| mousedown | valueBefore | Before click completes |
| input | valueAfter | New value on every keystroke/paste |
| change | valueAfter | On commit (select, date change) |
| blur | valueAfter | **FINAL value — critical fallback** |

Blur-time capture catches: browser autofill (no input event), paste in some
frameworks, React controlled inputs (no native input event), programmatic
value setting.

## captureValue Cascade (identity-extractor.ts:377-401)

Priority order for reading element value:
1. `<select>` → selected option's text
2. `<input>/<textarea>` → `.value`
3. `aria-valuetext` (sliders, spinbuttons)
4. `aria-valuenow` (numeric values)
5. `contentEditable` → innerText/textContent
6. `[aria-selected="true"]` descendant (listbox/combobox)
7. `aria-activedescendant` reference (combobox active option)

## resolveTarget — 4-Strategy Cascade (identity-extractor.ts:470-503)

1. composedPath() → first element matching INTERACTIVE_SELECTOR
2. Walk parents from raw target for interactive match
3. Clickable heuristic: `cursor:pointer` or `hasAttribute('onclick')`
4. Raw target (if not structural like body/html)

### INTERACTIVE_SELECTOR (identity-extractor.ts:445-455)
Standard tags: `a[href], button, select, input, textarea, summary, option`
ARIA roles: `[role="button"], [role="combobox"], [role="checkbox"], [role="slider"], [role="textbox"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="radio"], [role="switch"]`
Custom: `[tabindex], [onclick], [data-action], [aria-haspopup], [contenteditable]`

### INTERACTIVE_CLASS_RE (patterns.ts:62-63)
`/(btn|button|clickable|selectable|dropdown|menu-item|nav-item|tab-item|chip|toggle|action|stepper|counter|increment|decrement|qty|quantity|plus|minus|add-btn|remove-btn|arrow|chevron|expand|collapse)/i`

## captureCheckedState — Framework-Aware (identity-extractor.ts:409-434)

Priority cascade:
1. `HTMLInputElement.checked` (for checkbox/radio types)
2. `aria-checked="true/false"`
3. `aria-pressed="true/false"`
4. CSS class fallback: `mui-checked`, `ant-checkbox-checked`, `ant-radio-checked`, `ant-switch-checked`, `checked` (but NOT if `unchecked`/`not-checked` present)

## Framework Wrapper Detection

All definitions check combined own + ancestor classes (10 levels deep):
- **Checkbox**: `/(checkbox.*wrapper|checkbox.*input|oxd-checkbox|checkbox-input|custom-checkbox)/i`
- **Radio**: `/(radio.*wrapper|radio.*input|oxd-radio|radio-input|radio-btn|custom-radio)/i`
- **Dropdown**: `/(oxd-select-text|select|combobox|dropdown|antd.*select|MuiSelect|selector|traveler|passenger|cabin|class-selector|trip-type|economy|traveller)/i`
- **DatePicker**: oxd-date-input, datepicker, date-picker, calendar-input + DATE_INPUT_TYPES
- **Date cells**: oxd-date-day, calendar-day, flatpickr-day

## Event Tap Details

- All listeners: `capture: true, passive: true`
- Only trusted events (isTrusted filter, bypass via TEST_HOOK.forceTrusted)
- scroll rate-limited to ~60fps (16ms min interval)
- mousemove throttled to ~20fps (50ms min interval)
- History API monkey-patching for SPA navigation detection
- sessionStorage buffer with exponential backoff retry (MV3 reliability)
- Content script: `all_frames: true, run_at: "document_start"`

## Modal Tracker

`modal-tracker.ts` exists but is **NOT wired** into the active runtime. The
active architecture uses timeout-based lifecycle abandonment (15s) rather than
DOM boundary heuristics. Deliberate decision: "portal-rendered overlays break
those checks."

## Component Priority Registry (definitions/index.ts)

| Priority | Type | Trigger Events |
|----------|------|---------------|
| 10 | DatePicker | focus, click |
| 20 | Dropdown | click, mousedown, focus |
| 25 | Slider | click, input, change |
| 30 | Checkbox | click |
| 35 | FileUpload | change |
| 40 | RadioButton | click |
| 50 | TextEntry | focus |
| 60 | Hover | mouseenter, mouseleave, mousemove |
| 65 | Tab | click |
| 70 | Link | click |
| 110 | Scroll | scroll |
| 120 | Navigation | (custom — not event-based) |
| 180 | Click (fallback) | click, contextmenu |

## TextEntry Completion (text-entry.ts:48-70)

```
handleEvent:
  input/change → userTyped=true, textValue=valueAfter (stay active)
  blur → if valueAfter non-empty: textValue=valueAfter, complete
         if empty: abandon
```

Blur value overrides input value — critical for autofill/paste/React.

## Dropdown Lifecycle (dropdown.ts)

- detectTrigger: SELECT tag, combobox/listbox role, class patterns, aria-haspopup=listbox, OXD readonly input
- isInScope: same element, isDropdownOption (role=option/class), isInsideDropdownSurface (class on own+ancestors)
- handleEvent: option click→complete(selectedValue=accessibleName||ariaLabel), SELECT change→complete
- noOpSelection: normalizeDisplayValue(selected)===normalizeDisplayValue(triggerDisplay) && non-empty
- shouldCancelOnOutside: FALSE (timeout-based)

## DatePicker Lifecycle (date-picker.ts)

3 completion modes:
1. Calendar cell click → selectedDate=accessibleName (rejects nav buttons)
2. Native input change → dateValue
3. Typed date + blur → if dateValue non-empty: complete

Navigation buttons (prev/next/switch/today/chevron) → lifecycle-internal (return null)
