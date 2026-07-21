# Playwright Generator — Milestone 3: ExecutionIRPlan → Complete Test Function

**Date:** 2026-07-20
**Depends on:** Milestone 1 (locator renderer), Milestone 2 (action renderer)
**Design doc:** `.drytis/execution-ir-design.md`

---

## Goal

Combine M1 (locators) + M2 (actions) and add assertions, execution parameters,
and test structure to produce a **complete, production-quality `test()` block**
that could be dropped into a Playwright project.

Generated code must follow Playwright best practices:
- All action methods `await`ed
- Assertions use `await expect()`
- Step descriptions become explanatory comments
- Proper `describe` → `test` structure
- Clean import statement

## Sub-Components

### 3A: Assertion Renderer

Maps `IRAssertion → Playwright expect()` lines.

**Full assertion matrix:**

| type | comparison | → Playwright |
|---|---|---|
| VISIBILITY | IS_TRUE | `await expect(loc).toBeVisible()` |
| VISIBILITY | IS_FALSE | `await expect(loc).toBeHidden()` |
| PRESENCE | IS_TRUE | `await expect(loc).toBeAttached()` |
| PRESENCE | IS_FALSE | `await expect(loc).not.toBeAttached()` |
| TEXT_MATCH | EQUALS | `await expect(loc).toHaveText('val')` |
| TEXT_MATCH | CONTAINS | `await expect(loc).toContainText('val')` |
| TEXT_MATCH | STARTS_WITH | `await expect(loc).toContainText(/^val/)` |
| TEXT_MATCH | MATCHES | `await expect(loc).toHaveText(/val/)` |
| ATTRIBUTE_MATCH | EQUALS | `await expect(loc).toHaveAttribute('prop', 'val')` |
| ATTRIBUTE_MATCH | CONTAINS | `await expect(loc).toHaveAttribute('prop', /val/)` |
| ATTRIBUTE_MATCH | MATCHES | `await expect(loc).toHaveAttribute('prop', /val/)` |
| COUNT | EQUALS | `await expect(loc).toHaveCount(n)` |
| COUNT | GREATER_THAN | `const count = await loc.count(); expect(count).toBeGreaterThan(n)` |
| COUNT | LESS_THAN | `const count = await loc.count(); expect(count).toBeLessThan(n)` |
| EQUALITY | IS_TRUE | property-specific: `toBeChecked()`, `toBeEnabled()`, fallback `toHaveAttribute(prop, 'true')` |
| EQUALITY | IS_FALSE | property-specific: `not.toBeChecked()`, `toBeDisabled()`, fallback `not.toHaveAttribute(prop, 'true')` |
| URL_MATCH | EQUALS | `await expect(page).toHaveURL('url')` |
| URL_MATCH | CONTAINS | `await expect(page).toHaveURL(/url/)` |
| URL_MATCH | MATCHES | `await expect(page).toHaveURL(/url/)` |
| URL_MATCH | STARTS_WITH | `await expect(page).toHaveURL(/^url/)` |
| CUSTOM | any | `// TODO: Custom assertion — type: custom, comparison: X` |

**Severity mapping:**
- HARD → `expect(...)` (stops on failure)
- SOFT → `expect.soft(...)` (records, continues)

**Property resolution for EQUALITY type:**
| property | IS_TRUE | IS_FALSE |
|---|---|---|
| `checked` | `toBeChecked()` | `not.toBeChecked()` |
| `enabled` | `toBeEnabled()` | `toBeDisabled()` |
| `editable` | `toBeEditable()` | `not.toBeEditable()` |
| *(unknown)* | `toHaveAttribute(prop, 'true')` | `not.toHaveAttribute(prop, 'true')` |

### 3B: Test Function Renderer

Combines action lines + assertion lines into a complete test file:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test('should complete login flow successfully', async ({ page }) => {
    // Navigate to login page
    await page.goto('https://staging.example.com/login');

    // Enter email
    await page.getByRole('textbox', { name: 'Email' }).fill('john@example.com');

    // Verify redirect to dashboard
    await expect(page).toHaveURL(/dashboard/);
  });
});
```

Design decisions:
- `await` on all action and assertion lines (Playwright requires `await` for auto-retrying)
- Step `description` → comment above the action line
- Assertions rendered immediately after the step's action line
- VERIFY steps (no action) render assertions under their description comment
- Test title: `plan.title` formatted as readable test name
- Empty-action steps (VERIFY, WAIT_FOR_ELEMENT) that have assertions still emit their comments

## Files to Create

- `src/adapters/playwright/assertion-renderer.ts` — IRAssertion → expect() lines
- `src/adapters/playwright/test-function-renderer.ts` — Complete test function
- `tests/adapters/playwright/assertion-renderer.test.ts`
- `tests/adapters/playwright/test-function-renderer.test.ts`

## Acceptance Criteria

### Assertion Renderer
- [ ] AC-1: Every ValidationType × ValidationComparison combination renders to valid Playwright expect()
- [ ] AC-2: VISIBILITY IS_TRUE → toBeVisible(), IS_FALSE → toBeHidden()
- [ ] AC-3: PRESENCE IS_TRUE → toBeAttached(), IS_FALSE → not.toBeAttached()
- [ ] AC-4: TEXT_MATCH maps EQUALS/CONTAINS/STARTS_WITH/MATCHES correctly
- [ ] AC-5: ATTRIBUTE_MATCH uses property as attribute name, maps comparison to value or regex
- [ ] AC-6: COUNT EQUALS → toHaveCount(n), GREATER_THAN/LESS_THAN → count extraction pattern
- [ ] AC-7: EQUALITY IS_TRUE/IS_FALSE resolves property (checked/enabled/editable) to Playwright API
- [ ] AC-8: URL_MATCH renders on page target (not element locator)
- [ ] AC-9: CUSTOM renders a descriptive TODO comment
- [ ] AC-10: SOFT severity uses expect.soft() instead of expect()
- [ ] AC-11: HARD severity (default) uses expect()

### Test Function Renderer
- [ ] AC-12: Produces import statement
- [ ] AC-13: Wraps in test.describe() with plan.title as describe name
- [ ] AC-14: test() uses plan.title as test name with 'should' prefix
- [ ] AC-15: Step descriptions render as comments
- [ ] AC-16: All action lines are awaited
- [ ] AC-17: All assertion lines are awaited (except non-auto-retrying count comparisons)
- [ ] AC-18: VERIFY steps render their assertions under a comment
- [ ] AC-19: WAIT_FOR_ELEMENT steps are omitted entirely
- [ ] AC-20: Output is valid TypeScript that would compile in a Playwright project

### Coverage
- [ ] AC-21: All reference plans render to complete test functions without errors
- [ ] AC-22: Generated code contains no undefined/null/NaN as bare words
- [ ] AC-23: Adapter imports ONLY from domain/enums and domain/execution-ir/types
- [ ] AC-24: All tests pass, zero regressions
