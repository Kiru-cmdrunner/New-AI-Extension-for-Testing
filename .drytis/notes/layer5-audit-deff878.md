# Layer 5 — Generation / IR Bridge / Playwright Generation Audit (deff878)

Audit performed exclusively against `/workspace/tmp/deff878-audit` at commit deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8.

## Intended Behavior

The Generation Layer compiles `ComponentInteraction[]` (recording pipeline output) into a framework-neutral `ExecutionIRPlan`, which the Playwright adapter renders into complete, runnable `.spec.ts` test files.

**Two parallel generation paths exist:**
1. **Active path:** `ir-bridge.ts` (`build()` function) — takes `ComponentInteraction[]` directly from recording. Used by `service-worker.ts`.
2. **Inactive path:** `domain/execution-ir/generator.ts` (`DefaultIRGenerator`) — takes `TestCaseVersion` + `Element[]` domain entities for future ATC-based generation. NOT called by the recording pipeline.

**Active pipeline:**
```
stopRecording()
  → normalizeWorkflow (subsumption filter, GESTURE_WINDOW_MS=500ms)
  → filterProductionInteractions (removes no-ops, abandoned, noise)
  → buildIRPlan({ interactions, recordingContext, testCaseName })
    → NOISE_TYPES filter (removes Scroll + Unclassified)
    → INTERACTION_TO_IR_ACTION mapping (12 types → IRAction)
    → resolveLocatorsForIR (extractCandidatesFromIdentity → rankLocatorCandidates)
    → resolveElementTarget (elementId, elementName, resolvedLocators)
    → extractInputValue (metadata → IRInput)
    → generateDescription (per-type template)
    → deriveAssertions (always returns [])
    → applyReadabilityRules (Or-1: merge consecutive CLICK on same element)
    → deriveTags (URL path segment)
    → ExecutionIRPlan
  → PlaywrightCodeGenerator.generate(irPlan, config)
    → renderTestFile (flat or POM pattern)
    → project files (package.json, playwright.config.ts, tsconfig.json, .gitignore, *.spec.ts)
```

## Actual Behavior

### IR Bridge (ir-bridge.ts, 432 LOC)

**Input:** `GenerationInput { interactions: ComponentInteraction[], recordingContext: {startUrl, title}, testCaseName, enrichment? }`

**enrichment is ALWAYS undefined in production** — `service-worker.ts` line 316-323 calls `buildIRPlan()` without the `enrichment` field. The `GenerationInput` type marks it optional. All enrichment-dependent features are dormant:
- `businessLabels` → falls through to `getElementDisplayName` (generic name)
- `elementAssertions` → `deriveAssertions()` always returns `[]`
- `surfaceTags` → only URL path segment used as tag

**Interaction → IRAction mapping (14 types):**
| InteractionType | IRAction | Notes |
|-----------------|----------|-------|
| Click | CLICK | |
| TextEntry | FILL | |
| Dropdown | SELECT | |
| Checkbox | TOGGLE | check/uncheck via input boolean |
| RadioButton | SELECT | selectOption() |
| DatePicker | SELECT_DATE | fill() — no native date picker API |
| Hover | HOVER | |
| Link | CLICK | |
| FileUpload | FILL | **BUG: should be setInputFiles()** |
| Slider | FILL | Works for native range input |
| ColorInput | FILL | Problematic — color picker is native dialog |
| Tab | CLICK | |
| Scroll | CLICK | **Filtered as NOISE — never reaches generation** |
| Navigation | NAVIGATE | page.goto() |
| Unclassified | CLICK | **Filtered as NOISE — never reaches generation** |

**NOISE_TYPES:** `{ Scroll, Unclassified }` — both are silently removed from the IR plan. This means EVERY Unclassified interaction (clicks on elements that didn't match any definition) is dropped from generated tests.

### Locator Ranking (locator-ranking.ts, 319 LOC)

5-category priority: BUSINESS (0.90-0.95) → ACCESSIBILITY (0.80) → STABLE_TECHNICAL (0.72-0.75) → CONTENT (0.62-0.65) → STRUCTURAL (0.35-0.40).

**Candidate extraction from ElementIdentity (11 possible):**
1. testId → TEST_ID (BUSINESS)
2. dataCy → TEST_ID (BUSINESS)
3. dataQa → TEST_ID (BUSINESS)
4. ariaLabel → ACCESSIBLE_NAME (ACCESSIBILITY)
5. ariaLabelledBy → ACCESSIBLE_NAME (ACCESSIBILITY)
6. stableId → CSS `#id` (STABLE_TECHNICAL)
7. name → LABEL (STABLE_TECHNICAL)
8. accessibleName → ACCESSIBLE_NAME (CONTENT)
9. placeholder → LABEL (CONTENT)
10. cssSelector → CSS (STRUCTURAL)
11. xPath → XPATH (STRUCTURAL)

**NEVER produces:** ROLE or TEXT locator types. The locator-renderer has handlers for these but they are unreachable from the recording pipeline.

**Auto-generated ID detection:** 16 regex patterns (React `:r\d+:`, MUI `mui-*`, Angular `ng-*`, styled-components `css-*`, etc.). Filters these from CSS `#id` candidates.

**CSS-in-JS class detection:** Filters classes matching `/\.(?:css|sc|emotion|styled|react|__)[a-zA-Z0-9_-]{4,}/`.

**Max locators per element:** 3 (top-N after ranking).

### Playwright Rendering (adapters/playwright/, 6 files, ~1,750 LOC)

**locator-renderer.ts:** Maps ResolvedLocator → Playwright expression. Priority-1 locator only. ROLE → `getByRole()`, ACCESSIBLE_NAME → `getByLabel()`, TEST_ID → `getByTestId()`, LABEL → `getByLabel()`, CSS → `locator()`, XPATH → `locator('xpath=...')`.

**action-renderer.ts:** Maps IRAction → Playwright method call. CLICK → `.click()`, FILL → `.fill()`, SELECT → `.selectOption()`, TOGGLE → `.check()/.uncheck()/.click()`, HOVER → `.hover()`, NAVIGATE → `page.goto()`.

**assertion-renderer.ts:** Maps IRAssertion → `expect()` call. Comprehensive matrix (VISIBILITY, PRESENCE, TEXT_MATCH, ATTRIBUTE_MATCH, COUNT, EQUALITY, URL_MATCH, CUSTOM). HARD/SOFT severity. All assertion rendering is unreachable in practice since `deriveAssertions()` always returns `[]`.

**test-function-renderer.ts:** Produces complete `.spec.ts` file. Flat and POM patterns. Each step → comment + action line + assertion lines. `formatTestName` adds "should complete X successfully".

**page-object-renderer.ts:** Generates POM files for `page-object` pattern. Groups elements by `pageOrComponent` (always `'main'` from ir-bridge).

**project-generator.ts:** Produces complete project: package.json, playwright.config.ts, tsconfig.json, .gitignore, test files.

### Workflow Normalizer (workflow-normalizer.ts, 98 LOC)

View filter: removes Unclassified interactions subsumed by recognized interactions on same element within GESTURE_WINDOW_MS (500ms). Uses `elementKey()` for element comparison.

### Output Adapter (output-adapter.ts, 339 LOC)

Maps ComponentInteraction → exported JSON format. `isProductionInteraction` filters no-ops (userTyped=false, noOpSelection=true, hasDelta=false, userAdjusted=false, meaningful=false). `filterProductionInteractions` applies this filter.

## Correctness Analysis

### What Works Well

1. **Locator ranking is well-designed** — 5-category hierarchy, auto-generated ID detection, CSS-in-JS filtering, top-3 selection. Sound for stable locators.
2. **Action renderer is comprehensive** — all 10 IRAction types handled, timeout options, escapeString for safe code generation.
3. **Assertion renderer is thorough** — 8 ValidationTypes × 4+ comparisons, HARD/SOFT severity, custom fallback.
4. **Playwright best practices in config** — fullyParallel, CI-aware retries, trace on first retry, correct browser mapping.
5. **String escaping is consistent** — same escapeString function across all 4 renderers. Handles backslash, single quote, newline, tab, line/paragraph separators.
6. **POM pattern is well-structured** — groups by page, generates getter + method per element-action pair.
7. **Graceful degradation** — enrichment absent → valid plan (INV-GEN-7).

### Critical Bugs

## Technical Debt / Issues

### 🔴 CRITICAL

**5-C-1: Or-1 readability rule merges ALL consecutive CLICK steps on different elements**
- `applyReadabilityRules` (ir-bridge.ts line 275-305) merges consecutive CLICK steps when `current.target.elementId === next.target.elementId`.
- Per Layer 0 audit (C-3): `elementId` is always `''` (hardcoded empty string in identity-extractor.ts).
- Therefore `'' === ''` is ALWAYS TRUE for any two consecutive CLICK actions.
- Interaction types mapping to CLICK: Click, Link, Tab. (Scroll and Unclassified also map to CLICK but are filtered as NOISE.)
- **Impact:** If a user clicks Submit, then clicks Cancel (two different buttons), both produce CLICK actions. Or-1 merges them: Cancel click is SILENTLY DROPPED from the generated test. The generated test only clicks Submit.
- **Only safe when consecutive CLICKs are on the SAME element** (the intended use case for dedup). But since elementId is always '', it can't distinguish same from different elements.

**5-C-2: Unclassified interactions are completely dropped from generated tests**
- `NOISE_TYPES = { Scroll, Unclassified }` (ir-bridge.ts line 79-82).
- ALL Unclassified interactions are filtered out before IR plan construction.
- Per Layer 4 audit: many legitimate user actions (Add to Cart, checkbox toggles without behavioral evidence) are Unclassified.
- Per the Projection Engine: Unclassified interactions represent REAL user actions (discrete events that no definition recognized). The comments say "every deliberate physical action preserved."
- **Impact:** Clicks on custom interactive elements (no BUTTON tag, no ARIA role, no interactive class) are dropped from generated tests. The test silently omits real user actions.

**5-C-3: FileUpload generates `.fill()` instead of `.setInputFiles()`**
- `INTERACTION_TO_IR_ACTION.FileUpload = IRAction.FILL` (ir-bridge.ts line 68).
- action-renderer FILL → `${el}.fill('value')`.
- Playwright's `fill()` does not work on `<input type="file">`. The correct method is `setInputFiles(path)`.
- **Impact:** Every generated test with a file upload step produces invalid Playwright code that will throw at runtime.

**5-C-4: deriveAssertions() always returns empty array — no assertions ever generated**
- `deriveAssertions` (ir-bridge.ts line 252-263) always returns `[]`.
- Comment: "When enrichment.elementAssertions is populated... For now, enrichment is always absent."
- Since enrichment is NEVER passed from service-worker.ts, assertions are permanently empty.
- The entire assertion-renderer.ts (397 LOC) is dead code in production.
- **Impact:** Generated tests have zero assertions. They only perform actions and never verify outcomes.

**5-C-5: No capability information reaches the generation layer**
- `buildIRPlan()` receives `enrichment?: GenerationEnrichment` which is ALWAYS undefined.
- No `businessLabels`, no `elementAssertions`, no `surfaceTags` from capabilities.
- `getElementDisplayName` falls back to `trigger.accessibleName || trigger.ariaLabel || trigger.tag`.
- The 2,722 LOC capability engine (Layer 4) and the 521 LOC enrichment layer (Layer 3) produce zero input to generation.
- **Impact:** Generated test steps have generic descriptions ("Click the Submit button") not capability-informed descriptions.

**5-C-6: elementId always '' — IR target identity is unreliable**
- `resolveElementTarget` sets `elementId: identity.elementId` → always `''`.
- Used for Or-1 merge (see 5-C-1), POM element grouping, and assertion target matching.
- POM renderer groups by `pageOrComponent` (always `'main'`) and elementName, not elementId — so POM grouping is unaffected by this specific bug, but any future feature relying on elementId will fail.

### 🟠 HIGH

**5-H-1: ColorInput generates `.fill()` which may not work with native color picker**
- Color input uses OS-native color picker dialog. `fill()` may work in some browsers for `<input type="color">` but behavior varies.
- **Impact:** Generated color input steps may fail depending on browser/OS.

**5-H-2: DatePicker generates `.fill()` — custom date pickers need calendar navigation**
- `SELECT_DATE → renderSelectDate → ${el}.fill('date')`.
- Comment acknowledges: "Custom date pickers are an adapter refinement concern."
- For native `<input type="date">`: fill() works. For custom calendar widgets (most enterprise apps): fill() won't work — need to navigate calendar cells.
- **Impact:** Most date pickers in real applications are custom. Generated test steps will fail.

**5-H-3: No DragDrop support in the generation bridge**
- `INTERACTION_TO_IR_ACTION` has no DragDrop entry.
- Layer 0 doesn't capture drag events, so no DragDrop interaction type exists.
- TD-8 from post-baseline crash investigations: "DragDrop generation bridge missing case."
- **Impact:** Drag-and-drop interactions are invisible to the entire pipeline.

**5-H-4: Dropdown SELECT renders `.selectOption()` which only works for native `<select>`**
- Custom dropdowns (div-based, OXD, MUI Autocomplete) are classified as Dropdown by the runtime.
- `.selectOption()` throws on non-`<select>` elements in Playwright.
- **Impact:** Custom dropdown interactions produce invalid Playwright code.

**5-H-5: RadioButton generates `.selectOption()` which is wrong for radio buttons**
- `INTERACTION_TO_IR_ACTION.RadioButton = IRAction.SELECT`.
- action-renderer SELECT → `.selectOption('value')`.
- Playwright's `.selectOption()` is for `<select>` elements. Radio buttons should use `.check()`.
- **Impact:** Every radio button interaction generates invalid Playwright code.

**5-H-6: Hover generates `.hover()` — may not trigger CSS :hover-only menus**
- Playwright's `.hover()` performs a real mouse hover, which should trigger `:hover` CSS.
- But JS-driven hover menus may require additional waiting or specific mouse movement.
- **Impact:** Some hover interactions may not reveal their target menus in generated tests.

**5-H-7: elementName fallback to tag name produces poor descriptions**
- `resolveElementTarget`: `elementName: identity.accessibleName || identity.ariaLabel || identity.tag`.
- If an element has no accessible name or aria-label, elementName is the tag (e.g., "BUTTON", "DIV").
- Generated comments: "// Click the BUTTON", "// Fill 'test' in the DIV".
- POM method names: `clickBUTTON()`, `fillDIV()`.
- **Impact:** Poor readability and potentially invalid method names.

**5-H-8: Two parallel generation paths — generator.ts (ATC) vs ir-bridge.ts (recording)**
- `domain/execution-ir/generator.ts` (388 LOC) maps `StepAction → IRAction`, resolves domain Element entities.
- `generation/ir-bridge.ts` (432 LOC) maps `InteractionType → IRAction`, resolves from ElementIdentity.
- Both produce `ExecutionIRPlan`. The ATC path is not connected to the recording pipeline.
- **Impact:** Maintenance burden. Duplicated mapping logic. Risk of divergence.

### 🟡 MEDIUM

**5-M-1: Scroll interactions produce no test steps**
- Scroll is in NOISE_TYPES. Every scroll interaction is dropped.
- For tests that need to scroll to reach elements (lazy loading, infinite scroll), there is no generated step.
- **Impact:** Generated tests can't reproduce scroll-dependent interactions.

**5-M-2: Tags are limited to URL path segment only**
- `deriveTags` extracts first path segment of startUrl. Max 5 tags.
- No other categorization (capability-based, interaction-type-based, etc.).
- **Impact:** Tests are poorly categorized for filtering/organization.

**5-M-3: testCaseId and testCaseVersionId use Date.now() — non-deterministic**
- `tc-${Date.now()}` and `tcv-${Date.now()}`.
- Same input → different IDs on each compilation. Violates INV-GEN-1 (determinism).
- **Impact:** ID-based caching/serving is unreliable. Two compilations of the same recording produce different IDs.

**5-M-4: environment.browser hardcoded to 'chrome'**
- `environment: { baseUrl: ..., browser: 'chrome', viewport: { width: 1280, height: 720 } }`.
- No detection of actual browser during recording.
- Viewport is hardcoded 1280x720 regardless of actual recording viewport.
- **Impact:** Generated tests assume Chrome at a specific viewport.

**5-M-5: ACCESSIBLE_NAME locator always renders as getByLabel()**
- locator-renderer: `renderAccessibleNameLocator → getByLabel('value')`.
- Comment: "V1: We always use getByLabel for ACCESSIBLE_NAME."
- Accessible names from aria-label should use `getByLabel()`, but accessible names from other sources (innerText, title) may be better matched by `getByText()` or `getByRole()`.
- ariaLabelledBy renders the ID reference value, not the actual label text.
- **Impact:** Some locators won't match elements in the generated test.

**5-M-6: LABEL locator renders getByLabel() for placeholder values**
- Placeholder values extracted as LABEL type → `getByLabel('placeholder text')`.
- Playwright's `getByLabel()` matches associated `<label>` elements, not placeholders.
- Should be `getByPlaceholder()` for placeholder-sourced values.
- **Impact:** Placeholder-based locators won't match elements.

**5-M-7: resolveElementTarget sets pageOrComponent to always 'main'**
- `pageOrComponent: 'main'` hardcoded.
- POM renderer groups by pageOrComponent → all elements go into one "main" page object.
- No page detection or SPA route-based grouping.
- **Impact:** POM tests have one giant page object instead of per-page classes.

**5-M-8: formatTestName always uses "should complete X successfully"**
- No indication of what the test does beyond "completing" the flow.
- No capability-based naming (e.g., "should filter products by category").
- **Impact:** Test names are generic and uninformative.

**5-M-9: WorkflowNormalizer GESTURE_WINDOW_MS is 500ms — may miss slow events**
- mousedown→click gap is ~80ms normally. 500ms is 6x safety margin.
- But SW processing delays (MV3 event loop) could push this beyond 500ms under load.
- If mousedown Unclassified is NOT subsumed, it appears as a separate Unclassified in the pipeline.
- Since Unclassified is in NOISE_TYPES, it's dropped anyway — so this is a non-issue for generation, but could affect side-panel display.

**5-M-10: POM pattern element dedup relies on elementId**
- `elementTargetLookup` maps `element.elementId → target expression`.
- All elements have elementId `''`. Multiple elements with `''` collide in the Map.
- The LAST element wins in the Map.
- **Impact:** POM mode produces incorrect element references when multiple elements exist.

### 🟢 LOW

**5-L-1: Slugify uses simple regex — may produce empty filenames**
- If title is all non-alphanumeric (e.g., "!!!"), slug is empty string → `tests/.spec.ts`.
- No guard against empty slug.

**5-L-2: escapeString duplicated across 4 files**
- locator-renderer.ts, action-renderer.ts, assertion-renderer.ts, test-function-renderer.ts all have identical escapeString functions.
- Should be a shared utility.

**5-L-3: PLAYWRIGHT_VERSION hardcoded to '^1.52.0'**
- No mechanism to update the version. Tests may use outdated Playwright API.
- Acceptable for V1.

**5-L-4: describe block name equals test name**
- `test.describe('Login Flow')` + `test('should complete login flow successfully')`.
- The describe name is the raw title; the test name is formatted.
- Redundant but not harmful.

**5-L-5: generateDescription has no Hover case returning template**
- Hover is handled (line 156-157): `return 'Hover over the ${name}'`. Correct.

**5-L-6: WAIT_FOR_ELEMENT action is correctly skipped**
- Both test-function-renderer and action-renderer skip WAIT_FOR_ELEMENT.
- Comment: "Playwright auto-waits on locators."
- Correct by design.

**5-L-7: GENERATED_FILES storage key holds the full project**
- All generated files (package.json, configs, spec files) are serialized to chrome.storage.local.
- Large recordings may hit storage limits.

**5-L-8: domain/execution-ir/generator.ts imports from domain entities**
- `ApprovedTestCase`, `TestCaseVersion`, `Element`, `Step`, `Validation`.
- These are domain entities for the future ATC path.
- Not used by the recording pipeline but tested (609 LOC of tests).

## Test Coverage

Strong test suite: 5,268 LOC across 15 test files.

| Area | Test File | LOC |
|------|-----------|-----|
| IR Bridge | ir-bridge.test.ts + ir-bridge-input.test.ts | 753 |
| Locator ranking | locator-ranking.test.ts | 306 |
| Locator resolver | locator-resolver.test.ts | 272 |
| Action renderer | action-renderer.test.ts | 495 |
| Assertion renderer | assertion-renderer.test.ts | 360 |
| Locator renderer | locator-renderer.test.ts | 356 |
| Page object renderer | page-object-renderer.test.ts | 423 |
| Project generator | project-generator.test.ts | 525 |
| Reference IR plans | reference-ir-plans.test.ts | 193 |
| Test function renderer | test-function-renderer.test.ts | 338 |
| Domain generator (ATC) | generator.test.ts | 609 |
| Staleness | staleness.test.ts | 296 |
| Types | types.test.ts | 59 |
| Output adapter | output-adapter.test.ts | 283 |

**Gaps:**
- No test for Or-1 merge with empty elementId (5-C-1 scenario).
- No test for FileUpload generating `.fill()` (5-C-3).
- No test for assertion generation being empty in production (5-C-4).
- No test for enrichment integration (since enrichment is never passed).
- No test for Dropdown/RadioButton producing wrong Playwright methods (5-H-4, 5-H-5).
- No test for POM mode with multiple elements sharing elementId `''` (5-M-10).

## Summary

The Generation Layer is **well-structured** with clean separation (IR Bridge → locator ranking → Playwright renderers), comprehensive rendering for all action/assertion types, and good test coverage. The IR types and adapter contracts are sound and framework-neutral.

However, it has six critical issues that make generated tests **incorrect or incomplete**:

1. **Or-1 merge drops legitimate clicks** (5-C-1) — elementId always `''` causes all consecutive CLICKs to merge
2. **Unclassified interactions dropped** (5-C-2) — real user actions silently removed
3. **FileUpload wrong API** (5-C-3) — `.fill()` instead of `.setInputFiles()`
4. **Zero assertions** (5-C-4) — assertion renderer is 397 LOC of dead code
5. **No capability/enrichment input** (5-C-5) — generic descriptions only
6. **RadioButton wrong API** (5-H-5) — `.selectOption()` instead of `.check()`

Plus two more generation bugs: Dropdown `.selectOption()` on non-`<select>` (5-H-4) and DatePicker `.fill()` on custom calendars (5-H-2).
