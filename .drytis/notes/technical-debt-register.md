# Technical Debt Register

Track deferred issues from M7 lifecycle/evidence work. All items addressed.

**Lifecycle architecture frozen at:** `cc830b1` (tag: `lifecycle-architecture-frozen`)
**DO NOT modify:** LIFECYCLE_BOUND, FINALIZE_EVIDENCE, holdOpen, idle-time stale eviction, or any lifecycle bridge code.

---

## TD-1: Dropdown/DatePicker "Unknown element" identity
- **Added:** 2026-08-13 (Step 1 real-browser validation)
- **Status:** Fixed (commit `168d3da`)
- **Priority:** Medium
- **Root cause:** `finalizeWithoutWindow()` in `evidence-collector.ts` hardcoded `identity: null`. Triggered when both the trigger event AND completion event are capture-only (focus+mousedown for Dropdown, focus+blur for DatePicker). No evidence window was opened, so no identity reference existed.
- **Fix:** FINALIZE_EVIDENCE payload now carries `triggerIdentity`. `finalizeWithoutWindow()` uses `payload.triggerIdentity ?? null`. Also partially addressed by TD-5 (SW synthetic identity construction).
- **Browser-validated:** Yes (Step 1 validation showed correct dropdown/date picker values)

## TD-2: Scroll captures excessive container text
- **Added:** 2026-08-13 (Step 1 real-browser validation)
- **Status:** Fixed (commit `4bbbc1f`)
- **Priority:** Low-Medium
- **Root cause:** `target-state-cache.ts` `snapshotElement()` unconditionally captured `textContent` (up to 500 chars) for every element, including scroll containers and `<body>`.
- **Fix:** Skip textContent for HTML/BODY tags and large scroll containers (scrollHeight > clientHeight * 3 AND childElementCount > 5).
- **Browser-validated:** Yes (TD-5 regression test confirmed scroll still functional)

## TD-3: flushBufferedEvidence fire-and-forget (evidence loss risk)
- **Added:** 2026-08-13 (Step 2 navigation code analysis)
- **Status:** Fixed (commit `3847a13`)
- **Priority:** Medium
- **Root cause:** `evidence-collector.ts` `flushBufferedEvidence()` removed the sessionStorage key unconditionally after fire-and-forget replay. If SW was cold-starting on new page, messages were lost.
- **Fix:** Per-item delivery tracking via per-item callback. Only removes evidence confirmed by SW `{ ok: true }`. Undelivered evidence stays in sessionStorage for retry on next flush.
- **Browser-validated:** Not yet (awaiting F5 real-browser test under TD-7)

## TD-4: Non-lifecycle-bound windows abandoned on pagehide
- **Added:** 2026-08-13 (Step 2 navigation code analysis)
- **Status:** Fixed (commit `a5faff3`)
- **Priority:** Low
- **Root cause:** `evidence-collector.ts` `onPageHide()` only finalized `isLifecycleBound === true` windows on pagehide.
- **Fix:** `onPageHide()` now also finalizes non-lifecycle-bound windows open >500ms (safety net for LIFECYCLE_BOUND race). Windows <500ms are companion/transient and safely abandoned.
- **Browser-validated:** Not yet

## TD-5: Navigation interaction evidence lifecycle gap
- **Added:** 2026-08-13 (Step 2 navigation code analysis)
- **Status:** Fixed + browser-validated (commit `6d088f0`)
- **Priority:** Medium
- **Root cause:** Three-layer identity failure: SW synthetic nav evidence hardcoded `identity: null`; `finalizeWithoutWindow` same; SPA navigation captured bare BODY identity.
- **Fix:** Three-layer fix:
  1. SW `attachSyntheticNavEvidence()` constructs descriptive identity from nav details (tag: HTML, ariaRole: document, accessibleName: URL)
  2. `event-tap.ts` `emitSpaNavigation()` enriches document.body identity with destination URL
  3. `evidence-renderer.ts` displays synthetic evidence as 'page reloaded - synthetic'
- **Browser-validated:** Yes (Amazon - navigation now has meaningful synthetic identity)

## TD-6: FINALIZE_EVIDENCE vs pagehide race - metadata loss
- **Added:** 2026-08-13 (Step 2 navigation code analysis)
- **Status:** Fixed (commit `3860898`)
- **Priority:** Low
- **Root cause:** `evidence-collector.ts` `onPageHide()` passed empty `{}` metadata on pagehide finalization. Normal FINALIZE_EVIDENCE path passed interaction metadata (selectedValue, selectedDate, etc.). If FINALIZE_EVIDENCE lost the race, metadata enrichment was lost.
- **Fix:** `onPageHide()` constructs `pageHideMetadata` from `win.observedEvent.valueAfter` and passes as `textValue` to `enrichFromMetadata`. Lowest-priority enrichment path - only fires when DOM snapshot value is null/empty.
- **Browser-validated:** Not yet

## TD-7: F5/full-page-reload sessionStorage recovery path untested
- **Added:** 2026-08-13 (Step 2 navigation validation)
- **Status:** Validated via unit tests (commit `58aa24e`)
- **Priority:** Low
- **Root cause:** The Amazon navigation tests proved lifecycle-completed evidence survives navigation (delivered before pagehide). But the sessionStorage buffer recovery path (onPageHide -> bufferEvidence -> flushBufferedEvidence on next page) was never exercised because all tested interactions completed before pagehide fired.
- **Validation:** 9 unit tests in `tests/tap/evidence-buffer-recovery.test.ts` covering:
  1. onPageHide buffers lifecycle-bound evidence to sessionStorage
  2. flushBufferedEvidence delivers + clears on confirmed `{ ok: true }`
  3. flushBufferedEvidence retains evidence when SW cold-starting
  4. Partial delivery (mixed confirmed/unconfirmed)
  5. Buffer cap (50) drops oldest
  6. Empty buffer no-op
  7. Corrupt buffer cleared gracefully
  8. Multi-flush (cold -> warm)
  9. Full F5 cycle simulation
- **Remaining:** Real-browser F5 test still recommended to confirm sessionStorage persists across actual Chrome reload.

## TD-8: TextEntry max-duration / incorrect state after long pause
- **Added:** 2026-08-13 (Phase 2 real-browser validation)
- **Status:** Fixed (commit `4ed9bf8`) - awaiting real-browser validation
- **Priority:** Medium
- **Symptom:** "First Name" field: typed "Amanda", but after a 10s pause the evidence showed partial value (manda -> empty). EndReason was `max-duration` instead of `lifecycle-complete`.
- **Root cause:** AdaptiveWindow maxDurationTimer ignored holdOpen flag, force-closing lifecycle-bound typing windows at 10s. Three defects fixed (D1: holdOpen guard in arm/setHoldOpen/recordMutation; D2: covered by D1; D3: typing extension now updates observedEvent).
- **Spec:** `.drytis/specs/td8-textentry-long-pause.md`
- **Browser-validated:** Not yet

---

## Resolution Plan
1. Completed all lifecycle/evidence steps
2. Validated lifecycle architecture in real browser
3. Frozen lifecycle architecture at `cc830b1`
4. Phase 1: TD-2 (scroll text) + TD-1 (identity) - completed, validated
5. Phase 2: TD-5 (navigation identity) - completed, validated
6. Phase 3: Buffer reliability - TD-3 (confirmed-delivery fix) + TD-7 (9 unit tests)
7. Phase 4: pagehide hardening - TD-6 (metadata from observedEvent) + TD-4 (>500ms safety net)
8. Phase 5: TD-8 (TextEntry long pause) - fixed, awaiting browser validation
9. Final real-browser regression before M8
