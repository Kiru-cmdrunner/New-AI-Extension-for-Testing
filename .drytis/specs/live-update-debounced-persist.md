# Task: Restore Debounced Live Side Panel Updates (5-Second Interval)

> **Date:** 2026-08-09
> **Status:** Implementation Spec
> **Commit context:** d12a790 on capability-v1-complete

## Problem

Fix 24 turned `schedulePersist()` into a complete no-op to eliminate the Mojo IPC
crash vector. The 60-second checkpoint alarm (TD-003) was meant to replace it for
MV3 recovery, but it also became the only mechanism for side-panel live updates.
For recordings under 60 seconds (most test recordings), the side panel never
updates during recording — interactions only appear at Stop.

## Solution

Restore a debounced `setTimeout` in `schedulePersist()` that writes the **slimmed
tail** (not the full array) to `chrome.storage.local` every 5 seconds. This
triggers `chrome.storage.onChanged` → side panel renders. The 60-second alarm
stays as backup for MV3 recovery.

## Files Changed

1. `src/runtime/sw-integration.ts` — restore debounced timer in `schedulePersist()`

## Acceptance Criteria

### Core behavior
- [ ] `schedulePersist()` starts a 5-second debounce timer (not immediate write)
- [ ] Multiple interactions within 5 seconds coalesce into a single write
- [ ] Timer writes only the slimmed tail (max 200 interactions, eventId-only nested fields)
- [ ] Timer cancels if `isRecording` becomes false before it fires
- [ ] Timer does NOT write to storage if no interactions were captured (dirty flag check)
- [ ] The 60-second checkpoint alarm (TD-003) remains unchanged
- [ ] `flushPersist()` at Stop Recording still writes the full final state
- [ ] `performCheckpoint()` still works as the MV3 recovery backup

### Safety guarantees (must NOT regress)
- [ ] No `chrome.runtime.sendMessage` per-event broadcasts (INV-IPC-2 preserved)
- [ ] No side panel `chrome.runtime.onMessage` listener during recording (INV-IPC-3 preserved)
- [ ] No `chrome.storage.local.set` per-event (debounce coalesces to 1 write per 5s)
- [ ] Persisted payload is the slimmed tail (max 200, eventId-only) — NOT the full array
- [ ] No change to recorded interaction data, generated test code, or IR plan

### Regression
- [ ] All existing tests pass (2,948 tests)
- [ ] Build succeeds with 0 TypeScript errors
- [ ] Extension ZIP builds correctly
