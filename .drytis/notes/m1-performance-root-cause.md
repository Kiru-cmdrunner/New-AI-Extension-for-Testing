# M1 Performance Root Cause Analysis
**Date:** 2026-08-04T17:10Z
**Trigger:** User reports application slowdown during recording with M1 build

## Root Cause: Three Compounding Factors

### RC1 — Heaviest Possible MutationObserver Configuration (PRIMARY)

M1's DocumentObserver (`document-observer.ts` line 122-129):
```js
this.observer.observe(document.body, {
  childList: true,
  attributes: true,          // ALL attributes — no filter
  characterData: true,       // ALL text changes
  subtree: true,             // entire document
  attributeOldValue: true,   // browser must clone+store old value per mutation
  characterDataOldValue: true,
});
```

This is the **maximum-cost** MutationObserver config possible:
- `attributes: true` without `attributeFilter` → observes EVERY attribute on EVERY element including `style` (fires on every CSS animation frame, every React render, every Vue update)
- `attributeOldValue: true` → browser must deep-clone the previous attribute value before each mutation — this is extremely expensive during animations
- `characterData: true` + `characterDataOldValue: true` → same cloning for every text node change

**Contrast with existing a43df53 recorder** (deterministic-recorder.ts line 1340-1345):
```js
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'aria-modal', 'open'],
  // NO attributeOldValue, NO characterData
});
```

The existing recorder filters to 6 specific attributes and doesn't request old values. M1 requests everything.

### RC2 — Continuous 3-Second Observation Windows

The existing recorder's surface detection runs for **500ms** after a click then disconnects. M1's DocumentObserver runs for **3000ms** per interaction via the ObservationCoordinator.

On an active recording session, if a user clicks 5 elements within 10 seconds, there are overlapping 3s windows keeping the heavy observer continuously active. The observer never gets a chance to disconnect.

### RC3 — Per-Mutation CSS Path Computation

`compact()` (line 273-308) calls `getPath()` on every mutation target. While WeakMap-cached, the cache is cold for dynamically created elements (React virtual DOM, virtualized lists). Each cache miss walks the entire parent chain computing `nth-of-type` by scanning siblings with `Array.from(parent.children).filter(...)` — O(n) per level, O(n*d) per element.

During a React render cycle that creates 50 new elements, that's 50 uncached path computations, each walking ~10 levels deep with sibling scans = ~500 DOM operations in a single mutation callback.

### RC4 — Compounding with Existing Recorder Observers

During recording, there are up to **3 concurrent MutationObservers** on document.body:
1. M1 DocumentObserver (heaviest config, 3s per interaction)
2. Deterministic recorder surface detection (per-click, 500ms)
3. Deterministic recorder hover observer (on hover)

Three subtree observers on document.body is a known browser performance cliff.

## Impact by Application Type

| App Type | Mutation Volume | Impact |
|----------|----------------|--------|
| Static HTML (W3Schools) | Low | Minimal — works fine |
| React/Vue/Angular SPA | High (100s per render) | Severe — style mutations dominate |
| Animation-heavy (Amazon, dashboards) | Very High (1000s per animation) | Crippling — freezes the page |
| Virtualized lists | Burst (100s on scroll) | Severe during scroll |

## Fix Options (Ordered by Impact, No Architecture Change)

### Option A: Add attributeFilter (Highest Impact, Lowest Risk)
Replace `attributes: true` with `attributes: true, attributeFilter: [...]` covering the attributes M1 actually needs as evidence:
- `class`, `style`, `aria-checked`, `aria-expanded`, `aria-pressed`, `aria-selected`, `aria-disabled`, `hidden`, `aria-hidden`, `role`, `data-*`, `value`, `checked`, `selected`, `disabled`, `open`

This eliminates the bulk of noise (React/Vue internal data attributes, CSP nonce changes, framework instrumentation attributes). `style` is the single biggest source of mutations during animations.

**Risk:** Misses custom attribute changes outside the filter. But M1's Phase A cache already captures property-level state (checked, value, etc.) — Phase B is for attribute-level evidence that Phase A misses.

### Option B: Batch Processing with requestIdleCallback
Instead of processing every mutation synchronously in the callback, batch them and process during idle time. Mutations are already queued by the browser — deferring the compact/path work doesn't lose evidence.

### Option C: Reduce Window Duration for Active Pages
The fixed 3s window was chosen to capture async responses. But most synchronous mutations complete within 500ms. A tiered approach: 500ms of guaranteed observation, then continue only if mutations are still arriving (but this contradicts the "fixed window" decision).

### Option D: Skip CSS Path for High-Volume Batches
When a batch exceeds N records (e.g., 50), skip CSS path computation for that batch — just record the mutation type and counts. Path can be deferred or omitted for noise batches.
