# M7 Evidence Quality Hardening — Real-Browser Gap Status Report (Post-Fix)

**Date**: 2026-08-12
**Build tested**: `d48f72a` (SHA256 `cdd7587f...`)
**Test site**: OrangeHRM (`opensource-demo.orangehrmlive.com`)
**Evidence source**: 5 manual test screenshots + code-level root-cause analysis

---

## Executive Summary

Of the 7 gaps fixed, **2 are confirmed working** in the real browser, **5 are still failing**. The fixes work in unit tests (jsdom/synthetic) but fail on real-world DOM behavior. Three root causes explain all 5 failures:

1. **Element identity mismatch** (#1 root cause): `target-state-listeners.ts` uses `resolveEl()` (first Element in composedPath) while EvidenceCollector uses the element from EventTap's `resolveTarget()` (first *interactive* element). The WeakMap cache stores under a different key than the peek — `before` snapshot is always null for most interactions.

2. **`detectClassVisibilityChange()` cold-start bug**: The `prevComputedStyles` WeakMap is never seeded. On the first class mutation for any element, there's no cached "before" state, so visibility changes are silently dropped.

3. **Navigation content script destruction**: Full-page reloads and some SPA navigations destroy the content script before the evidence window closes and delivers evidence.

---

## GAP-1: Identity Passthrough

**Status: ✅ WORKING in real browser**

**Observed evidence**: All 5 screenshots show real element identity on every interaction:
- `int-2`: `INPUT [role=textbox] "Username"`
- `int-6`: `BUTTON [role=button] "Login"`
- `int-9`: `A [role=link] "My Info"`
- `int-19`: `DIV [type=oxd-select-text-input] "Algerian"`
- `int-23`: `INPUT [role=radio] "Female"`

**Root cause was**: `onAfterEvent` only passed cssSelector, identity was hardcoded null.
**Fix**: Pass full ElementIdentity through onAfterEvent signature.
**Does the fix work in real browser?**: ✅ YES — "Unknown element" is completely gone.
**Required action**: None.

---

## GAP-2: Text Input Before/After Value

**Status: ❌ STILL FAILING in real browser**

**Observed evidence**: `int-2` (Admin), `int-4` (admin123), `int-15` (Kirubakaran), `int-17` (Loganathan), `int-27` (date picker 2023-09-27) all show **"No observable state changes"**. The typed value before→after diff is NOT displayed.

**Root cause (real)**: Element identity mismatch between `resolveEl()` and `resolveTarget()`:
- `target-state-listeners.ts` `resolveEl()` returns the **deepest element** in `composedPath()` (e.g., the `<span>` inside a `<button>`, or the `<input>` itself)
- EventTap's `resolveTarget()` returns the first **interactive** element (may walk up to a `<div>` wrapper for custom components)
- The `WeakMap` is keyed by **element reference**. If the cache captured under `<input>` but `peek()` is called with a different element reference, `before` is `null`.

For OrangeHRM specifically, the OXD framework wraps inputs in `<div class="oxd-input-wrapper">` elements. The `resolveTarget()` logic may resolve to the wrapper div, not the inner `<input>`. The state cache captures on the `<input>` (via mousedown/keydown composedPath), but `peek()` uses the wrapper div → returns `undefined` → `before = null`.

When `before = null`, `diffSnapshots(null, after)` calls `formatSnapshot(after)`. This shows static values but the `value` property only appears if non-empty (line 126: `if value !== null && value !== ''`). If the after snapshot is on the WRONG element (the wrapper div, not the input), `after.value` is also null/empty → no value displayed at all.

**Does the fix work in real browser?**: ❌ NO — The keydown listener was added but the element identity mismatch means `peek()` still returns null.

**Required fix**: Align element resolution — `target-state-listeners.ts` must use the same `resolveTarget()` logic as EventTap so the WeakMap cache key matches the element EvidenceCollector uses for peek/capture.

**Required test**: Integration test where the target element is a wrapper div containing an inner input. Verify before/after snapshots resolve to the same element.

---

## GAP-3: Visibility Detection (display/visibility/opacity/class/style)

**Status: ❌ STILL FAILING in real browser**

**Observed evidence**: `int-19` (Select "Costa Rican" from dropdown), `int-21` (Select "Single" from dropdown) show **"No observable state changes"**. No visibility changes appear anywhere — not in Target Evidence, not in Application Evidence.

**Root cause (real)**: Two compounding bugs:

1. **`detectClassVisibilityChange()` cold-start bug**: The `prevComputedStyles` WeakMap is never seeded with initial values. On the FIRST class mutation for any element, `cached` is `undefined`, so the entire comparison is skipped. The method just caches the current styles and returns without recording any visibility change. The visibility change is only detected on the SECOND class change on the SAME element (which typically doesn't happen in the same interaction).

2. **These visibility changes are stored in `ApplicationEvidence.visibilityChanges`**, a separate section from Target Evidence state diff. Even when they work, they appear under "Visibility Changes", not in the state diff area where the user expects them.

3. **`detectStyleVisibilityChange()` only parses inline style attribute changes**. If the page changes visibility via external CSS (class toggle that matches a stylesheet rule), the `style` attribute didn't change, so this method doesn't fire. Only `detectClassVisibilityChange()` can catch those — and it has the cold-start bug.

**Does the fix work in real browser?**: ❌ NO — Cold-start bug means first-time visibility changes are always dropped.

**Required fix**:
1. Seed the `prevComputedStyles` WeakMap when DOMObserver starts or when a window opens — capture initial computed styles for all observed elements.
2. Alternatively: seed on first observe (in the MutationObserver callback for the first mutation on each element, capture the "before" state from `record.oldValue` before applying the change).

**Required test**: Open a dropdown that toggles `display:none → block` via class change. Verify visibility change appears in Application Evidence.

---

## GAP-4: Navigation Evidence

**Status: ❌ STILL FAILING in real browser**

**Observed evidence**: `int-7` (Navigation after Login click) and `int-10` (Navigation after clicking "My Info") both show **"Collecting behavioral evidence…"** indefinitely.

**Root cause (real)**: Three compounding issues:

1. **Content script destruction**: OrangeHRM Login causes a full-page reload (form POST → 302 redirect → new page). The content script is destroyed on navigation. The evidence window that was opened by `handleNavigationEvent()` is destroyed before it can close and deliver evidence. The SW never receives the BEHAVIORAL_EVIDENCE message.

2. **SPA navigation timing**: For SPA navigations (pushState), the `handleNavigationEvent()` opens a window for `document.body`. But the DOM mutations from the new page rendering may happen AFTER the window stabilizes (300ms). The window closes with empty DOM changes.

3. **SW correlation**: The navigation interaction's `triggerEvent.eventId` is a synthetic event created by `emitSpaNavigation()`. The ComponentRuntime in the SW creates an interaction for this event. But if the evidence never arrives (content script destroyed), the interaction stays in "Collecting…" state forever.

**Does the fix work in real browser?**: ❌ NO — Navigation type/URL fix is correct (code is right), but evidence delivery fails because the content script is destroyed.

**Required fix**:
1. For full-page reloads: the SW should detect that the page navigated (via `chrome.webNavigation` or `tabs.onUpdated`) and create synthetic navigation evidence from the SW side, not from the content script.
2. For SPA navigations: increase the stabilization window for navigation-triggered windows (e.g., 1000ms instead of 300ms) to capture post-render DOM mutations.
3. The SW should timeout pending evidence after a reasonable period (e.g., 5s) and mark the interaction as "no evidence available" instead of "Collecting…" forever.

**Required test**: Navigate to a page, verify navigation evidence includes DOM changes from the new page content.

---

## GAP-5: Network Activity

**Status: ❌ STILL FAILING in real browser**

**Observed evidence**: Zero interactions show network activity. The Login click (`int-6`) should show a POST request to `/auth/validate`. None appears.

**Root cause (real)**: Multiple possible causes:

1. **MAIN-world injection failure**: The network bridge relies on `chrome.scripting.executeScript({world:'MAIN'})` to inject a script that patches `fetch`/`XMLHttpRequest` in the page's main world. This injection may fail silently on OrangeHRM due to Content Security Policy (CSP) restrictions, or the injection timing may be wrong (injected after the request already fired).

2. **webRequest listener not active**: The SW registers `chrome.webRequest.onCompleted` but the SW may have been killed (MV3 lifecycle) and not restarted when the request fired.

3. **Buffer not collected**: Even if the bridge receives events, `collectForRange()` at window-close time may return empty if the buffer entries have timestamps outside the window range (timing mismatch between content script `performance.now()` and SW `Date.now()`).

4. **Window closes too fast**: The Login click window stabilizes at 300ms. The POST request may not have started yet (React's onClick handler is async, the form submission fires later).

**Does the fix work in real browser?**: ❌ NO — The bounded re-check (200ms) is too short for most real-world API calls, and the underlying network capture may not be working at all.

**Required fix**:
1. Diagnose whether MAIN-world injection actually works on OrangeHRM (check `networkBridge.isMainWorldActive()`).
2. If CSP blocks injection, rely solely on `webRequest` from the SW.
3. Increase the bounded re-check window from 200ms to 1000ms (5×200ms polls) as the spec originally suggested.
4. Fix timestamp normalization between content script and SW.

**Required test**: Click a button that triggers an XHR/fetch. Verify network entry appears with status code and timing.

---

## GAP-6: All Observable State Changes

**Status: ❌ STILL FAILING in real browser**

**Observed evidence**: Only `checked: false → true` appears (on `int-23`, radio button). All other state transitions are absent:
- `value` changes: NOT shown (see GAP-2)
- `aria-expanded`: NOT shown on dropdown interactions
- `disabled`: NOT shown
- `aria-checked`/`aria-pressed`: NOT shown
- `textContent` changes: NOT shown
- `childCount` changes: NOT shown
- CSS/class visibility changes: NOT shown (see GAP-3)

**Root cause (real)**: Three root causes, in order of impact:

### Root Cause #1: Element Identity Mismatch (affects ALL properties)

`target-state-listeners.ts` `resolveEl()` returns the first `Element` in `composedPath()` — the **deepest, innermost element** that was clicked.

`identity-extractor.ts` `resolveTarget()` returns the first **interactive** element — walking UP the composed path to find a `<button>`, `<a>`, `<input>`, `<select>`, or element with `role`, `tabindex`, etc.

These return **different elements** when:
- Clicking a `<button>` containing a `<span>` or `<i>` icon
- Clicking a `<div>` wrapper around an `<input>` (OXD pattern)
- Clicking a label that wraps a checkbox

The `WeakMap` cache stores under the innermost element. The `peek()` call uses the resolved interactive element. **Mismatch → `before` is always null.**

When `before` is null:
- `diffSnapshots(null, after)` calls `formatSnapshot(after)` — shows static values, not diffs
- But `formatSnapshot` SKIPS empty/null values (line 126: `if value !== null && value !== ''`)
- So if the `after` snapshot's element doesn't have the attribute either, nothing shows

For `checked: false → true` it works because:
- Checkbox/radio is typically the direct click target (no wrapper)
- `resolveEl()` and `resolveTarget()` return the same `<input type="checkbox">` element
- The WeakMap key matches → `before` exists → diff works

### Root Cause #2: Target Element vs. State-Change Element Mismatch

Even when `before` and `after` snapshots exist on the SAME element, the relevant state change may occur on a DIFFERENT element:
- Click a button → `aria-expanded` changes on the button → Target Evidence captures this IF the button is the target element ✅
- Click a div trigger → `aria-expanded` changes on a parent wrapper → Target Evidence captures the div, which doesn't have `aria-expanded` → No diff ❌
- Type in an input → `value` changes on the input → Target Evidence should capture this IF the input is the target element

The `aria-expanded` attribute is particularly affected because OXD dropdowns put it on the wrapper div, not the click target.

### Root Cause #3: detectClassVisibilityChange Cold-Start Bug (GAP-3)

CSS/class-driven state changes are handled by DOMObserver, not TargetStateSnapshot. The cold-start bug means they're silently dropped.

**Does the fix work in real browser?**: ❌ NO — The `checked` property works only because checkboxes/radios are direct targets. All other properties fail due to element identity mismatch.

**Required fix**: 
1. **Align element resolution** in `target-state-listeners.ts` to use the same `resolveTarget()` logic as EventTap. This is the highest-impact single fix.
2. **Seed `prevComputedStyles`** WeakMap when DOMObserver starts.
3. **Capture surrounding context** — for `aria-expanded`, check parent elements if the target doesn't have it.

**Required test**: 
- Click a `<button>` containing a `<span>`. Verify before/after snapshots use the same element.
- Click a dropdown trigger. Verify `aria-expanded: false → true` appears.
- Verify `disabled: false → true` appears when a button is disabled after click.

---

## GAP-7: Typing keydown Filter

**Status: ✅ WORKING in real browser**

**Observed evidence**: Screenshots show typing sessions use single windows:
- `int-2` (Admin): 1 window, 304ms, stabilized
- `int-4` (admin123): 1 window, 302ms, stabilized
- `int-15` (Kirubakaran): 1 window
- `int-17` (Loganathan): 1 window

No window thrashing visible. Each typing session produced exactly one evidence window.

**Root cause was**: Every keydown opened a separate evidence window.
**Fix**: EventTap filters keydown to Enter only.
**Does the fix work in real browser?**: ✅ YES — Single windows per typing session confirmed.
**Required action**: None.

---

## Summary Matrix

| Gap | Status | Fix Works in Real Browser? | #1 Root Cause of Failure |
|-----|--------|---------------------------|--------------------------|
| **GAP-1** Identity | ✅ WORKING | ✅ Yes | — |
| **GAP-2** Text value | ❌ FAILING | ❌ No | Element identity mismatch (resolveEl vs resolveTarget) |
| **GAP-3** Visibility | ❌ FAILING | ❌ No | detectClassVisibilityChange cold-start bug |
| **GAP-4** Navigation | ❌ FAILING | ❌ No | Content script destroyed on page reload |
| **GAP-5** Network | ❌ FAILING | ❌ No | MAIN-world injection or webRequest not capturing |
| **GAP-6** All state changes | ❌ FAILING | ❌ No | Element identity mismatch + cold-start bug |
| **GAP-7** Typing | ✅ WORKING | ✅ Yes | — |

## Required Fixes (Priority Order)

1. **P0 — Element resolution alignment**: Make `target-state-listeners.ts` use `resolveTarget()` from `identity-extractor.ts`. This fixes GAP-2, GAP-6 (partially), and is the root cause of most missing state changes.

2. **P0 — Visibility cold-start seed**: Pre-seed `prevComputedStyles` WeakMap when DOMObserver starts or when a new observation window opens. This fixes GAP-3, GAP-6 (partially).

3. **P1 — Navigation evidence delivery**: Handle full-page reload navigation evidence from the SW side. Add timeout for stuck "Collecting…" state. This fixes GAP-4.

4. **P1 — Network capture diagnosis**: Diagnose whether MAIN-world injection works. Increase bounded re-check from 200ms to 1000ms. This fixes GAP-5.

5. **P2 — Surrounding context capture**: For `aria-expanded`/`disabled` on wrapper elements, check parent/ancestor elements in the snapshot.

---

## End of Report — No code changes made. Awaiting direction.
