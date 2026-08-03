# Spec: Checkbox Links Captured as Links Instead of Checkbox

## Problem
When recording on Amazon.in, clicking left-rail filter checkboxes (e.g., "Get It by Tomorrow", brand "vivo") are captured as **Link** interactions (🔗 icon, "Click ... link" description) instead of **Checkbox** (☑️ icon, "Check/Uncheck ..." description). On Adani One, the same type of checkbox interaction is captured correctly.

## Root Cause
Amazon renders filter toggles as `<a>` tags, not native `<input type="checkbox">` or `role="checkbox"`. The structure is typically:

```html
<a class="a-link-normal s-navigation-item" href="/s?..." aria-label="Apply the filter vivo to narrow results">
  <i class="a-icon a-icon-checkbox"></i>
  <span class="a-list-item">vivo</span>
</a>
```

The recorder pipeline fails at three levels:

1. **`getImplicitRole()`** — returns `'link'` for `<a>` tags via `TAG_ROLE_MAP`. It never checks if the element has `aria-checked` (which implies checkbox semantics) before the tag-map fallback.

2. **`captureCheckedState()`** — only inspects the element itself (native input, `aria-checked`, `aria-pressed`, CSS classes). It does NOT look at descendants. Amazon's `<a>` class (`a-link-normal s-navigation-item`) doesn't contain "checked" — the checked visual indicator is on the inner `<i class="a-icon-checkbox">`. So `captureCheckedState` returns `undefined`, `checkedBefore`/`checkedAfter` are `null`, and the click goes through the regular path.

3. **Classifier (`interaction-detector.ts` line 424 vs 563)** — Checkbox check requires `ariaRole === 'checkbox'`, Link check catches `tag === 'A' || ariaRole === 'link'`. Since `ariaRole` is `'link'` and no checked transition was captured, the element falls through to Link. There is no safety-net check for "this link had a checked-state transition."

## Fix Strategy (3 layers)

### Layer 1: `getImplicitRole()` — aria-checked implies checkbox
In `deterministic-recorder.ts`, after the explicit `role` check and before the tag/input map fallbacks, add: if the element has `aria-checked` attribute, return `'checkbox'`. Per ARIA spec, `aria-checked` is only valid on checkbox-like roles — its presence is a strong semantic signal.

### Layer 2: `captureCheckedState()` — check descendants
If the element itself doesn't have a detectable checked state, walk descendants (up to depth 3) for:
- `<input type="checkbox">` → use its `.checked`
- Element with `aria-checked` → use that value
- Element with CSS class containing "checkbox" (like `a-icon-checkbox`) → infer checked from class

This handles Amazon's `<a>` wrapping `<i class="a-icon-checkbox">`.

### Layer 3: Classifier safety net — checked-transition before Link
In both V1 (`interaction-detector.ts`) and V2 (`interaction-recognizer.ts`), BEFORE the Link classification, add: if the element is an `<a>`/`role=link` AND any click event in the group has `checkedBefore !== null || checkedAfter !== null`, classify as **Checkbox** with the checked state from the event. This catches cases where Layer 1 + 2 succeeded in capturing checked state but the role wasn't overridden.

### Layer 4: `captureCheckedState` in pipeline/tap/identity-extractor.ts
Apply the same descendant-check enhancement to the pipeline path's `captureCheckedState`.

## Files to Change
1. `src/recorder/deterministic-recorder.ts` — `getImplicitRole()` + `captureCheckedState()`
2. `src/classifier/interaction-detector.ts` — classifier safety net (V1)
3. `src/recorder/v2/interaction-recognizer.ts` — classifier safety net (V2)
4. `src/pipeline/tap/identity-extractor.ts` — `captureCheckedState()` descendant check (pipeline path)

## Acceptance Criteria
- [ ] `<a>` with `aria-checked` attribute → `getImplicitRole` returns `'checkbox'`
- [ ] `<a>` wrapping `<input type="checkbox">` → `captureCheckedState` returns the input's checked state
- [ ] `<a>` wrapping `<i class="a-icon-checkbox">` → `captureCheckedState` detects checked state
- [ ] V1 classifier: `<a>`/`role=link` with checked transition → classified as Checkbox
- [ ] V2 classifier: same safety-net check added
- [ ] All existing tests pass (3,333+)
- [ ] New unit tests for each scenario
- [ ] No false positives: real navigation links without checked state still classify as Link
