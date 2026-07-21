# Batch 2 — Selection Controls (Date Picker, Slider, Multi-select)

## Goal
Add three new interaction types to the recording pipeline using the extensible
interaction-type registry built in Batch 1.

## Pipeline
Each new type plugs into the existing pipeline:
Browser Action → Recorder → Element Identity → AI Understanding → Plain English Step → Execution JSON → Repository

Adding a type requires: register in interaction-types.ts + add event types in types.ts + create content script + add to manifest.json.

## New Interaction Types

### Date Picker
- Event: `DatePickerEvent` with `dateValue: string` (ISO format or display string)
- Capture: `change` on `<input type="date">` and `<input type="datetime-local">`, `<input type="time">`, `<input type="month">`, `<input type="week">`
- Plain English: `Set "Date of Birth" to "2024-01-15"`
- Action ID prefix: `datepicker`
- Execution JSON: `dateValue`

### Slider
- Event: `SliderEvent` with `sliderValue: string` (final value after release) and `sliderMin?: string`, `sliderMax?: string`
- Capture: `change` event on `<input type="range">` (fires on release, not during drag)
- Plain English: `Set "Volume" slider to "75"`
- Action ID prefix: `slider`
- Execution JSON: `sliderValue`, `sliderMin?`, `sliderMax?`

### Multi-select
- Event: `MultiSelectEvent` with `selectedOptions: string[]` (currently selected values)
- Capture: `change` on `<select multiple>`
- Plain English: `Select ["Option A", "Option B"] from "Tags" multi-select`
- Action ID prefix: `multiselect`
- Execution JSON: `selectedOptions`

## Acceptance Criteria
- [ ] DatePickerEvent, SliderEvent, MultiSelectEvent defined in types.ts
- [ ] Each type registered in interaction-types.ts with buildPrompt, toPlainEnglish, executionExtras, extractAIData
- [ ] Each type has its own content script that imports from shared/recorder-base.ts
- [ ] Content scripts registered in manifest.json
- [ ] Service worker has message handlers for all 3 new types
- [ ] Each type has unique badge color in timeline CSS
- [ ] All 3 new types tested in recording-session.test.ts
- [ ] All 3 new types tested in step-builder.test.ts (plain English + execution JSON)
- [ ] All 3 new types have prompt-building tests in ai-understanding.test.ts
- [ ] All existing tests pass without regression
- [ ] No hardcoded secrets or URLs
- [ ] Manifest version bumped to 1.9.0
