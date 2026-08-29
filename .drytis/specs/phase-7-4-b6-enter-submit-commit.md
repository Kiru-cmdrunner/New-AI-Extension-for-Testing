# Phase 7.4-B6 — Enter-Submit Commit: TextEntry Completion Grounded in Application Behavior

**Status:** Implemented (verified in real Chrome 2026-08-26)
**Date:** 2026-08-26
**Spec ID:** `phase-7-4-b6-enter-submit-commit`
**Predecessor:** phase-7-4-b5-modal-interaction (7.4-B5)
**Supersedes:** none

---

## 1. Problem Statement

Real-Chrome verification (2026-08-26, harness `.drytis/zz-enter-submit-verify.mjs`, trusted CDP input) confirmed the field report:

**User types a product name into a search input and presses Enter. The generated test contains only the "Go/Search" click and the navigation — the typed value is missing.**

### Empirical chain (from the recorded ledger + runtime snapshot)

1. Focus on `#q` → TextEntry lifecycle `lc-2` starts (trigger: focus on INPUT).
2. 16× `input` + 17× `keydown` → all absorbed by `lc-2` (disposition `absorbed`, claimedBy `lc-2`).
3. Enter triggers implicit form submission. The browser fires a **trusted synthetic click on the default submit button** (part of the keydown's default action; `isTrusted: true`).
4. That click targets the SUBMIT BUTTON (different element) → `TextEntry.shouldCancelOnOutside` returns `true` (different elementKey) → lifecycle becomes `abandoned`.
5. The native `submit` DOM event never completes it (the definition ignores `submit`).
6. No blur ever fires — focus never leaves the input before unload.
7. At STOP: `filterProductionInteractions` keeps only `endState === 'completed'` → the abandoned TextEntry (holding the full typed value in `ctx.data`) is destroyed — absent from live interactions, understanding input, KR, and IR.
8. The 17 keydowns surface as ~17 Unclassified cards (honest ledger, no semantic owner).

### Doctrine constraint (user directive, binding)

> Do NOT make Enter itself a TextEntry completion trigger. Completion must be grounded in **actual application behavior/evidence** so the system understands **“user entered X and committed/submitted it”**, not merely **“user pressed Enter.”**

Enter is a **cause**, not a commit. The commit proof must be an observable application/platform response.

## 2. Design Principle

**Completion signal = trusted native `submit` DOM event on the form that owns the input.**

- The native `submit` event fires only after form validation passes and submission is actually initiated — the platform's own commitment signal: deterministic, trusted, semantics-bearing.
- `Enter` keydown alone is NOT a trigger. Enter is causally upstream; the commit proof is downstream.
- **Purity boundary:** completion is decided purely from ObservedEvent data (`eventType === 'submit'` + form join), never from live DOM queries at completion time.

## 3. Non-Goals

- No SPA JS-submission capture (fetch/XHR submits) — SPA commit remains blur/STOP-interrupted.
- No timing rules (doctrine).
- No KeyboardShortcut changes (bare Enter correctly does not match).
- No change to the Unclassified drop policy (7.4-B4).
- No KR schema changes, no capability vocabulary, no site-specific fixes.
- No new `ComponentEndState` literal (union is consumed widely; reuse `'completed'`).

## 4. Solution Design

### 4.1 Form Join Key

New pure helper in `src/definitions/patterns.ts`:

```ts
export function formJoinKey(identity: ElementIdentity, domContext: DomContext): string | null
```

- Returns `'form:' + domContext.formElementKey` when `domContext.formElementKey` is a non-empty string; else `null`.
- Pure function of captured data — no text heuristics, no timing, no URLs.

### 4.2 New DomContext fields (captured at event time)

`src/shared/component-types.ts`:

```ts
/** elementKey of the closest ancestor <form> when the resolved target is a form control; null otherwise. */
formElementKey?: string | null;
/** Owner-form action URL at event time; null when absent. */
formAction?: string | null;
/** Owner-form method ('get'/'post'); null when absent. */
formMethod?: string | null;
/** Owner-form DOM id; null when no id or no form. */
formId?: string | null;
```

Filled in `src/definitions/dom-context-extractor.ts` via one bounded `closest('form')` lookup at event time. When a form exists: `formElementKey = elementKey(extractIdentity(form))`, plus action/method/id. Back-compat: absent on legacy events → `formJoinKey` → null → old behavior. Scroll/body events: no form ancestor → null. Inputs outside forms: null.

`isTextEntry` targets inside forms get the join; contenteditable elements with a form ancestor also join (same rule, target-agnostic — the join is on the FORM, not the input kind).

### 4.3 TextEntry definition changes

1. `detectTrigger`: unchanged. At trigger time, `ctx.data.formJoinKey` is cached from the trigger event's DomContext (null when no form).
2. `isInScope`: **extended (B6)** — element-key equality (unchanged) OR a same-form `submit` event (owner-form join equality, both sides non-null). This is the delivery mechanism: the runtime's generic active-stack offer loop consults `isInScope` for every event, so no runtime change was needed (see §4.4).
3. `handleEvent(submit)` (new): when `formJoinKey(event.target, event.domContext) === ctx.data.formJoinKey` and both are non-null → **complete** with `endState: 'completed'`. The latest value already lives in `ctx.data.typedValue`/`textValue`.
   - A submit on a DIFFERENT form (nested-form/edge cases): returns null — not ours.
4. `shouldCancelOnOutside(click)` (amended): a click whose `formJoinKey` equals `ctx.data.formJoinKey` (both non-null) does NOT cancel — it is the commit cause (the browser's synthetic implicit-submission click, or a real user click on the same form's submit control). Different-element clicks outside that form still cancel (unchanged). Same-element clicks never cancelled (unchanged).

**Commit metadata (`buildResult`):** `committedValue` (= committed textValue), `commitSignal: 'submit'`, `formJoinKey`, `formId`/`formAction`/`formMethod` (provenance), and `enterCause: true` only when the last keydown member event before completion was `key === 'Enter'` on the trigger element (display-grade honesty flag; never used for classification or generation).

### 4.4 Runtime changes (delivery mechanism — implemented via definition scope)

Current behavior: `submit` events are never offered to active lifecycles and never enter the ledger (`submit ∉ DISCRETE_ACTION_TYPES`).

**Implemented mechanism (deviation from the original draft, functionally equivalent and verified):** the runtime's existing active-stack offer loop (step 3 of `process()`) calls `isInScope(event, ctx)` for every event type already — so the `submit` event is delivered through that generic machinery by extending `TextEntry.isInScope` to accept same-form submit events (owner-form join equality, both sides non-null). `component-runtime.ts` is UNMODIFIED:

- `handleEvent` completes on the matched submit (normal completion path; NO ledger claim — submit is not a ledger entry).
- A submit event on a different form fails `isInScope` → falls through unhandled: never enters the ledger, never reaches discovery (no definition lists `submit` in `triggerEventTypes`), no Unclassified card. No-op, as required.

The synthetic submit-control click keeps flowing through the normal pipeline → Click fallback → Click interaction (a real, trusted, user-visible action with its own evidence window). Because of §4.3.4 it no longer cancels the TextEntry.

**Ordering fact (verified empirically):** click → submit → (unload). Events reach the SW in that order. The TextEntry therefore completes and is emitted AFTER the Click interaction. IR ordering is fixed in §4.5.

**Twin-click risk:** none new — per-type dedup already suppresses a second Click on the same element; the Enter path produces exactly one click (the synthetic one).

### 4.5 IR ordering restore (`src/generation/ir-bridge.ts`)

New deterministic pass in `build()`, after the noise drop, before step emission: **any FILL step derived from a submit-completed TextEntry is placed immediately before the first subsequent CLICK step whose target is a submit control joined to the same form** (`formJoinKey` equality via interaction metadata). Deterministic from recorded data only — no clocks, no heuristics beyond the captured form join. When no matching CLICK exists (e.g. programmatic submit), the FILL keeps its emitted position.

FILL keeps its fill value source: `typedValue ?? textValue` (6C contract).

### 4.6 STOP flush (unchanged, re-verified)

A TextEntry still active at STOP (typed, never blurred, never submitted) remains `interrupted` → dropped by the production filter → its keydowns mint Unclassified cards. No change in B6.

### 4.7 Metadata contract

```ts
metadata: {
  targetName, textValue, typedValue, userTyped,   // existing
  committedValue: '<the committed value>',         // B6 — submit-completed only
  commitSignal: 'submit',                          // B6 — submit-completed only
  formJoinKey: 'form:id:search-form',              // B6 — present when input is in a form
  formId / formAction / formMethod,                // B6 — provenance, nullable
  enterCause: true,                                // B6 — display-grade, optional
}
```

## 5. Acceptance Criteria

Unit (vitest):
- [x] AC1: `formJoinKey` returns the prefixed key when `formElementKey` present; null when absent/empty/undefined (legacy events).
- [x] AC2: extractor fills `formElementKey`/`formAction`/`formMethod`/`formId` for an input inside a `<form>`; all null for input outside any form; null for body/document targets.
- [x] AC3: TextEntry with typing + same-form `submit` completes (`endState 'completed'`), metadata carries `committedValue`, `commitSignal: 'submit'`, `formJoinKey`; ledger dispositions of the absorbed keydowns become `claimed`.
- [x] AC4: submit on a different form does NOT complete the lifecycle.
- [x] AC5: same-form submit-control click does NOT cancel an active TextEntry; different-form/outside click still cancels (unchanged).
- [x] AC6: `enterCause` true when the last pre-completion keydown was Enter on the trigger; false/absent otherwise.
- [x] AC7: runtime `submit` delivery completes only the same-form active TextEntry; unmatched submits are no-ops (no ledger entry, no Unclassified).
- [x] AC8: ir-bridge emits FILL before the same-form submit-control CLICK; fill value = typedValue; FILL keeps correct position when no submit CLICK follows.
- [x] AC9: mouse-submit flow unchanged: type → click Search (same form) → submit → TextEntry completed via submit with `enterCause` absent; IR order Fill → Click → Navigate.
- [x] AC10: regression — plain blur flow (type → blur, no form) produces the same TextEntry metadata as before (no commit fields).

Integration (real Chrome, harness):
- [x] AC11: type "wireless earbuds" + Enter on a GET form → interactions include TextEntry(completed, committedValue='wireless earbuds', commitSignal='submit'); generated IR steps = FILL q → CLICK Search → NAVIGATE results (order + values); 0 SW console errors.
- [x] AC12: no navigation full-reload loss: Navigation interaction still carries post-nav DOM evidence (existing behavior preserved).

## 6. Test Plan

- Unit: new `tests/definitions/text-entry-enter-submit-7-4-b6.test.ts` (AC1–AC6, AC9, AC10), `tests/runtime/submit-delivery-7-4-b6.test.ts` (AC7), extension of ir-bridge tests (AC8) in `tests/generation/ir-bridge-enter-submit-7-4-b6.test.ts`.
- Existing suites must stay green (4854 baseline).
- E2E: extend `.drytis/zz-enter-submit-verify.mjs` → assertion of FILL step + order (AC11) and navigation evidence (AC12).

## 7. Files Changed (actual)

- `src/shared/component-types.ts` — 5 DomContext fields (incl. `isFormSubmitControl` ground truth)
- `src/definitions/dom-context-extractor.ts` — extractOwnerForm + isFormSubmitControl
- `src/definitions/patterns.ts` — `formJoinKey`
- `src/definitions/text-entry.ts` — submit completion (via `isInScope` form-join extension) + click exemption + metadata
- `src/generation/ir-bridge.ts` — `restoreSubmitFillOrder` (join read from trigger-event domContext) + `isSubmitControlInteraction` (ground-truth flag)
- tests: `text-entry-enter-submit-7-4-b6.test.ts`, `submit-delivery-7-4-b6.test.ts`, `ir-bridge-enter-submit-7-4-b6.test.ts`, `dom-context-owner-form-7-4-b6.test.ts` (extractor pin, added post-review)
- NOT changed: `src/runtime/component-runtime.ts` (delivery via the existing generic offer loop — see §4.4)

## 8. Verification record (2026-08-26)

- Unit: 22 B6 tests green (16 original + 6 extractor pins); full suite 312 files / 4889 tests green; tsc at the 8-error pre-existing baseline.
- Real Chrome (CDP trusted input, `.drytis/zz-enter-submit-verify.mjs`, self-asserting): interactions = Click(Search) + TextEntry(completed, committedValue="wireless earbuds", commitSignal=submit, enterCause=true, formJoinKey=form:id:search-form) + Navigation; IR = fill → click → navigate; 17/17 keydowns `claimed`; 0 SW console errors.
- Reviewer: PASS 12/12 ACs (3 WARNs addressed: AC2 extractor pin added, §4.4 spec aligned to implemented mechanism, harness made self-asserting).
- Tester (preview fixtures): PASS 4/4 — both user journeys (fill+click, Enter-submit) GET-navigate correctly, 0 JS errors.
- infra_verifier: PASS (0 failures).
