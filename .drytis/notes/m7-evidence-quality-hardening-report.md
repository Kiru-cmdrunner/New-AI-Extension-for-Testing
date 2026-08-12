# M7 Evidence Quality Hardening — Implementation & Validation Report

**Date**: 2026-08-12
**Commits**: `4eb83ff` (implementation) → `49be9d5` (tsc fix)
**ZIP SHA256**: `cdd7587f78151785ce830a7bbd3e2d2c9d9cf68c08f7d6998b5988a7eb87e3b2`

---

## 1. Problem Statement

Real-browser testing on Amazon and OrangeHRM showed that while the M7 renderer and correlation architecture worked (cards displayed, evidence attached), the captured BehavioralEvidence objects were degraded:
- 100% of interactions showed "Unknown element"
- Text entry showed no value change
- Dropdown DOM/surface changes missing
- Network activity invisible
- Navigation stuck "Collecting behavioral evidence…"
- Only checkbox `checked:false→true` appeared
- Typing opened 6+ evidence windows per keystroke

7 capture-quality gaps were identified (1 CRITICAL, 2 HIGH, 4 MEDIUM). All in the **capture pipeline**, not in the renderer or correlation.

## 2. Changes Made (6 source files)

### GAP-1 (CRITICAL): Identity passthrough — `event-tap.ts`, `evidence-collector.ts`, `recorder-entry.ts`
- `onAfterEvent` signature extended: `(targetEl, eventId, eventType, cssSelector, identity?, observedEvent?)`
- EventTap passes the already-extracted full `ElementIdentity` (from L217 `extractIdentity(targetEl)`)
- EvidenceCollector stores identity in `ObservationWindowState.identity` (was always `null`)
- Recorder passes identity through to EvidenceCollector
- No second identity extraction system created

### GAP-2 (HIGH): Before-snapshot reliability — `target-state-listeners.ts`
- Added `keydown` capture-phase listener (fires before input handlers modify the element)
- All listeners use `e.composedPath()` for shadow DOM piercing (was `e.target`)
- Ensures before-snapshot available for: click-then-type, Tab-then-type, direct input

### GAP-3 (MEDIUM): Visibility detection — `dom-observer.ts`
- `detectStyleVisibilityChange()`: Parses inline style attribute for `display`/`visibility`/`opacity` changes via regex extraction
- `detectClassVisibilityChange()`: Compares computed `display`/`visibility`/`opacity` before and after class mutations, using WeakMap cache (GC-bounded)
- Existing `hidden`/`aria-hidden` detection preserved
- Helper functions: `getComputedStyleSafe()`, `extractCssProperty()`

### GAP-4 (HIGH): Navigation evidence — `evidence-collector.ts`
- `handleNavigationEvent()`: Opens its own evidence window (was passive-only)
- `extractNavTypeFromEvent()`: Uses real `observedEvent.navType` (was hardcoded `'pushState'`)
- `extractFromUrlFromEvent()`: Uses `lastKnownUrl` tracker (was empty string `''`)
- Removed `pendingNavEvents` cross-window attribution (was attributing to wrong interaction)
- Navigation still also attributes to active non-closed windows (preserves concurrent nav evidence)

### GAP-5 (MEDIUM): Network timing — `evidence-collector.ts`, `network-bridge.ts`
- At window close, checks `networkBridge.getInFlightCount()`
- If in-flight requests exist, schedules bounded 200ms re-check via `setTimeout`
- Re-check only delivers supplementary evidence if network data improved (more entries)
- `NetworkBridge.getInFlightCount()` added: counts entries in `inFlight` Map
- Bounded: single re-check, no loop, no unbounded waiting

### GAP-6 (MEDIUM): All state changes — subsumed by GAP-3
- `display`/`visibility`/`opacity` changes now detected from style and class attributes
- TargetStateSnapshot's 9 properties (value, checked, className, disabled, ariaExpanded, ariaChecked, ariaPressed, textContent, childCount) confirmed working

### GAP-7 (MEDIUM): Typing keydown filter — `event-tap.ts`
- EventTap now only calls `onAfterEvent` for `keydown` events where `key === 'Enter'`
- Non-Enter keydown events are still captured via `onEvent` (for ObservedEvent/ComponentRuntime) but do NOT open evidence windows
- Typing sessions use extend-on-input model (`TYPING_EVENTS = {'input'}`)
- Verified in bundle: `f.key!=="Enter")return`

## 3. Files Changed

| File | Lines Changed | Gaps Fixed |
|------|--------------|------------|
| `src/tap/event-tap.ts` | +22/-7 | GAP-1, GAP-4, GAP-7 |
| `src/tap/evidence-collector.ts` | +120/-40 | GAP-1, GAP-4, GAP-5 |
| `src/tap/dom-observer.ts` | +100/-3 | GAP-3, GAP-6 |
| `src/tap/target-state-listeners.ts` | +45/-15 | GAP-2 |
| `src/tap/network-bridge.ts` | +10/-0 | GAP-5 |
| `src/recorder/phase5/recorder-entry.ts` | +8/-3 | GAP-1 |

## 4. Architecture Integrity

### M7 correlation architecture (LOCKED — not touched)
- `src/runtime/sw-integration.ts`: **0 changes**
- `src/background/service-worker.ts`: **0 changes**
- `src/shared/types.ts`: **0 changes**

### M7 renderer (LOCKED — not touched)
- `src/sidepanel/evidence-renderer.ts`: **0 changes**
- `src/sidepanel/interaction-renderer.ts`: **0 changes**
- `src/sidepanel/sidepanel.ts`: **0 changes**

### Constraints preserved
- ✅ Reuse existing EventTap/IdentityExtractor (no second extraction system)
- ✅ No semantic/causal interpretation added
- ✅ Dual-scope model (TargetEvidence + ApplicationEvidence) preserved
- ✅ Raw timing + batchIndex preserved
- ✅ All evidence bounded (200-cap DOM, 50-cap network, WeakMap GC-bound)
- ✅ M1–M6 behavior not modified unnecessarily (changes are additive improvements)

## 5. Verification Results

### 5.1 TypeScript
- `tsc --noEmit`: **0 errors**

### 5.2 Test Suite
- **Full suite**: 2,269 tests pass (105 files, 0 failures)
- **New regression tests**: 18/18 pass (evidence-quality-hardening.test.ts)
- **M1–M6 regressions**: 0 (all existing tests unchanged)

### 5.3 ZIP Audit
- **Files**: 41
- **SHA256**: `cdd7587f78151785ce830a7bbd3e2d2c9d9cf68c08f7d6998b5988a7eb87e3b2`
- **Nested ZIPs**: None
- **Source maps**: None
- **TypeScript source**: None
- **Asset hashes**: All 26 JS assets match dist/ SHA256
- **Stale code**: No capability/behavioral-observation references (only legitimate `capabilityId` in domain model)

### 5.4 Bundle Verification
- **GAP-1**: `identity:s` — identity parameter flows through EvidenceCollector
- **GAP-3**: `display|visibility|opacity` checks present in DOMObserver code
- **GAP-4**: `t.navType?t.navType:"pushState"` — real navType used with fallback
- **GAP-7**: `f.key!=="Enter")return` — keydown filtered to Enter only

### 5.5 Browser Validation
- **Validation page**: 10/10 interactions render with evidence, 0 placeholders, 0 console errors
- **All 8 scenarios PASS**: Simple Click, Typing Session, Navigation, Dropdown, Rapid Consecutive, Late Evidence, Re-render, Unmatched Isolation
- **Summary**: "Interactions: 10, With evidence: 10, Pending: 1, Placeholder: 0, OVERALL: PASS ✅"

### 5.6 Reviewer Report
- **Overall: PASS**
- All 7 gaps addressed ✅
- All acceptance criteria met ✅
- Security: No XSS, no eval, no injection ✅
- Constraints: No semantics, dual-scope, timing, bounded ✅
- Full test suite: 2,269/2,269 pass ✅
- tsc: 0 errors ✅

## 6. Commit Chain

```
49be9d5  M7 Evidence Quality Hardening: fix tsc errors in test file
4eb83ff  M7 Evidence Quality Hardening: fix all 7 capture-quality gaps
33a5456  M7 capture-quality gap analysis: 7 defects found
22d21be  M7-fix-002: implementation & verification report
0a71eba  M7-fix-002: fix test fixture type drift
b0bf37f  M7-fix-002: evidence-renderer robustness
```

## 7. Conclusion

All 7 capture-quality gaps are fixed. The evidence pipeline now:
1. ✅ Passes full identity (GAP-1 — "Unknown element" fixed)
2. ✅ Captures reliable before-snapshots (GAP-2)
3. ✅ Detects display/visibility/opacity changes (GAP-3/6)
4. ✅ Captures real navigation type and URL (GAP-4)
5. ✅ Retains network activity via bounded re-check (GAP-5)
6. ✅ No more keydown window thrashing (GAP-7)

**Ready for M8. Not started.**
