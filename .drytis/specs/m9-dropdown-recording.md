# Milestone 9 — Dropdown Recording

## Goal

Record dropdown interactions using the same architecture as Click and Text Entry.
Each sub-action (open, select, close, scroll) is captured independently with its
own Action ID, Element ID, and AI understanding. No merging.

## Pipeline (unchanged from click/text_entry)

```
Browser Action → Content Script → processAction() → Session → AIService → StepBuilder → Storage
```

## Requirements

### R1 — Types: DropdownEvent
- `DropdownEvent`: `{ actionId, type: 'dropdown', timestamp, elementIdentity, dropdownAction: 'open'|'select'|'close'|'scroll', selectedOption?, aiUnderstanding?, aiError? }`
- Add `'dropdown'` to `ActionType` union
- Add `dropdownAction?` and `selectedOption?` to `ExecutionJson`
- `SessionEvent` union includes `DropdownEvent`
- Add `DROPDOWN_ACTION` message type + `DropdownActionPayload`

### R2 — RecordingSession: addDropdown()
- New `dropdownIdGenerator` with prefix `'dropdown'`
- `addDropdown(rawIdentity, dropdownAction, selectedOption?)` → DropdownEvent

### R3 — Step Builder: dropdown-aware
- `ActionEvent` union includes `DropdownEvent`
- `generatePlainEnglish()` handles `'dropdown'` with sub-action phrasing:
  - open → "Open the 'Country' dropdown"
  - select → "Select 'India' from the 'Country' dropdown"
  - close → "Close the 'Country' dropdown"
  - scroll → "Scroll the 'Country' dropdown"
- `buildExecutionJson()` sets `action: 'dropdown'` + includes `dropdownAction` + `selectedOption`

### R4 — AI Understanding: dropdown-aware prompt
- `ActionElementInfo` gains `dropdownAction?` and `selectedOption?` fields
- Prompt for dropdown: "Analyze this dropdown interaction (open/select/close/scroll)..."

### R5 — Service Worker: DROPDOWN_ACTION handler
- `processAction()` extended to handle `'dropdown'` action type
- Calls `session.addDropdown()`, passes dropdownAction/selectedOption to AI

### R6 — Content Script: dropdown-content-script.ts
- Listens on `<select>` elements:
  - `focusin` → open dropdown (dropdownAction: 'open')
  - `change` → select option (dropdownAction: 'select', selectedOption: e.target.value)
  - `focusout` → close dropdown (dropdownAction: 'close')
- Same inline element identity engine

### R7 — Manifest: register dropdown content script

### R8 — Side Panel: render dropdown events
- Timeline shows orange-amber badges (dropdown-XXXX)
- Shows dropdownAction + selectedOption

## Acceptance Criteria

- [ ] Dropdown open/select/close captured independently
- [ ] Each gets own Action ID (dropdown-0001, dropdown-0002, ...)
- [ ] Each gets own Element ID
- [ ] AI receives dropdown-specific prompt with sub-action context
- [ ] Plain English: "Open the 'Country' dropdown", "Select 'India' from the 'Country' dropdown"
- [ ] Execution JSON has action: 'dropdown' + dropdownAction + selectedOption
- [ ] Steps render in timeline
- [ ] No regression in click/text_entry
- [ ] All existing tests pass + new tests pass
- [ ] Build succeeds
