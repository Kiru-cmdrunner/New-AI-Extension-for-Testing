# Root Cause Investigation: Missing Interaction Types

## Executive Summary

Only Click, TextEntry, Link, Navigation, and Scroll interactions are being captured in production. Dropdown, DatePicker, Checkbox, and RadioButton are failing at different stages of the pipeline. The root causes are a combination of **sort-direction bug**, **lifecycle abandonment via premature `shouldCancelOnOutside`**, **`mousemove` event flooding**, **pattern matching gaps for custom UI frameworks**, and **overly aggressive Scroll capture with no coalescing**.

## Pipeline Trace Per Interaction Type

### ✅ Click (Priority 180) — WORKING
- **Event Tap**: Captures `click` events → builds ObservedEvent with full identity
- **Runtime Discovery**: Click is the **fallback** — checked last via `this.clickDefinition`
- **Definition**: Immediate completion (`handleEvent` returns `completed` instantly)
- **No lifecycle dependency**: No multi-event chain needed
- **Why it works**: Single-event, no pattern matching required, no lifecycle to break

### ✅ TextEntry (Priority 50) — WORKING
- **Event Tap**: Captures `focus` → `input` → `blur` chain
- **Runtime Discovery**: `detectTrigger` checks `isTextEntry(tag, inputType, ariaRole, isContentEditable)` — matches standard `<input type="text/email/password">`
- **Definition**: Multi-event lifecycle, but `isInScope` matches same element, `handleEvent` captures `valueAfter`
- **Why it works**: `INPUT_TYPE_ROLE_MAP` correctly maps `text`, `email`, `password` → `textbox`, and `isTextEntry` checks for `ariaRole === 'textbox'`. Standard HTML inputs work perfectly.

### ✅ Link (Priority 70) — WORKING
- **Event Tap**: Captures `click` on `<a>` elements
- **Runtime Discovery**: `detectTrigger` checks `isLink(tag, ariaRole)` — `TAG_ROLE_MAP['A'] = 'link'`
- **Why it works**: Simple tag → role mapping, no lifecycle

### ✅ Navigation (Priority 120) — WORKING
- **Event Tap**: Synthetic `navigation` event emitted on URL change
- **Why it works**: Not DOM-dependent — injected by the service worker

### ❌ Checkbox (Priority 30) — NOT WORKING IN PRODUCTION

**Pipeline trace:**
1. **Event Tap**: Captures `click` on checkbox → `INPUT_TYPE_ROLE_MAP['checkbox'] = 'checkbox'` → `ariaRole = 'checkbox'`
2. **Runtime Discovery**: `detectTrigger` checks `isCheckbox(tag, inputType, ariaRole)`
3. **The definition completes immediately** — `handleEvent` returns `{ endState: 'completed' }` instantly

**Root cause**: The definition itself works correctly for **native** HTML checkboxes. However, OrangeHRM uses **custom OXD checkboxes** — `<div>` wrappers with `class="oxd-checkbox-wrapper"` containing an `<input type="checkbox">` that may be visually hidden or wrapped. The user clicks the wrapper div, not the actual checkbox input.

The event target is the **wrapper div**, which:
- Has `tag: 'DIV'` (not `'INPUT'`)
- Has `inputType: null` (not `'checkbox'`)
- Has `ariaRole: null` (no explicit ARIA checkbox role on the wrapper)

→ `isCheckbox('DIV', null, null)` returns **false** → `detectTrigger` returns null → falls through to Click fallback → captured as generic Click, not Checkbox.

**Where it breaks**: `detectTrigger` in `checkbox.ts` — pattern doesn't match custom framework checkboxes.

**File**: `src/definitions/patterns.ts`, `isCheckbox()` function (line ~274)

### ❌ RadioButton (Priority 40) — NOT WORKING IN PRODUCTION

**Same root cause as Checkbox.** `isRadio()` only matches `tag === 'INPUT' && inputType === 'radio'` or `ariaRole === 'radio'`. Custom OXD radio wrappers don't match.

**File**: `src/definitions/patterns.ts`, `isRadio()` function (line ~290)

### ❌ Dropdown (Priority 20) — NOT WORKING IN PRODUCTION

**Pipeline trace:**
1. **Event Tap**: Captures `mousedown`/`click` on the OXD dropdown trigger (`div.oxd-select-text-input`)
2. **Runtime Discovery**: `detectTrigger` checks `isDropdownTrigger(tag, ariaRole, className)`:
   - `tag = 'DIV'`, `ariaRole = null`, `className = 'oxd-select-text-input'`
   - `DROPDOWN_TRIGGER_CLASS_RE = /(oxd-select-text|select|combobox|dropdown|antd.*select|MuiSelect)/i`
   - ✅ This **matches** — so `detectTrigger` returns `{ type: 'Dropdown' }`
3. **Lifecycle begins**: Dropdown component is created on the active stack
4. **User clicks an option**: `div[role=option].oxd-select-option`
   - BUT: the option element is inside a **portal-rendered overlay** appended to `<body>`, NOT inside the dropdown trigger's DOM subtree
   - `isInScope` checks: `elementKey` match? No. `isDropdownOption`? Checks `ariaRole === 'option'` — this should match if `role=option` is set
   - **BUT**: before the click on the option arrives, **`shouldCancelOnOutside` fires on `mousedown`** on the option (which fires before `click`)
   - The mousedown target is the option div — `elementKey` doesn't match the trigger, `isInsideDropdownSurface` checks the option's className (`oxd-select-option`) against `DROPDOWN_SURFACE_CLASS_RE` — does `oxd-select-option` match `/oxd-select-dropdown/`? **No** — `option` ≠ `dropdown`.
   - → `shouldCancelOnOutside` returns **true** → Dropdown is **abandoned** before the option click can complete it

**Root cause**: `shouldCancelOnOutside` fires on `mousedown` (which precedes `click`). The option's className doesn't match the dropdown surface regex. The lifecycle is abandoned before the completion click arrives.

**Where it breaks**: `shouldCancelOnOutside` in `dropdown.ts` (line ~121), combined with `DROPDOWN_SURFACE_CLASS_RE` not matching option class names in `patterns.ts`

**File**: `src/definitions/dropdown.ts` line 121-137, `src/definitions/patterns.ts` line ~116

### ❌ DatePicker (Priority 10) — NOT WORKING IN PRODUCTION

**Pipeline trace:**
1. **Event Tap**: Captures `focus`/`click` on `input.oxd-date-input`
2. **Runtime Discovery**: `detectTrigger` checks `isDatePickerTrigger(tag, inputType, className, ...)`:
   - `DATEPICKER_TRIGGER_CLASS_RE = /(oxd-date-input|datepicker|...)/i`
   - ✅ This **matches**
3. **Lifecycle begins**: DatePicker on active stack
4. **User clicks a calendar day**: The calendar popup is portal-rendered
   - Same as Dropdown: `mousedown` on the calendar cell fires before `click`
   - `shouldCancelOnOutside` fires on mousedown
   - `isInsideCalendarSurface` checks `CALENDAR_SURFACE_CLASS_RE` against the cell's className
   - The cell class is typically `oxd-date-day` or similar
   - `CALENDAR_SURFACE_CLASS_RE = /(oxd-date-input-dropdown|oxd-calendar|calendar|datepicker|...)/i`
   - If the cell is inside `div.oxd-calendar-dropdown`, the **ancestor classes** need to contain a match
   - **BUT**: `shouldCancelOnOutside` only checks the target's className, not ancestor classes! (unlike `isInScope` which also checks ancestors)
   - → `shouldCancelOnOutside` returns **true** → DatePicker abandoned before the cell click completes it

**Root cause**: `shouldCancelOnOutside` in `date-picker.ts` doesn't check ancestor classes, while `isInScope` does. The lifecycle is abandoned when the user mousedowns on a calendar cell.

**Where it breaks**: `shouldCancelOnOutside` in `date-picker.ts` (line ~133), missing ancestor class check

**File**: `src/definitions/date-picker.ts` line 133-148

### ⚠️ Scroll (Priority 110) — EXCESSIVE

**Pipeline trace:**
1. **Event Tap**: Captures `scroll` events with 16ms rate limiting (`SCROLL_MIN_INTERVAL_MS = 16`)
2. **At 16ms intervals, a single scroll gesture generates ~60 events/second**
3. **Runtime Discovery**: Each scroll event triggers `detectTrigger` → returns `{ type: 'Scroll' }`
4. **Immediate completion**: Each scroll event → immediate `completed` interaction
5. **Dedup check**: `isDuplicate` checks `same type + same elementKey + gap ≤ 2000ms`
   - All scroll events on the same page have the same `elementKey` (document body)
   - Gap between scroll events is ~16ms — well within the 2000ms window
   - **So only the FIRST scroll in a 2-second burst should pass dedup**
   - **BUT**: `isDuplicate` only compares against `lastEmittedForDedup` — the SINGLE previous interaction
   - If a TextEntry or Click fires between scrolls, it replaces the dedup record, and the NEXT scroll event is no longer a duplicate (different type)

**Root cause**: The dedup mechanism only remembers the **single last interaction**, not the last interaction of each type. After any non-Scroll interaction fires, the next Scroll event passes dedup even if it's part of the same scroll burst. Additionally, there's no **scroll coalescing** — each discrete scroll gesture should produce ONE Scroll interaction, not one per 16ms tick.

**Where it breaks**: `isDuplicate` in `component-runtime.ts` (line 396-418) — single-record dedup, and no scroll-specific coalescing in `scroll.ts` or `event-tap.ts`

**File**: `src/runtime/component-runtime.ts` line 396-418, `src/definitions/scroll.ts`

## Cross-Cutting Issues

### Issue A: Sort Direction Bug (component-runtime.ts:112)

```typescript
// Current (WRONG):
this.definitions = [...definitions].sort((a, b) => b.priority - a.priority);
```

This sorts **descending** by priority number. The spec says "lower number = higher priority = checked first". So DatePicker (10) should be checked first, Click (180) last.

Current behavior: Click (180) is checked FIRST in `nonClickDefinitions` — but Click is excluded from `nonClickDefinitions`, so this only affects the order of DatePicker vs Dropdown vs Checkbox etc.

**Impact**: Definitions with HIGHER priority numbers are checked first in discovery. In practice, this means TextEntry (50) is checked before DatePicker (10) — if a date input is `type="text"` with `ariaRole='textbox'`, TextEntry claims it before DatePicker gets a chance.

Wait — actually `this.nonClickDefinitions` is filtered from the already-sorted `this.definitions`. The sort puts high numbers first. So discovery order is: Navigation(120) → Scroll(110) → Link(70) → Hover(60) → TextEntry(50) → RadioButton(40) → Checkbox(30) → Dropdown(20) → DatePicker(10).

**This means TextEntry (50) IS checked before DatePicker (10)**. If an OXD date input has `inputType='text'` and `ariaRole='textbox'`, TextEntry claims it. DatePicker never gets a chance.

**This is the primary reason DatePicker is broken for OXD date inputs.**

### Issue B: mousemove Event Flooding (event-tap.ts:205)

`mousemove` was added for Hover confidence tracking. It fires at 60+ Hz during normal mouse movement. Every `mousemove` event:
1. Goes through `chrome.runtime.sendMessage` to the service worker
2. Is processed by the ComponentRuntime (dedup check, offer to active stack, discovery)
3. Each one is checked against all active components' `isInScope`

This floods the message pipeline and can delay delivery of critical events (`click`, `change`, `blur`), causing lifecycle timeouts and abandoned interactions.

**Impact**: Critical events arrive late or out of order, causing Dropdown/DatePicker lifecycles to miss their completion events.

### Issue C: mousemove Creates Ghost Interactions

Since `mousemove` is now in the event types list, it goes through discovery. If no active component claims it, it tries all definitions. Scroll's `detectTrigger` checks `eventType !== 'scroll'` — so it won't match. But the runtime still spends cycles processing each mousemove through the entire definition list.

## Root Cause Summary

| Interaction | Root Cause | Stage | File |
|---|---|---|---|
| **Dropdown** | `shouldCancelOnOutside` fires on mousedown before click completes; surface regex doesn't match option classes | Lifecycle abandoned | dropdown.ts:121 |
| **DatePicker** | Sort direction: TextEntry claims date inputs before DatePicker gets checked; `shouldCancelOnOutside` doesn't check ancestors | Never triggers / abandoned | component-runtime.ts:112, date-picker.ts:133 |
| **Checkbox** | Custom OXD checkboxes are div wrappers without ARIA roles → pattern doesn't match | Never triggers | patterns.ts:274 |
| **RadioButton** | Custom OXD radios are div wrappers without ARIA roles → pattern doesn't match | Never triggers | patterns.ts:290 |
| **Scroll (excessive)** | No coalescing; dedup single-record reset by interleaved interactions | Over-emitted | component-runtime.ts:396, scroll.ts |

## Proposed Fixes (Architectural)

### Fix 1: Sort direction (critical)
Change `b.priority - a.priority` to `a.priority - b.priority` so DatePicker(10) is checked before TextEntry(50).

### Fix 2: Rate-limit mousemove
Add a `MOUSEMOVE_MIN_INTERVAL_MS = 100` (or remove mousemove entirely and use a timer in hover.ts).

### Fix 3: Expand Checkbox/Radio patterns
Add CSS class matching for framework wrappers: `oxd-checkbox`, `oxd-radio`, `custom-checkbox`, `custom-radio`, etc.

### Fix 4: Fix shouldCancelOnOutside for Dropdown/DatePicker
- Check ancestor classes (not just target className)
- Add option/cell class patterns to the surface regex
- Add grace period: don't cancel on the first mousedown after trigger — wait for the click

### Fix 5: Scroll coalescing
Add a scroll debounce/coalesce in event-tap.ts: collect scroll events for 500ms after the last scroll, then emit ONE coalesced scroll event with the total delta.
