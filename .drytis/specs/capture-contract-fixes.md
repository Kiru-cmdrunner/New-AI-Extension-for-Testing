# Capture/Classification Contract Fixes — Design Spec

## Problem Summary

Three independent gaps cause deliberate user actions to be silently dropped or
misclassified on real-world custom components (Amazon, React apps, etc.):

1. **resolveTarget → isInteractiveElement gap:** `resolveTarget()` captures
   clicks on elements with `cursor:pointer` or `[onclick]`, but
   `isInteractiveElement()` doesn't check either of these signals. Events
   captured by the content script are silently dropped at Click classification.

2. **Dropdown lifecycle absorption:** A misclassified Dropdown candidate
   claims subsequent clicks via `isInScope()`, prevents them from reaching
   Click discovery, and then abandons after 15s — consuming both the
   Dropdown AND the legitimate click.

3. **OpenDetail sequence context:** `precededByListContext` looks at the
   immediately preceding interaction, which may be a Navigation consequence
   event rather than the real preceding user action. This deflates
   OpenDetail confidence below Navigate, producing incorrect classifications.

---

## Fix A: Clickability Evidence Flow (resolveTarget → isInteractiveElement)

### Root Cause

`resolveTarget()` (identity-extractor.ts:491-498) has Strategy 2 that captures
clicks on elements with `cursor:pointer` or `[onclick]`. But when the event
reaches `click.ts:33`, `isInteractiveElement()` (patterns.ts:74-85) checks only
tag, ARIA role, tabIndex, and class patterns — NOT cursor:pointer or onclick.

The gap: an element passes the capture gate but fails the classification gate.
No error, no log, no interaction emitted.

### Design

**Capture the clickability evidence at extraction time, carry it in DomContext,
use it at classification time.**

#### A1. Extend DomContext with `isClickable` boolean

Add `isClickable: boolean` to `DomContext` (component-types.ts L49).

This field captures whether `resolveTarget` found the element via Strategy 2
(cursor:pointer / onclick) — the same heuristic that decided to capture the
event in the first place. This is NOT the same as `isInteractiveElement`:
`isClickable` means "the browser treats this element as clickable", while
`isInteractiveElement` means "the element has well-known interactive semantics."

#### A2. Compute `isClickable` in dom-context-extractor.ts

In `extractDomContext()` (dom-context-extractor.ts:25), add:

```typescript
isClickable: isClickableElement(el),
```

New function:

```typescript
function isClickableElement(el: Element): boolean {
  // cursor:pointer — the universal CSS signal for "this is clickable"
  if (el instanceof HTMLElement) {
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') return true;
  }
  // Explicit onclick attribute (native HTML)
  if (el.hasAttribute('onclick')) return true;
  // onclick property (React/Vue/Angular attach via JS, not attribute)
  if (el instanceof HTMLElement && typeof (el as any).onclick === 'function') return true;
  return false;
}
```

This runs in the content script during event capture (same call stack as
`resolveTarget`), so it sees the same DOM state. It captures ALL three forms
of clickability: CSS cursor:pointer, HTML onclick attribute, and JS onclick
property (React/Vue attach handlers via .onclick, not setAttribute).

#### A3. Update isInteractiveElement to accept isClickable

Add optional 5th parameter to `isInteractiveElement()` (patterns.ts:74):

```typescript
export function isInteractiveElement(
  tag: string,
  ariaRole: string | null,
  className: string | null,
  tabIndex: number | null,
  isClickable?: boolean,  // NEW — from DomContext
): boolean {
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (ariaRole && INTERACTIVE_ROLES.has(ariaRole)) return true;
  if (tabIndex !== null && tabIndex >= 0) return true;
  if (className && INTERACTIVE_CLASS_RE.test(className)) return true;
  if (isClickable) return true;  // NEW — cursor:pointer or onclick
  return false;
}
```

#### A4. Pass isClickable in click.ts detectTrigger

In `click.ts:28-35`, pass the new field:

```typescript
detectTrigger(event: ObservedEvent): ComponentTrigger | null {
  const { tag, ariaRole, className } = event.target;
  const tabIndex = event.domContext.tabIndex ?? null;
  const isClickable = event.domContext.isClickable ?? false;
  if (!isInteractiveElement(tag, ariaRole, className, tabIndex, isClickable)) {
    return null;
  }
  return { type: 'Click' };
}
```

### Why this is application-agnostic

- `cursor:pointer` is CSS standard — every framework uses it
- `[onclick]` and `.onclick` are DOM standard — every framework uses them
- No site-specific class patterns are added
- The same signals that `resolveTarget` already trusts for capture now flow
  through to classification

### Tests

1. `click.ts` with `isClickable=true`, non-interactive tag → Click interaction emitted
2. `click.ts` with `isClickable=false`, non-interactive tag → null (unchanged)
3. `click.ts` with `isClickable=true` AND interactive tag → Click (already matches, no regression)
4. Integration: Div with cursor:pointer → Click interaction in output
5. Integration: Bare div without clickability → no interaction (unchanged)
6. Regression: all existing click tests pass with `isClickable` defaulting to false

---

## Fix B: Dropdown Lifecycle Absorption Guard

### Root Cause

When a Dropdown is triggered (e.g., by a class matching `DROPDOWN_TRIGGER_CLASS_RE`),
it goes on the active stack. Subsequent clicks inside its `isInScope()` surface
are consumed by the Dropdown and never reach Click discovery. If the clicked
element doesn't match `isDropdownOption()`, the Dropdown never completes. After
15 seconds, `cleanupStaleComponents` abandons it. The legitimate click that was
absorbed is lost.

### Design

**Two changes: drop stale Dropdowns on any click that isn't a dropdown option;
and if the stale Dropdown's trigger had no selection, don't emit it as abandoned.**

#### B1. Add stale-component cleanup on every click event

Currently `cleanupStaleComponents` runs at the top of `process()` but only
checks `MAX_LIFECYCLE_DURATION_MS`. We add an additional check: **when a new
click event arrives and an active Dropdown has NOT received an option-selection
event, complete the Dropdown as completed-without-selection and let the click
fall through to discovery.**

This is in `component-runtime.ts`, inside the "Offer to active stack" loop
(step 3, lines 168-239). When a Dropdown is on the stack and the current event
is a click that is NOT in the Dropdown's scope:

- The Dropdown's `shouldCancelOnOutside` is checked → returns false (current code)
- We add: if the event is a `click` and none of the Dropdown's member events
  contained a selection (no `ctx.data.selectedValue`), force-complete the
  Dropdown as `'interrupted'` and remove it from the stack. Then let the click
  event proceed to discovery (step 4).

This prevents the Dropdown from sitting on the stack absorbing clicks.

#### B2. Filter interrupted Dropdowns from production output

In `isProductionInteraction()` (output-adapter.ts), add:

```typescript
case 'Dropdown':
  if (metadata.noOpSelection === true) return false;
  // Interrupted dropdown = opened but never selected. Not a user action.
  if (interaction.endState === 'interrupted') return false;
  return true;
```

This ensures that a misidentified Dropdown (opened by a non-dropdown click)
doesn't pollute the output with an empty, interrupted record.

### Why this works

- A real Dropdown: user clicks trigger → dropdown opens → user clicks option →
  Dropdown completes with selectedValue. The guard never fires.
- A misidentified Dropdown: user clicks something with a "select"-like class →
  Dropdown opens → user clicks a swatch/button → swatch isn't a dropdown option
  → the next click event forces the Dropdown to complete as 'interrupted' →
  swatch click proceeds to Click discovery → swatch is emitted as Click.
- The interrupted Dropdown is filtered from production output.

### Tests

1. Dropdown trigger + click on non-option element → Dropdown interrupted, Click emitted
2. Dropdown trigger + option click → Dropdown completed, no phantom Click
3. Interrupted Dropdown filtered from productionInteractions
4. Regression: existing Dropdown lifecycle tests (OrangeHRM, Avis Ford) unchanged

---

## Fix C: OpenDetail Sequence Context — Skip Navigation Events

### Root Cause

`precededByListContext` (evidence-extractor.ts:328-330) checks only the
immediately preceding interaction:

```typescript
const precededByListContext =
  previous != null &&
  (previous.type === 'TextEntry' || previous.type === 'Dropdown' || previous.type === 'Checkbox');
```

In real recordings, the interaction before a product link is often a Navigation
consequence event (browser navigated to the search results page). Navigation
is not TextEntry/Dropdown/Checkbox → `precededByListContext = false` →
OpenDetail loses a supporting signal → drops to MEDIUM → Navigate wins.

### Design

**Scan backwards past Navigation events to find the real preceding user action.**

Replace the single-previous check with a backward scan that skips Navigation
interactions:

```typescript
// List context: preceded by a user action (not Navigation consequence)
// that establishes a results/list context.
let precededByListContext = false;
const LIST_CONTEXT_TYPES = new Set(['TextEntry', 'Dropdown', 'Checkbox']);
if (previous != null) {
  // Scan backward, skipping Navigation consequence events
  for (let i = index - 1; i >= 0; i--) {
    const prevInteract = interactions[i];
    if (prevInteract.type === 'Navigation') continue; // skip consequence events
    if (LIST_CONTEXT_TYPES.has(prevInteract.type)) {
      precededByListContext = true;
    }
    break; // stop at first real user interaction
  }
}
```

### Why this works for the real Amazon recording

```
[1] TextEntry "iphone 17"
[2] Click "Go"
[3] Navigation (to search results)
[4] Link "iPhone 17 Pro Max"  ← product link
```

- Old behavior: `previous` = [3] Navigation → `precededByListContext = false`
- New behavior: scan back from [4]: [3] is Navigation → skip, [2] is Click
  → not in LIST_CONTEXT_TYPES → break → false. Still false!

Wait — Click is NOT in LIST_CONTEXT_TYPES. The user searched (TextEntry [1]),
then clicked Go ([2] Click). The interaction immediately before the product
link (skipping Navigation) is Click "Go", which is not TextEntry/Dropdown/Checkbox.

**This means precededByListContext is still false even after the fix**, because
the search was TextEntry but there's a Click "Go" between it and the product link.

### Revised Design

The current `precededByListContext` definition is too narrow. The semantic
intent is "the user was in a context where browsing/list items are displayed."
The correct signal is: **any preceding TextEntry or Dropdown on the same page
before this navigation**. This already exists as `precededByFormInteraction`
which scans backward on the same page.

But `precededByFormInteraction` checks same-page (previousUrl === currentUrl),
which won't work across a navigation boundary.

**Better approach: use the item-specific evidence itself as the differentiator.**

The real issue is: Navigate HIGH (2 non-keyword: Link type + urlChanged) beats
OpenDetail MEDIUM (1 non-keyword: Link type). But OpenDetail has **stronger
required evidence** — it only fires when the URL contains an item-specific
identifier (ASIN, UUID, /dp/, /product/). That IS a highly specific signal.

**Fix: count the item-specific URL match as a supporting signal for OpenDetail.**

In `open-detail.ts`, add a new supporting signal:

```typescript
// S4: Item-specific URL match (the URL itself carries a product/item identifier)
// This is strong structural evidence — ASINs, UUIDs, and /dp/ paths are
// unambiguously item-specific.
if (hasNavToItemUrl || hasItemHref) {
  streams.add('structural');
  supportingCount++;
}
```

This gives OpenDetail: Link type (1) + item-specific URL (1) = 2 non-keyword → HIGH.
Now OpenDetail HIGH ties with Navigate HIGH, and OpenDetail wins via priority (10 < 30).

This is architecturally correct: matching an ASIN or UUID in the URL IS
genuinely strong evidence that this is an item-detail navigation, not a
generic page navigation.

### Tests

1. Product link with ASIN URL → OpenDetail HIGH (not MEDIUM)
2. Product link with item-specific href → OpenDetail HIGH
3. Generic page link (no item-specific pattern) → Navigate wins (OpenDetail doesn't fire)
4. Phase 7 Amazon test: amz-004 → OpenDetail HIGH with Navigate HIGH as alternative
5. Phase 7 OpenDetail unit tests: confidence bumped from MEDIUM to HIGH for item-specific cases
6. Regression: all Phase 3 navigation tests updated for new confidence

---

## Files to Change

| File | Change | Lines |
|------|--------|-------|
| `src/shared/component-types.ts` | Add `isClickable: boolean` to DomContext | +1 |
| `src/definitions/dom-context-extractor.ts` | Add `isClickableElement()` + wire into extractDomContext | +15 |
| `src/definitions/patterns.ts` | Add `isClickable` param to `isInteractiveElement` | +3 |
| `src/definitions/click.ts` | Pass `isClickable` from domContext | +2 |
| `src/runtime/component-runtime.ts` | Force-complete stale Dropdowns on non-option click | +15 |
| `src/presentation/output-adapter.ts` | Filter interrupted Dropdowns | +3 |
| `src/capabilities/rules/open-detail.ts` | Count item-specific URL as supporting signal | +5 |
| **Tests** | | |
| `tests/definitions/click-clickable.test.ts` | New: clickability evidence flow | ~80 |
| `tests/runtime/dropdown-absorption.test.ts` | New: absorption guard | ~60 |
| `tests/capabilities/phase3-navigation-rules.test.ts` | Update OpenDetail confidence expectations | ~10 |
| `tests/capabilities/phase7-realworld-validation.test.ts` | Update OpenDetail confidence | ~5 |

## Implementation Order

1. Fix A (clickability flow) — independently testable
2. Fix B (dropdown absorption guard) — independently testable
3. Fix C (OpenDetail item-specific signal) — independently testable
4. Full regression
5. Build + verify
