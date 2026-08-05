# G2 and G7 Deep Validation Report

**Date**: 2026-08-05
**Purpose**: Validate proposed M0.5 fixes against existing recorder lifecycle before coding design

---

## G2: tabIndex Not Captured — Deep Trace

### Current Capture Path
1. `event-tap.ts:188` calls `extractDomContext(targetEl)`
2. `dom-context-extractor.ts:25-37` returns DomContext — **no tabIndex field**
3. `component-types.ts:49-68` DomContext interface — **no tabIndex field**
4. `click.ts:31` hardcodes `const tabIndex = null`
5. `patterns.ts:82` `if (tabIndex !== null && tabIndex >= 0)` — **dead code, never fires**

### Proposed Fix Trace
1. Add `tabIndex: number | null` to DomContext interface
2. Extract in `dom-context-extractor.ts`: `tabIndex: el instanceof HTMLElement ? el.tabIndex : null`
3. In `click.ts`: change `const tabIndex = null` → `const tabIndex = event.domContext.tabIndex ?? null`
4. In `hover.ts:134`: same change
5. `patterns.ts:82` now receives real values — dead code becomes live

### False Positive Proof

The fix is **safe against false interactions**:

1. **No click event = no interaction.** tabIndex wiring only affects Click's `detectTrigger`, which only runs when a `click` or `contextmenu` event has already fired. The user's physical click is the gating signal. If they didn't click, nothing happens.

2. **Specialized definitions checked first.** Click is priority 180 (last). A `tabindex=0` div that is actually a checkbox/slider/dropdown is claimed by its specialized definition (priorities 10-65) before Click is reached.

3. **tabIndex=-1 excluded.** `tabIndex >= 0` check means `-1` (explicitly non-focusable) is excluded.

4. **Hover has independent gating.** Hover triggers on `mouseenter`, not click. It has its own confidence threshold (dwell ≥ 500ms + evidence signals). tabIndex wiring in Hover's detectTrigger just allows the candidate to START — the confidence system decides whether to emit.

5. **resolveTarget already found these elements.** INTERACTIVE_SELECTOR includes `[tabindex]`. These elements are already being resolved as click targets — we're just not DROPPING them in the Click definition anymore.

**Net effect**: Elements the browser considers keyboard-focusable (`tabindex >= 0`) that the user CLICKED will now produce Click interactions instead of being silently dropped. Zero risk of false positives.

---

## G7: Slider — End-to-End Lifecycle Trace

### Current Slider Definition (slider.ts)
- **triggerEventTypes**: `['click', 'focus']`
- **isInScope**: `return false` (immediate completion, NO lifecycle)
- **buildResult**: `value = triggerEvent.valueAfter ?? triggerEvent.valueBefore`

### Scenario Analysis: 6 Patterns

| Scenario | Events | Current Result | Correct? |
|----------|--------|----------------|----------|
| 1. Mouse drag | focus(50)→input(55)→input(60)→change(60)→blur(60) | value=50 (focus-time stale value) | ❌ STALE |
| 2. Click-to-set | mousedown→focus(75)→input(75)→change(75)→blur(75) | value=75 (value already set before focus fires) | ✓ lucky |
| 3. Keyboard arrows | focus(50)→input(51)→input(52)→blur(52) | value=50 (focus-time stale value) | ❌ STALE |
| 4. Focus-only traversal | focus(50)→blur(50) | value=50 (false interaction — user didn't adjust) | ❌ FALSE |
| 5. Drag + keyboard | focus(55)→input(60)→blur(60)→focus(60)→input(65)→blur(65) | value=55 AND value=60 (both stale) | ❌ BOTH STALE |
| 6. Programmatic | (none) | no interaction | ✓ |

**4 of 6 scenarios produce wrong results.** Scenarios 1, 3, 5 are stale values. Scenario 4 is a false interaction.

### Proposed Lifecycle (TextEntry Pattern)

```
triggerEventTypes: ['focus']     ← focus only (remove click)
isInScope: same element AND event in {input, change, blur}
handleEvent:
  input/change → ctx.data.valueChanged = true; ctx.data.finalValue = event.valueAfter
  blur → complete
buildResult: value = finalValue ?? valueBefore; userAdjusted = valueChanged === true
```

### Proposed Lifecycle: Scenario Results

| Scenario | Proposed Result | Correct? |
|----------|----------------|----------|
| 1. Mouse drag | focus(50)→input(55,60)→blur(60) → value=60 | ✓ |
| 2. Click-to-set | mousedown→focus(75)→input(75)→blur(75) → value=75 | ✓ |
| 3. Keyboard arrows | focus(50)→input(51,52)→blur(52) → value=52 | ✓ |
| 4. Focus-only | focus(50)→blur(50) → valueChanged=false → filtered | ✓ |
| 5. Drag + keyboard | Two separate lifecycles: value=60, value=65 | ✓ |
| 6. Programmatic | (none) | ✓ |

**All 6 scenarios produce correct results.**

### Critical Design Decision: valueChanged Flag

Without `valueChanged`, scenario 4 (focus-only traversal) emits a false Slider interaction — exactly the same problem TextEntry had before the `userTyped` flag was added (Bug 4 fix).

The fix follows the identical pattern:
1. `buildResult` sets `userAdjusted: boolean` in metadata
2. `isProductionInteraction` filters Slider interactions where `userAdjusted !== true`

This is proven architecture — TextEntry uses exactly this pattern (`output-adapter.ts:41`).

### shouldCancelOnOutside Design

During the Slider lifecycle, a `click` event fires (from mouseup). This click is NOT in `{input, change, blur}`, so `isInScope` returns false. The runtime then checks `shouldCancelOnOutside`.

Proposed: same as TextEntry (`text-entry.ts:72-83`):
- Click on same element → don't cancel (Slider keeps its lifecycle)
- Click elsewhere → cancel (user moved on)

### Edge Cases Verified

1. **Blur never fires** (page unload): MAX_LIFECYCLE_DURATION_MS (15s) cleanup → completed with last known value
2. **Multiple rapid focus/blur cycles**: Each focus → blur is a separate lifecycle, each gets its own interaction (correct — two adjustments = two test steps)
3. **Dedup window**: Per-type dedup (component-runtime.ts:493) means two Slider interactions on the same element within 2000ms are suppressed. BUT: the dedup check compares `startTime - endTime` gap. If the first lifecycle completed via blur before the second focus, the gap is real → both emitted. If overlapping (unlikely with focus/blur), dedup suppresses.

---

## G1: Drag-and-Drop Deferral Clarification

G1 (drag-and-drop) is **safe to defer for Capability Model architecture design** — the Capability Model can be designed and built without DnD support, because:
- DnD is a new interaction TYPE, not a misclassification
- The Capability Model's architecture (synthesizing physical + semantic + contextual evidence) is the same regardless of whether DnD exists
- DnD can be added as a new definition (priority ~35, between FileUpload and RadioButton) without touching any existing code

However, **silently missing drag-and-drop is NOT acceptable for eventual recorder completeness**. Trello, Jira, Asana, Notion, GitHub Projects, Shopify admin — all rely heavily on DnD. This should be the FIRST feature built AFTER the Capability Model architecture is established, as a focused DnD milestone (new event listeners + new definition + gesture tracking).

---

## Change Footprint Summary

| Fix | Files Modified | Lines Changed | New Types | New Event Listeners |
|-----|---------------|---------------|-----------|-------------------|
| G2 (tabIndex) | dom-context-extractor.ts, component-types.ts, click.ts, hover.ts | ~8 | tabIndex field in DomContext | 0 |
| G7 (Slider lifecycle) | slider.ts, output-adapter.ts | ~60 | userAdjusted in metadata | 0 |
| Tests | 2 test files | ~300 | 0 | 0 |
| **Total** | **6 files** | **~370** | **2 fields** | **0** |
