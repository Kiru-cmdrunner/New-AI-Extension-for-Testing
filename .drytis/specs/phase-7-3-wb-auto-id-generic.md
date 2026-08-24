# Phase 7.3 — W-B: Generic QA Auto-ID Recognition (`auto-id` family)

**Status:** SHIPPED 2026-08-24 (owner gate approved) — implementation +
closure evidence at commits 1 (`src` + tests) / 2 (this file + evidence);
see PROVENANCE below.
**Baseline:** 98aa71b (capability-surgical-removal, 2 ahead unpushed)
**Approved scope (owner, 2026-08-24):** both audit decisions — (1) claim breadth
covers BOTH `autoId` and existing `dataAutoId`; (2) `resolveTarget` ancestor lift
included. Owner constraint: **the fix is generic and applies to all kinds of
application** — `auto-id` is an industry-wide QA instrumentation convention, not a
site token (doctrine pin `tests/doctrine/genericity-pin.test.ts` stays green).
**Predecessors:** 6B (153f5c2 → 317c527 — data-prefixed family end-to-end),
6F-M1 (2bff6ed), WARN-4 (5954036), 7.2-M1 (250815c/98aa71b).
**Roadmap source:** user RCA 2026-08-24 ("most clicks unclassified") → W-B
re-approval; evidence `.drytis/notes/evidence/user-batch-2026-08-23-0724/`
sample 3 (`auto-id="data_select_departure_flight"`).

---

## 1. Problem

Real applications instrument their DOM with QA identifiers in **two spellings** of
the same convention:

| Spelling | Example (real, from evidence) | Engine support @ baseline |
|---|---|---|
| `data-auto-id` | `data-auto-id="flight-result"` | ✅ full 6B chain (capture → locator → replay) |
| `auto-id` (bare) | `auto-id="data_select_departure_flight"` | ❌ **nothing reads it** |

Consequences on instrumented pages (any framework, any site):

1. **Unclassified clicks.** A plain `<div auto-id="…">` card carries no tag/role/
   class/tabIndex signal → `click.ts:37` rejects it → the capture renders as
   "Unclassified" even though the app author explicitly marked it as a test
   target. This is the bulk of the user-reported "most clicks unclassified".
2. **Card-interior clicks lose the instrumented ancestor.** Clicking a price/time
   span inside the card resolves to the span (`resolveTarget` Strategy 3 returns
   the raw leaf). The ancestor's QA id never enters the identity at all → no
   durable locator, weaker elementKey, weaker twin absorption.
3. **No durable locator tier.** The IR falls to positional/nth-of-type CSS for
   exactly the elements the app made most identifiable — inverted durability.

This is NOT an AdaniOne fix. `auto-id` (bare) is used across React/Vue/Angular
apps that follow the "semantic attribute without the data- prefix" convention
(non-standard HTML attributes are valid; libraries like Enzyme/custom schemas and
many enterprise design systems emit them). The genericity doctrine applies:
engine change = one industry convention; no site tokens.

## 2. Design principles (carried from doctrine)

- **Attribute-presence facts only.** Claiming a Click because the target bears a
  QA id is a DOM-state fact at event time — no timing rules, no heuristics about
  intent, no site vocabulary. Mirrors the S6/LP1 open-selection-surface gate
  (click.ts:39-52) as the pattern precedent.
- **Family provenance, never conflated.** Bare `auto-id` and `data-auto-id` are
  TWO distinct attribute families in locators. 6B's provenance rule holds: the
  locator must name the exact attribute the app used, so replay finds the same
  element and decoys on the other family can never match.
- **Leaf-first resolution.** When an inner element is itself interactive, the
  leaf wins over the instrumented ancestor — a click on a "Book Now" `<button>`
  inside an instrumented card is a click on the button (composedPath order
  already provides this; we only extend the *matching* selector list).
- **Additive-only.** New optional identity field; existing 18-field identities
  stay type-valid; all pre-7.3 behavior byte-identical unless the element
  actually carries `auto-id` / `data-auto-id`.
- **Honest limits preserved.** Elements with NO QA instrumentation at all (e.g.
  filter-strip furniture with utility classes) remain honestly Unclassified.
  W-B claims only what the app itself instruments.

## 3. Layered design

### L1 — Identity vocabulary (capture)

`src/shared/types.ts` — `ElementIdentity` gains one optional field:

```ts
autoId?: string | null;   // bare auto-id attribute — industry QA convention
```

`src/tap/identity-extractor.ts` `extractIdentity`:
- `autoId: el.getAttribute('auto-id') || null` — empty string normalizes to
  null (honest absence, mirrors the 6B dataAutoId rule).
- **Precedence when both spellings present:** `data-auto-id` wins for `dataAutoId`
  (unchanged), `auto-id` populates `autoId` independently — both fields carry
  their own attribute's value; no conflation. If only one spelling exists, only
  that field is set.

### L2 — Target resolution (ancestor lift)

`INTERACTIVE_SELECTOR` (identity-extractor.ts:486-497) gains `[auto-id]` and
`[data-auto-id]` entries.

Effect: `resolveTarget` Strategies 1/1b now stop at (or walk up to) elements
bearing either spelling. Leaf-first composedPath order guarantees an inner
`<button>`, `[role=button]`, `a[href]`, etc. still wins when it is itself in the
selector list — the lift only fires when the click leaf is a plain
non-interactive descendant (Strategy 3 today) of an instrumented ancestor.

Honest note: Strategy 2 (cursor:pointer / onclick) runs AFTER Strategy 1 in the
current code, so an instrumented ancestor outranks a cursor:pointer sibling
further from the leaf only in path order — acceptable; the instrumented ancestor
is the stronger QA signal.

### L3 — Classification (Click claim gate)

`src/definitions/click.ts` `detectTrigger`: after the `isInteractiveElement`
rejection, alongside the S6/LP1 open-selection-surface gate, a second
attribute-fact gate:

```ts
// W-B: a target bearing a QA auto-id (either spelling) is a deliberate
// test target by the app author's own instrumentation. Attribute-presence
// fact — no timing, no vocabulary. isInteractiveElement stays untouched.
if (event.target.autoId == null && event.target.dataAutoId == null) { …not claimed… }
```

- Claims both `autoId` and `dataAutoId` (owner decision 1).
- `buildResult` metadata unchanged (bestName already prefers accessibleName/
  ariaLabel; instrumented cards usually carry aria-labels or inner text).
- Priority stays 180 (universal fallback shape: higher-priority definitions
  still claim first — DatePicker cells, dropdown options, etc. keep winning).

### L4 — Locators / IR / replay

`src/domain/locator-ranking.ts` `extractCandidatesFromIdentity`:
- `autoId` → BUSINESS candidate `[auto-id="X"]` (LocatorStrategyType.TEST_ID,
  family-tagged; placed after testId/dataCy/dataQa/dataAutoId).
- `elementKey` (patterns.ts:610) chain becomes:
  testId → dataCy → dataQa → stableId → dataAutoId → autoId → name|sel → sel → tag
  (aligns the 6F twin-absorption key with the harvest AC8 order — dataAutoId
  was missing entirely; per 6B's rationale stableId stays AHEAD of the
  auto-id spellings so pre-6B/pre-7.3 keys remain byte-identical).

`src/execution/locator-resolver.ts`, `src/execution/executor-content-script.ts`,
`src/adapters/playwright/locator-renderer.ts` — family regex gains the
prefix-optional bare form:

```
/^\[(?:data-)?(cy|qa|auto-id|test|test-id)=["']([^\]"',()]+)["']\]$/
```

- `[auto-id="X"]` resolves/queries the EXACT bare attribute (no cross-family
  fall-through — a decoy `data-auto-id="X"` must NOT match `[auto-id="X"]`).
- `[data-auto-id="X"]` unchanged.
- Playwright renderer: `[auto-id="X"]` → `page.locator('[auto-id="X"]')`
  (CSS attribute locator — same rationale as 6B: exact attribute, fails loud).
- SAFE_VALUE charset unchanged (no quotes/brackets/commas/parens — no widening).

## 4. Acceptance criteria

- [x] AC1 (L1): `extractIdentity` captures `auto-id` into `autoId`; absent →
      null; `auto-id=""` → null; both spellings present → both fields set
      independently, no conflation.
      → tests/tap/identity-extractor-wb-7-3.test.ts (6/6 green).
- [x] AC2 (L2): `resolveTarget` lifts a click on a plain span inside
      `div[auto-id]` to the div; inner `<button>`/`a[href]`/`[role=button]`
      still win leaf-first; `div[data-auto-id]` ancestor also lifts.
      → tests/tap/identity-extractor-wb-7-3.test.ts (7/7 green); E2E W1/W4.
- [x] AC3 (L3): Click definition claims `div[auto-id="X"]` and
      `div[data-auto-id="X"]` (plain divs, no other interactive signal);
      plain div with NO QA id remains rejected (honest Unclassified preserved).
      → tests/definitions/click-claim-wb-7-3.test.ts (7/7 green); E2E W2/W3.
- [x] AC4 (L4): `autoId` → BUSINESS candidate `[auto-id="X"]`; family-tagged
      order testId → dataCy → dataQa → dataAutoId → autoId; elementKey chain
      per L4 (incl. dataAutoId now).
      → tests/locator-wb-7-3.test.ts (9/9 green).
- [x] AC5 (parity): locator-resolver resolves `[auto-id="X"]` to the bare-attr
      element and NOT to a `data-auto-id="X"` decoy; reverse decoy also fails;
      executor-content-script mirror identical (family-parity test extended);
      Playwright renderer emits `locator('[auto-id="X"]')`.
      → executor-family-parity +5, locator-family-6b W-B block +5, all green.
- [x] AC6 (non-regression): full suite green; tsc stays at the 8-error
      baseline; pre-7.3 identities/locators byte-identical (frozen corpora).
      → 280 files / 4,669 tests green; tsc exactly the 8-error baseline.
- [x] AC7 (doctrine): genericity pin green — `auto-id` documented as industry
      convention, no site tokens added anywhere.
      → doctrine pin green; reviewer grep of the diff: zero site tokens.
- [x] AC8 (E2E): real-Chrome recording on a fixture with bare-`auto-id`
      instrumented card (incl. inner span click) produces: claimed Click card
      (not Unclassified), IR locator `[auto-id="…"]` (not nth-of-type), codegen
      emits `page.locator('[auto-id=…]')`; regression pin: 6E-M2/M1 harness
      still green (no twin-click regression from the wider elementKey).
      → evidence/phase-7-3-wb-e2e-2026-08-24/: run-5.log 12 PASS / 0 FAIL;
        run-6f-regression.log 9 PASS / 0 FAIL. Codegen emission unit-pinned
        + shipped-bundle-inspected (panel exposes no codegen key this build;
        reviewer WARN-1, documented in PROVENANCE).
- [x] AC9 (closure): roadmap entry + evidence PROVENANCE + this spec SHIPPED;
      reviewer + infra_verifier PASS.
      → reviewer 8/9 at review time (AC9 pending closure — resolved here);
        infra_verifier PASS, 0 failures, 5 standing WARNs re-confirmed.

## 5. Test plan (TDD, red-first)

New `tests/tap/identity-extractor-wb-7-3.test.ts` (AC1 + AC2, 13 tests):
autoId capture/absence/empty-string/dual-spelling/JSON-serializability, and
the resolveTarget lift matrix (span-in-card, button-wins, role=button wins,
data-auto-id ancestor, nearest-ancestor, plain-div no-lift) — AC2 folded
into the same file as AC1 because both live in identity-extractor.ts.

New `tests/definitions/click-claim-wb-7-3.test.ts` (AC3): claim via autoId /
dataAutoId / both / neither (rejected), empty-string honesty, plus S6/LP1
gate untouched.

New `tests/locator-wb-7-3.test.ts` (AC4): candidate emission + frozen
pre-7.3 corpus byte-identity + elementKey chain (incl. dataAutoId-before-
autoId and the dataAutoId omission fix).

Extend family parity → `tests/execution/executor-family-parity.test.ts`
gains bare-attr cases (AC5): exact-attribute resolve, decoy isolation both
directions, safe-charset probe, extractElementIdentity autoId. Renderer +
resolver W-B cases live in `tests/locator-family-6b.test.ts` (new "7.3 W-B"
describe block, 5 tests) rather than a separate renderer.test.ts case —
same coverage, colocated with the 6B family contract it extends.

E2E: new fixture `public/auto-id-generic-validation.html` — instrumented card
with inner price span (bare `auto-id`), a sibling card with `data-auto-id`,
an un-instrumented plain div (honest Unclassified), a real inner `<button>`
(leaf wins). Harness `.drytis/notes/evidence/phase-7-3-wb-e2e-2026-08-24/`
(harness-73wb.mjs, W1-W7; codegen emission is unit-pinned + shipped-bundle
inspected — see WARN-1 in the review record; the browser-run check asserts
the IR locator value, which the renderer maps deterministically).

## 6. Out of scope (recorded)

- F4-L "Unknown element" mid-recovery identity loss — stays parked no-repro.
- Chips/furniture with no QA instrumentation — honest Unclassified by design.
- Learning per-app attribute names beyond the two standard spellings —
  belongs to Application Knowledge (future KR surface), not engine.
- No engine/IR schema changes beyond the additive optional field.
