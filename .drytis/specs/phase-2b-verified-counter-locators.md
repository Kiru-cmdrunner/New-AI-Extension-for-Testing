# Phase 2b — uniqueness-verified id-less counter locators

Parent audit: `.drytis/notes/phase-2b-audit-2026-08-20.md` (approved 2026-08-20).
Baseline: `b2fa5b1` (2a capture + 2c entity-first + Option D drain all shipped).

## Goal

Id-less counters (no `#id` anywhere in domPath) currently derive ZERO assertions —
`decideLocator()`'s non-entity branch only accepts a domPath `#id`, and the
identity-attribute helper hard-returns null for `kind !== 'entity'`. Allow a
**capture-time uniqueness-VERIFIED, allowlisted attribute locator** for counters —
without loosening anything that is not proven unique.

## Design (from the approved audit)

1. **Observer stamps uniqueness** (`src/understanding/page-content/page-content-observer.ts`):
   for every captured item, if it has an allowlisted attribute, build the candidate
   selector `[attr="value"]` and stamp `uniqueInSnapshot: true` iff
   `document.querySelectorAll(sel).length === 1`. The snapshot is taken at
   consequence settlement (quiescence + causal network idle) — the same settled DOM
   the derivation reasons about, so the stamp is meaningful.
2. **Wire flag** (`src/shared/page-content-wire.ts`): `uniqueInSnapshot?: boolean`
   on `WireObservedItem` (optional — old snapshots without it behave as today).
3. **Derivation** (`src/generation/assertion-derivation.ts`):
   - `COUNTER_ATTR_ALLOWLIST = ['aria-label', 'data-count', 'data-auto-id',
     'data-test-id', 'data-test', 'data-testid']`.
   - `counterAttributeSelector(item)`: null unless kind==='counter' AND an
     allowlisted attr present AND `item.uniqueInSnapshot === true`; returns
     `[attr="escaped-value"]`.
   - `decideLocator()` non-entity branch: `#id` tier FIRST (unchanged — the two
     a-slice pinned behaviors keep priority), THEN the verified counter attr
     selector, then skip.
   - Ancestor-`#id` priority is UNCHANGED in this slice (wrong-element risk for
     counters-with-ancestor-id stays documented, not fixed — see audit §5.4).

## Acceptance criteria

- [ ] Id-less counter with verified allowlisted attr (`aria-label`, `data-count`,
      `data-auto-id`, `data-test-id`, `data-test`, `data-testid`) → textMatch
      assertion on `[attr="value"]`, severity soft, derivedFrom 'counter'.
- [ ] Id-less counter with attr present but `uniqueInSnapshot` false/absent → NO
      assertion (protection unchanged — the 2b-held pin flips to a positive test
      only under the flag).
- [ ] Counter WITH domPath `#id` (own or ancestor) → still `#id` locator (priority
      unchanged; a-slice behavior pinned).
- [ ] No counter locator EVER uses a non-allowlisted attribute (data-sku, class
      fragments, matchedSelector, text, role, nth-child) — reject-list pin.
- [ ] Non-counter kinds with attrs but no identity (e.g. status-badge without #id)
      → still skipped (2b is counter-scoped).
- [ ] Observer stamps `uniqueInSnapshot` correctly: unique attr value → true;
      duplicated attr value → false (jsdom unit test with the real observer).
- [ ] Attr values with quotes/backslashes are escaped (`attrValueForSelector` path).
- [ ] Unverified legacy snapshots (no flag) → behavior identical to b2fa5b1.
- [ ] `npx tsc --noEmit` stays at the 6-error baseline; full vitest green; build OK.
- [ ] a-slice regression: 35/35 (counters there have `#id` — untouched path).
- [ ] Clone gate: cart-count/cart-total now assert on their attribute locators
      (2b-held NOT-asserted checks flip positive); all other checks stay PASS.

## Out of scope

- Ancestor-`#id` preference fix for counters WITH an ancestor id (documented follow-up).
- Evaluation-time uniqueness check (Option V defense-in-depth) — separate.
- Non-counter kinds (status-badge/notification/collection attr locators).
- ZIP / commit / push (explicitly held until user approves).
