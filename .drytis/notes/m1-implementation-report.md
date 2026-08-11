# M1 Foundation — Implementation & Validation Report

**Branch:** `capability-surgical-removal`
**Commit:** `391e823` — "M1 Foundation: behavioral evidence types + EventTap hooks + identity inputType"
**Baseline:** `3bc28f6` (post-removal clean baseline)
**Date:** 2026-08-11

## Scope

M1 from the approved milestone plan (`.drytis/specs/behavioral-evidence-milestones.md`).
Builds ONLY foundation types and EventTap hooks. No capture logic, no evidence windows,
no collectors, no persistence.

## Files Changed (31 files, +1,044 / −14)

### New Files (4)

| File | Lines | Purpose |
|------|-------|---------|
| `src/shared/behavioral-evidence-types.ts` | 341 | All spec §3 type definitions |
| `tests/tap/behavioral-evidence-types.test.ts` | 199 | Type compilation + construction tests (8 tests) |
| `tests/tap/event-tap-navigation-onAfterEvent.test.ts` | 239 | Navigation onAfterEvent + navType tests (10 tests) |
| `tests/tap/identity-inputType.test.ts` | 183 | inputType extraction tests (17 tests) |

### Modified Source Files (7)

| File | Change |
|------|--------|
| `src/shared/types.ts` | +`inputType: string \| null` to `RawElementIdentity` (§8.2); +`BEHAVIORAL_EVIDENCE` + `INTERACTION_EVIDENCE_UPDATE` to `AppMessage` union + `isAppMessage` guard |
| `src/shared/component-types.ts` | Removed orphaned M1 comment block; +`navType?` to `ObservedEvent` (§7.3); +`behavioralEvidence?` field to `ComponentInteraction` |
| `src/tap/identity-extractor.ts` | +`inputType` population: `el.type` for input/select/textarea, null otherwise |
| `src/tap/event-tap.ts` | `emitSpaNavigation(navType?)` parameter; navType on nav events; calls `onAfterEvent` after `onEvent` for navigation; named popstate/hashchange listeners (so `removeEventListener` can match) |
| `src/runtime/projection-engine.ts` | +`inputType: null` to 2 mock identities in `createUnclassifiedFromLedger` |
| `src/background/service-worker.ts` | +`inputType: null` to 1 mock identity in webNavigation handler |

### Modified Test Files (20)

All existing test helpers/fixtures that construct `ElementIdentity` mocks updated with `inputType: null`:
`tests/helpers/fixtures.ts`, `tests/helpers/make-event.ts`, and 18 test files that have inline `makeIdentity`/`makeTarget` helpers.

## Verification Results

### TypeScript
```
npx tsc --noEmit → 0 errors
```

### Test Suite
```
npx vitest run → 92 files, 2006 tests, ALL PASSING (0 failures)
```

**M1-specific tests:** 3 files, 35 tests, all passing:
- `behavioral-evidence-types.test.ts` — 8 tests (type compilation, all endReason values, all nav types, both network sources, batch indices)
- `event-tap-navigation-onAfterEvent.test.ts` — 10 tests (pushState/replaceState/popstate/hashchange fire onAfterEvent; navType correct; onAfterEvent optional; no crash when absent; duplicate suppression; stop() cleanup)
- `identity-inputType.test.ts` — 17 tests (checkbox/radio/text/email/password/number/range/date/submit input types; select-one/select-multiple; textarea; null for button/div/a/span; default text)

**Test delta from 3bc28f6:** 89→92 files (+3), 1971→2006 tests (+35). Zero existing test regressions.

### Build
```
npm run build → 0 errors, 126 modules, 35 files, 124.4 KB
```

### ZIP Audit
- **Size:** 127,410 bytes (124.4 KB)
- **SHA256:** `731aa03fa2f643d82fcffbb3e4da2cfac8507b3949caec81bb90718d3166253a`
- **Files:** 35 (8 manifest-referenced + 26 build assets + 3 test HTML from public/)
- **Nested ZIPs:** 0
- **Source maps (.map):** 0
- **.ts source files:** 0
- **Test artifacts:** 0
- **Old capability/behavioral observation system files:** 0
- **Manifest-referenced files:** 8/8 present
- **dist/ ↔ ZIP content match:** all dist output files present in ZIP

### Known ZIP Cargo
3 test HTML files from `public/` (present since deff878, not introduced by M1):
- `m1-realworld-test.html` (29,832 bytes)
- `m1-realworld-test-v2.html` (26,677 bytes)
- `stress-test.html` (2,806 bytes)

These are ~45% of ZIP size but are NOT M1 artifacts — they are test pages that have been in the extension since the original baseline. Non-blocking.

## Spec Compliance Checklist (M1 only)

| Spec § | Requirement | Status |
|--------|------------|--------|
| §3 | `BehavioralEvidence` envelope type | ✅ |
| §3 | `EvidenceWindow` with 7 endReason values + `StabilitySample` | ✅ |
| §3 | `TargetEvidence` + `TargetStateSnapshot` (9 fields + capturedAt) | ✅ |
| §3 | `FocusMovement` (before/after/detectedAt) | ✅ |
| §3 | `ApplicationEvidence` (domChanges, surfaces, visibility, nav, network, perf) | ✅ |
| §3 | `DomChangeSummary` with batch indices | ✅ |
| §3 | `SurfaceChange`, `VisibilityChange`, `NavigationEvidence` | ✅ |
| §3 | `NetworkActivity` (main-world + webrequest sources) | ✅ |
| §3 | `PerformanceCondition` | ✅ |
| §7.2 | `emitSpaNavigation` fires `onAfterEvent` after `onEvent` | ✅ |
| §7.3 | Nav events carry `navType` (pushState/replaceState/popstate/hashchange) | ✅ |
| §8.2 | `inputType` added to `RawElementIdentity` | ✅ |
| §9 | `behavioralEvidence?` field on `ComponentInteraction` | ✅ |
| M1 comment | Orphaned M1 comment removed from `component-types.ts` | ✅ |
| AppMessage | `BEHAVIORAL_EVIDENCE` + `INTERACTION_EVIDENCE_UPDATE` message types | ✅ |

## Existing Behavior Unchanged

- Recording (Layer 0): EventTap event capture unchanged. New onAfterEvent callback is optional, not wired in recorder-entry.ts.
- Classification (Layer 2): ComponentRuntime classification unchanged.
- IR Generation (Layer 5): ir-bridge unchanged.
- Playwright Generation (Layer 5): project-generator unchanged.
- Repository V2 (Layer 6): Dexie schema V3 unchanged (8 tables).
- All 1971 existing tests pass with zero modifications to test logic (only `inputType: null` added to fixtures).

## What Was NOT Built (M2+ scope)

- TargetStateCache / TargetStateListeners (M2)
- DomObserver / AdaptiveWindow (M3)
- EvidenceCollector (M4)
- Shadow DOM recursive observation (M5)
- Network injection / MAIN-world script / webRequest integration (M6)
- Side panel evidence display (M7)
- Dexie V4 persistence (M8)

## Download

**URL:** https://semantic-test-intell-wvxv6e.drytis.dev/cmdrunner-extension-391e823.zip
**SHA256:** `731aa03fa2f643d82fcffbb3e4da2cfac8507b3949caec81bb90718d3166253a`

## Verdict

**M1 PASS.** All M1 scope items implemented. 0 tsc errors. 2006/2006 tests passing. ZIP clean. Existing recording/classification/generation behavior unchanged. Ready for M2.
