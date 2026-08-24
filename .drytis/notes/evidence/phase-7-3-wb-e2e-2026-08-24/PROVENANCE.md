# PROVENANCE — 7.3 W-B E2E evidence (2026-08-24)

**Change:** Generic QA auto-id recognition (`auto-id` family) — spec
`.drytis/specs/phase-7-3-wb-auto-id-generic.md`.
**Baseline:** HEAD 98aa71b (uncommitted working tree during evidence capture).
**Build:** npm run build @ v10.9.0 → `cmdrunner-extension.zip` md5
`335442a0cad934f9b8e66022ee0637a2` (301,524 B) — identical across root,
`download/`, `serve/download/`, and the preview-served copy (infra_verifier
§4). Extension id `gndjidfncanlhlonpcabokbdhnikglpn`, dist loaded via
`--load-extension` (fresh profile per run).

## Harness runs

| Log | Result | Notes |
|---|---|---|
| run-1.log | 2 PASS / 10 FAIL | harness defect: `npx http-server` startup race — fixture unreachable |
| run-2.log | 4 PASS / 8 FAIL | harness defect: clicks landed on `html` (app tab not activated / card 4 below fold); DIAG line already proved the ENGINE correct (Click+autoId, Click+dataAutoId, honest Unclassified in live buffer) |
| run-3.log | 4 PASS / 8 FAIL | same + diagnostics; confirmed wrong store read (`session-*` keys vs `cmdrunner_live_interactions`) |
| run-4.log | 9 PASS / 3 FAIL | harness reads fixed; 3 remaining failures = wrong W3 text matcher + IR shape assumption |
| **run-5.log** | **12 PASS / 0 FAIL** | **canonical run** — all W1–W7 green |
| run-6f-regression.log | **9 PASS / 0 FAIL** | house 6E-M2/6F-M1 regression on the same build (app-verbatim.mjs fixture on 127.0.0.1:8190) |

Runs 1–4 are harness-side failures, not engine defects — each fixed in the
harness only; zero src/ changes between run-1 and run-5. The DIAG evidence in
run-3 is the decisive mid-hunt proof that the engine behaved correctly even
while the harness read the wrong stores.

## Canonical results (run-5)

- **W1** click on inner `.price` span of `div[auto-id="select_flight_card"]` →
  captured target IS the card (ancestor lift), classified **Click** with
  `trigger.autoId = select_flight_card`, name "Flight 6E-231".
- **W2** `div[data-auto-id="select_return_flight_card"]` → **Click** via
  6B spelling (now claimable post-W-B).
- **W3** un-instrumented div ("Free meal offer (no QA id)") → honest
  **Unclassified** (control — W-B claims only instrumented targets).
- **W4** real inner `<button id="bundle-add">` inside `div[auto-id="bundle_card"]`
  → Click on the BUTTON (leaf-first wins over instrumented ancestor).
- **W5** IR plan step-0001 target carries priority-1 `testId:
  [auto-id="select_flight_card"]` with accessibleName fallback — NOT
  nth-of-type (`ir-plan-73wb.json`).
- **W5b** no nth-of-type fallback for the instrumented-card steps.
- **W5c** codegen: renderer mapping is unit-pinned
  (tests/locator-family-6b.test.ts `renders [auto-id="X"] …`) and
  shipped-bundle-inspected (infra_verifier §4 found the regex + render path
  in the ZIP); the browser-run check asserts the IR locator value (reviewer
  WARN-1 — panel exposes no codegen storage key in this build).
- **W6** exactly one Click for the card (no twin) — elementKey chain change
  regression-checked.
- **W7** zero console errors in the panel context (`console-73wb.json`).

## Regression (run-6f-regression.log)

House 6E-M2/6F-M1 harness (DatePicker verbatim clone): 9 PASS / 0 FAIL —
zero twin Clicks, DatePicker round-trips intact, 6B `data-auto-id` regression
exactly one Click, 6D.1 W3 options-list + W2 counter green, IR
`["selectDate","selectDate","click","click","click"]` with no Unclassified
leak, KR Dexie rows written. The three regenerated `m2-*.json` dumps were
**reverted** to committed state (UUID churn only; reviewer WARN-2).

## Fixture

`public/auto-id-generic-validation.html` — generic, site-token-free
(genericity doctrine); server `node_modules/.bin/http-server /workspace/public`
on 127.0.0.1:8241 (spawn-blocked until 200, house pattern).
