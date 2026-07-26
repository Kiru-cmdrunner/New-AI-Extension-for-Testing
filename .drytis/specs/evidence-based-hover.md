# Spec: Evidence-Based Hover — Confidence Model

## Problem

The first Hover redesign used fixed thresholds with pass/fail rules. Two issues:

1. **Dwell as primary evidence** — A fixed 2s dwell promotes any hover to meaningful, even if the user was just thinking while paused over a disabled button. Dwell should be **fallback evidence**, not primary.

2. **Pass/fail doesn't scale** — As we encounter more web app patterns (mega menus, tooltips that appear in 300ms, accordions, etc.), special-case rules accumulate. A confidence model is more extensible.

## Confidence Model

Each evidence signal contributes a weighted confidence score. The hover is promoted to meaningful when accumulated confidence meets or exceeds the threshold.

### Evidence Signals & Confidence Weights

| Signal | Confidence | Rationale |
|---|---|---|
| `aria-expanded` changed false→true during hover | **100** (Very High) | Direct proof the UI expanded |
| Overlay role (`menuitem`, `tooltip`, `tab`) + dwell ≥ 500ms | **70** (High) | Element is part of an overlay system |
| `aria-haspopup` + dwell ≥ 500ms | **60** (High) | Element declares popup capability |
| Sustained dwell ≥ 3s + pointer stationary (< 10px movement) | **50** (Medium) | Intent inferred from stillness, not UI change |
| Transit (dwell < 500ms, no evidence) | **0** (None) | Pointer passing through |

### Thresholds

- `CONFIDENCE_THRESHOLD = 50` — minimum accumulated confidence to promote
- `HOVER_TRANSIT_THRESHOLD_MS = 500` — hovers shorter than this are always discarded
- `SUSTAINED_DWELL_MS = 3000` — dwell duration for fallback confidence
- `POINTER_STATIONARY_RADIUS_PX = 10` — max pointer movement for "stationary"
- `HOVER_PROMOTION_DWELL_MS` — removed (dwell alone no longer auto-promotes at any fixed time)

### Pointer Stationarity Tracking

On each `mousemove`, track the maximum displacement from the first recorded position:
- If max displacement < `POINTER_STATIONARY_RADIUS_PX` AND dwell ≥ `SUSTAINED_DWELL_MS`, add fallback confidence
- If pointer moved significantly, reset the stationary start point (user is actively moving)

### Why this is better

1. **2s dwell on a disabled button** → confidence stays below threshold (dwell alone doesn't reach 50 without stationarity + 3s)
2. **300ms mega menu open** → `aria-expanded` transition gives 100 confidence instantly
3. **700ms tooltip hover** → `aria-haspopup=tooltip` + dwell ≥ 500ms gives 60 confidence
4. **Extensible** — new evidence signals just add their confidence to the accumulator

## Lifecycle

```
mouseenter → candidate (confidence = 0)
    ↓
mousemove → track pointer stationarity, check aria-expanded changes
    ↓
mouseleave:
  confidence ≥ 50 → emit as completed Hover
  confidence < 50 → discard silently
click on same element → discard (Click takes precedence)
click elsewhere → discard (user moved on)
```

## `isInScope` — unchanged from evidence-based design

Hover claims only: `mouseenter`, `mouseleave`, `mousemove`.
Does NOT claim: `click`, `mousedown`, `contextmenu`, `focus`, `blur`, `input`, `change`, `keydown`, `scroll`, `navigation`.

## Files to Change

1. **`src/definitions/hover.ts`** — rewrite with confidence scoring
2. **`src/shared/component-types.ts`** — `mousemove` added to BrowserEventType (done)

## Acceptance Criteria

- [ ] AC1: Transit hovers (< 500ms, no evidence) → discarded (confidence = 0)
- [ ] AC2: `aria-expanded` transition → instant promotion (confidence = 100)
- [ ] AC3: `aria-haspopup` + dwell ≥ 500ms → promotion (confidence = 60)
- [ ] AC4: Overlay role + dwell ≥ 500ms → promotion (confidence = 70)
- [ ] AC5: Sustained dwell ≥ 3s + pointer stationary → promotion (confidence = 50)
- [ ] AC6: Sustained dwell ≥ 3s + pointer moved significantly → NO promotion
- [ ] AC7: Dwell alone < 3s without other evidence → discarded (even at 2.5s)
- [ ] AC8: Click on same element → hover discarded, Click fires
- [ ] AC9: `isInScope` excludes all non-hover events
- [ ] AC10: Production filter requires `metadata.meaningful === true`
- [ ] AC11: All existing tests pass with updated expectations
- [ ] AC12: New tests cover confidence scenarios
