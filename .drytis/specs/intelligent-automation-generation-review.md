# Architecture Review — Intelligent Automation Generation

**Status:** Architecture review and design milestone — no implementation
**Date:** 2026-07-16
**Scope:** Automation generation pipeline (Execution JSON + Playwright generation)
**Constraint:** Preserve deterministic execution, Product Foundation, frozen milestones

---

## Table of Contents

1. [Current Architecture Assessment](#1-current-architecture-assessment)
2. [Current Strengths](#2-current-strengths)
3. [Current Weaknesses](#3-current-weaknesses)
4. [Industry Observations](#4-industry-observations)
5. [AI Opportunities](#5-ai-opportunities)
6. [Architectural Alternatives](#6-architectural-alternatives)
7. [Execution JSON Assessment](#7-execution-json-assessment)
8. [Recommended Architecture](#8-recommended-architecture)
9. [Execution JSON Evolution](#9-execution-json-evolution)
10. [Playwright Evolution](#10-playwright-evolution)
11. [Trade-off Analysis](#11-trade-off-analysis)
12. [Migration Strategy](#12-migration-strategy)
13. [Risk Assessment](#13-risk-assessment)
14. [Future Evolution Roadmap](#14-future-evolution-roadmap)
15. [Consistency Review](#15-consistency-review)

---

## 1. Current Architecture Assessment

### Current generation pipeline

```
Timeline (SessionEvent[])
  ↓
  ↓ Stage 1: canonical-step-generator
  ↓   - Maps event type → plain English via registry
  ↓   - Readability optimization (OR-1: focus+click+text merge)
  ↓   - Step numbering
  ↓
CanonicalStep[] (executionJson = null)
  ↓
  ↓ Stage 2: execution-json-generator
  ↓   - Locator Resolution Engine (B4.4: Business → Accessibility → Tech → Content → Structural)
  ↓   - mapActionType: click→click, text→fill, radio→select, dateSelect→fill, etc.
  ↓   - Constructs 6-section ExecutionJsonObject
  ↓
CanonicalStep[] (executionJson populated)
  ↓
  ↓ Stage 3: playwright-generator
  ↓   - translateLocator: 15 strategies → Playwright API calls
  ↓   - translateAction: action verbs → Playwright methods
  ↓   - iframe frameLocator prefixing
  ↓   - Fallback locators emitted as comments
  ↓
Playwright test code string
```

### Architectural assumptions

1. **Locators are static.** The locator captured at recording time remains
   valid at execution time. If the DOM changes, the locator breaks.

2. **One primary locator suffices.** The generator selects the highest-priority
   locator and emits it as the executable statement. Secondary/fallback locators
   are comments only — they are NOT executable code.

3. **Playwright's auto-waiting is sufficient.** The generated code relies on
   Playwright's built-in actionability checks (visible, enabled, stable). No
   explicit waits, network idle waits, or custom synchronization.

4. **No recovery strategy.** If a locator fails, the test fails. There is no
   fallback chain, no retry, no self-healing.

5. **No workflow context in Execution JSON.** Each step is independent — the
   JSON describes what to do on one element, not how steps relate to each other.

6. **No execution-time intelligence.** All decisions are made at generation
   time. The generated code is static.

---

## 2. Current Strengths

| Strength | Detail |
|----------|--------|
| **Deterministic** | Same Timeline → same Playwright code, every time. No randomness, no AI in the execution path. |
| **Clean contract boundaries** | Generators communicate via published contracts. B5.2's 6-section Execution JSON is a stable interface. |
| **Locator priority strategy** | B4.4's 5-category hierarchy is principled: Business identifiers first, structural last. Auto-generated IDs and CSS-in-JS classes are filtered. |
| **Framework-agnostic action model** | `action.type` is abstract ("click", "fill", "check") — not Playwright-specific. The Execution JSON could target Cypress, Selenium, or any engine. |
| **Readable output** | Steps have plain-English descriptions, traceability comments, step numbers. Generated code is human-readable. |
| **Extensible action mapping** | Adding a new interaction type = adding a case to `mapActionType` and `translateAction`. No structural changes. |
| **Error isolation** | Per-step error handling. A failed step carries an error marker; the pipeline continues. |
| **Testable** | Each generator is a pure function. Unit tests verify input→output mapping. |

---

## 3. Current Weaknesses

### W1: Fallback locators are not executable

**Impact:** High. The B4.4 strategy correctly identifies up to 3 locators
(primary + secondary + fallback), but only the primary is translated to code.
Secondary and fallback locators are emitted as `// Fallback locators:` comments.

When the primary locator breaks (DOM change, ID removal, class rename), the
test fails even though a working secondary locator exists in the comments.
A human must manually edit the code.

### W2: No explicit synchronization

**Impact:** Medium-High. The generated code relies solely on Playwright's
auto-waiting. For SPAs with async data loading, virtualized lists, lazy-loaded
modals, or skeleton-to-content transitions, auto-waiting may not be sufficient.

Enterprise applications (Adani One, OrangeHRM with OXD framework) frequently
have:
- Async dropdown population (data fetched after click)
- Delayed calendar rendering (DOM added 200-500ms after trigger click)
- Dynamic form fields (conditional on previous selection)
- Overlay/portaled components (rendered outside main DOM tree)

### W3: No self-healing or recovery

**Impact:** High. When a locator breaks, the test fails immediately. There is
no mechanism to:
- Try the secondary/fallback locators
- Re-resolve the element from semantic context
- Report which locator broke and why

Industry data shows that 60-80% of test maintenance time is spent on locator
fixes (Source: multiple 2025-2026 test automation surveys). Self-healing is
the highest-ROI AI feature for test automation.

### W4: No workflow context in Execution JSON

**Impact:** Medium. Each Execution JSON object describes one step in isolation.
There is no information about:
- What the previous step was (sequence context)
- What the expected result is (validation)
- What dependent elements must be present (prerequisites)
- What the page state should be after the action (postcondition)

This limits the ability to generate smarter waits, smarter assertions, and
smarter recovery strategies.

### W5: dateSelect action not fully mapped

**Impact:** Low-Medium. The `dateSelect` action type maps to `fill` in
`mapActionType`, but the `translateAction` function doesn't have an explicit
case for `dateSelect` — it falls through to the default "Unknown action type"
warning. The `fill` action is handled, so it works indirectly, but the
generated code may not be optimal for date inputs.

### W6: No network/state awareness

**Impact:** Medium. The generated code has no awareness of:
- XHR/fetch requests that need to complete
- localStorage/sessionStorage state changes
- Cookie modifications
- Route changes (beyond navigation events)

---

## 4. Industry Observations

### Self-healing automation (Testim, Mabl, Functionize, Reflect)

**Pattern:** Store multiple locator strategies. On failure, try alternatives.
If all fail, use AI to re-discover the element from DOM context (text, role,
visual similarity, DOM structure). Cache the healed locator for future runs.

**Key insight:** Self-healing works best as a layered fallback:
1. Primary locator (fast, deterministic, <1s)
2. Secondary/fallback locators (fast, deterministic, <1s)
3. Semantic re-resolution (AI, 5-10s, only on cache miss)

The common case (step 1) is deterministic and fast. AI is invoked only on
failure — not on every step.

### Intent-based execution (Healenium, Currents, Replay.io)

**Pattern:** The test describes WHAT the user intends to do (e.g., "select
departure date"), not HOW to find the element. At execution time, an
intent resolver finds the element from semantic context.

**Key insight:** Intent-based execution survives UI evolution better than
locator-based execution because the intent doesn't change when the DOM does.

**Caveat:** Pure intent-based execution requires AI on every step → high
latency, high cost, non-determinism. Best used as a recovery layer, not the
primary execution path.

### Adaptive synchronization (Playwright v1.56+ AI features, Mabl)

**Pattern:** Instead of fixed waits (`page.waitForTimeout(5000)`) or blanket
network idle (`page.waitForLoadState('networkidle')`), the system waits for
specific conditions: element visible, text appeared, attribute changed,
network request completed.

**Key insight:** Playwright's auto-waiting handles element actionability but
not data-dependency waits. A hybrid approach (Playwright auto-wait + semantic
waits derived from workflow context) is more robust.

### Multi-strategy locator resolution (universal pattern)

**Pattern:** Every modern automation tool uses ordered locator strategies:
1. Test IDs (most stable)
2. ARIA/role-based (accessibility-aligned)
3. Text content (human-readable)
4. CSS selectors (structural)
5. XPath (structural fallback)

CmdRunner's B4.4 priority strategy already aligns with this industry pattern.
The gap is in execution: most tools execute the fallback chain automatically,
while CmdRunner emits only the primary locator.

### Playwright v1.56 AI agents (October 2025)

**Pattern:** Playwright introduced Planner, Generator, and Healer agents.
The Healer agent automatically repairs broken locators using AI. This validates
the self-healing direction but runs at the Playwright tooling layer, not the
test-generation layer.

**Key insight:** CmdRunner can provide richer context (workflow semantics,
AI intent, interaction snapshots) for self-healing than Playwright alone.

---

## 5. AI Opportunities

### Tier 1: High-value, low-risk AI enhancements

| Opportunity | What AI Does | Impact |
|-------------|-------------|--------|
| **Self-healing locator resolution** | On locator failure, AI re-discovers element from DOM context (role, text, structure) | Eliminates 60-80% of maintenance work |
| **Smart locator ranking** | AI ranks locator candidates by predicted stability (not just B4.4 category) | Reduces future breakage by preferring robust locators |
| **Adaptive wait insertion** | AI identifies steps that need explicit waits (async data load, dynamic rendering) based on recording-time evidence | Reduces flaky tests from timing issues |

### Tier 2: Medium-value, medium-risk

| Opportunity | What AI Does | Impact |
|-------------|-------------|--------|
| **Semantic assertion generation** | AI infers expected post-conditions from workflow context ("after login, dashboard should appear") | Adds validation without manual effort |
| **Workflow-aware step grouping** | AI identifies logical groups of steps (login flow, search flow, checkout flow) | Improves code organization and readability |
| **Recovery strategy suggestions** | AI suggests alternative approaches when a step is fragile ("use getByRole instead of CSS selector") | Improves maintainability |

### Tier 3: Future-direction, higher-complexity

| Opportunity | What AI Does | Impact |
|-------------|-------------|--------|
| **Natural language test modification** | User describes change in plain English; AI modifies the test | Lowers barrier to maintenance |
| **Cross-test optimization** | AI identifies shared steps across tests, suggests shared setup/teardown | Improves suite efficiency |
| **Visual regression awareness** | AI compares expected vs actual visual state | Extends beyond functional testing |

### Recommended initial focus

**Self-healing locator resolution** and **executable fallback chains** deliver
the highest ROI with the lowest architectural risk. They address the #1 pain
point (locator maintenance) while preserving deterministic execution.

---

## 6. Architectural Alternatives

### Alternative A: Pure deterministic (current architecture)

```
Timeline → Steps → ExecJSON (deterministic locators) → Playwright (primary locator only)
```

**Strengths:** Fully deterministic. Zero AI latency. Simple.
**Weaknesses:** Brittle. No recovery. High maintenance.
**Verdict:** Insufficient for long-term enterprise resilience. Current state.

### Alternative B: AI-assisted Playwright generation

```
Timeline → Steps → ExecJSON → AI enhances Playwright code → Playwright
```

**Strengths:** AI can optimize the generated code, choose better locators,
add smart waits.
**Weaknesses:** AI in the generation path. Non-deterministic output. Same
steps → different code each generation. Violates B5.1 AP5 (deterministic).
**Verdict:** Reject — breaks deterministic generation principle.

### Alternative C: AI-assisted Execution JSON (recommended)

```
Timeline → Steps → ExecJSON (deterministic) → AI enrichment layer → Enhanced ExecJSON → Deterministic Playwright
```

**Strengths:**
- AI enriches the Execution JSON (adds alternative locators, wait hints,
  workflow context, recovery data) as a POST-PROCESSING step.
- Playwright generation remains deterministic (same enhanced JSON → same code).
- The AI layer is optional — without it, the current pipeline runs unchanged.
- The enhancement is additive — it adds fields, never removes or changes
  existing ones.

**Weaknesses:**
- Requires extending the Execution JSON contract (additive only).
- AI enrichment adds latency at generation time (not execution time).
- Must design the enrichment to be purely informational for the generator.

**Verdict:** Recommended. Preserves deterministic generation while enabling
AI-enhanced resilience. See §8 for full design.

### Alternative D: Runtime self-healing engine

```
Timeline → Steps → ExecJSON → Playwright → CmdRunner Execution Runtime (self-healing on failure)
```

**Strengths:** Runtime recovery. No generation-time AI needed. Survives any
DOM change at execution time.
**Weaknesses:** Requires a custom execution runtime (not standard Playwright
runner). High complexity. AI latency at execution time (5-10s per heal).
May mask real bugs.
**Verdict:** Long-term aspirational. Too complex for initial evolution. The
self-healing concept can be partially realized through Alternative C's
executable fallback chains.

### Alternative E: Hybrid (C + D)

```
Timeline → Steps → ExecJSON → AI enrichment → Enhanced ExecJSON
  → Deterministic Playwright with executable fallback chain
  → Optional CmdRunner Runtime wrapper for AI self-healing on total failure
```

**Strengths:** Layered resilience. Fast deterministic path. Executable
fallbacks. AI recovery as last resort.
**Weaknesses:** Highest complexity. Multi-phase implementation.
**Verdict:** This is the recommended long-term target (§14 roadmap), but the
initial implementation should focus on Alternative C.

---

## 7. Execution JSON Assessment

### Current 6-section contract

| Section | Content | Sufficient for Resilience? |
|---------|---------|---------------------------|
| action | type, value | ✅ Adequate |
| target | kind, tag, role, name, url | ✅ Adequate |
| locators | strategy, value, role (0-3 entries) | ⚠️ Has data, but only primary is executable |
| context | iframe, shadowDom, frame | ✅ Adequate |
| trace | interactionId, stepId | ✅ Adequate |
| meta | status, warnings, generatedAt | ⚠️ Missing resilience metadata |

### What's missing for long-term resilience

| Gap | Impact | Severity |
|-----|--------|----------|
| No workflow context (preceding/following step) | Cannot generate smart waits or assertions | Medium |
| No semantic intent ("user is selecting a departure date") | Cannot fall back to intent-based recovery | Medium |
| No wait hints (async-dependent elements) | Tests may be flaky on dynamic pages | High |
| No recovery data (alternative locators ranked by stability) | Self-healing impossible | High |
| No validation expectations (expected post-state) | No automatic assertions | Medium |
| No element fingerprint (for runtime identity matching) | Runtime self-healing impossible | Low (future) |

### Key principle: Extension is additive

B5.2 §8.1: "Extension by addition — new sections may be added; existing
sections/fields are not removed, renamed, or restructured."

This means we CAN add new sections to the Execution JSON without breaking the
frozen contract. The existing 6 sections remain intact. New sections carry
AI enrichment data that the Playwright generator can optionally consume.

---

## 8. Recommended Architecture

### Overview

```
┌───────────────────────────────────────────────────────────┐
│                    GENERATION PIPELINE                     │
│                                                            │
│  Timeline → canonical-step-generator → Steps (JSON=null)   │
│                                                            │
│  Steps → execution-json-generator → Steps (JSON populated) │
│                                                            │
│  ┌────────────────────────────────────────────────────┐   │
│  │  AI ENRICHMENT LAYER (new, optional, additive)      │   │
│  │                                                      │   │
│  │  Input:  Steps with Execution JSON                   │   │
│  │  AI:     Ranks locators, adds wait hints, adds       │   │
│  │          workflow context, adds recovery data        │   │
│  │  Output: Steps with Enhanced Execution JSON          │   │
│  │                                                      │   │
│  │  If AI unavailable: passes through unchanged         │   │
│  └────────────────────────────────────────────────────┘   │
│                                                            │
│  Enhanced Steps → playwright-generator → Playwright code   │
│  (deterministic translation of enhanced JSON)              │
│                                                            │
└───────────────────────────────────────────────────────────┘
```

### The AI Enrichment Layer

This is a new generation stage between the execution-json-generator and the
playwright-generator. It is:
- **Optional** — feature-flagged. Without AI, it's a pass-through.
- **Additive** — it adds data to the Execution JSON. Never modifies existing
  sections.
- **Deterministic in output** — given the same input + same AI response, the
  enriched JSON is deterministic. The Playwright generator's output is
  deterministic given the enriched JSON.
- **Non-breaking** — the playwright-generator treats enrichment data as
  optional. If absent, it generates the same code as today.

### What the AI Enrichment Layer adds

```
New Section 7: resilience
{
  "locatorChain": [
    { "strategy": "testId", "value": "submit-btn", "confidence": 0.95 },
    { "strategy": "ariaLabel", "value": "Submit", "confidence": 0.85 },
    { "strategy": "text", "value": "Submit", "confidence": 0.70 }
  ],
  "waitStrategy": {
    "type": "elementVisible" | "networkIdle" | "textAppears" | "none",
    "target": "element accessible name or CSS",
    "reason": "async data load detected during recording"
  },
  "recoveryHints": {
    "semanticDescription": "Submit button on the login form",
    "alternativeRoles": ["button[type=submit]"],
    "nearbyText": ["Login", "Sign In"]
  }
}

New Section 8: workflowContext
{
  "intent": "Submit the login form",
  "stepGroup": "login-flow",
  "precedingStepType": "text",
  "expectedResult": "Dashboard becomes visible"
}
```

### How the Playwright Generator consumes enrichment

**Locator chain → executable fallback code:**

Current (primary only):
```typescript
await page.getByTestId('submit-btn').click();
// Fallback locators: secondary: ariaLabel="Submit", fallback: css=".btn-primary"
```

Enhanced (executable fallback chain):
```typescript
await CmdRunner.resolveAndAct(
  page,
  [
    { strategy: 'testId', value: 'submit-btn' },
    { strategy: 'ariaLabel', value: 'Submit' },
    { strategy: 'text', value: 'Submit' },
  ],
  (locator) => locator.click()
);
```

Or simpler (without a runtime helper):
```typescript
// Primary locator
try {
  await page.getByTestId('submit-btn').click();
} catch {
  // Secondary: ariaLabel
  await page.getByLabel('Submit').click();
}
```

**Wait strategy → explicit wait:**

Current (no wait):
```typescript
await page.getByRole('combobox').click();
await page.getByRole('option', { name: 'Business' }).click();
```

Enhanced (smart wait):
```typescript
await page.getByRole('combobox').click();
await page.waitForTimeout(200); // AI hint: async dropdown population
// OR better:
await expect(page.getByRole('option')).toBeVisible(); // AI hint: wait for options
await page.getByRole('option', { name: 'Business' }).click();
```

---

## 9. Execution JSON Evolution

### Phase 1: Add resilience section (additive)

```typescript
// New optional section — not part of the frozen 6
interface ExecutionResilience {
  /** Ranked locator chain for executable fallbacks */
  locatorChain?: RankedLocator[];
  /** Wait strategy derived from recording-time evidence */
  waitStrategy?: WaitHint;
  /** Recovery hints for AI-assisted self-healing */
  recoveryHints?: RecoveryHints;
}

interface RankedLocator {
  strategy: LocatorStrategy;
  value: string;
  /** AI-predicted stability score (0.0-1.0) */
  confidence: number;
}

interface WaitHint {
  type: 'elementVisible' | 'networkIdle' | 'textAppears' | 'domStable' | 'none';
  target?: string;
  reason: string;
}

interface RecoveryHints {
  semanticDescription: string;
  alternativeSelectors?: string[];
  nearbyText?: string[];
}
```

### Phase 2: Add workflow context section (additive)

```typescript
interface ExecutionWorkflowContext {
  intent?: string;
  stepGroup?: string;
  precedingStepType?: string;
  expectedResult?: string;
}
```

### What does NOT change

The existing 6 sections (action, target, locators, context, trace, meta)
remain exactly as defined in B5.2. The `ExecutionJsonObject` interface gains
two optional properties:

```typescript
interface ExecutionJsonObject {
  action: ExecutionAction;
  target: ExecutionTarget;
  locators: ExecutionLocator[];
  context: ExecutionContext;
  trace: ExecutionTrace;
  meta: ExecutionMeta;
  // NEW (optional, additive):
  resilience?: ExecutionResilience;
  workflowContext?: ExecutionWorkflowContext;
}
```

Every existing consumer (playwright-generator, validation framework, UI)
continues to work unchanged because the new fields are optional.

---

## 10. Playwright Evolution

### Phase 1: Executable fallback chains

The Playwright generator gains a new translation mode when `resilience.locatorChain`
is present:

```typescript
// When enrichment data exists, generate executable fallback:
const locator = await CmdRunner.resolve([
  () => page.getByTestId('submit-btn'),
  () => page.getByLabel('Submit'),
  () => page.getByText('Submit'),
]);
await locator.click();

// When no enrichment, generate current code (unchanged):
await page.getByTestId('submit-btn').click();
```

A small `CmdRunner.resolve()` helper (emitted once per test file) implements
the fallback chain: try each locator in order, return the first visible match.

### Phase 2: Smart wait insertion

When `resilience.waitStrategy` indicates an async dependency:

```typescript
await page.getByRole('combobox').click();
await expect(page.getByRole('option')).toBeVisible(); // AI wait hint
await page.getByRole('option', { name: 'Business' }).click();
```

### Phase 3: Assertion generation (future)

When `workflowContext.expectedResult` is present:

```typescript
await page.getByTestId('submit-btn').click();
await expect(page.getByText('Dashboard')).toBeVisible(); // AI-generated assertion
```

### What the generated code looks like (target state)

```typescript
import { test, expect } from '@playwright/test';
import { resolve } from './cmdrunner-helpers';

test('Book a Flight', async ({ page }) => {
  // Step 1: Navigate to starting page
  await page.goto('https://adanione.com/flight-booking');

  // Step 2: Click "Book Flight" link
  await resolve([
    () => page.getByText('Book Flight'),
    () => page.locator('#book-flight'),
  ]).click();

  // Step 3: Select Date "18 July 2026"
  await resolve([
    () => page.getByPlaceholder('Depart on'),
    () => page.locator('#onward'),
  ]).fill('18 July 2026');

  // Step 4: Select "Economy" from class dropdown
  await page.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: 'Economy' })).toBeVisible();
  await page.getByRole('option', { name: 'Economy' }).click();

  // Expected: Search results appear
  await expect(page.locator('.search-results')).toBeVisible();
});
```

### Key properties of the target state

1. **Fallback chains are executable** — not comments
2. **Smart waits are derived from recording evidence** — not arbitrary timeouts
3. **Assertions are optional** — only when workflow context is available
4. **Code is still deterministic** — same enriched JSON → same code
5. **Code is still readable** — clear step comments, human-readable locators
6. **Code works without the helper** — users can remove the fallback and use
   the primary locator directly

---

## 11. Trade-off Analysis

### What we gain

| Gain | Impact |
|------|--------|
| Executable fallback chains | Tests survive primary locator breakage automatically |
| Smart wait insertion | Reduces flaky tests from async timing issues |
| AI-ranked locators | Prefers the most stable locator, not just the highest B4.4 category |
| Recovery hints | Enables future runtime self-healing |
| Workflow context | Enables smarter assertions and step grouping |
| Deterministic generation preserved | Same enriched JSON → same code, every time |

### What we trade

| Trade-off | Cost |
|-----------|------|
| AI enrichment adds generation-time latency | ~2-5s for a full test (batch AI call). One-time cost at Stop. |
| Optional helper function in generated code | Small complexity. Users can strip it. |
| Execution JSON gains 2 optional sections | Contract grows. Acceptable — additive only. |
| AI enrichment quality depends on prompt design | Bad prompts = bad hints. Mitigated by evidence-only baseline. |

### What stays the same

- Deterministic generation (B5.1 AP5)
- 6-section Execution JSON contract (B5.2)
- Generator contracts and pipeline (B2)
- Locator priority strategy (B4.4) — AI re-ranks within the existing categories
- Readability optimizer (B7)
- Playwright API usage patterns (B6)
- All frozen C-series product decisions

---

## 12. Migration Strategy

### Phase G1: Executable fallback chains (no AI)

Modify the Playwright generator to emit executable try-catch fallback chains
using the EXISTING secondary/fallback locators from the `locators[]` array.

No AI needed. No new Execution JSON sections. Pure generator enhancement.

**Risk:** Low. Only the playwright-generator changes. Same JSON → richer code.
**Exit criteria:** Generated tests survive primary locator breakage by falling
back to secondary/fallback locators.

### Phase G2: Add resilience + workflowContext sections (additive)

Extend the `ExecutionJsonObject` type with two optional properties. No existing
field is modified. The AI enrichment layer is built as a new generation stage
(feature-flagged).

**Risk:** Low-Medium. Additive type change. New generator stage. Feature flag
controls whether AI enrichment runs.
**Exit criteria:** AI enrichment layer populates resilience data. Playwright
generator uses it when present.

### Phase G3: Smart wait insertion

AI enrichment layer analyzes recording-time evidence (MutationObserver data,
timing data from the Interaction Snapshot) to derive wait hints. Playwright
generator emits explicit waits.

**Risk:** Medium. Wait strategy must be conservative — wrong waits slow tests
or mask issues.
**Exit criteria:** Flaky test rate reduced on Adani One and OrangeHRM.

### Phase G4: Assertion generation (future)

AI enrichment layer uses workflow context to generate `expect()` assertions.

**Risk:** Medium. Assertions may be too strict or too loose.
**Exit criteria:** Generated assertions match user expectations.

---

## 13. Risk Assessment

### R1: AI enrichment latency at generation time
AI enrichment runs at Stop Recording. For a 20-step test, this could add 2-5s.
*Mitigation:* Batch AI call (one prompt for all steps). Feature flag to disable.
Users who don't configure AI get the current pipeline with no latency.

### R2: Executable fallback chains may mask real bugs
If an element is missing because the feature was removed, the fallback chain
may match a different element and the test "passes" incorrectly.
*Mitigation:* Fallback locators must be from DIFFERENT B4.4 categories (e.g.,
testId → ariaLabel → text). Cross-category matching reduces false positives.
The CmdRunner.resolve() helper logs when a fallback was used, making it
visible in test output.

### R3: AI prompt quality
The enrichment quality depends on the AI prompt. Bad prompts produce bad
wait hints or locator rankings.
*Mitigation:* The enrichment layer is additive. Bad hints are ignored by the
Playwright generator (it validates hint quality before using them). The
deterministic pipeline remains the baseline.

### R4: Execution JSON contract growth
Adding sections to the Execution JSON increases its surface area.
*Mitigation:* B5.2 §8.1 explicitly allows additive extension. New sections
are optional. Existing consumers are unaffected.

### R5: Generated code complexity
Executable fallback chains and smart waits make generated code more complex.
Users who prefer simple `page.click()` calls may find the enriched code
verbose.
*Mitigation:* Feature flag controls enrichment. When disabled, the generator
produces the current simple code. The `CmdRunner.resolve()` helper is small
(~15 lines) and can be inlined.

---

## 14. Future Evolution Roadmap

```
Phase G1: Executable fallback chains (no AI)
  ↓
Phase G2: AI enrichment layer (resilience + workflow context)
  ↓
Phase G3: Smart wait insertion (from recording evidence)
  ↓
Phase G4: Assertion generation (from workflow context)
  ↓
Phase G5: Runtime self-healing engine (CmdRunner execution wrapper)
  ↓
Phase G6: Cross-test optimization (shared setup, dependency analysis)
  ↓
Phase G7: Multi-engine support (Cypress, Selenium — via same ExecJSON)
```

### Relationship to Phase 2 (Semantic Interaction Architecture)

The Phase 2 architecture (Evidence Collector → Coalescer → Classifier) produces
richer Interaction Snapshots. These snapshots contain exactly the evidence
needed for AI enrichment:
- DOM mutations (→ wait hints)
- Value changes (→ semantic intent)
- Timing data (→ synchronization)
- Ancestor context (→ recovery hints)

The two architectures are complementary: Phase 2 improves recording,
this review improves generation. Together they create a pipeline where:
1. Recording captures rich evidence (Phase 2)
2. Classification assigns correct types (Phase 2)
3. Execution JSON carries the evidence (this review)
4. AI enriches the JSON with resilience data (this review)
5. Playwright generation produces resilient code (this review)

---

## 15. Consistency Review

### Against Product Foundation

| Decision | Consistent? |
|----------|-------------|
| Chrome Extension MV3 | ✅ No change to extension architecture |
| Side Panel UI | ✅ No change to UI |
| Deterministic execution | ✅ AI is optional enrichment; generation is deterministic given enriched JSON |

### Against B1-B2 (Artifact Generation)

| Decision | Consistent? |
|----------|-------------|
| Pipeline order: Timeline → Steps → JSON → Playwright | ✅ New stage is between JSON and Playwright (additive) |
| Generator contracts (pure functions) | ✅ AI enrichment is a new generator with its own contract |
| Batch persistence | ✅ Unchanged |
| Extension by addition | ✅ New generator added to registry |

### Against B4.4 (Locator Priority)

| Decision | Consistent? |
|----------|-------------|
| 5-category priority hierarchy | ✅ AI re-ranks WITHIN the hierarchy, doesn't replace it |
| Max 3 locators (primary + secondary + fallback) | ✅ Executable chain uses existing 3 locators |
| Disqualifiers (auto-gen IDs, CSS-in-JS) | ✅ Still applied before AI ranking |

### Against B5.1-B5.3 (Execution JSON)

| Decision | Consistent? |
|----------|-------------|
| 6-section contract | ✅ Unchanged — 2 optional sections added (B5.2 §8.1 allows) |
| Per-step error isolation | ✅ Unchanged |
| AI-free generation | ✅ AI enrichment is pre-generation; Playwright gen stays deterministic |

### Against B6 (Playwright Generator)

| Decision | Consistent? |
|----------|-------------|
| translateLocator / translateAction | ✅ Extended, not replaced |
| Deterministic output | ✅ Same enriched JSON → same code |
| One test() per Test Case | ✅ Unchanged |

### Against B7 (Readability Optimizer)

| Decision | Consistent? |
|----------|-------------|
| OR-1 merge rule | ✅ Unchanged |
| plainEnglish-only modification | ✅ Unchanged |

### Against C3-C6 (Interaction Types)

| Decision | Consistent? |
|----------|-------------|
| All interaction types | ✅ All preserved |
| Canonical step formats | ✅ Unchanged |
| Execution verbs | ✅ Unchanged |

### Overall consistency verdict

**ALL FROZEN DECISIONS PRESERVED.** The recommended architecture is purely
additive:
- New optional Execution JSON sections (not modifying existing 6)
- New optional generation stage (not replacing existing 3)
- New optional code patterns (fallback chains, smart waits) controlled by
  feature flags
- AI is enrichment, never replacement
- Deterministic generation is the baseline; AI enhances it

---

## Summary

### The problem

The current generation pipeline produces deterministic Playwright code but
that code is brittle: primary-locator-only, no fallback execution, no smart
waits, no recovery. Enterprise web applications evolve continuously, and
locator maintenance dominates test automation costs.

### The solution

An **AI Enrichment Layer** between the Execution JSON Generator and the
Playwright Generator that:
1. Adds a `resilience` section (ranked locator chain, wait hints, recovery data)
2. Adds a `workflowContext` section (intent, expected results, step grouping)
3. Is optional and feature-flagged — without AI, the pipeline runs unchanged

The Playwright Generator evolves to:
1. Emit executable fallback chains (try primary → try secondary → try fallback)
2. Insert smart waits derived from recording evidence
3. Generate optional assertions from workflow context

### Key principles

- **AI enriches, determinism executes.** AI adds data; the Playwright generator
  deterministically translates that data into code.
- **Additive only.** No existing contract, section, or field is modified.
- **Graceful degradation.** No AI = current behavior. No enrichment data =
  current code generation.
- **Executable resilience.** Fallback locators become code, not comments.

### Recommended implementation order

1. **G1: Executable fallback chains** (no AI, pure generator enhancement)
2. **G2: AI enrichment layer** (additive sections, feature-flagged)
3. **G3: Smart wait insertion** (from recording evidence)
4. **G4: Assertion generation** (from workflow context)
