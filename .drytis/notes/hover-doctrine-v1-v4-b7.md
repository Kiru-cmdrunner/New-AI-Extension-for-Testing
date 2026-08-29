# B7 Hover Doctrine — Documented Limitations (V1–V4 + P4-amendment residuals)

**Scope:** 7.4-B7 'Hover evidence observation', all four phases (P1–P4
shipped 2026-08-28..29). This is the §5.4.3 doctrine-notes deliverable the
spec requires: the honest-limitation ledger for the hover model. Nothing
here is silently "fixed" — every entry is named, pinned where possible,
and carried forward as a known boundary (DC-4: no guessing).

Spec: `.drytis/specs/phase-7-4-b7-hover-evidence-observation.md` (§7
"Honest limitations & trade-offs", §13 amendment log).

---

## V1 — API pillar weak for hover (post-first-click fetches ride T4/unattributed)

The stamped-fetch attribution expires with the stamp; hover fetches that
fire after a prior click's stamp window close land in T4/unattributed.
**Honest floor:** `unattributedConsequences` is surfaced in the panel
(understanding-card coverage rows) — the gap is visible, never hidden.
**Real fix** (stamp-expiry redesign) deliberately deferred; not patched by
a heuristic. The P4 ownership pass does not touch network attribution.

## V2 — Nested hover sequences flatten (accepted)

Products → Laptops → sub-menu travel flattens into ONE observation with a
pointer-path trail; inner triggers are not first-class targets. Accepted
flattening — the alternative (per-trigger nested windows) contradicts the
single-global-accumulator reality (INV-C1) without new capture machinery.

## V3 — Sequential-hover revert misattribution (defect candidate, pinned)

Under settle-supersession, a later hover's enter inside the predecessor's
horizon re-stamps the window; the predecessor's collapse can attribute to
the successor. Pinned by test (`v3-settle-supersession-pin-b7-p3`,
`hover-v3-supersession-pin-b7-p3`) — never heuristically "fixed" (DC-4).

**P4-amendment residuals (same V3 family — named 2026-08-29, not fixed):**
1. **Pure-CSS `:hover` reveals produce no MutationObserver facts.** A
   menu opened purely via CSS `:hover` (no attribute/style mutation the
   observer sees) is invisible to the ownership pass — no surface-visible
   assertion, honest silence. (The canonical fixture reveals via JS
   attribute flip + display change, which IS visible.)
2. **Ambient churn with no click in the interval attributes to the hover**
   (T4 floor). If unrelated DOM churn occurs during a clickless hover
   window, the pass assigns those facts to the hover. Confidence stays
   T4 (0.6, POST_ANCHOR_CAP 0.5) — the weakest tier, never a causal edge.
   **Watch metric (added in P4):** the shared ownership pass's owned-fact
   output per hover session is inspectable in
   `understanding_result.behaviorModel.provenanceLinks` (hover producers)
   and in the IR hover steps' assertions — a rise in hover steps whose
   owned facts have no id-bearing locator (assertion-less ownership) is
   the churn signal. Monitor during P4-era recordings; act only on
   evidence.
3. **Late consequences to a closed window are not delivered** (delivery ≠
   attribution). The ownership pass prevents FALSE attribution but does
   not REDIRECT a late fact to the window that caused it — the click's
   own closed window still misses facts arriving after close. This is the
   F4-stamps prerequisite noted in the capture-model audits; unchanged by
   P4.

## V4 — No negative knowledge (gesture-only hovers stay out of KR by design)

"Hovered, nothing happened" is not learnable: gesture-only hovers
(completed, zero consequence classes) never anchor episodes and never mint
KR signatures. They remain visible in the panel (grouped behind the
toggle-row, suppression reason 'not meaningful', deriving at render time)
— recorded but not modeled. Named trade-off: negative knowledge requires
a durable "provably nothing happened" fact the evidence layer cannot yet
produce (see capture-model exclusion-fact studies).

## V5/V7/V8 (carried, unchanged by B7)

Outcome vocabulary flattening, ambient-churn attribution at T4 confidence,
impoverished intent labels — documented flattenings from the vision
challenge, out of B7 scope.

## Channel A — status after P4

The false-causality defect (hover window inheriting a click's consequences
→ false admission → false KR profile → would-have-been false IR
assertions) is now CLOSED at the IR seam by the ownership-safe
surface-visible derivation: real-Chrome Variants 1 and 2 produce ZERO
hover surface-visible assertions, canonical menu still yields two
(p4-*-dump.json). Remaining Channel A surface: **admission and KR
profiles still read CONTAINED evidence** (deriveConsequenceClasses over
the window's evidence) — the false-KnowledgeRepository entries the B7-P3
audit documented are unchanged by P4 (out of P4 scope; the
kr-hygiene-cq-v12 note documents the population rules). Fact-level causal
stamps (F4) remain the structural fix.

## Doctrine pointers

- DC-4 (no guessing): every V above is named and pinned, never silently
  patched.
- INV-C1 (single accumulator): the root cause the ownership pass
  compensates for, not fixes.
- The pass's module header (`src/shared/surface-fact-ownership.ts`)
  documents the legacy-click conservative-silence decision (over-veto
  beats fabrication).
