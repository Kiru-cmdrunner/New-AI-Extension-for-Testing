# Date Picker First-Class Interaction — Architecture & Implementation Spec

## Problem

When recording date selection on real-world web apps (e.g. OrangeHRM), the recorder captures the underlying low-level DOM events as separate interactions:

```
Text Entry → Popover → Scroll → Popover → Text Entry → Click → Hover
```

From the user's perspective this is a single action: **"Select Date — Field: Date of Birth, Value: 1987-09-19"**.

Additionally, captured date values are malformed: `1998-15-05` and `1987-19-08` are not valid `yyyy-mm-dd` dates, indicating the recorder is capturing intermediate/partial values or reading from the wrong DOM property.

## Root Cause Analysis

### 1. No `dateSelect` Events from Active Recorder

The legacy `datepicker-content-script.ts` (1132 lines, in `legacy/content-scripts/`) implemented a 5-gate decision tree that:
- Detected native date inputs, calendar grid cells, and editable text inputs
- Captured both `displayValue` (human-readable) and `isoValue` (ISO 8601)
- Emitted `dateSelect` session events with full date metadata

The deterministic recorder (`deterministic-recorder.ts`) **replaced** this script but **never implemented date-specific event capture**. The `dateSelect` action type, `displayValue`, `isoValue`, and `dateType` fields in `BaseActionEvent` are **dead code** — the recorder never populates them.

### 2. Multi-Element Events Not Grouped into Single Interaction

For custom date pickers (calendar popups), the user's interaction spans multiple elements:
1. Click the date input (trigger) → popover opens
2. Click month navigation buttons
3. Click a day cell in the calendar grid
4. (Optionally) click another day cell to change selection
5. Focus moves away → popover closes

The V2 evidence engine has calendar grouping logic (`isRelatedToBuffer()` in engine.ts), but:
- **Popover open/close** events are captured as separate `Popover` interactions
- **Scroll** within the calendar is captured as a `Scroll` interaction
- **Hover** over calendar cells is captured as `Hover` interactions
- The grouping only merges trigger + cell click; intermediate events leak as standalone interactions

### 3. Date Value Not Normalized

The recorder captures `el.value` at `change` event time. For:
- **Native `<input type="date">`**: `el.value` returns ISO (`yyyy-MM-dd`) — correct
- **Custom date pickers with text input**: `el.value` may contain a display format (`"September 19, 1987"`) or partial input (`"1987-09"`) captured mid-interaction
- **Calendar grid cell clicks**: `accessibleName` is used (e.g., `"19 September 1987"`) — no ISO conversion

The V1 classifier's `DATE_VALUE_PATTERNS` can parse some display formats but does **no normalization** — the raw captured value flows through to IR.

The malformed dates (`1998-15-05`, `1987-19-08`) suggest:
- Day and month fields are swapped in some capture paths
- Partial values are captured before the date is fully entered
- The `change` event fires on intermediate states in custom pickers

### 4. MutationProvider Bug: `selectedDate` vs `dateValue`

`mutation-provider.ts` line 137:
```typescript
metadata: cellValue ? { selectedDate: cellValue } : {},
```
`InteractionMetadata` defines `dateValue`, not `selectedDate`. The MutationProvider's date evidence is silently lost when it's the winning evidence.

## Target Architecture

### Design Principle: Value-Outcome Model

Record one `dateSelect` event representing the **committed final value**, not the click sequence. The intermediate events (popover open, scroll, hover, navigation clicks) are retained as raw `SessionEvent[]` evidence but do NOT produce standalone `DetectedInteraction` entries.

### Component Responsibilities

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Deterministic Recorder                           │
│  (Content Script — runs in page context)                            │
│                                                                     │
│  captureDomContext() → detect date controls via:                     │
│    - inputType: date/datetime-local/time/month/week                 │
│    - className patterns: calendar/datepicker/flatpickr/etc.         │
│    - aria-haspopup: dialog/grid                                     │
│    - data-datepicker / data-date attributes                          │
│                                                                     │
│  Date change listener:                                              │
│    - On native date input change → read el.value (ISO)              │
│    - On custom picker commit → read target input.value or           │
│      cell aria-label → parse to ISO                                 │
│    - Debounce: only fire when value stabilizes (no partial values)   │
│    - Emit dateSelect event with:                                    │
│      { displayValue, isoValue, dateType }                           │
│                                                                     │
│  Calendar popover suppression:                                      │
│    - When date picker is open (popover detected near date input),   │
│      suppress Popover/Scroll/Hover/Click events on calendar cells   │
│      as standalone interactions — they are evidence only            │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ SessionEvent[] (with dateSelect events)
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    V1 + V2 Classifier                               │
│                                                                     │
│  DatePicker detection (existing, mostly works):                      │
│    - V1: tryClassifyDatePicker() — 3 paths (native, cell, text)     │
│    - V2: DomProvider + MutationProvider + engine grouping           │
│                                                                     │
│  NEW: dateSelect event handling:                                    │
│    - If dateSelect events exist in the session, classify them       │
│      directly as DatePicker/TimePicker/DateTimePicker               │
│    - Skip classification of raw events that are "owned" by a        │
│      dateSelect event (same element, overlapping timestamp)        │
│                                                                     │
│  Calendar popover suppression:                                      │
│    - Events on calendar grid/gridcell/datepicker elements that      │
│      occur between dateSelect open and close → suppressed           │
│    - These events remain in SessionEvent[] as evidence              │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ DetectedInteraction[] (one DatePicker per selection)
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    IR Bridge                                        │
│                                                                     │
│  DatePicker → SELECT_DATE (existing mapping, works)                 │
│                                                                     │
│  Value extraction:                                                   │
│    - If dateSelect event exists → use isoValue (normalized)          │
│    - Fallback: interaction.metadata.dateValue                        │
│                                                                     │
│  Description:                                                        │
│    - "Select {displayValue} in the {fieldLabel}"                    │
│    - Uses displayValue (human-readable) not isoValue                │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ ExecutionIRPlan with selectDate steps
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Playwright Adapter                                │
│                                                                     │
│  Native date input: locator.fill('1987-09-19')                      │
│  Custom date picker: locator.fill('1987-09-19') +                   │
│    (future: click calendar cell by aria-label)                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Date Normalization Strategy

A shared `normalizeDateValue()` utility that:

1. **Accepts**: ISO strings, display strings (`"September 19, 1987"`), partial values, `aria-label` strings from gridcells
2. **Detects format**: ISO (`yyyy-mm-dd`), US (`mm/dd/yyyy`), EU (`dd/mm/yyyy`), display (`Month DD, YYYY`), `DD Month YYYY`, etc.
3. **Normalizes to ISO 8601**: `yyyy-MM-dd` for dates, `yyyy-MM-ddTHH:mm` for datetime, `HH:mm` for time
4. **Handles ambiguity**: day/month swap detection by checking which value > 12
5. **Returns**: `{ isoValue, displayValue, dateType, confidence }`

Location: `src/shared/date-normalizer.ts` — shared utility used by both recorder (content script) and classifier (service worker).

### Calendar Popover Suppression

The recorder currently detects popovers via `identifySurfaceInline()` and records them as `Popover` interactions. For date picker popovers, we need:

1. **Detection**: When a popover/dialog opens AND it contains calendar grid elements (gridcell, day, cell classes), tag it as a `calendarPopover` rather than a generic `Popover`
2. **Suppression**: Events on elements inside the calendar popover (scroll, hover, click on navigation buttons, click on day cells) are marked as `ownedByDatePicker: true` in their metadata
3. **Classification filter**: The V1/V2 classifier skips events with `ownedByDatePicker` flag — they are evidence, not interactions

### What NOT to Change

- **InteractionType enum**: `DatePicker`, `TimePicker`, `DateTimePicker` already exist — no new types needed
- **IRAction**: `SELECT_DATE = 'selectDate'` already exists
- **IR Bridge mapping**: DatePicker → SELECT_DATE already works
- **Playwright adapter**: `renderSelectDate()` → `fill()` already works for native inputs
- **Domain adapter**: `DatePicker → SELECT_DATE` operation mapping exists
- **Enrichment**: `deriveDateFormat()` already handles native date formats

## Implementation Milestones

### Milestone 1: Date Normalizer Utility + Bug Fix
**Objective**: Create shared date normalization + fix MutationProvider `selectedDate` bug.

Files:
- NEW: `src/shared/date-normalizer.ts` — `normalizeDateValue(rawValue, hints?)` → `{ isoValue, displayValue, dateType, confidence }`
- NEW: `tests/date-normalizer.test.ts` — ISO, display, partial, ambiguous day/month, invalid dates
- EDIT: `src/classifier/evidence/providers/mutation-provider.ts` line 137: `selectedDate` → `dateValue`

Acceptance:
- [ ] `normalizeDateValue('1987-09-19')` → `{ isoValue: '1987-09-19', displayValue: 'September 19, 1987', dateType: 'date' }`
- [ ] `normalizeDateValue('September 19, 1987')` → same result
- [ ] `normalizeDateValue('1987-19-08')` → detects month/day swap → `{ isoValue: '1987-08-19', ... }` (or rejects if truly invalid)
- [ ] `normalizeDateValue('1998-15-05')` → detects month>12 → interprets as `dd-mm-yyyy` → `{ isoValue: '1998-05-15', ... }`
- [ ] `normalizeDateValue('')` → `{ isoValue: '', displayValue: '', dateType: 'date', confidence: 0 }`
- [ ] MutationProvider uses `dateValue` not `selectedDate`
- [ ] All existing tests pass

### Milestone 2: Recorder Date Event Capture
**Objective**: Content script detects date controls and emits `dateSelect` events with normalized values.

Files:
- EDIT: `src/recorder/deterministic-recorder.ts` — add date detection in `captureDomContext()`, date change listener, `dateSelect` event emission with debounce
- NEW: `tests/recorder-date-capture.test.ts` — native date input change, custom picker commit, partial value debounce, dateSelect event fields

Acceptance:
- [ ] Native `<input type="date">` change event → `dateSelect` event with `isoValue` and `displayValue`
- [ ] Custom date picker text input change → `dateSelect` event with normalized `isoValue`
- [ ] Calendar gridcell click → `dateSelect` event with `isoValue` parsed from `aria-label`
- [ ] Partial values during typing → debounced, only final value emitted
- [ ] `dateType` correctly set: `'date'`, `'time'`, `'dateTime'`, `'month'`, `'week'`
- [ ] Date normalizer handles malformed values (month/day swap)
- [ ] All existing tests pass

### Milestone 3: Calendar Popover Suppression
**Objective**: Events inside calendar popovers are marked as evidence-only, not standalone interactions.

Files:
- EDIT: `src/recorder/deterministic-recorder.ts` — detect calendar popover open/close, tag child events with `ownedByDatePicker`
- EDIT: `src/classifier/interaction-detector.ts` — skip events with `ownedByDatePicker` flag in V1
- EDIT: `src/classifier/evidence/engine.ts` — skip events with `ownedByDatePicker` flag in V2 buffer commit
- NEW: `tests/calendar-popover-suppression.test.ts`

Acceptance:
- [ ] Calendar popover open/close NOT classified as `Popover` interaction
- [ ] Scroll inside calendar NOT classified as `Scroll` interaction
- [ ] Hover over calendar cells NOT classified as `Hover` interaction
- [ ] Navigation clicks (prev/next month) NOT classified as `Click` interaction
- [ ] Day cell click absorbed into the `dateSelect` event, not separate `Click`
- [ ] Suppressed events remain in `SessionEvent[]` as evidence
- [ ] All existing tests pass

### Milestone 4: Classifier dateSelect Integration + IR Verification
**Objective**: Classifier recognizes `dateSelect` events and produces clean single DatePicker interaction. IR Bridge uses `isoValue` for execution, `displayValue` for description.

Files:
- EDIT: `src/classifier/interaction-detector.ts` — `classifyInteractions()` checks for `dateSelect` events first
- EDIT: `src/generation/ir-bridge.ts` — `extractInputValue()` uses `dateSelect.isoValue`, `generateDescription()` uses `dateSelect.displayValue`
- EDIT: `src/generation/ir-bridge.ts` — verify `SELECT_DATE` step has correct `input` (ISO) and `description` (display)
- NEW: `tests/date-picker-e2e.test.ts` — simulate full pipeline: record events → classify → IR → verify single `selectDate` step with ISO value

Acceptance:
- [ ] Single date selection produces exactly ONE `DatePicker` DetectedInteraction
- [ ] IR plan has exactly ONE `selectDate` step
- [ ] IR step `input` = ISO value (`1987-09-19`)
- [ ] IR step `description` = `"Select September 19, 1987 in the Date of Birth"`
- [ ] IR step `target.label` = field label (e.g., "Date of Birth")
- [ ] No `Text Entry`, `Popover`, `Scroll`, `Hover`, or `Click` steps for the date selection
- [ ] All existing tests pass

### Milestone 5: Side Panel Display + Integration Verification
**Objective**: Side panel shows clean date selection. Full pipeline verified end-to-end.

Files:
- EDIT: `src/sidepanel/sidepanel.ts` — render date selections as `Select Date: {field} = {displayValue}`
- NEW: `tests/date-picker-integration.test.ts` — full pipeline from raw events through side panel rendering

Acceptance:
- [ ] Side panel shows "Select Date" with field name and display value
- [ ] No raw intermediate events shown as separate user interactions
- [ ] Generated Playwright code uses `fill('1987-09-19')` (ISO)
- [ ] Build succeeds
- [ ] All existing tests pass
- [ ] Foundation validation tests still pass
