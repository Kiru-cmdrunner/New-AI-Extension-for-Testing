# Controlled A–F Analysis: OrangeHRM Slowdown Root Cause

## Executive Summary

**The M1 observation infrastructure (Phases A–E) is NOT the primary cause of the slowdown.**
The root cause is the **pre-existing per-event pipeline** (a43df53) that was already present BEFORE M1.
M1 adds only +73µs to clicks (10% overhead) and +5µs to mousedown/focus events (negligible).

The real bottleneck is the **sessionStorage buffer**, which does a full JSON.parse + JSON.stringify
of the entire buffer on EVERY event. At 20fps mousemove alone, this consumes 10–44ms/sec of main thread time.

## Per-Event Cost Breakdown

| Component | Per Event | Source | Layer |
|---|---|---|---|
| resolveTarget (2x) | ~8µs | event-tap.ts | **a43df53 BASELINE** |
| extractIdentity (CSS+XPath+name+ancestors) | ~250µs | identity-extractor.ts | **a43df53 BASELINE** |
| extractDomContext (10-deep ancestor walk ×2) | ~20µs | dom-context-extractor.ts | **a43df53 BASELINE** |
| pushToBuffer (JSON.parse+stringify) | ~250–1900µs | recorder-entry.ts | **a43df53 BASELINE** |
| chrome.runtime.sendMessage | ~???µs (IPC) | recorder-entry.ts | **a43df53 BASELINE** |
| Phase A cache.capture() | ~5µs | M1 only (mousedown/focus) | **M1 ADDITION** |
| openWindow (path+capture) | ~69µs | M1 only (click/change) | **M1 ADDITION** |
| DocumentObserver callback | ~0µs | M1 only (0 mutations on OrangeHRM) | **M1 ADDITION** |

## Layer-by-Layer Analysis

### A. Baseline (Recording OFF)
- Zero overhead. No listeners registered.

### B. Existing a43df53 recorder only (no M1)
- 13 capture-phase event listeners registered on document
- Per-event cost: ~500–2200µs (identity extraction + sessionStorage buffer + IPC)
- mousemove at 20fps: ~10–44ms/sec
- scroll at 60fps: ~30–132ms/sec ← **CAN CAUSE PERCEPTIBLE LAG**
- **This is where the slowdown originates.**

### C. + Phase A only (state-cache listeners)
- Adds 2 more capture-phase listeners (mousedown + focus)
- Per-event cost: +5µs on mousedown/focus only
- **Impact: negligible (+0.5% overhead on those events)**

### D. + Phase B/C (M1 observation infrastructure)
- Adds DocumentObserver (3s window per click/change)
- On OrangeHRM: 0 mutations observed (page is idle)
- Per-click cost: +69µs (openWindow element path computation)
- **Impact: negligible (+10% on clicks, 0 on non-click events)**

### E. + Phase D (behavioral delivery)
- Adds BEHAVIORAL_EFFECTS message per observation window close
- Frequency: once per 3 seconds (per click/change)
- **Impact: negligible**

### F. Full A–E (current M1 build)
- Total M1 addition: +73µs per click, +5µs per mousedown/focus
- **Impact: negligible compared to the ~500-2200µs base cost**

## The Real Culprit: sessionStorage Buffer

The buffer does `JSON.parse(full buffer) → push → JSON.stringify(full buffer)` on EVERY event.
This is O(n) where n = current buffer size.

| Buffer Size | Per Event (push only) | Per Event (push+remove) |
|---|---|---|
| 10 items | 257µs | 83µs |
| 50 items | 418µs | 149µs |
| 100 items | 598µs | 193µs |
| 200 items | 1042µs | 329µs |
| 500 items (MAX) | 1917µs | 652µs |

### Why this matters on OrangeHRM:
1. **mousemove fires 20x/sec** (throttled to 50ms) — each does JSON.parse+stringify of the buffer
2. **scroll fires up to 60x/sec** (throttled to 16ms) — same buffer operations
3. OrangeHRM has scrollable table areas and smooth-scroll transitions
4. When the SW is alive, `removeFromBuffer` runs after each ack, adding another full JSON.parse+stringify

### SPA Navigation Accumulation
**Confirmed: SPA navigation (pushState) destroys the window context.**
OrangeHRM uses React Router — every sidebar navigation triggers `history.pushState`, which:
1. Destroys the current window context (verified empirically)
2. The content script is re-injected by Chrome
3. recorder-entry.ts auto-resumes recording (line 424: `sessionStorage.getItem(RECORDING_KEY) === 'true'`)
4. A NEW EventTap with 13 listeners is registered
5. A NEW ObservationCoordinator is created
6. Old listeners are NOT explicitly removed (the old context's pagehide fires, flushing events)

However, since the old window context is destroyed, the old listeners cannot fire. The orphaned
listener references are garbage collected. **There is no listener accumulation** — only the current
page's listeners are active at any time. BUT: each re-injection runs `startRecording()` which does
`await flushPendingEvents()` — if the buffer accumulated during the previous page, this does a bulk
JSON.parse+stringify on page load, causing a brief freeze.

## Conclusion

The slowdown the user experienced on OrangeHRM is caused by the **base a43df53 recorder**, not M1:

1. **Primary cause: sessionStorage buffer O(n) per event** — JSON.parse+stringify on every mousemove/scroll
2. **Secondary cause: chrome.runtime.sendMessage per event** — IPC overhead for every captured event
3. **Tertiary cause: identity extraction** — CSS selector + XPath + accessible name computed for every event

M1's observation infrastructure adds negligible overhead (+73µs/click, +5µs/mousedown).

## Fix Recommendations (prioritized)

### Fix 1: Batch buffer writes (highest impact)
Instead of JSON.parse + push + JSON.stringify per event, maintain an in-memory array and flush to
sessionStorage every N events or on a timer. This eliminates the O(n) per-event cost.

### Fix 2: Filter mousemove from the buffer entirely
mousemove events are throttled to 20fps but still go through the full identity extraction + buffer +
IPC pipeline. They should either be dropped entirely (the Hover definition doesn't need mousemove
from the EventTap) or significantly reduced in cost.

### Fix 3: Cache identity extraction per element
The same element is re-identified on every event. A WeakMap cache keyed by element would eliminate
repeated CSS selector + XPath + accessible name computation.

### Fix 4: M1 attributeFilter (deferred, optimization candidate)
The 12.5× callback improvement is real for mutation-heavy pages but irrelevant for OrangeHRM's
near-zero mutation rate. Apply after fixing the actual bottleneck.
