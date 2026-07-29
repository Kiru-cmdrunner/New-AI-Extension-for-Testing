# Stage 4d: OXD Framework Awareness in Legacy Pipeline

## Context

The user correctly identified a common root cause: composite controls (dropdowns,
checkboxes, date pickers) are not resolving to their semantic control types because
`getImplicitRole()` in the legacy recorder (`deterministic-recorder.ts`) has **no OXD
framework CSS-class → semantic-role mapping**.

The V2 control pipeline (`control-recorder.ts` + `framework-adapters.ts`) has OXD
awareness and handles all three control types correctly, but it is disabled by default
(`recorderEngine = 'legacy'`).

## Root Cause (Single)

`getImplicitRole()` only checks:
1. Explicit `role` attribute
2. INPUT type → role mapping (checkbox, radio, text → textbox, etc.)
3. TAG_ROLE_MAP (button, select, textarea, etc.)

For OXD's div-based controls (`<div class="oxd-select-text-input">`), all three checks
return `null`. The downstream classifiers inherit the wrong/null role:

| Control | OXD DOM | getImplicitRole Returns | Expected Role | Downstream Effect |
|---------|---------|------------------------|---------------|-------------------|
| Dropdown | `<div class="oxd-select-text">` | null (DIV) | combobox | V1: generic Click; V2: CustomDropdown via CSS but weak (0.65) |
| Checkbox wrapper | `<div class="oxd-checkbox-wrapper">` | null (DIV) | checkbox | V1/V2: generic Click |
| Date picker input | `<input type="text" class="oxd-input" placeholder="yyyy-mm-dd">` | textbox | combobox/date | V2: TextEntry (0.85) instead of DatePicker |

## Fix Strategy

### Fix A: Add OXD CSS-class → role mapping to `getImplicitRole()`
**File:** `src/recorder/deterministic-recorder.ts`

After the TAG_ROLE_MAP fallback, check the element's className for OXD framework patterns:
- `oxd-select-text`, `oxd-select-text-input`, `oxd-select-wrapper` → `combobox`
- `oxd-checkbox-wrapper` → `checkbox`
- `oxd-date-input`, `oxd-date-picker` → `combobox` (triggers calendar)
- `oxd-radio-wrapper` → `radio`

### Fix B: Recognize OXD date input class in `isCalendarTrigger()`
**File:** `src/classifier/evidence/engine.ts`

Update `isCalendarTrigger()` to also match `oxd-date-input` class pattern. This allows
the V2 engine to group the date input trigger click with the calendar cell click,
producing a single DatePicker interaction.

### Fix C: Suppress TextEntry evidence for date-trigger clicks in V2
**File:** `src/classifier/evidence/providers/dom-provider.ts`

When a click event target has `isDateTriggerElement` characteristics (detected via
placeholder pattern `yyyy-mm-dd` or class containing `oxd-date-input`), suppress the
TextEntry evidence. The dateSelect event will provide DatePicker evidence instead.

## Acceptance Criteria

- [ ] OXD dropdown trigger click has `ariaRole = 'combobox'` in captured identity
- [ ] OXD checkbox wrapper click has `ariaRole = 'checkbox'` in captured identity
- [ ] OXD date input click has `ariaRole = 'combobox'` (not 'textbox')
- [ ] V2 engine recognizes OXD date input as calendar trigger (groups trigger+cell)
- [ ] V2 dom-provider suppresses TextEntry for date trigger clicks
- [ ] Dropdown trigger click is classified as CustomDropdown (not Click)
- [ ] Checkbox click is classified as Checkbox with label
- [ ] Date picker produces DatePicker interaction (not TextEntry + Click)
- [ ] All existing tests pass
