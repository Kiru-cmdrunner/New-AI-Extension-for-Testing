# Smart Hover Detection — DOM Mutation Based

## Date: 2026-07-18
## Status: Implemented and tested

## Problem History
1. v10.1.x: Naive hover — fired on EVERY mouseover after 500ms. Flooded timeline
   with noise (every element the mouse crossed). User reported 3+ mouseenter events
   per single click action.
2. v10.3.0: Hover removed entirely. User reported meaningful hovers (tooltips,
   dropdowns that open on hover) were no longer captured at all.
3. v10.3.1 (current): Smart hover — only captures mouseenter when a DOM mutation
   occurs during the hover period (tooltip appears, dropdown opens, content expands).

## How It Works
1. On `mouseover`: start a MutationObserver on document.body + 400ms timer
2. MutationObserver watches for: childList additions (new elements), attribute
   changes on style/class/hidden (visibility toggles)
3. After 400ms: if mutations were seen AND mouse is still on the same element,
   send mouseenter event. Otherwise cancel (incidental movement).
4. On `mouseout`: cancel tracking immediately if leaving the hovered element

## isVisible() helper
Checks offsetWidth/offsetHeight > 0, display !== 'none', visibility !== 'hidden',
opacity !== '0', and !hidden attribute. Filters out mutations that don't produce
visible changes.

## What This Captures
- Tooltips that appear on hover ✅
- Dropdown menus that open on hover ✅
- Info popovers that expand on hover ✅
- Any element where hovering causes a visible DOM change ✅

## What This Does NOT Capture
- Moving mouse across plain divs (no DOM change) ✅ (desired)
- Passing over elements on the way to a click target ✅ (desired)
- CSS-only :hover effects (background color change, no DOM mutation) — acceptable gap
