# Playwright Generator — Milestone 2: IRStep → Playwright Code Line

**Date:** 2026-07-20
**Depends on:** Milestone 0 (reference IR plans), Milestone 1 (locator renderer)
**Design doc:** `.drytis/execution-ir-design.md`

---

## Goal

Validate that every `IRAction` maps to valid Playwright code. Implement `renderAction(step: IRStep, pageVar: string): string` — a pure function that produces the Playwright method call for a single step's action.

## IR Conventions Clarified (No Type Changes)

This milestone clarifies how existing IR fields are used for three actions. No new types or fields — these are documented conventions that make the existing `IRInput` union sufficient.

### WAIT — Duration via `input`

**Convention:** For `IRAction.WAIT`, the `input` field holds the wait duration in milliseconds as a number. `executionParameters.timeoutMs` is NOT the wait duration — it's the action execution ceiling.

| Before (wrong) | After (correct) |
|---|---|
| `input: null`, `timeoutMs: 3000` | `input: 3000`, `timeoutMs: 30000` (default) |

### TOGGLE — Desired State via `input`

**Convention:** For `IRAction.TOGGLE`, the `input` field holds the desired checkbox/switch state:

| `input` value | Business intent | Playwright method |
|---|---|---|
| `true` | Ensure checked (idempotent) | `.check()` |
| `false` | Ensure unchecked (idempotent) | `.uncheck()` |
| `null` | Literal toggle (flip current state) | `.click()` |

### SELECT_DATE — No change needed

`input` holds the date string (ISO format recommended). Adapter maps to `fill()`. No IR refinement required.

## Action Mapping Table

| IRAction | Playwright Code | Notes |
|---|---|---|
| `CLICK` | `locator.click()` | |
| `FILL` | `locator.fill('value')` | Escape input value |
| `SELECT` | `locator.selectOption('value')` | Escape input value |
| `SELECT_DATE` | `locator.fill('date')` | Same as FILL for native date inputs |
| `TOGGLE` (true) | `locator.check()` | Idempotent |
| `TOGGLE` (false) | `locator.uncheck()` | Idempotent |
| `TOGGLE` (null) | `locator.click()` | Literal toggle |
| `HOVER` | `locator.hover()` | |
| `NAVIGATE` | `page.goto('url')` | URL from UrlTarget |
| `VERIFY` | *(no action line)* | Assertions only (Milestone 3) |
| `WAIT` | `page.waitForTimeout(ms)` | Duration from input |
| `WAIT_FOR_ELEMENT` | *(skip — no output)* | Playwright auto-waits (P1) |

## ExecutionParameters Mapping (V1)

| Field | Playwright | Notes |
|---|---|---|
| `timeoutMs` | `{ timeout: ms }` option on action methods | Applied to element-interacting actions |
| `retryCount` | *(not mapped in V1)* | Playwright has no built-in action retry; deferred |
| `retryDelayMs` | *(not mapped in V1)* | Paired with retry |
| `waitStrategy` | *(implicit)* | Playwright auto-waits; 'none' could suppress but V1 keeps default behavior |

## Files to Create/Modify

### Create
- `src/adapters/playwright/action-renderer.ts` — `renderAction(step, pageVar)` pure function
- `tests/adapters/playwright/action-renderer.test.ts` — Comprehensive tests per IRAction

### Modify
- `src/adapters/playwright/__fixtures__/reference-ir-plans.ts` — Update WAIT and TOGGLE plans to use new conventions
- `.drytis/execution-ir-design.md` — Document WAIT and TOGGLE input conventions

## Acceptance Criteria

- [ ] AC-1: `renderAction()` is a pure function with no side effects
- [ ] AC-2: CLICK renders `locator.click()` with correct locator expression
- [ ] AC-3: FILL renders `locator.fill('value')` with escaped input
- [ ] AC-4: SELECT renders `locator.selectOption('value')` with escaped input
- [ ] AC-5: SELECT_DATE renders `locator.fill('date')` (validates no native Playwright date API needed)
- [ ] AC-6: TOGGLE with `input: true` renders `locator.check()`
- [ ] AC-7: TOGGLE with `input: false` renders `locator.uncheck()`
- [ ] AC-8: TOGGLE with `input: null` renders `locator.click()`
- [ ] AC-9: HOVER renders `locator.hover()`
- [ ] AC-10: NAVIGATE renders `page.goto('url')` from UrlTarget
- [ ] AC-11: VERIFY renders empty string (no action line — assertions deferred to M3)
- [ ] AC-12: WAIT renders `page.waitForTimeout(ms)` with duration from `input` field
- [ ] AC-13: WAIT_FOR_ELEMENT renders empty string (Playwright auto-waits)
- [ ] AC-14: Element-interacting actions include `{ timeout: ms }` from executionParameters.timeoutMs
- [ ] AC-15: Reference plans updated: WAIT uses `input` for duration, TOGGLE uses `input` for desired state
- [ ] AC-16: All reference plan actions render without errors (full suite validation)
- [ ] AC-17: Adapter imports ONLY from domain/enums and domain/execution-ir/types (§4.4 boundary)
- [ ] AC-18: All tests pass, zero regressions
