# Foundation Validation — Phase A Issues Log

## Tier 1: Built-in Test Pages

### Issues Found

| ID | Severity | Page | Issue | Status |
|----|----------|------|-------|--------|
| V-001 | P1 | validation.html | 404 error for /src/classifier/interaction-detector.ts — page attempted dynamic import() of unbundled .ts file in built mode | **FIXED** — Added isDevMode check, skips import in built mode |
| V-002 | P3 | coverage-test.html | 3 interactive elements without data-testid (calendar nav buttons, ARIA combobox) | **Accepted** — tests locator fallback strategy |
| V-003 | P3 | demo.html | 0 data-testid elements, uses only id attributes | **Accepted** — tests id-based locator strategy |
| V-004 | P3 | validation.html | 0 data-testid elements | **Accepted** — tests id-based locator strategy |
| V-005 | P3 | test-harness.html | 0 data-testid elements | **Accepted** — tests id-based locator strategy |

### Extension Runtime Limitations (Browser Tools)

The following capabilities CANNOT be exercised by browser tools:
1. Content script injection (chrome.scripting.executeScript)
2. Chrome storage API (chrome.storage.local)
3. Chrome runtime messaging (chrome.runtime.sendMessage)
4. Content script event listeners (in content script context)
5. Manifest-based content script registration
6. Side panel rendering (chrome.sidePanel API)
7. IRExecutor tab management (chrome.tabs.create, chrome.tabs.remove)
8. Executor content script message handling (EXECUTE_STEP, RESOLVE_LOCATOR)
9. Cross-origin iframe event capture
10. Shadow DOM event retargeting in content script context

### Compensation Strategy

Integration tests (tests/foundation-validation.test.ts, 31 tests) simulate the exact
event sequences the deterministic recorder would produce from these test pages, then
run them through the real pipeline code:
- RecordingSession → detectInteractions (V1) → detectInteractionsV2 (V2) → mergeV1V2
- adaptToDomainEntities → runPipeline (recognition + enrichment)
- buildIRPlan → IR steps with locators and assertions

### Validation Results

| Page | DOM Structure | Interactive Elements | Console Errors | Pipeline Integration |
|------|---------------|---------------------|----------------|---------------------|
| coverage-test.html | 87 data-testid, 16 sections | PASS | favicon only | PASS (Workflow A, C, D) |
| demo.html | 27 interactive, 0 testid | PASS | 0 errors | PASS (Workflow B) |
| validation.html | 20 interactive, 0 testid | PASS | Fixed | PASS (Workflow E) |
| test-harness.html | 35 interactive, 0 testid | PASS | 0 errors | PASS |

### Test Count Summary
- New integration tests: 31 (tests/foundation-validation.test.ts)
- Full suite: 2911 tests (119 files) — all passing
- Build: succeeds in 1.03s
