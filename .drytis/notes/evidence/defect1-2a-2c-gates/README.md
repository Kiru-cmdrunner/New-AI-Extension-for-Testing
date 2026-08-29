# Defect 1 + 2a + 2c — real-Chrome gate evidence

Two gates, both green on their harness checks.

## adanione-clone/ — Gate 1: **27 PASS / 0 FAIL** (baseline audit: 19/3)
- `gate1e.log` — full harness output (the authoritative run).
- `summary.txt` — PASS/FAIL counters.
- `harness-gate.mjs` — the re-anchored harness (derivation of the audit harness; see in-file comments).
- `ir-plan.json`, `evidence-prestop.json`, `generated-spec.json` — recording/derivation artifacts of the SAME run.
- `execution-result.json` / `assertion-results.json` — **READ CAREFULLY**: `status:"failed", failedSteps:2`
  is the EXPECTED outcome of this run. The two failures are steps 7/8 (qty-plus), the **inter-step
  consequence pacing gap** documented as a NEW, out-of-scope defect in
  `../../../defect1-2a-2c-validation-record.md` (add-meal's server round-trip lands ~500ms AFTER the
  following Cart click, so the qty button never exists; the 10s wait provably ran — durationMs
  10968/11000 — i.e. resolution machinery worked; absence was real). The harness check
  "qty steps exercised the 10s wait (pacing gap documented)" pins exactly this. A clean
  `status:"passed"` here would require fixing the pacing defect, which is out of approved scope.

## a-slice-regression/ — Gate 2: **35 PASS / 0 FAIL** (exact run6 baseline reproduction)
- `gate2.log` — full harness output.
- `harness-gate.mjs` — the unmodified a-slice harness used as-is.

## Known latent behaviors (reviewer WARNs, not fixed — decisions for a later slice)
1. **Failure-latency multiplication.** Production plans always carry `timeoutMs: 30_000`
   (DEFAULT_EXECUTION_PARAMETERS), so a genuinely-absent element now burns up to 10s per
   RESOLVE_LOCATOR send, possibly again after healing and once more in EXECUTE_STEP's inline
   resolve — worst case ~20-30s vs milliseconds pre-change. Bounded by the approved 10s cap;
   healing latency increases as a consequence.
2. **`dedupeEntities` keys on identity VALUE alone** — two different-typed entities sharing a value
   (e.g. an order `data-order-number:"F1"` and a product `data-sku:"F1"` in one snapshot) would
   collapse to one presence assertion.
