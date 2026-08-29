# Architectural RCA — 3 AdaniOne Manual Test Batches (2026-08-21, @ b31d6c2)

**Status:** Canonical RCA documentation for the 3-batch manual test cycle (15 screenshots,
run against ZIP b31d6c2 packed 06:39 UTC). Read-only analysis — no code changed.
**Inputs:** batch 1 (booking-form cards int-6..23), batch 2 (Done/date fills/Search int-23..35),
batch 3 (results-page cards int-37..54 + 13-step IR Plan). Code audit verified at file:line.
Baseline: 220 test files / 4,061 tests green at HEAD.

---

## 1. Capture Architecture — Validation Findings (CONFIRMED LIVE)

The entire capture stack validated on the real site. Each previously-fixed behavior
held under real AdaniOne conditions:

| Capability | Live evidence | Fix validated |
|---|---|---|
| One card per logical click | No twin cards anywhere in 19 interactions | S1' captureSeq-adjacency pairing (68d831e) |
| Icon-only element naming | 'arrow-down icon', 'add icon' (was 'element') | S2 icon-class naming tier (68d831e) |
| Selection-surface recognition | Round Trip = single recognized Click on LI [role=listitem] (was Unclassified ×2 on Aug-20) | S6/LP1 (595d9aa) |
| Post-hoc Unclassified enrichment | Unclassified cards carry componentType/businessMeaning context | LP2/LP3 (d9d4df0) |
| Containment-proof dropdown completion | No displaced 12s window; windows settle ~330–360ms; all consequence-settled | S3' gating (68d831e) |
| Consequence attribution | 4× flightbookingv2 GET 200s land exactly on the Depart-on card | consequence-settling evidence windows |
| Full navigation capture | results-page load: 50 network rows, bookingV URL, DOM re-renders, new surfaces | MV3 durability + page-reload settle |
| Noise honesty | Filter-cluster Unclassified correctly EXCLUDED from IR (13 steps, no garbage) | NOISE_TYPES filter |
| Dialog ancestor enrichment | Dialog tags on modal-internal clicks (RC6, by design) | dialog attribution |
| Locator quality where identity exists | #onward/#return IDs, accessibleName for Done/Search/Round Trip | identity tiers + locator ranking |

**Conclusion:** capture, ledger, projection, window semantics, and attribution are
production-grade on the target site class. No capture-layer work is required from this
test cycle.

---

## 2. Remaining Gaps — Concentrated in the Derivation Layer

The IR Plan is the systemic evidence: correct 13-step skeleton, but **0 assertions**,
**positional nth-of-type locators** for every icon/custom-DIV step, **fill values that
contradict observed finals**, and the **entire results page absent** from the IR.
Four verified root-cause clusters:

- **C1 (O8) — Selector-first observation.** Assertion derivation consumes only
  WirePageContentSnapshot from DEFAULT_SEMANTIC_SELECTORS (page-content-config.ts:16-165).
  The clone passes because it stamps matching attribute values (data-auto-id="cart-count").
  Real-site conventions (widget-named data-auto-id, no data-count on counters, aria-label
  cells, #id-only inputs) match none of the 13 selector groups → snapshot empty → every
  downstream gate starves → 0 assertions.
- **C2 (O9) — Identity vocabulary too narrow.** ElementIdentity has NO data-auto-id
  field; locator ranking (locator-ranking.ts:228) reads 11 candidates, className not among
  them; icon tier is display-only. Icon <i>/classless DIV targets fall to
  identity-extractor.ts:228 structural nth-of-type walk (conf 0.40).
- **C3 (O10) — Definition vocabulary e-comm/MUI-shaped.** DATEPICKER_CELL_CLASS_RE
  (oxd/flatpickr) doesn't match aria-label cells; DATE_CELL_NAME_RE (patterns.ts:369)
  MATCHES them but is wired only as Dropdown exclusion, never DatePicker detection. No
  time/duration filter definition exists; flight cards fail isInteractiveElement;
  DROPDOWN_TRIGGER_CLASS_RE (pri 20) pre-empts RadioButton (pri 40) on cabin|economy
  classes. Results-page interactions → Unclassified → filtered → flight selection
  unrepresentable in IR.
- **C4 (O5) — Single-sample fill semantics.** text-entry.ts:48-67: blur-time value
  unconditionally overwrites typed sample; IR fill = committed value ("Sat, 05 Sep") while
  title/typed intent was "Sat, 22 Aug". Latent today (no assertions), guaranteed replay
  divergence once C1 lands value assertions.

Secondary register (display/lifecycle): O1 semantic-class naming ('element' on
counter-button), O2/O6 no-op attr rows + cumulative re-drain (INV-C1 trade-off, RC5
known), O7 duplicate role=alert surfaces, O11 orphan mousedown on nested-target press,
O12 sw-recovered-form-submit orphans (RC7 known), O13 pending-evidence placeholder on
projected Unclassified (rendering symptom), O14 nav card named by site title, O4 counter
diff ambiguity.

---

## 3. Headline Findings O5 / O8 / O9 / O10 (detail)

**O5 — Fill value ≠ observed final (High, replay correctness).**
IR steps 10/11 fill "Sat, 22 Aug"/"Sun, 06 Sep"; observed finals Sat 05 Sep/Tue 27 Oct.
Root: no typed-vs-committed distinction in text-entry.ts; blur sample wins; ir-bridge
extractInputValue uses metadata.textValue. Fix layer: Recorder (definitions) — record
both samples; IR fill = typed; committed-value assertion derives from Application
Knowledge.

**O8 — Zero assertions on real site (High, test value).**
13/13 steps show "none — not derived for this recording" vs 13 assertions on the clone.
Root: C1 — page-content observation is selector-driven; #id-only elements are
structurally unobservable; real-site attributes match no selector group. Exactly
clone-audit defect #2, now confirmed end-to-end live. Fix layer: Application Knowledge
(understanding/page-content) — seed observation from the DOM observer's changed-element
set + element repository (D3 healFromRecording table) rather than selector scanning alone.

**O9 — Positional CSS IR locators (High, durability).**
Steps 3,5,6,7,8 targets are `div:nth-of-type(1) > … > i` chains. Root: C2 — no
data-auto-id capture; className/icon-class not locator candidates; structural walk is
the only survivor. Fix layer: Recorder (identity capture) + Generation (ranking tier).

**O10 — Results page absent from IR (High, coverage).**
All results-page interactions Unclassified (date cells, Premium Economy, 02h 30m,
-17:20, flight pick) → filtered by design → recorded workflow cannot book a flight.
Root: C3 — no definitions recognize aria-first custom widgets. Fix layer: Recorder
(definitions), constrained by S3' no-fabrication doctrine.

---

## 4. Responsibility Split — Recorder vs Application Knowledge vs Generation

| Layer | Owns | Items |
|---|---|---|
| **Recorder (L0 EventTap / L2 definitions / projection)** | What gets captured & classified | O9a data-auto-id in ElementIdentity; O10 widget definitions (date-cell name-shape DatePicker, filter chips, flight cards); O5 typed-vs-committed sampling; O11 containment-based pairing fallback; O1/O7/O13/O14 cosmetic batch; O2 render-time no-op filter (minimum) |
| **Application Knowledge (Understanding)** | What the app is known to contain/do | O8 in full — observation seeding from DOM-observer changed set + element repo; committed-value assertion derivation; entity/counter/collection discovery independent of site selector conventions |
| **Generation (IR bridge / locator ranking / codegen)** | How tests target & assert | O9b — data-auto-id locator tier, class-based icon locator candidate; assertion→IR join (already wired, ir-bridge.ts:406); fill-assertion pairing from 6C |
| **By-design / accept** | Documented trade-offs | O6/O2 re-drain repetition (INV-C1/RC5), O12 RC7 orphans, O4 display ambiguity |

---

## 5. Phase 6 Recommendation — "Real-Site Derivation Quality"

Priority order (value × dependency):
1. **6A Assertion coverage** (C1/O8) — real-site recordings must derive assertions.
   Gate: AdaniOne-realistic clone attributes. Highest test-value gap.
2. **6B Locator durability** (C2/O9) — data-auto-id capture + ranking tier; eliminates
   nth-of-type fallbacks; makes icon steps replayable.
3. **6C Fill semantics** (C4/O5) — dual samples; IR fill = typed; committed assertions
   follow. Land with 6A.
4. **6D Widget recognition** (C3/O10) — DATE_CELL_NAME_RE as positive DatePicker
   detection; filter/flight-card definitions; MUST preserve S3' gating (no fabricated
   completions).
5. **6E Clone fidelity upgrade** — clone must mirror real-site attribute reality
   (aria-label cells, no data-count, widget-named data-auto-id) or gates keep passing
   while the product fails on the real site. Process-level fix; precedes 5b for the same
   reason G2 gated it.
6. **6F Display hygiene batch** — O1/O2/O7/O13/O14.

**Guardrails:** no timing rules (S1/S3 rejected doctrine — O11 fix must be
containment/sequence-based); no S3' loosening; no keyword-dictionary or System-B
capability-vocabulary revival (Understanding Pipeline CP1–CP8/Phase 1–5a is the
successor); don't derive assertions from raw re-drain evidence (inherits O6 duplication).
**Re-prioritization note:** previous queue was Phase 5b → KL-1 → housekeeping; this RCA
inserts Phase 6 (specifically 6E+6A) BEFORE 5b — the clone-fidelity blindspot is a
process defect that would equally mislead 5b's response-body work.
**Validation constraints:** live AdaniOne Akamai-blocked from egress — evidence loop
remains clone + ZIP E2E harness + user screenshots.
---

## 6. Post-6D.0 Roadmap Update (2026-08-21, 6D.0 validated-uncommitted)

6D.0 (semantic surface vocabulary normalization; extractSemanticRoles + popup token +
4 dead-branch revivals) landed after this RCA. Impact on the Phase 6 plan:

### Scope deltas
- **int-47-class dialog-contained options (Premium Economy): SOLVED** by 6D.0 —
  promoted Unclassified → Click, int47-probe 8/8, selectedValue derived.
- **6D.1 DatePicker: scope REDUCED.** lifecycleOwnsTarget for role=grid calendars
  was dead plumbing, now reachable + pinned (phase-6d0 test L309-321). Remaining
  6D.1 work: positive DATE_CELL_NAME_RE detection wiring, calendar naming/locator
  tier, and the generic-container-vocabulary decision (calendar containers are
  likely NOT dialog-classed on AdaniOne — batch-3 calendar cards carried no Dialog
  tag — so cells are expected still Unclassified; confirm via probe P1).
- **6D.2 filters/custom controls: UNCHANGED for the filter bar** (chips sit outside
  any surface — ancestry cannot help; needs real definitions). **REDUCED for ARIA
  custom dropdowns**: S3' containment proof (b) is now role-format-aware, and
  *-popup classes (traveler-popup) now match the class vocabulary (PaxAndClass 17/17).
- **Unaffected:** O8 assertions (6A), O9 icon/DIV locators (6B), O5 fill semantics
  (6C), O12 RC7 orphans (by constraint), O13 placeholder (6F), O6 re-drain (accepted).

### Priority order — unchanged, one cost note, one alternative
6A → 6B → 6C → 6D.1 → 6D.2 → 6E → 6F (6E+6A still precede Phase 5b).
6D.1 is now materially cheaper (plumbing done). ALTERNATIVE: promote 6D.1 ahead of
6C if the next product goal is the "book-a-flight" E2E (O10: results page absent
from IR) — 6A/6B/6C improve existing IR steps but add no results-page steps.

### New entry probes (before 6D.1/6D.2 sizing; no product code)
- P1 calendar/filter-bar SURFACE CENSUS (clone + batch-3 screenshots): which
  results widgets sit under recognized surfaces vs. none.
- P2 role=grid results-container breadth probe: do flight-card clicks now promote
  to bare Clicks (LP1 breadth measurement)?
- P3 popup-class NEGATIVE probe: non-modal popup-banner/nav containers must NOT
  over-promote (unanchored substring match is bounded — plain Click, no fabricated
  semantics — but the bound is unmeasured on real sites).

### New risks / validation areas
- R1 LP1 promotion breadth on unmeasured real-site containers (bounded, honest).
- R2 'popup' substring breadth in class matching (same anchoring family as
  pre-existing tokens; no ReDoS — reviewer-verified linear).
- R3 Hover overlay-role dwell branch newly live — real sites may surface more
  meaningful Hover cards (existing fixtures all green).
- R4 6D.0 must be committed before any Phase 6 work stacks on it.
- Known-benign: clone-audit legacy harness 1 FAIL = counter-evolution heuristic,
  pre-existing at clean b31d6c2 (baseline-gate.log); canonical 30-check gate 29/0.

### Validation matrix additions
P1–P3 probes + next user manual screenshot loop should census LP1 promotions on
the real results page (live site Akamai-blocked; user remains the live evidence loop).

---

## 7. Execution-Order Decision (2026-08-21, pre-commit of 6D.0)

Decision: COMMIT 6D.0 → run P1–P3 probes → then 6D.1 FIRST (swapped ahead of 6A),
shipped with its minimal 6E-slice → 6A → 6B → 6C → 6D.2 remainder → 6E full → 6F.

Probes are not an alternative to 6D.1-first — they are the common prerequisite:
P1 census sizes 6D.1 and reveals whether the clone can validate it (6E-slice need);
P2 measures locator strength of results widgets (6B-slice need); P3 bounds R2.

Why 6D.1 ahead of 6A (product impact, not dependency):
1. O10 gates product existence: without results-page recognition there is no
   book-a-flight test at ANY assertion level; coverage is the gating capability.
2. 6A designed after 6D.1 sees the complete element universe (form + results
   widgets) — avoids a known retrofit; assertions for date cells/chips land in
   6A's first pass.
3. 6D.0 made 6D.1 cheap: ownership plumbing live+ pinned; date cells/filter chips
   carry natural locators (aria-label/text) so they are less 6B-dependent than
   form icons (P2 confirms).
4. User evidence loop: next manual run shows results-page cards recognized —
   the visible product delta of batches 1–3.
6A is NOT demoted — "highest test-value gap" stands; it is re-sequenced because
existence precedes verification under the coverage goal. Capability ladder:
after 6D.0 correct form recording; after 6D.1 full-journey skeleton (smoke);
after 6A regression-detecting assertions both halves; after 6B/6C durable replay.

Risks carried by this order: replay flakiness if P2 shows weak locators (→ fold
6B data-auto-id slice into 6D.1); 6D.1 scope growth if P1 census shows widgets
under unrecognized containers (→ re-assess, budget-box); S3' must hold for new
definitions; O11 fix containment/sequence-based only.

---

## 8. Engine-Doctrine Re-Review of the Order (2026-08-21)

Doctrine restated by owner: CmdRunner is an Application Understanding Engine;
AdaniOne is only a validation benchmark. Priorities: (1) accurate semantic capture,
(2) Knowledge Repository quality, (3) capability model creation, (4) future
execution / codegen / AI consumers.

DECISION REVISED: the 6D.1-first swap (§7) was benchmark-flow-optimized
(book-a-flight E2E). Under the engine doctrine it flips back to the original
layered order:

  COMMIT 6D.0 → P1–P3 probes → 6A(+6C) → 6B → 6D.1 → 6D.2 → 6E → 6F

Engine-lens reasoning:
- 6A repairs the ENGINE'S CORE LOOP (state observation → knowledge) generically:
  seeding observation from the DOM observer's changed-element set + element
  repository is selector-independent and benefits every future site. Priority 2.
- 6A is benchmark-validable TODAY without 6D.1: all 13 recognized form steps
  derive zero assertions (O8) — immediate measurable validation surface.
- 6D.1-first would admit results-page steps into knowledge ASSERTIONLESS (thin
  entries) until 6A backfills — the engine wants recognition+behavior together;
  6A-first makes every later definition (6D.1/6D.2) land with full behavior
  knowledge from its first session.
- §7's "6A designs better after 6D.1" argument INVERTS: 6A's mechanism is
  vocabulary-independent; new step types attach via the same generic assertion
  mechanism. No retrofit risk.
- "6D.0 made 6D.1 cheap" still true — cheap ≠ first; it stays a fast follow.
- 6B-capture (data-auto-id identity) before 6D.1 by the same capture-first logic
  (enriched ElementIdentity benefits date cells/chips the moment they classify).

Re-framings required (guardrails):
- 6D.1 = "universal interaction-class coverage: date-selection + filter-selection"
  (generic DatePicker/filter definitions off aria-label/role=grid/text patterns),
  NOT "AdaniOne results page". AdaniOne only validates.
- 6A must stay selector-independent (changed-element seeding), never selector
  widening for one site.
- Book-a-flight E2E is a VALIDATION ARTIFACT of the benchmark, not a build driver.
- Honesty doctrine preserved: unrecognized ≠ lost — evidence ledger keeps results
  pages honest until 6D.1 lands.

Validation expectations (set explicitly): first user manual run after 6A+6C shows
ASSERTION-RICH form cards (answers O8/O5, the two most severe findings);
results-page recognition appears after 6D.1 in a later run. S3'/no-timing
guardrails unchanged; 6D.1 keeps its 6E-slice.

---

## 9. Post-Commit Probe Status (6D.0 committed as 568adfe)

- **6D.0 committed cleanly** — code+test only (5 files, +463/−7), scope-audited
  (0 timing refs, 0 site tokens, 0 ledger/projection/IR paths, 0 dist/.drytis
  refs in the diff). 1 ahead of origin, unpushed per protocol.
- **P3 EXECUTED (10/14)**: the 4 "FAILs" are true R2 findings — any
  *-popup-suffixed non-selection container matches the vocabulary. Correction
  to §6: R2 was understated — `popup` is broader than all pre-existing tokens
  at the suffix position (newsletter-popup__container, adani-popup-banner,
  cookie-popup-wrapper, popup-blocked-notice match now, didn't before).
  Equivalent pre-existing over-matches exist for older tokens (modal-header,
  overlay-toolbar, menu-title) — the family predates 6D.0, the token widened it.
  Verdict: BOUNDED + HONEST (worst case = noisier plain-Click card, no
  fabricated semantics; ledger keeps everything). Not a 6A blocker. Deferred
  to 6D.2/6F as an anchoring batch — re-probe corpus before adopting any
  token-boundary anchoring.
- **P3 REFRAMES 6D.1**: the universe of non-interactive targets needing
  definition is larger than "results widgets" — promo banners/cookie/chat
  surfaces exist on real sites and will over-promote to plain Clicks. Generic
  pattern families remain the 6D.1 core; the census must count these surfaces.
- **P1/P2 CANNOT RUN FROM THIS ENVIRONMENT** — the clone has no results page,
  no role=grid, no filter bar (only role=listbox dropdowns + CSS layout grids),
  and live AdaniOne is Akamai-blocked from datacenter egress. DEFERRED to the
  next user manual run. Exact questions P1/P2 answer from user screenshots:
  1. Do results widgets (calendar container, filter chips, flight cards) sit
     under role=grid / role=dialog / popup-class / popup-suffixed containers?
     (sizing 6D.1 definitions + P3-informed surface census)
  2. Do flight-card clicks now promote to plain Clicks on the results page?
     (LP1 breadth measurement — expected: bounded over-promotion nearby)
  3. Do results-page cards carry no Dialog tag (unrecognized containers)?
     (calendar-container classification expectation)
  4. 6A validation surface at the same time: do form steps derive assertions
     post-6D.0 (expect still ZERO — 6A not implemented; confirms baseline).
- Order stands per §8: P1/P2 via user run → 6A(+6C) → 6B → 6D.1 → 6D.2 → 6E → 6F.

---

## 10. Pre-6A Dependency Check (2026-08-21 12:03, per owner directive)

| Dependency | Status | Notes |
|---|---|---|
| 6D.0 committed | ✅ 568adfe | tree clean, 1 ahead of origin, unpushed per protocol |
| Reviewer verdict | ✅ PASS | 14/14 criteria; 3 doc WARNs resolved by spec annotation |
| P3 finding recorded | ✅ §9 + p3-probe.log | over-match family bounded+honest; NOT changed now |
| popup vocabulary | ✅ frozen | owner: "Do not modify popup vocabulary now" |
| P1/P2 | ✅ scheduled | user-run evidence loop; entry conditions in §9 |
| Engine doctrine | ✅ §8 | knowledge-repo quality over benchmark completion |
| clone-fidelity risk (6E-slice) | ✅ INDEPENDENT of 6A | clone can still validate 6A via data-count counters; upgrade folded into 6D.1 slice, NOT 6A-blocking |
| 6B (ElementIdentity vocab) | ✅ INDEPENDENT of 6A | different mechanism (capture-time identity), different files (identity-extractor.ts) |
| 6C = C4/O5 dual-sample | ✅ ATOMIC with 6A | same observation point; separate phases would duplicate the work twice |
| 6D.1 (defs) | ✅ NOT required | findings re-framed in §9; generic defs benefit from 6A landing first |
| O6 re-drain duplication | ✅ excluded by design | 6A must NOT derive from raw re-drain (guardrail §5) |
| No precondition blocking 6A | ✅ none | all Phase 6 preconditions satisfied |

**GO for 6A+6C implementation.**
