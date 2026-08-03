# Milestone 7 — Test Repository Manager

## Goal
Transform the extension from a recorder into a QA Test Repository. After recording, users organize captured test cases into a structured hierarchy: **Project → Feature → Scenario → Test Case**. The repository persists across extension restarts and preserves step↔JSON mappings.

## Data Model

```
Repository
  └── Project (proj-XXXX)
       └── Feature (feat-XXXX)
            └── Scenario (scn-XXXX)
                 └── TestCase (tc-XXXX)
                      ├── name
                      ├── steps: TestStep[]   (deep copy, immutable)
                      ├── events: SessionEvent[] (deep copy)
                      └── createdAt
```

Rules:
- Every TestCase belongs to exactly one Scenario.
- Every Scenario belongs to exactly one Feature.
- Every Feature belongs to exactly one Project.
- Step JSON and execution mapping are never editable.
- Repository persists in `chrome.storage.local` under key `test_repository`.

## Files to Create / Change

### New Files
1. **`src/repository/repository-service.ts`** — CRUD operations for the entire hierarchy + search.
2. **`src/repository/repository-page.ts`** — Full-page Repository Browser UI (tree + search).
3. **`src/repository/index.html`** — Browser page HTML.
4. **`src/repository/repository.css`** — Browser page styles.
5. **`tests/repository-service.test.ts`** — Unit tests for all CRUD + search.

### Changed Files
6. **`src/shared/types.ts`** — Repository types (Project, Feature, Scenario, RepositoryTestCase, Repository), new StorageKey, new AppMessage types for nav.
7. **`src/storage/storage-service.ts`** — Repository get/set helpers.
8. **`src/sidepanel/index.html`** — Add "Save to Repository" section after Stop Recording.
9. **`src/sidepanel/sidepanel.ts`** — Save flow: cascading dropdowns + save + success/record-another/finish.
10. **`src/sidepanel/sidepanel.css`** — Styles for save form + success state.
11. **`src/manifest.json`** — Add repository page to web_accessible_resources or as an options sub-page. Add nav message.

## Acceptance Criteria

### CRUD
- [ ] Create Project — new project appears in repository
- [ ] Rename Project — name updates, children preserved
- [ ] Delete Project — project + all children removed
- [ ] Create Feature inside a Project
- [ ] Rename Feature
- [ ] Delete Feature (+ its scenarios + test cases)
- [ ] Create Scenario inside a Feature
- [ ] Rename Scenario
- [ ] Delete Scenario (+ its test cases)

### Save Recorded Test Case
- [ ] After Stop Recording, the side panel shows a save form with Project, Feature, Scenario dropdowns + test case name input
- [ ] Dropdowns cascade: Feature options depend on selected Project, Scenario on selected Feature
- [ ] User can create new Project/Feature/Scenario inline from the save form
- [ ] On Save, the test case (with all steps + events) is stored under the selected Scenario
- [ ] After save, show "Test Case Saved Successfully" + [Record Another Test Case] + [Finish] buttons
- [ ] "Record Another" clears the session and returns to Ready state
- [ ] "Finish" returns to Ready state

### Repository Browser
- [ ] Full-page browser accessible from side panel
- [ ] Tree view: Project → Feature → Scenario → Test Case (expand/collapse)
- [ ] Create/Rename/Delete at each level
- [ ] Click a Test Case to view its steps + execution JSON
- [ ] Execution JSON is read-only

### Search
- [ ] Search bar filters by Project, Feature, Scenario, or Test Case name
- [ ] Matching nodes are highlighted/expanded

### Persistence
- [ ] Repository survives extension restart
- [ ] Step JSON remains unchanged after save
- [ ] Execution mapping preserved

### Architecture
- [ ] Adding a test case to the repository does NOT modify the original session steps
- [ ] All repository operations go through RepositoryService — no direct chrome.storage calls outside the service layer

## Out of Scope
- Editing test steps or execution JSON
- Negative/boundary/validation/accessibility/security test generation
- CmdRunner upload
