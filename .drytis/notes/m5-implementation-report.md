# M5 Implementation + Validation Report

**Commit:** 74873bb (branch: capability-surgical-removal)  
**Parent:** 897e611 (M4 final baseline verification)  
**M4 baseline:** 919e711 → ef62970 → 68f576e → 20f5be8 → 391e823 → 3bc28f6  
**Spec:** `.drytis/specs/behavioral-evidence-model.md` v3.0, §5.1  
**Date:** 2026-08-11

---

## What Was Built

### M5 scope: Recursive Shadow DOM Observation

All changes are in `src/tap/dom-observer.ts` (extended from 528 → 705 LOC). No changes to EvidenceCollector, EventTap, IdentityExtractor, or any other module.

#### New: Shadow root discovery and observer attachment

**`discoverShadowRoots(root, parentContext)`** — Recursively walks `querySelectorAll('*')` checking each element for `.shadowRoot`. For each open shadow root:
1. Checks the 20-root cap (`MAX_SHADOW_ROOTS`)
2. Builds a `shadowContext` path via `buildShadowContextPath(host, parentContext)`
3. Creates a per-root `MutationObserver` observing `{childList, attributes, attributeOldValue, characterData, characterDataOldValue, subtree: true}`
4. Recursively discovers shadow roots within that shadow root (nested support)
5. Re-scans when childList mutations add new elements (dynamic shadow roots)

**`buildShadowContextPath(host, parentContext)`** — Builds a hierarchical CSS-like path. For nested roots: `"outer-component > inner-component"`.

**`buildCssSegment(el)`** — Disambiguated segment with `nth-of-type` for siblings.

#### Modified: Existing DOMObserver methods

| Method | Change |
|---|---|
| `start()` | Calls `discoverShadowRoots(document.body, null)` on first start |
| `stop()` | Disconnects all shadow observers, clears `shadowObservers` and `shadowHosts` maps |
| `onMutations(records, shadowContext)` | Accepts context param; re-scans for new shadow roots on childList additions |
| `processRecord()` | Uses actual `shadowContext` (was hardcoded `null`); groups by `targetPath` which now includes `[shadowContext]` prefix |
| `detectSurfaceChanges()` | Accepts and propagates `shadowContext` |
| `detectVisibilityChange()` | Accepts and propagates `shadowContext` |
| `getElementPath(el, shadowContext?)` | Extended to detect shadow root boundary via `getRootNode()`, stops traversal at ShadowRoot parent, prefixes path with `[shadowContext]` |

#### New fields and diagnostics

- `shadowObservers: Map<ShadowRoot, {observer, shadowContext}>`
- `shadowHosts: Map<Element, ShadowRoot>`
- `shadowRootOverflow: boolean`
- `getShadowRootCount()` / `getShadowRootOverflow()` — diagnostic methods

#### Design decisions

1. **Composition over modification** — Shadow root observers are managed entirely within DOMObserver. EvidenceCollector needed zero changes — shadow DOM evidence flows through existing accumulation APIs.
2. **Re-scan on mutation** — New shadow roots added after observation starts are discovered via childList mutation re-scanning (spec §5.1).
3. **Closed roots** — `shadowRoot === null` due to `mode: 'closed'` cannot be observed. This is a fundamental browser security boundary. Documented as inherent limitation (spec §5.1).
4. **Path prefix** — Shadow DOM elements get `[shadowContext] > path` prefix for unambiguous grouping.

---

## What Was NOT Built

- M6: Network Evidence (MAIN-world injection, webRequest)
- M7: Side Panel Display of evidence
- M8: Persistence (Dexie V4)
- Causal correlation or interpretation
- No changes to EvidenceCollector, EventTap, IdentityExtractor, or any non-DOMObserver module

---

## Verification

### TypeScript
```
npx tsc --noEmit → 0 errors
```

### Unit Tests
```
npx vitest run → 99 files, 2151 tests passing (+13 new)
```

### shadow-dom-observer.test.ts (13 tests)
- Single shadow root discovery
- Dynamic shadow root discovery
- Closed shadow root (no crash)
- Light DOM mutations have null shadowContext
- Shadow DOM mutations carry non-null shadowContext (INV-SHADOW-1)
- Nested shadow roots without crashing
- 20-root cap enforcement
- stop() disconnects all shadow observers
- clearAccumulated clears shadow summaries
- getElementPath includes [shadowContext] prefix
- Integration with DOMObserver APIs
- Multiple independent shadow roots
- Rapid mutations across shadow + light DOM

### Build
```
npm run build → 38 files, 134.9 KB (includes m5-shadow-validation.html)
```

### ZIP Audit
- 38 files, 134.9 KB
- 0 nested ZIPs ✓
- 0 source maps ✓
- 0 .ts source files ✓
- 0 old Capability Model / Behavioral Observation / Semantic Effects traces ✓
- All manifest-referenced files present ✓
- SHA256: `23fa96df707f86fb2bdf0c7d669f0ebf45482f801a92a7cf3f51bef9e335bf7d`

### Real-Browser Validation (9/9 PASS, 0 console errors)
| # | Scenario | Verdict | Detail |
|---|---|---|---|
| 1 | Single shadow root interaction | ✓ PASS | content="Clicked at 3:06:17 PM" |
| 2 | Nested shadow root interaction | ✓ PASS | innerContent="Inner clicked!" |
| 3 | Shadow → internal change (counter) | ✓ PASS | counter="Count: 3" |
| 4 | Shadow → internal change (items) | ✓ PASS | items=2 |
| 5 | Shadow → light DOM change | ✓ PASS | content="Updated by shadow component", bg="rgb(212, 237, 218)" |
| 6 | Multiple independent shadow roots | ✓ PASS | c1="Clicked in ind-1", c2="ind-2", c3="ind-3" |
| 7 | Rapid shadow + light interactions | ✓ PASS | shadow=5, status="Shadow + Light: 5 clicks" |
| 8 | Dynamically added shadow root | ✓ PASS | content="Dynamic shadow clicked!" |
| 9 | No console errors | ✓ PASS | 0 errors |

### M1–M4 Behavior Unchanged
All 216 M1–M4 tests pass:
- behavioral-evidence-types (8), event-tap (13), event-tap-after-event (5), event-tap-navigation-onAfterEvent (10), identity-extractor (26), identity-inputType (17), capture-seq (5)
- target-state-cache (38), target-state-listeners (16)
- dom-observer (25), adaptive-window (18), dom-change-cap (10)
- evidence-collector (25)

---

## Files Changed

| File | Change | Delta |
|---|---|---|
| `src/tap/dom-observer.ts` | MODIFIED | +705/-528 (177 net new) |
| `tests/tap/shadow-dom-observer.test.ts` | NEW | +280 |
| `public/m5-shadow-validation.html` | NEW (test page) | +222 |

**Total:** 3 files changed, +733 insertions, -21 deletions

---

## Commit History

```
74873bb M5 Shadow DOM: recursive shadow root observation + shadowContext propagation
897e611 M4 final baseline verification report + tech debt record
919e711 M4: validation report + test page
ef62970 M4: EvidenceCollector — end-to-end evidence orchestration
68f576e M3 ApplicationEvidence: DOMObserver + AdaptiveWindow + mutation cap
20f5be8 M2 TargetEvidence: TargetStateCache + capture-phase listeners
391e823 M1 Foundation: behavioral evidence types + EventTap hooks + identity inputType
3bc28f6 Clean baseline (Capability Model + Behavioral Observation removed)
```

---

## Known Limitations (M5 Scope)

1. **Closed shadow roots**: Cannot be observed (`shadowRoot === null`). This is a browser security boundary. The IdentityExtractor records `shadowDom: true` but no mutations can be captured. Documented in spec §5.1.
2. **20-root cap**: If exceeded, `shadowRootOverflow = true` and further roots are skipped. No retry or eviction of earlier roots (could be added in a future iteration).
3. **Re-scan cost**: Each childList mutation in the light DOM triggers `querySelectorAll('*')` on newly added elements. For large dynamic content, this has a cost. The scan is scoped to added nodes only (not the full document).
4. **No shadow root eviction**: Shadow roots whose host elements are removed from the DOM remain observed until the DOMObserver stops. Their MutationObservers will stop receiving records but are not disconnected.

---

## Conclusion

M5 is complete. DOMObserver now recursively discovers and observes open shadow roots. Mutations inside shadow roots carry non-null `shadowContext` paths. EvidenceCollector required zero changes — shadow DOM evidence integrates transparently through existing APIs. All 9 browser scenarios pass with zero console errors. Existing M1–M4 behavior is unchanged. Ready for M6 (Network Evidence) when directed.
