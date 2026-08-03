# Phase 12 — Execution Engine Architecture

## 1. Objective

Execute an `ExecutionIRPlan` against a live browser tab, verify assertions pass,
self-heal stale locators at runtime, and report step-by-step results.

This phase implements the `IRExecutor` interface that already exists in the
codebase (defined in `ir-executor.ts`) but has zero implementations.

---

## 2. Execution Architecture

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                    Service Worker (Orchestrator)                  │
 │                                                                  │
 │   IRExecutorImpl.execute(plan, options)                          │
 │     │                                                            │
 │     ├─ 1. Pre-execution staleness check (checkStaleness)          │
 │     ├─ 2. Open/navigate target tab                               │
 │     ├─ 3. For each IRStep (sequential):                          │
 │     │     ├─ resolveLocator(step)  → try each locator in order   │
 │     │     ├─ if found: executeAction(step) via content script    │
 │     │     ├─ if NOT found: runtimeHeal(step) → retry            │
 │     │     ├─ evaluateAssertions(step) via content script         │
 │     │     ├─ collect screenshot (on failure)                     │
 │     │     └─ emit onStepComplete callback                        │
 │     ├─ 4. Aggregate results → IRExecutionResult                  │
 │     └─ 5. Persist ExecutionRun to Repository                     │
 └──────────┬──────────────────────┬────────────────────────────────┘
            │                      │
            ▼                      ▼
 ┌──────────────────┐   ┌──────────────────────────┐
 │  Content Script   │   │  Repository (Dexie)       │
 │  (Action Executor)│   │                           │
 │                  │   │  ElementRepository         │
 │  resolveLocator()│   │  ExecutionRunRepository    │
 │  executeAction() │   │  (new — persists runs)     │
 │  evaluateAssert()│   │                           │
 │  extractDomCtx() │   │  healElementAndPersist()   │
 └──────────────────┘   └──────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Existing? |
|-----------|---------------|-----------|
| **IRExecutorImpl** | Orchestrates plan execution, manages tab lifecycle, handles step sequencing, retry, healing | New — implements existing `IRExecutor` interface |
| **Content Script (executor)** | Runs on-page: resolves locators against live DOM, performs actions, evaluates assertions | New content script (separate from recorder) |
| **LocatorResolver** | Converts `ResolvedLocator[]` → a live DOM element, trying each strategy in priority order | New (shared between executor and healing) |
| **AssertionEvaluator** | Evaluates `IRAssertion[]` against live DOM state | New (lives in content script) |
| **RuntimeHealer** | When a locator fails, inspects the live DOM, produces `RankedLocator[]`, calls `healElementAndPersist()` | New — thin wrapper around existing `healElementAndPersist()` |
| **ExecutionRunRepository** | Persists execution runs and step results | New Repository table |

---

## 3. Browser Lifecycle Management

The execution engine drives the **active tab** in the user's browser.

```
1. User clicks "Run Test" in the side panel (on the IR Plan view)
2. Service worker sends EXECUTE_PLAN message to itself
3. IRExecutorImpl:
   a. chrome.tabs.query({ active: true, currentWindow: true }) → target tab
   b. chrome.scripting.executeScript → inject executor content script
   c. chrome.tabs.update(tabId, { url: plan.environment.baseUrl }) → navigate
   d. Wait for page load (chrome.tabs.onUpdated → status: 'complete')
4. Execute steps sequentially
5. On completion: keep tab open (user closes manually)
   On failure: keep tab open, capture screenshot
```

**Why the active tab, not a new tab?**
The user already has their app open. Executing in-place is the natural
workflow — record once, then replay immediately to verify. A new tab would
require session/cookie transfer.

**Content script injection:**
The executor content script is injected on-demand via `chrome.scripting.executeScript`,
not registered in the manifest. This separates it from the recorder content script.
They never run simultaneously — recording and execution are mutually exclusive.

---

## 4. Step Execution Flow

For each `IRStep` in the plan:

```
 ┌──────────────────────────────────────────────────┐
 │                  IRStep Execution                 │
 │                                                   │
 │  1. emit onStepStart(step)                        │
 │                                                   │
 │  2. Resolve target element                        │
 │     ├─ If action is NAVIGATE/WAIT → no element    │
 │     └─ If action targets an element:              │
 │        ├─ Send RESOLVE_LOCATOR message to content  │
 │        │   script with step.target.resolvedLocators│
 │        ├─ Content script tries each locator:       │
 │        │   TEST_ID → [data-testid="X"]             │
 │        │   ACCESSIBLE_NAME → role + name           │
 │        │   CSS → querySelector                      │
 │        │   LABEL → label[for] or aria-label        │
 │        │   XPATH → evaluate                        │
 │        │   ROLE → role attribute                    │
 │        │   TEXT → text content match               │
 │        ├─ Returns element found? or null            │
 │        └─ If null → RUNTIME HEAL (see §6)           │
 │                                                   │
 │  3. Execute action                                 │
 │     ├─ CLICK → element.click()                     │
 │     ├─ FILL → element.value = input; dispatch      │
 │     │   input + change events                      │
 │     ├─ SELECT → element.value = input; dispatch     │
 │     │   change event                               │
 │     ├─ SELECT_DATE → date-specific fill             │
 │     ├─ TOGGLE → element.checked = input             │
 │     ├─ HOVER → element.dispatchEvent(               │
 │        new MouseEvent('mouseover'))                 │
 │     ├─ NAVIGATE → chrome.tabs.update(url)           │
 │     ├─ VERIFY → no action, assertions only          │
 │     ├─ WAIT → setTimeout(duration)                  │
 │     └─ WAIT_FOR_ELEMENT → waitForSelector(timeout)  │
 │                                                   │
 │  4. Evaluate assertions (see §7)                   │
 │                                                   │
 │  5. Collect result                                 │
 │     ├─ stepResult.status = 'passed' | 'failed'     │
 │     ├─ stepResult.durationMs                       │
 │     ├─ stepResult.assertionResults                 │
 │     └─ On failure: screenshot via chrome.tabs       │
 │                                                   │
 │  6. emit onStepComplete(step, stepResult)          │
 │                                                   │
 │  7. Honor step.executionParameters.retryCount      │
 │     └─ If failed AND retries remaining:             │
 │        wait retryDelayMs → go to step 2             │
 └──────────────────────────────────────────────────┘
```

### Wait Strategy (from `ExecutionParameters.waitStrategy`)

Before resolving the element, the content script waits:
- `none` → no wait
- `present` → wait for element in DOM (MutationObserver)
- `visible` → wait for element visible (MutationObserver + computed style)
- `stable` → wait for element visible + not animating

Default: `visible` with `timeoutMs: 30_000`.

---

## 5. Execution State Management

```
interface ExecutionState {
  readonly runId: string;
  readonly plan: ExecutionIRPlan;
  readonly tabId: number;
  readonly status: 'running' | 'passed' | 'failed' | 'error' | 'aborted';
  readonly currentStepIndex: number;
  readonly stepResults: Map<string, IRStepResult>;
  readonly startedAt: string;
}
```

State lives in the service worker (not persisted during execution — only on completion).
The side panel receives live updates via the `onStepComplete` callback, which
forwards to `chrome.storage.local` for the UI to render.

**Aborting:** A `ABORT_EXECUTION` message sets status to 'aborted' and stops
the step loop. The current step finishes its current attempt.

---

## 6. Runtime Self-Healing Integration

This is the key integration point with Phase 11.

```
 ┌──────────────────────────────────────────────────────┐
 │              Runtime Healing Flow                      │
 │                                                       │
 │  Step target resolves to null (element not found)     │
 │    │                                                  │
 │    ├─ 1. Content script: extractDomContext()           │
 │    │     Reads live DOM attributes near the failure    │
 │    │     point: accessibleName, role, tag, testId,     │
 │    │     aria-label, className, cssSelector            │
 │    │     Returns partial ElementIdentity               │
 │    │                                                  │
 │    ├─ 2. Service worker: rankLocatorCandidates()       │
 │    │     Convert ElementIdentity → RankedLocator[]     │
 │    │     via extractCandidatesFromIdentity()           │
 │    │                                                  │
 │    ├─ 3. Service worker: healElementAndPersist()       │
 │    │     Input: {                                      │
 │    │       elementId: step.target.elementId,            │
 │    │       newStrategies: RankedLocator[],             │
 │    │       context: {                                  │
 │    │         sourceSessionId: runId,                   │
 │    │         reason: 'execution-locator-failure',      │
 │    │         proposedBy: 'ir-executor',                │
 │    │       }                                           │
 │    │     }                                             │
 │    │     → ElementRepository.update() + healHistory    │
 │    │                                                  │
 │    ├─ 4. Retry step with HEALED locators               │
 │    │     Use the healed Element's updated              │
 │    │     locatorStrategies (not the stale IR snapshot) │
 │    │                                                  │
 │    ├─ 5a. If retry succeeds:                           │
 │    │     Continue execution. Element is healed.        │
 │    │     Post-execution: regenerate IR from healed     │
 │    │     Repository (stale IR snapshot replaced).      │
 │    │                                                  │
 │    └─ 5b. If retry fails:                              │
 │         Mark step as 'failed'. Continue or abort       │
 │         depending on assertion severity.               │
 └──────────────────────────────────────────────────────┘
```

**Critical design decision:** During healing, we heal the **Repository Element**
(via `healElementAndPersist`), NOT the IR snapshot. The IR plan carries
`ResolvedLocator[]` which are immutable snapshots — we don't mutate them.
Instead:
1. Heal the Element in the Repository (adds new locators).
2. Read the healed Element's `locatorStrategies` from the Repository.
3. Try those fresh locators against the live DOM.
4. After the full run completes, the cached IR artifact is marked stale
   (via `checkStaleness()` — `element.updatedAt > artifact.generatedAt`).
5. Next time the user views/runs the test, the IR is regenerated from the
   healed Repository, picking up the new locators.

**Why not mutate the IR in-flight?**
The IR plan is a derived artifact — a snapshot at generation time. Mutating
it during execution would create a divergence between the stored IR and the
Repository. The Repository is the source of truth; the IR is regenerated
from it. Healing updates the source of truth.

**Per-run override map:**
During execution, the executor maintains a lightweight in-memory override
map: `Map<string, ResolvedLocator[]>` keyed by `elementId`. Before each
step's locator resolution, the executor checks this map first — if the
element was healed earlier in the same run, it uses the fresh locators
immediately without re-healing.

**Why `elementId` keying (not `stepId`):** Multiple steps in the same plan
may target the same element (e.g., "fill email field" in step 2 and "verify
email field value" in step 4). Keying by `elementId` ensures all subsequent
references to a healed element within the same run use the fresh locators
immediately — without triggering another heal. A `stepId` key would require
re-healing for each step that references the same element.

Three layers of locators, each with a clear scope:

| Layer | What it holds | Scope |
|-------|---------------|-------|
| IR plan (`ResolvedLocator[]`) | Immutable snapshot from generation time | Persisted, never mutated |
| Override map (`Map<elementId, LocatorStrategy[]>`) | Healed locators from this run | In-memory, per-execution, discarded after run |
| Repository Element (`locatorStrategies`) | Live, cumulative locators (additive heal history) | Persistent source of truth |

After the run: override map discarded. Repository has healed locators with
bumped `updatedAt`. On next run, `checkStaleness()` detects staleness → IR
regenerated → fresh IR carries new locators → override map starts empty.

**Heal limit:** One heal attempt per step per execution. If the healed
locators also fail, the step fails. This prevents infinite healing loops.

---

## 7. Assertion Execution

Assertions evaluate AFTER the step action completes.

```
IRAssertion {
  type: ValidationType,          // presence | visibility | textMatch | ...
  comparison: ValidationComparison, // equals | contains | matches | ...
  expectedValue: unknown,
  severity: ValidationSeverity,  // hard | soft
  target: ResolvedTarget,        // element or url
  property: string | null,       // "text" | "value" | "visible" | "count"
}
```

The content script evaluates each assertion:

| Type | Property | How Evaluated |
|------|----------|---------------|
| presence | — | `document.contains(element)` |
| visibility | — | `getComputedStyle(element).display !== 'none'` + `offsetParent !== null` |
| textMatch | text | `element.textContent` compared via comparison operator |
| attributeMatch | attributeName | `element.getAttribute(name)` compared |
| count | — | `document.querySelectorAll(selector).length` compared |
| equality | property | `element[property]` compared |
| urlMatch | — | `window.location.href` compared |
| custom | — | Future: user-provided evaluation function |

**Severity semantics:**
- `HARD` failure → step fails, execution stops
- `SOFT` failure → recorded in results but execution continues

---

## 8. Logging, Screenshots, and Reporting

### Screenshots
On step failure: `chrome.tabs.captureVisibleTab()` → base64 PNG.
Stored in the `ExecutionRun.stepResults[].screenshot` field.

### Logging
Each step result carries:
- `status`: passed | failed | error | skipped
- `durationMs`: execution time
- `assertionResults[]`: per-assertion pass/fail + actual vs expected
- `error`: { message, type, stack } on failure
- `screenshot`: base64 PNG (failures only)
- `healed`: boolean (true if this step was healed during execution)

### Final Report
```
IRExecutionResult {
  status: 'passed' | 'failed' | 'error',
  stepResults: IRStepResult[],
  startedAt: string,
  completedAt: string,
  durationMs: number,
}
```

Persisted as an `ExecutionRun` in the Repository (see §10).

---

## 9. Retry and Error-Handling Strategy

### Step-level retry (from `ExecutionParameters`)
```
maxAttempts = 1 + step.executionParameters.retryCount  // default: 1
for attempt in 1..maxAttempts:
  try:
    resolve locator → execute action → evaluate assertions
    if all hard assertions pass: return 'passed'
    if hard assertion fails: throw StepFailedError
  catch StepFailedError:
    if attempt < maxAttempts: sleep(retryDelayMs)
    else: return 'failed'
```

### Execution-level error handling
| Error Type | Behavior |
|-----------|----------|
| Tab closed mid-execution | Status → 'error', stop execution |
| Content script injection fails | Status → 'error', stop execution |
| Navigation timeout | Step fails, retry if attempts remaining |
| Element not found (all locators fail) | Trigger healing → retry once |
| Element found but action throws | Step fails, retry if attempts remaining |
| Hard assertion fails | Step fails, execution stops |
| Soft assertion fails | Recorded, execution continues |

### Healing vs Retry
- **Retry** = try the SAME locators again (transient flakiness)
- **Healing** = get NEW locators from live DOM (structural change)

Healing happens once per step, BEFORE retry attempts are exhausted.
The sequence is: try → fail → heal → try healed → fail → retry original → ...

No — simpler: try → fail → heal → try healed. If healed attempt fails, step fails.
Healing replaces the first retry. Additional retries (if `retryCount > 0`) use
the healed locators.

---

## 10. Repository Interactions

### Pre-execution
- Load `ExecutionIRArtifact` by testCaseVersionId (if cached)
- Run `checkStaleness(artifact, referencedElements, generatorVersion)`
- If stale: regenerate IR from current Repository Elements
- If fresh: use cached IR as-is

### During execution
- Read `Element` by ID when healing (via `healElementAndPersist`)
- Update `Element` with healed locators (via `healElementAndPersist`)

### Post-execution
- Persist `ExecutionRun` (new entity, see §11)
- If elements were healed, the cached IR artifact is now stale
  (detected by `checkStaleness` on next access — `updatedAt` bumped)

---

## 11. New Domain Entities

### ExecutionRun

```typescript
export interface ExecutionRun {
  readonly id: string;
  readonly testCaseId: string;
  readonly testCaseVersionId: string;
  readonly status: 'passed' | 'failed' | 'error' | 'aborted';
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly stepResults: ExecutionStepResult[];
  readonly environment: {
    readonly baseUrl: string;
    readonly browser: string;
    readonly viewport: { width: number; height: number };
  };
  readonly healedElementIds: string[];  // elements healed during this run
}
```

```typescript
export interface ExecutionStepResult {
  readonly stepId: string;
  readonly stepOrder: number;
  readonly action: string;
  readonly description: string;
  readonly status: 'passed' | 'failed' | 'error' | 'skipped';
  readonly durationMs: number;
  readonly assertionResults: ExecutionAssertionResult[];
  readonly healed: boolean;
  readonly screenshot?: string;  // base64 PNG (failures only)
  readonly error?: { readonly message: string; readonly type: string };
}
```

```typescript
export interface ExecutionAssertionResult {
  readonly type: string;
  readonly comparison: string;
  readonly expectedValue: unknown;
  readonly actualValue: unknown;
  readonly passed: boolean;
  readonly severity: 'hard' | 'soft';
  readonly message: string;
}
```

### ExecutionRunRepository (new Repository interface)

```typescript
export interface ExecutionRunRepository {
  getById(id: string): Promise<ExecutionRun | undefined>;
  getByTestCaseVersion(versionId: string): Promise<ExecutionRun[]>;
  getByProject(projectId: string): Promise<ExecutionRun[]>;
  save(run: ExecutionRun): Promise<ExecutionRun>;
  delete(id: string): Promise<void>;
}
```

### Dexie schema change (DB_VERSION = 3)

```
executionRuns: 'id, testCaseVersionId, projectId'
```

---

## 12. IRStepResult mapping

The existing `IRStepResult` interface (from `ir-executor.ts`) maps directly
to the execution results:

| IRExecutor type | Execution Engine type |
|----------------|----------------------|
| `IRExecutionResult` | `ExecutionRun` (persisted) |
| `IRStepResult` | `ExecutionStepResult` (within ExecutionRun) |
| `IRAssertionResult` | `ExecutionAssertionResult` (within step result) |

The `IRExecutorImpl` returns `IRExecutionResult`. A separate mapping function
converts it to `ExecutionRun` for Repository persistence (adds run metadata).

---

## 13. Side Panel Integration

The side panel gains a **Run** button on the IR Plan view:

```
┌─────────────────────────────────────────┐
│  ▶ Execution Plan          [▶ Run Test] │
├─────────────────────────────────────────┤
│  ✓ 1. Navigate to /orders     (120ms)   │
│  ✓ 2. Fill "Order #" field    (340ms)   │
│  ✗ 3. Click "Submit"          (5000ms)  │
│        Element not found → healed       │
│        Retried with testId → passed     │
│        ⚠ Screenshot captured            │
│  ○ 4. Verify "Order created"            │
│  ○ 5. Verify URL contains /orders       │
├─────────────────────────────────────────┤
│  Result: 3/5 passed, 1 healed           │
│  Duration: 6.2s                         │
└─────────────────────────────────────────┘
```

---

## 14. Content Script: Executor

A new content script (`executor-content-script.ts`) injected on-demand.
It listens for `EXECUTE_STEP` messages and returns results.

```typescript
// Message types (added to AppMessage union)
| { type: 'EXECUTE_STEP'; step: IRStep }
| { type: 'RESOLVE_LOCATOR'; locators: ResolvedLocator[] }
| { type: 'EXTRACT_DOM_CONTEXT'; hint: Partial<ElementIdentity> }
| { type: 'EVALUATE_ASSERTIONS'; assertions: IRAssertion[] }

// Response types
| { type: 'STEP_RESULT'; result: ContentScriptStepResult }
| { type: 'LOCATOR_RESULT'; found: boolean; elementInfo?: ElementInfo }
| { type: 'DOM_CONTEXT'; identity: Partial<ElementIdentity> }
| { type: 'ASSERTION_RESULTS'; results: ContentScriptAssertionResult[] }
```

The content script is a self-contained module — it receives a serialized
step, executes it against the DOM, and returns a result. It has no
dependency on the recorder or any other module.

---

## 15. Milestone Breakdown

### Milestone 12.1 — Domain Layer: ExecutionRun entity + Repository
- ExecutionRun, ExecutionStepResult, ExecutionAssertionResult types
- ExecutionRunRepository interface
- Dexie schema v3 (executionRuns table)
- DexieExecutionRunRepository implementation
- Unit tests for entity creation + repository CRUD

### Milestone 12.2 — Content Script: Locator Resolver + Action Executor
- executor-content-script.ts (injected on-demand)
- LocatorResolver: tries each ResolvedLocator strategy against live DOM
- ActionExecutor: click, fill, select, toggle, hover, navigate, wait
- Message types for EXECUTE_STEP, RESOLVE_LOCATOR
- Unit tests for locator resolution + action execution (jsdom)

### Milestone 12.3 — Content Script: Assertion Evaluator
- evaluateAssertions() in the content script
- All 8 ValidationType handlers
- HARD vs SOFT severity handling
- Message type for EVALUATE_ASSERTIONS
- Unit tests for assertion evaluation (jsdom)

### Milestone 12.4 — IRExecutorImpl: Orchestrator + Step Loop
- IRExecutorImpl implementing IRExecutor interface
- Tab lifecycle (query, inject, navigate, wait for load)
- Step sequencing with retry (ExecutionParameters)
- Pre-execution staleness check
- Result aggregation → IRExecutionResult
- Integration tests with mock content script

### Milestone 12.5 — Runtime Healing Integration
- RuntimeHealer: wraps healElementAndPersist()
- extractDomContext from live DOM near failure point
- rankLocatorCandidates → healElementAndPersist → retry with healed locators
- Post-execution: IR staleness detection
- Integration tests for healing during execution

### Milestone 12.6 — Side Panel: Run UI + Live Results
- Run button on IR Plan view
- Live step-by-step progress rendering
- Per-step status, duration, healed indicator
- Failure screenshot display
- Final summary (passed/failed/healed counts)
- Execution history (from ExecutionRunRepository)

---

## 16. Key Design Decisions

1. **Content script for DOM operations** — the executor runs in the page's
   context via `chrome.scripting.executeScript`. This is the same pattern
   as the recorder, but in a separate, on-demand script.

2. **Repository is the healing source of truth** — IR snapshots are never
   mutated in-flight. Healing updates the Repository Element; the IR is
   regenerated on next access via staleness detection.

3. **One heal attempt per step** — prevents infinite loops. If healed
   locators also fail, the step fails.

4. **IRExecutor interface is unchanged** — the existing `IRExecutor`,
   `IRExecutionOptions`, `IRExecutionResult`, `IRStepResult`, and
   `IRAssertionResult` types are implemented as-is.

5. **ExecutionRun extends IRExecutionResult** — the persisted entity adds
   run-level metadata (id, testCaseId, environment, healedElementIds) on
   top of the executor's return type.

6. **Sequential execution only** — steps run in order. Parallel execution
   is a future enhancement (Phase 13 Suite Composition).

7. **No new StorageKeys for execution** — ExecutionRuns persist to the
   Repository (Dexie/IndexedDB), not chrome.storage.local. The side panel
   reads run status via live callbacks during execution and from the
   Repository for history.
