# Spec: Evidence-Based Hover Redesign

## Problem

The current Hover definition treats every `mouseenter` on an interactive element as an immediate interaction. This produces massive noise — transit hovers through menus, exploratory cursor movement, and accidental mouse-overs all get captured. The screenshot shows 6 abandoned hovers (`int-6` through `int-11`) cluttering a login + navigation recording.

Worse, active Hover components interfere with other interactions: before the click-exclusion fix, Hovers were swallowing click events. Even now, the hover candidate stays on the active stack and can interfere with discovery ordering.

## Design

Redesign Hover as a **candidate interaction** — it starts on `mouseenter` but is NOT emitted until evidence proves it was meaningful. If no evidence arrives before `mouseleave`, the candidate is silently discarded.

### Evidence Signals

A hover is **meaningful** if any of:
1. **UI expansion** — `aria-expanded` toggled to `true` on the element or an ancestor during the hover
2. **Overlay appeared** — a new DOM node with `role=menu`, `role=tooltip`, `role=listbox`, `role=dialog`, or class patterns suggesting a popover appeared during the hover
3. **Sustained dwell** — pointer stayed on the element for ≥ 2 seconds (intent to interact, not transit)
4. **Click on the element** — user hovered then clicked (the Click takes precedence, but the hover is no longer noise)

### Discard Signals

A hover is **discarded** if:
1. `mouseleave` fires before any evidence signal — transit hover, not meaningful
2. A click occurs on the element — Click takes precedence; the hover is suppressed in favor of the Click interaction

### Lifecycle

```
mouseenter
    ↓
Candidate Hover (active, NOT emitted)
    ↓
Monitor: mouseleave? → discard (silently, endState='discarded')
Monitor: evidence?   → promote to completed
Monitor: click?      → discard (Click takes precedence)
    ↓
mouseleave + had evidence → emit as completed Hover
mouseleave + no evidence  → discard silently
click on same element     → discard silently (Click wins)
```

### `isInScope` — Minimal Event Ownership

Hover only claims events relevant to its lifecycle:
- `mouseenter` — already the trigger; subsequent ones on same element extend
- `mouseleave` — completion/discard check
- `mousemove` — dwell tracking (accumulate pointer stationary time)

It does NOT claim: `click`, `mousedown`, `mouseup`, `focus`, `blur`, `input`, `change`, `keydown`, `scroll`, `navigation`.

### `shouldCancelOnOutside`

- `click` on a different element → discard the hover candidate (user moved on)
- `navigation` → let the runtime flush handle it

### Evidence Detection Strategy

Since we cannot install MutationObserver per-hover (costly, MV3 lifecycle), we use what's already captured in the `ObservedEvent`:

1. **`aria-expanded` transition**: The event tap already captures `ariaExpanded` in `DomContext`. If `mouseenter` had `ariaExpanded=false/null` and a subsequent `mouseenter`/`mousemove` shows `ariaExpanded=true`, that's evidence.
2. **`aria-haspopup` presence**: If the element has `aria-haspopup` (menu, listbox, dialog, tooltip), a dwell ≥ threshold confirms the popup was shown.
3. **Sustained dwell**: If no `mouseleave` for `HOVER_PROMOTION_DWELL_MS` (default 2000ms), treat as meaningful.
4. **Transient dwell threshold**: `HOVER_TRANSIT_THRESHOLD_MS` (default 500ms) — hovers shorter than this are always discarded.

### Production Filter

In `output-adapter.ts`, `isProductionInteraction` for Hover:
- `endState` must be `completed`
- `metadata.meaningful` must be `true`
- Abandoned/discarded hovers are filtered out

### Side Panel Display

The side panel should show only production interactions by default (same filter). The `renderProductionInteractions` function already exists — switch the live recording view to use it.

## Files to Change

1. **`src/definitions/hover.ts`** — full rewrite: candidate lifecycle, evidence accumulation, dwell tracking
2. **`src/presentation/output-adapter.ts`** — Hover must pass `metadata.meaningful === true`
3. **`src/sidepanel/interaction-renderer.ts`** — `renderProductionInteractions` updated for Hover filter
4. **`src/sidepanel/sidepanel.ts`** — live recording uses `renderProductionInteractions` instead of `renderInteractions`
5. **`src/shared/component-types.ts`** — add `'discarded'` to ComponentEndState

## Acceptance Criteria

- [ ] AC1: Transit hovers (mouseenter → mouseleave < 500ms) are silently discarded, never emitted
- [ ] AC2: Hovers with `aria-haspopup` + dwell ≥ 500ms are promoted to meaningful
- [ ] AC3: Hovers lasting ≥ 2000ms without mouseleave are promoted to meaningful
- [ ] AC4: `aria-expanded` transition from false→true during hover promotes to meaningful
- [ ] AC5: Click on same element as active hover → hover is discarded, Click takes precedence
- [ ] AC6: Hover `isInScope` never returns true for click/mousedown/focus/blur/input/change/keydown
- [ ] AC7: Production filter drops all Hover interactions where `meaningful !== true`
- [ ] AC8: Side panel live recording shows only production interactions (no noise)
- [ ] AC9: All 3275 existing tests pass (with updated hover expectations)
- [ ] AC10: New tests cover each evidence signal and discard scenario
