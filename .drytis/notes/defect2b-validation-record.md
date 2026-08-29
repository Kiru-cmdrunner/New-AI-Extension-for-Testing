# Phase 2b Validation Record — 2026-08-20

## Status: IMPLEMENTED + FULLY RE-VALIDATED, NOT COMMITTED (per instruction)

**Final re-validation 2026-08-20T09:05Z (fresh runs, post-approval):**
suite 217 files / 3977 tests green · tsc 6 pre-existing baseline errors
(5 × ir-executor-navigate.test.ts, 1 × ir-bridge-repeated-clicks.test.ts
— identical to the pre-2b baseline) · build exit 0 · Gate 1 clone
30 PASS / 0 FAIL · Gate 2 a-slice 35 PASS / 0 FAIL · scope audit: 7 files,
493 insertions / 22 deletions, zero hunks outside 2b surfaces, no timing
constants, no executor / Option-D / IR-schema / recorder files touched,
OR-1 pin green. Evidence: gate1-2b-final.log, gate2-aslice-2b.log,
dumps-final/.

Worktree: 7 modified files on top of HEAD `b2fa5b1` (branch
`capability-surgical-removal`). No commit / push / ZIP.

## Implementation (exact audit design)

1. `src/shared/page-content-wire.ts` — optional `uniqueInSnapshot?: boolean`
   on `WireObservedItem` + exported `VERIFIED_ATTR_ALLOWLIST`
   (aria-label, data-count, data-auto-id, data-test-id, data-test) +
   `isVerifiedAttrAllowed()`. Legacy snapshots lack the flag → unverified →
   legacy policy. Zero new dependencies across layers.
2. `src/understanding/page-content/page-content-types.ts` — twin optional
   field on `ObservedItem`.
3. `src/understanding/page-content/page-content-observer.ts` —
   `uniqueAttrSelector()` stamps the flag in `buildItem` for
   counter/status-badge/notification items: first allowlisted captured
   attribute (extractAttributes order), one bounded
   `querySelectorAll('[attr="value"]')` per item, true only when exactly
   one match AND it is the element itself (path equality). Entities and
   collections never stamped. Conservative single-candidate rule — no
   fall-through to a later attr (observer/derivation pick the same attr).
4. `src/generation/assertion-derivation.ts` — `verifiedAttributeSelector()`
   requires allowlist AND stamp===true; `ownIdFromDomPath()` distinguishes
   the element's own #id (tier id, priority 1) from an ancestor #id — a
   VERIFIED attribute outranks an ANCESTOR #id (wrong-element fix, mirrors
   2c; cart-total no longer asserts against #cart-root), unverified items
   keep the exact legacy fallback chain. Plus `dropAncestorCounters()`
   (crowding fix, see below).
5. `src/tap/page-content-dom-adapter.ts` — wire copy carries the stamp.

## Crowding fix (found by Gate 1, fixed + re-gated)

First real-Chrome 2b run: 29 PASS / 1 FAIL — on /cart steps the three
counter textMatches (badge [aria-label] + cart-count + cart-total) hit
MAX_ASSERTIONS_PER_STEP=3 and crowded out entity presence (2c pin broke:
`entity presence :: []`). Badge and cart-count are the SAME widget (badge
wraps the count span). Fix: derivation-side `dropAncestorCounters()` —
when one counter's domPath is a strict ` > `-bounded prefix of another's,
the ancestor wrapper is dropped (leaf kept). Pre-2b both nested captures
were id-less and derived nothing, so the dedupe only removes redundancy
2b introduced. After fix: /cart steps derive cart-count + cart-total +
entity presence — exactly three, cap respected, no redundancy.

## Tests

- tests/generation/assertion-derivation-alt-testid.test.ts — 2b block
  replaced "2b HELD" pins with 12 positive/negative cases: verified →
  locator; unverified/absent/false → legacy policy; verified attr
  outranks ANCESTOR #id; own #id still wins; non-allowlisted attrs never
  become locators; aria-label; escaping; numeric gate unchanged;
  nested-counter dedup (leaf kept, entity survives) + sibling
  non-dedup pin.
- tests/understanding/page-content-alt-testid.test.ts — 7 new observer
  tests: stamp true / false (duplicate) / undefined (no allowlisted attr),
  sole-attr unique, conservative no-fall-through (first attr shared →
  false even if second unique), entities/collections never stamped,
  full-pipeline stamp→derivation.
- Full suite: 217 files / 3977 tests GREEN. `tsc --noEmit`: 6 errors =
  pre-existing baseline, 0 net-new. Build exit 0.

## Real-Chrome gates (Chrome 148 headless=new, --load-extension=dist)

- Gate 1 AdaniOne clone (harness-gate-2b.mjs, CDP 9553, clone 8166):
  **30 PASS / 0 FAIL** (post-crowding-fix run: 29/1 before fix).
  - cart-count asserted `[data-auto-id="cart-count"]`, cart-total asserted
    `[data-auto-id="cart-total"]` (2b positive pins)
  - NO assertion targets #cart-root anywhere (wrong-element guard)
  - entity presence `[data-sku="MEAL"]` on all three /cart steps
  - 8/8 steps passed, 0 ElementNotFound, qty steps fast
- Gate 2 a-slice regression (9551/8152): **35 PASS / 0 FAIL** — exact
  baseline reproduction (data-testid + data-count + #id counters on the
  untouched path).

## Evidence

`.drytis/notes/evidence/defect1-2a-2c-gates/adanione-2b/`:
harness-gate-2b.mjs, gate1-2b-final.log, gate2-aslice-2b.log, dumps/
(ir-plan, execution-result, assertion-results, generated-spec).

## Exclusions (unchanged)

`tests/tap/consequence-settling.test.ts` untracked-orphan stays
excluded; all `.drytis/` artifacts untracked.
