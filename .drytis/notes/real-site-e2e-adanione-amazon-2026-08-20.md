# Real-site E2E — AdaniOne + Amazon — 2026-08-20 (read-only, no fixes)

Build under test: dist @ 350af71 (Phase 2b). Real Chrome 148 headless=new,
extension via --load-extension. Harnesses + dumps:
.drytis/notes/evidence/real-site-e2e-2026-08-20/

## AdaniOne — IMPOSSIBLE from this egress (environment, not extension)
Re-verified live today: TLS ok, then HTTP/2 stream reset, 0 bytes, any path.
Real Chrome lands on chrome-error://chromewebdata/, no DOM → L3+ unevaluable.
Matches adanione-site-access-blocked.md (Akamai edge blocks datacenter IPs).
Do not re-probe; use the AdaniOne-tech clone for AdaniOne-class validation
(gate1f / gate1-2b 30/30).

## Amazon — WORKS, with real findings
Homepage renders (no bot check!) — search box, 140 scripts. Full flow:
search 'wireless mouse' → 16 results → Logitech M185 dp page → Add to Cart
→ nav cart = 1 + confirmation + /cart/smart-wagon.

FINAL run (harness-amazon-final.mjs): 11 PASS / 1 FAIL
- Recording (raw START_RECORDING + activate-app-tab-BEFORE-START): armed ✓,
  7 steps, startUrl https://www.amazon.com/
- IR: 7 steps (fill/click/navigate), 7 soft assertions:
  step-0003 presence #search; step-0006 textMatch [data-count="2"] exp
  "Frequently bought together…"; 4× count on
  #sac-autocomplete-results-container > *; step-0007 presence
  [data-asin="B004YAVF8I"] ← data-asin entity locator working on real Amazon
- Codegen: 5 files incl. Playwright spec ✓
- Replay: PASSED 7/7 steps, 10.3s, 1 assertion evaluated

### REAL PRODUCT FINDINGS (reported, not fixed)
F1 — Assertion locator availability gap (the 1 FAIL): derived assertions
carry target.resolvedLocators in IR but harness-side the assertion
targetCss reads empty for step-0003 presence (#search). IR-internal
resolvedLocators exist (verified in dumps); the exported assertion view
loses them. Verify in panel UI before fixing.
F2 — Cart-count counter NOT asserted on real Amazon: #nav-cart-count has an
#id (legacy path should derive textMatch) but no nav-cart assertion was
derived. Possibly capture-time (badge inside <a href>, hidden per CSS) or
region dedup. Worth RCA.
F3 — Wrong-element count locators: 4 count assertions target
#sac-autocomplete-results-container (search-suggestion popup) with exp 1
and 2 simultaneously on the same step — contradictory and semantically
wrong (not a results/collection container). Collection derivation is
matching an autocomplete dropdown.
F4 — Panel-form recording path broken end-to-end for automation: filling
the New Test Case form and clicking tc-start-recording-btn never arms
recording (cmdrunner_recording_active stays undefined); only the raw
runtime START_RECORDING message works. User-facing impact unknown — panel
likely calls something else on click; harness cannot reproduce the real
button path. Related: session binds the ACTIVE tab at arm time — starting
from the sidepanel records the sidepanel (startUrl=chrome-extension://…,
steps=0, replay errors immediately at createTab/injectScript into
extension page — ir-executor-impl.ts:190-218).

## Harness lessons (CDP, documented for next time)
- Recorder needs TRUSTED input: Input.dispatchMouseEvent/KeyEvent, not
  dispatchEvent (isTrusted:false → 0 interactions captured).
- Activate the app tab BEFORE START_RECORDING.
- Raw message types: START_RECORDING / STOP_RECORDING / RUN_TEST fire-and-
  forget from panel page; everything else returns no-callback-value.
