# Recorder Stabilization — Interaction Type Validation

## Objective
Fix the recorder so all 13 core interaction types work end-to-end:
capture → classify → IR Plan → Playwright code → successful replay.

## Bugs to Fix (Priority Order)

### Bug A: elementId always empty (CRITICAL)
- **Symptom**: `MissingFieldError: UiElement: required field "elementId" is missing or empty`
- **Root cause**: `deterministic-recorder.ts:691` hardcodes `elementId: ''`
- **Impact**: Domain Adapter → Recognition → Enrichment → Capability all crash
- **Fix**: Generate a stable synthetic elementId from available identity signals (cssSelector, name, tag, role)

### Bug B: `document is not defined` in MV3 Service Worker (CRITICAL)
- **Symptom**: `ReferenceError: document is not defined` in IR Bridge + persistence
- **Root cause**: Dynamic `import()` in MV3 SW is disallowed; imported modules reference `document`
- **Impact**: IR Bridge (code generation) and Repository V2 never execute
- **Fix**: Convert dynamic imports to static imports in the SW bundle, OR move pipeline execution to an offscreen document

### Bug C: Locator ranking produces non-functional selectors (HIGH)
- **Symptom**: `getByLabel('username')` finds 0 elements (OrangeHRM has no `<label>`)
- **Root cause**: `locator-ranking.ts` treats `name` attribute as `label` type; `accessibleName` rendered as `getByLabel`
- **Impact**: Generated tests cannot replay
- **Fix**: Fix locator type mapping and rendering to produce correct Playwright locator strategies

### Bug D: Classification issues (MEDIUM)
- Custom dropdowns (Vue/React/Angular) classified as Click, not DropdownSelect
- Date picker produces duplicate TextEntry interactions
- Radio button rendered as `selectOption` instead of `click`
- Checkbox needs verification

## Acceptance Criteria

### Interaction Types to Validate
- [ ] Login workflow (text entry + button click + navigation)
- [ ] Text entry (single field)
- [ ] Button recognition (Login, Save)
- [ ] Navigation (URL change)
- [ ] Custom dropdown (React/Vue/Angular)
- [ ] Native `<select>` dropdown
- [ ] Date picker (no duplicates, correct value capture)
- [ ] Radio button
- [ ] Checkbox
- [ ] Auto-complete field
- [ ] Hover menu
- [ ] Modal dialog
- [ ] Multi-step workflow

### For Each Type
- [ ] Captured correctly (raw events)
- [ ] Classified correctly (DetectedInteraction type)
- [ ] Plain English step is clear and accurate
- [ ] Execution JSON (IR Plan) is correct (action, target, locators)
- [ ] Generated Playwright code uses working selectors
- [ ] Replay succeeds
