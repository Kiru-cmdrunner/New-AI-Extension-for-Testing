# Milestone A — Test Case Creation Flow Implementation Spec

## Scope
Replace the current "Start Recording → ... → Save to Repository" flow with:
Home → New Test Case form → Start Recording → Recording → Stop Recording

## Files to Change

### 1. types.ts
- Add `TestCaseState` enum: DRAFT, RECORDING, RECORDED, GENERATED, UNDER_REVIEW, APPROVED, SAVED
- Add `TestCaseDraft` interface: { id, name, expectedResult?, projectId, projectName, featureId, featureName, scenarioId, scenarioName, status: TestCaseState, createdAt }
- Add `TEST_CASE_DRAFT = 'test_case_draft'` to StorageKeys
- Add `CREATE_TEST_CASE` message type with TestCaseDraft payload
- Add `CLEAR_TEST_CASE` message type

### 2. storage-service.ts
- `getTestCaseDraft()`: reads from TEST_CASE_DRAFT key
- `setTestCaseDraft(draft)`: persists
- `clearTestCaseDraft()`: removes

### 3. index.html
- Replace initial actions div (just Start/Stop buttons) with:
  - Home section: "New Test Case" button + "Browse Repository" button
  - New TC form section (hidden by default): Project/Feature/Scenario dropdowns + TC Name + Expected Result + Start Recording/Cancel buttons
  - Recording controls: just Stop Recording button (shown during recording)
- Keep existing timeline, steps, screenshots sections for during/after recording
- Hide the old save-section (will be handled in Milestone E)

### 4. sidepanel.ts
- New UI states: 'home', 'new-test-case', 'recording', 'stopped'
- `renderView(view)` function to show/hide sections
- Home view: New Test Case button, Browse Repository button
- New TC view: cascading dropdowns (reuse existing logic), TC name input, expected result textarea
- Validation: all 4 mandatory fields required before Start Recording
- On Start Recording: send CREATE_TEST_CASE with draft, then START_RECORDING
- On Stop Recording: show timeline + steps (no save form yet)
- Record Another: go back to New Test Case view
- Reuse existing populateProjectDropdown/populateFeatureDropdown/populateScenarioDropdown logic

### 5. service-worker.ts
- Handle CREATE_TEST_CASE: persist TestCaseDraft to storage
- Handle CLEAR_TEST_CASE: remove from storage
- START_RECORDING stays the same (captures context, starts session)

## Out of Scope
- Review workflow, approval, save to repository, Playwright generation
- Post-recording save form (remove from flow, will be rebuilt in Milestone E)
- Success screen (remove temporarily, will be rebuilt in Milestone E)
