# Playwright Generator — Milestone 5: Page Object Model Pattern

**Date:** 2026-07-20
**Depends on:** M1 (locators), M2 (actions), M3 (assertions + test functions), M4 (project)
**Design doc:** `.drytis/execution-ir-design.md` (§7: "POM deferred but architected for")

---

## Goal

When `GeneratorConfig.pattern === 'page-object'`, generate a complete Playwright project using the Page Object Model pattern. The same IR produces either flat (M4) or POM output — no IR changes, only adapter output decisions.

The generated POM code must follow the official Playwright POM pattern (playwright.dev/docs/pom) and be code that an experienced Playwright engineer would commit to production.

## POM Design

### Architecture Decision: Locator Getters + Action Methods

Each Page Object class has two layers:

1. **Locator getters** — one per unique element on the page, using M1's `renderLocator()`
2. **Action methods** — one per element-interacting step, using M2's action mapping

Assertions stay at the test level (Playwright best practice: the test verifies expectations, the page object encapsulates interaction).

### Page Object Structure

```typescript
import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Locators ──
  get emailInput(): Locator {
    return this.page.getByRole('textbox', { name: 'Email' });
  }

  get signInButton(): Locator {
    return this.page.getByRole('button', { name: 'Sign In' });
  }

  // ── Actions ──
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  async clickSignIn(): Promise<void> {
    await this.signInButton.click();
  }
}
```

### Test File Structure (POM mode)

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/login-page';
import { DashboardPage } from '../pages/dashboard-page';

test.describe('Login Flow', () => {
  test('should complete login Flow successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    // Navigate to login page
    await page.goto('https://staging.example.com/login');

    // Enter email address
    await loginPage.fillEmail('john.doe@example.com');

    // Verify dashboard heading is visible
    await expect(dashboardPage.dashboardHeading).toBeVisible();
  });
});
```

### Step Routing Rules

| Step Type | Where it renders |
|---|---|
| NAVIGATE | Test — `await page.goto(...)` (raw page call) |
| WAIT | Test — `await page.waitForTimeout(...)` (raw page call) |
| Element-interacting (CLICK/FILL/SELECT/etc.) | Page Object method → test calls the method |
| VERIFY | Test — assertions use page object locator getters |
| WAIT_FOR_ELEMENT | Omitted entirely (Playwright auto-waits) |

### Action Method Naming

Derived from action verb + element name (suffixes stripped):

| IRAction | Verb | "Email Input" → | "Newsletter Checkbox" → |
|---|---|---|---|
| CLICK | `click` | `clickEmail` | `clickNewsletter` |
| FILL | `fill` | `fillEmail` | — |
| SELECT | `select` | — | — |
| SELECT_DATE | `setDate` | — | — |
| TOGGLE true | `check` | — | `checkNewsletter` |
| TOGGLE false | `uncheck` | — | `uncheckNewsletter` |
| HOVER | `hover` | — | — |

### Method Parameters

| IRAction | Parameters |
|---|---|
| FILL | `(value: string)` |
| SELECT | `(value: string)` |
| SELECT_DATE | `(date: string)` |
| CLICK/TOGGLE/HOVER | none |

### Locator Getter Naming

Element name → camelCase, suffixes stripped:
- "Email Input" → `emailInput`
- "Sign In Button" → `signInButton`
- "Newsletter Checkbox" → `newsletterCheckbox`

Suffixes stripped for method names only (not getter names): Input, Button, Checkbox, Radio, Dropdown, Field, Element, Item

## POM Project Structure

```
package.json
playwright.config.ts
tsconfig.json          (includes pages/ dir)
.gitignore
tests/
  <slug>.spec.ts       (uses page objects)
pages/
  <page-slug>.ts       (one per pageOrComponent)
```

## Grouping Logic

1. Scan all steps for ElementTargets
2. Group by `target.pageOrComponent` (case-sensitive)
3. Within each group, collect unique elements (by `elementId`) → locator getters
4. Within each group, collect element-interacting steps → action methods
5. Elements in assertions only still get locator getters (no action methods)

## Files to Create/Modify

### Create
- `src/adapters/playwright/page-object-renderer.ts` — Page Object class generator
- `tests/adapters/playwright/page-object-renderer.test.ts`

### Modify
- `src/adapters/playwright/project-generator.ts` — Branch on `config.pattern`
- `src/adapters/playwright/test-function-renderer.ts` — Add POM test body renderer
- `tests/adapters/playwright/project-generator.test.ts` — Add POM mode tests

## Acceptance Criteria

### Page Object Generation
- [ ] AC-1: Generates one Page Object class per unique pageOrComponent value
- [ ] AC-2: Each class has constructor(page: Page)
- [ ] AC-3: Each class has locator getters for all unique elements on that page
- [ ] AC-4: Locator getters use M1's renderLocator output
- [ ] AC-5: Each class has action methods for element-interacting steps
- [ ] AC-6: Action methods are async and return Promise<void>
- [ ] AC-7: FILL/SELECT methods take a string parameter
- [ ] AC-8: CLICK/TOGGLE/HOVER methods take no parameters
- [ ] AC-9: TOGGLE true generates check method, TOGGLE false generates uncheck method
- [ ] AC-10: SELECT_DATE generates setDate method using fill()
- [ ] AC-11: Filename is slugified from pageOrComponent (e.g., "LoginPage" → "login-page.ts")

### Test File (POM mode)
- [ ] AC-12: Imports page object classes
- [ ] AC-13: Instantiates page objects at test start
- [ ] AC-14: NAVIGATE/WAIT steps render as raw page calls
- [ ] AC-15: Element-interacting steps delegate to page object methods
- [ ] AC-16: Assertions use page object locator getters
- [ ] AC-17: VERIFY steps render assertions using page object getters
- [ ] AC-18: WAIT_FOR_ELEMENT steps omitted

### Project Structure
- [ ] AC-19: POM project has pages/ directory with .ts files
- [ ] AC-20: tsconfig.json includes pages/ directory
- [ ] AC-21: Same package.json/playwright.config.ts/.gitignore as flat mode
- [ ] AC-22: Import paths from test to page objects are correct (../pages/)

### Coverage
- [ ] AC-23: All reference plans produce valid POM projects
- [ ] AC-24: Same IR produces both flat and POM — no IR changes
- [ ] AC-25: Adapter imports remain clean (domain only + sibling adapters)
- [ ] AC-26: All tests pass, zero regressions
