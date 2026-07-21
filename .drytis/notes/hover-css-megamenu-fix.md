# Hover on CSS :hover Mega-Menu — Root Cause

## Date: 2026-07-18
## Status: Fixed in v10.3.2

## Problem
adanione.com "Services" mega-menu opens via pure CSS:
```css
.nav-item:hover .mega-menu { display: block; }
```
This produces ZERO DOM mutations. The MutationObserver-only approach (v10.3.1)
couldn't detect it.

## Fix: Hybrid Approach (MutationObserver + Visibility Count Diff)
1. **MutationObserver** — catches JS-driven changes (React tooltips appended to body)
2. **Visibility count diff** — catches CSS :hover changes:
   - Before hover: count visible elements in target's subtree
   - After 300ms hover: count again
   - If count increased → CSS revealed new content → capture hover

Both signals are checked. If EITHER fires, the hover is captured.

## Key Learning
CSS `:hover` rules are invisible to MutationObserver. Must use computed
style inspection (getComputedStyle / offsetWidth) to detect CSS-driven
visibility changes. The `countVisibleInSubtree()` function is scoped to
the target's descendants for performance.
