# CSS Hover — `:is()` / `:where()` / `:not()` / `:has()` Selector Split Bug

## Date: 2026-07-20
## Status: Fixed (v10.4.18)

## Problem
`hasCssHoverReveal()` silently returned `false` for CSS mega-menus/dropdowns
whose reveal rule used a modern CSS pseudo-class function in its selector.
**Reproduced on**: GitHub's "Enterprise" nav flyout (and any site using
Primer CSS or similar modern frameworks).

## Root Cause
`ruleMatchesHover()` in `deterministic-recorder.ts` had TWO naive splits:

1. **Comma split** (line 1668): `selector.split(',')`
2. **Combinator split** (line 1674): `selPart.split(/\s*[>+~]\s*|\s+/)`

Both broke on modern CSS pseudo-class functions. GitHub's real rule:
```css
:is(.NavDropdown-module__container__l2YeI:hover,
    .NavDropdown-module__container__l2YeI.open)
  .NavDropdown-module__dropdown__xm1jd {
    opacity: 1; visibility: visible; transform: scale(1) translateY(0);
}
```

The comma split produced:
- `:is(.NavDropdown-module__container__l2YeI:hover` → unbalanced paren → `matches()` throws → caught → skip
- `.NavDropdown-module__container__l2YeI.open) .NavDropdown-module__dropdown__xm1jd` → no `:hover` → skip

Both fragments failed → `hasCssHoverReveal()` returned `false`.

The combinator split ALSO broke on:
- `:is(.a, .b)` — whitespace after comma inside the function
- `:has(> .x)` — `>` as a relative-selector prefix
- `[attr~="a,b"]` — `~` in `~=` operator vs general-sibling combinator

## Key Finding
GitHub's CSS is from `github.githubassets.com` (cross-origin) BUT served with
`crossorigin="anonymous"` + `Access-Control-Allow-Origin: *`, so CSSOM is
readable — **no SecurityError**. The cross-origin blind spot documented in
`c3.3-gate5-remaining-approaches-analysis.md` did NOT apply here.

The flyout is a **pure CSS reveal** — no DOM mutations, `aria-expanded` stays
`false` during hover. So the MutationObserver fallback also produced nothing.

## Fix
Replaced both naive splits with parenthesis/bracket-aware pure functions:

1. `splitSelectorOnTopLevelCommas(selector)` — splits on commas only at paren-depth 0
2. `splitSelectorOnCombinators(selector)` — splits on `>`, `+`, `~`, whitespace only at paren-depth 0

Both track `(` `[` (depth++) and `)` `]` (depth--) and only split when `depth === 0`.

## Tests
- 11 unit tests for comma splitter (`splitSelectorOnTopLevelCommas`)
- 9 unit tests for combinator splitter (`splitSelectorOnCombinators`)
- 11 integration tests through `ruleMatchesHover` / `checkHoverReveal`
- 2 real-world tests using GitHub's EXACT CSS selector and DOM structure
- All 44 original tests still pass (backward compat)
- Full suite: 2496/2496 green

## Files
- `src/recorder/deterministic-recorder.ts` — new functions + replaced splits
- `tests/css-hover-detection.test.ts` — mirrored helpers + regression suite
- `.drytis/specs/css-hover-paren-aware-selector-split.md` — spec

## Note on jsdom limitation
jsdom's `Element.matches()` does not support `:not()` nested inside `:is()`
(e.g. `:is(:not(.x), .y)` throws "not a valid selector"). This is a jsdom
limitation, not a bug in the splitter — the splitter correctly produces the
single token. Real Chrome handles these natively. The deep-nesting case is
covered by `splitSelectorOnCombinators` unit tests (which don't call
`Element.matches()`), while the integration tests use forms jsdom can parse.
