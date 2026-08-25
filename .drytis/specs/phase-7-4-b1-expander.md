# Phase 7.4 — B1: Expander Definition (`aria-expanded` → typed interaction)

**Status:** SHIPPED 2026-08-25 (owner approved; two-commit closure; evidence at
`.drytis/notes/evidence/phase-7-4-b1-e2e-2026-08-25/PROVENANCE.md`).
**Baseline:** `cf18d34` (capability-surgical-removal; published to origin + GitHub mirror).
**Owner framing:** 7.4-B "Semantic Control Understanding", first slice — turn the
already-captured, already-attributed `aria-expanded` signal into a typed interaction.
**Predecessors:** 7.4-M1 affordance capture (`2cd31d1`/`cf18d34`) — Expander COMPOSES with
the affordance gate (pointer-styled divs with `aria-expanded` become Expander, not Click).
**Evidence base:** 7.4-B grounded audit 2026-08-25 (classification-audit + type-ripple audit,
both read-only @ `cf18d34`, all claims file:line cited) + historical observations
(`m1-realworld-test-findings.md:16` accordion `aria-expanded null→true`;
`vivo-visibility-rca-2026-08-19.md:8,15`; unit-pinned state chain since 6D.1).

---

## 1. Problem

An expander/collapse trigger (accordion header, "More filters", "View details", disclosure
button) is the canonical generic control that says WHAT it is via a platform state attribute:
`aria-expanded`. The engine captures the attribute at event time
(`dom-context-extractor.ts:28` → `DomContext.ariaExpanded`), brackets its flip in the
evidence window with capture-phase before-snapshots, attributes the flip to the click by
deterministic eventId membership, emits `control-state-change{expanded}` (conf 0.9), writes
the state row and entity attribute, and carries it on `InteractionContract.expanded`
(`interaction-contract.ts:48-52`).

**Classification never reads it.** Verified: zero `detectTrigger` reads; `[aria-expanded]`
absent from `INTERACTIVE_SELECTOR`; `isInteractiveElement` checks only tags/roles/tabIndex/
class tokens. Consequence, per the audit's five generic shapes @ `cf18d34`:

| Shape | Today |
|---|---|
| `<button aria-expanded>` | `Click` — attribute plays no role |
| `<div aria-expanded>` + cursor:pointer | `Click` (7.4-M1 gate) |
| bare `<div aria-expanded>`, no affordance | **Unclassified** (captured, unclaimed) |
| `<span aria-expanded>` inside `<button>` | `Click` on the button (child-held attr invisible) |
| `role="button" aria-expanded` | `Click` |

The semantic that the app author declared is discarded at the classification boundary while
every layer below already understands it. This is NOT a site fix — `aria-expanded` is the
W3C/ARIA disclosure convention; zero site vocabulary.

## 2. Design principles (carried from doctrine + audit decisions)

- **State-attribute claim, not heuristic.** `DomContext.ariaExpanded !== null` at event time
  is an attribute-presence fact (same family as W-B auto-id and 7.4-M1 computed facts): the
  author declared this control an expander. No timing, no statistics, no class tokens.
- **Click-shaped completion.** The flip is only knowable POST-event (the evidence window
  owns direction). The definition completes immediately; direction semantics stay where they
  already live — card metadata, the `control-state-change{expanded}` signal, the state row,
  and `InteractionContract.expanded`. No lifecycle, no `handleEvent`.
- **Replay-correctness fixes the IR mapping: `Expander → IRAction.CLICK`.** Fact-checked:
  `IRAction.TOGGLE` is checkbox-specific in BOTH executors (`executeToggle` sets
  `HTMLInputElement.checked` — a no-op on div/button triggers; `executor-content-script.ts:387-399`,
  `action-executor.ts:165+`). A human replays an expander by clicking it; the app's own
  handler flips the state. CLICK therefore has exact replay parity and requires ZERO
  executor/adapter changes. Direction is recorded, not replayed.
- **KR signature fragmentation is EXPECTED and acknowledged.** `signatureKey` hashes
  `actionType` verbatim (`behavior-knowledge-mapper.ts:62-71`, FROZEN v1) — reclassifying a
  previously-seen control Click→Expander mints a new signature; reinforcement cold-restarts
  for that control; the old Click signature goes stale under demote-not-destroy. This is the
  cost of better typing, accepted; nothing is backfilled or migrated (read-only-KR doctrine).
- **Honesty preserved.** Non-expander interactive elements stay `Click` unchanged; a
  role=tab bearing aria-expanded stays `Tab` (priority 65 wins — desired); child-held
  aria-expanded (span-in-button) stays invisible (documented limit, unchanged).

## 3. Layered design

### L1 — Type union (`src/shared/component-types.ts:210-228`)

Add `'Expander'` to `InteractionType` (one literal; union grows 18→19). The header's AP7
"no existing files change" claim is already false in practice (ir-bridge Record) — the
compile error is the designed ripple gate, not a surprise.

### L2 — Definition (`src/definitions/expander.ts`, new)

```ts
export const expanderDefinition: ComponentDefinition = {
  type: 'Expander',
  priority: 80,            // band 71-179: above Link(70), below Click(180);
                            // scroll/nav definitions in-band trigger on non-click events
  triggerEventTypes: new Set<BrowserEventType>(['click']),

  detectTrigger(event: ObservedEvent): ComponentTrigger | null {
    // aria-expanded presence = the ARIA disclosure convention. The attribute
    // exists on button/div/role=button/pointer-styled targets alike; the
    // flip itself is owned by the evidence window (control-state-change
    // {expanded}), so this definition needs no lifecycle.
    if (event.domContext.ariaExpanded === null) return null;
    return { type: 'Expander' };
  },

  isInScope() { return false; },        // immediate completion, Click-shaped
  handleEvent() { return { endState: 'completed' }; },
  shouldCancelOnOutside() { return false; },

  buildResult(ctx, _completion) {
    return {
      metadata: {
        targetName: bestName(ctx.trigger.accessibleName, ctx.trigger.ariaLabel,
          ctx.trigger.placeholder, ctx.trigger.className),
        targetTag: ctx.trigger.tag,
        targetRole: ctx.trigger.ariaRole,
        clientX: ctx.triggerEvent.clientX,
        clientY: ctx.triggerEvent.clientY,
        // PRE-flip value captured at trigger time; the POST-flip direction
        // lives on the behavioral layer (contract/state row). Diagnostic,
        // never a replay input.
        expandedAtTrigger: ctx.triggerEvent.domContext.ariaExpanded,
      },
    };
  },
};
```

Register in `ALL_DEFINITIONS` (`src/definitions/index.ts`) in priority position
(between Link 70 and Scroll 110).

**Claim semantics note:** `detectTrigger` does NOT consult `isInteractiveElement` — the
attribute presence is itself the interactivity declaration (mirrors role-keyed definitions
like Tab). This means the bare `<div aria-expanded>` shape (today Unclassified) becomes
Expander — the audit's shape (c) — closing that gap without touching the capture layer.

### L3 — IR bridge (`src/generation/ir-bridge.ts`)

- Map: `Expander: IRAction.CLICK` (one row; Record exhaustiveness enforces it).
- `generateDescription` case: `` `Expand or collapse ${name}` `` (else default "Click the {name}").
- **Deliberately NO `extractInputValue` case** — input stays `null`. CLICK ignores input;
  a recorded `expanded` value on the step would tempt future replay to "set" state instead
  of clicking (the TOGGLE landmine). Direction is on metadata/contract, not the IR step.
- NOT added to `NOISE_TYPES` — Expander steps are production steps.

### L4 — Badge map + recovery allowlist + pins

- `src/sidepanel/understanding-badge.ts` `DEFINITION_PRIORITIES` += `Expander: 80`
  (the P4c fs-parse drift pin hard-fails otherwise — update its expected count 16→17).
- `src/understanding/pipeline/understanding-pipeline.ts:585` DDC-3 reload-recovery
  fallback allowlist += `'Expander'` (1 line; closes the silent attribution gap for
  post-reload expanders).
- Count pins updated to new truths: `extended-interactions.test.ts:415` (16→17),
  `component-types.test.ts:128-135` (17→19 — fixing the pre-existing ColorInput staleness
  honestly while touching it), `interaction-card-u1.test.ts` badge list += Expander,
  `ir-bridge.test.ts` mapping case += Expander→click.

### L5 — Panel (optional, tiny)

`TYPE_DISPLAY` entry for `Expander` (label "Expander", distinct color) — else the card
falls back to `❓ Unknown` which the U1 pin forbids for enumerated types. Include in scope.

## 4. TDD plan (red-first)

### Pin file A — `tests/definitions/expander-claim-7-4-b1.test.ts`

- B1-1 `<button aria-expanded="false">` → **Expander** (not Click)
- B1-2 plain `<div class="x" aria-expanded>` → Expander (no affordance needed)
- B1-3 pointer-styled div + aria-expanded → Expander (composes with 7.4-M1; NOT Click)
- B1-4 `role="button" aria-expanded` → Expander
- B1-5 `<button>` WITHOUT aria-expanded → still Click (registry isolation)
- B1-6 div WITHOUT aria-expanded + cursor:pointer → still Click (7.4-M1 unchanged)
- B1-7 `role="tab" aria-expanded` → **Tab** (priority 65 wins — no steal)
- B1-8 SELECT/combobox with aria-expanded → Dropdown (priority 20 wins — no steal)
- B1-9 registry order: definition list sorted ascending, Expander between Link and Scroll
- B1-10 immediate completion: `endState 'completed'`, isInScope false
- B1-11 buildResult metadata: targetName + expandedAtTrigger = pre-flip value
- B1-12 contextmenu does NOT trigger (click-only, unlike Click fallback)

### Pin file B — `tests/ir-bridge-expander-7-4-b1.test.ts`

- B1-13 mapping: Expander interaction → IR action `click` (enum value)
- B1-14 description: "Expand or collapse …"
- B1-15 step input stays `null` (replay parity with hand-written click)
- B1-16 NOISE_TYPES does not contain Expander

### Pin file C — `tests/understanding/expander-signature-7-4-b1.test.ts`

- B1-17 KR fragmentation DOCUMENTED-as-behavior: two otherwise-identical anchors differing
  only in actionType Click vs Expander derive DIFFERENT signatureKeys (frozen v1 hashing);
  assert-and-annotate (this is the expected cost, pinned so a future change notices)
- B1-18 DDC-3 allowlist contains Expander
- B1-19 dedup limit pinned: two Expander interactions, same elementKey, ≤2s → deduped
  (generic rule; rapid same-control double-click collapses to one card — known limit,
  flips >2s apart unaffected)

### Integration + doctrine

- EventTap→runtime integration: real click dispatch on jsdom accordion → Expander card;
  state layer still emits `control-state-change{expanded}` (unchanged path).
- Doctrine genericity pin green (zero site tokens).
- Full suite at grown count; tsc exactly 8.

### Real-Chrome E2E — `public/expander-validation.html` (generic, no test attrs/site tokens)

Accordion with three trigger shapes (button / div+pointer / bare div aria-expanded), each
flipping `aria-expanded` on click + revealing a panel. Assert per trigger:
card type `Expander` (3 cards), state rows `control … (expanded) false → true`,
IR plan steps all `click` with the trigger locators, panel badge renders "Expander",
zero console errors. House regressions: 6E-M2 (8/0 expected), 6F-M1 (9/0), 7.4-M1 (16/0).
Evidence → `.drytis/notes/evidence/phase-7-4-b1-e2e-2026-08-25/` with PROVENANCE
(harness reuses the 74m1 zero-dependency server + node:http probe pattern; documented
Node/ESM and :8190 truths).

## 5. Acceptance criteria

- [x] AC-1 `InteractionType` includes `'Expander'`; union count pins updated (incl. honest
      fix of the pre-existing ColorInput count staleness) — 19-member union pinned
- [x] AC-2 `expander.ts` @ priority 80, click-only, boolean-valued claim gate
      (`ariaExpanded === true || === false`; strict `!== null` over-claimed `undefined`
      in legacy sessions — caught by 6D.1 W3 AC-W3a, pinned B1-12), immediate
      completion (B1-1..12 + B1-12 regression)
- [x] AC-3 Registry isolation: Tab/Dropdown/Click/7.4-M1 behavior byte-identical for
      non-expander targets (B1-5..8 + B1-13 SELECT/combobox no-steal ordering pin
      added at reviewer WARN-1; click-surface-6d1 11/11 green)
- [x] AC-4 IR mapping `Expander → click`; description case; input null; not noise
      (IR pins; E2E IR plan `["click","click","click"]`, zero toggles)
- [x] AC-5 Replay-correctness: no executor/adapter changes; TOGGLE landmine documented in
      spec (fact-checked citations: executor-content-script.ts:387, action-executor.ts:165)
- [x] AC-6 KR signature fragmentation acknowledged + pinned as expected behavior
      (B1-17 upgraded to real divergence assert per reviewer WARN-2; E2E: 3 signatures
      minted)
- [x] AC-7 DDC-3 allowlist includes Expander (B1-18); dedup 2s limit pinned (B1-19)
- [x] AC-8 Badge map + panel TYPE_DISPLAY entry; drift pin count updated (B1 set + U1);
      E2E X4c: panel renders 3 🔽 Expander badges in the stopped view
- [x] AC-9 Genericity: zero site tokens; doctrine pin green (tests/doctrine/genericity-pin.test.ts 2/2)
- [x] AC-10 Full suite green at grown count (286 files / 4,715 tests); tsc = 8; build
      green; ZIP four-way identity md5 51b83f9df70e1db56c8447063b50e779
- [x] AC-11 real-Chrome E2E green 16/0 (3 Expander cards across button/role=button/
      bare-div shapes, state rows ×3, IR clicks, panel badges, zero console errors) +
      house regressions green (6E-M2 8/0, 6F-M1 9/0, 7.4-M1 16/0)
- [x] AC-12 reviewer + infra_verifier PASS (reviewer 4 WARNs all addressed pre-closure)
- [x] AC-13 two-commit closure (src+tests+fixture / spec+evidence+roadmap+handover);
      owner gate; no push
- [x] APPROVED-BY-OWNER gate (tick at closure) — approved 2026-08-25 after owner-gate
      report

## 6. Out of scope (explicit)

- Child-held `aria-expanded` (span-in-button resolution limit — unchanged, documented)
- `<details>/<summary>` special-casing (summary already interactive; decide via E2E
  observation in a later slice if evidence demands)
- Modal / Autocomplete / Tab-by-class / icon-child names / `submit` ledgering /
  dead `aria-value*` fields (queued 7.4-B slices)
- Any executor/adapter/locator change (CLICK mapping deliberately needs none)
- Any KR backfill/migration of old Click signatures (read-only-KR doctrine)
- Changing `signatureKey` v1 or `DROPDOWN_TRIGGER_CLASS_RE` (standing debt untouched)

## 7. Post-ship honest record (2026-08-25)

- **Engine bug found by an OLD pin:** strict `!== null` claim gate over-claimed
  `undefined` (legacy/partial DomContexts). Fixed to boolean-valued; B1-12 pins it.
- **Self-inflicted registry corruption:** a comment edit joined two array lines in
  `src/definitions/index.ts`, dropping `navigationDefinition` → 13 tests failed.
  Caught by the full-suite gate, fixed, re-verified. The registry array is
  load-bearing: never edit it without a same-session full-suite run.
- **Harness truths relearned:** :8190 fixture must run in the same shell as its
  harness; panel-DOM assertions need a post-STOP panel reload. Both recorded in
  the evidence PROVENANCE.
