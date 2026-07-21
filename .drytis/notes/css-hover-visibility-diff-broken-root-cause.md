# CSS :hover Visibility-Count-Diff Was Fundamentally Broken

## Root Cause
The previous hover detection (v10.3.0–v10.3.3) used a "visibility count diff" approach:
1. On `mouseover`, snapshot `countVisibleNear(target)` as `beforeCount`
2. Wait 300ms
3. Check `countVisibleNear(target)` as `afterCount`
4. If `afterCount > beforeCount`, a CSS hover reveal was detected

**The problem**: `mouseover` fires AFTER the browser has already applied `:hover` CSS.
When `countVisibleNear()` runs, the mega-menu is ALREADY visible. So `beforeCount`
already includes the revealed content. After 300ms, `afterCount === beforeCount` —
no diff is detected. The hover is never captured.

This is why hover detection failed on adanione.com, every time, across 4 versions.

## Fix (v10.4.1)
Replaced the visibility-count-diff with **CSS stylesheet `:hover` rule analysis**:

1. `hasCssHoverReveal(el)` scans `document.styleSheets` → `sheet.cssRules`
2. Finds rules whose selector contains `:hover`
3. Checks if the rule changes a "reveal property": display, visibility, opacity,
   transform, height, max-height, width, max-width, pointer-events, top, left,
   right, bottom, clip, clip-path, overflow
4. Extracts the `:hover`-bearing selector part, strips `:hover` and pseudo-elements
5. Checks if it matches the element or any ancestor (up to 5 levels)

This directly detects CSS-driven mega-menus without any timing dependency.
The MutationObserver still catches JS-driven hovers (React tooltips, etc.).

## Properties that indicate a reveal (HOVER_REVEAL_PROPS)
display, visibility, opacity, transform, height, max-height, width, max-width,
pointer-events, top, left, right, bottom, clip, clip-path, overflow

## Properties that do NOT indicate a reveal (ignored)
color, background-color, border-color, font-size, font-weight, cursor,
box-shadow, text-decoration, z-index
