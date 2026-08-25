# 7.4-B3 Census Report — Unclassified Residual Classification

**Build:** pre-B3 dist (7.4-B2 closure build, ZIP md5 762de56e9ef7dfd75cc30c96e36c6b9f)
**Date:** 2026-08-25 (session evidence dir `phase-7-4-b3-e2e-2026-08-25/baseline/`)
**Analyzer:** `scripts/unclassified-census.mjs` (S0-1)

## Baseline (pre-B3, B2 dist)

### Census fixture flow (`censusflow-storage.json`)

| class | count | detail |
|---|---|---|
| dedup-resurrected | **1** | `int-7` `Repeat Me` BUTTON click, gap 156ms < 2s from prior `int-2` — the F1 signature, reproduced on the new fixture |
| evidence-consequential | **1** | `int-8` plain-div click with stranded pendingEvidence (1 domChange: output text update) — F2 stranding, reproduced |
| gate-rejected | **4** | responding-div click (evt-13, evidence not yet attached/stranded at dump time), repeat-btn mousedown twin (evt-21), backdrop click (evt-36), second plain-div click (evt-70) |

Unclassified total: 6 of 9 cards. Ledger: 25 entries — 12 pending, 12 claimed, 1 unclaimed. pendingEvidence: 2 keys.

**Reproduced defects on the B2 dist (independent confirmation of F1–F4):**

- **F1 dedup resurrection** — second `Repeat Me` click within 2s → Unclassified card for a
  maximally-interactive BUTTON (`int-7`), with its mousedown twin as a second card (`int-11`,
  classified gate-rejected because its disposition is pending, not unclaimed — the analyzer's
  dedup class requires the `unclaimed`+`lc-*` signature; the twin is part of the same
  resurrected gesture, noted).
- **F2 evidence stranding** — `plain div — no affordance` click carries stranded
  pendingEvidence (domChange) that never attaches to the projected card.
- **F4 capture drop** — backdrop/body click-away is captured here as Unclassified
  (`int-13`, evt-36, targetName "") — WAIT. On this fixture the backdrop is a plain `div`
  with `position:fixed; inset:0`, and resolveTarget strategy 3 returned the **div** (not
  BODY) because the div itself is not in NON_INTERACTIVE_TAGS. So the census fixture's
  "body click-away" flow actually captured the backdrop div, not body. The true F4
  (click on `<body>` itself, e.g. below content) remains untested by this flow — the
  click at (5,5) landed on the backdrop div. Post-S4 behavior for the backdrop div is
  unchanged (plain div, gate-rejected). **The dedicated body-click path needs a click on
  bare `<body>` margin, not the backdrop div.** See Post-B3 delta section.
- **F3 typed-text loss** — NOT exercised by this baseline run. The harness's F-pop 5
  (type into #autofocus-input then click plain div) produced a **TextEntry** card with
  typedValue "lost text" — the click-to-focus started the lifecycle, so no loss occurred.
  The no-focus scenario requires focus to be gone before START_RECORDING (e.g. reload the
  page, start recording, then type without clicking). Fix harness before the delta run.

### B2 combobox regression flow (`b2flow-storage.json`)

| class | count | detail |
|------|---|---|
| dedup-resurrected | **1** | Save click int-11 analog (`evt-pmt8w9kdn-68`), gap ≤ 2s |
| gate-rejected | **1** | Save mousedown twin (int-17 analog) |

pendingEvidence: **0 keys** — the B2 flow's click-away dismissal evidence attached to the
TextEntry (search-c) window (G5 network supplement timing) or drained at emission; the
stranded evidence in the original B2 dump was for evt-68 which in this re-run was a dedup-
suppressed click with no window match (the click-away closed the list that had no open
window in this run — flow ordering differs from the original B2 run because the second
Save click path changed the evidence window topology).

**Baseline totals across both flows: Unclassified 8 / 14 cards; dedup-resurrected 2;
evidence-consequential 1; gate-rejected 5.**

## Analyzer semantics (S0-1)

- `dedup-resurrected`: ledger `disposition: unclaimed` + `claimedBy: lc-*` + a recognized
  Click prior with same elementKey within 2000ms.
- `evidence-conamental` [sic — `evidence-consequential`]: attached or stranded
  (pendingEvidence) evidence for the card's eventId with ≥1 consequence signal.
- `gate-rejected`: everything else (includes resurrected gestures' mousedown twins — the
  honest catch-all).
- `body-structural`: targetTag BODY/HTML (post-S4 only).

## Post-B3 delta

(runs after implementation; will be filled by the delta run)
