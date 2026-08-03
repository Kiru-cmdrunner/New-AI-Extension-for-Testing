# Milestone B6 — Playwright Generator Implementation

## Objective
Implement the Playwright Generator that produces one Playwright `test()` per Test Case by consuming Canonical Test Steps + Execution JSON produced by the Generation Pipeline.

## Pipeline Position
```
Interaction Timeline → Canonical Step Generator → Execution JSON Generator → Playwright Generator → Generated Playwright Test
```

## Files Created
1. `src/generation/generators/playwright-generator.ts` (~410 lines) — Generator implementing `GeneratorContract`, with:
   - `translateLocator()` — maps each B5.2 locator strategy to Playwright API (getByTestId, getByLabel, getByText, locator(), etc.)
   - `translateAction()` — extensible action-mapping (click, navigate, fill, select, hover, error)
   - `buildTest()` — assembles full test with imports, recording context navigation, step comments, fallback locator comments
   - `buildFramePrefix()` — wraps element actions in `frameLocator()` for iframe context
   - `generate()` — entry point, returns `PlaywrightGeneratorOutput { testCode, isManualEdit, generatedAt }`

2. `tests/playwright-generator.test.ts` (~578 lines, 49 tests) — covering:
   - All 16 locator strategy translations
   - Action mapping (click, navigate, hover, fill, select, error, unknown)
   - buildTest structure, traceability comments, fallback comments
   - iframe frame locator wrapping
   - Shadow DOM (uses resolved locators as-is)
   - Determinism (identical input → identical testCode)
   - End-to-end flight booking workflow example
   - Generator contract compliance

## Files Modified
1. `src/generation/engine/generation-engine.ts` — imported and registered playwrightGenerator (3rd in registry), added invocation branch reading steps+recordingContext+testCaseName, persists output via `StorageService.setGeneratedPlaywright()`
2. `src/shared/types.ts` — added `GENERATED_PLAYWRIGHT` to `StorageKeys` enum
3. `src/storage/storage-service.ts` — added `getGeneratedPlaywright()`, `setGeneratedPlaywright()`, `clearGeneratedPlaywright()` methods
4. `src/sidepanel/index.html` — added Generated Playwright Test section (toggleable `<pre>`)
5. `src/sidepanel/sidepanel.ts` — added Playwright section rendering, toggle handler, clear-on-record-another
6. `src/sidepanel/sidepanel.css` — added `.playwright-section` styling
7. `src/manifest.json` — version → 5.1.0
8. `package.json` — version → 5.1.0

## Acceptance Criteria
- [x] Generator registered with Generator Registry (dependency: execution-json-generator)
- [x] Produces one `test()` per Test Case
- [x] Generates Playwright code from Canonical Steps + Execution JSON only
- [x] Uses primary locator from Execution JSON locators array
- [x] Preserves execution order
- [x] Deterministic output (same steps → same code)
- [x] Traceability comments (`// Step N: plainEnglish`)
- [x] Fallback locator comments
- [x] iframe context via frameLocator()
- [x] Shadow DOM uses resolved locators (no special wrapping)
- [x] Error steps produce commented placeholders
- [x] Extensible action-mapping (future types: fill, select, hover)
- [x] Does NOT resolve locators
- [x] Does NOT inspect raw recordings / Interaction Timeline
- [x] Does NOT modify Canonical Steps / Execution JSON / TC state
- [x] Returns artifact to Generation Engine
- [x] No regressions in existing functionality
- [x] All tests pass (424/424)
- [x] Build succeeds
- [x] ZIP accessible (HTTP 200)

## Out of Scope
Playwright Suite generation, multi-file projects, Cypress/Selenium, Review workflow, Repository enhancements, UI redesign, New interaction types.
