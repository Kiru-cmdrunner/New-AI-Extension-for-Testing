# M7-fix-002: Evidence Renderer Robustness — Implementation & Verification Report

**Date**: 2026-08-12
**Commit chain**: `35c6034` (root-cause) → `3224c5e` (design) → `fadb146` (M7-fix-001 correlation) → `09fe88f` (report) → `91c9755` (final verification) → `d9a15bd` (manual test RCA) → `b0bf37f` (M7-fix-002 implementation) → `0a71eba` (test fixture type-fix)

---

## 1. Problem Statement

Manual testing of `fadb146` on Amazon revealed that while interaction capture worked (8 captured steps), the interaction cards were not displayed in the side panel, and Stop Recording was unresponsive. Root cause analysis (`d9a15bd`) identified evidence-renderer `TypeError` crashes on real-world data shapes that the synthetic test fixtures didn't cover.

## 2. Changes Made

### 2.1 `src/sidepanel/evidence-renderer.ts` — 18 unsafe access paths fixed
- `truncate(str)`: Now accepts `string | null | undefined`, returns `'—'` for null/undefined
- `renderIdentity(identity)`: Null guard → returns "Unknown element" fallback
- `renderTargetEvidence(target)`: Null guard → renders "No target evidence available"
- `renderApplicationEvidence(app)`: Null guard → renders "No application evidence available"
- `renderDomChanges()`: `safeChanges = changes ?? []`; `change.types ?? []`, `change.changedAttributes ?? []`, `change.attributeDeltas ?? {}`
- `renderSurfaces()`: `safeSurfaces = surfaces ?? []`; field guards
- `renderVisibilityChanges()`: `safeChanges = changes ?? []`; `change.property ?? 'unknown'`
- `renderNavigation()`: `safeNav = nav ?? []`; `fromUrl`/`toUrl` null-safe via truncate
- `renderNetworkActivity()`: `safeNetwork = network ?? []`; field guards
- `renderEvidence()`: `const win = evidence?.window`; `win?.durationMs`, `win?.endReason` guarded; `evidence?.frameId` null-safe

### 2.2 `src/sidepanel/interaction-renderer.ts` — Per-card error boundary
- `attachEvidenceDisplay()`: try/catch → logs `console.warn('[evidence] render failed', e)` + renders fallback `⚠️ Evidence data incomplete`
- `renderInteractions()`: Each card in individual try/catch → one bad card renders error fallback card with interaction ID, remaining cards unaffected

### 2.3 `src/sidepanel/sidepanel.ts` — Stop Recording resilience
- `handleStopRecording()`: `showDetectedInteractions()` wrapped in try/catch → `console.warn('[StopRecording] failed to render interactions:', err)` → `showView('stopped')` always reached

### 2.4 `tests/integration/evidence-renderer-robustness.test.ts` — 27 regression tests
8 scenarios: (1) Complete valid evidence, (2) Missing optional fields, (3) null/undefined values, (4) Empty arrays, (5) Mixed batch with malformed, (6) Stop Recording resilience, (7) Amazon-scale evidence (200 DOM changes, 15 network entries), (8) OrangeHRM evidence.

## 3. Architecture Integrity

### M7 correlation architecture (LOCKED — not touched)
- `src/runtime/sw-integration.ts`: **0 changes**
- `src/background/service-worker.ts`: **0 changes**
- `src/shared/types.ts`: **0 changes**

### M1–M6 source (LOCKED — not touched)
- `src/tap/`: **0 changes**
- `src/runtime/component-runtime.ts`: **0 changes**
- `src/runtime/component-types.ts`: **0 changes**
- `src/runtime/projection-engine.ts`: **0 changes**
- `src/content/`: **0 changes**

Only 3 side-panel files modified: `evidence-renderer.ts`, `interaction-renderer.ts`, `sidepanel.ts`.

## 4. Verification Results

### 4.1 Test Suite
- **tsc --noEmit**: 0 errors
- **Full suite**: 2,251 tests pass (104 files, 0 failures)
- **New tests**: 27/27 pass (evidence-renderer-robustness.test.ts)
- **M1–M6 regressions**: 0 (all existing tests unchanged)

### 4.2 ZIP Audit
- **Files**: 41 (matches dist/)
- **SHA256**: `98828d8698eee926a293a1d7c73ba694773bbf615405035d1274f58fffa7bff2`
- **Nested ZIPs**: None
- **Source maps**: None
- **TypeScript source**: None
- **Asset hashes**: All 26 JS assets match dist/ SHA256

### 4.3 Bundle Verification
- Per-card error boundary: `(render error)` text present in side panel bundle
- Null-safe defaults: 7× `??[]` in side panel bundle
- `__deferredEvidence`: 0 occurrences (fully removed)
- `interactionId`: 9× in SW, 1× in side panel (M7-fix-001 correlation intact)
- `INTERACTION_EVIDENCE_UPDATE`: 1× in SW broadcast
- Two-tier match: `triggerEvent` 51×, `memberEvents` 13×, `sourceEventId` 2× in SW

### 4.4 Browser Validation
- **Validation page**: 10/10 interactions rendered with evidence, 0 placeholders, 0 console errors
- **All 8 scenarios PASS**: Simple Click, Typing Session, Navigation, Dropdown, Rapid Consecutive, Late Evidence, Re-render Preserves Evidence, Unmatched Isolation
- **Summary badge**: "Interactions: 10, With evidence: 10, Pending (unmatched): 1, Placeholder showing: 0, OVERALL: PASS ✅"

### 4.5 Reviewer Report
- **Overall: PASS**
- All 18 unsafe paths null-safe ✅
- Per-card error boundary in `renderInteractions()` ✅
- `attachEvidenceDisplay()` try/catch + safe fallback ✅
- `handleStopRecording()` reaches `showView('stopped')` ✅
- Zero changes to locked files ✅
- Security: No XSS (textContent everywhere), no eval ✅
- Test coverage: all 8 spec scenarios ✅
- Full test suite: 2,251/2,251 pass ✅

## 5. Key Design Decisions

1. **No broad catch**: Per-card try/catch with explicit logging and visible fallback text. Not a silent swallow.
2. **`??[]` not `||[]`**: Nullish coalescing preserves falsy-but-valid values (0, false, '').
3. **First-write-only**: Trigger evidence not overwritten by member evidence (M7-fix-001 contract preserved).
4. **No new ID system**: Uses existing `triggerEvent.eventId` and `memberEvents[].eventId` only.

## 6. Conclusion

M7-fix-002 successfully addresses the evidence-renderer robustness issues that caused cards to not display and Stop Recording to fail on real-world Amazon/OrangeHRM data. The fix is narrowly scoped to 3 presentation-layer files, touches zero M1–M6 or M7 correlation architecture, and all 2,251 tests pass with 0 tsc errors. The validation page confirms 10/10 interactions render with evidence and Stop Recording resilience works correctly.

**Ready for M8. Not started.**
