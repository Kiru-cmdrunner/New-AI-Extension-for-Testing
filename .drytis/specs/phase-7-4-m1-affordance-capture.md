# Phase 7.4 — M1: Affordance Capture (`pointerCursor` / `clickHandler`)

**Status:** SHIPPED 2026-08-25 — commit `2cd31d1` (src+tests+fixture) + closure docs commit.
Owner approved at the owner gate 2026-08-25 01:44 UTC after all-gates-green report.
**Baseline:** `aca8082` (capability-surgical-removal; 4 commits unpushed — 7.2-M1 + 7.3 W-B;
plus 4 uncommitted handover-doc files deliberately OUTSIDE this milestone's commits).
**Owner framing:** 7.4-A "Interaction Affordance Understanding" — first slice of the owner's
A→E hierarchy toward human-like application understanding (A affordance facts → B control
semantics → C behavioral meaning (already ~80% built) → D capabilities → E KR reinforcement).
**Predecessors:** 6E-M2 (24e1340), 6F-M1 (89ff297), WARN-4 (7f8f680), 7.0-KR (08f615c),
7.1-W1/W2, 7.2-M1 (250815c), 7.3 W-B (731e908).
**Evidence base:** user RCA 2026-08-24 ("most clicks unclassified" — DELBOM / '- 14:20' filter
chips, View Details expanders, price boxes: no role, no tabindex, no QA attribute, bespoke
utility classes matching no vocabulary token) + capability-gap audit 2026-08-24 (three-way
read-only: capture/identity, classification catalog, behavioral→KR) + milestone grounding
audit 2026-08-24 (touchpoint/blast-radius/TDD-feasibility, jsdom probes green).

---

## 1. Problem

Modern applications (Tailwind, CSS-modules, bespoke utility-class systems) express
interactivity in **CSS, not semantics**. The results-page chips and expanders carry:

- no interactive tag (plain `div` / `span`),
- no ARIA role, no `tabindex`,
- no QA-instrumentation attribute (7.3 W-B inert here),
- class tokens that match no `INTERACTIVE_CLASS_RE` vocabulary entry (and never will,
  by construction — bespoke per app).

The engine **detects the right signal and throws it away**: `resolveTarget` Strategy 2
(`src/tap/identity-extractor.ts:542-549`) already reads
`window.getComputedStyle(el).cursor === 'pointer'` and `el.hasAttribute('onclick')`
synchronously at capture time — and uses the facts ONLY to pick the target element. The
facts never reach `DomContext`, so `click.ts` `detectTrigger` re-checks static vocabulary,
finds nothing, and honestly projects the click as **Unclassified**.

Demonstrable inconsistency at baseline: `[onclick]` elements are in `INTERACTIVE_SELECTOR`
(so captured as targets) yet rejected by classification. A `cursor:pointer` element
resolved via Strategy 2 is likewise persisted then rejected.

This is NOT an AdaniOne fix. `cursor:pointer` is the platform's own affordance
declaration and `onclick` is a DOM fact — they apply to all applications. The engine
change is persistence + one claim gate; no site vocabulary (doctrine pin
`tests/doctrine/genericity-pin.test.ts` must stay green).

## 2. Design principles (carried from doctrine)

- **Computed-fact capture, not heuristic classification.** We persist a fact the platform
  already declares (`cursor` computed style / `onclick` attribute) — deterministic, no
  timing, no statistics. Same claim-gate family as S6/LP1 (open surface) and 7.3 W-B
  (QA instrumentation): a signal the app author emitted, read as an attribute/DOM-state
  fact at event time.
- **Optional fields, additive-only.** `DomContext` gains two optional booleans following
  the `ariaValueNow?` precedent ("conditionally set"). Old persisted sessions replay with
  `undefined` → gate inert → honest. All pre-7.4-M1 behavior byte-identical unless the
  element actually declares the affordance.
- **Classification input only — never identity, never locators.** `pointerCursor` /
  `clickHandler` land in `DomContext` only. They must NEVER enter `ElementIdentity` or
  any locator ranking: replay-correctness requires locators to match what capture claims
  for the same element WITHOUT depending on computed style (7.3 landmine rule:
  capture-claim/replay-resolve parity).
- **Honesty preserved.** Non-pointer, non-instrumented, non-roled elements stay honestly
  Unclassified. `isInteractiveElement` is untouched. The gate is scoped to the Click
  definition only (fallback tier) — no other definition reads the new fields.
- **Honest limit on detection shape.** `clickHandler` = the `onclick` ATTRIBUTE presence
  (what Strategy 2 already checks). We deliberately do NOT use the `el.onclick` property
  form (which reflects inline handlers + assignments, differing across serialization
  paths) and CANNOT observe `addEventListener` without CDP (out of scope, honest limit).

## 3. Layered design

### L1 — `DomContext` vocabulary (`src/shared/component-types.ts`)

Inside the `DomContext` interface (after `tabIndex`, before the aria-value block):

```ts
// ── Interaction affordance (7.4-M1) ──
// Computed/DOM facts declaring WHY the resolved target is interactive.
// Captured at event time for the RESOLVED target; classification input only
// (never identity/locators — replay must not depend on computed style).

/** Computed style cursor === 'pointer' on the resolved target. */
pointerCursor?: boolean;
/** The onclick ATTRIBUTE is present on the resolved target. */
clickHandler?: boolean;
```

Optional (`?:`) — old persisted `ComponentInteraction.triggerEvent.domContext` rows replay
with `undefined`; TypeScript strictness does not force consumers to handle them; test
literals (41 files construct `domContext: {`) stay type-valid.

### L2 — Extraction (`src/definitions/dom-context-extractor.ts`)

`extractDomContext(el)` gains, synchronous in the same capture window:

```ts
pointerCursor: window.getComputedStyle(el).cursor === 'pointer',
clickHandler: el.hasAttribute('onclick'),
```

- Guard: both must be truthy booleans (jsdom and old browsers return `''`/undefined from
  getComputedStyle in edge shapes → `=== 'pointer'` yields `false`, never `undefined` —
  the comparison itself normalizes; no try/catch needed for the attribute read).
- Consistency invariant with Strategy 2 (pin it): an element resolved VIA Strategy 2
  always carries its own affordance → `pointerCursor === true` or `clickHandler === true`
  → the new gate claims it. (Strategy 2 checks path elements; extraction reads the
  resolved element. Both facts are computed on the same element → invariant holds.)

### L3 — Claim gate (`src/definitions/click.ts`)

Fourth gate in the existing `detectTrigger` chain (after `isInteractiveElement` failure
and inside the same `if` block that already contains LP1 and W-B):

```ts
// 7.4-M1: affordance gate. A target the app itself declares clickable —
// cursor:pointer computed style (platform affordance declaration) or an
// onclick attribute — is a deliberate click target by DOM/computed-state
// fact at event time. No timing, no site vocabulary, no statistics.
// Scoped to the Click definition — isInteractiveElement untouched.
if (
  !event.domContext.pointerCursor &&
  !event.domContext.clickHandler
) {
  return null;
}
```

Gate order: `isInteractiveElement` → LP1 open-surface → W-B auto-id → **affordance**.
The affordance gate is consulted only when every earlier gate failed, so semantic
elements' behavior is byte-identical. Truthiness (not strict `=== true`) so `undefined`
(old sessions) stays inert.

### L4 — No other layers change

- `identity-extractor.ts`: **untouched** (Strategy 2 already returns the element; we add
  no new resolution behavior).
- `patterns.ts`: **untouched** — no `INTERACTIVE_CLASS_RE` / `INTERACTIVE_SELECTOR` /
  tag/role changes.
- Locators/executor/renderer: **untouched** (L2 doctrine: classification-only input).
- Understanding/KR: read-domContext consumers (`interaction-contract.ts`) use
  null-coalescing on other fields; nothing reads the new fields (spec pins this as the
  intended state for M1; future layers may consume them as facts, never as vocabulary).

## 4. TDD plan (red-first)

### New pin file A — `tests/tap/dom-context-affordance-7-4-m1.test.ts`

Pins on `extractDomContext` against real jsdom DOM (computed-style probes verified green
in the grounding audit — inline style AND stylesheet rules both resolve):

- A1 inline `style="cursor:pointer"` → `pointerCursor === true`
- A2 stylesheet rule `.chip { cursor: pointer; }` → `pointerCursor === true`
- A3 no cursor declaration → `pointerCursor === false`
- A4 `cursor: default` explicitly → `false`
- A5 `onclick` attribute present → `clickHandler === true`
- A6 absent → `false`
- A7 independence: pointer-only, onclick-only, both, neither (2×2 matrix)
- A8 fields optional-shape: object spread/JSON-serializable booleans (never undefined
  when extractor ran; `undefined` only in pre-7.4 persisted rows — pinned via type-level
  cast test)
- A9 extractor runs on the RESOLVED target: EventTap-level integration below proves the
  wiring; unit pin asserts extractor reads the element passed in (trivial, but guards
  against a future refactor silently reading `document.activeElement` etc.)

### New pin file B — `tests/definitions/click-claim-affordance-7-4-m1.test.ts`

Claim matrix reusing the `click-claim-wb-7-3.test.ts` event-builder pattern:

- B1 plain `div` with `pointerCursor: true` → **claims Click**
- B2 plain `div` with `clickHandler: true` → **claims Click**
- B3 plain `div` neither → **null (honest Unclassified — THE honesty pin)**
- B4 plain `div` `pointerCursor: false` explicitly → null (explicit false ≠ absence)
- B5 `pointerCursor: undefined` (pre-7.4 session replay) → null (inert, not claiming)
- B6 semantic `button` with `pointerCursor: false` → still claims (gate 1 wins; affordance
  gate never consulted — byte-identical behavior)
- B7 semantic `button` with `pointerCursor: undefined` → still claims
- B8 W-B auto-id target with `pointerCursor: false/undefined` → still claims (earlier gate)
- B9 LP1 open-surface target with neither affordance field → still claims (earlier gate)
- B10 gate-order pin: affordance-claimed target inside an open surface → claimed via the
  earliest applicable gate; observable equivalence (both yield `{type:'Click'}`); pin
  asserts no double-claim / no behavior change for LP1 positives
- B11 empty-string class/target variants claim nothing new
- B12 contextmenu on pointer-styled div → claims (Click triggers on contextmenu too)

### Integration pin C — `tests/tap/eventtap-affordance-7-4-m1.test.ts`

Through real `EventTap` dispatch (jsdom): dispatch a real `click` on a plain `div.chip`
styled pointer via a `<style>` rule (no semantic markup anywhere):

- C1 `ObservedEvent.domContext.pointerCursor === true` (capture→context wiring end-to-end)
- C2 classification through the runtime: click on chip → `Click` interaction card (not
  Unclassified) — using the projection path or direct `component-runtime` invocation
- C3 the SAME element with cursor removed (class toggled) → Unclassified again (affordance
  is a fact at event time, not an element property — pinned so nobody later "caches" it)
- C4 child-click lift: click on inner `span` of pointer-styled chip → resolves to the
  pointer parent → Click card on the parent identity (the AdaniOne chip shape, generic)

### Doctrine + regression

- D1 genericity pin (existing) stays green: no site tokens introduced
- D2 full suite at grown count; tsc exactly 8 baseline errors
- D3 house regressions: 6E-M2 DatePicker family + 6F-M1 gesture-ownership harnesses
  (real-Chrome)
- D4 ZIP four-way identity (root/download/serve/preview-served), md5 recorded

### Real-Chrome E2E (generic fixture, no site tokens, no test attributes)

`public/affordance-validation.html`:

- cursor:pointer cards via `<style>` rule, plain divs, no roles/attrs — expect classified
  Click cards with locators
- plain non-pointer divs — expect honest Unclassified cards
- child-click (span inside pointer chip) — expect parent Click
- onclick-attribute div — expect Click
- assert ZERO console errors; assert no regression on the clone family
- evidence archived to `.drytis/notes/evidence/phase-7-4-m1-e2e-2026-08-24/`

### Verification gates (full path — major change, classification layer)

Full suite green → tsc = 8 → build + ZIP four-way identical (md5 recorded in evidence) →
reviewer → infra_verifier → real-Chrome E2E → owner gate → two-commit closure
(commit 1 = src + tests + fixture; commit 2 = spec + evidence + roadmap + handover
delta). No push.

## 5. Acceptance criteria

- [x] AC-1  
      ✅ fields at component-types.ts (diff @ 2cd31d1); B5 inertness pin `DomContext.pointerCursor` / `clickHandler` exist as optional booleans; old
      sessions replay with `undefined` → gate inert (B5)
- [x] AC-2  
      ✅ dom-context-extractor.ts (+7 lines); event-tap.ts:240 same-window wiring; C1 `extractDomContext` computes both fields for the resolved target in the same
      synchronous capture window (A1-A9, C1)
- [x] AC-3  
      ✅ click.ts gate @ :67-72; B1-B4 Click claim gate: `pointerCursor || clickHandler` claims; neither/undefined/
      false → null (B1-B5)
- [x] AC-4  
      ✅ B6-B10; reviewer verified nesting order Gate order preserved: isInteractiveElement → LP1 → W-B → affordance; earlier
      gates' positives byte-identical (B6-B10)
- [x] AC-5  
      ✅ B3 unit + E2E V2/V6 (plain + explicit cursor:default → Unclassified) Honesty preserved: plain non-pointer div stays Unclassified (B3, E2E)
- [x] AC-6  
      ✅ diff has zero identity/locator/executor changes; grep clean No identity/locator/executor changes; `pointerCursor` never in `ElementIdentity`
      or locator candidates (diff review + D4 provenance)
- [x] AC-7  
      ✅ doctrine pin green; infra_verifier genericity scan clean Genericity: zero site tokens; doctrine pin green (D1)
- [x] AC-8  
      ✅ 283 files / 4,694 tests; tsc 8; build + ZIP 889b8c4b four-way identical Full suite green at grown count; tsc = 8; build green
- [x] AC-9  
      ✅ E2E 16 PASS / 0 FAIL (run 3); 6E-M2 8/0; 6F-M1 9/0 real-Chrome E2E green (classified pointer cards, honest plain-div Unclassified,
      child-lift, onclick case; zero console errors) + house regressions green
- [x] AC-10  
      ✅ reviewer PASS (red-first reproduced 16-fail/9-pass); infra PASS after serve-mirror sync reviewer + infra_verifier PASS
- [x] AC-11  
      ✅ commit 1 = 2cd31d1; commit 2 = closure docs; no push two-commit closure; owner gate; no push
- [x] APPROVED-BY-OWNER  
      ✅ owner gate 2026-08-25 01:44 UTC ("Approved") gate (tick at closure)

## 6. Out of scope (explicit)

- Any new component definition (Expander/Modal/Autocomplete/Tab-class/Icon-button) — 7.4-B
- `INTERACTIVE_CLASS_RE` / `INTERACTIVE_SELECTOR` / tag/role vocabulary changes
- Identity/locator changes of any kind
- `addEventListener` observability (needs CDP; honest limit)
- `el.onclick` property-form detection
- Filling the dead `aria-value*` `DomContext` fields (queued 7.4-B slice)
- View patterns / intent labels / capability vocabulary (7.4-C/D/E)
- The 4 uncommitted handover-doc files (separate docs commit at owner call)
