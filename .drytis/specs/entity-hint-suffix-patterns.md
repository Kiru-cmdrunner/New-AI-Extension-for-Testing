# Entity-hint suffix patterns (ASIN.1 / quantity.1) — implementation spec

Baseline: `0dfa90e` (fix: stabilize M9 runtime evidence and status enrichment).
Scope guard: single file change in `src/understanding/signal-extractors/network-signals.ts`
plus one new test file. NO changes to `state-builder.ts`, capture, bridge,
attribution, ledger/status-enrichment, G4/G5, M1–M8, build scripts, or config.

## Problem

Amazon's indexed form-field convention posts cart-page / multi-item add-to-cart
bodies with keys like `ASIN.1`, `quantity.1` (`.2`, `.3`, … per line item).
`ENTITY_HINT_PATTERNS` uses anchored full-string regexes (`^asin$`, `^quantity$`,
`^qty$`), so these keys produce ZERO entity hints. Consequence: the add-to-cart
entity falls back to `cart-item:<interactionId>` with no `productId`/`quantity`
attributes. Outcome success / status / API evidence are NOT affected (independent
of hints) — this is entity-identity richness only.

Single product-page add-to-cart (`ASIN` + `quantity`, the verified int-14 shape,
entity `cart-item:B0FFF9VPMN`) already works and MUST keep working unchanged.

## Change

Widen exactly three patterns in `ENTITY_HINT_PATTERNS`
(`network-signals.ts:151–162`) to allow an optional `.N` index suffix:

```
^asin$            → ^asin(?:\.\d+)?$
^quantity$        → ^quantity(?:\.\d+)?$
^qty$             → ^qty(?:\.\d+)?$
```

Unchanged: `product[_-]?id`, `item[_-]?id`, `sku`, `leave-type`,
`employee-id`, `issue-id`, `user-id` (their suffix forms are out of scope).
Both extractors (`extractEntityHints` flat keys, `extractGraphqlVariableHints`
variables JSON) share the table and inherit the fix automatically.

## Acceptance criteria

- [ ] AC1: `{ 'ASIN.1': <ASIN>, 'quantity.1': '2' }` body → `product-id` hint
      with the ASIN value AND `quantity` hint with `'2'` (field recorded as the
      original key).
- [ ] AC2: Case-insensitive and case-variant keys work (`asin.1`, `QUANTITY.1`).
- [ ] AC3: Two-digit indices (`ASIN.10`) match.
- [ ] AC4: Regression — plain `{ ASIN, quantity }` still yields the same hints
      as the int-14 baseline (existing tests must stay green, no edits).
- [ ] AC5: Multi-item body `{ ASIN.1, ASIN.2, quantity.1, quantity.2 }` yields
      two `product-id` hints and two `quantity` hints; state-builder
      first-match-wins consumer creates `cart-item:<ASIN.1>` with
      `quantity: <quantity.1>` (documents current semantics; fan-out for item 2
      is explicitly out of scope).
- [ ] AC6: state-builder end-to-end (existing consumer, untouched): an
      add-to-cart op signal with `ASIN.1` hints produces entity id
      `cart-item:<ASIN>` with `attributes.productId` and `attributes.quantity`.
- [ ] AC7: Non-matching keys stay non-matching (`asin[0]`, `items[0].asin`,
      `asin_1`, `asin1`, `quantities`).
- [ ] AC8: `npx tsc --noEmit` → 0 errors; full vitest suite green.
- [ ] AC9: Clean build (`rm -rf dist && npm run build`) — ZIP packs, SW inline
      bundle invariants hold (0 dynamic `import(`, 0 preload helper), new
      pattern string present in the SW bundle.

## Out of scope

`ASIN_N`/`asin1` underscore/concatenated variants, array/nested shapes,
multi-item entity fan-out (consumer `find()` semantics unchanged),
`product-id`/`item-id`/`sku` suffix forms, forwarding `requestBody` to the
bridge, any G4/G5/capture/attribution/ledger/M-code changes.
