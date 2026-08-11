# Behavioral Evidence Model Spec Review

**Spec under review**: `.drytis/specs/behavioral-evidence-model.md` (v1.0)
**Reviewer**: Lead architect
**Date**: 2026-08-11
**Baseline**: `aef34a0`

---

## Verdict: 4 issues must be resolved before implementation. 5 additional issues should be resolved but are not blocking.

---

## Critical Issues (BLOCKING — must fix before implementation)

### C1. Content Script Runs in ISOLATED World — Network Interception Will Not Work

**The problem**: The manifest does not specify `"world": "MAIN"`, so the content script runs in Chrome's **ISOLATED world** by default. In isolated world:
- `window.fetch` and `window.XMLHttpRequest` are **separate copies** from the page's versions
- Monkeypatching them intercepts only the content script's own network calls, not the page's
- The page's JavaScript calls its own `window.fetch` — the isolated world patch never fires

**Spec §6.1** proposes monkeypatching `window.fetch` and `XMLHttpRequest.prototype.open/send` "in the content script's execution context." This will capture **zero** page network requests.

**Evidence**: Manifest confirmed at `src/manifest.json`:
```json
"content_scripts": [{
  "matches": ["<all_urls>"],
  "js": ["src/recorder/phase5/recorder-entry.ts"],
  "all_frames": true,
  "run_at": "document_start"
  // NO "world" field → defaults to ISOLATED
}]
```

**Options**:
1. **MAIN world injection** — register a SECOND content script with `"world": "MAIN"` that runs the network/nav monkeypatch. This is the standard approach. Requires manifest change + careful coordination between isolated and main world scripts (they can communicate via `window.postMessage` or `CustomEvent`).
2. **`chrome.webRequest` API** — available in MV3 service worker. Requires `"webRequest"` permission. Captures URL/method/status/headers but NOT response bodies. Works regardless of page world. Does NOT require page-level monkeypatching.
3. **`chrome.debugger` API** — full CDP access. Too heavy and shows a warning banner to the user. Not recommended.

**Recommendation**: Option 1 (MAIN world injection) for fetch/XHR + Option 2 (webRequest) as a fallback for pages with strict CSP that blocks main-world script injection. The spec must define the inter-world communication contract.

**Impact if unresolved**: `ApplicationEvidence.networkActivity[]` will always be empty. The correlation layer loses the strongest causality signal for async content changes.

---

### C2. EventTap Already Patches History API — NavWatcher Will Conflict

**The problem**: `EventTap` (`src/tap/event-tap.ts` lines 134-146) already monkeypatches `history.pushState` and `history.replaceState` and listens for `popstate` and `hashchange`. The spec proposes a separate `NavWatcher` component that does the same thing.

If both patch `history.pushState`, the patches stack: EventTap's patched version calls the original, then NavWatcher's patched version (which is now the "original" from EventTap's perspective) calls its original. This creates:
- Double-fired navigation events
- Ordering-dependent behavior
- Restoration complexity (which patch to remove first on stop)

**Evidence**: EventTap at lines 134-146:
```typescript
history.pushState = function patchedPushState(...args) {
  originalPushState(...args);
  emitSpaNavigation();  // fires ObservedEvent with type 'navigation'
};
history.replaceState = function patchedReplaceState(...args) {
  originalReplaceState(...args);
  emitSpaNavigation();
};
```

**Recommendation**: Do NOT create a separate NavWatcher. Instead, consume the navigation events that EventTap already emits. EventTap's `emitSpaNavigation()` fires `onEvent` with `eventType: 'navigation'`. The EvidenceCollector should:
1. Detect `eventType === 'navigation'` in `onAfterEvent`
2. Record a `NavigationEvidence` entry directly from the existing EventTap data (which already has `pageUrl`, `pageTitle`)
3. If a navigation event arrives during an open window, close it with `endReason: 'navigation'`

This eliminates the NavWatcher component entirely and avoids double-patching.

**Impact if unresolved**: Double navigation events, fragile history API patching, potential crashes.

---

### C3. ElementIdentity Already Exists — Spec Defines a Redundant Subset

**The problem**: The spec proposes a new `ElementIdentity` interface (§3.3) with 10 fields (testId, ariaRole, accessibleName, htmlId, cssPath, textContent, tagName, inputType, shadowHostPath). But `identity-extractor.ts` (504 LOC) already extracts a **richer** identity with 18+ fields including all of the spec's fields plus dataCy, dataQa, xPath, ariaLabel, ariaLabelledBy, placeholder, name, className, href, inIframe, shadowDom, and iframeContext.

The spec's `ElementIdentity` is a **strict subset** of the existing `RawElementIdentity` (defined in `src/shared/types.ts` lines 112-149). The existing extractor already handles:
- Shadow DOM awareness (`shadowDom: boolean`)
- Iframe context (`inIframe: boolean`, `iframeContext`)
- 10-tier accessible name cascade
- Implicit ARIA role mapping
- CSS selector and XPath generation
- testId, dataCy, dataQa extraction

**Recommendation**: Do NOT define a new ElementIdentity. Reuse the existing `ElementIdentity` from `src/shared/types.ts`. The spec should reference it:
```typescript
import type { ElementIdentity } from '../shared/types';

interface TargetEvidence {
  identity: ElementIdentity;  // existing 18-field identity
  before: TargetStateSnapshot | null;
  after: TargetStateSnapshot | null;
  focusMovement: FocusMovement | null;
}
```

The `identity-capture.ts` file should be deleted from the plan — `extractIdentity(el)` already exists in `identity-extractor.ts` and is called by EventTap at capture time. The `observed.target` field on every `ObservedEvent` already carries the full identity.

**Impact if unresolved**: Two parallel identity systems, code duplication, maintenance burden, and the new system is actually less capable than the existing one.

---

### C4. Coarse Mode Discards ALL domChanges — Loses Important Evidence

**The problem**: Spec §5.2 Stage 3 says: when `domChanges.length > 200`, discard ALL entries and switch to coarse mode. This is destructive — the first 200 summaries, which contain the earliest mutations (most likely action-caused, per batchIndex reasoning), are thrown away.

On a virtual-scrolling SPA, the first 5 mutations might be the action-caused surface change, followed by 300 scroll-churn mutations. The current cap logic would discard the important 5 along with the noise.

**Recommendation**: Replace "discard all" with progressive degradation:
1. **At 200 entries**: Stop accepting new domChange summaries but KEEP the existing 200
2. **Set a flag**: `applicationEvidence.coarseMode = true` (add to ApplicationEvidence)
3. **Track overflow count**: `applicationEvidence.domChangeOverflow = N` (how many were dropped)
4. Continue tracking newSurfaces, removedSurfaces, navigation, and network regardless

This preserves the earliest (most relevant) evidence while bounding memory.

**Impact if unresolved**: On high-churn pages, the most important evidence (what the click actually did) is discarded alongside noise.

---

## High Severity Issues (should fix before implementation)

### H1. Batch Index Is Ambiguous With Concurrent Windows

**The problem**: Spec §4.4 says mutations are "attributed to all active windows at capture time" (inheriting the old system's `windowIds[]` model). Each window has its own `batchCounter`. But a single MutationObserver callback batch gets attributed to multiple windows simultaneously — each window would assign it a different `batchIndex`.

Example:
- Window A opened at T=0, batchCounter at 2
- Window B opened at T=100, batchCounter at 0
- Mutation batch at T=150 → Window A calls it batchIndex=2, Window B calls it batchIndex=0

The correlation layer sees different batchIndex values for the same physical mutation batch, making cross-window comparison unreliable.

**Recommendation**: Use a **shared batch counter** across all concurrent windows, not per-window. The DOMObserver increments one global counter per callback. Each window records the batch indices that fall within its `[openedAt, closedAt]` range. This way `batchIndex=5` means the same thing regardless of which window observed it.

**Impact if unresolved**: Cross-window timing correlation is unreliable. The correlation layer can't compare "this mutation happened in batch 0 of window A" vs "batch 2 of window B" because the indices are per-window.

---

### H2. EventTap Captures More Events Than the Spec Acknowledges

**The problem**: Spec §4.1 lists events that trigger observation: "click, change, submit, keydown (Enter), scroll (debounced), mousedown, focus, blur." But the actual EventTap (`src/tap/event-tap.ts` lines 298-306) registers:

```typescript
const eventTypes: string[] = [
  'click', 'mousedown', 'contextmenu',
  'focus', 'blur',
  'input', 'change',
  'mouseenter', 'mouseleave', 'mousemove',
  'keydown',
  'scroll',
];
```

Discrepancies:
- **`submit`**: Not registered by EventTap. Spec claims it triggers observation, but EventTap never fires it.
- **`input`**: Registered by EventTap but NOT mentioned in the spec's trigger list. `input` fires on every keystroke in a text field — this is the primary typing event.
- **`contextmenu`**: Registered but not mentioned in spec.
- **`mouseenter`/`mouseleave`/`mousemove`**: Registered but not mentioned. These are high-frequency events that would flood observation if they triggered windows.

**Recommendation**:
1. Update §4.1 to list the actual EventTap event types
2. Explicitly decide which EventTap events trigger evidence windows vs. which are capture-only (no observation window)
3. Add `submit` to EventTap's registration list if form submission observation is desired
4. Explicitly EXCLUDE `mouseenter`, `mouseleave`, `mousemove` from triggering observation windows (they're capture-only — EventTap records them for identity/classification but they shouldn't open evidence windows)
5. Add `input` to the list — it's the primary typing event and must be handled

**Impact if unresolved**: Either missing observation for important events (input, submit) or excessive observation for noise events (mousemove).

---

### H3. Typing Strategy Needs Explicit Design — Not Just an Open Question

**The problem**: The spec lists typing as Open Question #2 with a "recommendation: debounce." But typing is one of the most common interaction types, and the design choice cascades into:
- How many BehavioralEvidence objects a text field produces (1 per keystroke vs 1 per typing session)
- When the TargetStateSnapshot `before`/`after` values are captured
- How the adaptive window handles continuous keystroke-driven mutations
- How network evidence correlates with debounced search-as-you-type

This is not a question to defer — it's a design decision that shapes the EvidenceCollector lifecycle.

**Recommendation**: Resolve this now. Proposed design:

- **`input` events** do NOT open new observation windows. Instead, they **extend** the currently open window (reset the stabilization timer).
- If no window is open (first keystroke), open one. The `before` snapshot captures the pre-typing state.
- Each subsequent `input` event resets the stabilization timer (user is still typing).
- The window closes when typing stops for `minQuiescence` (300ms).
- The `after` snapshot captures the final typed value.
- The `sourceEventType` is `'input'` for the window.
- This produces ONE BehavioralEvidence per typing session, with `before.value = ""` and `after.value = "laptop"`.

**Impact if unresolved**: Either hundreds of evidence windows per text field (one per keystroke), or undefined behavior when the implementation reaches this point.

---

### H4. Scroll Observation Needs Explicit Design — Not Just an Open Question

**The problem**: Similar to typing. Scroll on infinite lists is important (new content loads), but scroll produces no meaningful TargetEvidence. The spec defers this as Open Question #1.

**Recommendation**: Resolve now:
- **`scroll` events** trigger observation windows ONLY if the scroll produces DOM mutations (new content loaded via infinite scroll)
- The EvidenceCollector opens a window on scroll, but with `targetEvidence` set to minimal values (no before/after state change for the scroll container)
- The adaptive window's stabilization logic naturally handles this: if scroll doesn't produce mutations, the window closes after `minQuiescence` with minimal evidence
- If scroll DOES load new content, the ApplicationEvidence captures the new surfaces/domChanges
- Scroll events are **throttled** (EventTap already rate-limits scroll at line 25) — no more than 1 window per 500ms of scrolling

**Impact if unresolved**: Either no scroll observation (missing infinite scroll content) or excessive scroll-triggered windows (memory waste).

---

### H5. Contradiction: "No New Dexie Tables" vs. "Separate Evidence Table"

**The problem**: §11.5 says Repository V2 is "Unchanged — no new tables." But Open Question #6 recommends "store evidence in a separate evidence table (new Dexie table)." These contradict each other.

**Recommendation**: Acknowledge that evidence persistence IS a schema change. If evidence is stored inline with interactions (current plan), a single session with 50 interactions × 200 domChanges each could produce 10,000+ JSON entries in one interaction blob — potentially exceeding Dexie/IndexedDB practical limits.

The correct answer depends on whether evidence is needed at query time or only for audit/replay:
- **Query-time** (future correlation layer reads it) → separate table with indexed foreign keys
- **Audit/replay only** (stored but rarely accessed) → inline with interactions is fine, with a size cap

Recommend deferring the persistence design to the implementation phase but acknowledging in the spec that this IS a schema decision, not a "no change."

---

## Medium Severity Issues (fix during implementation)

### M1. `submit` Event Missing From EventTap

EventTap does not register a `submit` listener. If form submission observation is desired (which it should be — submitting a form is a major interaction), EventTap must be modified to capture `submit` events. This is a code change to an "unchanged" system, so the spec should note it.

### M2. `performanceCondition.mainThreadBlocked` Overloaded Semantics

The spec uses `mainThreadBlocked = true` for two different conditions:
1. MutationObserver callback exceeded 15ms (§9.3)
2. Coarse mode activated due to >200 domChanges (§5.2 Stage 3)

These are different conditions. A page could have fast mutation callbacks but 300 mutation groups (no thread blocking, just high churn). Recommend splitting into `mainThreadBlocked` (timing-based) and `highChurnMode` (volume-based).

### M3. No Timestamp for Identity Capture

`ElementIdentity` is collected at window-open time but has no `capturedAt` timestamp. If the correlation layer needs to know whether identity was captured before or after a particular mutation batch, it has no reference point. Recommend adding `identityCapturedAt: number` (relative to openedAt, should always be 0 or near-0).

### M4. Missing `inputType` in Existing ElementIdentity

The existing `ElementIdentity` (types.ts) does not have an explicit `inputType` field — it has `tag` (e.g., 'INPUT') but not the input's `type` attribute (e.g., 'text', 'checkbox', 'email'). The spec's ElementIdentity includes `inputType`, but the existing extractor doesn't populate it. The existing `getImplicitRole()` reads the type attribute internally but doesn't expose it. This needs to be added to the extractor.

### M5. Stability Trace Collection Interval Unclear

The spec says `stabilizationCheck: 100ms` but doesn't clarify whether this is a `setInterval` polling approach or event-driven. A 100ms `setInterval` that runs for the entire observation window (up to 10s) produces 100 timer callbacks. Recommend using the MutationObserver callback itself as the stability signal (reset a `setTimeout(minQuiescence)` on each callback) instead of polling.

---

## Sufficiency Assessment for Future AI Correlation Layer

### What the correlation layer gets (SUFFICIENT):

1. ✅ **Raw timing** — `relativeTime` + `batchIndex` for every change group, network request, navigation, and surface appearance
2. ✅ **Structural context** — shadowContext paths, target paths, element tags, ARIA roles
3. ✅ **Network timing** — request start/end relative to event, status, duration (once C1 is resolved)
4. ✅ **Window metadata** — open/close times, end reason, stability trace
5. ✅ **Element identity** — full 18-field identity from existing extractor (once C3 is resolved)
6. ✅ **Surface detection** — new/removed surfaces with ARIA roles and timing
7. ✅ **Navigation context** — SPA route changes with timing and URL delta

### What the correlation layer DOES NOT get (GAPS):

1. ⚠ **Response body size** — knowing a fetch returned 50KB vs 5MB helps distinguish "loaded a full page" from "fetched a small update." Consider adding `Content-Length` from response headers if accessible via `chrome.webRequest`.

2. ⚠ **CSS computed style changes** — the spec tracks attribute changes (class, style) but not computed style deltas. A framework might add `class: 'loading'` which changes `display: none → block` on a child. The correlation layer would see the class change but not the computed effect. Consider adding a `computedStyleChanges[]` field for elements whose `display`/`visibility`/`opacity` computed values changed.

3. ⚠ **Window overlap metadata** — when concurrent windows overlap, the correlation layer needs to know which windows were active during a given mutation batch. Currently, mutations are copied to all active windows, but there's no explicit overlap map. Consider adding `concurrentWindowIds: string[]` to each DomChangeSummary.

4. ⚠ **Frame context for evidence** — `all_frames: true` means evidence comes from multiple frames. The spec (Open Question #3) recommends tagging with `frameId`. This must be resolved — the correlation layer needs to know whether a mutation happened in the main frame or an iframe. Recommend: tag every BehavioralEvidence with `frameId: string` (top frame = 'main', iframes get their URL or index).

5. ⚠ **Element property changes beyond the 9 tracked** — the TargetStateSnapshot tracks 9 properties, but modern web components may expose meaningful state via custom properties (`.open`, `.selected`, `.value` on custom elements). Consider adding `customProperties: Record<string, string | boolean | null>` for known component property patterns.

---

## Summary of Required Changes Before Implementation

| ID | Severity | Change Required |
|---|---|---|
| C1 | **BLOCKING** | Define network interception strategy for ISOLATED world (MAIN world injection + webRequest fallback) |
| C2 | **BLOCKING** | Remove NavWatcher component; consume existing EventTap navigation events instead |
| C3 | **BLOCKING** | Remove redundant ElementIdentity definition; reuse existing 18-field identity from identity-extractor.ts |
| C4 | **BLOCKING** | Change coarse mode to keep first 200 + flag overflow, not discard all |
| H1 | HIGH | Use shared batch counter across concurrent windows, not per-window |
| H2 | HIGH | Reconcile spec's event list with actual EventTap registrations; add `input`, add `submit`, exclude mousemove/mouseenter/mouseleave |
| H3 | HIGH | Resolve typing strategy: extend-on-input, one window per typing session |
| H4 | HIGH | Resolve scroll strategy: observe with minimal TargetEvidence, throttle |
| H5 | HIGH | Acknowledge evidence persistence is a schema decision; remove contradiction |
| M1-M5 | MEDIUM | Address during implementation |

---

## Open Questions — Resolutions

| # | Question | Resolution |
|---|---|---|
| 1 | Scroll observation | **RESOLVED**: Open window on scroll (throttled 1/500ms), minimal TargetEvidence, rely on adaptive window to close quickly if no mutations. See H4. |
| 2 | Keyboard typing | **RESOLVED**: Extend-on-input model. First `input` event opens window, subsequent events reset stabilization timer, window closes on quiescence. One BehavioralEvidence per typing session. See H3. |
| 3 | iframe support | **RESOLVED**: Tag every BehavioralEvidence with `frameId`. Top frame = `'main'`, iframes get their URL. Evidence from different frames stays separate. The existing identity-extractor already captures `inIframe` and `iframeContext`. |
| 4 | Accessible name computation | **RESOLVED**: Use the existing `computeAccessibleName()` from `identity-extractor.ts` (already implements the 10-tier cascade). No new computation needed. |
| 5 | Network interceptor + CSP | **PARTIALLY RESOLVED**: MAIN world injection for normal pages. For pages with strict CSP that blocks inline script injection, fall back to `chrome.webRequest` API (metadata only). Add `"webRequest"` to manifest permissions. See C1. |
| 6 | Evidence retention | **DEFERRED**: Acknowledge as a schema decision. Recommend separate Dexie table for evidence with foreign key to interactions. Implement in Phase 8 (production hardening). See H5. |
