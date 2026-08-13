# TD-8: TextEntry max-duration / partial value after long pause

## Symptom

User typed "Amanda" into a "First Name" field. After a ~10s pause during typing,
evidence showed `manda → empty` with `endReason: max-duration` instead of
`lifecycle-complete`.

## Root Cause (3 defects)

### D1 (root cause): AdaptiveWindow maxDurationTimer ignores holdOpen

**File:** `src/tap/adaptive-window.ts`, lines 108–110

The `maxDurationTimer` fires `close('max-duration')` unconditionally after 10
seconds, **even when `holdOpen === true`**. This violates the documented holdOpen
contract: "the window does not close on its own."

Lifecycle-bound typing windows (held open by LIFECYCLE_BOUND) are force-closed
at 10 seconds, preempting the FINALIZE_EVIDENCE path.

### D2: recordMutation() does not reset maxDurationTimer

**File:** `src/tap/adaptive-window.ts`, lines 116–132

`recordMutation()` resets the stabilization timer on each keystroke but never
resets the max-duration timer. The hard cap ticks from the original `arm()` time.

### D3: Typing extension never updates observedEvent

**File:** `src/tap/evidence-collector.ts`, lines 744–756

`handleTypingEvent` extension path calls `recordMutation()` but never updates
`state.observedEvent`. The enrichment fallback only sees the first keystroke's
`valueAfter`, not the final typed value.

## Failure Chain

```
T=0.1s  First input event → openWindow → arm() schedules max-duration for T=10.1s
T=1-9s  Each keystroke → recordMutation() → resets stabilization ONLY
T=10.1s ⚡ max-duration fires → close('max-duration') → evidence with partial value
T=12s   blur → lifecycle completes → FINALIZE_EVIDENCE → window already closed
        → finalizeWithoutWindow → second evidence → richness contest → wrong values
```

## Fix

### Fix 1 (D1+D2): AdaptiveWindow — respect holdOpen for max-duration timer

In `arm()`, when scheduling the max-duration timer, if `holdOpen` is true,
**skip the max-duration timer entirely**. The window will be closed by explicit
`close()` calls (FINALIZE_EVIDENCE, pagehide, etc.).

When `setHoldOpen(true)` is called after `arm()` (retroactive binding),
**clear the existing max-duration timer**.

In `recordMutation()`, when `holdOpen` is true, **clear the max-duration timer**
as a safety measure.

This makes the max-duration timer apply ONLY to non-lifecycle-bound windows
(the original M3 stabilization fallback path). Lifecycle-bound windows rely
entirely on the FINALIZE_EVIDENCE / pagehide paths, which is the v3 architecture.

### Fix 2 (D3): EvidenceCollector — update observedEvent on typing extension

In `handleTypingEvent`, when extending an existing window, update
`this.activeTypingWindow.observedEvent = observedEvent` so the P1-3 enrichment
fallback has the latest `valueAfter`.

## Files Changed

1. `src/tap/adaptive-window.ts` — Fix 1 (D1+D2)
2. `src/tap/evidence-collector.ts` — Fix 2 (D3)
3. `tests/tap/adaptive-window.test.ts` — Update existing max-duration test,
   add holdOpen + max-duration tests
4. `tests/tap/evidence-buffer-recovery.test.ts` or new test — D3 observedEvent update

## Acceptance Criteria

- [ ] AdaptiveWindow with `holdOpen=true` does NOT close on max-duration timer
- [ ] AdaptiveWindow with `holdOpen=false` still closes on max-duration (M3 behavior preserved)
- [ ] `setHoldOpen(true)` called after `arm()` clears the running max-duration timer
- [ ] `recordMutation()` on a holdOpen window does not schedule max-duration timer
- [ ] `handleTypingEvent` extension updates `observedEvent` to latest input event
- [ ] Existing 2,388 tests pass with no regressions
- [ ] TSC: 0 errors
- [ ] Build: clean ZIP

## Constraints

- Do NOT touch the frozen lifecycle bridge (LIFECYCLE_BOUND, FINALIZE_EVIDENCE,
  holdOpen scheduling, idle timeout, emergency timeout).
- Do NOT touch TD-1 through TD-7 fixes.
- Preserve all M1–M7 behavior for non-lifecycle-bound windows.
