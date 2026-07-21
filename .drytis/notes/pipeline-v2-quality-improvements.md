# Pipeline V2 Quality Improvements (v9.0.0)

## Starting Point (baseline)
- 6/35 ACCURATE (17%), 22/35 PARTIAL (63%), 7/35 INACCURATE (20%)

## Root Causes Identified & Fixed

### RC-1: Blur Contamination in Target Attribution (FIXED)
**Problem**: `extractElementIdentity()` returned the first semantic event's element, which was often a blur/change from the PREVIOUS interaction leaking into the new unit.
**Fix**: Rewrote to prioritize events in order: click → submit → surface_open → input → change → dragstart/drop → keydown(Enter). Click events checked first because they represent the user's actual action.

### RC-2: State Diff Shows Zero Changes (FIXED)
**Problem**: Snapshots taken synchronously at event time — browser updates `.checked` before dispatching click, so before/after are identical.
**Fix**: Added `preStateMap` (WeakMap) to V2EventObserver. `onMousedown` captures element state BEFORE browser processes click. Added `augmentDiffFromEvents()` to extract value/toggle/radio changes from event-level previousValue when snapshot diff is empty.

### RC-3: Custom ARIA Widgets Fall to Generic Click (FIXED)
**Problem**: No deferred ARIA state read for custom toggles/switches.
**Fix**: Added Path 2 to `booleanToggle` pattern checking for `aria-pressed` and `aria-checked` in change event payloads. Also added `aria-expanded` surface guard to prevent toggle classification when a surface opened.

### RC-4: Multi-Step Interactions Not Grouped (FIXED)
**Problem**: Dropdown trigger click and option click treated as separate units — boundary closed the trigger before the surface opened.
**Fix**: 
- Increased temporal gap from 800ms → 2000ms
- Added `proactiveSurfaceCheck()` to emit surface_open immediately on click of `aria-haspopup` elements
- Added `extractValueFromClick()` to emit synthetic change events for clicks inside surfaces (custom dropdowns, calendars)
- Modified `isClickInitiated()` to return false when input events follow a click (text entry case)

### RC-5: Missing Value Extraction from Clicks (FIXED)
**Problem**: Custom dropdowns, date pickers, multi-selects use click events on div/span/li elements instead of native change events.
**Fix**: 
- `extractValueFromClick()` detects role=option, data-value, calendar cells, and clicks inside known surfaces
- `augmentDiffFromEvents()` connects value changes to dropdown trigger field names
- Added `dateTimeSelection` Path 3 checking change events for date-like values
- Added time pattern detection in `looksLikeDate()` (14:30, 09:15 AM)
- Parse input type from serialized previousValue for accurate date/time classification

### Additional Fixes
- `computeAccessibleName()` now checks label associations BEFORE textContent for form controls (select elements had textContent = all options concatenated)
- Added parent-label detection (`<label><input>Text</label>`)
- Added radio event detection in `singleSelectionFromSet` Path 1b
- Added `multiSelectionFromSet` guard against radio deselection artifacts
- Added `rangeAdjustment` pattern (12th pattern)
- Added `booleanToggle` surface guard (don't match when dialog/menu opened)

## Final Results
- **20/35 ACCURATE (57%)** — up from 6/35 (17%)
- **14/35 PARTIAL (40%)** — down from 22/35 (63%)
- **1/35 INACCURATE (3%)** — down from 7/35 (20%)

### 20 ACCURATE
Button click, Hyperlink click, Text input, Password input, Search input, Textarea, Checkbox toggle, Native dropdown, Multi-select, Date picker (native), Time picker (native), ARIA checkbox toggle, ARIA radio selection, Range slider, Tab switch, Accordion expand, Native details expand, Modal close, File upload, Shadow DOM button.

### Remaining PARTIAL (14)
Radio selection (type=select not radio, N/A target — native radio in test harness), Custom calendar (correctTarget), Date range (N/A target), ARIA combobox (correctTarget), Toggle switch (N/A target), Segmented control (type=select), Autocomplete (hasValue), Tree expand/collapse (type=text), Table sort (correctTarget), Table row checkbox (N/A target), Modal open (type=checkbox), Drag & Drop (correctTarget), Rich text editor (type/hasValue), Form submit (correctTarget).

### 1 INACCURATE
CSS-only dropdown (no ARIA) — type=click instead of select, no value extracted. The dropdown uses CSS :hover only with no ARIA roles or class-based surface detection.

## Files Changed
- `src/recorder/pipeline-v2/boundary-detector.ts` — temporal gap 800→2000ms
- `src/recorder/pipeline-v2/v2-event-observer.ts` — proactiveSurfaceCheck, extractValueFromClick, pre-state tracking
- `src/recorder/pipeline-v2/pattern-registry.ts` — all 5 fixes + rangeAdjustment pattern + radio detection + time detection
- `src/recorder/pipeline-v2/interaction-assembler.ts` — prioritized extractElementIdentity
- `src/recorder/pipeline-v2/pipeline-v2.ts` — augmentDiffFromEvents improvements + input type parsing
- `src/recorder/observer/observer-helpers.ts` — computeAccessibleName label-first for form controls
