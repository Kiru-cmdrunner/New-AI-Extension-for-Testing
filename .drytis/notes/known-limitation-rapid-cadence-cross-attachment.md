# Known Limitation — KL-1: Rapid-cadence dialog cross-attachment (birth-drain theft)

**Status:** Known limitation — deliberately NOT addressed by Fix A (commit b31d6c2).
**Discovered:** 2026-08-21, during Fix A validation (dialog-attribution RCA).
**Severity:** Low — requires extreme rapid cadence (sub-second back-to-back
dialog-triggering clicks) to trigger; not observed in realistic usage.

## Observed behavior

Under a rapid cadence (click → ~400ms → click → ~400ms → stop), where each
click triggers a native dialog (`alert` / `confirm`) handled automatically, the
dialog stamps can attach to the WRONG click — e.g. the first click's dialog
("D1 alert") appears on the second click's interaction and vice versa.

Evidence: `.drytis/notes/evidence/final-scope-audit-rca2/dialog-race-fixa.log`
(storage dump shows int-2/Alert-button click carrying "D2 confirm" and
int-4/Confirm-button click carrying "D1 alert" — cross-attached); probe
`stop-claim-verify.mjs` preserved in
`.drytis/notes/evidence/dialog-fixa-validation/`.

## Root cause (structural, not timing-rule fixable without a design change)

`openWindow` performs an at-birth drain of page-world stamps
(`readPageWorldSignals()` at evidence-collector.ts ~line 527). EventTap listens
in the CAPTURE phase, so the page's own click handler runs AFTER
`openWindow`'s drain — the stamp for the CURRENT click's dialog is written
only after the window is already open. The stamp is therefore always claimed
by a LATER reader. In rapid cadence the SECOND click's `openWindow` birth
drain runs while the FIRST click's dialog stamp is still pending on `<html>`
(if its window hasn't settled/closed yet) — so the second window steals the
first window's stamp at birth. Destructive read = first reader wins, wrong
owner.

Fix A fixed the sibling problem (an abandoned Hover's last-resort drain
stealing a stamp) using a pure membership rule — defer while a causal
dialog-capable window is open. Fix A does NOT and cannot fix this case: the
birth drain is the designed claimant for the current click, and it cannot
distinguish "stamp from my own handler (not yet written)" from "stamp left
over from a previous click's late dialog" without a timing or ordering signal.

## Why it is acceptable for now

- Requires sub-second back-to-back dialog clicks — unrealistic for the
  product's recorded-test workflows (users read and dismiss dialogs).
- Fix A already removed the realistic misattribution path (abandoned-Hover
  theft) that motivated the RCA; clean-cadence attribution is correct and
  panel-rendered (proven in dialog-fixa-validation/panel-definitive-run2.log
  and zip-e2e-fixa evidence).
- Both dialogs remain captured exactly once (destructive read guarantees no
  duplicates) — only the OWNER can be wrong under the extreme cadence.

## Candidate future fix (design-level, needs approval — not implemented)

Stamp a monotonically increasing sequence on each dialog injection
(dialog-inject.js) and have the birth drain claim ONLY stamps whose sequence
predates this window's openedAt marker (or skip the birth drain entirely and
rely on close-time reads + a bounded-generation check). Any such change must
avoid per-event timing constants to stay within the project's no-timing-rules
constraint — a sequence/generation number is the structural option.
