# 7.4-B3 D1/D2 Decision Record — census-fed, decide-don't-default

Status: **RECORDED 2026-08-25 (post-final3 E2E)** — inputs and recommendation
below. Both decisions remain **owner-gated**; this record is the evidence
bundle the owner decision consumes, per spec §8 ("decide, don't default").

---

## Inputs (evidence)

### S0 census — final run `b3-full-final3` (ZIP md5 `55948f9f…`)

Analyzer: `scripts/unclassified-census.mjs` over the censusflow storage dump
(`phase-7-4-b3-e2e-2026-08-25/b3-full-final3/censusflow-storage.json`).

| class | n | identities |
|---|---|---|
| gate-rejected | 10 | 9 per-key keydowns on no-focus typing (`#autofocus-input`, R1 discrete contract) + 1 plain div (`#plain-div`, genuinely no affordance) |
| body-structural | 1 | ONE body click-away card (paired mousedown member) — previously invisible (pre-S4) |
| evidence-consequential | 3 | `#responding-div` (flag=true), `#popover-backdrop` dismissal (flag=true, hasEv=true), `#plain-div`… see note |
| dedup-resurrected | **0** | S2 fold verified in real Chrome (twin claimed, members [click,click,mousedown]) |

Honest-residual composition: every Unclassified card in the final census is
either (a) per-key keydown noise from no-focus typing (known, R1-honest, and
the terminal `change` sample preserves the value), (b) the structural BODY
card that S4 deliberately surfaced, or (c) a flagged dismissal/responder card
carrying consequence evidence. **No card in the census is a miscategorized
genuine action that a promotion rule would rescue.**

### Additional pins
- B2 flow regression: 5 recognized / 0 Unclassified, Save folded, IR
  `[fill, click, fill, fill, click]`, zero `select` (B2 parity held).
- M5 self-consistency diff `[]` (D1 check) — the synthetic entry is marked
  and accounted.
- Twin leak fixed end-to-end (reviewer Critical #1 → RCA'd, fixed, unit-pinned
  S2-7 + S3-1 id-format pin, E2E-verified final3).

---

## D1 — promotion relabel (Unclassified → Click / IR inclusion of flagged)

**Recommendation: DO NOT relabel in B3/B4. Keep Unclassified as the label.**

Rationale:
1. The census shows the flagged population is dominated by structural noise
   (keydowns, body click-away) — exactly the population a promotion rule
   would misfire on.
2. The genuinely-actionable cases in the census (`#responding-div`,
   backdrop dismissal) are already visible, honest, and carry
   `actionabilityEvidence` — the panel renders the why-line. A human reading
   the session can promote with evidence in hand; an automatic rule would
   fabricate Click labels for a fraction of the noise population too.
3. Replay risk: promotion → IR CLICK steps against backdrop divs would be
   non-replayable in exactly the way the B2 F4 defect fabricated SELECTs.
   Determinism/honesty principles (X5) require not manufacturing steps from
   unqualified targets.

The flag ships (S5); it is presentation-only. Promotion remains a
human-in-the-loop / later-phase decision with the census as substrate.

## D2 — adapter/bridge IR policy reconciliation

**Recommendation: keep ir-bridge NOISE_TYPES dropping Unclassified (current
bridge behavior) and align `output-adapter.toIRAction` to NOT emit CLICK for
Unclassified.** I.e. resolve the inconsistency toward DROP, not toward EMIT.

Rationale:
1. Dropping preserves replayability guarantees: an Unclassified click has no
   proven locator/definition; emitting a CLICK step would be the same class
   of fabrication as F4.
2. The census shows the Unclassified population that would reach the IR is
   noise-dominated; emitting would add noise steps to generated tests.
3. output-adapter's `unclassified:true` CLICK is a legacy audit surface; the
   B3 panel evidence (flag + why-line) is the honest replacement. The adapter
   change is a small follow-up (B4 scope) if the owner endorses dropping.

**If the owner prefers EMIT (keep clicks with unclassified:true as steps):**
the census gives the expected volume (~3 cards per session in the fixture
flow, noise-dominated) — the owner should weigh replay failure rates before
choosing EMIT.

## Gate

Both decisions sit behind the owner review of this record + the closure
commits. No IR or relabel behavior changes in B3.
