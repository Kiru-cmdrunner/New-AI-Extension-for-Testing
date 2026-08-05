# M1 Phase C — Observation Coordinator: Final Design

**Status:** IMPLEMENTED — all tests passing.
**Baseline:** a43df53 + Phase A + Phase B
**Phase C touches only Phase A+B files — ZERO baseline a43df53 files modified.**

---

## 0. Agreed Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | Use `document.contains(el)` for element-removal detection | More reliable than WeakRef GC timing. WeakRef kept for memory management (prevents leaks from long-gone elements). |
| D2 | Injectable `windowDurationMs` for tests, production fixed at 3000ms | Fast deterministic tests without fake timers. |
| D3 | Late timer/reset race guarded defensively | A timer firing after shutdown checks null dependencies + map lookup — returns safely. |
| D4 | `read(el)` method added to ElementStateCache | Final-state snapshot without modifying cached before-state. Prevents cache corruption when overlapping interactions occur near window-close time. |
| D5 | Event filtering stays in Phase D | Coordinator manages windows; Phase D decides which events qualify (click/change only). |
| D6 | Configure/runtime guards fail safely | If openWindow is called before configure, coordinator returns silently — never crashes the recorder. |
| D7 | PerformanceCondition in ObservationResult as optional diagnostic | Does NOT affect capture, classification, reliability, or window behaviour. |
| D8 | Shutdown finalizes all windows immediately | Read final state at recording-stop moment, collect captured mutations, emit result, clean up. Does NOT wait for remaining duration. Does NOT discard evidence. |

---

## 1. What Phase C Delivers

The **`ObservationCoordinator`** class connects Phase A and Phase B into one independent 3-second observation window per user interaction:

1. Reads before-state snapshot from the Phase A cache (`peek`)
2. Captures current state to the cache (`capture`)
3. Opens a window on the Phase B document observer (`start`)
4. Starts an independent timer
5. On close: reads final state (`read`, non-mutating), collects mutations, prunes buffer, stops observer, builds `ObservationResult`, delivers it via callback

---

## 2. Files Changed

### New Source File

| File | Lines | Responsibility |
|------|-------|----------------|
| `src/tap/observation-coordinator.ts` | 309 | ObservationCoordinator class — window lifecycle, cache coordination, observer coordination, timer management, result delivery. |

### New Test File

| File | Tests | Coverage |
|------|-------|----------|
| `tests/tap/observation-coordinator.test.ts` | 21 | Full lifecycle, before/after state, overlapping windows, rapid interactions, element removal, shutdown (4 scenarios), mutation evidence, performance condition. |

### Modified Files (Phase A files, not baseline)

| File | Change | Why |
|------|--------|-----|
| `src/tap/element-state-cache.ts` | Added `read(el)` method (+15 lines) | Non-mutating snapshot for final state (D4) |
| `src/shared/observation-types.ts` | Added `performanceCondition?` to `ObservationResult` (+10 lines) | Optional diagnostic (D7) |
| `tests/tap/element-state-cache.test.ts` | Added 2 tests for `read()` (+30 lines) | Coverage for new method |

### Baseline a43df53 Files Modified

**ZERO.** All changes are in Phase A+B files that we created.

---

## 3. Test Results

| Suite | Result |
|-------|--------|
| Phase C tests | **21/21 passed** |
| Phase A tests (updated) | **22/22 passed** (20 original + 2 new read tests) |
| Phase B tests | **16/16 passed** |
| Full regression | **3,437 passed, 0 failed** (144 test files) |

Breakdown: 3,378 baseline + 22 Phase A + 16 Phase B + 21 Phase C = 3,437 total.

---

## 4. Architecture

```
  openWindow(eventId, eventType, targetEl)
       │
       ▼
  ┌─ peek(targetEl) → beforeSnapshot ──────────────────────┐
  │  capture(targetEl) → updates cache for next interaction │
  │  Create ObservationWindow record                         │
  │  observer.start(windowId) → refcounted                  │
  │  setTimeout(windowDurationMs) → independent timer       │
  └──────────────────────────────────────────────────────────┘
       │
       │ ... 3 seconds of DOM activity ...
       │ (Phase B captures mutations with windowId attribution)
       │
       ▼
  closeWindow(windowId, reason)
       │
       ├─ Clear timer
       ├─ ref.deref() + document.contains(el)
       │   ├─ element alive → cache.read(el) → finalSnapshot
       │   └─ element gone → finalSnapshot=null, reason='element-removed'
       ├─ observer.getRecordsForWindow(windowId) → mutations (copies)
       ├─ observer.pruneWindowRecords(windowId) → remove exclusive records
       ├─ observer.stop(windowId) → refcounted (may keep alive for others)
       ├─ Build ObservationResult (immutable)
       ├─ Delete from windows map
       └─ onResult(result) → delivered to Phase D pipeline
```

---

## 5. closeWindow Order of Operations

| Step | Operation | Why This Order |
|------|-----------|----------------|
| 1 | Clear timer | Prevent double-close if shutdown races with timer |
| 2 | Read final state via `cache.read(el)` | Must happen while we have element access. Uses `read()` not `capture()` to avoid corrupting before-state for overlapping interactions. |
| 3 | Collect mutation records | Must happen before pruning (prune modifies buffer) |
| 4 | Prune buffer | Remove exclusive records, preserve shared with reduced attribution |
| 5 | Stop observer | Decrements refcount — disconnects when last window stops |
| 6 | Build result | Assemble immutable ObservationResult |
| 7 | Delete from maps | Internal cleanup |
| 8 | Deliver result | Last step — caller receives complete evidence |

---

## 6. Shutdown Behavior (D8)

When the user stops recording:
1. For each open window: call `closeWindow(id, 'recording-stopped')`
2. Each window gets: final state read at stop moment, all mutations captured so far, proper result emission
3. Then: null out cache, observer, onResult references
4. Late timers fire → find null dependencies → return safely (D3)

**Does NOT wait** for remaining window duration.
**Does NOT discard** captured evidence.

---

## 7. What Phase C Does NOT Do

| Excluded | Why |
|----------|-----|
| Wire into EventTap | Phase D's job |
| Wire into recorder-entry | Phase D's job |
| Filter which events open windows | Phase D's job (D5) |
| Send results to service worker | Phase D's job |
| Correlate with ComponentInteractions | Phase D's job |
| Classify mutations | M1 records evidence only |
| Modify any a43df53 baseline file | All changes in Phase A+B files only |

---

## 8. Current M1 Foundation

```
a43df53 (clean baseline, 3,378 tests)
  └── Phase A: element-state-cache.ts, observation-types.ts, state-cache-listeners.ts (+22 tests)
      └── Phase B: document-observer.ts (+16 tests)
          └── Phase C: observation-coordinator.ts (+21 tests)
```

3,437 tests, all passing. Ready for Phase D.
