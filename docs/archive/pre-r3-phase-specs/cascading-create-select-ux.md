# Cascading Create-or-Select UX for Repository Save Form

## Goal

Transform the Repository Manager save form into a seamless create-or-select
experience. Users can select existing items from dropdowns or create new ones
inline — without leaving the side panel or using `prompt()` dialogs.

## Current Problems

1. Creating new entities uses `window.prompt()` — clunky, browser-native, breaks flow.
2. No inline creation: user must use the separate Repository Browser page.
3. No duplicate name validation — duplicates can be silently created.
4. Feature/scenario dropdowns are always visible even before a parent is selected.

## Requirements

### R1 — Project Field: Select or Create
- Dropdown lists all existing projects.
- A `─────` separator, then a `+ Create New Project` option at the bottom.
- When `+ Create New Project` is selected, show an inline form:
  - Text input for project name
  - `[Create]` button
  - `[Cancel]` link to go back to dropdown
- After creating:
  - New project is saved to the repository.
  - New project auto-selects in the dropdown (no manual re-selection).
  - Feature dropdown becomes enabled and populated.

### R2 — Feature Field: Select or Create (cascade-gated)
- Disabled until a project is selected.
- Dropdown lists existing features under the selected project.
- `+ Create New Feature` at the bottom (after separator).
- Same inline create form pattern.
- Duplicate validation: no two features with the same name under the same project.
- After creating: auto-select, enable scenario dropdown.

### R3 — Scenario Field: Select or Create (cascade-gated)
- Disabled until a feature is selected.
- Same pattern as Feature.

### R4 — Duplicate Name Validation
- `createProject(name)`: throws if a project with the same name (case-insensitive) already exists.
- `createFeature(projectId, name)`: throws if a feature with the same name already exists under that project.
- `createScenario(projectId, featureId, name)`: throws if a scenario with the same name already exists under that feature.
- The UI shows a clear inline error message, does NOT clear the input, lets the user fix the name and retry.
- Duplicate check is case-insensitive and trims whitespace.

### R5 — Cascading Enable/Disable
- Feature dropdown + create form is disabled/hidden until a project is selected.
- Scenario dropdown + create form is disabled/hidden until a feature is selected.
- Test case name input is always enabled (user can type it any time).

### R6 — No `prompt()` Calls
- All entity creation happens inline in the side panel — no native browser dialogs.

### R7 — UI Polish
- Separator in dropdown between existing items and "Create New".
- Disabled state styling for feature/scenario when parent not selected.
- Error styling for validation messages.
- Create button shows a brief loading state while saving.

## Files to Change

- `src/repository/repository-service.ts` — add duplicate validation to create methods
- `src/sidepanel/sidepanel.ts` — rewrite save form logic (dropdown management, inline create, auto-select)
- `src/sidepanel/index.html` — add inline create forms, error message containers, separator
- `src/sidepanel/sidepanel.css` — styling for create forms, errors, disabled states, separators
- `tests/repository-service.test.ts` — add tests for duplicate validation

## Acceptance Criteria

- [ ] Selecting an existing project populates the feature dropdown
- [ ] Selecting "+ Create New Project" shows an inline name input + Create button
- [ ] Creating a new project saves it and auto-selects it in the dropdown
- [ ] Feature dropdown is disabled until a project is selected
- [ ] Creating a new feature works the same way (inline, auto-select, cascade-enables scenario)
- [ ] Scenario dropdown is disabled until a feature is selected
- [ ] Creating a new scenario works the same way
- [ ] Duplicate project name shows a clear inline error, does not clear input
- [ ] Duplicate feature name under same project shows error
- [ ] Same-named feature under different projects is allowed
- [ ] Duplicate scenario name under same feature shows error
- [ ] No `window.prompt()` calls remain in the save flow
- [ ] All existing tests still pass
- [ ] New tests for duplicate validation pass
- [ ] Build succeeds without errors
