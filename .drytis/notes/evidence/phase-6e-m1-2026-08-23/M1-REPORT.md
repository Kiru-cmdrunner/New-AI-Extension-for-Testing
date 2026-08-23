# 6E-M1 Report — Results-Page HEAD Measurement Matrix

**Date:** 2026-08-23 · **Baseline:** 317c527 (clean tree, 14 commits ahead of
origin, unpushed) · **Phase state:** M1 evidence-only — ZERO product-code
changes (verified: tracked tree clean at every checkpoint).

**Setup:** Chrome 148 headless CDP (trusted-input dispatch only), extension =
shipped `dist/` build 10.9.0 (6D.1 W3 tokens + 6B dataAutoId markers verified
in bundle), extId `gndjidfncanlhlonpcabokbdhnikglpn`, fixture
`app-6e.mjs` on `127.0.0.1:8189` (fidelity-upgraded clone: results page with
skeleton→3 flight cards, combobox date picker with W3C-name cells, duration
chips, data-sku entity control, cart counters), harness `harness-6e.mjs`
(6D.1/6D.2 house pattern: panel-context recording start, activate app tab,
panel-context storage + Dexie KR probes). Iterations: 5 runs (runs 1–2 =
harness-side extraction bugs fixed; run 3 = fixture sequencing fix —
evidence-forced; run 5 = final green). All verdict checks pin OBSERVED
behavior.

## Final matrix — 11 PASS / 0 FAIL (run 5, `6e-run5.log`)

| Cell | Interaction | HEAD behavior (measured) | Verdict |
|------|-------------|--------------------------|---------|
| C1 | Shape-A card body click (plain div `data-auto-id="flight-F2"`, no role/class token) | ONE paired **Unclassified** card, honest; IR-filtered | Residual documented (O10 core) |
| C2 | Shape-B card click (`role=button` + `aria-label="Select flight QP-1478"`) | ONE **claimed Click** | Already covered at HEAD |
| C3 | Duration chip `.dur-chip` ('02h 30m', class token `chip`) | ONE **Click** | Covered (INTERACTIVE_CLASS_RE) |
| C4 | Duration chip `.dur-opt` ('12h 10m', no interactive signal) | ONE paired **Unclassified**, honest | Residual documented |
| C5 | `#depart` field (placeholder/name 'Depart on') + cell-pick value write at mousedown | ONE **TextEntry**, `textValue: "Sat, 05 Sep"`, `userTyped: true` — exactly the evidenced Run-A int-33 shape | Covered (TextEntry owns it; DatePicker does not — see C5b) |
| C5b | Same field, DatePicker definition | **NO DatePicker card** — 'Depart on' lacks any `DATE_NAME_HINT_RE` token (date/birth/dob/expire/expiry/calendar) | Honest HEAD cell; W4 vocab gap measured |
| C6 | Date cell (`role=option`, aria-label "Choose Saturday, September 5th, 2026", class `cal-cell` unknown to `DATEPICKER_CELL_CLASS_RE`) | ONE **standalone Click** carrying the full date name; never absorbed by Dropdown (hasDateCellName exclusion works) | Honest HEAD cell; class-vocab gap measured |
| C7 | Skeleton→3 cards swap (net-zero child churn 3/3) | **Seeds nothing** (0 knowledgeCollections; no flight knowledgeEntities) | Measured — W2-style relaxation does NOT extend here |
| C8 | `data-sku="MEAL"` control row (proven path) | knowledgeEntities `product:MEAL` present | Probe valid |
| C9 | Counter consequence (pick F2+F3 → badge 0→2) | IR steps carry cart-count assertions, 0→2 progression, 3 steps | Covered |
| C10 | IR plan | 4 steps: `fill`, then 3 `click`s; no Unclassified leak (NOISE_TYPES intact) | Covered |
| C11 | KR Dexie write | applications 1, sessions 1, counters 2, entities 1, edges 7, episodes 5, outcomes 6, signatures 5, workflows 1, gaps 5 | Covered |

## Findings that update the record

1. **O10's core residual is narrow and two-shaped.** At HEAD, the only
   results-page interactions that don't produce IR steps are (a) a card whose
   markup is a plain div with no interactive signal (C1) and (b) a filter
   chip with no interactive token (C4). Both fall to paired-Unclassified →
   IR-filtered. If the real AdaniOne card is button-shaped (C2), O10's
   "cannot book a flight" is ALREADY closed by 6D.0/6D.1 — the E2E in
   6E-M2 would prove it end-to-end. **The real card's outerHTML (checklist
   item 1) is the single decisive artifact for M2.**
2. **W4 date vocabulary gap is real but low-cost.** 'Depart on' — the
   evidenced real field name — matches no `DATE_NAME_HINT_RE` token. The
   behavior is nonetheless correct: TextEntry captures the value transition
   (C5 green, IR `fill` step present). DatePicker would additionally group
   trigger+cells; without it, cells are honest standalone Clicks (C6).
   M2 option (gated on checklist item 2): consider adding `depart` /
   `return` tokens — vocabulary-only, definitions-layer, zero structural
   change. **No change without the real markup evidence.**
3. **W2 does not extend to card swaps.** C7 measured: the 3/3 skeleton→cards
   net-zero swap seeds nothing. This is the correct conservative default
   (W2's 1/1 text-swap gate stays as shipped in 6D.1). If a future entity
   story needs cards, it must arrive with its own evidence, not by relaxing
   this gate.
4. **Run-1→3 fixture iterations were evidence-forced, not harness-bias.**
   The date-cell value-write had to move to mousedown (before blur) to match
   the evidenced Run-A capture sequence — a real-browser ordering fact the
   clone now mirrors. Harness-side bugs (missing `dumps/`, wrong extraction
   fields `dateValue`/double-counting, C9 reading card-level instead of
   IR-step-level assertions) were fixed across runs 1–2, 4; run 5 green with
   zero fixture ambiguity.
5. **KR entity recognition stays noise-guard-correct.** Only `data-sku`
   (value-bearing) seeded an entity (C8); widget-named `data-auto-id` alone
   seeds nothing (C7). Entity recognition for cards would need real identity
   attributes on the real cards (checklist item 5).

## Harness/fixture bugs vs product defects — classification

- Harness/fixture-side (fixed in-run, no product impact): dumps/ ENOENT;
  card-extraction field names (`cssSelector` structural, `dataAutoId` read
  path); C9 assertion channel; C5 double-count; date-cell value-write timing
  (evidence-forced fixture realism fix); '02h 30m' chip expectation (real
  class token → Click is correct HEAD behavior, expectation re-pinned).
- Product-side findings (all honest/bounded, none fixed, all candidates for
  M2 gated on real evidence): C1/C4 Unclassified residuals; C5b W4 vocab
  gap; C6 cell-class vocab gap; C7 no-seed (correct default).

## M2 gate status

M2 remains **BLOCKED on real-site evidence** (checklist:
`EVIDENCE-CHECKLIST-ADANIONE-RESULTS.md`). Every candidate M2 item cites the
checklist item that decides it:

- Flight-card classification (M2 core): checklist item 1 (card outerHTML).
- W4 vocab addition (`depart`/`return`): checklist item 2 (real field name).
- Calendar-cell class vocab: checklist item 3.
- Duration-chip tokens: checklist item 4.
- Card identity attrs for entity recognition: checklist item 5.
- 6E-M2 E2E (book-a-flight on upgraded clone): can run WITHOUT real-site
  evidence (fixture-only validation), but is validation-only, not
  classification, and stays owner-gated.

**FROZEN throughout (per owner directives):** KR signatureKey v1, dataAutoId
fuzzy matching, stabilityTrace discard, 6F display work, capture/ledger/
projection changes, any site-specific hack (genericity pin 153f5c2 green).

## Artifacts

- `app-6e.mjs` — fidelity-upgraded fixture (R1–R6 evidence mapping in header)
- `harness-6e.mjs` — CDP measurement harness (run-5 state)
- `6e-run1..5.log` — full iteration logs; `6e-run5.log` = final green matrix
- `dumps/6e-storage.json` — full storage probe (ledger + interactions)
- `dumps/6e-cards.json`, `dumps/6e-ir-plan.json` — projected cards + IR plan
- `dumps/6e-kr-dexie.json` — Dexie KR rows (entities/counters/edges/signatures)
- `EVIDENCE-CHECKLIST-ADANIONE-RESULTS.md` — the real-site evidence loop
- `fixture.log` — fixture server log
