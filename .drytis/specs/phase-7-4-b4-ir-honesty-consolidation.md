# Phase 7.4-B4 — IR Honesty Consolidation: D2 Alignment + Deferred Pins (SPEC)

> ## ⛔ SUPERSEDED — DO NOT IMPLEMENT (2026-08-26, final scope audit)
>
> Superseded by `.drytis/specs/phase-7-4-b4-unclassified-output-policy.md`
> (the canonical B4 spec). Reason: this spec's §S2 ("import the domain enum,
> switch emitted literals to `IRAction.CLICK` … so all mapped types stay
> identical") is **internally contradictory** — the domain enum uses
> lowercase values (`CLICK = 'click'`, src/domain/execution-ir/types.ts:44),
> so an enum import changes every emitted literal, violates this spec's own
> S2-4 byte-equality checkbox and R6, and breaks five live test files that
> assert UPPERCASE adapter literals (g5-spinbutton:270, g7-slider:377,
> g8-color-input:309, o14, output-adapter.test.ts). The canonical spec's
> reduce-only S1-2 replaces it.
>
> Salvaged into the canonical spec: the tap-layer body-blur boundary pin
> (this file's S3-2 → canonical S4-3), and the bridge DROP pin (canonical
> S3). NOT carried over: enum-import S2, the golden-plan unit (redundant
> with the canonical X4 real-Chrome IR diff), and the "W-S1-2/W-S4-2" WARN
> labels (IDs not locatable in the workspace; code anchors are normative in
> the canonical spec).
>
> Retained below, unread, for provenance only.

**Status:** SUPERSEDED — see canonical spec above.
**Branch:** `capability-surgical-removal` (post-`21e6bf8`, B3 SHIPPED @ `96f0eb9`).
**Predecessors:** 7.4-M1, 7.4-B1, 7.4-B2, 7.4-B3 (SHIPPED @ `96f0eb9`/`21e6bf8`).
**Source audits:** D1/D2 read-only grounding audit (2026-08-25, session log —
verified facts below, not assumed from the B3 decision record) + B3 reviewer
round-2 WARN list (deferred pins) + B3 CENSUS-REPORT honest residuals.

---

## §0 Decision requested

Approve 7.4-B4 with three implementation slices + one documentation slice:

| Slice | Name | Nature | Risk |
|---|---|---|---|
| S1 | D2 DROP-alignment of the output adapter | src — dead-path policy fix | zero product behavior change (verified dead code) |
| S2 | Adapter IRAction type reconciliation | src — dead-code hygiene | zero product behavior change (type-level only) |
| S3 | Deferred reviewer pins (S1-2 richness contest, S4-2 blur filter) | tests only — close B3 WARNs | none |
| S4 | Keydown-grouping residual: census delta note + decision record | measurement/docs only — NO behavior change | none |

**Hard scope boundary (same doctrine as B3):** no new claim gates, no
`NOISE_TYPES` change on the live bridge (`ir-bridge.ts` keeps dropping
Unclassified — D2 decides the ADAPTER, not the bridge), no IR plan output
change of any kind (the plan bytes before/after B4 must be identical), no
capture-layer changes, no vocabulary growth, no D1 relabel (audit upgraded
that to a KR-identity migration — out of scope, remains closed).

---

## §1 Verified findings this spec is built on (from the grounding audit)

### F1 — The IR plan has exactly ONE live builder, and it already DROPS

`src/generation/ir-bridge.ts` `build()` is the sole production path to
`ExecutionIRPlan` (called from `service-worker.ts:633` and `:747`).
`NOISE_TYPES = {Scroll, Unclassified}` (line 90) drops every Unclassified
interaction at line 601. Corroborated by every B3 E2E dump: census flow
produces Unclassified click cards, IR plans contain zero stray CLICK steps.

### F2 — The adapter's EMIT path is DEAD code, and broken if revived

`src/presentation/output-adapter.ts`:
- `toIRAction`/`toIRActions` have **zero production callers** — the service
  worker imports only `filterProductionInteractions` from the module
  (service-worker.ts:37–40). Only tests exercise the EMIT path.
- Its local `IRAction` interface (lines 122–152) is a **string-union that
  has drifted** from the domain enum `src/domain/execution-ir/types.ts`:
  the adapter's `'RIGHT_CLICK'` does not exist in the domain enum, and the
  adapter omits `VERIFY`/`WAIT_FOR_ELEMENT`/`DRAG_DROP`/`KEYBOARD_SHORTCUT`.
- The Playwright action renderer (`src/adapters/playwright/action-renderer.ts`)
  has **no case for a right-click action**: if an adapter-emitted
  RIGHT_CLICK ever reached code generation, the renderer throws
  `Unsupported IRAction` (default case, line ~107). So the EMIT branch is
  not just inconsistent — it is a latent crash path.

### F3 — The live Unclassified consumer chain is panel + understanding, not IR

`filterProductionInteractions` passes Unclassified (capture-guarantee v2,
output-adapter.ts:96–105) → `LIVE_INTERACTIONS` storage → sidepanel cards,
evidence badges, `actionabilityEvidence` flag (B3 S5) → understanding
pipeline (`service-worker.ts:586` passes `productionInteractions`) → episode
builder (anchors on any discrete trigger, type-agnostic) → KR rows with
`actionType='Unclassified'` hashed into `signatureKey`. None of these
consumers read the adapter's IR mapping. **Changing `toIRAction`'s
Unclassified case cannot affect any of them.**

### F4 — D1 relabel is a KR-identity migration, not a presentation change

`behavior-knowledge-mapper.ts` `signatureKey = appId|actionType|normalizedTarget|anchorViewId`
(frozen at v1, B3-pinned). Relabeling Unclassified→Click would fork the
signature population mid-stream and implicitly drag D2-EMIT into the live
bridge (bridge drops Unclassified but emits Click). D1 stays CLOSED; this
spec only records that constraint.

### F5 — Flag precision in the census was 3/3 with zero false positives

Every `flag=true` card in b3-full-final3 (plain-div-with-listener,
responding-div, backdrop dismissal) had a genuine DOM consequence; all 12
`flag=false` cards had none. The substrate is honest — but precision on one
fixture does not prove replay safety, which is the actual D1 gate. No D1
behavior change ships in B4.

### F6 — The B3 deferred WARNs are real but small

- **W-S1-2**: the S1 richness-contest test never actually contests — the
  pending map is keyed by `sourceEventId`, so one card can see at most one
  pending candidate per member eventId; a genuine contest requires trigger +
  member candidates on the SAME card (drainPendingEvidence collects both,
  sw-integration.ts:833–862). The test currently pins the single-candidate
  path only.
- **W-S4-2**: B3's S4 (BODY/HTML capture) has no dedicated unit pin for the
  tap-layer focus/blur filter behavior adjacent to body clicks (event-tap.ts
  299–311: focus/click/mousedown capture valueBefore; blur captures
  valueAfter). The B3 change relied on mirror-pin flips in
  resolve-target tests + E2E C2.

### F7 — Keydown cards are the census's largest residual class (9 of 14)

No-focus typing mints 9 per-key `keydown` Unclassified cards alongside the
single S3 synthetic `change` card (R1-honest, each surfaces per M5). This is
noise the panel shows today. Grouping them is a **behavior change** (capture
contract: DISCRETE_ACTION_TYPES stores every keydown; projection mints one
card per entry) — NOT in B4 scope. B4 records the residual and its options;
a future slice decides.

---

## §2 Design

### S1 — D2 DROP-alignment (`src/presentation/output-adapter.ts`)

Change `toIRAction`'s `Unclassified` case from "physical click/mousedown →
CLICK with `unclassified:true`; contextmenu → RIGHT_CLICK" to
**`return null`** for ALL physical types — same contract as keydown today
("preserved in interactions, not replayable").

Rationale (audit-conclusive): the emit side is dead, broken-if-revived
(F2), and inconsistent with the one live builder (F1). Aligning to DROP
makes dead code consistent dead code. The interaction is STILL preserved in
`LIVE_INTERACTIONS` (filterProductionInteractions untouched) — capture
guarantee intact; only the (dead) IR mapping stops claiming replayability
it never had.

Implementation notes:
- Keep the case's explanatory comment; rewrite it to state the D2 decision
  (owner-approved 2026-08-25 decision record + this spec) and why DROP won
  (replay requires proven locators; unqualified targets fabricate steps —
  the F4/B2 fabrication class).
- `filterProductionInteractions` / `isProductionInteraction` UNTOUCHED
  (Unclassified still passes — capture guarantee).

### S2 — Type reconciliation (`src/presentation/output-adapter.ts`)

Replace the drifted local `IRAction` string-union interface with the domain
enum import: `import { IRAction } from '../domain/execution-ir/types'`.
Delete the local interface. Adjust emitted literals from `'CLICK'` strings
to `IRAction.CLICK` enum members so all mapped types stay identical
(CLICK/FILL/SELECT/TOGGLE/SELECT_DATE/NAVIGATE/HOVER/WAIT).

With S1 landed, `RIGHT_CLICK` disappears entirely (the only emitter). The
local type's other drift (missing VERIFY/WAIT_FOR_ELEMENT/DRAG_DROP/
KEYBOARD_SHORTCUT) becomes moot — the enum is the single source of truth.
`toIRAction`'s return type stays `IRAction | null`; the domain enum's
`DRAG_DROP`/`KEYBOARD_SHORTCUT` members are simply never emitted by the
adapter (same as today).

### S3 — Deferred unit pins (tests only)

- **S3-1 (closes W-S1-2):** a genuine two-candidate richness contest —
  construct a projected Unclassified card whose trigger eventId AND a
  memberEvent eventId both have pending evidence entries, with unequal
  richness (e.g. 1 domChange vs 3 domChanges). Assert the richer attaches
  and BOTH drained keys are removed from `cmdrunner_pending_evidence`.
  File: extend `tests/runtime/projection-evidence-join-7-4-b3.test.ts`
  (the S1-2 test gains the member-candidate variant; rename or add
  `S1-2b`).
- **S3-2 (closes W-S4-2):** pin the tap-layer blur boundary adjacent to
  body capture — a blur on a tracked element followed by a click on BODY:
  blur carries `valueAfter` (event-tap.ts:308), the BODY click carries
  `valueBefore` from the body element (not the blurred input), and the
  blur closes the S3 episode minting exactly one synthetic entry. File:
  `tests/tap/body-blur-boundary-7-4-b4.test.ts`.

### S4 — Keydown residual: decision record (docs only)

Append to `.drytis/notes/phase-7-4-b3-d1-d2-decision-record.md` a new
**R-keydown** section recording: the census measurement (9/14 cards =
64% of census flow residuals), why grouping is out of B4 scope (behavior
change to the capture contract; every keydown is a discrete R1 event),
and the two candidate designs for a future slice (a: projection-time
adjacency grouping — collapse same-element consecutive pending keydowns
into one card with a count + the S3 terminal sample; b: tap-layer
suppression of keydowns into the existing TextEntry tracker — risks
losing KeyboardShortcut anchors). NO implementation.

---

## §3 Regression constraints (R1–R12 carry-over + new)

| # | Constraint | Verification |
|---|---|---|
| R1 | Raw capture contract unchanged: DISCRETE_ACTION_TYPES, EventTap listeners, ledger append — untouched | suite |
| R2 | B2 flow E2E parity: 9-step plan shape, zero select | harness 74b2 re-run OR B4 harness b2-flow leg (same fixture) |
| R3 | B3 census composition unchanged: 14 Unclassified = 10 gate-rejected + 1 body-structural + 3 evidence-consequential, dedup-resurrected 0 | harness 74b3 re-run |
| R4 | **IR plan byte-identity**: for a fixed interactions input, `build()` output before/after B4 is IDENTICAL (adapter is not in the path, but pin it) | new unit test: golden plan over B3 final3 censusflow cards → unchanged |
| R5 | `filterProductionInteractions` still passes Unclassified (capture guarantee v2) | existing output-adapter tests + new pin |
| R6 | adapter tests updated: Unclassified click/contextmenu/mousedown → `null` (was CLICK/RIGHT_CLICK/CLICK) | tests/presentation/output-adapter.test.ts |
| R7 | No new vocabulary, no new claim gates, no NOISE_TYPES change | vocabulary-freeze sibling (B4) |
| R8 | KR signatureKey shape untouched; no Unclassified relabel anywhere | grep pin + suite |
| R9 | tsc stays exactly 8 pre-existing errors | CI gate |
| R10 | ZIP four-way identity discipline at closure (root, download/, serve root, served URL) | closure matrix |
| R11 | House regressions: 6E-M2, 6F-M1, 7.4-M1, vocabulary-freeze-7-4-b3 + B4 sibling | suite |
| R12 | No `.env`/secret/hardcoded-URL introduction | infra_verifier |

---

## §4 Acceptance criteria

### S1 — D2 DROP-alignment
- [ ] S1-1 `toIRAction(Unclassified{physicalEventType:'click'})` → `null`
- [ ] S1-2 `toIRAction(Unclassified{physicalEventType:'contextmenu'})` → `null`
- [ ] S1-3 `toIRAction(Unclassified{physicalEventType:'mousedown'})` → `null`
- [ ] S1-4 `toIRAction(Unclassified{physicalEventType:'keydown'})` → `null` (unchanged)
- [ ] S1-5 `toIRActions` pipeline: an interactions list containing an
      Unclassified click produces zero IR actions for it (recognized Click
      still maps)
- [ ] S1-6 `filterProductionInteractions` still returns the Unclassified
      interaction (R5 pin)
- [ ] S1-7 decision provenance comment cites the D1/D2 record + this spec

### S2 — Type reconciliation
- [ ] S2-1 local `IRAction` interface deleted; domain enum imported
- [ ] S2-2 `RIGHT_CLICK` token absent from `src/` (grep pin)
- [ ] S2-3 all adapter-emitted types resolve to enum members; tsc clean
      beyond the 8 pre-existing (R9)
- [ ] S2-4 adapter output for recognized types byte-equal to pre-change
      (golden comparison in tests)

### S3 — Deferred pins
- [ ] S3-1 two-candidate richness contest test green (trigger + member,
      richer wins, both keys drained)
- [ ] S3-2 body-blur boundary test green (blur valueAfter, body click
      valueBefore, one synthetic sample minted)

### S4 — Keydown decision record
- [ ] S4-1 R-keydown section appended with census numbers + both design
      options + explicit out-of-scope statement

### X — cross-cutting
- [ ] X1 full suite green; tsc exactly 8
- [ ] X2 ZIP four-way identity at closure; PROVENANCE updated
- [ ] X3 house regression matrix green
- [ ] X4 reviewer PASS + infra_verifier PASS
- [ ] X5 IR plan byte-identity pin green (R4)
- [ ] X6 two-commit closure (src+tests / docs+evidence), owner-gated

---

## §5 Test plan

| Layer | File | Tests |
|---|---|---|
| Unit — S1/S2 | `tests/presentation/output-adapter-7-4-b4.test.ts` (new) | S1-1..S1-7, S2-1..S2-4 (golden) |
| Unit — S1 retrofit | `tests/presentation/output-adapter.test.ts` (update) | Unclassified cases flipped to null |
| Unit — S3 | `tests/runtime/projection-evidence-join-7-4-b3.test.ts` (extend) | S1-2b contest |
| Unit — S3 | `tests/tap/body-blur-boundary-7-4-b4.test.ts` (new) | S3-2 |
| Unit — R4 | `tests/generation/ir-plan-byte-identity-7-4-b4.test.ts` (new) | golden plan over B3 census cards, pre/post import-parity |
| Doctrine | `tests/doctrine/vocabulary-freeze-7-4-b4.test.ts` (new sibling) | R7: no new vocab; RIGHT_CLICK absence |
| E2E | harness 74b3 re-run (census + b2 flow legs) | R2, R3 |

E2E note: B4 changes no behavior the harness asserts except adapter-dead
paths; the harness re-run exists to pin R2/R3 exactly, and to confirm the
panel/cards/flag rendering is untouched. A dedicated B4 harness is NOT
required; the 74b3 harness's final3 assertions are the contract.

---

## §6 Risks & honest costs

1. **Test-only risk for S1/S2**: if any unknown consumer imported the
   adapter's EMIT path, S1 would change its behavior. Audit found zero
   production importers (grep-pinned in the spec review); the risk is
   bounded to hypothetical dead code.
2. **Golden-plan pin (R4)** uses the B3 final3 census cards as input; it is
   a parity pin, not a semantic oracle — it proves non-regression, not
   correctness.
3. **S3-2 pin scope**: the body-blur boundary test exercises the tap
   filter + S3 episode close; it does NOT re-litigate the S4 tag-set
   change (B3's own pins own that).
4. **Keydown grouping remains open** (F7) — B4 records, never changes.
5. **No ZIP behavior change expected** — build output should be
   byte-stable modulo the packer's known mtime non-determinism
   (documented in B3 PROVENANCE); md5 will differ, sizes may match.

---

## §7 Closure

Two commits, owner-gated (same discipline as B1–B3):
1. `feat(adapters): 7.4-B4 — D2 DROP-alignment + type reconciliation + deferred pins`
   (src/presentation/output-adapter.ts, new/updated tests, doctrine sibling)
2. `docs(spec+evidence+roadmap): 7.4-B4 closure` (this spec checked,
   evidence dir, PROVENANCE with closure ZIP md5, roadmap entry,
   R-keydown decision record)

Success = the adapter agrees with the bridge (one IR policy, DROP), the
type surface has a single source of truth, the B3 WARNs are closed with
real contests, and every byte of live behavior is provably unchanged.
