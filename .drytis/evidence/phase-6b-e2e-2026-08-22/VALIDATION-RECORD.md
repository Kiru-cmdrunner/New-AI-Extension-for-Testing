# Phase 6B — Real-Chrome E2E + Closure Validation Record

**Date:** 2026-08-22 (22:45–22:50 UTC)
**Tree:** capability-surgical-removal @ 153f5c2 + uncommitted 6B diff (verified-clean audit earlier this session)
**Baseline:** 153f5c2 · Suite @ baseline: 246 files / 4,351 tests · tsc: 8 pre-existing errors
**Closes:** AC7, AC10, AC11 (evidence half — reviewer/infra_verifier reports follow separately), AC9 (live re-run)

---

## 1. Static: dist build from the exact 6B tree

- `rm -rf dist && npm run build` → clean; ZIP v10.9.0 (38 files, 287.7 KB)
- Marker checks (`static-checks.txt`): recorder bundle carries `data-auto-id` identity capture; SW bundle carries `data-auto-id` + family-tagged `[data-(cy|qa|auto-id)=…]` forms — 7/7 PASS
- Known pre-existing defect (documented, out of scope): executor content script never emitted into dist (Phase 12.4; `DEFECT-executor-content-script-missing-from-dist.md`) — not a 6B regression; 6B's executor changes are covered by `executor-family-parity.test.ts` + `locator-resolver` unit pins.

## 2. Real-Chrome E2E (`real-chrome-run1.log` + `dumps/`)

Harness: `6b-locator-e2e.mjs` (CDP, extension loaded from `/workspace/dist`, record via panel → stop via real stop button). Page under test exposes the four 6B target classes:

- `input#q[data-auto-id="search-input"]` (alternate test-ID family)
- `button[data-cy="search-btn"]` (data-cy family)
- `button[data-testid="clear-btn"]` (default family — must stay bare)
- `i.icon-plus[role=button]` (class-only icon, O9 class)

**Result: 7/7 PASS.**

| # | Check | Result |
|---|---|---|
| 1 | recording produced cards | PASS (4 cards) |
| 2 | IR steps rendered | PASS (9 steps incl. ancillary) |
| 3 | AC10: `data-auto-id` → `page.locator('[data-auto-id="search-input"]')` | PASS |
| 4 | AC10: `data-cy` → `page.locator('[data-cy="search-btn"]')` | PASS |
| 5 | AC10: `data-testid` stays `getByTestId('clear-btn')` (bare, STAB) | PASS |
| 6 | AC10: class-only icon uses `[class~="icon-plus"]` (no nth-of-type) | PASS |
| 7 | AC10: no nth-of-type fallback anywhere | PASS |

Correction over the original 7/7 claim: the previous session's run was never archived (no log, no dumps). This session re-ran the harness from a freshly rebuilt dist and archived everything; all 7 checks PASS. The full generated spec (`dumps/6b-generated.txt` → `recorded-test.spec.ts`) contains all four family strategies correctly rendered:

```ts
await page.locator('[data-auto-id="search-input"]').fill('invoice')
await page.locator('[data-cy="search-btn"]').click()
await page.getByTestId('clear-btn').click()          // default family stays bare (STAB)
await page.locator('[class~="icon-plus"]').click()   // O9 icon class — no nth-of-type
```

## 3. Suite + tsc on the exact 6B tree

- `npx vitest run` → **250 files / 4405 tests, 0 failed** (98.76s) — `suite-6b-tree.txt`
- `npx tsc --noEmit` → **exactly 8 errors, all pre-existing** (same files as Stage-0 lock: ir-executor-navigate ×5, ir-bridge-repeated-clicks, resulting-state-seeded-display, changed-element-seed-honesty) — `tsc-6b-tree.txt`

## 4. Doctrine tripwire

`tests/doctrine/genericity-pin.test.ts` green in the suite run (site tokens in comments only). New 6B class-token filters are purely structural — no site tokens introduced.

## 5. Artifacts

- `static-checks.txt` — dist marker checks (7 PASS)
- `real-chrome-run1.log` — full harness output (7/7)
- `dumps/6b-panel.json` — panel state post-stop (4 cards / 9 IR steps)
- `dumps/6b-generated.txt` — SW `generated_files` (full generated spec)
- `suite-6b-tree.txt`, `tsc-6b-tree.txt` — live run logs

## 6. Verdict

AC7 ✅ (icon-plus class candidate, 0.72, live) · AC9 ✅ · AC10 ✅ (7/7) · AC11 evidence-half ✅ (reports below) — remaining: reviewer + infra_verifier PASS records, then owner gate → commit.

---

## 7. Closure addendum (post-commit, same day)

- AC11: reviewer report — PASS on all applicable criteria (AC1–AC4, AC6–AC10, STAB) + security (selector-injection charset, escape paths) + doctrine containment (diff confined to specced files; no site tokens; tripwire green). infra_verifier — RESULT: PASS (0 failures; 2 non-blocking warnings: pre-existing preview-URL fixture in tests/integration/form-submit-e2e.test.ts:64 — documented in DEFECT-preview-url-hardcoded-in-form-submit-e2e-test.md; uncommitted-work branch-drift observation now resolved by these commits).
- AC12: roadmap updated (6B SHIPPED; 6D.1 owns L4 remainder; dataAutoId fuzzy-matching → 6D/7.1 backlog). ZIP v10.9.0 from the 6B tree, md5 7dd37d092eee5fed1b49a88ee6f514ad, pinned under owner gate.
- Commits: implementation 72bb6ed (src + tests only), docs/evidence/roadmap 112368f. Branch unpushed per owner directive — local milestone closure first.
- Reviewer WARN-2 (executor extractElementIdentity data-auto-id "" vs null normalization drift) and WARN-3 (forward-compatible data-test/data-test-id alternation surface) recorded as backlog observations — no action this phase.
