
---

## FINAL RUN — b3-full-final3 (2026-08-25, definitive, post reviewer-critical fixes)

> Correction (2026-08-26): the section this replaces described the run stored
> under `b3-full-final/`, whose dumps were captured at 18:42 — BEFORE the
> 18:59 C3 RCA fix and the 19:00 ZIP. That run's dumps show the PRE-FIX
> state (dismissal hasEv:false) and were mislabeled as definitive. The
> directory is retained as `b3-full-final-PREFIX-18-42` for the record; the
> definitive evidence below is `b3-full-final3/`.

Definitive run against ZIP md5 `55948f9ffc0226668af2c42115e3ad61` (contains:
C3 RCA fix + reviewer Critical #1 fix — synthetic eventId reshaped to
`evt-{pageId}-{counter}` with 1e9-offset counter; synthetic captureSeq
repositioned to the episode's last INPUT instead of the blur).
Harness result: **14 PASS / 0 FAIL**.

### Census delta (baseline → final3)

| bucket | baseline | final3 | notes |
|---|---|---|---|
| unclassifiedTotal | 6 | 14 | more surface captured by design (S4 body card; per-key keydowns surfacing) |
| gate-rejected | 4 | 10 | 9 per-key keydowns (no-focus typing, R1 discrete contract) + plain-div |
| body-structural | 0 | **1** | ONE paired body click-away card — captured by S4, correctly paired by pairPhysicalPress (blur-wedge split fixed) |
| evidence-consequential | 1 | 3 | responding-div (flag=true), backdrop dismissal (flag=true, hasEv=true), plain-div-survivor |
| dedup-resurrected | 1 | **0** | S2 fold verified — Repeat Me members [click, click, mousedown], twin claimed (reviewer Critical #1 fixed) |

Key verifications:
- `dedup-resurrected = 0` — the twin mousedown is claimed by the fold
  (`evt-…-44 claimed by int-2` in the ledger dump), no Repeat-Me half-card.
- Body card: exactly ONE (`members=['mousedown']`) — the mousedown/blur/click
  interleave no longer splits it.
- IR plan: `[fill, click, fill, fill, click]`, **zero select steps** (B2 parity).
- C3 dismissal card: `hasEv=true, flag=true` — the stale-lifecycleBindings RCA
  fix delivers evidence inside the S1 drain window.
- B2 flow regression: 5 recognized + 0 Unclassified, Save folded (rc=1).
- M5 verification: `diffs=[]`. Panel console errors: 0.

### Honest residuals (documented, not bugs)
- 9 per-key `keydown` Unclassified cards from no-focus typing alongside the
  single S3 synthetic `change` card — discrete per R1, surfaced per M5;
  tracked as a possible future keydown-grouping slice.
- The census flow's plain-div card keeps `flag=true` classification
  evidence-consequential because the fixture div mutates text on click by
  design (it demonstrates the flag), while `#plain-div` (no handler) stays
  gate-rejected — the flag distinguishes them correctly.


---

## CLOSURE BUILD — b3-full-closure (2026-08-25 ~21:24 UTC)

After the final3 evidence run, the download-server containment fix (see
infra notes) required rebuilding the ZIP to refresh the served artifacts.
Entry content is deterministic across rebuilds (entry-hash-equal verified),
but the packer embeds build mtimes, so the raw md5 differs per build.
The closure build is pinned as:

- **Closure ZIP md5:** `b702ac441996d015ca0efa404c0dafb8`
- **sha256:** `d2eb9c0d4cc4c56cd24bebb8b3120c0984b462731e1e13b5d5c4472d47e78e90`

A final harness run against the closure build (`b3-full-closure/`) produced
the same **14 PASS / 0 FAIL** result and identical card composition (16
cards: Repeat Me folded with members [click,click,mousedown], ONE paired
BODY card, 9 keydown + 1 change typed-text cards, census
`dedup-resurrected = 0`, unclassifiedTotal 14 = 10/1/3). final3 remains the
detailed semantic evidence; closure is the served/pinned artifact.
