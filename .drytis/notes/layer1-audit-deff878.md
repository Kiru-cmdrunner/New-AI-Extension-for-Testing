# Layer 1 Audit — Behavioral Observation (`deff878`)

**Date:** 2026-08-11
**Baseline:** `deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8`
**Scope:** `src/tap/observation-coordinator.ts`, `src/tap/document-observer.ts`, `src/tap/element-state-cache.ts`, `src/tap/state-cache-listeners.ts`, `src/shared/observation-types.ts`, SW-side handling in `src/runtime/sw-integration.ts` + `src/background/service-worker.ts`
**Method:** Read-only source inspection of deff878 worktree. No modifications.

---

## 🔴 CRITICAL

### 1B-C-1: Observation windows open for click+change only — 70%+ of interactions get zero behavioral evidence

`recorder-entry.ts:362-363`: `if (eventType === 'click' || eventType === 'change')`

7 of 14 definitions get NO observation windows at all:
- ColorInput (focus), Slider (focus), TextEntry (focus), Hover (mouseenter), Scroll (scroll), Navigation (navigation) — zero behavioral evidence ever.

2 of 14 get PARTIAL windows:
- DatePicker (focus+click): gets windows only when the user clicks, not on focus-triggered interactions.
- Dropdown (focus+blur+click): same — focus-triggered dropdowns get no observation.

5 of 14 get FULL windows: Checkbox, Click, FileUpload, Link, RadioButton, Tab.

This is the single highest-impact limitation at deff878. DF-1 was designed to address it.

### 1B-C-2: MutationObserver does not observe Shadow DOM — mutations inside open shadow roots are invisible

`document-observer.ts:122`: `observer.observe(document.body, {subtree: true})`

`subtree: true` only covers the light DOM tree. It does NOT cross into shadow roots. Any SPA using Web Components (lit-element, Stencil, Lightning Web Components, native custom elements) produces DOM mutations inside shadow roots that this observer never sees. DF-8 was designed to address this.

---

## 🟠 HIGH

### 1B-H-1: No buffer cap on document-observer records array

`document-observer.ts:91`: `private records: MutationRecord2[] = []`

No hard limit. Mutation-heavy SPAs (React re-rendering large lists, animated CSS class toggling) can produce thousands of records per 3-second window. With overlapping windows, the shared buffer accumulates all. Each record includes targetPath + oldValue + newValue strings. ~200KB per window possible.

### 1B-H-2: Orphaned observation keys — the crash root cause vector

Every BEHAVIORAL_EFFECTS message stores `cmdrunner_obs_{eventId}` in chrome.storage.local before acking. Keys deleted only at Safe Points. Events that never produce a matching interaction create orphaned keys that grow linearly. Documented in memory-accumulation-vectors-validated.md as reaching 143MB in 3 hours. Fully active at deff878.

### 1B-H-3: handleBehavioralEffects() does O(n) full-array scan per observation

getLiveInteractions() returns [...liveInteractions] (full copy). Scans ALL interactions for matching eventId. At 500 interactions: O(500) per observation delivery.

### 1B-H-4: Path computation doesn't cross shadow boundaries

computePath() and computeElementPath() walk parentElement which returns null at shadow boundaries. Paths for shadow-DOM elements are truncated and misleading. Display-only, but makes mutation evidence uninterpretable for shadow components.

---

## 🟡 MEDIUM

### 1B-M-1: Fixed 3-second window — no early closure

Every window runs full 3000ms regardless of mutation stabilization. Near-zero-mutation apps waste 2.9+ seconds.

### 1B-M-2: WeakRef GC loses element-removed distinction

If ref.deref() returns undefined, finalSnapshot is null but endReason stays 'completed' instead of 'element-removed'. May mislead Effect Interpreter.

### 1B-M-3: SessionStorage behavioral buffer O(n²)

Same JSON.parse→push→JSON.stringify pattern. Max 200 entries with full mutation arrays. ~10KB per entry for 50-mutation observations.

### 1B-M-4: documentWideMutationTotal redundant O(n) scan

getTotalRecordsDuringWindow() does a second full filter in addition to getRecordsForWindow().

### 1B-M-5: No observation for keyboard-triggered interactions

keydown triggers Click definition but does NOT open an observation window. Keyboard-only users produce interactions with zero behavioral evidence.

### 1B-M-6: CSS path O(depth × siblings) on cache miss

Array.from(parent.children).filter() per depth level. React-re-rendered elements cause cache misses.

---

## 🟢 LOW

### 1B-L-1: PerformanceCondition is dead diagnostic

15ms threshold, recorded but never consumed by any downstream consumer at deff878.

### 1B-L-2: setTimeout not guaranteed at 3s

Browser throttles backgrounded tabs. Window could run longer, attributing unrelated mutations.

### 1B-L-3: sourceElementPath stale by close time

Computed at window open, never updated. DOM restructuring makes it inaccurate. Display-only.

### 1B-L-4: cleanupAllObsKeys() fire-and-forget

Storage removal at stopRecording uses .then().catch() — failures leave stale keys silently.

### 1B-L-5: Cache pre-populates only on mousedown+focus

Elements triggered by mouseenter, scroll, or keyboard never get before-state captured. Hover interactions always start with null before-state.
