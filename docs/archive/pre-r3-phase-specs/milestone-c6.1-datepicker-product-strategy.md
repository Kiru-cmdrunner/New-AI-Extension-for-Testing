# Milestone C6.1 — Universal Date Picker Product Strategy

**Type:** Product Design and Planning (no implementation)  
**Status:** PERMANENTLY FROZEN  
**Frozen At:** 2026-07-16T14:00:00Z  
**Date:** 2026-07-16  
**Depends On:** Product Foundation (B1–B8), Product Architecture, C3 (Hover), C4 (Checkbox & Radio), C5 (Dropdown & Select) — all PERMANENTLY FROZEN

---

## Table of Contents

1. [Product Purpose](#1-product-purpose)
2. [Product Model](#2-product-model)
3. [Recording Rules](#3-recording-rules)
4. [Universal Date Selection Categories](#4-universal-date-selection-categories)
5. [Browser Implementation Mechanisms](#5-browser-implementation-mechanisms)
6. [Canonical Test Steps](#6-canonical-test-steps)
7. [Execution Model](#7-execution-model)
8. [Interaction Boundaries](#8-interaction-boundaries)
9. [Validation Strategy](#9-validation-strategy)
10. [Product Principles](#10-product-principles)
11. [Known Assumptions](#11-known-assumptions)
12. [Potential Risks](#12-potential-risks)
13. [Consistency Review Against Frozen Milestones](#13-consistency-review-against-frozen-milestones)
14. [Next Milestone Directive](#14-next-milestone-directive)
15. [Freeze Declaration](#15-freeze-declaration)
16. [Permanent Regression Coverage](#16-permanent-regression-coverage)

---

## 1. Product Purpose

### 1.1 What Is a Date Picker Interaction?

A **Date Picker interaction** is a user's act of selecting a date, time, or date-and-time value through any date-selection control — a native browser input, a calendar widget, a text input with date validation, or a mobile-style picker. The interaction begins when the user initiates a date selection and completes when a new value is committed.

The recorded interaction represents the **resulting selected value** — the final date, time, or range the user committed to — not the physical sequence of calendar clicks, month navigations, typing, or keyboard arrow-key presses used to reach it.

### 1.2 Why Should Date Picker Interactions Be Recorded?

Date selection is a fundamental form interaction in enterprise applications — booking systems, reporting dashboards, scheduling tools, financial forms, travel booking, HR leave requests. These controls carry **critical business data**: the date a report runs, the range a filter applies to, the time a meeting is scheduled.

A recorded test that captures the calendar mechanics but not the resulting date is **functionally broken**. Without the date value, the generated Playwright test either:
- Clicks open a calendar but never selects a date (leaving the field empty)
- Records month-navigation clicks and date-cell clicks as unrelated Click events (noise that obscures intent)
- Fails to reproduce the selected date on playback because the calendar's default month may differ

Today, the CmdRunner recorder captures calendar interactions as a series of unrelated Click events — "click calendar icon", "click next month", "click 15" — without any semantic understanding that the user selected a date. C6 closes this gap.

### 1.3 What User Value Does It Provide?

| Value | Description |
|-------|-------------|
| **Accurate test reproduction** | Generated tests set the correct date value, not just click calendar cells |
| **Business-readable steps** | `Select Date "15 July 2026"` is immediately meaningful; "Click td.text-align-center" is not |
| **Deterministic execution** | Tests reliably set the same date regardless of calendar rendering or timezone |
| **Framework independence** | The same test step works whether the picker is native HTML, React DatePicker, or Material UI |
| **Reduced test noise** | Opening/closing the calendar, month navigation, and year navigation are not recorded; only the committed value is |
| **Range support** | Date ranges are represented as a single semantic step, not two separate clicks |

### 1.4 Differentiation: Meaningful vs Incidental

**Meaningful value change:** The user commits a date, time, or date-range value that differs from the control's previous value. This is the user's intent — to set a date. This MUST be recorded.

**Incidental UI actions:** The user opens the calendar, browses months, hovers dates, then closes without selecting. Or selects the same date that was already set. Or navigates to a different month but doesn't click a date. These are NOT the user's intent to change the value. These MUST NOT be recorded.

The distinction is based on **whether the resulting value changed and was committed**, not on whether the user clicked, typed, or navigated.

| Action | Recorded? | Reason |
|--------|-----------|--------|
| User selects "15 July 2026" when "10 July 2026" was set | ✅ YES | Meaningful value change |
| User selects the same date that was already set | ❌ NO | No value change |
| User opens calendar, browses months, closes without selecting | ❌ NO | No value change |
| User clicks "Next Month" three times but doesn't pick a date | ❌ NO | Navigation only, no committed value |
| User types a date into an input and the value changes | ✅ YES | Meaningful value change via text entry |
| User types an invalid date that the control rejects | ❌ NO | No committed value change |
| User selects a range "1 July" to "10 July" | ✅ YES | Meaningful range selection |
| Programmatic value set via JavaScript | ❌ NO | Not a genuine user event (Gate 1) |

### 1.5 Product Stability Note

> The product requirement is: **record a Date Picker interaction only when the user intentionally commits a date, time, or date-range value that differs from the control's previous value.** The mechanism by which the value change is detected — native `change` event, `input` event, MutationObserver on ARIA attributes, gridcell click detection, text-input blur — is an implementation detail that may evolve. The product rule is stated in terms of the outcome (value changed and committed), not the detection mechanism.

---

## 2. Product Model

### 2.1 Value-Outcome Representation

The product model represents the **selected date/time value**, not the UI mechanics used to achieve it. A user who selects "15 July 2026" via a calendar click produces the same recorded interaction as a user who types "2026-07-15" into a text input.

### 2.2 Date Selection Sub-Types

The product model distinguishes four primary date-selection sub-types, each producing a distinct Canonical Step format:

| Sub-Type | Description | Example Value | Canonical Step |
|----------|-------------|---------------|----------------|
| **Date** | A single calendar date | 15 July 2026 | `Select Date "15 July 2026"` |
| **Date Range** | A start and end date | 1–10 July 2026 | `Select Date Range "1 July 2026" to "10 July 2026"` |
| **Time** | A time of day | 9:30 AM | `Select Time "09:30 AM"` |
| **Date & Time** | A combined date and time | 15 July 2026, 9:30 AM | `Select Date & Time "15 July 2026 09:30"` |

Two additional sub-types are recognized but produce Date-format steps with month/week granularity:

| Sub-Type | Description | Example Value | Canonical Step |
|----------|-------------|---------------|----------------|
| **Month** | A month selection (no day) | July 2026 | `Select Date "July 2026"` |
| **Week** | A week selection | Week 29 of 2026 | `Select Date "Week 29, 2026"` |

### 2.3 Value Format Rules

**Human-readable display value (product model, Canonical Steps):**

| Sub-Type | Format | Example |
|----------|--------|---------|
| Date | `D Month YYYY` | `15 July 2026` |
| Date Range | `D Month YYYY to D Month YYYY` | `1 July 2026 to 10 July 2026` |
| Time | `HH:MM AM/PM` | `09:30 AM` |
| Date & Time | `D Month YYYY HH:MM` (24h) | `15 July 2026 09:30` |
| Month | `Month YYYY` | `July 2026` |
| Week | `Week N, YYYY` | `Week 29, 2026` |

**ISO value (execution layer only):**

| Sub-Type | ISO Format | Example |
|----------|------------|---------|
| Date | `YYYY-MM-DD` | `2026-07-15` |
| Date Range | `YYYY-MM-DD/YYYY-MM-DD` | `2026-07-01/2026-07-10` |
| Time | `HH:MM` | `09:30` |
| Date & Time | `YYYY-MM-DDTHH:MM` | `2026-07-15T09:30` |
| Month | `YYYY-MM` | `2026-07` |
| Week | `YYYY-WNN` | `2026-W29` |

> **Product Rule:** The product model and Canonical Steps always use the human-readable display value. The ISO value is carried alongside for execution purposes but never appears in user-facing step descriptions. How the display value is derived from the control's native value — locale formatting, month name lookup, ISO parsing — is an implementation detail.

> **Product Stability Note:** The display format (`D Month YYYY`) follows a locale-neutral ordering (day, month, year) using English month names. This is a product convention, not a localization decision. If localization is needed in the future, it can be layered on top without changing the product model or recording rules.

### 2.4 Implementation Independence

The product model remains independent of whether the user:

| Method | Recorded As |
|--------|-------------|
| Clicked a calendar gridcell | `Select Date "15 July 2026"` |
| Typed into a native `<input type="date">` | `Select Date "15 July 2026"` |
| Typed into a text input with date validation | `Select Date "15 July 2026"` |
| Used keyboard arrow keys + Enter in a calendar | `Select Date "15 July 2026"` |
| Selected a preset ("Today", "Last 7 Days") | `Select Date Range "..."` |
| Used a mobile wheel picker | `Select Date "15 July 2026"` |

All methods produce the same product model. The Canonical Step is identical. Only the execution strategy differs (see §7).

---

## 3. Recording Rules

### 3.1 Decision Tree (5 Gates)

A Date Picker interaction is recorded only when ALL five gates pass:

```
┌─────────────────────────────────────────────────────┐
│ Gate 1: Genuine User Event                          │
│   Was the value change initiated by a real user     │
│   interaction (not a script or framework update)?   │
│   PRODUCT REQUIREMENT: Only genuine user-initiated  │
│   value changes are recorded.                       │
│   IMPLEMENTATION HINT: isTrusted event, focused     │
│   element, user gesture detection.                  │
├─────────────────────────────────────────────────────┤
│ Gate 2: Ownership                                   │
│   Is this element already owned by another          │
│   registered interaction (data-cmdrunner-handled)?  │
│   If yes → skip (another recorder handles it).      │
├─────────────────────────────────────────────────────┤
│ Gate 3: Control Type                                │
│   Is the element a date-selection control?          │
│   Matches: input[type=date|datetime-local|time|     │
│   month|week], or a recognized calendar/grid        │
│   pattern (see §4–§5).                              │
├─────────────────────────────────────────────────────┤
│ Gate 4: Meaningful Value Change                     │
│   Is the resulting selected value different from    │
│   the value that was selected before the user       │
│   interacted with the control?                      │
│   If the value is unchanged → skip (no-op).         │
├─────────────────────────────────────────────────────┤
│ Gate 5: Enabled Control                             │
│   Is the control enabled and interactive?           │
│   Disabled, read-only, aria-disabled, or inside a   │
│   disabled fieldset → skip.                         │
└─────────────────────────────────────────────────────┘
```

### 3.2 Product Rule (Recording)

> **A Date Picker interaction is recorded when and only when a genuine user action commits a date, time, or date-range value that differs from the control's previous value, and the control is enabled.**

### 3.3 Exclusion Rules (Do Not Record)

| Scenario | Reason |
|----------|--------|
| Opening the calendar popover/dialog | No value change — the user is opening a UI, not selecting |
| Closing the calendar without selecting | No value change — browsing only |
| Month navigation (next/prev buttons) | No value change — navigating the calendar view |
| Year navigation | No value change — navigating the calendar view |
| Hovering calendar cells | No value change — hover is handled by C3 (Hover) if it produces observable behavior |
| Clicking a disabled date | No value change — Gate 5 (the date is disabled) |
| Re-selecting the current date | No value change — the value remains the same |
| Cancelled selection (validation error) | No committed value change — the value was reverted |
| Programmatic value change (`el.value = '...'`) | Gate 1 — not a genuine user event |
| Typing an invalid date that's rejected | No committed value change — validation prevented it |
| Clearing the date (setting to empty) when already empty | No value change |

### 3.4 Special Case: Date Clearing

If the user clears a date value (sets it to empty) that previously had a value, this IS a meaningful change. However, representing "clear date" in the product model adds complexity and is **deferred** to a future milestone. The initial implementation should treat clearing as a non-recordable action (the value changed from "something" to "nothing", but "nothing" is not a meaningful date selection).

> **Product Stability Note:** This deferral is analogous to C5.1's deferral of `<select multiple>`. The product model conceptually supports clearing — the rule is simply "not in scope for C6.1."

### 3.5 Pre-State Evidence

> **Product Requirement:** The recorder must compare the control's value **before** and **after** the user interaction to determine whether a meaningful change occurred. The "before" state is the evidence that the change was genuine and non-incidental.

> **Product Stability Note:** How the pre-state is captured — at `mousedown`, `focus`, `pointerdown`, or another user-gesture precursor — is an implementation detail. The product requirement is that the comparison is between the user's pre-interaction value and post-interaction committed value.

### 3.6 Debounce and Timing

Date Picker interactions are **discrete commit events** — the user either committed a value or didn't. No debounce window is required. The commit event (native `change`, gridcell `mousedown`, or input `change`/`blur`) fires exactly once per committed selection.

For calendar components where the user may click multiple dates in a range (start date, then end date), the recorder should record the **final committed range** — both dates selected — not intermediate partial selections. If the range picker fires a commit event only after both dates are chosen, record at that point. If it fires per-date, the recorder should detect range context and coalesce.

> **Product Stability Note:** How the recorder distinguishes "intermediate range selection" from "committed range" is an implementation detail. The product requirement is that a date range produces a single recorded interaction with both start and end values, not two separate events.

---

## 4. Universal Date Selection Categories

### 4.1 Category Survey

| Category | Examples | DOM Structure | Value Access |
|----------|----------|---------------|--------------|
| **Native HTML date inputs** | `<input type="date">`, `datetime-local`, `time`, `month`, `week` | Native browser-rendered control | `input.value` (ISO format), `change` event |
| **Calendar popover** | MUI DatePicker, Ant Design DatePicker, React DatePicker, Flatpickr | Trigger button/icon + floating panel with grid/table | `aria-selected` on gridcell, cell text, hidden input value |
| **Inline calendar** | DayPicker, PrimeReact Calendar (inline mode) | Grid/table rendered directly in page | `aria-selected` on gridcell, cell text, callback state |
| **Dialog-based calendar** | Material DateTimePicker (mobile mode), custom modal pickers | `role="dialog"` containing calendar grid | `aria-selected` on gridcell, dialog close event |
| **Editable text input** | Custom date input with validation | `<input type="text">` with date parsing | `input.value` (text), `change`/`blur` event |
| **Date range picker** | MUI DateRangePicker, Ant Design RangePicker, daterangepicker | Two triggers or one trigger + dual calendar | Start/end values in hidden inputs, aria-selected on cells |
| **Time picker** | MUI TimePicker, Ant Design TimePicker, custom time select | Input + clock/wheel/scroller UI | `input.value`, selection events |
| **Preset ranges** | "Today", "Last 7 Days", "This Month" buttons | Button or link elements | Preset label or resolved date range |
| **Mobile-style picker** | Native mobile date picker, wheel scroller | Touch-based scroll wheels | `change` event, selected value |

### 4.2 Product Decision: One Interaction Type

**All date-selection categories share a single interaction type: `dateSelect`.**

Rationale (consistent with C5.1 §4.2):
- From the user's perspective, selecting "15 July 2026" from a native date input is semantically identical to selecting it from a Material UI calendar. The user's intent is the same.
- Canonical Test Steps should be identical: `Select Date "15 July 2026"` — regardless of the underlying implementation.
- The generation pipeline should produce a consistent execution verb and rely on target metadata to distinguish execution strategy.

**This does NOT mean one detection mechanism.** The recorder may use different strategies to detect value changes in native inputs vs calendar components (see §5). The product model is unified; the implementation may vary.

### 4.3 Native vs Calendar: The Execution Boundary

The critical distinction is not in the product model or Canonical Step, but in the **execution strategy**:

| Aspect | Native HTML Input | Calendar Component |
|--------|-------------------|--------------------|
| **Canonical Step** | `Select Date "15 July 2026"` | `Select Date "15 July 2026"` |
| **Execution verb** | `selectDate` | `selectDate` |
| **Playwright API** | `.fill('2026-07-15')` | Click trigger → navigate → click date cell |
| **How Playwright knows** | `target.tag === 'INPUT' && target.type === 'date'` | Calendar-specific strategy |

> **Product Stability Note:** The execution strategies (fill vs click-based) are implementation details of the execution engine, not product rules. The product model (Canonical Step, Execution JSON verb, recording rules) does not distinguish them. Future execution improvements can be implemented entirely within the execution engine without changing any frozen product rule.

### 4.4 Category Exclusions

The following are **NOT** Date Picker interactions and are handled by existing or future interaction types:

| Element | Handled By |
|---------|------------|
| `<select>` for time zone or hour/minute dropdowns | C5 Dropdown/Select (frozen) |
| `<input type="checkbox">` for "all-day" toggle | C4 Checkbox (frozen) |
| Text input for non-date purposes | Text Entry (existing) |
| Slider for date range | Future milestone (if needed) |

---

## 5. Browser Implementation Mechanisms

### 5.1 Mechanism Survey

This section identifies the **browser implementation mechanisms** — not frameworks — used across modern web applications for date selection. The strategy is based on these mechanisms.

#### Mechanism 1: Native Browser Date Inputs

| Attribute | Value |
|-----------|-------|
| **Elements** | `<input type="date">`, `type="datetime-local"`, `type="time"`, `type="month"`, `type="week"` |
| **Browser events** | `change` (committed value), `input` (live typing) |
| **Accessibility semantics** | Native — browser provides built-in ARIA, keyboard support |
| **Deterministic evidence** | `input.value` always returns ISO format (`YYYY-MM-DD`, `HH:MM`, etc.) regardless of display format |
| **Value access** | `element.value` — ISO string, directly usable |
| **Frameworks using this** | Any app using native HTML5 date inputs |

**Key insight:** Native date inputs are the simplest mechanism. The `change` event fires on committed selection, and `.value` is always ISO format. This is the equivalent of native `<select>` for dropdowns.

#### Mechanism 2: Calendar Grid (Popover)

| Attribute | Value |
|-----------|-------|
| **Elements** | Trigger element (button/icon) + floating panel containing `<table>` or `<div>` grid |
| **Browser events** | `mousedown`/`click` on date cells; `change` on associated hidden `<input>` |
| **Accessibility semantics** | `role="dialog"` or `role="application"` for panel; `role="grid"` for calendar; `role="gridcell"` or `role="button"` for date cells; `aria-selected="true"` on selected date; `aria-disabled="true"` on disabled dates |
| **Deterministic evidence** | `aria-selected` attribute on the selected cell; text content of the selected cell; value of associated hidden input |
| **Value access** | Cell text content (e.g., "15"), aria-label (e.g., "15 July 2026"), hidden input value |
| **Frameworks using this** | MUI DatePicker, Ant Design DatePicker, React DatePicker, Flatpickr, PrimeReact Calendar, Chakra UI |

**Key insight:** Calendar grids render dates as clickable cells. The `mousedown` event on a cell is the selection signal. The cell's `aria-label` or `data-*` attribute carries the full date. This is the equivalent of custom dropdown `[role="option"]` for date pickers.

#### Mechanism 3: Calendar Grid (Inline)

| Attribute | Value |
|-----------|-------|
| **Elements** | `<table>` or `<div>` grid rendered directly in page (no popover) |
| **Browser events** | `mousedown`/`click` on date cells |
| **Accessibility semantics** | Same as Mechanism 2, minus the dialog/application wrapper |
| **Deterministic evidence** | Same as Mechanism 2 |
| **Value access** | Same as Mechanism 2 |
| **Frameworks using this** | DayPicker (inline mode), PrimeReact Calendar (inline), custom inline calendars |

**Key insight:** Inline calendars are mechanically identical to popover calendars minus the trigger element. The same gridcell detection applies.

#### Mechanism 4: Editable Text Input with Date Validation

| Attribute | Value |
|-----------|-------|
| **Elements** | `<input type="text">` with JavaScript date parsing/validation |
| **Browser events** | `change`, `blur` (committed value) |
| **Accessibility semantics** | Standard text input; may have `role="application"` wrapper |
| **Deterministic evidence** | `input.value` after validation passes |
| **Value access** | `element.value` — text string, may be any format ("15/07/2026", "Jul 15, 2026") |
| **Frameworks using this** | Custom implementations, some older libraries |

**Key insight:** Text inputs that accept dates fire `change` on commit. The value may not be ISO format — it requires parsing. The challenge is distinguishing a date text input from a regular text input.

#### Mechanism 5: Dialog-Based Date Picker

| Attribute | Value |
|-----------|-------|
| **Elements** | `role="dialog"` or native `<dialog>` containing a calendar grid |
| **Browser events** | `mousedown`/`click` on date cells inside dialog |
| **Accessibility semantics** | `role="dialog"` + `role="grid"` + `role="gridcell"` |
| **Deterministic evidence** | Same as Mechanism 2, plus dialog close event |
| **Value access** | Same as Mechanism 2 |
| **Frameworks using this** | Material DateTimePicker (mobile), Vuetify date dialog, custom modal pickers |

**Key insight:** Dialog-based pickers are mechanically identical to popover calendars (Mechanism 2) — the gridcell detection is the same. The dialog wrapper is an implementation detail.

#### Mechanism 6: Mobile-Style Wheel Picker

| Attribute | Value |
|-----------|-------|
| **Elements** | Scrollable columns with selectable values (day, month, year) |
| **Browser events** | `change` on native mobile; `mousedown`/touch on custom wheels |
| **Accessibility semantics** | `role="listbox"` with `role="option"` per wheel item (some frameworks) |
| **Deterministic evidence** | `aria-selected` on option; `change` event; selected value |
| **Value access** | `element.value` (native mobile), option text/aria-label (custom) |
| **Frameworks using this** | Native mobile browsers, Ant Design Mobile, Vant |

**Key insight:** Mobile wheel pickers may use `role="option"` for their items — overlapping with C5 dropdown detection. The disambiguation is context: if the options are date values (months, days, hours) inside a date-control container, they belong to the date picker, not the dropdown recorder.

#### Mechanism 7: Preset Range Selection

| Attribute | Value |
|-----------|-------|
| **Elements** | Button or link elements with predefined date ranges |
| **Browser events** | `mousedown`/`click` |
| **Accessibility semantics** | Standard button/link; may have `aria-pressed` if toggle |
| **Deterministic evidence** | The preset's label text; the resolved date range in associated inputs |
| **Value access** | Button text ("Last 7 Days"); resolved range values from hidden inputs |
| **Frameworks using this** | daterangepicker, Ant Design RangePicker presets, MUI DateRangePicker shortcuts |

**Key insight:** Preset ranges are a convenience mechanism. Clicking "Last 7 Days" sets a date range. The recorder should capture the resulting range, not the button click. This may overlap with CSS-class-differential detection from C5.2C or aria-pressed segmented controls — the date recorder must take precedence when the control is a date picker.

### 5.2 Mechanism-to-Detection Mapping

| Mechanism | Primary Detection Signal | Fallback Detection |
|-----------|--------------------------|--------------------|
| Native input | `change` event + `input.type` matches date types | — |
| Calendar grid | `mousedown` on `[role="gridcell"]` or `[aria-selected]` inside `[role="grid"]` | Cell click in table with date-like structure |
| Text input | `change` event + value matches date pattern | — |
| Dialog | Same as calendar grid, inside `[role="dialog"]` | — |
| Mobile wheel | `change` event or `aria-selected` on `[role="option"]` inside date context | — |
| Preset range | Resulting value change on associated date input(s) | Click on element with preset-like text |

> **Product Stability Note:** The specific detection signals are implementation details. The product requirement is that the recorder detects committed date value changes across all seven mechanisms. The mechanism-to-detection mapping may evolve as new patterns are discovered.

### 5.3 Common Cross-Framework Evidence

The following browser evidence is common across multiple frameworks and mechanisms:

1. **`aria-selected="true"` on a date cell** — present in MUI, Ant Design, PrimeReact, DayPicker, Flatpickr. This is the strongest signal for calendar-based selection.

2. **`change` event on a hidden or visible input** — present for all mechanisms that sync to an input value. The `change` event fires once per committed selection.

3. **`role="grid"` with `role="gridcell"` children** — present in most ARIA-compliant calendar implementations. Combined with `aria-selected`, this is deterministic.

4. **`data-*` attributes carrying date values** — varies by framework (Flatpickr uses `.flatpickr-day`, MUI uses `.Mui-selected`, DayPicker uses `data-selected`). Not portable, but useful as a secondary signal.

5. **Text content of the selected cell** — always available, but may be just the day number ("15") without month/year context. The full date requires combining cell text with the calendar's current month/year header.

---

## 6. Canonical Test Steps

### 6.1 Format

All Date Picker interactions produce Canonical Test Steps:

| Sub-Type | Format |
|----------|--------|
| Date | `Select Date "<displayValue>"` |
| Date Range | `Select Date Range "<startDisplay>" to "<endDisplay>"` |
| Time | `Select Time "<displayValue>"` |
| Date & Time | `Select Date & Time "<displayValue>"` |
| Month | `Select Date "<displayValue>"` |
| Week | `Select Date "<displayValue>"` |

### 6.2 Examples

| Control | User Action | Canonical Step |
|---------|-------------|----------------|
| Native `<input type="date">` | Selects 15 July 2026 | `Select Date "15 July 2026"` |
| MUI DatePicker | Clicks "15" in July 2026 calendar | `Select Date "15 July 2026"` |
| Ant Design RangePicker | Selects 1 July to 10 July 2026 | `Select Date Range "1 July 2026" to "10 July 2026"` |
| Native `<input type="time">` | Sets 9:30 AM | `Select Time "09:30 AM"` |
| Native `<input type="datetime-local">` | Sets 15 July 2026, 9:30 | `Select Date & Time "15 July 2026 09:30"` |
| Native `<input type="month">` | Selects July 2026 | `Select Date "July 2026"` |
| Flatpickr with time | Selects date + time | `Select Date & Time "15 July 2026 09:30"` |
| Preset "Last 7 Days" | Clicks preset button | `Select Date Range "9 July 2026 to 15 July 2026"` |
| Text input with date | Types "15/07/2026" | `Select Date "15 July 2026"` |

### 6.3 When a Step Is Generated

A Canonical Step is generated for every recorded Date Picker interaction — i.e., every time Gates 1–5 all pass. No interaction that passes recording is omitted from Canonical Steps.

### 6.4 When a Step Is Omitted

No Canonical Step is generated for any interaction that was not recorded (failed any gate). This includes opening/closing the calendar, month/year navigation, hovering dates, re-selecting the current value, and interacting with disabled dates.

### 6.5 Readability Optimizer

**No new readability rule for Date Picker interactions.** The following potential optimization is explicitly **deferred**:

| Rule | Description | Status |
|------|-------------|--------|
| OR-6 | Collapse consecutive Date selections on the same control (only last value matters) | **DEFERRED** |

Rationale: Consecutive date changes on the same control (e.g., the user explores dates before settling) may represent meaningful exploration behavior. Collapsing them could hide intent. Consistent with C5.1's OR-5 deferral.

### 6.6 AI Business Name

If AI enrichment is available, it applies to the **control's label/context** (e.g., "Departure Date", "Check-out Date"), not to the date value itself. The date value is deterministic and should not be subject to AI interpretation.

```
Select Date "15 July 2026"   (on "Departure Date" control)
```

The AI business name appears in the step's enrichment metadata, not in the date value.

---

## 7. Execution Model

### 7.1 Interaction Type Registration

A new interaction type `dateSelect` is registered in the InteractionRegistry:

| Field | Value |
|-------|-------|
| `actionType` | `'dateSelect'` |
| `idPrefix` | `'dateSelect'` |
| `badgeColor` | `'#f59e0b'` (amber) |
| `badgeLabel` | `'Date'` |
| `toPlainEnglish` | `Select Date "<displayValue>"` / `Select Date Range "..."` / `Select Time "..."` / `Select Date & Time "..."` |
| `renderTitle` | Returns the display value |
| `executionExtras` | Returns `{ dateValue: <DateSelectionValue>, isoValue: <string> }` |

### 7.2 Execution Action Verbs

The `mapActionType` function is extended:

| Interaction actionType | Execution verb | Condition |
|------------------------|---------------|-----------|
| `click` | `"click"` | existing |
| `navigation` | `"navigate"` | existing |
| `text` | `"fill"` | existing |
| `hover` | `"hover"` | existing (C3.2) |
| `checkbox` | `"check"` / `"uncheck"` | existing (C4.1) |
| `radio` | `"select"` | existing (C4.1) |
| `select` | `"select"` | existing (C5.1) |
| `dateSelect` | `"selectDate"` | **new (C6.1)** |

**Note:** `dateSelect` produces a distinct execution verb `"selectDate"` — not `"select"`. This avoids collision with Dropdown `select` and Radio `select`, and signals to the Playwright generator that a date-specific execution strategy is needed.

### 7.3 Execution JSON Structure

The Execution JSON uses the **existing 6-section contract** — no structural change:

```json
{
  "action": {
    "type": "selectDate",
    "value": "15 July 2026",
    "isoValue": "2026-07-15",
    "dateType": "date"
  },
  "target": {
    "kind": "element",
    "tag": "INPUT",
    "role": "textbox",
    "name": "Departure Date"
  },
  "locators": [ ... ],
  "context": { "iframe": false, "shadowDom": false, "frame": null },
  "trace": { "interactionId": "dateSelect-0001", "stepId": "step-0001" },
  "meta": { "status": "generated", "warnings": [], "generatedAt": "..." }
}
```

For date ranges:

```json
{
  "action": {
    "type": "selectDate",
    "value": "1 July 2026 to 10 July 2026",
    "isoValue": "2026-07-01/2026-07-10",
    "dateType": "dateRange",
    "startValue": "2026-07-01",
    "endValue": "2026-07-10"
  },
  ...
}
```

Key fields:
- `action.type` is `"selectDate"` — distinct from dropdown `"select"`
- `action.value` carries the **human-readable display value**
- `action.isoValue` carries the **ISO value** for execution (machine-readable)
- `action.dateType` identifies the sub-type: `"date"`, `"dateRange"`, `"time"`, `"dateTime"`, `"month"`, `"week"`
- For ranges: `startValue` and `endValue` carry individual ISO values

### 7.4 Value Representation

| Field | Native Input | Calendar Component | Text Input |
|-------|-------------|-------------------|------------|
| `action.value` | Display value (derived from ISO) | Display value (from cell text or aria-label) | Display value (parsed from text) |
| `action.isoValue` | `input.value` (already ISO) | Converted from cell date | Parsed and converted to ISO |
| Playwright uses | `isoValue` for `.fill()` | Display value or cell text for click-based | `isoValue` for `.fill()` |

> **Product Rule:** The recorded value is the **human-readable display value**. The ISO value is carried alongside for execution. The Canonical Step always shows the display value.

### 7.5 Playwright Execution

A new `case 'selectDate'` branch is added to the Playwright generator:

```typescript
case 'selectDate': {
  const selector = translateLocator(primaryLocator);

  // Native HTML date input: use .fill() with ISO value
  if (target.tag === 'INPUT' && ['date', 'datetime-local', 'time', 'month', 'week'].includes(target.inputType)) {
    return { statements: [`${framePrefix}${selector}.fill('${isoValue}');`] };
  }

  // Calendar component: click trigger → navigate to month → click date cell
  // Strategy: use getByLabel/getByRole to find the date cell
  const [year, month, day] = isoValue.split('-');
  return {
    statements: [
      `${framePrefix}${selector}.click();`,                                          // open calendar
      `page.getByRole('gridcell', { name: /${day}.*${monthName}/ }).click();`,       // click date
    ]
  };
}
```

> **Product Stability Note:** The exact Playwright strategy for calendar components (getByRole vs getByText, how to navigate to the correct month, how to handle date ranges) is an execution-engine implementation detail. The product requirement is that the generated Playwright code successfully selects the intended date. The strategy may vary by component library and may be refined in future milestones without changing any frozen product rule.

### 7.6 CanonicalStep Field Extension

A new optional field `dateValue` is added to `CanonicalStep` (mirroring `value` for text and `checked` for checkbox):

```typescript
/**
 * Date selection value for date picker interactions. Null for non-date actions.
 * Carries the display value, ISO value, and sub-type from the recording
 * layer through to the Execution JSON Generator.
 */
dateValue: {
  dateType: 'date' | 'dateRange' | 'time' | 'dateTime' | 'month' | 'week';
  displayValue: string;
  isoValue: string;
  startDisplayValue?: string;  // for ranges
  endDisplayValue?: string;    // for ranges
  startIsoValue?: string;      // for ranges
  endIsoValue?: string;        // for ranges
} | null;
```

This field is null for all non-dateSelect interaction types, backward-compatible.

### 7.7 Pipeline Integration Confirmation

| Pipeline Stage | Change Required | Description |
|----------------|-----------------|-------------|
| Content Script | **NEW** (`datepicker-content-script.ts`) | Detects meaningful date value changes across all mechanisms |
| Service Worker | **NEW message handlers** | `DATE_SELECT_CAPTURED` handler |
| Shared Types | **NEW** (`DateSelectEvent`) | Extended `SessionEvent` union |
| Interaction Registry | **NEW** (`dateSelect` type) | Registration with amber badge |
| Canonical Step Generator | **EXTEND** | Populate `dateValue` field |
| Readability Optimizer | **NO CHANGE** | OR-6 deferred |
| Execution JSON Generator | **EXTEND** | `mapActionType('dateSelect') → "selectDate"`; action.isoValue, action.dateType |
| Playwright Generator | **EXTEND** | New `case 'selectDate'` branch |
| Generation Engine | **NO CHANGE** | Existing pipeline chain |
| Validation Framework | **NO CHANGE** | B8 contract is implementation-agnostic |

---

## 8. Interaction Boundaries

### 8.1 Coexistence with Other Interaction Types

| Interaction | Relationship with DateSelect |
|-------------|------------------------------|
| **Click** | DateSelect takes precedence when the target is a date-selection control and a value change occurs. The click-content-script must exclude date picker controls from generic click recording (same pattern as C4.2 checkbox/radio exclusion and C5.2 dropdown exclusion). Opening the calendar (click without value change) remains a generic Click. |
| **Text Entry** | If the user types a date into a text input, the date recorder captures the committed date value as a DateSelect interaction. The text-entry recorder may also fire (it captures all typed text). The DateSelect interaction captures the committed date value, not the intermediate typing. This is analogous to C5.1's treatment of searchable dropdowns. |
| **Hover** | Hovering over calendar cells is handled by C3 (Hover) if it produces observable behavior. DateSelect does not claim ownership over hover events. |
| **Checkbox** | No overlap. Checkbox uses `input[type="checkbox"]`; DateSelect uses date inputs and calendar grids. |
| **Radio** | No overlap. Radio uses `input[type="radio"]`; DateSelect uses date inputs and calendar grids. |
| **Select (Dropdown)** | ⚠️ **Potential overlap** — time zone dropdowns, hour/minute dropdowns, and mobile wheel pickers may use `[role="option"]`. Disambiguation: if the `[role="option"]` is inside a date-control context (calendar grid, `[role="grid"]`, date input container), DateSelect claims it. Otherwise, Dropdown Select handles it. |
| **Navigation** | Independent. A DateSelect interaction may trigger navigation (e.g., date filter submits), but both interactions are recorded separately. |

### 8.2 Ownership Model

When a Date Picker value change is recorded, the datepicker-content-script claims ownership via `data-cmdrunner-handled='dateSelect'` on the control element (native input or calendar trigger). This prevents:
- The click-content-script from recording duplicate Click events for calendar cell clicks
- The text-entry-content-script from recording the typed date as text entry (when the date recorder claims the input)

However, **the initial click to open the calendar is NOT claimed** — it's a legitimate click that doesn't change the value. Only the value-change event triggers ownership.

> **Product Stability Note:** The exact ownership claiming mechanism — whether ownership is claimed on the input, the calendar trigger, or the gridcell — is an implementation detail. The product requirement is that no duplicate events are recorded for a single date selection.

### 8.3 DateSelect Followed by Application Behavior

| Scenario | Recording |
|----------|-----------|
| DateSelect → Auto-submit form | DateSelect recorded; form submission is a separate interaction or observable behavior |
| DateSelect → Dynamic form update | DateSelect recorded; form update is observable but not an interaction |
| DateSelect → Enable/disable controls | DateSelect recorded; enabling is application response |
| DateSelect → Navigation (date-based redirect) | Two independent interactions: DateSelect + Navigation |

### 8.4 Specialization Rule

> **Product Rule:** Date-selection controls are owned by the DateSelect recorder when a value change occurs. Generic Click applies to the initial calendar open. Dropdown Select applies to non-date dropdowns within date pickers (e.g., time zone selection). This follows the same precedence pattern established by C4 (Checkbox/Radio) and C5 (Dropdown/Select).

---

## 9. Validation Strategy

### 9.1 Validation Scenarios

| # | Scenario | Mechanism | Expected Pass Criteria |
|---|----------|-----------|----------------------|
| 1 | Native `<input type="date">` — select date | Native | `Select Date "15 July 2026"` recorded; action.type `"selectDate"`; Playwright `.fill('2026-07-15')` |
| 2 | Native `<input type="date">` — re-select same date | Native | NOT recorded (no value change) |
| 3 | Native `<input type="date">` — open and close without selecting | Native | NOT recorded |
| 4 | Native `<input type="date">` — disabled | Native | NOT recorded (Gate 5) |
| 5 | Native `<input type="time">` — select time | Native | `Select Time "09:30 AM"` recorded; Playwright `.fill('09:30')` |
| 6 | Native `<input type="datetime-local">` — select date+time | Native | `Select Date & Time "15 July 2026 09:30"` recorded |
| 7 | Native `<input type="month">` — select month | Native | `Select Date "July 2026"` recorded |
| 8 | Native `<input type="week">` — select week | Native | `Select Date "Week 29, 2026"` recorded |
| 9 | Calendar popover — click date cell | Calendar | `Select Date "15 July 2026"` recorded; Playwright click-based |
| 10 | Calendar popover — navigate months, select date | Calendar | Only the final date recorded; month navigation NOT recorded |
| 11 | Calendar popover — disabled date | Calendar | NOT recorded (Gate 5) |
| 12 | Calendar popover — min/max date enforcement | Calendar | Dates outside range NOT recorded (Gate 5) |
| 13 | Inline calendar — click date cell | Calendar | `Select Date "15 July 2026"` recorded |
| 14 | Editable text input — type date, validated | Text | `Select Date "15 July 2026"` recorded; Playwright `.fill()` |
| 15 | Editable text input — type invalid date | Text | NOT recorded (no committed value change) |
| 16 | Date range picker — select start + end | Range | `Select Date Range "1 July 2026" to "10 July 2026"` recorded |
| 17 | Date range picker — select start, cancel | Range | NOT recorded (incomplete range) |
| 18 | Time picker — select time | Time | `Select Time "09:30 AM"` recorded |
| 19 | Date & Time picker — select date + time | DateTime | `Select Date & Time "15 July 2026 09:30"` recorded |
| 20 | Preset range — click "Last 7 Days" | Preset | `Select Date Range "9 July 2026 to 15 July 2026"` recorded |
| 21 | Keyboard-only selection — Tab + arrows + Enter | Calendar | `Select Date "15 July 2026"` recorded |
| 22 | Programmatic value change | Both | NOT recorded (Gate 1) |
| 23 | DateSelect → Navigation (auto-submit) | Integration | Both DateSelect and Navigation recorded independently |
| 24 | Localization — non-English month names | Calendar | Date value still recorded; display format uses English convention |
| 25 | Dynamic calendar (async month loading) | Calendar | Date recorded after async load completes |

### 9.2 Pass Criteria

A DateSelect interaction passes validation when:
1. The Canonical Step shows the correct format (`Select Date "..."`, `Select Date Range "..."`, etc.)
2. The Execution JSON has `action.type: "selectDate"` and `action.isoValue` with the correct ISO value
3. The Playwright code sets the correct date (`.fill()` for native, click-based for calendar)
4. No duplicate Click event is recorded for the same interaction
5. Month/year navigation clicks are NOT recorded

### 9.3 Common Failure Cases

| Failure | Cause | Mitigation |
|---------|-------|------------|
| Calendar clicks recorded as generic Click | Click-content-script not excluding date cells | Add date-cell selectors to exclusion |
| Date value missing or wrong | Cell text ("15") captured without month/year context | Combine cell text with calendar header month/year |
| ISO value incorrect | Display value not properly converted to ISO | Use native input.value (already ISO) or parse cell aria-label |
| Month navigation recorded as Click | Not claimed by date recorder | Date recorder should not claim navigation clicks; click recorder should exclude them via context detection |
| Search/typing recorded as text + date | Both text-entry and date recorders fire | Date recorder claims ownership of the input; text-entry sees `data-cmdrunner-handled` |
| Range recorded as two separate events | Start and end not coalesced | Detect range context and coalesce into single event |

### 9.4 Regression Validation

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Click generation unchanged | Existing click tests pass |
| 2 | Hover generation unchanged | Existing hover tests pass |
| 3 | Text Entry generation unchanged | Existing text tests pass |
| 4 | Checkbox generation unchanged | Existing checkbox tests pass |
| 5 | Radio generation unchanged | Existing radio tests pass |
| 6 | Select (dropdown) generation unchanged | Existing select tests pass |
| 7 | Navigation generation unchanged | Existing navigation tests pass |
| 8 | Readability Optimizer unchanged | OR-1 through OR-5 behavior preserved |
| 9 | Execution JSON contract structure unchanged | 6-section contract intact |

---

## 10. Product Principles

| ID | Principle | Application to DateSelect |
|----|-----------|---------------------------|
| DP1 | **Record user intent, not UI mechanics** | The recorded interaction is "the user selected date X" — not "the user clicked calendar cell Y in month Z" |
| DP2 | **Record only meaningful value changes** | Opening/closing calendar, month/year navigation, hovering dates, and re-selecting the current value are not recorded |
| DP3 | **Record the final committed value** | For text entry with validation, intermediate typing is not the value — the committed, validated date is |
| DP4 | **Preserve deterministic execution** | The same DateSelect interaction always produces the same Execution JSON and Playwright code |
| DP5 | **Preserve semantic execution** | Playwright code reads as "set this date" — not "click these cells" |
| DP6 | **Remain framework-agnostic** | The product model does not distinguish MUI DatePicker from Ant Design DatePicker from native `<input type="date">` |
| DP7 | **Base the strategy on browser implementation mechanisms** | Detection is based on `change` events, `aria-selected`, `role="gridcell"`, `input.type` — not framework class names |
| DP8 | **Integrate cleanly with existing architecture** | Uses the same registration, pipeline, and generation patterns as Click/Text/Hover/Checkbox/Radio/Select |
| DP9 | **Avoid regressions** | No existing interaction type's behavior is modified |

---

## 11. Known Assumptions

| ID | Assumption | Risk | Mitigation |
|----|-----------|------|------------|
| A1 | The selected date value is accessible at recording time | Medium — some calendar components remove cells from DOM after selection | Capture the date value from `aria-label`, hidden input, or cell text before the calendar closes |
| A2 | Native date input `change` event fires reliably on all browsers | Low — standard browser behavior | Test across Chromium, Firefox, WebKit |
| A3 | Calendar components expose selected date via `aria-selected` or equivalent | Medium — not all calendars are ARIA-compliant | Fall back to cell text + calendar header month/year |
| A4 | The click-content-script can be extended to exclude calendar cells (same pattern as C4.2/C5.2) | Low — proven pattern | Reuse the exclusion approach |
| A5 | The ISO value can be derived from the display value or native input value | Low — native inputs return ISO; calendars typically have date objects | Parse display value as fallback |
| A6 | Date range pickers fire a commit event after both dates are selected | Medium — some range pickers fire per-date | Detect range context via control type and coalesce |
| A7 | Text inputs that accept dates can be distinguished from regular text inputs | Medium — no deterministic signal | Use context detection: associated calendar icon, `placeholder` containing date format, parent container with date-related classes/roles |
| A8 | Time pickers behave similarly to date pickers for detection purposes | Low — most time pickers use the same mechanisms | Apply same detection strategies |
| A9 | The display format (D Month YYYY) is acceptable for all users | Low — English convention, locale-neutral ordering | Layer localization in a future milestone if needed |
| A10 | Clearing a date (setting to empty) is not needed for initial release | Low — rare in tested workflows | Document as deferred |

---

## 12. Potential Risks

| ID | Risk | Severity | Mitigation |
|----|------|----------|------------|
| R1 | Calendar cell detection unreliable across component libraries | **High** — MUI, Ant Design, Flatpickr, DayPicker have different DOM structures | Phase the implementation: native inputs first (C6.2), then calendar components (C6.3+). Use ARIA grid/gridcell detection as primary, structural heuristics as fallback. |
| R2 | Playwright click-based strategy fails for specific calendar libraries | **High** — each library renders dates differently | Use ARIA `getByRole('gridcell', { name: ... })` as primary strategy — works across ARIA-compliant libraries |
| R3 | Click-content-script exclusion too broad — excludes legitimate clicks on calendar trigger | **Medium** | Only exclude when a value change is detected; the initial open-click remains a generic Click |
| R4 | Date range coalescing produces incorrect range | **Medium** | Validate both start and end are present before recording; discard incomplete ranges |
| R5 | Mobile wheel picker overlaps with dropdown `role="option"` detection | **Medium** | Context detection: if options are inside a date-control container, DateSelect claims them |
| R6 | Text input date detection produces false positives on non-date text inputs | **Medium** | Require multiple signals: calendar icon sibling, date-format placeholder, date-related parent attributes |
| R7 | Timezone differences cause recorded date to differ from displayed date | **Medium** | Always record the value displayed to the user; use ISO only for execution with timezone awareness |
| R8 | Localization — non-English month names break display value parsing | **Low** | Calendar components typically expose ISO dates via `data-*` or JavaScript objects; display text is secondary |
| R9 | Virtualized calendars (only visible dates in DOM) miss off-screen selections | **Low** | Capture date value from the input or callback state, not solely from DOM cell |

---

## 13. Consistency Review Against Frozen Milestones

### 13.1 Product Foundation (B1–B8)

| Decision | Conflict? | Detail |
|----------|-----------|--------|
| InteractionRegistry pattern | ✅ No conflict | DateSelect registers via the same `registerInteractionType()` mechanism |
| CanonicalStep source-of-truth | ✅ No conflict | DateSelect produces CanonicalSteps like all other types |
| Generator dependency chain | ✅ No conflict | Same chain: Canonical → Execution JSON → Playwright |
| Pure function generators | ✅ No conflict | All generators remain pure functions |
| Execution JSON 6-section contract | ✅ No conflict | Uses existing contract structure; new action.type enum value + new action fields |
| Readability Optimizer extensibility | ✅ No conflict | No new rules; OR-6 deferred |
| Playwright Generator extensibility | ✅ No conflict | New `case 'selectDate'` branch; no rewrite of existing cases |

### 13.2 C3 (Hover)

| Decision | Conflict? | Detail |
|----------|-----------|--------|
| Hover interaction type | ✅ No conflict | Hovering calendar cells is an independent interaction |
| DWELL_THRESHOLD | ✅ Not modified | Unaffected |
| Gate 5 visibility detection | ✅ Not modified | Unaffected |

### 13.3 C4 (Checkbox & Radio)

| Decision | Conflict? | Detail |
|----------|-----------|--------|
| Checkbox state-based model | ✅ No conflict | Independent; different DOM elements |
| Radio execution verb `"select"` | ✅ No conflict | DateSelect uses distinct verb `"selectDate"` |
| Checkbox/Radio content script | ✅ No conflict | Different selectors; no overlap |

### 13.4 C5 (Dropdown & Select)

| Decision | Conflict? | Detail |
|----------|-----------|--------|
| Select interaction type | ✅ No conflict | DateSelect is a distinct type `dateSelect` with distinct verb `selectDate` |
| Dropdown execution verb `"select"` | ✅ No conflict | DateSelect uses `"selectDate"`, not `"select"` |
| Dropdown content script | ⚠️ **Potential overlap** | Mobile wheel pickers may use `[role="option"]`. Disambiguation: date-context check. If the `[role="option"]` is inside a date-control context, DateSelect claims it. See §8.1. |
| Click exclusion pattern | ✅ No conflict | DateSelect exclusion follows the same pattern but with date-specific selectors |
| CSS-class-differential detection (C5.2C) | ⚠️ **Potential overlap** | Preset range buttons may toggle CSS classes. DateSelect takes precedence when the control is a date picker. |

### 13.5 Naming Collision Analysis

The execution verbs across all interaction types:

| Source | actionType | mapActionType output | target disambiguation | Playwright output |
|--------|-----------|---------------------|-----------------------|-------------------|
| Radio (C4.1) | `radio` | `"select"` | `target.role === 'radio'` | `.check()` |
| Dropdown native (C5.1) | `select` | `"select"` | `target.tag === 'SELECT'` | `.selectOption()` |
| Dropdown custom (C5.1) | `select` | `"select"` | else | click-based |
| **DateSelect native (C6.1)** | `dateSelect` | `"selectDate"` | `target.tag === 'INPUT' && date type` | `.fill(isoValue)` |
| **DateSelect calendar (C6.1)** | `dateSelect` | `"selectDate"` | else | click-based |

**Verdict: No collision.** DateSelect uses a distinct execution verb `"selectDate"`, eliminating any ambiguity with `"select"` (Radio/Dropdown). The Playwright generator has a dedicated `case 'selectDate'` branch.

### 13.6 Existing Pipeline Integrity

| Stage | Impact |
|-------|--------|
| Interaction Timeline | ✅ No change — DateSelect events appended to the same timeline |
| Canonical Step Generator | ✅ Additive — new `dateValue` field, null for non-date |
| Readability Optimizer | ✅ No change — no new rules |
| Execution JSON Generator | ✅ Additive — new `mapActionType` entry + new action fields |
| Playwright Generator | ✅ Additive — new `case 'selectDate'` branch |
| Generation Engine | ✅ No change — existing pipeline chain |

---

## 14. Next Milestone Directive

### C6.2 — Date Picker Recording Foundation (Implementation)

**Scope:** Implement the recording layer for Date Picker interactions.

**Must do:**
- Create `datepicker-content-script.ts` implementing the 5-gate decision tree
- Register `dateSelect` interaction type in `interaction-types.ts`
- Add `DATE_SELECT_CAPTURED` message handler in `service-worker.ts`
- Add `DateSelectEvent` type to `shared/types.ts`
- Update `manifest.json` with content script entry
- Exclude date-picker controls from generic Click recording (extend click-content-script exclusion)
- Populate `dateValue` on CanonicalStep

**Must NOT do:**
- Modify Canonical Test Step generation (beyond populating `dateValue`)
- Modify Readability Optimizer
- Modify Execution JSON Generator (beyond adding `mapActionType('dateSelect')` mapping)
- Modify Playwright Generator (beyond adding `case 'selectDate'`)
- Modify any frozen milestone

### C6.3 — Date Picker Artifact Generation (Implementation)

**Scope:** Integrate DateSelect into Execution JSON and Playwright generation.

**Must do:**
- Extend `mapActionType` for `dateSelect` → `"selectDate"`
- Extend Playwright with `case 'selectDate'` for native input and calendar strategies
- Write comprehensive pipeline tests

---

## 15. Freeze Declaration

C6.1 is PERMANENTLY FROZEN. The following product decisions are frozen and must not be modified by implementation milestones:

### Frozen Product Rules

1. **One interaction type:** All date-selection categories (native inputs, calendar components, text inputs, range pickers, time pickers, presets) share a single `dateSelect` interaction type.

2. **Value-outcome model:** A DateSelect interaction is recorded only when the user commits a date/time/range value that differs from the control's previous value. Opening, closing, navigating months/years, hovering dates, and re-selecting the current value are not recorded.

3. **Display value representation:** The recorded value is the human-readable display value (e.g., "15 July 2026"), with an ISO value carried alongside for execution.

4. **Sub-type Canonical Steps:** Date produces `Select Date "..."`, Range produces `Select Date Range "..." to "..."`, Time produces `Select Time "..."`, Date & Time produces `Select Date & Time "..."`.

5. **Distinct execution verb:** DateSelect produces execution verb `"selectDate"` — distinct from Dropdown/Radio `"select"`. No collision.

6. **Execution engine owns the native/calendar distinction:** Native inputs use `.fill(isoValue)`; calendar components use click-based strategy. This distinction exists **only within the Playwright generator**. The product model, Canonical Step, and Execution JSON are identical for both categories.

7. **No new readability rules:** OR-6 (collapse consecutive Date selections on same control) is deferred.

8. **Evidence Mechanism Independence:** The product rules are stated in terms of outcomes (value changed, control enabled, genuine user action), not detection mechanisms.

9. **Execution Layer Independence:** The Playwright generator owns all framework-specific execution logic. New execution strategies for additional date picker frameworks can be added without modifying any product rule, Canonical Step convention, Execution JSON contract, or recording rule defined here.

10. **Date clearing deferred:** Setting a date to empty (clearing) is not in scope for C6.1. The product model conceptually supports it; the rule is simply "not in scope."

### Modification Policy

These product rules may only be modified if:
- Real-world validation reveals a fundamental flaw in the product model
- A future milestone requires a change that is incompatible with these rules

Implementation milestones (C6.2, C6.3) must conform to these rules. They may choose detection mechanisms, locator strategies, and execution details freely, but must not alter the product model, Canonical Step format, recording rules, or interaction boundaries defined here.

---

## 16. Permanent Regression Coverage

| # | Scenario | Category | Expected Behavior |
|---|----------|----------|-------------------|
| 1 | Select date from native `<input type="date">` | Native | `Select Date "..."` recorded; action.type `"selectDate"`; Playwright `.fill()` |
| 2 | Re-select same date (no change) | Native | NOT recorded |
| 3 | Open calendar and close without selecting | Native | NOT recorded |
| 4 | Disabled date input | Both | NOT recorded |
| 5 | Read-only date input | Both | NOT recorded |
| 6 | Programmatic value change | Both | NOT recorded |
| 7 | Select date from calendar component | Calendar | `Select Date "..."` recorded with display value |
| 8 | Navigate months without selecting | Calendar | NOT recorded (month nav only) |
| 9 | Select date range (start + end) | Range | `Select Date Range "..." to "..."` recorded |
| 10 | Select time from native `<input type="time">` | Native | `Select Time "..."` recorded |
| 11 | Select date & time from `<input type="datetime-local">` | Native | `Select Date & Time "..."` recorded |
| 12 | Type date into text input (validated) | Text | `Select Date "..."` recorded |
| 13 | Select preset range ("Last 7 Days") | Preset | `Select Date Range "..."` recorded |
| 14 | DateSelect followed by Navigation | Integration | Both DateSelect and Navigation recorded |
| 15 | Existing Click/Hover/Text/Checkbox/Radio/Select unaffected | Regression | All existing tests pass |

---

## 17. Product Clarification — Date Selection Context Preservation

**Added:** 2026-07-16T14:05:00Z  
**Type:** Documentation refinement — no product rule modified, no architecture decision changed

### 17.1 Question

Modern web applications frequently contain multiple date inputs and multiple calendar widgets on the same page (e.g., a travel booking form with departure date, return date, and a date-range filter). How does the product strategy preserve sufficient context to deterministically reproduce the user's intended date selection?

### 17.2 Confirmation: Product Model Is Mechanism-Independent

The product model remains **fully independent of the mechanism used to open the calendar**. Whether the user clicks a calendar icon, focuses a native date input, tabs to a field and presses Enter, or types a date into a text input — the recorded interaction is always:

> `Select Date "15 July 2026"`

The mechanism used to arrive at the value is never part of the product model, the Canonical Step, or the recording. This is a direct application of frozen principles:
- **DP1** (record user intent, not UI mechanics)
- **Evidence Mechanism Independence** (§1.5): the product rule is stated in terms of the outcome (committed value change), not the detection mechanism

### 17.3 How the Execution Model Distinguishes Multiple Date Controls

The ability to deterministically replay a date selection on a specific control — out of many date controls on the same page — is **not a new problem introduced by C6.1**. It is the same problem that every interaction type already solves, using the frozen B4.3/B4.4 locator resolution and priority architecture:

**At recording time**, the content script captures the full `ElementIdentity` for the date-selection control:

| Identity Field | Example (Departure Date) | Example (Return Date) | Purpose |
|----------------|--------------------------|-----------------------|---------|
| `accessibleName` | "Departure Date" | "Return Date" | Human-readable label — distinguishes the control |
| `ariaLabel` | "Departure Date" | "Return Date" | ARIA label — accessible name source |
| `ariaRole` | "textbox" / "combobox" | "textbox" / "combobox" | Semantic role |
| `name` | "departure_date" | "return_date" | Form field name — developer-assigned, stable |
| `stableId` | "departure-datepicker" | "return-datepicker" | Developer-assigned ID |
| `testId` | "data-test='dep-date'" | "data-test='ret-date'" | Business identifier — highest trust |
| `cssSelector` | `input[name="departure_date"]` | `input[name="return_date"]` | Structural locator |
| `xPath` | `//input[@name="departure_date"]` | `//input[@name="return_date"]` | Structural locator |
| `placeholder` | "DD/MM/YYYY" | "DD/MM/YYYY" | Context hint |

**At generation time**, the Execution JSON Generator applies the frozen B4.4 Locator Priority Strategy to produce locators in trust order:

```
Execution JSON for "Departure Date":
  target: { kind: "element", tag: "INPUT", role: "textbox", name: "Departure Date" }
  locators: [
    { strategy: "testId",     value: "dep-date",      role: "primary" },
    { strategy: "ariaLabel",  value: "Departure Date", role: "secondary" },
    { strategy: "name",       value: "departure_date", role: "fallback" },
    { strategy: "css",        value: "input[name=...", role: "fallback" },
  ]
```

This is the **same mechanism** that distinguishes two Submit buttons on the same page, two text inputs in the same form, or two checkboxes in the same dialog. DateSelect adds no new disambiguation requirement — it inherits the existing identity and locator architecture verbatim.

### 17.4 How Canonical Steps Stay Concise While Execution Stays Deterministic

This is achieved through the **existing architecture's separation of concerns** — not through any new mechanism:

| Layer | Responsibility | What It Contains |
|-------|---------------|------------------|
| **Canonical Step** (human-readable) | Semantic, concise, what the user did | `Select Date "15 July 2026"` — no locators, no DOM details |
| **Element Identity** (metadata) | Which control was interacted with | Full identity: accessibleName, ariaLabel, name, testId, cssSelector, xPath, etc. |
| **Execution JSON** (machine-readable) | Deterministic replay instructions | `action.type: "selectDate"`, `action.isoValue: "2026-07-15"`, resolved locators in priority order, iframe/shadow context |

The Canonical Step answers *"what did the user do?"* — `Select Date "15 July 2026"` on the "Departure Date" control (AI business name from enrichment).

The Execution JSON answers *"how do we replay it?"* — locate the input via its testId/ariaLabel/name, then `.fill('2026-07-15')` (native) or click the calendar trigger and select the cell (calendar component).

**No explicit workflow context or new architecture mechanism is needed.** The existing ElementIdentity → Locator Resolution → Execution JSON pipeline — frozen across B4.3, B4.4, B5.2 — already preserves everything required for deterministic replay. C6.1 does not extend or modify this pipeline; it flows through it like every other interaction type.

### 17.5 Future Execution Improvements

Future execution improvements can strengthen deterministic replay **without modifying any frozen product rule**:

| Improvement | What It Does | Frozen Rules It Respects |
|-------------|-------------|--------------------------|
| Enhanced Playwright calendar strategy | Better getByRole/getByText locators for specific calendar libraries | Execution Layer Independence (§15, rule 9): the Playwright generator owns all framework-specific logic |
| Multi-strategy fallback execution | Try `.fill()` first, fall back to click-based if the control isn't a native input | Execution engine owns native/calendar distinction (§15, rule 6) |
| Relative-date execution | "15 July 2026" becomes `today + 5 days` for more resilient tests | Execution JSON carries ISO value; relative-date computation is an execution-layer enhancement that reads the same data |
| AI-assisted locator refinement | Post-recording AI suggests better locators for calendar components | AI enrichment metadata is additive; doesn't change the recording or product model |

All of these are purely execution-layer changes. The product rules (one interaction type, value-outcome model, Canonical Step format, recording rules, interaction boundaries) remain frozen and untouched.

### 17.6 Confirmed Conclusions

| Confirmation | Status | Basis |
|-------------|--------|-------|
| Product rules remain implementation-independent | ✅ Confirmed | DP1, Evidence Mechanism Independence (§1.5) |
| Canonical Test Steps remain semantic and concise | ✅ Confirmed | Steps contain only `Select Date "..."` — no locators or DOM details |
| Strategy preserves sufficient context for deterministic replay | ✅ Confirmed | ElementIdentity (B4.3) + Locator Priority (B4.4) + Execution JSON (B5.2) — all frozen, all inherited |
| Future execution improvements do not require changes to frozen product rules | ✅ Confirmed | Execution Layer Independence (§15, rule 9): execution engine owns all replay logic |
| No new architecture mechanism required | ✅ Confirmed | C6.1 flows through the existing pipeline like every other interaction type |
| Multiple date controls on same page are disambiguated | ✅ Confirmed | Same identity + locator mechanism that disambiguates all other elements |
