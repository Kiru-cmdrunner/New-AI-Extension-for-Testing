# Lifecycle-Driven Evidence Finalization (v3)

## Overview

Connect the ComponentRuntime lifecycle to EvidenceCollector finalization via two SW→CS messages: `LIFECYCLE_BOUND` (lifecycle started) and `FINALIZE_EVIDENCE` (lifecycle completed). This replaces the 300ms stabilization timer and 5s evidence timeout as the primary evidence delivery mechanism.

## Acceptance Criteria

- [ ] AdaptiveWindow supports holdOpen mode (stabilization timer re-arms indefinitely)
- [ ] LIFECYCLE_BOUND message sent from SW when createContext fires
- [ ] FINALIZE_EVIDENCE message sent from SW when onEmit fires
- [ ] EvidenceCollector.handleLifecycleBound() marks windows as lifecycle-bound
- [ ] EvidenceCollector.finalizeForInteraction() delivers evidence on lifecycle completion
- [ ] Companion event suppression prevents orphan evidence windows
- [ ] onPageHide finalizes all lifecycle-bound windows immediately
- [ ] ComponentRuntime stale eviction uses idle-time, not total-duration
- [ ] Existing M1–M6 tests all pass unchanged
- [ ] tsc 0 errors
- [ ] Extension builds cleanly
- [ ] Real browser: text input shows complete value
- [ ] Real browser: dropdown shows selected value
- [ ] Real browser: date picker shows selected date
- [ ] Real browser: checkbox/radio still work
- [ ] Real browser: click evidence still works
- [ ] Real browser: navigation preserves evidence

## Files Modified

1. `src/tap/adaptive-window.ts` — holdOpen flag
2. `src/tap/evidence-collector.ts` — lifecycle binding + finalization + pagehide + companion suppression
3. `src/runtime/component-runtime.ts` — idle-time stale eviction + onLifecycleStart callback
4. `src/runtime/sw-integration.ts` — send LIFECYCLE_BOUND + FINALIZE_EVIDENCE, 300s emergency timeout
5. `src/recorder/phase5/recorder-entry.ts` — handle LIFECYCLE_BOUND + FINALIZE_EVIDENCE messages
6. `src/shared/component-types.ts` — onLifecycleStart in RuntimeConfig, lastActivityTime in ComponentContext
7. `src/shared/messaging.ts` — new message types

## Design Rules

- Evidence is finalized on lifecycle completion, not timer expiration
- User can take unlimited time between actions
- 300s idle timeout exists only as crash/leak protection
- Window-to-lifecycle correlation uses event IDs, not elementKey
- Companion events (click after mousedown completion) are suppressed for 300ms
- pagehide triggers immediate finalization + sessionStorage buffering
