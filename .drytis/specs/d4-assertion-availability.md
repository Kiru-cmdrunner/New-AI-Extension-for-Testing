# D4 — Assertion Availability Honesty

## Requirement
Clearly indicate when assertions are unavailable instead of implying they exist.

## Root cause
- `src/generation/ir-bridge.ts:277–288` — `deriveAssertions()` stub returns `[]` unconditionally
  (Track 3; `enrichment.elementAssertions` has no writer anywhere in `src/`).
- `src/background/service-worker.ts:575–584` — `buildIRPlan` called without `enrichment`.
- Consequence: every `IRStep.assertions === []` in every plan, forever.

Surfaces that imply otherwise (fixed by this change):
1. Generated Playwright spec: `import { test, expect }` with zero `expect()` call sites.
2. Side panel IR steps: `sidepanel.ts:547–552` silently omits the Assertions row.
3. Execution results: summary + per-step rows imply an asserted run; nothing states 0 checks.

NOT in scope (explicitly excluded):
- `assertion-renderer.ts` (File 4 dropped per user decision 2026-08-17).
- ir-bridge.ts, service-worker.ts, IR types, executor, storage schema.
- D5/D9/D10/D2/D3/D8/E1 surfaces. E1-prep uncommitted files untouched.

## Files to change
1. `src/adapters/playwright/test-function-renderer.ts`
   - `renderTestBody()` (flat): when EVERY rendered step has `assertions.length === 0` and at
     least one step rendered, emit one banner line at the top of the body:
     `// NOTE: No assertions generated — assertion derivation is not available. This test replays actions only.`
   - `renderPomTestBody()` (POM): identical banner, same condition.
   - Banner is file-level (once), not per-step. Import line unchanged.
2. `src/sidepanel/sidepanel.ts`
   - `renderIRSteps()`: else-branch when a step has zero assertions renders
     `Assertions: none — not derived for this recording` (class `step-card__unavailable`).
   - `renderExecutionResult()`: after status row, when stepResults non-empty and ALL steps
     have empty `assertionResults`, add row `Assertions: none evaluated — replay-only run (0 checks)`.
   - No type/interface changes; derivations local to render functions.
3. `src/sidepanel/sidepanel.css`
   - Add `.step-card__unavailable` + `.repo-status__unavailable` muted (dim) styles, mirroring
     the existing `.evidence-row--muted` precedent (line ~1973).

## Acceptance criteria
- [ ] Flat spec render: all-unasserted plan → banner present exactly once; no banner when any step asserted.
- [ ] POM render: same two conditions.
- [ ] `import { test, expect }` line unchanged in all cases.
- [ ] Side panel step card with 0 assertions shows the "none — not derived" row (class step-card__unavailable).
- [ ] Step card with ≥1 assertion keeps existing "Assertions: …" rendering (no regression).
- [ ] Execution summary with all-empty assertionResults shows the "none evaluated — replay-only" row.
- [ ] Execution summary with ≥1 non-empty assertionResults does NOT show the row.
- [ ] tsc --noEmit clean; full vitest suite passes; npm run build succeeds.
- [ ] Real-Chrome: recorded flow → IR steps all show none-marker; generated spec contains banner,
      zero `expect(` call sites; Run Test → replay-only row visible; zero console errors.
- [ ] Only the 3 approved files + 2 new test files modified (scope audit).

## Tests
New `tests/generation/d4-assertion-availability.test.ts` (pure): flat banner present/absent,
POM banner present/absent, mixed plan, exactly-once, import intact, no expect() call sites.
New `tests/sidepanel/d4-assertion-availability.test.ts` (jsdom): renderIRSteps else-branch +
asserted regression; renderExecutionResult none-row + non-empty regression.
Red phase confirmed before implementation.
