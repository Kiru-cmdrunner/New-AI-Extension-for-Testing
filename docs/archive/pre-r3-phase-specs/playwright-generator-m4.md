# Playwright Generator — Milestone 4: Complete Flat Project Export

**Date:** 2026-07-20
**Depends on:** Milestone 1 (locators), M2 (actions), M3 (assertions + test functions)
**Design doc:** `.drytis/execution-ir-design.md`

---

## Goal

Produce a complete, production-quality Playwright project from an ExecutionIRPlan that passes `npm install && npx playwright test` with zero manual editing. An experienced Playwright engineer should be comfortable cloning, reviewing, and committing this output directly.

**Quality bar:** Fewer files with excellent quality. No unnecessary complexity. Follow current Playwright best practices (official docs).

## Project Structure (Flat Pattern)

```
package.json
playwright.config.ts
tsconfig.json
.gitignore
tests/
  <test-case-slug>.spec.ts
```

That's it — 5 files. No fixtures, no helpers, no page objects (that's M5), no CI workflow (that's the customer's concern).

## File Specifications

### package.json

- Name: derived from test case title (slugified)
- Private: true (test projects shouldn't be published)
- Scripts: `test` → `@playwright/test`, `test:headed`, `test:ui`, `report` 
- DevDependencies: `@playwright/test` with a current stable version
- No runtime dependencies — generated tests only use Playwright's built-in APIs

### playwright.config.ts

- Uses `defineConfig` + `devices` from `@playwright/test`
- `testDir: './tests'`
- `fullyParallel: true`
- `forbidOnly: !!process.env.CI`
- `retries: process.env.CI ? 2 : 0`
- `workers: process.env.CI ? 1 : undefined`
- `reporter: 'html'`
- `use.baseURL` from IREnvironment.baseUrl
- `use.viewport` from IREnvironment.viewport
- `use.trace: 'on-first-retry'`
- Projects: single browser project from IREnvironment.browser mapped to Playwright device (chrome→Desktop Chrome, firefox→Desktop Firefox, safari→Desktop Safari, edge→Desktop Edge)

### tsconfig.json

- Standard Playwright tsconfig: ES2020 target, bundler moduleResolution
- Includes tests/

### .gitignore

- node_modules/
- test-results/
- playwright-report/
- playwright/.cache/

### test spec file

- Uses renderTestFile() from M3
- Filename: slugified test case title + .spec.ts

## Browser Mapping

| IREnvironment.browser | Playwright Project | Device |
|---|---|---|
| `chrome` | `chromium` | `devices['Desktop Chrome']` |
| `firefox` | `firefox` | `devices['Desktop Firefox']` |
| `safari` | `webkit` | `devices['Desktop Safari']` |
| `edge` | `msedge` | `devices['Desktop Edge']` |

## Implementation

### PlaywrightCodeGenerator class

Implements the `IRCodeGenerator` interface from the IR design. Accepts:
- `plan: ExecutionIRPlan` — the IR
- `config: GeneratorConfig` — output config (language, pattern, assertions)

Returns `GenerationResult` with `files: GeneratedFile[]`.

### Architecture

```
PlaywrightCodeGenerator.generate(plan, config)
  ├── buildPackageJson(plan)           → GeneratedFile
  ├── buildPlaywrightConfig(plan)      → GeneratedFile
  ├── buildTsConfig()                  → GeneratedFile
  ├── buildGitIgnore()                 → GeneratedFile
  └── buildTestFile(plan)              → GeneratedFile (from M3's renderTestFile)
```

All file builders are pure functions. The class orchestrates them.

## Files to Create

- `src/adapters/playwright/project-generator.ts` — PlaywrightCodeGenerator + file builders
- `tests/adapters/playwright/project-generator.test.ts` — comprehensive tests

## Acceptance Criteria

### Structure
- [ ] AC-1: generate() returns exactly 5 files (package.json, playwright.config.ts, tsconfig.json, .gitignore, tests/*.spec.ts)
- [ ] AC-2: All file paths are relative and correct
- [ ] AC-3: Test spec file uses the M3 renderTestFile() output

### package.json
- [ ] AC-4: Contains @playwright/test as devDependency
- [ ] AC-5: Has test script: `npx playwright test`
- [ ] AC-6: Private: true
- [ ] AC-7: Name is slugified from plan title

### playwright.config.ts
- [ ] AC-8: Uses defineConfig from @playwright/test
- [ ] AC-9: Has testDir: './tests'
- [ ] AC-10: baseURL set from plan.environment.baseUrl
- [ ] AC-11: viewport set from plan.environment.viewport
- [ ] AC-12: Has a browser project matching plan.environment.browser
- [ ] AC-13: CI-aware settings (retries, workers, forbidOnly)
- [ ] AC-14: Has trace: 'on-first-retry'
- [ ] AC-15: Reporter: 'html'

### tsconfig.json
- [ ] AC-16: Valid TypeScript config that Playwright can use
- [ ] AC-17: Includes tests directory

### .gitignore
- [ ] AC-18: Ignores node_modules, test-results, playwright-report, .cache

### Quality
- [ ] AC-19: Generated project would pass `npm install && npx playwright test` (verifiable by structure inspection)
- [ ] AC-20: No hardcoded URLs in config beyond what comes from the IR
- [ ] AC-21: All reference plans produce valid complete projects
- [ ] AC-22: Adapter imports ONLY from domain and sibling adapter files
- [ ] AC-23: generate() implements the IRCodeGenerator interface
- [ ] AC-24: All tests pass, zero regressions
