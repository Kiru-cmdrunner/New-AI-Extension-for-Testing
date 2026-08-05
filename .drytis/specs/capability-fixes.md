# Capability Model Phase 7 Fixes — Design Spec

## Status: ALL FIXES IMPLEMENTED AND VALIDATED ✅

## Problems

| ID | Problem | Impact | Status |
|----|---------|--------|--------|
| F1 | Amazon brand filter changes URL → Navigate claims, FilterSelection returns null (urlChangedAfter gate) | Lose filter semantics on server-rendered apps | ✅ Fixed |
| F2 | Amazon sort dropdown changes URL → Navigate claims, SortSelection blocked | Same root cause as F1 | ✅ Fixed |
| F3 | Navigate over-claims: any interaction followed by a different URL → Navigate | Add to Cart, product detail, anything before navigation | ✅ Fixed |
| F4 | Product detail link → Unclassified (urlChangedAfter timing: next interaction may be on same page if user navigates back) | OpenDetail misses | ✅ Fixed |
| F5 | SubmitForm requires precededByTextEntry — forms filled only with dropdowns don't trigger | Avis Ford search | ✅ Fixed |

## Fix Design

### Fix 1+2: URL-change discrimination (query-param-only vs path change)

**Root cause**: `urlChangedAfter` is a boolean — it fires for ANY URL difference, including query-param-only changes (e.g. `?k=laptops` → `?k=laptops&brand=sony`). Filters and sorts on server-rendered apps change query params without changing the page path.

**Solution**: Add `urlPathChangedAfter` to SequenceContext. Computed by comparing URL **paths** (not full URLs). FilterSelection and SortSelection use `urlPathChangedAfter` in their gates instead of `urlChangedAfter`. Navigate/OpenDetail continue to use `urlChangedAfter` for detecting actual navigation.

**Evidence extractor change**: Add a helper `compareUrls(currentUrl, nextUrl)` → `{ pathChanged: boolean, queryChanged: boolean }`.

### Fix 3: Navigate required evidence tightened

**Root cause**: Navigate claims on ANY urlChangedAfter, even when the URL change is an incidental consequence (Add to Cart redirects to cart page).

**Solution**: Navigate must have at least 1 supporting signal (keyword, Link type, or urlChanged from previous). Remove the "MEDIUM by default" fallback — if only urlChangedAfter fires with zero supporting, it's LOW.

### Fix 4: OpenDetail should fire on its own URL characteristics

**Root cause**: urlChangedAfter looks at the NEXT interaction's URL. If the next interaction is on the same page (user navigated forward then back), it misses.

**Solution**: Use the interaction's own `href` attribute. If the trigger is a Link with an href containing an item-specific pattern, OpenDetail can claim even without urlChangedAfter. The href IS the navigation target.

### Fix 5: SubmitForm precededByTextEntry → precededByFormInteraction

**Root cause**: SubmitForm requires `precededByTextEntryOnSameForm`, but many forms use only dropdowns/checkboxes (Avis Ford: Make/Model/Condition → Search).

**Solution**: Add `precededByFormInteraction` to SequenceContext. True if any preceding interaction on the same page was TextEntry, Dropdown, Checkbox, or Slider. SubmitForm uses this instead of `precededByTextEntryOnSameForm`.
