# M7-Fix-001 Final Verification Report

**Commit:** `fadb146` — M7-fix-001: Event→Interaction→Evidence correlation
**ZIP:** `download/cmdrunner-extension-m7fix.zip`
**SHA256:** `1765dede43af3b869c6d24132cc1e908e994549975ee120288194831273bbd95`
**Date:** 2026-08-11
**Verdict:** ✅ **PASS** — all criteria verified

---

## 1. Commit Chain

```
35c6034  Root-cause analysis: evidence stuck at placeholder (ID mismatch)
3224c5e  Event-Interaction-Evidence correlation contract (design only)
fadb146  M7-fix-001: Event→Interaction→Evidence correlation  ← THE FIX
09fe88f  M7-fix-001: implementation report + validation page (report-only, 0 code changes)
```

**`09fe88f` is report-only:** diff scope vs `fadb146`:
- `.drytis/notes/m7fix-implementation-report.md` (+140 lines)
- `public/m7fix-validation.html` (+266 lines)

Zero source code changes. Confirmed via `git diff --stat fadb146..09fe88f`.

**`fadb146` diff scope** (8 files, +1923/−45 lines):
- `src/runtime/sw-integration.ts` (+95) — pendingEvidence Map, storePendingEvidence, attachEvidenceToInteraction (two-tier match), drainPendingEvidence
- `src/background/service-worker.ts` (60 changed) — rewrote handleBehavioralEvidence, broadcast interactionId
- `src/sidepanel/sidepanel.ts` (27 changed) — handleEvidenceUpdate reads interactionId, removed __deferredEvidence
- `src/shared/types.ts` (2 changed) — INTERACTION_EVIDENCE_UPDATE payload: interactionId replaces eventId
- `tests/integration/evidence-correlation.test.ts` (+579) — 20 integration tests
- Notes + spec files (no production code)

---

## 2. ZIP Audit

### Structure
- **40 files**, 489,468 bytes uncompressed
- **Version:** v10.9.0, manifest_v3

### No stale/old/nested bundles
| Check | Result |
|-------|--------|
| Nested ZIPs | ✅ None |
| Source maps (.map) | ✅ None |
| TypeScript source (.ts) | ✅ None |
| Old asset filenames | ✅ None (single SW bundle, single recorder bundle) |
| Asset hash match vs dist/ | ✅ All 22 JS assets identical to dist/ |
| Manifest references | ✅ SW→`service-worker-loader.js`, content script→`recorder-entry.ts-loader-ckksbk5B.js` |

### Bundle-level correlation fix verified in ZIP

**Service Worker bundle** (`assets/service-worker.ts-CCgEKA6e.js`):
- `interactionId`: **9 occurrences**
- `INTERACTION_EVIDENCE_UPDATE` payload broadcasts: `{interactionId:t,evidence:e}` ✅
- `attachEvidenceToInteraction` (minified as `Er`): two-tier match — Tier 1 `triggerEvent?.eventId`, Tier 2 `memberEvents.some(o=>o.eventId)` ✅
- `storePendingEvidence` (minified as `hr`): LRU-capped pendingEvidence Map ✅
- `drainPendingEvidence` (minified as `Se`): checks triggerEvent.eventId then memberEvents[].eventId ✅
- Old `eventId`-based evidence payload: **removed** ✅

**Side Panel bundle** (`assets/index.html-IoiWzSsR.js`):
- `interactionId`: **2 occurrences** (message handler reads `payload.interactionId`)
- `INTERACTION_EVIDENCE_UPDATE` handler: `Vt(n.payload.interactionId, n.payload.evidence)` ✅
- `__deferredEvidence`: **0 occurrences** ✅ (completely removed)
- `behavioralEvidence`: **2 occurrences** ✅ (rendered on data model)
- `Collecting behavioral evidence…` placeholder: present ✅ (shown for interactions without evidence)

---

## 3. M1–M6 Integrity

### Source files unchanged (zero diff vs `3bc28f6` base):
- `src/runtime/event-tap.ts` ✅
- `src/runtime/component-runtime.ts` ✅
- `src/evidence/evidence-collector.ts` ✅
- `src/evidence/target-state-cache.ts` ✅
- `src/evidence/target-evidence.ts` ✅
- `src/evidence/dom-observer.ts` ✅
- `src/evidence/adaptive-window.ts` ✅
- `src/evidence/application-evidence.ts` ✅
- `src/evidence/network-inject.ts` ✅

### Type-only changes (no behavioral change):
- `src/shared/component-types.ts`: Added optional `navType?` field, updated comment on pre-existing `behavioralEvidence` field, added `inputType: null` default
- `src/runtime/projection-engine.ts`: Added `inputType: null` to unclassified event defaults

### Test suite
- **2,224 tests pass** (103 test files)
- 0 failures, 0 errors
- M1–M6 test files all green: `behavioral-evidence-types.test.ts` (8), `identity-inputType.test.ts` (17), `capture-seq.test.ts` (5), `event-tap-after-event.test.ts` (5), `spa-navigation.test.ts` (8), etc.

---

## 4. Nine Evidence Display Criteria

### Source-level verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Placeholder → actual evidence | ✅ PASS | `interaction-renderer.ts:291` — if `interaction.behavioralEvidence`, calls `renderEvidence()` (Target + Application sections); else shows `renderEvidencePlaceholder()` ("⏳ Collecting behavioral evidence…"). Evidence replaces placeholder via `updateEvidenceOnInteraction()` (`evidence-renderer.ts:618-640`). |
| 2 | Target Evidence appears correctly | ✅ PASS | `evidence-renderer.ts:194` — `title.textContent = 'Target Evidence'`; renders identity (tag, role, name), state (classes, attributes), and computed fields. |
| 3 | Application Evidence appears correctly | ✅ PASS | `evidence-renderer.ts:493` — `title.textContent = 'Application Evidence'`; renders DOM changes, mutations, timing data. |
| 4 | Multiple interactions receive correct evidence | ✅ PASS | SW `attachEvidenceToInteraction` iterates `liveInteractions` array; each interaction matched independently by `triggerEvent.eventId` or `memberEvents[].eventId`. Tier 1 always tried before Tier 2 — no cross-attachment. Verified in Scenario 5 (5 rapid interactions, each gets own evidence). |
| 5 | Typing evidence attaches to correct interaction | ✅ PASS | Tier 2 fallback: TextEntry interaction triggered by `focus` event; evidence arrives for `input` event. `memberEvents[].eventId === sourceEventId` matches. Verified in Scenario 2 and integration test `scenario 2`. |
| 6 | Navigation evidence attaches correctly | ✅ PASS | Navigation interaction `triggerEvent.eventId` matches evidence `sourceEventId` (Tier 1). Verified in Scenario 3 and integration test `scenario 3`. |
| 7 | Rapid interactions don't cross-attach | ✅ PASS | Each interaction has a unique `triggerEvent.eventId`. `attachEvidenceToInteraction` scans from index 0; first exact match wins. No fuzzy matching. Verified in Scenario 5 (5 rapid interactions) and integration test `scenario 5`. |
| 8 | Re-render does not lose evidence | ✅ PASS | Evidence is stored on `interaction.behavioralEvidence` (a data-model field, not a DOM attribute). SW persists to `chrome.storage.local` via `persistLiveInteractions()`. On re-render, `LIVE_INTERACTIONS` listener reads from storage → `renderProductionInteractions` → `attachEvidenceDisplay` reads `interaction.behavioralEvidence`. Verified in Scenario 7 and integration test `scenario 7` (JSON round-trip persistence). |
| 9 | Unmatched evidence cannot attach wrong | ✅ PASS | `attachEvidenceToInteraction` returns `null` if no interaction matches either tier. Unmatched evidence stored in `pendingEvidence` Map (LRU-capped at 100). No iteration returns a partial/wrong match. Verified in Scenario 8 and integration test `scenario 8`. |

### Browser-level verification (tester sub-agent)

| Scenario | Validation Page | Integration Test |
|----------|----------------|-----------------|
| 1. Simple Click | ✅ PASS | ✅ PASS |
| 2. Typing Session (Tier 2) | ✅ PASS | ✅ PASS |
| 3. Navigation | ✅ PASS | ✅ PASS |
| 4. Dropdown multi-member (first-write-only) | ✅ PASS | ✅ PASS |
| 5. Rapid consecutive (5 interactions) | ✅ PASS | ✅ PASS |
| 6. Late evidence (pending → drain) | ✅ PASS | ✅ PASS |
| 7. Re-render preserves evidence | ✅ PASS | ✅ PASS |
| 8. Unmatched evidence isolation | ✅ PASS | ✅ PASS |

Validation page summary: **10 interactions, 10 with evidence, 1 pending, 0 placeholders.**

### OrangeHRM reachability
- Login page loads successfully (OrangeHRM OS 5.9, demo credentials Admin/admin123)
- No browser console errors from validation logic

---

## 5. `__deferredEvidence` Removal

- **Before (M7 base):** Side panel had `window.__deferredEvidence` fallback block, stored evidence by eventId, compared badge text (`int-*`) against `evt-*` — always failed.
- **After (M7-fix):** `__deferredEvidence` has **0 occurrences** in side panel bundle. Removed entirely. Evidence flows exclusively through the SW two-tier correlation → `behavioralEvidence` field → `INTERACTION_EVIDENCE_UPDATE` message with `interactionId`.

---

## 6. No Second ID System

- Event IDs: `evt-{captureSeq}` (from EventTap, unchanged since M1)
- Interaction IDs: `int-{counter}` (from ComponentRuntime, unchanged since M2)
- No new ID generation introduced. The fix uses only the existing `triggerEvent.eventId` and `memberEvents[].eventId` to correlate.

---

## 7. Data Flow Summary

```
EventTap → ObservedEvent (eventId: evt-N)
    ↓
ComponentRuntime → ComponentInteraction (interactionId: int-M, triggerEvent: {eventId: evt-N}, memberEvents: [{eventId: evt-N}, ...])
    ↓ onEmit
sw-integration.ts
    ├─ push to liveInteractions[]
    ├─ persistLiveInteractions() → chrome.storage.local
    └─ drainPendingEvidence(interaction)  ← if evidence arrived first
    ↓
EvidenceCollector (content script)
    ↓ chrome.runtime.sendMessage({type: 'BEHAVIORAL_EVIDENCE', detail: {sourceEventId: evt-N, ...}})
    ↓
service-worker.ts handleBehavioralEvidence()
    ├─ storePendingEvidence(evidence)  ← always store first
    └─ attachEvidenceToInteraction(sourceEventId)
        ├─ Tier 1: interaction.triggerEvent.eventId === sourceEventId → MATCH
        ├─ Tier 2: interaction.memberEvents[].eventId === sourceEventId → MATCH
        └─ No match → stay in pendingEvidence (LRU-capped)
    ↓ on match
    ├─ interaction.behavioralEvidence = evidence
    ├─ persistLiveInteractions()  ← persist to storage
    └─ broadcast {type: 'INTERACTION_EVIDENCE_UPDATE', payload: {interactionId: int-M, evidence}}
    ↓
sidepanel.ts handleEvidenceUpdate(interactionId, evidence)
    ├─ Find card by .timeline-event__id badge === interactionId
    └─ updateEvidenceOnInteraction() → renderEvidence() (Target + Application)
```

---

## Summary

| Check | Result |
|-------|--------|
| Commit chain confirmed | ✅ |
| `09fe88f` is report-only | ✅ |
| ZIP SHA256 | `1765dede43af3b869c6d24132cc1e908e994549975ee120288194831273bbd95` |
| ZIP: no stale/old/nested bundles | ✅ |
| ZIP: SW broadcasts interactionId | ✅ (9 occurrences) |
| ZIP: sidepanel reads interactionId | ✅ (2 occurrences) |
| ZIP: `__deferredEvidence` removed | ✅ (0 occurrences) |
| M1–M6 source unchanged | ✅ (type-only diffs) |
| Test suite: 2,224 tests pass | ✅ |
| 8 validation scenarios pass | ✅ |
| 20 integration tests pass | ✅ |
| OrangeHRM reachable | ✅ |
| All 9 display criteria verified | ✅ |

**The M7-fix is verified and ready. No M8 work has been started.**
