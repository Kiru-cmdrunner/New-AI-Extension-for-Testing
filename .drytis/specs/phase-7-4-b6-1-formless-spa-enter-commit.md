# Phase 7.4-B6.1 — Form-less SPA Enter Commit (Family F2)

- **Status:** IMPLEMENTED (2026-08-27). Verification record in §12.
- **Date:** 2026-08-27 (amended same day)
- **Amendments (implementation-readiness audit):**
  - **C-1** — ledger claim restoration is impossible (`setDisposition` is terminal-immutable,
    `evidence-ledger.ts:237`); replaced with a **projection skip**. Ledger is never rewritten.
  - **C-2** — tier C IR replay decided: **FILL-only honest replay**; no commit step is
    fabricated (no IR action can express bare Enter today); `keyboard-press` action deferred.
  - **C-3** — IR ordering scoped down: tier N needs **no reorder code** (natural emission
    order); the only ordering change is the tier C different-document rescue case.
  - **C-4** — tier C rescue-set corrected (the "nav-flush where P4 failed" case is unreachable
    and removed); added **P5 same-page scope guard** distinguishing same-document SPA
    navigation (tier N) from different-document navigation (tier C only).
- **Extends:** `.drytis/specs/phase-7-4-b6-enter-submit-commit.md` (B6, Enter-Submit Commit)
- **Basis:** read-only F2 study (this session) + real-Chrome B6 verification harness
- **Doctrine anchors:** deterministic-first / AI-last; **no timing rules** (ordering by recorded
  sequence, never wall-clock); honesty over fabrication; evidence joins by exact ID only;
  generation never imports understanding (INV-GEN-8/10).

---

## 1. Problem

A bare text input (no owner `<form>`) where the application's own Enter handler commits the
value — typically `fetch()` + `history.pushState()` — currently loses the typed value entirely:

- The Enter keydown is a member event of the live TextEntry lifecycle; the application effect
  (route change / request) arrives *after* the cause.
- A `navigation` event triggers `component-runtime.ts` `process()` step 2 → `flush()` → the
  TextEntry is terminated `interrupted` (`component-runtime.ts:304–306`, `flush()` at 561–580),
  and `releaseClaims()` (`evidence-ledger.ts:254`) flips its absorbed keydowns to `unclaimed`.
- With no navigation, the STOP flush interrupts it the same way.
- `filterProductionInteractions` (`src/presentation/output-adapter.ts:126`) keeps only
  `completed` → the typed value is dropped from live interactions, understanding input, KR, and IR.
- The 7.4-B3 typed-text episode tracker cannot rescue it (owns-element exclusion, blur-only
  minting, no STOP drain — `sw-integration.ts:113–166`).

Capture remains honest — every keydown survives as an Unclassified ledger card, and the app's
fetch is network-stamped to the Enter event — but no semantic object ever represents
"the user entered X and the application committed it".

## 2. Scope

**In scope (F2):** form-less text inputs (`owner form join key == null`) where a terminal Enter
on the field is followed by a **recorded application effect**.

**Out of scope — behavior explicitly unchanged:**

| Family | Pattern | Owner |
|---|---|---|
| F1 | Real `<form>` (incl. `preventDefault` SPAs, `requestSubmit`) | B6 — must stay byte-for-byte |
| F3 | `<form>` committed via JS `form.submit()` (no submit event) | future B6.y |
| F4 | Typeahead / debounce-as-commit (no explicit commit act) | never a commit — honest |
| — | Click-commit (form-less input + icon/button click) | future B6.y (different cause event) |
| — | Full-page navigation commit (`location.href = …` from the handler) | see §10 limitation |

## 3. Grounded evidence model (verified in code)

### Cause side — already recorded, exact

| ID | Evidence | Where |
|---|---|---|
| C1 | Typed stream, per-keystroke `valueAfter` | `ctx.data.typedValue` (`text-entry.ts:84–93`) |
| C2 | Terminal Enter keydown on the trigger element | ledger entry (eventId) + `ctx.data.lastKeyDownWasEnterOnTrigger` (`text-entry.ts:147–150`) |
| C3 | Enter's element identity | ledger `targetIdentity` (D1) — `elementKey`-joinable to the lifecycle trigger |
| C4 | Intent state at Enter | `userTyped`, `typedValue` |

### Effect side — already recorded, exact or window-scoped

| ID | Evidence | Join to cause |
|---|---|---|
| E1 | App-initiated fetch/XHR | SW `webRequest` rows stamped `sourceEventId = <Enter eventId>` — Enter is the **only primary-class keydown** (`network-observation.ts:629–631`), keyed exact `tabId:frameId` |
| E2 | Same-document navigation (`pushState`/`replaceState`/`popstate`/`hashchange`) | synthetic `navigation` ObservedEvent (`event-tap.ts:121–137`), same pageId ⇒ shared `captureSeq` ordering |
| E3 | DOM/surface changes around Enter | Enter opens a full evidence window (`evidence-collector.ts:466–471`; only Enter keydowns pass GAP-7) |
| E4 | View identity stream | recorded during capture (view events; consumed by outcome voting as `viewConfirmation`) |

**Directive preserved:** the Enter keydown is a **cause record**, never a completion trigger.
Completion is grounded exclusively in a recorded **application effect**.

## 4. Commit semantics

### 4.1 Cause predicate (identical for both tiers — all four recorded, no inference)

- **P1 — Form-less:** `ownerFormOf(ctx) === null` (no `formJoinKey` on the trigger).
  *Hard scope guard: if the input has an owner form, B6 semantics apply and B6.1 never fires.*
- **P2 — Intent:** `userTyped === true` AND `typedValue` non-empty.
- **P3 — Terminal Enter:** the last member keydown on the trigger element was `key === 'Enter'`
  (existing B6 flag `lastKeyDownWasEnterOnTrigger === true`).
- **P4 — Ordering guard:** **no member events on the trigger element after that Enter** before the
  effect moment (Enter is the terminal event of the typing episode). Checked from recorded
  member-event order — **no wall-clock comparison anywhere in this spec**.
- **P5 — Same-page scope (C-4 amendment):** tier N fires only when the Enter and the effect share
  one document (same `pageId`). A **different-document** commit (full-page
  `location.href = …`: Enter and the navigation carry different `pageId`s) is unreachable by
  tier N and reachable **only by tier C** at STOP.

New capture-side recording (pure fact, no semantics): when P3's keydown is observed, store
`ctx.data.enterEventId = event.eventId`. This is the exact-ID join key for E1.

**Canonical derivation (audit m-1):** tier C runs at STOP where live `ctx.data` is gone, and
`buildResult` does not emit `lastKeyDownWasEnterOnTrigger`/`enterEventId`. Therefore both tiers
must recognize the terminal Enter through the same pure derivation over recorded data:
**the last member event on the trigger element with `eventType === 'keydown'` and
`key === 'Enter'`, such that no later member event targets the trigger element.**
`ctx.data` flags remain display/convenience state only; the STOP pass never trusts them.

### 4.2 Tier N — navigation proof (strongest; decided at the navigation-flush seam)

**Rule:** a live TextEntry satisfying P1–P4 completes **at the moment the `navigation` event
arrives** (the very event that would otherwise flush-interrupt it).

- Effect proof: E2 alone is sufficient. A route change is a stateful application response.
- Completes with `endState: 'completed'`.
- Metadata: `commitSignal: 'navigation'`, `enterCause: true`, `committedValue: typedValue`,
  `navType` (display-grade, from the navigation event).

### 4.3 Tier C — network proof + corroboration (decided at STOP reconciliation)

**Rule (C-4 amendment — rescue set corrected):** a TextEntry terminated `interrupted` by the
**STOP flush** and satisfying P1–P4 is rescued to `completed` at STOP **only if both**:

- **E-C1 — Exact network join:** at least one network row with `sourceEventId === enterEventId`
  (derived canonically per §4.1 from `memberEvents`).
- **E-C2 — Recorded corroboration** (one of; each is an existing evidence class):
  - `viewConfirmation` — recorded view identity differs across the Enter boundary (E4);
  - `notificationSurfaceChange` — notification/error/banner surface state recorded in the
    Enter evidence window (the `notificationError` vote's evidence class);
  - `fieldRemoval` — the trigger element was removed after Enter (node-removal evidence).
- Metadata: `commitSignal: 'network'`, `enterCause: true`, `committedValue: typedValue`,
  `corroboration: <class>`, `networkCommitRequestIds` (bounded list, display-grade).

**Reachable tier C populations (exhaustive):**
1. In-place commits — app effect without any navigation (some chat composers, overlay panes).
2. Different-document commits (full-page `location.href`) — P5: tier N can never fire.
3. STOP-timed recordings where the user stopped recording immediately after Enter, before any
   navigation was observed.

**Unreachable (dead branch, removed by C-4):** nav-flush where P4 failed — any lifecycle
satisfying P1–P4 at nav time would already have completed via tier N; one failing P4 fails both
tiers.

**No corroboration ⇒ no rescue.** An Enter + fetch with no other recorded effect is
epistemically indistinguishable from a debounce rider and stays honestly uncommitted.

### 4.4 Tier C IR replay contract (C-2 decision)

**Decision: FILL-only honest replay.** The IR action vocabulary (`CLICK / FILL / SELECT /
TOGGLE / SELECT_DATE / NAVIGATE / HOVER / WAIT`) cannot express a bare Enter keypress, and
bare Enter is never a step (KeyboardShortcut requires a modifier; the Enter keydown is a
TextEntry member event, not a step source). Tier C therefore emits **only the FILL** carrying
`typedValue`, positioned in recorded order — with **no fabricated commit step**. The recorded
plan honestly does not reproduce the application response on replay; this is the accepted
cost, per doctrine (honesty over fabrication). Metadata on the FILL records
`commitSignal: 'network'` so adapters/consumers know the commit occurred but is unrepresented
as an action. A `keyboard-press` IR action is explicitly **deferred** (generation/executor
scope growth — future work §11).

> **IMPLEMENTED DEVIATION (review round 1, WARN-3):** `IRStep` carries no
> metadata field, and INV-GEN discipline keeps the IR a lean action contract —
> so the tier-C commit provenance lives on the INTERACTION metadata
> (`commitSignal: 'network'`, `corroboration`, `networkCommitRequestIds`),
> not on the IR step. Consumers of the plan see a FILL; consumers of the
> interaction (panel, KR) see the full commit evidence. A step-level field
> would be an IR-contract change deliberately deferred with `keyboard-press`
> (§11).

### 4.5 Metadata contract (honesty rules)

- `commitSignal` is emitted **only** on real commit paths: `'submit'` (B6), `'navigation'`,
  `'network'` (B6.1). Blur completions never carry it. No fabricated commits, ever.
- `committedValue` = `typedValue` at the commit moment (6C intent contract; IR FILL already
  reads `typedValue ?? textValue`).
- Every claim in metadata is a recorded fact; nothing is inferred, predicted, or heuristically
  labeled.

## 5. Decision seams (smallest architecture point that can see both sides)

### 5.1 Seam A — `flushOnNavigation` in the runtime (`src/runtime/component-runtime.ts`)

- `process()` step 2 currently calls `this.flush()` on `navigation`. Change: a
  `flushOnNavigation(navEvent)` variant that, per active lifecycle, consults a new **optional**
  definition hook:

  ```ts
  shouldCompleteOnNavigation?(event: ObservedEvent, ctx: ComponentContext): boolean
  ```

  `true` → complete as `'completed'` (definition sets its commit metadata inside the hook);
  `undefined`/`false` → interrupt exactly as today.
- Only TextEntry implements the hook. All other definitions are untouched; `flush()` (used at
  STOP and everywhere else) remains blind-interrupt.
- At this instant the seam holds the cause (P1–P4 from `ctx`) and the effect (the navigation
  event itself) synchronously, same-document. Network status is NOT consulted here (cross-process
  ordering ambiguity) — tier N deliberately does not need it.

### 5.2 Seam B — STOP reconciliation (`src/runtime/sw-integration.ts`)

- New pass `reconcileFormlessEnterCommits(...)` in `stopRecording`, placed **after** the flush and
  **before** `projectInteractions(...)` and the service-worker production filter — so rescued
  interactions survive filtering AND their member keydowns do not twin.
- Inputs (all recorded, final): emitted interactions (incl. interrupted TextEntry with full
  `memberEvents`), the evidence ledger, stamped network rows, the view stream, Enter-window
  evidence. Cause predicates derive from `memberEvents` (§4.1 canonical derivation) — the pass
  never depends on live `ctx.data`.
- **C-1 amendment — projection skip, not ledger rewrite.** `setDisposition`
  (`evidence-ledger.ts:237`) is terminal-immutable (`claimed`/`unclaimed` cannot be overwritten),
  so "restoring claims" is impossible without breaking the ledger's core invariant. Resolution:
  the rescue leaves the ledger untouched and instead passes the rescued set to
  `projectInteractions`, which **skips** minting Unclassified twins for any `unclaimed` entry
  whose `eventId` belongs to a rescued interaction's `memberEvents`. Ledger immutability stays
  absolute; the projection is the only consumer of dispositions at STOP anyway.
- Actions on a rescue: set `endState = 'completed'`, attach §4.3 metadata. Nothing else.
- Acknowledged cost: a second site where TextEntry terminal semantics live (the first is the
  definition). Precedent: S3 synthetic mint and the T11–T16 stop drains already reconcile at STOP
  from recorded state. Purity rule: the pass reads only recorded facts; it never re-runs
  detection, never invents events, never reorders the ledger.

### 5.3 Explicitly wrong seams (rejected)

- Emit-time enrichment (`enrichInteraction`) — fires only for emitted interactions; the F2
  TextEntry is already terminal there.
- EventTap / capture layer — the gap is semantic, not capture; nothing new needs capturing.
- Understanding pipeline — runs post-filter; also INV-GEN severance keeps generation off that path.

## 6. False-positive boundaries

| Case | Guard | Disposition |
|---|---|---|
| Enter alone, no effect (validation failure, no-op) | no E2, no E-C1 | no commit — stays interrupted; keydowns honestly Unclassified |
| Typeahead debounce rider (timer fetch after Enter) | E-C2 required; rider has no view/surface/removal effect | no commit |
| Analytics `pushState` on Enter (no real view change) | residual risk of tier N; documented | commit (see §10 — tunable, not gated now) |
| Tag/chip input (Enter inserts chip, no fetch/nav) | no E2, no E-C1 | no commit — correct, chip insertion is not a field commit |
| Chat composer (Enter + fetch + clear, no nav) | tier C only if a §4.3 corroboration class records it | commit when corroborated; else honest no-commit (§10) |
| User keeps typing after Enter (P4 violated) | ordering guard | no commit — fails both tiers (the former "nav-flush where P4 failed" tier C branch was unreachable and is removed, C-4) |
| Enter on empty field | P2 | no commit (existing filter also drops) |
| Foreign element's navigation (unrelated route change) | seam A only fires for lifecycles satisfying P1–P4 whose Enter is terminal member event | no commit for non-matching lifecycles |
| IME composition Enter (confirm candidate, not submit) | **not distinguishable today** — `isComposing` is not captured | possible false positive — honest limitation (§10) |
| Double Enter (second Enter after nav) | first lifecycle completed at nav; no new lifecycle without a new focus | second Enter stays honestly Unclassified |
| Outside click between Enter and effect | `shouldCancelOnOutside` abandons first | no commit (abandoned) |

## 7. Affected architecture layers

| Layer | Change |
|---|---|
| `src/shared/component-types.ts` | optional `shouldCompleteOnNavigation?` on `ComponentDefinition` (type-only addition) |
| `src/definitions/text-entry.ts` | implement the hook (P1–P4 ⇒ complete, set tier-N metadata); record `ctx.data.enterEventId`; **no change** to blur, B6 submit, or cancellation rules |
| `src/runtime/component-runtime.ts` | `flushOnNavigation(navEvent)` consulting the hook; `flush()` and STOP path unchanged |
| `src/runtime/sw-integration.ts` | STOP reconciliation pass (tier C) + projection-skip wiring per §5.2 (C-1: **no ledger rewrite**) |
| `src/runtime/projection-engine.ts` | **C-1 amendment — small additive change:** `projectInteractions` accepts the rescued-set (skip list) and suppresses Unclassified twins for `unclaimed` entries whose eventId belongs to a rescued interaction's `memberEvents`; default behavior (no skip list) is byte-for-byte today |
| `src/generation/ir-bridge.ts` | **C-3 amendment — near-zero change:** tier N needs **no reorder code** (the hook completes TextEntry inside nav-flush, before the Navigation definition discovers the nav event — same `process()` call — so emission order is already FILL-before-NAVIGATE; tests assert this, no new pass). Tier C emits FILL-only in recorded order (§4.4) — **no `restoreSubmitFillOrder` extension**; the B6 submit-family function is untouched |
| `src/presentation/output-adapter.ts` | **no change** (rescued interactions already pass the completed+userTyped+non-empty filter) |
| Side panel | render `commitSignal: 'navigation' | 'network'` labels alongside B6's `'submit'` |
| KR / persistence | **no schema change** — `signatureKey` inputs unchanged; new metadata flows through the existing envelope; rescued interactions now reach KR (intended reinforcement shift) |
| Setup script / env / services / proxies | **no change** |

## 8. Test plan (TDD; all named files new)

**Unit — definitions** (`tests/definitions/text-entry-formless-enter-7-4-b6-1.test.ts`)
1. Hook predicate truth table: P1–P4 combinations ⇒ complete/interrupt.
2. P1 guard: input **with** owner form never completes via the navigation hook (B6 preserved).
3. `enterEventId` recorded on terminal Enter; not recorded otherwise.

**Runtime** (`tests/runtime/component-runtime-formless-enter-7-4-b6-1.test.ts`)
4. `flushOnNavigation` completes hooked lifecycle; definitions without the hook still interrupt;
   plain `flush()` (STOP) still blind-interrupts.
5. P4: input event after Enter before nav ⇒ interrupted (no tier-N completion).
6. Non-navigation events do not consult the hook.

**Integration — STOP chain** (`tests/runtime/stop-reconcile-formless-enter-7-4-b6-1.test.ts`)
7. Tier C positive: stamped request (`sourceEventId === enterEventId`) + `viewConfirmation` ⇒
   rescued, `commitSignal:'network'`, corroboration recorded, projection-skip suppresses
   Unclassified twins (C-1), **ledger dispositions unchanged** (assert `unclaimed` still
   `unclaimed` — immutability held).
8. Tier C negative (debounce-rider shape): stamped request, no corroboration ⇒ stays interrupted;
   projection unchanged from today.
9. `notificationSurfaceChange` and `fieldRemoval` corroboration variants.
10. `filterProductionInteractions`: rescued passes; unrescued still dropped.
10b. Projection default (no skip list passed): byte-for-byte current behavior (C-1 regression
   guard).

**Generation** (`tests/generation/ir-bridge-formless-enter-7-4-b6-1.test.ts`)
11. Tier N plan: FILL (value = `typedValue`) **before** NAVIGATE; no phantom CLICK step; **no
    reorder code required** — this test pins the natural emission order (C-3).
12. Tier C plan (no nav): FILL-only (§4.4 C-2), correct recorded position, NO commit step,
    `commitSignal:'network'` in step metadata.
13. B6 regression: form + Enter still `commitSignal:'submit'` with click-before-FILL restore order
    (existing B6 tests must remain green, untouched).

**E2E — real Chrome** (extend the `.drytis/zz-enter-submit-verify.mjs` CDP harness + local HTTP
fixtures, trusted input only)
14. `formless-search.html` (Enter handler → fetch + `pushState`): completed TextEntry,
    `commitSignal:'navigation'`, `typedValue` intact, FILL in IR before NAVIGATE, fetch row
    attached by exact `sourceEventId`, zero Unclassified keydown twins.
15. `formless-noop.html` (Enter, no effect): stays interrupted; ledger honest.
16. `debounce-rider.html` (settlement fetch on a timer, no corroboration): NOT committed.

**Static:** `tsc` stays at the 8-error baseline; full suite green.

## 9. Acceptance criteria

- [ ] Real-Chrome E2E 14 passes: form-less Enter search produces a completed TextEntry with
      `commitSignal:'navigation'` and a FILL step carrying the typed value.
- [ ] Real-Chrome E2E 15 & 16 pass: no-effect and rider cases produce **no** commit.
- [ ] All B6 tests (submit path) green and unmodified — F1 behavior byte-for-byte.
- [ ] Input with owner form never completes via navigation hook (test 2).
- [ ] No timing constants introduced; all ordering decisions use recorded sequence/IDs.
- [ ] Rescued interactions produce no Unclassified twins via projection-skip (test 7), and the
      ledger's terminal dispositions are never rewritten (C-1 immutability assertion).
- [ ] Projection default path byte-for-byte unchanged when no skip list is passed (test 10b).
- [ ] Tier N ordering achieved with zero IR reorder code (test 11 pins natural emission order).
- [ ] Tier C emits FILL-only with no fabricated commit step (C-2, test 12).
- [ ] `filterProductionInteractions` unchanged (test 10).
- [ ] Full suite green; `tsc` baseline unchanged.
- [ ] ROADMAP note updated; spec status flipped to IMPLEMENTED.

## 10. Honest limitations & residual risks

1. **IME composition Enter** — `isComposing` is not captured; a CJK candidate-confirm Enter
   followed by a route change would false-positive as a commit. Fix requires a new DomContext
   field (same additive shape as the B6 pointerEvents/ariaHidden slice) — deliberately out of
   scope here.
2. **Analytics pushState** — tier N trusts navigation; a bookkeeping-only route change after
   Enter yields a commit. Mitigation available later (gate tier N on `viewConfirmation` when view
   classification is confident); deliberately not gated now to keep the strongest signal simple.
3. **Full-page navigation commit** (`location.href = …`) — different document ⇒ P5: tier N can
   never fire; reachable **only by tier C** with a stamped request + corroboration. Note the
   tier C IR replay is FILL-only (C-2): the commit is recorded semantically but **not
   replayable as an action** until a keyboard-press IR action exists (§11). Known gap.
4b. **Tier C replay does not reproduce the app response** (C-2 consequence) — the recorded
    plan fills the field but performs no commit act; a rerun of the plan will not trigger the
    application effect. Honest by design; lift via deferred `keyboard-press` action.
4. **In-place-only commits without corroboration** (some chat composers, overlay result panes) —
   epistemically ambiguous even to a human observer; the spec chooses honest no-commit over a
   guess. If `domChanges` window summaries can deterministically distinguish node insertion from
   attribute churn, a `materialInsertion` corroboration class may be added **only** after that
   capability is verified in capture — flagged as an implementation-verification item, not an
   assumption.
5. **Network stamp is initiation-time** — tier C inherits the last-trusted-action semantics;
   corroboration exists precisely to compensate. Requests with no discrete predecessor may be
   stamped from stale actions; the exact `enterEventId` join keeps tier C tight regardless.
6. **Field *value* clearing is unobservable** when apps set `.value` programmatically (no DOM
   event, not an attribute mutation) — which is why `fieldRemoval` (observable) is the
   corroboration class, not `fieldCleared`.
7. **Multi-field form-less flows** — each focus lifecycle is judged independently; only the
   field whose Enter was terminal gets commit semantics.
8. **KR reinforcement shift** — TextEntry interactions that previously never reached KR now do;
   signature counts will move. Intended consequence, called out for auditability.

## 11. Future work (explicitly not this spec)

- B6.2: click-commit for form-less inputs (icon-button cause).
- B6.3: F3 (`form.submit()` JS commits — no native submit event).
- `keyboard-press` IR action + executor support (C-2 deferral — lifts the tier C replay
  limitation §10.4b).
- DomContext additive slice: `isComposing` (IME honesty), alongside the already-proposed
  pointerEvents/ariaHidden fields.
- Tier-N `viewConfirmation` gating (analytics pushState residual).

## 12. Implementation & verification record (2026-08-27)

- **P4 real-Chrome exemption (justified deviation, pinned by AC1e2):** Chrome
  fires a trusted `change` on the text input BETWEEN the Enter keydown and the
  application effect — even with no `<form>` (implicit control commit). The
  canonical derivation `terminalEnterMemberOf` exempts trigger-element
  `change` events after the Enter (they carry the same committed value; real
  typing always emits keydown+input first, so `change` cannot hide new typing).
  keydown/input after Enter still break P4. Both tiers use the ONE derivation
  (tier C calls it directly — reviewer FAIL-1 fixed).
- **Election anchor** scoped to the lifecycle's own trigger element (reviewer
  WARN-1 fixed); comparison by captureSeq with later-lifecycle tie-break.
- **E2E (real Chrome, trusted CDP input, `.drytis/zz-b61-e2e.mjs`,
  self-asserting):** S1 formless-search — TextEntry completed,
  `commitSignal='navigation'`, typedValue intact, IR `fill → navigate`, 0
  Unclassified twins, ledger unclaimed=0. S2 formless-noop — NO commit
  anywhere, 17 keydowns survive as Unclassified (capture guarantee). S3
  debounce-rider — stamped fetch, no corroboration ⇒ NO commit.
- **B6/F1 regression:** B6 suites untouched and green; real-Chrome B6 harness
  re-run PASS (fill → click → navigate, commitSignal 'submit').
- **Suite:** 318 files / 4,928 tests green; `tsc` at the 8-error pre-existing
  baseline. Reviewer round 2: PASS (both round-1 FAILs + all five WARNs
  verified fixed; two cosmetic notes remediated in this final edit).
  infra_verifier: PASS (0 failures).
- **Side panel:** commit labels (`form submit` / `Enter (route change)` /
  `Enter (app request)`) in `formatMetadata`; blur completions render nothing.
