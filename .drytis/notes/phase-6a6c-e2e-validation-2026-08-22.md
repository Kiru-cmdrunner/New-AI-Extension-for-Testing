# Phase 6A+6C — Real-Chrome E2E Validation (post-implementation)

Build: dist @ working tree (6A+6C + P11 + WARN fixes), v10.9.0.
Harness: same multipattern harness as the pre-implementation baseline
(.drytis/notes/evidence/multipattern-validation-2026-08-22/harness.mjs),
unchanged checks → delta directly attributable. Baseline was 12 PASS / 3 FAIL.

## Result: 14 PASS / 1 FAIL (artifacts: .../multipattern-validation-2026-08-22/post-6a6c/)

The 1 FAIL is a STALE BUG-WITNESS CHECK, not a regression. The harness line
`reactish: controlled-rewrite divergence captured` demanded the OLD broken
shape (a TextEntry whose committed textValue === 'Sat, 05 Sep') to prove the
bug existed. With 6C live, the date interaction is classified DatePicker
(selectDate keeps typed 'Sat, 22 Aug' — verified PASS in IR:
`Select Sat, 22 Aug in the Choose a date`, input='Sat, 22 Aug'), and the
check's /TextEntry/ regex over .date-input finds no candidate. The bug it
witnessed no longer occurs: no TextEntry anywhere commits away typed intent.
The typeahead TextEntry (ben → Bengaluru) shows the contract both ways:
metadata textValue='Bengaluru' (committed, blur-wins) + userTyped=true;
IR fill uses committed 'Bengaluru' (typed 'ben' was an intermediate partial,
correctly not the fill intent).

## 6A confirmed fixed (O8 zero-assertion collapse)
- classic: Click step resultingState = 1 item — collection n=2 on
  body > main > table#results > tbody, matchedSelector='changed-element-seed'
  (seed-sourced; the #id-only app matches no selector family). IR derives 2
  assertions: equality/value 'invoice' on #q (fill committed-value, 6C P2)
  + count=2 on the results collection (seed-derived, 6A).
- Generated spec: `await expect.soft(page.locator('#q')).toHaveValue('invoice')`
  (P10 renderer live) + collection count assertion. "No assertions generated"
  header GONE.
- P11: Dropdown selectedValue='High' — the FINAL keyboard-committed choice
  (was pinned to intermediate 'Low' pre-fix).

## Unchanged-healthy
- shop pattern: 3 distinct stepper clicks (repeated identical locator stays
  2 separate steps), 9 assertions, correct getByLabel/toContainText/toBeAttached.
- reactish status pill textMatch derived (transient 'Planning…' — F3/F5
  lifecycle scope, correctly unchanged).

## Harness note
app.mjs now guards EADDRINUSE (exits 0 if 8177 already up) — the harness
import side-effect starts the server; run harness.mjs directly, no separate
app server needed.
