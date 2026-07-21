# Date & Time Completion

## Goal
Complete detection for TimePicker and DateTimePicker so the Date & Time category reaches feature completeness. DatePicker is already production-ready; these two types share the same infrastructure but need metadata fields, timeline phrasing, and validation.

## Current State

| Type | Detection | Metadata | Timeline Phrasing | Status |
|------|-----------|----------|-------------------|--------|
| **DatePicker** | ✅ DomProvider DATE_INPUT_TYPES, ARIA, CSS, calendar cells | dateValue | ✅ `Select date "X"` | Complete |
| **TimePicker** | ✅ DomProvider maps `time`→TimePicker, CSS patterns (ClockPicker) | dateValue (wrong field!) | ❌ Falls through to DatePicker case | Partial |
| **DateTimePicker** | ✅ DomProvider maps `datetime-local`→DateTimePicker, CSS patterns | dateValue (wrong field!) | ❌ Falls through to DatePicker case | Partial |

## Gaps

1. **No `timeValue` metadata field** — time inputs extract into `dateValue` which is semantically wrong
2. **No `dateTimeValue` metadata field** — datetime inputs same issue
3. **No timeline phrasing for TimePicker/DateTimePicker** — they fall through to the shared DatePicker case
4. **AriaProvider extractMetadataForType** — uses `dateValue` for all three types
5. **Missing AntD time picker CSS patterns** — ant-time-picker not in AntD map
6. **No tests for TimePicker/DateTimePicker** detection, metadata, or phrasing

## Implementation

### Phase 1: Metadata Fields
- Add `timeValue?: string` to InteractionMetadata
- Add `dateTimeValue?: string` to InteractionMetadata

### Phase 2: Metadata Extraction
- **DomProvider onEvent**: DATE_INPUT_TYPES entries already detect type. Update metadata extraction to use:
  - `date` → `dateValue`
  - `time` → `timeValue`
  - `datetime-local` → `dateTimeValue`
- **AriaProvider extractMetadataForType**: Split the shared case:
  - DatePicker → `dateValue`
  - TimePicker → `timeValue`
  - DateTimePicker → `dateTimeValue`
- **V1 interaction-detector**: Update metadata extraction to use correct field names

### Phase 3: Timeline Phrasing
- TimePicker: `Set time to "14:30"` (with value), `Set time` (no value)
- DateTimePicker: `Select date and time "2024-01-15T10:30"` (with value), `Select date and time` (no value)

### Phase 4: CSS Patterns
- AntD: `ant-time-picker` → TimePicker
- Bootstrap: No native time picker; skip
- Generic: `time-picker`, `timepicker` → TimePicker
- Generic: `datetime-picker`, `datetimepicker` → DateTimePicker

### Phase 5: Tests
- Unit: native `<input type="time">`, `<input type="datetime-local">` detection
- Framework: MUI ClockPicker, AntD TimePicker
- Metadata: correct field names (timeValue vs dateTimeValue vs dateValue)
- Timeline phrasing
- Regression: DatePicker unaffected

## Acceptance Criteria

### TimePicker
- [ ] `<input type="time">` → TimePicker with timeValue metadata
- [ ] MUI ClockPicker CSS → TimePicker
- [ ] AntD TimePicker CSS → TimePicker
- [ ] Timeline shows "Set time to X"
- [ ] timeValue extracted from valueAfter

### DateTimePicker
- [ ] `<input type="datetime-local">` → DateTimePicker with dateTimeValue metadata
- [ ] MUI DateTimePickerToolbar CSS → DateTimePicker
- [ ] Timeline shows "Select date and time X"
- [ ] dateTimeValue extracted from valueAfter

### Regression
- [ ] `<input type="date">` → DatePicker (unchanged)
- [ ] dateValue metadata still used for DatePicker
- [ ] DatePicker timeline phrasing unchanged
- [ ] All 2461 existing tests pass
