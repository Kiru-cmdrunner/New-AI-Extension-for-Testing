# CSS Hover — Paren-Aware Selector Splitter

## Task
Fix the naive comma-split bug in `ruleMatchesHover()` that breaks on modern CSS
pseudo-class functions (`:is()`, `:where()`, `:not()`, `:has()`) whose argument
lists contain commas. This causes `hasCssHoverReveal()` to return `false` for
real-world CSS mega-menus (e.g. GitHub's Enterprise flyout) that use these
functions, silently dropping meaningful hover interactions.

## Root Cause (confirmed in investigation)
`deterministic-recorder.ts:1668` does:
```js
const selectorParts = selector.split(',').map((s) => s.trim());
```

For GitHub's real selector:
```
:is(.NavDropdown-module__container__l2YeI:hover,.NavDropdown-module__container__l2YeI.open) .NavDropdown-module__dropdown__xm1jd
```

The split breaks INSIDE `:is(...)`, producing two invalid fragments:
- `:is(.NavDropdown-module__container__l2YeI:hover` — unbalanced paren → `matches()` throws
- `.NavDropdown-module__container__l2YeI.open) .NavDropdown-module__dropdown__xm1jd` — no `:hover`

Both fragments fail → `hasCssHoverReveal()` returns `false`.

## Fix
Two naive splits in `ruleMatchesHover()` must be replaced with parenthesis-aware
versions. The investigation found BOTH are broken:

1. **Comma split** (line 1668): `selector.split(',')` — breaks inside `:is(.a, .b)`
2. **Combinator split** (line 1674): `selPart.split(/\s*[>+~]\s*|\s+/)` — breaks
   inside `:is(.a, .b)` (whitespace after comma), inside `:has(> .x)` (`>` combinator),
   and inside attribute selectors `[attr~="a,b"]` (`~` combinator vs `~=` operator)

Both splits must:
- Track paren depth (`(` / `)`) AND bracket depth (`[` / `]`)
- Only split when `depth === 0`
- Be pure functions with no DOM dependency (testable in isolation)
- Preserve existing behavior for flat selectors (backward compat)

## Files to Change
1. `src/recorder/deterministic-recorder.ts`
   - Add `splitSelectorOnTopLevelCommas(selector: string): string[]`
   - Add `splitSelectorOnCombinators(selector: string): string[]` (paren/bracket-aware tokenization on `>`, `+`, `~`, whitespace)
   - Replace the `selector.split(',')` call in `ruleMatchesHover()` (line 1668)
   - Replace the `selPart.split(/\s*[>+~]\s*|\s+/)` call in `ruleMatchesHover()` (line 1674)
2. `tests/css-hover-detection.test.ts`
   - Mirror both helpers in the test file's inlined `ruleMatchesHover`
   - Add regression tests covering comma-split + combinator-split for `:is()`, `:where()`, `:not()`, `:has()`, attribute selectors, and nested forms

## Acceptance Criteria
- [ ] `splitSelectorOnTopLevelCommas` is a standalone pure function
- [ ] It correctly splits flat comma lists (backward compat): `.a:hover, .b:hover` → `[".a:hover", ".b:hover"]`
- [ ] It does NOT split inside `:is(...)`: `:is(.a:hover, .b:hover) .c` → 1 part
- [ ] It does NOT split inside `:where(...)`, `:not(...)`, `:has(...)`
- [ ] It does NOT split inside attribute selectors: `a[href="x,y"]` → 1 part
- [ ] It handles nested parens: `:is(:not(.a), .b:hover) .c` → 1 part
- [ ] It handles multiple top-level commas + nested function commas together
- [ ] `ruleMatchesHover` now returns `true` for GitHub's Enterprise selector against a matching ancestor
- [ ] All existing 44 tests still pass (no regression)
- [ ] New regression tests pass for `:is()`, `:where()`, `:not()`, `:has()` hover reveal patterns
- [ ] `npm test` is fully green

## Out of Scope
- Changes to `hasNearbyRevealContent` fallback (separate concern)
- Changes to MutationObserver (pure-CSS reveals produce no mutations by design)
- Cross-origin CSS access (GitHub serves CSS with CORS headers, so no SecurityError)
- Selector specificity / cascade resolution (out of scope — we match on selector text, not computed priority)

## Test Cases (Regression)
1. `:is(.nav-item:hover, .nav-item.open) .mega-menu { display: block }` → detects
2. `:where(.nav-item:hover) .dropdown { visibility: visible }` → detects
3. `:not(.disabled):hover .panel { opacity: 1 }` → detects
4. `:has(.trigger):hover .content { display: block }` → detects
5. Nested: `:is(:not(.x), .y:hover) .z { display: block }` → detects
6. Attribute selector with comma: `[data-tags~="a,b"]:hover .content { display: block }` → detects
7. Multiple top-level commas with nested `:is()`: `:is(.a:hover, .b:hover) .c, .d:hover .e { display: block }` → detects
8. Negative: `:is(.a:hover, .b:hover) .c { color: red }` → does NOT detect (no reveal property)
