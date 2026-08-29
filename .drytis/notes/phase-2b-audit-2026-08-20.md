# Phase 2b audit — id-less counter assertions via uniqueness-verified locators (2026-08-20, HEAD b2fa5b1)

Read-only. Recommendation: **IMPLEMENT 2b, narrowly** (verify-at-derivation, attr-allowlist
`aria-label` + `data-count`-class first). Alternative if a user-visible unverified slot must
ship NOW: Option V (verify-at-evaluation, `resolveAllMatches().length === 1`). Full analysis below.

## 1. What 2b does today / where it's blocked

- Capture side (2a, SHIPPED): id-less counters ARE captured with attributes — clone evidence
  shows `cart-count` (data-auto-id), `cart-total`, badge (`aria-label="Cart items"`, `data-count`).
  page-content-config.ts:32-44 (extractAttributes now includes data-auto-id/test-id/test + aria-label).
- Derivation side (BLOCK POINT): assertion-derivation.ts decideLocator() (~line 200-224):
  entities → identity-attr > #id; NON-entities → **#id from domPath FIRST, then
  identityAttributeSelector() — which `return null` for kind!=='entity' (line 117)**.
  So an id-less counter (no #id anywhere in domPath) gets tier 'none' → assertion SKIPPED.
  An id-less counter WITH an ancestor #id still gets `#ancestor` (2b held pin: cart-total →
  #cart-root, which can be a WRONG-element locator — parent container text ≠ counter text).
- Pins: tests/generation/assertion-derivation-alt-testid.test.ts:119-170 (3 pins: no assertion
  for id-less; ancestor #id → #ancestor; never an attr locator for counters).
- Evaluator: neither twin enforces single-match. textMatch uses resolveElement(first-match,
  executor-content-script.ts ~:520-527); Playwright renders textMatch CONTAINS →
  locator('css').toContainText() (assertion-renderer.ts:192) — strict mode throws on multi-match
  (test fails, not silently wrong); the extension twin would read the FIRST match's text —
  silently-wrong on multi-match (which is exactly why the policy blocks these).

## 2. Can a uniqueness-verified locator be added safely?

**YES — verify-at-derivation time** (recorder-side DOM check) is genuinely safe AND
eliminates the reviewer-noted `#ancestor` wrong-element risk in the same move:

- The snapshot is produced from the live DOM at consequence-settlement (Click windows) or
  destination stabilization (post-nav). The document is then quiescent (300ms quiescence +
  causal network idle) — a `querySelectorAll(selector).length === 1` check inside
  deriveStepAssertions' caller (service worker has no DOM — verification must happen in the
  OBSERVER, page-content-observer, at snapshot time, and be stamped on the item) is meaningful
  because capture and verification see the SAME settled DOM.
- Where the check lives (architecturally clean): page-content-observer (which walks the DOM
  and produces WireObservedItem) stamps `uniqueInSnapshot: true` when the candidate attribute
  selector matches exactly one element. Derivation then gates on it. No new wire type needed if
  we reuse a boolean field; strictly better than verifying at SW-derivation time (no DOM there).
- Cost: one querySelectorAll per candidate item per snapshot (≤50 items, bounded) — negligible.

**Caveat (why it is not bulletproof):** capture-time uniqueness does not PROVE replay-time
uniqueness (SPA lists render later; aria-label values repeat across routes). Soft severity +
Playwright strict mode make residual risk acceptable: worst case is a failed soft assertion /
thrown export test, never a silent wrong PASS. It does NOT weaken existing protection:
unverified counters keep tier 'none' → skipped, exactly as today.

## 3. Allowlist / reject list

ALLOW (stable, semantic, app-authored):
- `aria-label` — user-facing, stable, already captured (config:32-44), already the #2 priority
  in locator-resolver.ts:31 (ACCESSIBLE_NAME is a first-class replay strategy: `[aria-label="X"]`).
- `data-auto-id` / `data-test-id` / `data-test` / `data-testid` — test-intent attributes, stable,
  generic conventions (2a captured them), the same family 2c already trusts for entities.
- `data-count` — semantic counter mirror of the badge value (captured); matches one badge span.

REJECT (keep tier 'none' → skipped):
- `data-sku`-family identity attrs on counters — identity of ENTITIES, wrong semantic for a counter.
- class fragments / matchedSelector — multi-match by construction (siblings share).
- nth-child / synthesized chains — INV-GEN-4 forbids.
- text-content locators — volatile, i18n-fragile.
- `role` alone — too broad (role="status" matches toasts AND live regions).

## 4. Is 2b still necessary after 2a/2c + real-Chrome?

**Yes, materially.** AdaniOne-class sites (the target class!) systematically use id-less
counters: evidence file shows cart-count, cart-total, and badge counters captured but NEVER
asserted (gate check "cart-count NOT asserted (2b held)" PASSES by asserting the gap). On the
clone the qty flow's most semantic outcome — "Total items: N" (cart-total) — had NO assertion
after the final click; only entity presences fired. Real-AdaniOne behavior was INACCESSIBLE
(Akamai), so the clone is the best available proxy and it says: this class produces exactly
the gap 2b fills. Post-Option-D, assertion targets resolve reliably (gate1f: 6/6 soft passed),
so the pacing excuse for deferring is also gone.

## 5. Smallest safe implementation (sketch, ~3 files + tests)

1. `src/understanding/page-content/page-content-observer.ts` (or wherever items are built):
   for counter items lacking a domPath #id, compute candidate selector from allowlist attrs;
   stamp `unique: true` iff `document.querySelectorAll(sel).length === 1`. (Bounded: one qsa per
   id-less counter per snapshot.)
2. `src/shared/page-content-wire.ts`: add optional `uniqueInSnapshot?: boolean` to WireObservedItem.
3. `src/generation/assertion-derivation.ts` decideLocator(): non-entity branch — after #id tier,
   if item.kind==='counter' && allowlisted attr present && item.uniqueInSnapshot →
   `[aria-label="Cart items"]`-style locator, tier 'identity-attribute'. Flip the three 2b-held
   pins to positive tests; keep reject-list pins (no class/text/role/sku locators ever).
4. Optional symmetry (reviewer-flagged): when #id tier chosen but the #id is an ANCESTOR
   (idFromDomPath returns an id not on the item's own segment), prefer a verified attr locator.
   Smaller blast radius if done as a follow-up; flag it in the spec.
5. Regression tests: unit (derivation + wire field + observer stamp), clone gate re-run
   (cart-count/cart-total now asserted on `[data-auto-id="cart-count"]` / `[aria-label="Cart items"]`
   — expected gate deltas: the two "NOT asserted (2b held)" checks FLIP to positive assertions),
   a-slice 35/35 must hold (its counters have #ids — untouched path).

## 6. Impact on 4c, 5a, 5b

- 4c (assertion derivation framework): pure extension inside decideLocator — no schema/type
  changes beyond the optional wire flag; MAX_ASSERTIONS_PER_STEP=3 unchanged; soft severity
  unchanged. Zero impact on the 4c-iii hard-assertion promotion path (gate unchanged).
- 5a (API test seeds from network activity): independent (network evidence, not page content).
  No shared state; no impact.
- 5b (future): the `uniqueInSnapshot` flag is exactly the kind of provenance a future
  "assertion confidence" or POM-locator promotion would consume; additive only.

## Alternative considered — verify at EVALUATION time (Option V)

Executor checks `resolveAllMatches(locators).length === 1` for textMatch on attr locators;
fails as `Element not unique (N matches)` instead of asserting. Pros: no wire change, protects
against replay-time drift. Cons: does not fix the Playwright EXPORT (which throws strict-mode
on multi-match — acceptable) and leaves `#ancestor` wrong-element risk untouched. Good
DEFENSE-IN-DEPTH companion, not a substitute.

## Residual risks (documented)

- Capture-unique ≠ replay-unique (SPA late renders). Mitigated: soft severity + strict mode.
- aria-label can be localized (i18n): expectedValue is the captured text — same exposure class
  as every textMatch today; nothing new.
- data-* attr with hostile value: attrValueForSelector already backslash-escapes (line 106-108).
