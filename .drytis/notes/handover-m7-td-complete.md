# Project Handover — Semantic Test Intelligence Chrome Extension

**Branch:** `capability-surgical-removal`
**Date:** 2026-08-13
**Head commit:** `6ef4d22` (pushed to `origin/capability-surgical-removal`)
**Baseline (M7 handover):** `2828c4e` (tag: `baseline-f87fcb4-clean`)
**Architecture frozen at:** `cc830b1` (tag: `lifecycle-architecture-frozen`)
**Latest build:** v10.9.0, 34 files, 125.5 KB

---

## 1. What This Project Is

A Chrome Extension (MV3) that observes user interactions on web pages and captures behavioral evidence — element identity, DOM state before/after, mutations, network activity, performance conditions — for an AI test-generation pipeline. The extension injects content scripts that tap browser events, route them through a component lifecycle runtime, and assemble structured evidence delivered to a background service worker.

---

## 2. Architecture Overview

### Core Modules (M1–M7, pre-existing)

| Module | Component | Purpose |
|--------|-----------|---------|
| M1 | `EventTap` | Capture-phase + bubble-phase listeners for trusted DOM events |
| M2 | `TargetStateCache` | WeakMap of pre-interaction element snapshots (value, checked, aria, textContent) |
| M3 | `DOMObserver` + `AdaptiveWindow` | MutationObserver-based DOM change tracking; setTimeout stabilization window |
| M4 | `EvidenceCollector` | Central orchestrator — opens windows, collects evidence, delivers to SW |
| M5 | `NetworkBridge` | MAIN-world fetch/XHR interception, correlates to evidence windows |
| M6 | `ComponentRuntime` | Semantic lifecycle detection (focus→blur, click→selection, etc.) |
| M7 | `ServiceWorker` | MV3 background — receives evidence, correlates to interactions, stores |

### Lifecycle-Driven Evidence Architecture (v3, Step 1 — FROZEN)

**Problem solved:** The original M3 AdaptiveWindow used a 300ms stabilization timer + 10s max-duration cap. This was timer-based, not semantic — it produced partial values on pauses >300ms and orphaned evidence when the lifecycle completed before/after the window.

**Solution:** Two new SW→CS messages bridge the semantic lifecycle (ComponentRuntime) to evidence collection (EvidenceCollector):

1. **`LIFECYCLE_BOUND`** — Sent when a component lifecycle starts (`createContext()`). The CS marks matching evidence windows `isLifecycleBound = true` and calls `setHoldOpen(true)`. The window will NOT close on its own.

2. **`FINALIZE_EVIDENCE`** — Sent when a component lifecycle completes (`onEmit`). The CS finalizes matching windows by pure event-ID set correlation (no elementKey matching). Evidence gets `endReason: 'lifecycle-complete'`.

**Key design principles:**
- No arbitrary timeout decides completion — the semantic lifecycle is primary
- Idle timeout (300s) is crash/leak protection only, not completion
- Emergency timeout (300s) replaces the old 5s cap
- `onPageHide` finalizes all lifecycle-bound windows with `settleDelay=0`, buffers evidence to sessionStorage

**Files modified (Step 1, commit `6132571`):**
- `src/tap/adaptive-window.ts` — holdOpen flag, new endReasons
- `src/shared/component-types.ts` — onLifecycleStart callback, lastActivityTime
- `src/shared/behavioral-evidence-types.ts` — new endReason values
- `src/shared/types.ts` — LIFECYCLE_BOUND + FINALIZE_EVIDENCE in AppMessage union
- `src/runtime/component-runtime.ts` — stale eviction: 15s total-duration → 300s idle-time
- `src/runtime/sw-integration.ts` — sendLifecycleBound(), sendFinalizeEvidence()
- `src/recorder/phase5/recorder-entry.ts` — message handlers, onPageHide
- `src/tap/evidence-collector.ts` — lifecycleBindings, finalizeForInteraction, onPageHide

**DO NOT MODIFY** these files' lifecycle bridge logic. Tag: `lifecycle-architecture-frozen`.

---

## 3. Commits (14 commits since baseline `2828c4e`)

| Commit | Description | Files |
|--------|-------------|-------|
| `71e8ddd` | Baseline: fix pre-existing tsc errors in test file | 1 |
| `6132571` | **Lifecycle-Driven Evidence v3 Step 1** (the core architecture change) | 10 |
| `cc830b1` | **Freeze Step 1** — validated in real browser (tag: `lifecycle-architecture-frozen`) | 1 |
| `4bbbc1f` | **TD-2:** Skip textContent capture for scroll containers | 1 |
| `168d3da` | **TD-1:** Pass trigger identity through FINALIZE_EVIDENCE | 3 |
| `6d088f0` | **TD-5:** Fix navigation interaction identity (three-layer fix) | 3 |
| `3c2d4f9` | Record TD-8 + Phase 2 validation results | 3 |
| `3847a13` | **TD-3:** Fix flushBufferedEvidence fire-and-forget loss | 1 |
| `a5faff3` | **TD-4:** Finalize non-lifecycle-bound windows on pagehide if >500ms | 1 |
| `3860898` | **TD-6:** Recover pagehide metadata from observedEvent.valueAfter | 1 |
| `58aa24e` | **TD-7:** Add F5/sessionStorage recovery unit tests (9 tests) | 1 |
| `706a61e` | TD-7: Update debt register | 1 |
| `4ed9bf8` | **TD-8:** Fix TextEntry max-duration premature close + stale observedEvent | 5 |
| `6ef4d22` | TD-8: Update debt register | 1 |

---

## 4. Technical Debt — TD-1 through TD-8

All items addressed. Full register: `.drytis/notes/technical-debt-register.md`

### TD-1: Dropdown/DatePicker "Unknown element" identity
- **Status:** ✅ Fixed (`168d3da`)
- **Fix:** `FINALIZE_EVIDENCE` payload now carries `triggerIdentity`. `finalizeWithoutWindow()` uses `payload.triggerIdentity ?? null` instead of hardcoded null.
- **Browser-validated:** Yes (Step 1 validation showed correct dropdown/date picker values)

### TD-2: Scroll captures excessive container text
- **Status:** ✅ Fixed (`4bbbc1f`)
- **Fix:** `snapshotElement()` skips textContent for HTML/BODY tags and large scroll containers (scrollHeight > clientHeight * 3 AND childElementCount > 5).
- **Browser-validated:** Yes (TD-5 regression test — scroll still functional)

### TD-3: flushBufferedEvidence fire-and-forget evidence loss
- **Status:** ✅ Fixed (`3847a13`)
- **Fix:** Per-item delivery tracking. Only removes evidence confirmed by SW `{ ok: true }`. Undelivered evidence stays in sessionStorage for retry.
- **Browser-validated:** Not specifically tested (awaiting F5 real-browser test under TD-7)

### TD-4: Non-lifecycle-bound windows abandoned on pagehide
- **Status:** ✅ Fixed (`a5faff3`)
- **Fix:** `onPageHide()` now also finalizes non-lifecycle-bound windows open >500ms (safety net for LIFECYCLE_BOUND race). Windows <500ms are companion/transient and safely abandoned.
- **Browser-validated:** Not yet (awaiting real-browser F5/navigation test)

### TD-5: Navigation interaction evidence lifecycle gap
- **Status:** ✅ Fixed + browser-validated (`6d088f0`)
- **Fix:** Three-layer fix:
  1. SW `attachSyntheticNavEvidence()` constructs descriptive identity from nav details (tag: HTML, ariaRole: document, accessibleName: URL)
  2. `event-tap.ts` `emitSpaNavigation()` enriches document.body identity with destination URL
  3. `evidence-renderer.ts` displays synthetic evidence as 'page reloaded — synthetic'
- **Browser-validated:** Yes (Amazon — navigation now has meaningful identity)

### TD-6: pagehide metadata loss
- **Status:** ✅ Fixed (`3860898`)
- **Fix:** `onPageHide()` constructs `pageHideMetadata` from `win.observedEvent.valueAfter` and passes as `textValue` to `enrichFromMetadata`. Lowest-priority enrichment path — only fires when DOM snapshot value is null/empty.
- **Browser-validated:** Not yet

### TD-7: F5/sessionStorage recovery path untested
- **Status:** ✅ Validated via 9 unit tests (`58aa24e`)
- **No code change** — was a validation gap, not a code defect
- **Tests cover:** buffer write on pagehide, confirmed delivery, cold-start retention, partial delivery, buffer cap, empty no-op, corrupt recovery, multi-flush, full F5 cycle
- **Browser-validated:** Not yet (real-browser F5 test recommended)

### TD-8: TextEntry max-duration / partial value after long pause
- **Status:** ✅ Fixed (`4ed9bf8`) — awaiting browser validation
- **Root cause:** AdaptiveWindow maxDurationTimer ignored `holdOpen` flag — lifecycle-bound typing windows force-closed at 10s, preempting FINALIZE_EVIDENCE
- **Fix (3 defects):**
  1. D1: `arm()` skips max-duration timer when holdOpen=true; `setHoldOpen(true)` clears running timer; `recordMutation()` clears timer on holdOpen windows
  2. D2: covered by D1
  3. D3: typing extension path updates `observedEvent` to latest input event
- **Browser-validated:** Not yet

---

## 5. Validation Results

### Real-browser validations completed

| Test | Date | Site | Result |
|------|------|------|--------|
| Step 1 lifecycle architecture | 2026-08-13 | Amazon.in | ✅ Text input (6.5s lifecycle-complete), dropdown, date picker, checkbox/radio, click all PASS |
| Navigation evidence (search submit) | 2026-08-13 | Amazon.in | ✅ Click evidence fully preserved (173ms lifecycle-complete) |
| Navigation evidence (Add to cart) | 2026-08-13 | Amazon.in | ✅ Click evidence fully preserved (252ms lifecycle-complete) |
| TD-5 navigation identity | 2026-08-13 | Amazon.in | ✅ Navigation now has meaningful synthetic identity |
| TD-5 regression (radio, dropdown, date picker, scroll, click, text) | 2026-08-13 | Amazon.in | ✅ All functional, no regressions |
| TD-1/TD-2 Phase 1 | 2026-08-13 | Amazon.in | ✅ Text input complete value, click/link/add-to-cart lifecycle-complete before navigation |

### Automated test suite
- **Total tests:** 2,394 (111 files)
- **All pass:** Yes
- **TSC errors:** 0
- **Build:** v10.9.0, 34 files, 125.5 KB

### Real-browser validations NOT yet done

| Item | Test procedure | Why it matters |
|------|---------------|----------------|
| TD-8 browser test | Type in a text field with >10s pause between keystrokes, then blur. Verify endReason=lifecycle-complete, full value | Confirms the root-cause fix in real Chrome |
| TD-4 browser test | Click a plain `<a>` link, let page navigate. Verify page-reload evidence with element identity | Confirms non-lifecycle-bound pagehide safety net |
| TD-6 browser test | Interact with dropdown/datepicker, then immediately navigate. Verify after-value is populated | Confirms pagehide metadata recovery |
| TD-7 browser test | Type in a field, press F5 (not navigation). Verify evidence buffered + replayed on new page | Confirms sessionStorage persistence in Chrome |

---

## 6. Known Issues & Remaining Gaps

### Not bugs — by design
- **Navigation interactions show 'page reloaded — synthetic':** This is correct behavior. The old content script is destroyed during navigation; the SW creates synthetic evidence. TD-5 made the identity meaningful (URL instead of 'Unknown element'), but it will never have full behavioral details because the DOM is gone.
- **`max-duration` still fires for non-lifecycle-bound windows:** This is correct — the M3 stabilization fallback (300ms + 10s cap) must remain for events that never receive a LIFECYCLE_BOUND (e.g., plain DOM events on uninstrumented elements).

### Potential future issues
- **Double-evidence race:** If max-duration and FINALIZE_EVIDENCE fire near-simultaneously (before TD-8 fix), two evidence records compete in `scoreEvidenceRichness`. TD-8 fix eliminates this for holdOpen windows, but the race could theoretically still occur for non-holdOpen windows with very late LIFECYCLE_BOUND.
- **sessionStorage in incognito mode:** Chrome may clear sessionStorage more aggressively in incognito. The buffer recovery path depends on sessionStorage persistence across same-tab reloads.

---

## 7. Architecture Constraints for Future Work

### Frozen — do NOT modify
1. `LIFECYCLE_BOUND` / `FINALIZE_EVIDENCE` message protocol (`src/shared/types.ts`)
2. `holdOpen` scheduling in `AdaptiveWindow` (`src/tap/adaptive-window.ts`)
3. Idle-time stale eviction (300s) in `ComponentRuntime` (`src/runtime/component-runtime.ts`)
4. Emergency timeout (300s) in `sw-integration.ts` (`src/runtime/sw-integration.ts`)
5. Event-ID set correlation in `finalizeForInteraction()` (`src/tap/evidence-collector.ts`)

### Safe to modify
- Evidence rendering (`src/sidepanel/`)
- New component definitions (`src/components/`)
- TargetStateCache snapshot fields (`src/tap/target-state-cache.ts`)
- Test files
- Build configuration

---

## 8. Exact Next Steps

### Immediate (before M8)
1. **Real-browser validation of TD-8:** Load ZIP from commit `6ef4d22`. Type "Amanda" with >10s pauses. Blur. Verify `lifecycle-complete` + full value.
2. **Real-browser validation of TD-4/TD-6/TD-7:** Run the test procedures in section 5.
3. **Final full regression:** All interaction types (text, dropdown, date picker, radio/checkbox, click, scroll, navigation) on a form-heavy site.

### After validation passes
4. **Merge `capability-surgical-removal` to main** (or whatever the integration branch is).
5. **Begin M8** — whatever the next milestone is (test generation? AI integration? deployment?).

### If TD-8 browser test fails
- Check whether `holdOpen` is actually being set (inspect the LIFECYCLE_BOUND message in SW logs)
- Verify the TextEntry component sends `onLifecycleStart` during `createContext()`
- Check if `maxDurationTimer` is still somehow scheduled (add temporary logging in `arm()`)
- The spec is at `.drytis/specs/td8-textentry-long-pause.md`

---

## 9. File Inventory

### Source files changed since baseline
```
src/tap/adaptive-window.ts          (Step 1 + TD-8)
src/tap/evidence-collector.ts        (Step 1 + TD-1 + TD-3 + TD-4 + TD-6 + TD-8)
src/tap/target-state-cache.ts        (TD-2)
src/tap/event-tap.ts                 (TD-5)
src/shared/types.ts                  (Step 1)
src/shared/component-types.ts        (Step 1)
src/shared/behavioral-evidence-types.ts (Step 1)
src/runtime/component-runtime.ts     (Step 1)
src/runtime/sw-integration.ts        (Step 1)
src/recorder/phase5/recorder-entry.ts (Step 1)
src/background/service-worker.ts     (TD-1 + TD-5)
src/sidepanel/evidence-renderer.ts   (TD-5)
```

### Test files added/changed
```
tests/tap/adaptive-window.test.ts              (+6 tests for TD-8)
tests/tap/evidence-collector.test.ts            (+1 test for TD-8 D3)
tests/tap/evidence-buffer-recovery.test.ts      (NEW — 9 tests for TD-7)
tests/integration/evidence-quality-fix6.test.ts (baseline tsc fix)
```

### Key documentation
```
.drytis/notes/technical-debt-register.md       (TD-1 through TD-8, full resolution plan)
.drytis/notes/phase1-validation-results.md     (Amazon real-browser results)
.drytis/notes/phase2-validation-results.md     (TD-5 validation + TD-8 discovery)
.drytis/specs/td8-textentry-long-pause.md      (TD-8 spec with RCA)
.drytis/specs/lifecycle-driven-evidence.md     (v3 architecture spec)
```

---

## 10. Build & Download

```
Download:  https://semantic-test-intell-wvxv6e.drytis.dev/download/cmdrunner-extension.zip
SHA256:    0a8be466ab155244fcdd21e806787dd33d3d51869000c1fc991fe3db28ccb92d
Commit:    6ef4d22
Version:   10.9.0
Files:     34 (125.5 KB)
Build:     npm run build  (vite build + scripts/pack-zip.mjs)
Tests:     npx vitest run  (2,394 tests, 111 files)
Typecheck: npx tsc --noEmit (0 errors)
```

---

*Generated 2026-08-13. All work committed and pushed to `origin/capability-surgical-removal`.*
