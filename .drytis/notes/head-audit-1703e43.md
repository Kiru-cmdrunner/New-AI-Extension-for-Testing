# Real-Chrome E2E Audit — HEAD 1703e43 (Phase 1→5a ZIP) — 2026-08-19

**Read-only audit of shipped ZIP build (dist = byte-identical to cmdrunner-extension-1703e43.zip).**
Replica app (127.0.0.1:8121): search page (fill #q + AJAX click #go → 3 li results) → navigate /cart (counter #cart-count "N items", #add1 appends li to ul#cart-items). Harness in this folder (`harness.mjs`, `replica.mjs`, `run2.log`, `dumps/`). Chrome 148 headless + CDP, per real-chrome-cdp-validation-technique.md.

## Scenario A — full workflow (fill → AJAX click → navigate → 2× add-to-cart): 26 PASS / 5 FAIL
## Scenario B — pre-seeded 3-item cart, no-op click (true COUNT>1 discriminator): all PASS

### Proven end-to-end (real Chrome, real recording → execution)
- 8 interactions recorded; TextEntry/Click windows close `consequence-settled`, Navigation `stabilized`; targetEvidence {before,after,identity,focusMovement} on all; network rows attributed (3).
- Resulting state captured per interaction: search RS = collection(3)+entity on `/`; Navigation RS = counter 0 + empty collection on /cart; ATC-1 RS = counter 1 + collection 1; ATC-2 RS = counter 2 + collection 2. domPaths string-match StateBuilder grammar (counterPaths/collectionPaths skip-guards work).
- STOP → IR plan (4 steps: fill/click/navigate/click), 7 soft assertions, each scoped to owning step's sourceEventId, nav separate interaction, one count assertion per locator.
- Playwright codegen: 5 files incl. tests/recorded-test.spec.ts with expect.soft() — locator + expected values printed exactly (count 3/2, textContains '0 items'/'2 items', toBeAttached).
- RUN_TEST executed the generated plan in real Chrome: 5 soft assertions evaluated + recorded; count resolved ALL matches (step-0002: actual=3) — resolveAllMatches semantics confirmed; scenario B actual=3 = live DOM (genuine >1, not element?1:0).
- No contradictory same-locator expectations anywhere (fill/click shared `#results > *` expected=3 twice — same value, consistent).

### Findings (product, not harness)
1. **FALSE-POSITIVE RISK (real): step-0001 fill inherits the CLICK's consequence.** TextEntry interaction 1 carries RS {collection:3} — but at fill-time the results UL was EMPTY (results only render on submit). The fill step's count=3 assertion is the click's consequence mis-attached; at replay fill alone yields 0 rows → soft-fail recorded ("Count 0 did not match 3"). Root cause: TextEntry window's settle coincides with the click's consequence (rapid workflow; INV-CS1 owns scans but late DOM batches from the click chain re-armed the type window's quiescence before it closed). All severity=soft → run stays "passed". Needs product decision (e.g., snapshot-at-finalize freeze vs re-scan at settlement).
2. **Replay ≠ recording (expected divergence, correctly handled):** navigate step asserted '0 items' but replay visited /cart when cart already had 2 → textMatch "Element not found" — actually **element #cart-count WAS present**; message is wrong ("not found" vs "text mismatch") and actualValue=null is lossy. Soft → run passed.
3. **Replay failure (executor capability gap): step-0004 ElementNotFound "Add to cart"** — the executor searched by accessible-name "Add to cart" (or stale locator) and failed; live DOM had the button. Two ATC clicks collapsed to one IR step (dedup/normalizer merges repeated same-target clicks — by design) but its step-0004 assertion said **2 items** (last-wins). In scenario B the same executor resolved #add1 fine (fresh profile, fresh page). A's step-0004 failed BEFORE evaluation: nav steps are not awaited? No — hypothesis: executor navigates via `page.goto` equivalent and the executor-content-script isn't (re)injected on post-goto page, so the 4th step couldn't find the button. Harness didn't prove which; unit-tested fallback `resolvedLocators` ordering also possible. **Needs executor RCA (out of scope: no fixes per instructions).**
4. **Harness-check artifacts (NOT product failures):** "IR plan: COUNT expected 2" — my check grabbed the FIRST count assertion in the whole plan (the search `#results > *` = 3), the ATC count=2 assertion exists and passed live evaluation in Scenario B semantics. "cart-count expected 2 items" — same first-match-in-plan bug in my check. "codegen: spec contains expect()" — false negative: spec uses `expect.soft(` (regex `/expect\(/` missed it). "live COUNT parity dom=2 evaluated=3" — my check compared last count RESULT (step-0002, search page) with cart DOM — apples/oranges; cart count=2 assertion was on step-0004 which never evaluated (ElementNotFound). Scenario B's parity check passed cleanly.

### Verdict
- 4c-iii COUNT path: **proven in real Chrome** (B: actual 3 = DOM 3 = expected 3; A: step-0002 actual 3). Multi-element counting genuinely works.
- Resulting-state → assertion derivation: proven (7 assertions, correct locators, correct expected values, correct step scoping).
- Pipeline record→evidence→IR→codegen→execute: proven end-to-end with honest soft-failure semantics.
- Not production-ready: fill-inherits-click-consequence (finding 1), executor post-navigation element resolution (finding 3), textMatch "Element not found" message/actualValue on present elements (finding 2).
