# Phase 7.4-B4 Spec — Unclassified Output Policy Reconciliation (D2) + Deferred Pins

Status: **DRAFT — owner-review gate. Do not implement until approved.**
Parent roadmap: 7.4 capture honesty arc (B1 expander → B2 typeable combobox →
B3 capture-completeness residuals → **B4 output-policy reconciliation**).
Evidence base: read-only D1/D2 grounding audit (2026-08-26, this session),
B3 E2E dumps (`phase-7-4-b3-e2e-2026-08-25/b3-full-final3/`), B3 closure ZIP
`b702ac44…`.

---

## §1 Context — the validated problem

Two interaction→action converters coexist with **unequal production status**
(audit finding, code-verified):

1. **Live**: `src/generation/ir-bridge.ts` `build()` — the sole producer of
   `ExecutionIRPlan`. `NOISE_TYPES = {Scroll, Unclassified}` (declared line
   90, applied at the step loop line 601) **drops every Unclassified
   interaction**. Both SW call sites (service-worker.ts:633→650, :747→751)
   feed it `productionInteractions` via dynamic import.
2. **Dead**: `src/presentation/output-adapter.ts` `toIRAction`/`toIRActions`
   — zero production callers (SW imports only `filterProductionInteractions`
   from that module). Its Unclassified branch **emits**:
   physical `click`/`mousedown` → `CLICK {unclassified:true}`, `contextmenu`
   → `RIGHT_CLICK`, else `null`.

The D2 inconsistency (flagged since the deff878 audit) is therefore *latent*:
the shipped product has exactly one Unclassified IR policy — **DROP** — and
every IR plan ever built reflects it. But the dead EMIT path is a live hazard:

- Its local `IRAction` string union (`'RIGHT_CLICK'`, `'CLICK'`, …) has
  **drifted** from the domain enum `src/domain/execution-ir/types.ts`
  (`IRAction.CLICK = 'click'`, lowercase, plus `VERIFY`/`WAIT_FOR_ELEMENT`/
  `DRAG_DROP`/`KEYBOARD_SHORTCUT` the adapter type lacks).
- `RIGHT_CLICK` has **no case** in the Playwright `action-renderer.ts` —
  its `default:` **throws** `Unsupported IRAction`. Wiring the adapter into
  production as-is would crash code generation on the first contextmenu.
- Exactly ONE test suite pins the EMIT behavior as correct:
  `tests/runtime/capture-guarantee-v2.test.ts` GROUP 4 (tests at lines
  587/640/687/735: click→CLICK and contextmenu→RIGHT_CLICK assert EMIT;
  keydown already asserts null; the fourth pins the capture-guarantee
  filter and stays). `tests/presentation/
  output-adapter.test.ts` contains ZERO Unclassified pins today — a
  coverage GAP, not an EMIT pin (B4 adds the null pins there).

**Tree-shaking fact (verified during spec self-review):** the shipped SW
bundle contains ZERO EMIT-path markers — no `RIGHT_CLICK` literal, no
`unclassified:!0` property, no `physicalEventType === "contextmenu"`
comparison in `assets/service-worker-inline.js`. The SW imports only
`filterProductionInteractions`; esbuild tree-shakes `toIRAction` out. So
B4-S1/S2 change **no shipped bytes** and no plan ever produced could have
contained an unclassified CLICK — the shipped artifact already agrees with
DROP. (R1's byte-identity pin is therefore expected to hold trivially;
X3 must still verify and record it, not assume it.)

**Decision input (owner, via D1/D2 record + this audit):** resolve toward
DROP. D1 (relabel Unclassified → Click) remains closed — KR `signatureKey`
identity (`appId|actionType|normalizedTarget|anchorViewId`, vocabulary frozen
at v1) treats `'Unclassified'` as a stable actionType; a relabel is a
knowledge-identity migration, not a presentation change.

## §2 Scope

| Slice | What | Why |
|---|---|---|
| **S1** | Align `output-adapter.ts` Unclassified branch to `return null` + de-drift its local IRAction type | Makes the only-in-code EMIT policy disappear; dead code becomes consistent dead code |
| **S2** | Re-pin capture-guarantee-v2 GROUP 4 to DROP + ADD null-pins to output-adapter.test.ts | Tests must encode the decided policy, not the accident; the adapter's own suite currently has zero Unclassified coverage |
| **S3** | Bridge DROP pin — explicit, in the right place | Today NOTHING pins the live bridge's Unclassified drop; an accidental `NOISE_TYPES` edit would silently flip policy |
| **S4** | Deferred reviewer WARN pins: S1-2 richness-contest pin + S4-2 blur-filter pin (from B3 review) | Closure debt |
| **S5** | Keydown-grouping census note + explicit non-goal marker | The 9-per-key keydown residual from B3 needs a written disposition, not a silent omission |

**Out of scope (explicit non-goals):**
- No IR-plan output change: the live bridge behavior is ALREADY drop; S1–S3
  change no bytes of any produced plan.
- No relabel (D1), no KR changes, no new definitions, no claim-gate changes,
  no capture-model changes.
- No removal of `filterProductionInteractions`'s `Unclassified: return true`
  (capture-guarantee v2: every deliberate physical action stays in the panel
  and stored interactions list).
- Keydown-grouping implementation (only the census disposition note, S5).

## §3 Regression constraints (R1–R10, B4-local)

- **R1** IR plans byte-identical before/after: a recorded session's
  `b3-ir-plan.json` must not change. Pin via unit + real-Chrome harness
  diff.
- **R2** `isProductionInteraction(Unclassified)` still `true`; panel cards,
  stored `LIVE_INTERACTIONS`, evidence attachment untouched.
- **R3** `toIRAction` returns `null` for ALL Unclassified physical types
  (click, mousedown, contextmenu, keydown, dragstart).
- **R4** Domain `IRAction` enum untouched; adapter local type references
  only enum-representable members.
- **R5** Bridge `NOISE_TYPES` unchanged in behavior AND now pinned by test.
- **R6** Full suite green; tsc stays exactly the 8 pre-existing errors.
- **R7** House regression matrix green (6E-M2, 6F-M1, 7.4-M1, vocab-freeze
  b3 + b4 sibling if added).
- **R8** Vocabulary freeze: no new InteractionType, no IRAction member, no
  signatureKey change.
- **R9** M5 self-consistency unaffected (projection/ledger untouched).
- **R10** ZIP four-way identity + PROVENANCE discipline (closure md5).

## §4 Acceptance criteria

### S1 — adapter alignment
- [x] S1-1 `toIRAction` Unclassified branch returns `null` for click,
      mousedown, contextmenu, keydown (single structural return; the physical-
      type switch is deleted, not commented out).
- [x] S1-2 The local `IRAction` interface in output-adapter.ts is REDUCED to
      exactly the members it can produce after S1-1 (CLICK, FILL, SELECT,
      TOGGLE, SELECT_DATE, NAVIGATE, HOVER, WAIT) — no `RIGHT_CLICK`, no
      orphans. (Importing the domain enum is NOT viable without a literal
      rewrite — the adapter emits UPPERCASE strings, the enum values are
      lowercase. Reduce-only is the deliberate choice.)
- [x] S1-3 File-header comment documents the D2 decision (DROP policy,
      dead-path alignment, date, pointer to the decision record).
- [x] S1-4 `toIRActions` (filter+map) still typechecks and its behavior for
      Unclassified is `[]` contribution.
- [x] S1-5 Comment-only: `INTERACTION_TO_IR_ACTION.Unclassified` entry in
      ir-bridge.ts is annotated "unreachable — NOISE_TYPES drops
      Unclassified before mapping" (the table's `// fallback` comment is
      misleading). No behavior change.

### S2 — test re-pinning
- [x] S2-1 capture-guarantee-v2 GROUP 4 (4 tests): the TWO EMIT tests
      ("maps Unclassified click to CLICK", "maps Unclassified contextmenu
      to RIGHT_CLICK") now assert `null` with a header note explaining the
      D2 decision + date. The keydown test (already asserts null) gains
      only the note. The fourth test ("Unclassified always passes
      production filter") is PRESERVED UNCHANGED — it pins R2, not EMIT.
      GROUPS 1–3 (capture preservation) untouched.
- [x] S2-2 output-adapter.test.ts: ADD new pins asserting `toIRAction`
      returns `null` for each Unclassified physical type (click, mousedown,
      contextmenu, keydown, dragstart) + `toIRActions` yields zero actions
      for them. (The suite contains ZERO Unclassified references today —
      this is NEW coverage, not an EMIT-pin flip. Five live files
      g5-spinbutton/g7-slider/g8-color-input/o14/output-adapter.test.ts
      assert adapter literals — all UPPERCASE, consistent with the
      reduced local type; unchanged by S1.)
- [x] S2-3 No test anywhere still expects `RIGHT_CLICK`
      (grep-verified — currently exactly 2 refs, both in
      capture-guarantee-v2.test.ts lines 640/684, test at :640 and its
      assertion at :684).

### S3 — bridge DROP pin
- [x] S3-1 New test (tests/generation/ir-bridge-noise-drop-7-4-b4.test.ts):
      build() over an interactions list containing completed Unclassified
      (click), Unclassified (contextmenu), Unclassified (keydown) plus
      normal Click/TextEntry → plan steps carry ZERO `sourceEventId`s
      belonging to Unclassified interactions, and step count equals the
      recognized-only expectation (3 Unclassified in, same plan as with 0).
      (`metadata.unclassified` is an adapter-only marker the bridge never
      sets — asserting its absence pins nothing; `sourceEventId` set-
      membership is the honest black-box assertion.)
- [x] S3-2 Pin that Scroll is likewise dropped (NOISE_TYPES regression
      guard for the whole set). NOISE_TYPES gains an inline comment
      documenting DROP (it is not exported; pin via build()).

### S4 — deferred pins
- [x] S4-1 Richness-contest pin (code-anchored, sw-integration.ts:620–740
      attach/replace/shape-guard block): an attached evidence with
      targetEvidence present is NOT replaced by a higher-score incoming
      evidence with targetEvidence null (shape guard already in code — pin
      it), AND a genuinely richer evidence WITH targetEvidence does replace
      (the contest path, currently untested). [Provenance note: this closes
      a B3-review WARN whose original ID labels are no longer locatable in
      the workspace; the code anchor, not the WARN label, is normative.]
- [x] S4-2 Blur-filter pin — the NEW arms are cross-element cases: (a) blur
      on element B does NOT close element A's open episode (A's own later
      blur still mints exactly one sample), and (b) blur on element B with
      no episode of its own does nothing. (The same-element negative arms —
      lifecycle-exists → zero, blur-without-input → zero — are ALREADY
      pinned by typed-text S3-3/S3-4; do not duplicate them.)
- [x] S4-3 Tap-layer body-blur boundary (absorbed from the superseded
      consolidation spec, grounded at event-tap.ts:299–311): a blur on a
      tracked input captures `valueAfter` from the blurred element; a
      subsequent BODY click captures `valueBefore` from BODY itself (not
      the blurred input); the blur closes any open S3 episode on that
      element minting exactly one synthetic entry. Pins the capture-side
      boundary that B3-S4 shipped with mirror-pin + E2E evidence only.

### S5 — keydown residual disposition
- [x] S5-1 A census note (in CENSUS-REPORT.md appendix or a standalone
      note) records the 9-per-key keydown residual with the explicit
      decision: NOT grouped in B4 — grouping would change card counts,
      M5 accounting, and possibly KR anchor populations; revisit only with
      a dedicated spec if a real site shows keydown noise hurting review.
- [x] S5-2 No code change accompanies S5.

### X — cross-cutting
- [x] X1 Full suite green; tsc exactly 8 pre-existing.
- [x] X2 House matrix green.
- [x] X3 ZIP rebuilt ONLY IF any shipped file changed. Verified during
      spec self-review: `toIRAction` is tree-shaken from the shipped SW
      bundle (zero `RIGHT_CLICK` / `unclassified:!0` /
      `physicalEventType === "contextmenu"` markers in
      assets/service-worker-inline.js) — S1 likely changes ZERO shipped
      bytes. The honest check is: build, then diff the SW bundle and ZIP;
      record whatever the truth is (identical md5 = expected outcome,
      divergent md5 = investigate before shipping, not assume).
- [x] X4 Real-Chrome E2E: harness-74b3 re-run green (14/14) with IR plan
      actions byte-identical to the B3 closure run (R1 evidence).
- [x] X5 Reviewer PASS + infra_verifier PASS.

## §5 Test plan

| Layer | Files |
|---|---|
| Unit — S1 | tests/presentation/output-adapter.test.ts (Unclassified pins → null, local type reflects DROP) |
| Unit — S2 | tests/runtime/capture-guarantee-v2.test.ts (GROUP 4 rewrite: 2 EMIT pins → null, keydown note, filter pin preserved) |
| Unit — S3 | tests/generation/ir-bridge-noise-drop-7-4-b4.test.ts (NEW) |
| Unit — S4 | tests/runtime/evidence-richness-contest-7-4-b4.test.ts (NEW); tests/runtime/typed-text-terminal-sample-7-4-b3.test.ts (extend: cross-element blur arms); tests/tap/body-blur-boundary-7-4-b4.test.ts (NEW: S4-3) |
| E2E | harness-74b3.mjs re-run, IR-plan diff vs closure run |

## §6 Risks

- **The dead path may not be dead forever**: a future feature could wire
  `toIRActions` for an export/API surface. S1-3's header note + S2 pins
  make the DROP policy the documented intent, so that future feature
  triggers a conscious decision instead of silently emitting steps.
- **RIGHT_CLICK removal could hide a real want**: if the product later needs
  right-click replay, it must be authored at the domain enum + renderer +
  bridge as a first-class action (spec'd), not resurrected from this dead
  branch. Recorded here as the migration path.
- Minimal behavioral surface: S1 changes one function's dead branch + types;
  S2/S3/S4 are tests only. Lowest-risk phase in the 7.4 arc.

## §7 Closure discipline (owner-gated)

Two commits on approval: (1) src + tests, (2) spec + evidence + docs. Docs
commit MUST update `ENGINEERING-HANDOVER.md` §Layer 6 (line ~261): the
`toIRActions()` mapping list currently ends in "WAIT, RIGHT_CLICK" — drop
`RIGHT_CLICK` and fix the stale "10 action types" count to the post-B4
truth. The handover is the takeover document; leaving it describing the
deleted EMIT policy as live architecture would defeat the D2 reconciliation.
No publish without owner approval. D1 remains closed with the KR-identity
constraint documented in the decision record.
