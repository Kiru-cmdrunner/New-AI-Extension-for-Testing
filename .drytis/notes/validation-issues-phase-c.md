# Foundation Validation — Phase C Issues Log (Tier 3: Framework-Specific)

## Frameworks Analyzed

### 1. Vue 3.5 (todomvc.com/examples/vue/dist/)
- **Root marker:** `data-v-app=""` on root element
- **New todo input:** `type="text"`, `class="new-todo"`, `placeholder`, `autofocus`, `autocomplete="off"` — no id, no aria-label
- **Toggle-all checkbox:** `id="toggle-all-input"`, `class="toggle-all"` — has id
- **Todo toggle:** `class="toggle"`, no id, no aria-label, `checked=""` (empty string when checked)
- **Destroy button:** `class="destroy"`, no type, no aria-label, empty text (CSS ::after)
- **Filter links:** `router-link-active`, `router-link-exact-active` classes, `aria-current="page"`
- **Clear completed:** `class="clear-completed"`, `style=""` (empty from :style binding), no type
- **Form state:** No form state classes on input
- **Component tags:** No component tags in DOM (Vue renders to host element)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| C-001 | — | No issues found | All patterns handled correctly |

### 2. Angular 21 (todomvc.com/examples/angular/dist/browser/)
- **Root marker:** `<app-root ng-version="21.2.11">` — custom element with version
- **Component tags:** `<app-todo-header>`, `<app-todo-list>`, `<app-todo-item>`, `<app-todo-footer>` in DOM
- **New todo input:** NO `type` attribute (omitted, defaults to text), `ng-*` form state classes
- **Toggle-all checkbox:** `class="toggle-all"` — NO id (unlike Vue)
- **Toggle-all label:** Uses `htmlfor="toggle-all"` (Angular binding) instead of `for`
- **Destroy button:** `aria-label="Delete todo"` — Angular adds accessibility label Vue does NOT
- **Filter links:** `routerlink` attribute, `class="selected"` for active
- **Clear completed:** `type="button"` explicitly set, `hidden=""` when no completed items
- **Form state:** `ng-untouched`, `ng-pristine`, `ng-valid` → `ng-dirty`, `ng-touched` (changes on interaction)

| ID | Severity | Issue | Status |
|----|----------|-------|--------|
| C-002 | P3 | Angular ng-* form state classes change during interaction | **Not an issue** — recorder identifies elements by elementId, not className |
| C-003 | P3 | Angular custom component tags (app-*) in DOM tree | **Not an issue** — CSS selectors include component tags but pipeline handles them |
| C-004 | P3 | Angular omit type="text" on input | **Not an issue** — recorder checks el.type which defaults to 'text' |
| C-005 | P3 | Angular htmlfor instead of for on labels | **Not an issue** — recorder doesn't use label `for` attribute for identity |
| C-006 | P3 | Vue empty style="" attributes | **Not an issue** — recorder doesn't capture style attribute |

## Cross-Framework Comparison

| Dimension | React 19 | Vue 3.5 | Angular 21 |
|-----------|----------|---------|------------|
| data-testid | Zero | Zero | Zero |
| Root marker | None | data-v-app="" | ng-version on app-root |
| Component tags in DOM | No | No | Yes (app-*) |
| New-todo type attr | type="text" | type="text" | Omitted |
| Toggle-all id | id="toggle-all" | id="toggle-all-input" | No id |
| Destroy aria-label | None | None | "Delete todo" |
| Filter active class | None | router-link-active | class="selected" |
| Clear completed type | No type | No type | type="button" |
| Form state classes | None | None | ng-* classes |
| Empty style="" attrs | No | Yes | No |
| hidden="" attr usage | No | No | Yes |

### Key Finding: Pipeline Produces Equivalent IR

All three frameworks produce the **exact same IR action sequence** for the same workflow:
```
['fill', 'toggle', 'click']
```

This confirms the pipeline is framework-agnostic — it operates on DOM-level events
and element identity, not framework-specific abstractions.

## New Tests Added

- tests/phase-c-framework-validation.test.ts: 20 tests across 4 describe blocks
  - Vue 3.5: 7 tests (new-todo, toggle-all, todo toggle, destroy, filter, clear, full workflow)
  - Angular 21: 7 tests (new-todo, toggle-all, todo toggle, destroy, filter, clear, full workflow)
  - Cross-framework comparison: 5 tests (equivalent IR, V2 consistency, Angular component tags, Vue style attrs, Angular ng-* classes)
  - Pattern comparison summary: 1 test

## Phase C Exit Assessment

### Criteria Met
- ✓ Vue framework validated (TodoMVC Vue 3.5)
- ✓ Angular framework validated (TodoMVC Angular 21)
- ✓ Cross-framework IR equivalence verified
- ✓ Framework-specific patterns identified and tested (component tags, form state classes, routerlink, etc.)
- ✓ Zero P0/P1 issues found
- ✓ All P3 observations are expected behavior (not bugs)
- ✓ Full test suite passes (2956/2956)
- ✓ Build succeeds

### Overall Foundation Validation Exit Criteria
- ✓ All Tier 1 (built-in test pages) workflows pass — Phase A
- ✓ 3+ public apps clean — Phase B (HN, Wikipedia, The-Internet, TodoMVC React)
- ✓ 1+ framework app works — Phase C (React, Vue, Angular all pass)
- ✓ Runtime healing pipeline tested — Phase A (Workflow F)
- ✓ Repository persistence tested — Phase A + B (domain adapter + understanding)
- ✓ Zero P0/P1 issues across all phases
- ✓ P2/P3 issues logged with explanations
- ✓ Full test suite passes (2956/2956, 121 files)

### Recommendation
**Foundation Validation is COMPLETE.** The platform is stable and ready for feature development.
The pipeline is framework-agnostic — it produces equivalent IR plans regardless of the
frontend framework's DOM conventions. All edge cases (table layouts, shadow DOM, iframes,
controlled inputs, form state changes, custom component tags) are handled correctly.
