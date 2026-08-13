# M8.3 — Service Worker Restart Recovery

## Overview

Make MV3 service worker restart recovery deterministic for:
1. Pending evidence (finalized evidence awaiting interaction emission)
2. Evidence timeout reconstruction (emergency safety net timers)
3. Lifecycle bridge callbacks (LIFECYCLE_BOUND + FINALIZE_EVIDENCE)

Currently `restoreFromStorage()` restores liveInteractions, evidenceLedger, and
runtime snapshot — but does NOT restore pendingEvidence, does NOT reconstruct
evidenceTimeouts for interactions lacking evidence, and does NOT include
`onLifecycleStart` / `sendFinalizeEvidence` in the restored runtime config.

## Problems Fixed

### Bug 1: Pending evidence lost on SW restart
`storePendingEvidence()` adds to an in-memory Map. On SW restart, this Map is empty.
If evidence arrived before the interaction was emitted, and the SW restarts before
the interaction emits, that evidence is permanently lost.

**Fix:** Persist the pendingEvidence Map to chrome.storage.local on every store.
Restore it in `restoreFromStorage()`. Clear it in `resetState()`.

### Bug 2: Evidence timeouts not reconstructed
After SW restart, `restoreFromStorage()` restores `liveInteractions` but does not
start evidence timeout timers for interactions lacking `behavioralEvidence`. These
interactions will NEVER get timeout evidence.

**Fix:** After restoring liveInteractions and runtime, iterate through interactions
and call `startEvidenceTimeout()` for any that lack `behavioralEvidence`.

### Bug 3: Lifecycle bridge broken after SW restart
The restored `RuntimeConfig` (lines 677-688) is missing `onLifecycleStart` callback.
The `onEmit` callback is also missing the `sendFinalizeEvidence(interaction)` call.
After SW restart, no LIFECYCLE_BOUND or FINALIZE_EVIDENCE messages are sent.

**Fix:** Restore the exact same config shape as `initRecording()` — add
`onLifecycleStart: (ctx) => sendLifecycleBound(ctx)` and add
`sendFinalizeEvidence(interaction)` to the `onEmit` callback.

## Design Constraints

- **Throttle pending evidence persistence:** Use a debounce on the persist call to
  avoid excessive storage writes on high-churn apps. The Map is capped at 100 entries,
  so worst case is 100 writes per recording session — acceptable, but debounce
  collapses bursts.
- **Non-blocking:** All persistence is fire-and-forget (`.catch(() => {})`), same
  as existing `persistLiveInteractions()`.
- **Frozen architecture:** The `LIFECYCLE_BOUND` / `FINALIZE_EVIDENCE` message format,
  `holdOpen`, `sendLifecycleBound`, `sendFinalizeEvidence` functions are UNCHANGED.
  We only fix which config they appear in (restored vs init).

## Files to Change

1. `src/runtime/sw-integration.ts` — persist/restore pendingEvidence,
   reconstruct timeouts, fix restored config
2. `tests/sw-restart-recovery.test.ts` — NEW: focused tests

## Acceptance Criteria

- [ ] Pending evidence survives SW restart (persisted to storage, restored)
- [ ] After restart, pending evidence is drained when interactions emit
- [ ] After restart, interactions lacking evidence get fresh timeout timers
- [ ] After restart, LIFECYCLE_BOUND is sent for new lifecycles
- [ ] After restart, FINALIZE_EVIDENCE is sent for emitted interactions
- [ ] pendingEvidence persistence is capped (does not exceed MAX_PENDING_EVIDENCE)
- [ ] resetState() clears persisted pending evidence
- [ ] All existing tests pass unchanged
- [ ] TSC 0 errors
