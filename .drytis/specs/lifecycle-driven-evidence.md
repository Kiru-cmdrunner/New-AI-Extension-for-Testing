# Lifecycle-Driven Evidence Finalization (v3)

## Overview

Connect the ComponentRuntime lifecycle to EvidenceCollector finalization via two SW→CS messages: `LIFECYCLE_BOUND` (lifecycle started) and `FINALIZE_EVIDENCE` (lifecycle completed). This replaces the 300ms stabilization timer and 5s evidence timeout as the primary evidence delivery mechanism.

## ARCHITECTURE FROZEN

**Frozen at:** `cc830b1` (tag: `lifecycle-architecture-frozen`)
**DO NOT modify:** LIFECYCLE_BOUND, FINALIZE_EVIDENCE, holdOpen, idle-time stale eviction, or any lifecycle bridge code.

## Step 1 — Lifecycle Bridge (COMPLETED, REAL-BROWSER VALIDATED)

**Commit:** `cc830b1` (tag: `step1-validated-browser`, `lifecycle-architecture-frozen`)
**Status:** ✅ All acceptance criteria validated in real Chrome browser

### Acceptance Criteria

- [x] AdaptiveWindow supports holdOpen mode (stabilization timer re-arms indefinitely)
- [x] LIFECYCLE_BOUND message sent from SW when createContext fires
- [x] FINALIZE_EVIDENCE message sent from SW when onEmit fires
- [x] EvidenceCollector.handleLifecycleBound() marks windows as lifecycle-bound
- [x] EvidenceCollector.finalizeForInteraction() delivers evidence on lifecycle completion
- [x] Companion event suppression prevents orphan evidence windows
- [x] onPageHide finalizes all lifecycle-bound windows immediately
- [x] ComponentRuntime stale eviction uses idle-time, not total-duration
- [x] Existing M1–M6 tests all pass unchanged (2,379 tests, 110 files)
- [x] tsc 0 errors
- [x] Extension builds cleanly (v10.9.0, 34 files, 125.2 KB)
- [x] Real browser: text input shows complete value ✅
- [x] Real browser: dropdown shows selected value ✅
- [x] Real browser: date picker shows selected date ✅
- [x] Real browser: checkbox/radio still work ✅
- [x] Real browser: click evidence still works ✅
- [x] Real browser: navigation preserves evidence ✅ (Amazon: search submit + add-to-cart)

### Real-Browser Results

| Scenario | Status | Notes |
|----------|--------|-------|
| Text input (slow typing) | ✅ PASS | Complete values captured |
| Custom dropdown | ✅ PASS | No 5s timeout, correct value |
| Date picker | ✅ PASS | No 5s timeout, correct date |
| Checkbox/Radio | ✅ PASS | Regression-free |
| Click evidence | ✅ PASS | Regression-free |
| Navigation (form-submit) | ✅ PASS | Amazon search: click evidence preserved with lifecycle-complete |
| Navigation (button-click) | ✅ PASS | Amazon add-to-cart: click evidence preserved with lifecycle-complete |
| Navigation (F5 reload) | ⬜ DEFERRED | sessionStorage recovery path untested (TD-7) |

## Files Modified

1. `src/tap/adaptive-window.ts` — holdOpen flag
2. `src/tap/evidence-collector.ts` — lifecycle binding + finalization + pagehide + companion suppression
3. `src/runtime/component-runtime.ts` — idle-time stale eviction + onLifecycleStart callback
4. `src/runtime/sw-integration.ts` — send LIFECYCLE_BOUND + FINALIZE_EVIDENCE, 300s emergency timeout
5. `src/recorder/phase5/recorder-entry.ts` — handle LIFECYCLE_BOUND + FINALIZE_EVIDENCE messages
6. `src/shared/component-types.ts` — onLifecycleStart in RuntimeConfig, lastActivityTime in ComponentContext
7. `src/shared/types.ts` — new message types

## Design Rules

- Evidence is finalized on lifecycle completion, not timer expiration
- User can take unlimited time between actions
- 300s idle timeout exists only as crash/leak protection
- Window-to-lifecycle correlation uses event IDs, not elementKey
- Companion events (click after mousedown completion) are suppressed for 300ms
- pagehide triggers immediate finalization + sessionStorage buffering

## Technical Debt (7 items — see `.drytis/notes/technical-debt-register.md`)

TD-1 through TD-7 deferred for post-lifecycle systematic resolution.
