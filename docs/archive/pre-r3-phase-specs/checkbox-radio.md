# Milestone: Checkbox & Radio Button Recording

## Objective

Implement Checkbox and Radio Button interactions **using the Interaction Registry**.
This milestone validates that the registry refactor delivers on its promise:
new types added via registration + content script + types, with no core pipeline changes.

## Acceptance Criteria

- [ ] Checkbox check/uncheck captured correctly
- [ ] Radio button selection captured correctly
- [ ] AI understands both types (businessName, controlType, intent, confidence)
- [ ] Plain English: "Check the X checkbox" / "Uncheck the X checkbox" / "Select the X radio button"
- [ ] Execution JSON includes checkboxAction/isChecked for checkbox, selectedValue for radio
- [ ] Action ID, Element ID, iframeContext, Screenshot, Repository all reused
- [ ] All 285 existing tests pass
- [ ] New tests for checkbox + radio
- [ ] No regression in existing types
- [ ] **Registry validation**: document whether core pipeline changes were needed

## Execution JSON

### Checkbox
```json
{ "action": "checkbox", "checkboxAction": "check", "isChecked": true }
```

### Radio
```json
{ "action": "radio", "selectedValue": "Business Class" }
```

## Registry Validation

At the end, report:
1. How many files changed
2. Which changes were "registry + types + content script" vs "core pipeline"
3. Whether the registry delivered on its promise
