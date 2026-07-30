# P0-10: Slider Drag — Constrained-Axis Drag Tracking

## Problem

The Slider definition (priority 25) triggers on click/focus and completes
immediately — it captures the value at click time but doesn't track the drag.
A user dragging a slider handle from 25% to 75% is recorded as a single
click at the final position. For native `<input type="range">`, Playwright's
`fill()` works. But for ARIA sliders (`role="slider"`, used by MUI, AntD,
RC Slider, jQuery UI), the only way to set the value is to drag the handle,
and the recorder doesn't capture enough metadata (start/end value, min/max)
to replay the drag.

## Design Decisions

### Not a new definition — enhance existing Slider

Enhance `src/definitions/slider.ts` (priority 25). Add mousedown triggering
and mousemove tracking. No new file, no new InteractionType.

### Trigger expansion

Add `'mousedown'` to `triggerEventTypes`. Keep `'click'` and `'focus'` for
backward compatibility (native range inputs and click-only interactions).

- `mousedown` on `role="slider"` → starts drag tracking
- `mousedown` on `<input type="range">` → starts drag tracking
- `click` on `<input type="range">` → value-set via click on track (existing)
- `focus` on slider → keyboard interaction (existing)

### Dual lifecycle

```
mousedown path (drag):
  Trigger: mousedown on slider element
  Active:  mousemove events (track dragging, update current value)
  Complete: mouseup (capture end value) → consumedClick suppression
            OR no mousemove before mouseup → completed (click-value)

click path (existing, unchanged):
  Trigger: click on slider element
  Complete: immediate (value from valueAfter)

focus path (existing, unchanged):
  Trigger: focus on slider element
  Complete: immediate (value from valueAfter)
```

### Value extraction priority

1. ARIA: `domContext.ariaValueNow` (primary — instant, no geometry)
2. Native: `event.valueAfter` (for `<input type="range">`)
3. Fallback: `event.valueBefore` (pre-interaction value)

Min/max extraction:
1. ARIA: `domContext.ariaValueMin` / `domContext.ariaValueMax`
2. Native: `domContext.nativeMin` / `domContext.nativeMax`

### DragDrop interaction

DragDrop (priority 15) already excludes `role="slider"` via `EXCLUDED_ROLES`
and `<input>` via `EXCLUDED_TAGS`. No conflict — DragDrop will never trigger
on slider elements.

### interactionSubtype

Set in buildResult:
- `'NativeSlider'` for `<input type="range">`
- `'AriaSlider'` for `role="slider"`

## Files to Change

1. `src/definitions/slider.ts` — enhanced definition (trigger + lifecycle + buildResult)
2. `tests/runtime/slider-drag.test.ts` — new unit tests

## Acceptance Criteria

- [ ] ARIA slider mousedown → mousemove → mouseup produces Slider with startValue and endValue
- [ ] ARIA slider click (no drag) produces Slider with value from aria-valuenow
- [ ] Native `<input type="range">` change event produces Slider with value
- [ ] Native `<input type="range">` drag produces Slider with startValue and endValue
- [ ] Metadata includes sliderValue (final), startValue, endValue, min, max
- [ ] interactionSubtype set to 'NativeSlider' or 'AriaSlider'
- [ ] Existing click/focus triggers still work (no regression)
- [ ] DragDrop does not interfere (role="slider" is in EXCLUDED_ROLES)
- [ ] shouldCompleteOnOutside completes on non-slider interactions
- [ ] shouldCompleteOnFlush returns true (drag data preserved on navigation)
- [ ] Unit tests cover all scenarios
- [ ] Full suite passes with zero regressions
