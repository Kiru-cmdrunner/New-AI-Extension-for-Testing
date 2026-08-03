# Execution IR — Design Document

**Status:** Architecture — pending implementation review
**Date:** 2026-07-20
**Blueprint reference:** `domain-schema.md` §3.9, `domain-erd.md` R23/R24, `domain-scope.md` §3.9
**Depends on:** `src/domain/enums.ts`, `src/domain/entities/approved-test-case.ts`, `src/domain/entities/element.ts`
**Design decisions from conversation:** Framework-neutral IR, two consumer interfaces (IRExecutor / IRCodeGenerator), disposable cache lifecycle (not versioned), linear V1 with graph-evolution path.

---

## 1. Design Principles

These principles are inviolable. Any type, field, or interface defined below must conform to all of them.

| # | Principle | Enforcement |
|---|-----------|-------------|
| P1 | **The IR is a contract, not a framework.** It defines *what* to do, never *how* a specific engine does it. | No field name references Playwright, Selenium, Cypress, Mocha, Jest, or any tool. |
| P2 | **The IR is derived and disposable.** It can always be regenerated from (ATC version + Element Repository state). No unique information lives only in the IR. | The IR has no write methods. It is produced by a generator and consumed by adapters. |
| P3 | **An adapter receives only the IR and its own configuration.** If an adapter needs information not in the IR, the IR is underspecified — add the field to the IR. | Adapters never import from the repository or domain layer (only from IR types). |
| P4 | **The IR is self-contained at generation time.** All locator resolution, test data resolution, and environment resolution happens during generation, not during execution. | Every IR step carries its resolved locators, resolved input values, and execution parameters. |
| P5 | **Linear in V1, designed for graph evolution.** Steps are self-contained leaf nodes. The evolution from `steps[]` to a control-flow graph is additive. | No step references another step. No `nextStepId`, `branchCondition`, or `dependencies` fields. |

---

## 2. Type System

All types live in `src/domain/execution-ir/`. They import only from `src/domain/enums.ts` for shared enum values. They never import from Dexie, the repository layer, or any adapter.

### 2.1 IRAction — the execution action vocabulary

The IR's action enum starts as a superset of the ATC's `StepAction`. The business-authored actions carry forward directly. Execution-only actions are injected by the generation pipeline based on implicit rules or environment configuration — the business never authors them.

```typescript
enum IRAction {
  // ── Business-authored (1:1 with StepAction) ──
  // These are the only actions that appear in the ATC.
  // The generator maps them to the same IRAction value.
  CLICK        = 'click',
  FILL         = 'fill',
  SELECT       = 'select',
  SELECT_DATE  = 'selectDate',
  TOGGLE       = 'toggle',
  HOVER        = 'hover',
  NAVIGATE     = 'navigate',
  VERIFY       = 'verify',
  WAIT         = 'wait',

  // ── Execution-only (injected by the pipeline, never authored) ──
  // V1: WAIT_FOR_ELEMENT is injected before element-interacting steps
  //     when the environment profile's defaultWaitStrategy is not 'none'.
  // Future: SWITCH_FRAME, ACCEPT_DIALOG, SCREENSHOT, etc.
  WAIT_FOR_ELEMENT = 'waitForElement',
}
```

**Mapping rule:** `StepAction → IRAction` is a 1:1 identity map for the 9 business-authored actions. The generator may *insert* execution-only steps between authored steps, but it never *transforms* an authored action into a different one. A `CLICK` in the ATC is a `CLICK` in the IR — always.

**Future execution-only actions** (defined here for design completeness, NOT implemented in V1):

```typescript
// V2+ candidates — NOT in the V1 enum:
// SWITCH_FRAME    = 'switchFrame',     // iframe / shadow DOM context
// SWITCH_TAB      = 'switchTab',       // browser tab / window
// ACCEPT_DIALOG   = 'acceptDialog',    // alert / confirm / prompt
// DISMISS_DIALOG  = 'dismissDialog',
// SCREENSHOT      = 'screenshot',       // explicit evidence capture
// SCROLL          = 'scroll',           // scroll to element or position
// UPLOAD_FILE     = 'uploadFile',       // file input
```

### 2.2 ResolvedLocator — snapshot of a locator strategy

A `ResolvedLocator` is structurally identical to the domain's `LocatorStrategy`, but it is a **snapshot** — copied from the Element Repository at IR generation time. It is not a live reference. If the Element Repository's locator changes later, the IR's snapshot does not change until regeneration.

```typescript
interface ResolvedLocator {
  readonly type: LocatorStrategyType;   // reuses domain enum
  readonly value: string;
  readonly priority: number;            // 1 = highest, tried first
  readonly confidence: number | null;   // from Element's LocatorStrategy
}
```

**Why not reuse `LocatorStrategy` directly?** Semantic separation. `LocatorStrategy` is a domain entity value object owned by the Element aggregate. `ResolvedLocator` is an IR value object owned by the execution layer. They happen to have the same shape today, but they serve different purposes and evolve independently. If the IR later needs a `resolvedAt` timestamp or a `sourceElementVersion` field, it can add one without touching the domain entity.

### 2.3 ResolvedTarget — discriminated union for step targets

A step can target one of three things:

```typescript
type ResolvedTarget =
  | ElementTarget
  | UrlTarget
  | NoTarget;

/** The step targets a UI element — locators resolved at generation time. */
interface ElementTarget {
  readonly kind: 'element';
  readonly elementId: string;           // stable ID back-reference (for reporting)
  readonly elementName: string;         // logical name (for human-readable output)
  readonly pageOrComponent: string;     // scope (for POM organization)
  readonly resolvedLocators: ResolvedLocator[];
}

/** The step targets a URL — for navigate actions. */
interface UrlTarget {
  readonly kind: 'url';
  /** Fully resolved URL — baseUrl from Environment Profile prepended to relative paths. */
  readonly url: string;
}

/** The step has no target — for pure waits, verify-only steps. */
interface NoTarget {
  readonly kind: 'none';
}
```

**Why `elementName` and `pageOrComponent` on the target?** These are carried forward so a code generator can produce human-readable output without querying the Element Repository. A Playwright POM generator needs to know "this element belongs to the LoginPage component" to create a `LoginPage` class — that information is in the IR, not looked up at generation time.

### 2.4 IRAssertion — resolved validation

The ATC's `Validation` type carries an `elementId` reference. At IR generation time, that reference is resolved to concrete locators and embedded. The assertion type, comparison, and expected value carry forward unchanged.

```typescript
interface IRAssertion {
  readonly type: ValidationType;        // reuses domain enum
  readonly comparison: ValidationComparison;
  readonly expectedValue: unknown;
  readonly severity: ValidationSeverity;
  readonly target: ResolvedTarget;      // resolved element locators or URL
  readonly property: string | null;     // which property to check
}
```

**Key difference from `Validation`:** The `elementId` string reference is replaced by a full `ResolvedTarget` with concrete locators. An adapter never needs to resolve elements during assertion evaluation — everything is already resolved.

### 2.5 ExecutionParameters — per-step execution configuration

Execution concerns (timeouts, retries, wait strategies) are NOT in the ATC — they belong to the execution layer. The generator resolves them from defaults or the Environment Profile at IR generation time and embeds them in each step.

```typescript
interface ExecutionParameters {
  /** Maximum time to wait for the action to complete. Default: 30000ms. */
  readonly timeoutMs: number;

  /** Number of retries on failure before giving up. Default: 0 (V1). */
  readonly retryCount: number;

  /** Delay between retries. Default: 1000ms. */
  readonly retryDelayMs: number;

  /**
   * Wait strategy before interacting with the element.
   *   'none'    — no wait (fire and forget)
   *   'visible' — wait for element to be visible (default)
   *   'present' — wait for element to be present in DOM
   *   'stable'  — wait for element to be visible AND stable (not animating)
   */
  readonly waitStrategy: 'none' | 'visible' | 'present' | 'stable';
}
```

**Default resolution:** The generator applies these rules at generation time:
1. If the Environment Profile specifies execution defaults, use those.
2. Otherwise, use built-in defaults: `timeoutMs=30000`, `retryCount=0`, `retryDelayMs=1000`, `waitStrategy='visible'`.

Every IR step has a fully resolved `ExecutionParameters` — there are no "unset" fields. An adapter reads them and translates to engine-specific APIs.

### 2.6 IRInput — resolved test data and action parameters

For V1, test data is resolved to literal values at generation time. The IR step's `input` field holds the concrete value. `IRInput` exists for forward compatibility — when the system supports parameterized test data sets, the IR can hold variable references that the executor resolves at runtime.

```typescript
/** V1: input is always a literal (string, number, boolean, null). */
type IRInput = string | number | boolean | null;

/**
 * [future] When test data sets are supported, input can be a variable
 * reference that the executor resolves at runtime from the active data set.
 *
 * interface IRVariableReference {
 *   readonly kind: 'variable';
 *   readonly name: string;           // e.g., "email"
 *   readonly defaultValue: IRInput;  // fallback if data set lacks the key
 * }
 *
 * type IRInput = string | number | boolean | null | IRVariableReference;
 */
```

#### 2.6.1 Per-Action Input Conventions

The `input` field is semantically overloaded — its meaning depends on the `IRAction`. These conventions are part of the IR contract, not adapter-specific behavior.

| IRAction | `input` type | Semantics | Example |
|----------|-------------|-----------|---------|
| `FILL` | `string` | Text to enter into the field | `'john@example.com'` |
| `SELECT` | `string` | Value or label to select | `'United States'` |
| `SELECT_DATE` | `string` | Date value (ISO format recommended) | `'2026-08-15'` |
| `CLICK` | `null` | No input needed | `null` |
| `HOVER` | `null` | No input needed | `null` |
| `NAVIGATE` | `null` *(V1)* | URL resolved into `UrlTarget` at generation time | `null` |
| `VERIFY` | `null` | Assertions carried in `assertions[]` | `null` |
| **`TOGGLE`** | `boolean \| null` | **Desired state**: `true` = ensure checked, `false` = ensure unchecked, `null` = literal toggle (flip) | `true` |
| **`WAIT`** | `number` | **Duration in milliseconds** to wait | `3000` |

**TOGGLE convention rationale:** `input: true` / `false` expresses idempotent business intent ("ensure the checkbox is checked"), which maps cleanly to Playwright's `.check()` / `.uncheck()`. `input: null` preserves the literal toggle semantics ("flip whatever state exists") for cases where the recorder captured a click. This distinction is in the IR, not the adapter — every adapter benefits from knowing whether the business wants idempotent or toggle behavior.

**WAIT convention rationale:** `executionParameters.timeoutMs` is the action execution ceiling (max time for the engine to complete an action). It is NOT the sleep duration. Using `input` for the wait duration keeps the semantics clean: `timeoutMs` means "how long am I willing to wait for this action" and `input` means "how long should this WAIT action sleep."

### 2.7 IRStep — the atomic execution unit

An `IRStep` is a self-contained execution unit. It carries everything an adapter needs to produce engine-specific code or execute the action — action type, resolved target, input, assertions, and execution parameters. No step references another step.

```typescript
interface IRStep {
  /** Stable identifier (carried from the ATC Step ID). */
  readonly id: string;

  /** Position in the linear sequence (0-based). */
  readonly order: number;

  /** What to do. */
  readonly action: IRAction;

  /** Human-readable description (carried from the ATC step). */
  readonly description: string;

  /** Where to target — resolved element locators, URL, or none. */
  readonly target: ResolvedTarget;

  /** Input value — literal in V1, variable reference in future. */
  readonly input: IRInput;

  /** Post-step assertions — each with resolved targets. */
  readonly assertions: IRAssertion[];

  /** Execution configuration for this step. */
  readonly executionParameters: ExecutionParameters;
}
```

### 2.8 IREnvironment — resolved environment snapshot

Environment values are resolved from the Environment Profile at IR generation time and embedded. The IR is self-contained — an adapter never queries the Environment Profile.

```typescript
interface IREnvironment {
  /** Fully resolved base URL (from Environment Profile). */
  readonly baseUrl: string;
  readonly browser: 'chrome' | 'firefox' | 'safari' | 'edge';
  readonly viewport: { width: number; height: number };
}
```

V1 carries `baseUrl`, `browser`, and `viewport` — the minimum an adapter needs. Future fields (device emulation, capabilities, timezone) are added here when needed.

### 2.9 ExecutionIRPlan — the pure IR structure

The plan is what the generator produces and the adapter consumes. It is a pure data structure with no persistence concerns.

```typescript
interface ExecutionIRPlan {
  /** Which ATC this IR was generated from. */
  readonly testCaseId: string;
  readonly testCaseVersionId: string;
  readonly testCaseVersionNumber: number;

  /** Human-readable title (for test file naming, report headers). */
  readonly title: string;

  /** Tags carried from the ATC (for categorization in generated projects). */
  readonly tags: string[];

  /** Resolved environment — base URL, browser, viewport. */
  readonly environment: IREnvironment;

  /** The ordered sequence of steps. */
  readonly steps: IRStep[];
}
```

**Why `tags` on the plan?** A Playwright project generator might organize tests by tag into different files or describe blocks. The tags are part of the IR so the generator doesn't need to query the ATC.

### 2.10 Rendering — cached engine-specific output

A rendering is the cached output of a specific adapter. It is memoization, not a first-class entity. When the IR is regenerated, all renderings are wiped.

```typescript
/** Which rendering engine produced this output. */
type RenderingEngine = 'cmdrunner' | 'playwright' | 'cypress' | 'appium';

/** Output format of the rendering. */
type RenderingFormat = 'json' | 'typescript' | 'javascript';

interface Rendering {
  readonly engine: RenderingEngine;
  readonly format: RenderingFormat;
  /** The rendered content — JSON string, TypeScript source code, etc. */
  readonly content: string;
  readonly generatedAt: string;
}
```

### 2.11 ExecutionIRArtifact — the cached wrapper

The artifact wraps the plan with provenance and cached renderings. This is what gets stored (in V1, in IndexedDB alongside the other repository data).

```typescript
interface ExecutionIRArtifact {
  /** Unique identifier for this artifact. */
  readonly id: string;

  /** Which ATC version this IR was generated from. */
  readonly testCaseVersionId: string;

  /** The actual IR — the plan consumed by adapters. */
  readonly plan: ExecutionIRPlan;

  /** When the IR was generated. Used for staleness detection. */
  readonly generatedAt: string;

  /** Version of the generator that produced this IR (e.g., 'ir-gen-1.0.0'). */
  readonly generatorVersion: string;

  /**
   * Cached engine-specific renderings.
   * Keyed by RenderingEngine (e.g., 'cmdrunner', 'playwright').
   * Wiped on regeneration — re-populated on next execution/export.
   */
  readonly renderings: Record<string, Rendering>;
}
```

**The separation matters:** The adapter contract takes `ExecutionIRPlan`, not `ExecutionIRArtifact`. The adapter never sees `id`, `generatedAt`, `generatorVersion`, or `renderings` — those are cache/provenance concerns handled by the generation pipeline. This keeps the adapter contract clean and makes the plan testable in isolation.

---

## 3. Staleness Tracking

### 3.1 IRStalenessStatus

```typescript
type IRStalenessStatus = 'missing' | 'fresh' | 'stale';

interface IRStalenessReport {
  readonly status: IRStalenessStatus;

  /** Present only when status = 'stale'. Lists what changed. */
  readonly reasons?: StalenessReason[];
}

interface StalenessReason {
  readonly type: 'element_changed' | 'generator_upgraded';
  readonly description: string;
  readonly elementId?: string;     // present for element_changed
  readonly elementName?: string;   // human-readable
}
```

### 3.2 Detection Algorithm

```
function checkStaleness(
  artifact: ExecutionIRArtifact | undefined,
  referencedElements: Element[],
  currentGeneratorVersion: string,
): IRStalenessReport

  // Missing — no IR exists for this version
  if artifact is undefined:
    return { status: 'missing' }

  reasons: StalenessReason[] = []

  // Hard staleness: any referenced element changed after IR generation
  for element in referencedElements:
    if element.updatedAt > artifact.generatedAt:
      reasons.push({
        type: 'element_changed',
        description: `Element "${element.logicalName}" was updated after IR generation`,
        elementId: element.id,
        elementName: element.logicalName,
      })

  // Soft staleness: generator version mismatch
  if currentGeneratorVersion != artifact.generatorVersion:
    reasons.push({
      type: 'generator_upgraded',
      description: `IR generated with ${artifact.generatorVersion}, current is ${currentGeneratorVersion}`,
    })

  if reasons.length > 0:
    return { status: 'stale', reasons }
  else:
    return { status: 'fresh' }
```

**Cost:** O(k) where k = number of elements referenced by the ATC version (typically 5–20). One timestamp comparison per element. No diff computation, no full table scan.

### 3.3 What Does NOT Trigger Staleness

| Event | Why it doesn't matter |
|-------|----------------------|
| New ATC version created | The new version has its own (missing) IR. Old version's IR is unaffected. |
| ATC metadata-only update (title, tags, description) | Doesn't affect execution behavior. |
| Project renamed | Doesn't affect execution. |
| Element added to the repository but not referenced by this ATC | Only *referenced* elements are checked. |

---

## 4. Adapter Interfaces

### 4.1 IRExecutor — "run this now"

The executor interface receives the IR plan plus an environment configuration and executes it against a live browser. Returns structured results. The CmdRunner runtime is the V1 (and possibly only) executor.

```typescript
interface IRExecutor {
  /**
   * Execute an IR plan against a live browser environment.
   *
   * @param plan     — the execution IR plan
   * @param options  — runtime options (credentials, overrides)
   * @returns        — structured execution results (step results, evidence)
   */
  execute(
    plan: ExecutionIRPlan,
    options: IRExecutionOptions,
  ): Promise<IRExecutionResult>;
}

interface IRExecutionOptions {
  /** Runtime credentials, if needed by the test flow. */
  readonly credentials?: Record<string, string>;
  /** Override any execution parameters globally. */
  readonly parameterOverrides?: Partial<ExecutionParameters>;
  /** Callback for real-time step progress reporting. */
  readonly onStepStart?: (step: IRStep) => void;
  readonly onStepComplete?: (step: IRStep, result: IRStepResult) => void;
}

interface IRExecutionResult {
  readonly status: 'passed' | 'failed' | 'error';
  readonly stepResults: IRStepResult[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
}

interface IRStepResult {
  readonly stepId: string;
  readonly status: 'passed' | 'failed' | 'error' | 'skipped';
  readonly durationMs: number;
  readonly assertionResults: IRAssertionResult[];
  readonly actualValue?: unknown;
  readonly error?: { message: string; type: string; stack?: string };
}

interface IRAssertionResult {
  readonly type: ValidationType;
  readonly passed: boolean;
  readonly actualValue?: unknown;
  readonly expectedValue?: unknown;
  readonly message: string;
}
```

### 4.2 IRCodeGenerator — "produce source files"

The code generator interface receives the IR plan plus a generator configuration and produces source files. Playwright, Cypress, Selenium, Appium generators all implement this interface.

```typescript
interface IRCodeGenerator {
  /**
   * Generate source files from an IR plan.
   *
   * @param plan   — the execution IR plan
   * @param config — generator configuration (output style, framework options)
   * @returns      — generated files and project metadata
   */
  generate(
    plan: ExecutionIRPlan,
    config: GeneratorConfig,
  ): Promise<GenerationResult>;
}

interface GenerationResult {
  readonly files: GeneratedFile[];
  readonly projectMetadata: {
    readonly engine: RenderingEngine;
    readonly language: string;
    readonly pattern: string;
    readonly fileCount: number;
  };
}

interface GeneratedFile {
  /** Relative path within the generated project (e.g., "tests/login.spec.ts"). */
  readonly path: string;
  readonly content: string;
}
```

### 4.3 GeneratorConfig — output-style decisions

This is the second input to `IRCodeGenerator`. It controls *how* the generator renders the IR — code organization, naming, framework conventions. It never influences the IR itself.

```typescript
interface GeneratorConfig {
  /** Output language. */
  readonly language: 'typescript' | 'javascript';

  /** Code organization pattern — purely an output concern. */
  readonly pattern: 'flat' | 'page-object';

  /** Assertion library style for the target framework. */
  readonly assertions: 'expect' | 'chai' | 'assert';

  /** Project structure preferences. */
  readonly fileStructure?: {
    readonly testsDir?: string;       // default: 'tests'
    readonly pagesDir?: string;       // default: 'pages' (POM pattern only)
    readonly helpersDir?: string;     // default: 'helpers'
  };

  /** Framework-specific options (e.g., Playwright config, Cypress config). */
  readonly frameworkOptions?: Record<string, unknown>;
}
```

**Why `pattern` is on the config, not the IR:** The same IR can be rendered as flat tests, POM tests, or Screenplay-pattern tests — all valid, all consuming the same IR. Changing the output pattern does NOT require regenerating the IR. You change the `GeneratorConfig` and re-run the generator.

### 4.4 Boundary Rules

| Rule | Enforcement |
|------|-------------|
| IR types never import from an adapter | The `src/domain/execution-ir/` directory has zero imports from `src/adapters/` or any framework |
| Adapters import only IR types | `src/adapters/` imports from `src/domain/execution-ir/` and `src/domain/enums.ts`, nothing else from the domain |
| The IR is the only thing passed to adapters | Adapter method signatures take `ExecutionIRPlan` + config/options, never the ATC, Element Repository, or Environment Profile |
| Two interfaces, not one | `IRExecutor` returns runtime results; `IRCodeGenerator` returns files. They share the IR input but have different outputs |

---

## 5. Generation Pipeline

The generation pipeline transforms (ATC version + Element Repository + Environment Profile) → ExecutionIRPlan. It is the sole producer of IR plans.

```
Inputs:
  TestCaseVersion (steps, title, tags)
  Element[] (all elements referenced by the version's steps)
  EnvironmentProfile (baseUrl, browser, viewport, execution defaults)

Process:
  1. For each ATC step:
     a. Map StepAction → IRAction (1:1 identity for business-authored actions)
     b. Resolve elementId → ElementTarget with ResolvedLocators
        - Look up Element in the Element Repository
        - Copy locatorStrategies[] → resolvedLocators[] (snapshot)
        - Carry forward logicalName and pageOrComponent
     c. Resolve input → IRInput (literal value in V1)
     d. Resolve validations → IRAssertion[]
        - For each validation, resolve elementId → ResolvedTarget
     e. Resolve execution parameters from Environment Profile defaults
     f. Optionally inject WAIT_FOR_ELEMENT steps before element-interacting steps

  2. Build ExecutionIRPlan with:
     - testCaseId, testCaseVersionId, testCaseVersionNumber (from ATC)
     - title, tags (from ATC)
     - environment (from Environment Profile)
     - steps[] (resolved)

  3. Wrap in ExecutionIRArtifact with:
     - generatedAt = now
     - generatorVersion = current version string
     - renderings = {} (empty — populated lazily by adapters)

Output:
  ExecutionIRArtifact (cached, replaces any previous artifact for this version)
```

### 5.1 Generator Interface

```typescript
interface IRGenerator {
  /**
   * Generate an Execution IR from an ATC version and resolved elements.
   *
   * @param version    — the ATC version to generate from
   * @param elements   — all elements referenced by the version's steps
   *                     (pre-fetched by the caller from the Element Repository)
   * @param environment — resolved environment configuration
   * @returns          — ExecutionIRArtifact (ready to cache)
   */
  generate(
    version: TestCaseVersion,
    elements: Map<string, Element>,
    environment: IREnvironment,
  ): ExecutionIRArtifact;

  /** Current generator version string (for staleness detection). */
  readonly version: string;
}
```

**Why `Map<string, Element>` instead of querying inside the generator?** The generator is a pure function — it doesn't query the database. The caller (service layer) fetches the elements via the repository and passes them in. This keeps the generator testable in isolation (pass in test data, verify output).

---

## 6. Lifecycle Summary

### 6.1 State Diagram

```
                    ┌──────────┐
                    │ Missing  │  no IR for this ATC version
                    └────┬─────┘
                         │ generate()
                         ▼
                    ┌──────────┐
               ┌────│  Fresh   │  IR matches current inputs
               │    └──────────┘
               │         │
     regenerate│   input changes (element updated, generator upgraded)
               │         │
               │         ▼
               │    ┌──────────┐
               └───→│  Stale   │  inputs changed; IR still valid but may be outdated
                    └────┬─────┘
                         │ regenerate()
                         ▼
                    ┌──────────┐
                    │  Fresh   │
                    └──────────┘
```

### 6.2 Operations

| Operation | Trigger | Effect |
|-----------|---------|--------|
| **Generate** | First execution or export of an ATC version with no cached IR | Creates IR artifact, caches it. |
| **Check staleness** | User opens test case; before execute; before export | Compares element timestamps + generator version. Returns report. |
| **Regenerate** | User clicks "Regenerate"; auto before export if stale | Discards old IR + renderings. Generates fresh IR. Surfaces locator diff if any (INV-IR5). |
| **Execute** | User clicks "Run" | Warns if stale. Executes via IRExecutor. Creates Test Run with results. |
| **Export** | User clicks "Export Playwright" | Silently regenerates if stale. Runs IRCodeGenerator. Returns files. |
| **Discard** | ATC version deleted; project deleted | Removes cached IR. No cascade concern — IR is derived. |

### 6.3 Self-Heal Signal (INV-IR5)

At regeneration time, the pipeline compares old and new resolved locators:

```
function detectLocatorChanges(
  oldArtifact: ExecutionIRArtifact,
  newPlan: ExecutionIRPlan,
): LocatorDiff[]

  for each (oldStep, newStep) in zip(oldArtifact.plan.steps, newPlan.steps):
    if oldStep.target.kind == 'element' and newStep.target.kind == 'element':
      if oldStep.target.elementId == newStep.target.elementId:
        oldLocators = serialize(oldStep.target.resolvedLocators)
        newLocators = serialize(newStep.target.resolvedLocators)
        if oldLocators != newLocators:
          yield { elementId, elementName, oldLocators, newLocators }
```

The diff is surfaced to the user as a transient notification. It is NOT stored as a historical record. After the comparison, the old artifact is discarded and the new one is cached.

---

## 7. V1 vs. Deferred Capabilities

### 7.1 Implemented in V1

| Capability | Details |
|------------|---------|
| IR plan type system | All types defined in §2 |
| IR generator | ATC version + Elements + Environment → IR plan |
| IR artifact caching | ExecutionIRArtifact stored per ATC version |
| Staleness detection | Element timestamp + generator version comparison |
| Manual regeneration | User-triggered; surfaces locator diff (INV-IR5) |
| CmdRunner JSON rendering | Cached on artifact; consumed by CmdRunner runtime |
| Playwright code rendering | On-demand export; flat pattern only |
| IRExecutor interface | Defined; CmdRunner runtime implements it |
| IRCodeGenerator interface | Defined; Playwright generator implements it |
| WAIT_FOR_ELEMENT injection | Automatic before element-interacting steps |

### 7.2 Deferred but Architected For

| Capability | How it's architected |
|------------|---------------------|
| Component hierarchy (Page → Component → Subcomponent → Element) | The `pageOrComponent` field is a flat display label in V1. The evolution path is a new `Component` entity (aggregate root with parent-child relationships), not a structured string on Element. Elements gain an optional `componentId` FK. The IR's `ElementTarget` gains `componentPath: string[]` (resolved at generation time). All changes are additive — no field type changes, no data migration. |
| Page Object Model rendering | `GeneratorConfig.pattern = 'page-object'`; `ElementTarget.pageOrComponent` provides scope |
| Cypress rendering | `RenderingEngine = 'cypress'`; implements same `IRCodeGenerator` interface |
| Appium rendering (mobile) | `RenderingEngine = 'appium'`; `IREnvironment` extensible with `device` field |
| Auto-regeneration on element change | Staleness detection exists; auto-trigger deferred |
| IR diff display | `detectLocatorChanges()` logic designed; UI display deferred |
| Variable / parameterized test data | `IRInput` designed as extensible union; V1 is literals only |
| Retry logic in execution | `ExecutionParameters.retryCount` field exists; default 0 |
| Control flow (branching, loops) | Steps are self-contained leaf nodes; graph wrapper is additive |
| Execution-only actions (frame switch, dialog, screenshot) | `IRAction` enum designed as extensible superset |

### 7.3 Not Designed For (V1)

| Capability | Why |
|------------|-----|
| IR versioning (multiple cached versions per ATC version) | Creates third source of truth. IR is disposable. |
| Stored generated projects | Generation is a pure function; output leaves the system. |
| Cross-framework IR translation | Each framework has its own generator; no IR-to-IR transform. |
| Parallel step execution | V1 is strictly linear. Parallelism requires a graph. |

---

## 8. File Structure (Implementation Plan)

```
src/domain/execution-ir/
  types.ts                    — All IR types (IRAction, IRStep, ResolvedTarget,
                                ResolvedLocator, IRAssertion, ExecutionParameters,
                                IRInput, IREnvironment, ExecutionIRPlan,
                                ExecutionIRArtifact, Rendering)
  staleness.ts                — IRStalenessStatus, IRStalenessReport, detection logic
  generator.ts                — IRGenerator interface
  staleness detection function

src/domain/execution-ir/adapters/
  ir-executor.ts              — IRExecutor interface + result types
  ir-code-generator.ts        — IRCodeGenerator interface + config types + result types

src/repository/v2/interfaces/
  execution-ir-repository.ts  — getById, getByTestCaseVersion, save, delete
  (Dexie implementation in dexie/)

tests/domain/execution-ir/
  types.test.ts               — Type validation, factory function tests
  generator.test.ts           — IR generation from ATC + Elements
  staleness.test.ts           — Staleness detection logic
```

**Note:** The adapter *interfaces* live in the domain layer (`src/domain/execution-ir/adapters/`). The adapter *implementations* (Playwright generator, CmdRunner runtime) live elsewhere (`src/adapters/`). This enforces the dependency rule: interfaces are domain-owned, implementations are pluggable.

---

## 9. Complete Example

An ATC version with 3 steps generates this IR plan:

```json
{
  "testCaseId": "tc-login-001",
  "testCaseVersionId": "tcv-login-v1",
  "testCaseVersionNumber": 1,
  "title": "User can log in with valid credentials",
  "tags": ["smoke", "critical-path"],
  "environment": {
    "baseUrl": "https://staging.example.com",
    "browser": "chrome",
    "viewport": { "width": 1440, "height": 900 }
  },
  "steps": [
    {
      "id": "step-0",
      "order": 0,
      "action": "navigate",
      "description": "Navigate to the login page",
      "target": {
        "kind": "url",
        "url": "https://staging.example.com/login"
      },
      "input": null,
      "assertions": [],
      "executionParameters": {
        "timeoutMs": 30000,
        "retryCount": 0,
        "retryDelayMs": 1000,
        "waitStrategy": "none"
      }
    },
    {
      "id": "step-0a",
      "order": 1,
      "action": "waitForElement",
      "description": "(implicit) Wait for email field to be ready",
      "target": {
        "kind": "element",
        "elementId": "elm-email-001",
        "elementName": "Email Address Input",
        "pageOrComponent": "LoginPage",
        "resolvedLocators": [
          { "type": "role", "value": "textbox[name=\"Email\"]", "priority": 1, "confidence": 0.95 },
          { "type": "testId", "value": "email-input", "priority": 2, "confidence": 0.9 },
          { "type": "css", "value": "#email", "priority": 3, "confidence": 0.85 }
        ]
      },
      "input": null,
      "assertions": [],
      "executionParameters": {
        "timeoutMs": 30000,
        "retryCount": 0,
        "retryDelayMs": 1000,
        "waitStrategy": "visible"
      }
    },
    {
      "id": "step-1",
      "order": 2,
      "action": "fill",
      "description": "Enter email address",
      "target": {
        "kind": "element",
        "elementId": "elm-email-001",
        "elementName": "Email Address Input",
        "pageOrComponent": "LoginPage",
        "resolvedLocators": [
          { "type": "role", "value": "textbox[name=\"Email\"]", "priority": 1, "confidence": 0.95 },
          { "type": "testId", "value": "email-input", "priority": 2, "confidence": 0.9 },
          { "type": "css", "value": "#email", "priority": 3, "confidence": 0.85 }
        ]
      },
      "input": "john.doe@example.com",
      "assertions": [],
      "executionParameters": {
        "timeoutMs": 30000,
        "retryCount": 0,
        "retryDelayMs": 1000,
        "waitStrategy": "visible"
      }
    },
    {
      "id": "step-2",
      "order": 3,
      "action": "click",
      "description": "Click the Sign In button",
      "target": {
        "kind": "element",
        "elementId": "elm-signin-001",
        "elementName": "Sign In Button",
        "pageOrComponent": "LoginPage",
        "resolvedLocators": [
          { "type": "role", "value": "button[name=\"Sign In\"]", "priority": 1, "confidence": 0.95 }
        ]
      },
      "input": null,
      "assertions": [
        {
          "type": "urlMatch",
          "comparison": "contains",
          "expectedValue": "/dashboard",
          "severity": "hard",
          "target": { "kind": "url", "url": "https://staging.example.com/dashboard" },
          "property": "url"
        }
      ],
      "executionParameters": {
        "timeoutMs": 30000,
        "retryCount": 0,
        "retryDelayMs": 1000,
        "waitStrategy": "visible"
      }
    }
  ]
}
```

Note step-0a: the generator injected a `waitForElement` before the `fill` because the default wait strategy is `'visible'`. This is the execution-only action pattern — business intent is unchanged, execution detail is added.

---

## 10. Invariants

These extend the blueprint's INV-IR1 through IR5 with the refined design.

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| INV-IR1 | The IR is always regenerable from (ATC version + Element Repository state). | The generator is a pure function of these inputs. No external state. |
| INV-IR2 | The IR is never hand-edited. | IR types have no mutation methods. The only way to produce an IR is through the generator. |
| INV-IR3 | The IR is a derived artifact with provenance, not a peer entity. | `ExecutionIRArtifact` carries `testCaseVersionId`, `generatorVersion`, `generatedAt`. It has no lifecycle states. |
| INV-IR4 | `resolvedLocators` match the Element Repository at generation time. | The generator copies `Element.locatorStrategies` directly. |
| INV-IR5 | Regeneration diff is the self-heal signal. | `detectLocatorChanges()` runs at regeneration time. |
| INV-IR6 | **NEW:** The IR plan is the only thing passed to adapters. | Adapter signatures take `ExecutionIRPlan`, never the ATC, Elements, or Environment Profile. |
| INV-IR7 | **NEW:** The IR has no version history. One cached artifact per ATC version. | `ExecutionIRRepository.save()` replaces; it does not append. |
| INV-IR8 | **NEW:** Every IR step has fully resolved `ExecutionParameters`. | The generator resolves defaults at generation time. No undefined fields. |
| INV-IR9 | **NEW:** Generated outputs have no lifecycle. | Renderings are a memoization cache on the artifact. Exports are pure functions that leave the system. |
