# Technical Debt Register

Track deferred issues from M7 lifecycle/evidence work. Address AFTER all lifecycle/evidence steps are complete and stable.

**Lifecycle architecture frozen at:** `cc830b1` (tag: `lifecycle-architecture-frozen`)
**DO NOT modify:** LIFECYCLE_BOUND, FINALIZE_EVIDENCE, holdOpen, idle-time stale eviction, or any lifecycle bridge code.

---

## TD-1: Dropdown/DatePicker "Unknown element" identity
- **Added:** 2026-08-13 (Step 1 real-browser validation)
- **Status:** Open
- **Priority:** Medium
- **Root cause:** `finalizeWithoutWindow()` at `evidence-collector.ts:1250` hardcodes `identity: null`. Triggered when both the trigger event AND completion event are capture-only (focus→mousedown for Dropdown, focus→blur for DatePicker). No evidence window is opened, so no identity reference exists.
- **Evidence values ARE correct** (from metadata.selectedValue/selectedDate), only identity is null.
- **Scope:** `src/tap/evidence-collector.ts` `finalizeWithoutWindow()` (lines 1202–1282)
- **Fix direction:** Reconstruct minimal ElementIdentity from interaction metadata (tag, accessibleName from targetName). Single method, lowest risk.
- **Blast radius:** 1 method if identity reconstructed from metadata; 3 files if identity passed through FINALIZE_EVIDENCE payload.

## TD-2: Scroll captures excessive container text
- **Added:** 2026-08-13 (Step 1 real-browser validation)
- **Status:** Open
- **Priority:** Low-Medium
- **Root cause:** `target-state-cache.ts:160` unconditionally captures `textContent` (up to 500 chars) for every element, including scroll containers and `<body>`. For page scroll, this is the entire page's text.
- **Scope:** `src/tap/target-state-cache.ts` `snapshotElement()` (line 159–161)
- **Fix direction:** Skip textContent capture when element is a scroll container (scrollHeight > clientHeight) or when element tag is HTML/BODY. Single file, 2 lines.
- **Blast radius:** 1 file. textContent is display-only (not used for value resolution).

## TD-3: flushBufferedEvidence fire-and-forget (evidence loss risk)
- **Added:** 2026-08-13 (Step 2 navigation code analysis)
- **Status:** Open
- **Priority:** Medium
- **Root cause:** `evidence-collector.ts:938` removes the sessionStorage key unconditionally after fire-and-forget replay. If SW is cold-starting on new page, messages are lost.
- **Scope:** `src/tap/evidence-collector.ts` `flushBufferedEvidence()` (lines 925–942)
- **Fix direction:** Only remove key after confirmed delivery, or let SW send ACK. Requires async refactor or new message type.
- **Blast radius:** 1 file (simple retry) or 3 files (ACK pattern: evidence-collector + service-worker + types).

## TD-4: Non-lifecycle-bound windows abandoned on pagehide
- **Added:** 2026-08-13 (Step 2 navigation code analysis)
- **Status:** Open
- **Priority:** Low
- **Root cause:** `evidence-collector.ts:1348` only finalizes `isLifecycleBound === true` windows on pagehide.
- **Risk:** Very low — LIFECYCLE_BOUND arrives within milliseconds of window creation.
- **Scope:** `src/tap/evidence-collector.ts` `onPageHide()` (line 1343)
- **Fix direction:** Also finalize non-lifecycle-bound windows open >500ms as a safety net.

## TD-5: Navigation interaction evidence lifecycle gap
- **Added:** 2026-08-13 (Step 2 navigation code analysis)
- **Status:** Open
- **Priority:** Medium
- **Root cause:** Three-layer identity failure:
  1. Synthetic nav evidence: `service-worker.ts:774` hardcodes `identity: null` (SW has no DOM access)
  2. finalizeWithoutWindow: `evidence-collector.ts:1250` hardcodes `identity: null` (same as TD-1)
  3. SPA navigation: `event-tap.ts:124` uses `document.body` as target (bare BODY identity)
- **Scope:** Cross-cutting: `src/background/service-worker.ts`, `src/tap/evidence-collector.ts`, `src/tap/event-tap.ts`
- **Fix direction:** SW synthesizes navigation evidence from stored interaction metadata. Or pass trigger identity through before page unload.
- **Blast radius:** 3+ files, cross-cutting. Highest risk among all TDs.

## TD-6: FINALIZE_EVIDENCE vs pagehide race — metadata loss
- **Added:** 2026-08-13 (Step 2 navigation code analysis)
- **Status:** Open
- **Priority:** Low
- **Root cause:** `evidence-collector.ts:1349` passes empty `{}` metadata on pagehide finalization. Normal FINALIZE_EVIDENCE path passes interaction metadata (selectedValue, selectedDate, etc.). If FINALIZE_EVIDENCE loses race, metadata enrichment is lost.
- **Risk:** Low — evidence IS captured (just with degraded quality). The lifecycleBindings map doesn't store metadata.
- **Scope:** `src/tap/evidence-collector.ts` `onPageHide()` (line 1349) + lifecycleBindings data structure
- **Fix direction:** Store metadata in lifecycleBindings when LIFECYCLE_BOUND arrives or when FINALIZE_EVIDENCE processes. Pass stored metadata to executeFinalization on pagehide.
- **Blast radius:** 1 file, but modifies the lifecycleBindings data structure.

## TD-7: F5/full-page-reload sessionStorage recovery path untested
- **Added:** 2026-08-13 (Step 2 navigation validation)
- **Status:** ✅ Validated via unit tests (commit `58aa24e`)
- **Priority:** Low
- **Root cause:** The Amazon navigation tests proved lifecycle-completed evidence survives navigation (delivered before pagehide). But the sessionStorage buffer recovery path (onPageHide → bufferEvidence → flushBufferedEvidence on next page) was never exercised because all tested interactions completed before pagehide fired.
- **Validation:** 9 unit tests in `tests/tap/evidence-buffer-recovery.test.ts` covering:
  1. onPageHide buffers lifecycle-bound evidence to sessionStorage
  2. flushBufferedEvidence delivers + clears on confirmed `{ ok: true }`
  3. flushBufferedEvidence retains evidence when SW cold-starting
  4. Partial delivery (mixed confirmed/unconfirmed)
  5. Buffer cap (50) drops oldest
  6. Empty buffer no-op
  7. Corrupt buffer cleared gracefully
  8. Multi-flush (cold → warm)
  9. Full F5 cycle simulation
- **Remaining:** Real-browser F5 test still recommended to confirm sessionStorage persists across actual Chrome reload.

## TD-8: TextEntry max-duration / incorrect state after long pause
- **Added:** 2026-08-13 (Phase 2 real-browser validation)
- **Status:** Open
- **Priority:** Medium
- **Symptom:** "First Name" field: typed "Amanda", but after a 10s pause the evidence shows `manda → empty` (partial value, then cleared). EndReason appears to be `max-duration` rather than `lifecycle-complete`.
- **Scope:** TextEntry lifecycle or evidence window behavior during long pauses between keystrokes.
- **Do NOT touch:** Lifecycle architecture

---

## Resolution Plan
1. ✅ Complete all lifecycle/evidence steps
2. ✅ Validate lifecycle architecture in real browser
3. ✅ Freeze lifecycle architecture
4. ✅ Phase 1: TD-2 (scroll text) + TD-1 (identity) — completed, validated
5. ✅ Phase 2: TD-5 (navigation identity) — completed, validated
6. ✅ Phase 3: Buffer reliability — TD-3 (confirmed-delivery fix) + TD-7 (9 unit tests)
7. ✅ Phase 4: pagehide hardening — TD-6 (metadata from observedEvent) + TD-4 (>500ms safety net)
8. → Phase 5: TD-8 (TextEntry long pause)
9. Final real-browser regression before M8
