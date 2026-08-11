# M5 Final Baseline Verification Report

**Commit chain:** `d8f67c4` → `74873bb` → `897e611` → `919e711` → `ef62970` → `68f576e` → `20f5be8` → `391e823` → `3bc28f6`  
**Date:** 2026-08-11T15:12 UTC  
**Scope:** Final verification of M5 (Shadow DOM) baseline before advancing to M6  
**Method:** Read-only audit — no files modified

---

## 1. Commit Chain ✓

```
d8f67c4  M5 implementation + validation report
74873bb  M5 Shadow DOM: recursive shadow root observation + shadowContext propagation
897e611  M4 final baseline verification report + tech debt record
919e711  M4: validation report + test page
ef62970  M4: EvidenceCollector — end-to-end evidence orchestration
68f576e  M3 ApplicationEvidence: DOMObserver + AdaptiveWindow + mutation cap
20f5be8  M2 TargetEvidence: TargetStateCache + capture-phase listeners
391e823  M1 Foundation: behavioral evidence types + EventTap hooks + identity inputType
3bc28f6  Clean baseline (Capability Model + Behavioral Observation removed)
```

Each parent confirmed:
- `d8f67c4` → parent `74873bb` ✓
- `74873bb` → parent `897e611` ✓
- `897e611` → parent `919e711` ✓
- `919e711` → parent `ef62970` ✓
- `ef62970` → parent `68f576e` ✓
- `68f576e` → parent `20f5be8` ✓
- `20f5be8` → parent `391e823` ✓
- `391e823` → parent `3bc28f6` ✓

**Verdict: Chain confirmed — 9 commits from clean baseline to M5 report.**

---

## 2. `d8f67c4` Contains Only Report ✓

Diff `74873bb..d8f67c4`:
```
A  .drytis/notes/m5-implementation-report.md   (+169 lines)
1 file changed, 169 insertions(+)
```

Zero source code, zero test, zero config changes.

**Verdict: Confirmed — `d8f67c4` is a pure documentation addition.**

---

## 3. Only `dom-observer.ts` Changed for M5 Source ✓

Diff `897e611..74873bb` (M5 implementation commit):
```
A  public/m5-shadow-validation.html    (test page, +222)
M  src/tap/dom-observer.ts              (+177 net LOC)
A  tests/tap/shadow-dom-observer.test.ts (unit tests, +280)
```

Source files changed: **`src/tap/dom-observer.ts` ONLY.**

No modifications to: `evidence-collector.ts`, `event-tap.ts`, `identity-extractor.ts`, `target-state-cache.ts`, `target-state-listeners.ts`, `adaptive-window.ts`, `recorder-entry.ts`, `service-worker.ts`, `behavioral-evidence-types.ts`, or any other source file.

**Verdict: Confirmed — M5 is surgically scoped to `dom-observer.ts`.**

---

## 4. No M6/M7/M8 Functionality ✓

| Milestone | Check | Result |
|---|---|---|
| **M6 (Network)** | `webRequest` permission in manifest | Not present ✓ |
| **M6 (Network)** | `networkActivity` populated in evidence | Still `[]` hardcoded with `// M6 scope` comment ✓ |
| **M6 (Network)** | MAIN-world injection / fetch interception | Not present ✓ |
| **M7 (Side Panel)** | Evidence renderer in UI | Not present ✓ |
| **M8 (Persistence)** | Dexie V4 schema | Still at V3 (8 tables, no evidence tables) ✓ |
| **M8 (Persistence)** | Evidence stored in IndexedDB | Not present ✓ |

**Verdict: Confirmed — zero future milestone code has leaked in.**

---

## 5. All M1–M4 Behavior Unchanged ✓

Full test suite: **99 files, 2,151 tests passing** (0 failures).

M1–M4 specific test suites (216 tests):
- behavioral-evidence-types (8) ✓
- event-tap (13) ✓, event-tap-after-event (5) ✓, event-tap-navigation-onAfterEvent (10) ✓
- identity-extractor (26) ✓, identity-inputType (17) ✓
- capture-seq (5) ✓
- target-state-cache (38) ✓, target-state-listeners (16) ✓
- dom-observer (25) ✓, adaptive-window (18) ✓, dom-change-cap (10) ✓
- evidence-collector (25) ✓

**Verdict: Confirmed — zero regressions in M1–M4 behavior.**

---

## 6. Shadow DOM Evidence Reaches M4 BehavioralEvidence Pipeline ✓

Complete evidence flow trace verified by source code inspection:

```
1. Shadow root MutationObserver fires
   → this.onMutations(records, shadowContext)          [line 421]

2. onMutations calls processRecord with context
   → processRecord(record, batchIndex, now, shadowContext)  [line 491]

3. processRecord builds shadow-aware path
   → getElementPath(targetEl, shadowContext)           [line 503]
   → returns "[shadowContext] > tag#id" for shadow elements

4. processRecord stores context in AccumulatedSummary
   → acc.shadowContext = shadowContext                 [line 325]
   → key includes [shadowContext] prefix for grouping

5. detectSurfaceChanges propagates context
   → SurfaceChange.shadowContext = shadowContext       [line 414, 432]

6. detectVisibilityChange propagates context
   → getElementPath(el, shadowContext)                 [line 460]

7. At window close, EvidenceCollector reads accumulated data:
   → domObserver.getAccumulatedSummaries()             [evidence-collector.ts:293]
   → finalizeSummary copies acc.shadowContext           [dom-observer.ts:709]

8. BehavioralEvidence assembled with both scopes:
   → targetEvidence + applicationEvidence               [evidence-collector.ts:308-342]
   → domChanges include shadow-DOM summaries with non-null shadowContext
```

**Verdict: Confirmed — shadow DOM mutations flow through the entire pipeline to BehavioralEvidence delivery.**

---

## 7. ZIP Built From This Commit, No Stale Bundles ✓

| Check | Result |
|---|---|
| SHA256 | `405c62c4fdaa9cb713b9e283b17ec37788d611151566909aba2ede721a1c4724` |
| File count | 38 files |
| Nested ZIPs | 0 ✓ |
| Source maps | 0 ✓ |
| .ts source files | 0 ✓ |
| Old Capability Model traces | 0 ✓ |
| Old Behavioral Observation traces | 0 ✓ |
| Old Semantic Effects traces | 0 ✓ |
| Bundle ↔ dist/ hash match | 25/25 ✓ |
| Shadow DOM code in recorder bundle | `discoverShadow`, `shadowContext`, `shadowObserver`, `shadowRoot`, `ShadowRoot` confirmed ✓ |
| Manifest references resolve | All 8 verified ✓ |
| Working tree clean | Yes ✓ |

**Verdict: ZIP is clean, built from current source, contains no stale artifacts.**

---

## Summary

| Verification | Status |
|---|---|
| Commit chain (9 commits, correct parentage back to `3bc28f6`) | ✓ PASS |
| `d8f67c4` = only report beyond `74873bb` | ✓ PASS |
| Only `dom-observer.ts` changed for M5 source | ✓ PASS |
| No M6/M7/M8 functionality present | ✓ PASS |
| All M1–M4 behavior unchanged (2,151 tests) | ✓ PASS |
| Shadow DOM evidence reaches BehavioralEvidence pipeline | ✓ PASS |
| ZIP clean, no stale/old bundles | ✓ PASS |

**M5 baseline is verified and stable. Ready for M6 (Network Evidence) when directed.**
