# Step 2 Navigation Code Path Analysis (Pre-Validation)

**Date:** 2026-08-13
**Commit:** `cc830b1`
**Status:** Code analysis only — no modifications. Awaiting real-browser validation.

## What I Can and Cannot Test

I cannot install Chrome extensions in Playwright or test extension runtime behavior
(content script injection, service worker messaging, side panel). What I CAN do:
1. Trace every code path for correctness
2. Run all existing automated tests
3. Identify potential failure points from the code

## Full Navigation Code Path Trace

### Scenario 1: Link Click Navigation

1. User clicks a link
2. Content script: EventTap captures click → ObservedEvent → `sendObservedEvent()` → SW
3. SW: `handleObservedEvent()` → `runtime.process(event)` → Click definition → `completeComponent()` → `onEmit()`
4. SW `onEmit()`:
   - `enrichInteraction()`, `drainPendingEvidence()`, `liveInteractions.push()`, `persistLiveInteractions()`
   - `sendFinalizeEvidence(interaction)` → SW→CS `FINALIZE_EVIDENCE` message
   - `startEvidenceTimeout(interaction)` (300s emergency)
5. SW: runtime also sees the `navigation` event (from webNavigation API) → `flush()` interrupts active components
6. **Content script:** if the FINALIZE_EVIDENCE message arrives before pagehide → `finalizeForInteraction()` → `executeFinalization()` → `deliverEvidence()` → `bufferEvidence()` to sessionStorage
7. **pagehide fires:** `evidenceCollector?.onPageHide()` → finalizes any remaining lifecycle-bound windows → `bufferEvidence()`
8. **New page loads:** content script re-injects → `startRecording()` → `flushBufferedEvidence()` → replays from sessionStorage

### Scenario 2: Form Submission Navigation

1. User fills form (text inputs captured by lifecycle)
2. User clicks submit button
3. Click → Click definition completes → `onEmit()` → `sendFinalizeEvidence()`
4. Form submission triggers navigation
5. **pagehide fires:** `onPageHide()` finalizes any remaining lifecycle-bound windows (e.g., if text input lifecycle hadn't completed)
6. **New page loads:** `flushBufferedEvidence()` replays buffered evidence

### Scenario 3: Full-Page Reload (F5 / location.reload())

1. User has recorded interactions
2. Reload fires pagehide
3. `onPageHide()` finalizes lifecycle-bound windows
4. Evidence buffered to sessionStorage
5. New page: `flushBufferedEvidence()` replays

## Potential Issues Identified (Code Analysis)

### Issue A: FINALIZE_EVIDENCE race vs pagehide (CRITICAL for form-submit navigation)

During form-submit navigation, the sequence is:
1. Click submit → Click completes → `onEmit()` → `sendFinalizeEvidence()` (SW→CS message)
2. Browser starts navigation → `pagehide` fires

The `sendFinalizeEvidence()` uses `chrome.tabs.sendMessage()` which is async. If the
browser navigates (pagehide fires) before the FINALIZE_EVIDENCE message is delivered,
the content script's `onPageHide()` fires first. This is actually SAFE because:
- `onPageHide()` itself calls `executeFinalization()` for lifecycle-bound windows
- The `FINALIZE_EVIDENCE` message, if it arrives after pagehide, would be no-op (window already closed)

BUT: if the click evidence window is NOT lifecycle-bound (click windows opened via
`openWindow()` may not have a LIFECYCLE_BOUND binding yet), `onPageHide()` will skip it.

**Assessment:** For click evidence, the Click definition lifecycle should complete
before navigation starts. The FINALIZE_EVIDENCE message should arrive before pagehide.
This is a timing race that depends on browser behavior.

### Issue B: Non-lifecycle-bound windows are silently abandoned on pagehide

`onPageHide()` only finalizes `win.isLifecycleBound === true` windows. Any window
opened via `openWindow()` that hasn't received a LIFECYCLE_BOUND binding yet will
be silently lost. This affects:
- Click evidence windows (opened on click event, bound when LIFECYCLE_BOUND arrives)
- Navigation evidence windows (opened on navigation event)

**Risk:** If LIFECYCLE_BOUND arrives after the window is opened but before pagehide,
the window is bound and will be finalized. If not, it's lost. The timing window is:
- CS: click → `openWindow()` → window opened (NOT lifecycle-bound)
- SW: click → runtime → `createContext()` → `onLifecycleStart()` → `sendLifecycleBound()`
- CS: receives LIFECYCLE_BOUND → `handleLifecycleBound()` → marks window as lifecycle-bound

If pagehide fires between openWindow and LIFECYCLE_BOUND arrival, the window is lost.

**Likelihood:** Low — LIFECYCLE_BOUND is sent synchronously in createContext, which
happens immediately when the click event reaches the SW. The content script should
receive the binding within milliseconds.

### Issue C: flushBufferedEvidence fire-and-forget (no confirmation)

`flushBufferedEvidence()` replays evidence via `chrome.runtime.sendMessage()` with
fire-and-forget callback (swallows lastError). If the SW is not yet alive on the new
page (cold start), the evidence is lost — the key is removed from sessionStorage
unconditionally after replay.

**Risk:** If SW is cold-starting on the new page, the BEHAVIORAL_EVIDENCE messages
may not be received. The sessionStorage key is removed regardless.

**Assessment:** This is a real risk for cold-start scenarios. The SW should be
warm (same tab, MV3 keeps SW alive for 30s after last message). For form-submit
navigation, the SW was just processing the click → it's warm.

### Issue D: Navigation interaction itself may not get evidence

When a navigation event is processed by the runtime, `flush()` interrupts active
components. The Navigation definition claims the event and completes. But the
navigation event is dispatched to the SW via `sendObservedEvent()` which uses
the durable retry+buffer path. During navigation, the CS may be destroyed before
the event reaches the SW. The navigation event itself is buffered in
`cmdrunner_event_buffer` and flushed on the next page.

The Navigation lifecycle completes on the SW side → `sendFinalizeEvidence()` →
but the content script may already be destroyed. Evidence buffered to sessionStorage
won't be created because `onPageHide()` only processes lifecycle-bound windows,
and the navigation window wouldn't have been opened on the OLD page.

**Assessment:** Navigation evidence may rely on the SW-side synthetic evidence
(EMERGENCY_TIMEOUT) or pending evidence drain. This is likely the weakest path.

## Test Coverage

**ZERO tests exist for any Step 1 lifecycle-driven evidence code:**
- No tests for `onPageHide()`, `handleLifecycleBound()`, `finalizeForInteraction()`
- No tests for `bufferEvidence()`, `flushBufferedEvidence()`
- No tests for `executeFinalization()`, `finalizeWithoutWindow()`
- No tests for `holdOpen`, `setHoldOpen()`
- No tests for `LIFECYCLE_BOUND`, `FINALIZE_EVIDENCE` message handling

All 2,379 existing tests pass — but they test the OLD pre-lifecycle evidence flow.

## Summary

The navigation code paths are structurally sound but untested. The main risks are:
1. Timing races between FINALIZE_EVIDENCE and pagehide (likely OK for clicks, risky for form-submit)
2. Non-lifecycle-bound windows abandoned on pagehide (low risk due to fast LIFECYCLE_BOUND)
3. flushBufferedEvidence fire-and-forget (medium risk for cold-start)
4. Navigation evidence itself (weakest path, may need SW-side synthetic fallback)

Real-browser testing is REQUIRED to validate these paths. The code is ready as-is
in the current ZIP for manual testing.
