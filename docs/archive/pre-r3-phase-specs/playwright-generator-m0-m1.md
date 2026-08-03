# Task Spec: Playwright Generator — Milestone 0 (Reference Suite) + Milestone 1 (Locator Rendering)

**Status:** Active
**Date:** 2026-07-20
**Blueprint reference:** `execution-ir-design.md` §4.2, §7.1
**Depends on:** `src/domain/execution-ir/` (complete), `src/domain/enums.ts` (LocatorStrategyType)

---

## Context

The Execution IR type system and generator are complete. The Playwright generator (`IRCodeGenerator` implementation) is the first concrete adapter that validates the IR is sufficient for real code generation. We build incrementally — Milestone 0 (reference IR plans) then Milestone 1 (locator strategy rendering).

## Files to Create

### Milestone 0 — Reference IR Plan Suite
```
src/adapters/playwright/__fixtures__/reference-ir-plans.ts
  — Factory functions producing representative ExecutionIRPlan objects
    covering: login, dropdowns, date pickers, checkboxes/radios, file upload,
    tables, search, modals, iframes, shadow DOM, keyboard input, forms with
    complex validations. These are permanent reference cases for all generators.

tests/adapters/playwright/reference-ir-plans.test.ts
  — Validates each reference plan: correct shape, all LocatorStrategyType
    values represented, all IRAction values represented (except execution-only),
    all ValidationType values represented.
```

### Milestone 1 — Locator Strategy Rendering
```
src/adapters/playwright/locator-renderer.ts
  — Pure function: (ResolvedLocator[]) → string
    Maps each LocatorStrategyType to Playwright's locator API:
      ROLE           → page.getByRole(role, { name: ... })
      ACCESSIBLE_NAME → page.getByLabel(name) or page.getByPlaceholder(name)
      TEST_ID        → page.getByTestId(id)
      TEXT           → page.getByText(text)
      LABEL          → page.getByLabel(label)
      CSS            → page.locator(selector)
      XPATH          → page.locator('xpath=...')
    Returns the first (highest-priority) locator expression.

tests/adapters/playwright/locator-renderer.test.ts
  — Tests every LocatorStrategyType value renders correctly.
    Tests that resolvedLocators[0] (priority 1) is used.
    Tests edge cases: role without name, CSS with compound selectors.
```

## Acceptance Criteria

### Milestone 0
- [ ] AC-1: At least 10 reference IR plans covering common UI patterns.
- [ ] AC-2: Every LocatorStrategyType value appears in at least one reference plan.
- [ ] AC-3: Every IRAction (business-authored) appears in at least one reference plan.
- [ ] AC-4: Every ValidationType appears in at least one reference plan.
- [ ] AC-5: Reference plans are factory functions (not hardcoded objects) so they can be reused across test suites.
- [ ] AC-6: Each reference plan is a valid ExecutionIRPlan (all required fields present).

### Milestone 1
- [ ] AC-7: `renderLocator(locators)` returns a Playwright locator expression string.
- [ ] AC-8: ROLE renders to `page.getByRole(role, { name: name })` with correct role/name extraction.
- [ ] AC-9: ACCESSIBLE_NAME renders to `page.getByLabel(name)` or `page.getByPlaceholder(name)`.
- [ ] AC-10: TEST_ID renders to `page.getByTestId(id)`.
- [ ] AC-11: TEXT renders to `page.getByText(text)`.
- [ ] AC-12: LABEL renders to `page.getByLabel(label)`.
- [ ] AC-13: CSS renders to `page.locator(selector)`.
- [ ] AC-14: XPATH renders to `page.locator('xpath=...')`.
- [ ] AC-15: Uses the highest-priority locator (priority 1) when multiple strategies provided.
- [ ] AC-16: ROLE value parsing handles `button[name="Sign In"]` → role=button, name=Sign In.
- [ ] AC-17: ROLE value parsing handles `heading` (no name) → role=heading.
- [ ] AC-18: Locator renderer imports ONLY from IR types + enums (no domain entity imports).

## Key Design Decisions

1. **Locator rendering uses priority-1 strategy only** (Milestone 1 scope). Fallback chains are a later refinement.
2. **Reference plans are factory functions** returning fresh objects — prevents cross-test mutation and allows parameterization.
3. **ROLE value parsing** — the locator value uses a `role[name="..."]` format (matching how the recorder captures it). The renderer parses this into Playwright's `getByRole(role, { name })` API.
4. **Locator renderer is a pure function** — no side effects, no I/O, no DB. Given the same input, always produces the same output.

## Edge Cases

- ROLE value with no name: `heading` → `page.getByRole('heading')`
- ROLE value with name: `button[name="Submit"]` → `page.getByRole('button', { name: 'Submit' })`
- ROLE value with complex name: `link[name="Forgot password?"]` → `page.getByRole('link', { name: 'Forgot password?' })`
- TEST_ID value with CSS-style selector: `[data-testid="email"]` → extract `email` → `page.getByTestId('email')`
- XPATH value already prefixed with `//`: `//div[@id="main"]` → `page.locator('xpath=//div[@id="main"]')`
- Empty resolvedLocators array → throw (should never happen per INV-EL4, but guard)
