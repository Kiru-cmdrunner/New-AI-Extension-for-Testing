# Fix A: Await-Before-Ack for OBSERVED_EVENTS_BATCH

## Status: PROPOSED
## Date: 2026-08-09

## Problem

The `OBSERVED_EVENTS_BATCH` handler in `service-worker.ts` (line 829) fires
`sendResponse({ ok: true })` synchronously before `handleObservedEvent()` has
completed:

```typescript
case 'OBSERVED_EVENTS_BATCH': {
  const msg = message as { type: string; payload: ObservedEvent[] };
  for (const ev of msg.payload) {
    handleObservedEvent(ev);   // async, NOT awaited — fire-and-forget
  }
  sendResponse({ ok: true });   // fires IMMEDIATELY, before processing
  return true;
}
```

`handleObservedEvent()` is `async` — it `await`s `ensureSessionRestored()`
before calling `processObservedEvent()`. JavaScript `await` always yields to
the microtask queue, so `sendResponse` executes on the synchronous stack while
actual processing is deferred.

This means `{ok:true}` means "message received," NOT "event processed."

The content script removes events from the durable buffer on `ok:true`:

```typescript
for (const ev of batch) {
  removeFromBuffer(ev.eventId);
}
```

If the SW terminates (MV3 idle timeout, memory pressure, crash) during the
microtask gap between `ok:true` and `processObservedEvent()`, the events are
permanently lost — removed from the buffer but never processed.

This pattern was inherited from commit `046f140` (the GDrive baseline), where
the single `OBSERVED_EVENT` handler had the same issue. The crash-fix commits
(6716057, Fix 29) wrapped the same fire-and-forget pattern in a batch loop
without changing the acknowledgment semantics.

## Current Behavior (before fix)

1. CS sends `{type:'OBSERVED_EVENTS_BATCH', payload:[ev1, ev2, ...]}`
2. SW handler iterates batch: calls `handleObservedEvent(ev)` for each — returns Promise, discarded
3. SW handler calls `sendResponse({ok:true})` synchronously
4. SW microtask queue: `handleObservedEvent` resolves → `processObservedEvent(ev)` runs
5. CS callback fires with `{ok:true}` → `removeFromBuffer(ev.eventId)` for each
6. **Race window:** between steps 3 and 4, if SW dies, events are lost

## Proposed Change (Fix A)

Change ONLY the `OBSERVED_EVENTS_BATCH` handler to follow the same async pattern
already established for `BEHAVIORAL_EFFECTS_BATCH`:

```typescript
case 'OBSERVED_EVENTS_BATCH': {
  const msg = message as { type: string; payload: ObservedEvent[] };
  Promise.all(msg.payload.map((ev) => handleObservedEvent(ev)))
    .then(() => sendResponse({ ok: true }))
    .catch(() => sendResponse({ ok: false }));
  return true;
}
```

### What changes
- `sendResponse({ok:true})` now fires AFTER all `handleObservedEvent()` calls complete
- `sendResponse({ok:false})` fires if any event processing throws
- `return true` keeps the async response channel open (unchanged)

### What does NOT change
- Batch delivery (BATCH_FLUSH_MS = 500ms) — unchanged
- IPC frequency (~2 sendMessage/sec) — unchanged
- Storage persistence (5s live-update, 60s checkpoint, stop-time flush) — unchanged
- Side-panel communication (no broadcasts) — unchanged
- Classification, projection, cursorPointer — unchanged
- Retry behavior in content script — unchanged
- Durable buffer lifecycle — unchanged

## New Semantics

| Before | After |
|---|---|
| `ok:true` = "message received" | `ok:true` = "all events processed" |
| Events removed from buffer before processing | Events removed from buffer only after processing completes |
| SW death during processing → permanent data loss | SW death during processing → events survive in buffer for retry |

If the SW dies before `sendResponse` fires, the CS retry loop (5 attempts,
exponential backoff 100ms–1600ms) re-delivers the batch. The Evidence Ledger's
eventId-based dedup ensures no double-counting on redelivery.

## Acceptance Criteria

- [ ] AC1: `{ok:true}` is NOT sent before `handleObservedEvent()` completes
- [ ] AC2: A failed event (throw inside handleObservedEvent) produces `{ok:false}`
- [ ] AC3: Content-script buffer is removed only after successful acknowledgment
- [ ] AC4: An unacknowledged batch (SW dies before ack) remains recoverable via durable buffer
- [ ] AC5: Multiple events in one batch are ALL processed before acknowledgment
- [ ] AC6: Existing batching behavior (BATCH_FLUSH_MS, pendingEventBatch) unchanged
- [ ] AC7: Existing retry behavior (5 retries, exponential backoff) unchanged
- [ ] AC8: BEHAVIORAL_EFFECTS_BATCH handler unchanged
- [ ] AC9: BEHAVIORAL_EFFECTS handler unchanged
- [ ] AC10: No per-event sendMessage restored
- [ ] AC11: No INTERACTION_CAPTURED broadcast restored
- [ ] AC12: No INTERACTION_EFFECTS_UPDATE broadcast restored
- [ ] AC13: No side-panel onMessage listener added
- [ ] AC14: No new storage writes during recording
- [ ] AC15: BATCH_FLUSH_MS unchanged (500ms)
- [ ] AC16: 5-second live-update persistence unchanged
- [ ] AC17: cursorPointer unchanged
- [ ] AC18: TD-001 through TD-012 unchanged

## Regression Requirements

- All 3,005 existing tests must pass
- TypeScript: 0 errors
- Build: 32 files, extension ZIP
- Crash vectors (INV-IPC-1, INV-IPC-2, INV-IPC-3) remain disabled

## Files Changed

- `src/background/service-worker.ts` — OBSERVED_EVENTS_BATCH handler (3 lines)
- `tests/runtime/await-before-ack.test.ts` — new test file
