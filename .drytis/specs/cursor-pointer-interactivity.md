# Spec: cursor:pointer Interactivity Signal

## Problem

Custom interactive elements (`<div>`, `<span>`) that lack standard HTML tags,
ARIA roles, tabIndex attributes, or matching CSS class patterns are invisible
to `isInteractiveElement()` in `patterns.ts`. They are captured by the EventTap
(the content script always captures), reach the Component Runtime's discovery
phase, match no definition, and surface as Unclassified.

Amazon "With Exchange" options exemplify this: rendered as bare `<div>` or
`<span>` elements styled with `cursor:pointer` but no semantic markup. The
browser knows they're interactive (shows pointer cursor), but the classification
layer has no way to know.

## Root Cause

`dom-context-extractor.ts` extracts 13+ DOM attributes but **not** computed
style `cursor`. The `resolveTarget()` function in `identity-extractor.ts` already
uses `getComputedStyle(el).cursor === 'pointer'` (Strategy 2, line 496) to
resolve target elements — but this signal is used only for target selection and
is **not propagated** into `ObservedEvent.domContext` for the SW's classification.

`isInteractiveElement()` has 4 criteria (tag, ARIA role, tabIndex, class
pattern) but no 5th "browser-determined interactivity" signal.

## Design

### Principle
Capture what the browser already computed. Do NOT add application-specific
patterns. The browser's `cursor:pointer` declaration is the strongest
generic signal that an element is meant to be clicked — it is the developer's
explicit declaration of intent via CSS.

### Scope: classification only
This change affects ONLY whether the Click/Hover definitions' `detectTrigger()`
recognizes an element as interactive. It does NOT:
- Change lifecycle ownership (`lifecycleOwnsTarget`)
- Change discovery semantics (`tryDiscovery` iteration order)
- Change projection semantics (Unclassified detection)
- Change capture semantics (EventTap, resolveTarget)
- Change IPC volume (same events captured, same delivery)

### Changes (5 files)

#### 1. `src/shared/component-types.ts` — DomContext interface
Add one optional field to `DomContext`:
```typescript
/** True if getComputedStyle(el).cursor === 'pointer' at capture time. */
cursorPointer?: boolean;
```

#### 2. `src/definitions/dom-context-extractor.ts` — capture
Add `cursorPointer` extraction to `extractDomContext()`:
```typescript
cursorPointer: getCursorPointer(el),
```
New private helper:
```typescript
function getCursorPointer(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  try {
    return window.getComputedStyle(el).cursor === 'pointer';
  } catch {
    return false;
  }
}
```
**Performance**: One `getComputedStyle()` call per discrete event. The same
pattern already exists in `element-state-cache.ts:184` (for opacity/display/
visibility) and in `resolveTarget()` (identity-extractor.ts:495). Discrete
events fire ~2-5/sec during normal interaction — negligible overhead.

#### 3. `src/definitions/patterns.ts` — isInteractiveElement
Add a 5th criterion. Change signature from 4 params to 5:
```typescript
export function isInteractiveElement(
  tag: string,
  ariaRole: string | null,
  className: string | null,
  tabIndex: number | null,
  cursorPointer?: boolean,
): boolean {
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (ariaRole && INTERACTIVE_ROLES.has(ariaRole)) return true;
  if (tabIndex !== null && tabIndex >= 0) return true;
  if (className && INTERACTIVE_CLASS_RE.test(className)) return true;
  if (cursorPointer === true) return true;  // NEW
  return false;
}
```
The param is optional (`?`) so existing call sites that don't pass it are
unaffected.

#### 4. `src/definitions/click.ts` — pass cursorPointer through
```typescript
detectTrigger(event: ObservedEvent): ComponentTrigger | null {
  const { tag, ariaRole, className } = event.target;
  const tabIndex = event.domContext.tabIndex ?? null;
  const cursorPointer = event.domContext.cursorPointer ?? false;
  if (!isInteractiveElement(tag, ariaRole, className, tabIndex, cursorPointer)) {
    return null;
  }
  return { type: 'Click' };
},
```

#### 5. `src/definitions/hover.ts` — pass cursorPointer through
```typescript
detectTrigger(event: ObservedEvent): ComponentTrigger | null {
  if (event.eventType !== 'mouseenter') return null;
  const { tag, ariaRole, className } = event.target;
  const cursorPointer = event.domContext.cursorPointer ?? false;
  if (!isInteractiveElement(tag, ariaRole, className,
      event.domContext.tabIndex ?? null, cursorPointer)) {
    return null;
  }
  return { type: 'Hover' };
},
```

## False Positive Analysis

### Risk: `cursor:pointer` on non-interactive containers/drag surfaces

This is the primary risk. Common scenarios where `cursor:pointer` appears on
elements a QA engineer would NOT write as a test step:

1. **Container wrappers**: Some frameworks apply `cursor:pointer` to a
   wrapper `<div>` that contains the actual button. The event's
   `composedPath()[0]` resolves to the inner element, but `resolveTarget()`
   Strategy 1 walks up to the wrapper. Result: the wrapper is classified as
   Click. **Mitigation**: This is already the case today — `resolveTarget()`
   already returns the `cursor:pointer` element. The change only means it's
   now classified as Click instead of Unclassified. An Unclassified entry is
   not useful; a Click entry is at least correctly typed.

2. **Drag surfaces**: Custom drag areas often have `cursor:pointer`.
   **Mitigation**: DragDrop has priority 30, Click has priority 180. If the
   element receives `pointerdown` → `pointerup` with movement, DragDrop claims
   it first (priority 30 < 180). Click only fires on `click` events, which
   DragDrop abandonment routes through. No conflict.

3. **Decorative/hover-only elements**: Tooltips, info icons with
   `cursor:pointer` that toggle content visibility but have no action.
   **Mitigation**: If they receive a click event, they ARE interactive — the
   user clicked them. Capturing as Click is correct behavior. The test can
   always be deleted from the final output.

4. **Card/list row containers**: Product cards, table rows with
   `cursor:pointer` for "click anywhere to navigate."
   **Mitigation**: These ARE clickable navigation actions. The Link definition
   (priority 70) or Click definition (priority 180) captures them — which is
   correct if the user clicked the card to navigate.

### Verdict on false positives
The risk exists but is **bounded and acceptable**. Every false-positive Click
replaces what would have been an Unclassified entry (worse). No existing correct
classification is degraded — the new criterion only fires when all 4 existing
criteria fail, meaning the element was previously Unclassified anyway.

## Interaction with Capture Guarantee v2 and lifecycleOwnsTarget

- **Capture Guarantee v2**: Unaffected. The guarantee ensures every discrete
  event is represented in the final output. `cursorPointer` only changes
  whether the Click definition recognizes the event — the projection engine's
  Unclassified fallback still catches anything that doesn't match.

- **`lifecycleOwnsTarget()`**: Unaffected. Ownership testing uses
  `semanticChildRoles` and `surfaceRole` from the definition, not
  `isInteractiveElement()`. The comment at component-runtime.ts:92 confirms:
  "No framework heuristics. No isInteractiveElement(). No CSS selectors."

- **Discovery order**: Unchanged. `cursorPointer` is an additional criterion
  inside `isInteractiveElement()`, which is only called by Click (priority 180,
  the fallback) and Hover (priority 60). All higher-priority definitions
  (Dropdown 20, DatePicker 30, DragDrop 30, Checkbox 40, ... Link 70) run
  first and claim their elements before Click is consulted.

## Acceptance Criteria

- [ ] `DomContext` interface has `cursorPointer?: boolean` field
- [ ] `extractDomContext()` computes `cursorPointer` via `getComputedStyle`
- [ ] `isInteractiveElement()` accepts optional `cursorPointer` param
- [ ] `isInteractiveElement()` returns true when `cursorPointer === true` and
      all other criteria fail
- [ ] Click definition passes `cursorPointer` from `event.domContext`
- [ ] Hover definition passes `cursorPointer` from `event.domContext`
- [ ] Existing `isInteractiveElement('DIV', null, null, null)` returns false
      (default `cursorPointer` is undefined, not true)
- [ ] Existing Click/Hover tests pass without modification (backward compat)
- [ ] New test: `isInteractiveElement('DIV', null, null, null, true)` → true
- [ ] New test: bare `<div>` with `cursorPointer:true` → Click (not Unclassified)
- [ ] New test: Amazon exchange simulation (`<div>` cursor:pointer, no role)
      → Click
- [ ] New test: `<div>` with `cursorPointer:false` → Unclassified (unchanged)
- [ ] New test: higher-priority definition still wins (Dropdown with
      cursor:pointer trigger still classifies as Dropdown)
- [ ] New test: DragDrop still claims pointerdown before Click (priority)
- [ ] All existing tests pass (0 regressions)
- [ ] TypeScript compiles with 0 errors
- [ ] Extension builds successfully
