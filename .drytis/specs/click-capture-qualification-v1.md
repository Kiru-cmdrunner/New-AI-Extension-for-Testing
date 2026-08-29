# Spec: Capture-Time Click Qualification — v1.2

**Status: SPEC — owner-approved (D1–D4 resolved 2026-08-29). Implementation not begun.**
**Date: 2026-08-29 (v1.2 — §13 owner decisions resolved; v1.1 carried the audit amendments R-1…R-5)**
**Predecessors:** capture-model-exclusion-first-audit-2026-08-26.md, exclusion-first-incremental-vs-rewrite-2026-08-26.md (recovered decision), click-lifecycle architecture studies 2026-08-28/29 (provisional lifecycle, response ownership, exclusion-fact inventory), B3 S4 decision record, implementation-readiness audit 2026-08-29 (R-1…R-5).

---

## 1. Context and direction

The established direction: **Click qualification moves to the capture layer.** The current `Click.detectTrigger` inclusion gates (isInteractiveElement → open-surface → auto-id → cursor/onclick) are **retired as the qualification authority**. They may survive temporarily as *recorded facts* but a trusted physical click must never become Unclassified *because* the target "doesn't look interactive."

Model:

```
trusted physical click
        │
        ▼
capture immutable facts (dispatch instant, capture phase, DOM frozen)
        │
        ▼
determine ONLY provable invalidity (pure function over the fact vector)
        │
   ┌────┴─────────────────┐
   ▼                      ▼
provably invalid     not provably invalid
   │                      │
   ▼                      ▼
Unclassified         qualified Click
(recorded cause)     (may carry an insufficiency marker — a fact, not a verdict)
```

Governing constraints (owner-fixed for this spec):
- **No site vocabulary.** Facts are platform/DOM semantics only.
- **No timing rules.** Every fact is a dispatch-instant DOM fact.
- **No response-based qualification.** Evidence windows, horizons, and app responses are NOT consulted in this phase.
- **No downstream rescue/filtering.** The verdict is captured once; no layer re-types or re-scores it.
- **Capture is the single qualification authority** (v1.1). No second qualification layer is created now or permitted later. The future response-based phase is the *same authority's second instant on the same verdict record* (§8.4, §14) — not a parallel downstream filter.
- Affordance signals (ARIA role, tabIndex, cursor, onclick, auto-id, resolveTarget vocabulary) **must not be the reason** a click becomes Unclassified. They may be recorded as facts.

## 2. Terminology

- **Raw hit element** — the actual element hit-testing selected: `event.target` / `composedPath()[0]`. This is a platform fact, not a heuristic.
- **Resolved target** — the element `resolveTarget` returns after its lift strategies (identity/locator purpose only, unchanged).
- **Natively-disableable tag** — `button`, `input`, `select`, `textarea`, `option`, `optgroup`, `fieldset`. Only these carry platform-enforced `disabled` semantics.
- **Form-associated control** — `button`, `input`, `select`, `textarea`, `fieldset`. The set `fieldset[disabled]` actually disables.
- **Canvas** — a raw hit element of `BODY`/`HTML` (page background). No interactive descendant on the composed path.
- **Lift** — resolved target ≠ raw hit element (resolveTarget strategies 1/1b/2/3 lifted the pointer's element to an ancestor or heuristic match).
- **Provably invalid** — the platform itself proves the click could not operate on the recorded target: browser-enforced non-activation, non-hittability, or hit-test misattribution. Never a similarity judgment.
- **Insufficient evidence** — no invalidity proof AND no positive interactive establishment of the raw target. A recorded honesty dimension of a *qualified* click — **not** a third outcome in this phase.

## 3. Capture-time fact model

Captured once, at the **EventTap capture-phase listener**, in the same synchronous handler that already extracts identity/DomContext — before any page handler runs, DOM frozen mid-dispatch. Immutable from that instant.

*Capture mechanics note (v1.1):* the raw hit element is currently discarded after identity resolution (`assembleObservedEvent` resolves twice); the fact extractor receives the raw element threaded once, before `resolveTarget` consumes it.

### 3.1 Invalidity facts (proof inputs)

| Field | Type | Source | Proof quality |
|---|---|---|---|
| `disabledNative` | `boolean` | `hasAttribute('disabled')` AND tag ∈ natively-disableable set | platform-enforced: browser does not activate disabled controls. **Restricted (R-2)** — a `disabled` attribute on any other tag carries no platform semantics |
| `disabledAttrNonNative` | `boolean` | `hasAttribute('disabled')` AND tag ∉ natively-disableable set | app-declared (R-2): the app's own word, same trust tier as `aria-disabled` — React `disabled` on a `div` renders exactly this |
| `fieldsetDisabled` | `boolean` | target is a form-associated control AND `closest('fieldset[disabled]')` exists AND target is NOT inside that fieldset's **first `<legend>`** | platform-enforced for descendant form controls only. **Restricted (R-3)** — plain elements inside a disabled fieldset are unaffected by the platform |
| `ariaDisabled` | `boolean` | `aria-disabled="true"` on resolved target | app-declared (handlers may still fire — see §12 limits) |
| `inertSubtree` | `boolean` | `closest('[inert]')` on resolved target hits (self or ancestor) | platform-enforced; defensive tier — Chrome suppresses trusted clicks on inert subtrees at hit-testing, so on a trusted event this should never fire (§12). Kept as a cause; if it fires, the record is still platform-honest |
| `pointerEventsNone` | `boolean` | computed `pointer-events === 'none'` on **resolved** target | app-declared non-hittability of the *recorded* target. Cause only under the joint gate (R-4, §4.1); CSS re-enables `pointer-events` on descendants, so standalone firing would falsely demote legitimate hits |
| `hitTest` | `{ checked: boolean; miss: boolean \| null }` | `document.elementFromPoint(clientX, clientY)` at dispatch vs. raw element's composed path (shadow-host walk, bounded depth) | `miss: true` = the topmost hittable element at the click point was provably not the raw target — the **only universal misattribution proof**. `null` = probe inconclusive (element off-viewport, cross-frame point) — never treated as miss |
| `zeroSizeLifted` | `boolean` | resolved target `getBoundingClientRect()` is empty AND lift occurred | **Demoted (R-5)**: no longer a standalone proof — a zero-area ancestor can contain an absolutely-positioned hittable child. Recorded fact + insufficiency marker; auxiliary cause only jointly with `hit-test-miss` |

### 3.2 Hit-target structure facts (representation, not verdicts)

| Field | Type | Source |
|---|---|---|
| `hitTarget.kind` | `'canvas' \| 'element'` | raw hit element tag ∈ {BODY, HTML} ⇒ `canvas` |
| `hitTarget.rawTag` | `string` | tag of raw hit element (pre-lift) |
| `hitTarget.lifted` | `boolean` | resolved ≠ raw |
| `hitTarget.liftStrategy` | `'path' \| 'parent' \| 'cursor' \| 'raw'` | which resolveTarget strategy produced the resolved target |
| `hitTarget.rawInteractiveShaped` | `boolean` | raw hit element passes the shared `isInteractiveElement` predicate (recorded fact only) |

### 3.3 What this model deliberately does NOT contain

Application response facts, listener registries, focus/selection state, timing fields, element-class/name heuristics, anything keyed off site vocabulary. Those belong to later phases (response-based qualification requires the ownership-stamp prerequisite) or are out of model.

## 4. The qualification verdict

Computed **once, at capture time**, as a pure function of §3.1 + §3.2. Carried on the event; never re-derived downstream.

```
type ClickInvalidityCause =
  | 'disabled-native'          // platform, tag-restricted (R-2)
  | 'fieldset-disabled'        // platform, form-control-restricted, legend-exempt (R-3)
  | 'inert-subtree'            // platform, defensive tier
  | 'hit-test-miss'            // platform misattribution proof — the only universal one
  | 'pointer-events-none'      // app-declared; JOINT with hit-test-miss (R-4)
  | 'zero-size-lifted'         // auxiliary annotation; JOINT with hit-test-miss (R-5)
  | 'aria-disabled'            // app-declared
  | 'disabled-attr-non-native' // app-declared (R-2)

type ClickQualification = {
  verdict: 'provably-invalid' | 'qualified';
  causes: ClickInvalidityCause[];      // empty iff verdict = qualified
  insufficient: boolean;               // honesty marker, qualified clicks only
};
```

**Joint-gate rule (v1.1):** `pointer-events-none` and `zero-size-lifted` **never appear without `hit-test-miss`**. They annotate a misattribution proof (they name the mechanism); they never replace it. Standalone, each is only a recorded fact / insufficiency marker.

### 4.1 Predicates (exact)

**`provably-invalid` ⇔ at least one of:**

1. `disabledNative` (cause `disabled-native`)
2. `fieldsetDisabled` (cause `fieldset-disabled`)
3. `inertSubtree` (cause `inert-subtree`)
4. `hitTest.checked && hitTest.miss === true` (cause `hit-test-miss`)
5. `pointerEventsNone && hitTarget.lifted && hitTest.checked && hitTest.miss === true` (cause `pointer-events-none`; co-fires with 4)
6. `zeroSizeLifted && hitTest.checked && hitTest.miss === true` (cause `zero-size-lifted`; co-fires with 4)
7. `ariaDisabled` (cause `aria-disabled`)
8. `disabledAttrNonNative` (cause `disabled-attr-non-native`)

**`insufficient ⇔ verdict = qualified AND any of:**

- `hitTarget.kind === 'canvas'` (empty/background click), or
- `hitTarget.lifted && !hitTarget.rawInteractiveShaped` (pointer hit a plain leaf; identity names an ancestor), or
- `zeroSizeLifted` (zero-area recorded target without a misattribution proof — R-5)

Insufficiency is **recorded on the click**, consumed by no rule in this phase. It is the input reserved for the future response-based phase (canvas + no *owned* response ⇒ provably dead — blocked on ownership stamps per the ownership study).

### 4.2 Boundary table — the exact line

| Situation | Verdict | Outcome |
|---|---|---|
| Click on disabled native control (button/input/select/textarea/option/optgroup/fieldset) | provably-invalid (`disabled-native`) | Unclassified, cause recorded |
| `disabled` attribute on a non-native tag (div[disabled] — React/framework pattern) | provably-invalid (`disabled-attr-non-native`, app-declared tier) | Unclassified, cause recorded |
| Form control inside disabled fieldset, **outside** the first legend | provably-invalid (`fieldset-disabled`) | Unclassified, cause recorded |
| Plain div inside disabled fieldset (not a form control) | **qualified** (fact recorded, no cause — R-3) | Click |
| Form control inside the **first legend** of a disabled fieldset | **qualified** (legend exemption — R-3) | Click |
| Resolved target inside inert region | provably-invalid (`inert-subtree`) | Unclassified, cause recorded |
| Topmost hittable element at the click point ∉ raw composed path | provably-invalid (`hit-test-miss`) | Unclassified, cause recorded |
| Hit-test miss + lifted resolved target with computed `pointer-events:none` | provably-invalid (`hit-test-miss` + `pointer-events-none`) | Unclassified, both causes |
| Hit-test miss + lift to a zero-area element | provably-invalid (`hit-test-miss` + `zero-size-lifted`) | Unclassified, both causes |
| **Lift to zero-area ancestor, hit-test miss = false or inconclusive** (absolutely-positioned hittable child) | **qualified**, insufficient (`zeroSizeLifted` marker — R-5) | Click |
| **Parent `pointer-events:none`, child `pointer-events:auto`; click child, lift to parent; hit-test miss = false** | **qualified** (`pointerEventsNone` recorded, no cause — R-4 guard) | Click |
| `aria-disabled="true"` target | provably-invalid (`aria-disabled`) | Unclassified, cause recorded (app-declared tier) |
| **Disabled `button[aria-expanded]`** (would be claimed by Expander discovery today) | provably-invalid (`disabled-native`); **universal pre-gate (§8.1) blocks ALL definitions** | Unclassified — never Expander |
| **Empty/background click (BODY/HTML raw)** | **qualified, insufficient=canvas** | **Click — click-away dismissals preserved** (B3 S4 intact) |
| Plain leaf lifted to plain ancestor | qualified, insufficient=lifted-unshaped | Click |
| Plain div, no lift, no invalidity facts | qualified | Click |
| Semantic element (button, link, …), no invalidity facts | qualified | Click |
| Anything where all probes are inconclusive | qualified (never fabricate exclusion) | Click |

**The asymmetry this phase institutionalizes:** the facts can only ever *exclude a click from Click typing* when the platform or the app's own declaration proves non-operability. They can never fabricate a Click (that authority remains: trusted physical dispatch). A qualification miss therefore over-includes (a dead background click appears as Click) — visible, and correctable in the response phase. An exclusion is only ever made on recorded proof. This inverts the old asymmetry principle deliberately and only for this seam.

## 5. Empty / background-space clicks

- Represented by `hitTarget.kind = 'canvas'` + `rawTag` — a **structural fact at capture**, not an exclusion.
- **Not provably invalid in this phase.** B3 S4 census evidence (int-15): body click-away dismissal is a dominant SPA pattern; emptiness is observationally identical to dismissal until the response horizon closes. This spec preserves B3 S4: no empty-space click is dropped or auto-demoted.
- The demotion path (`canvas` + no owned response ⇒ provably dead ⇒ Unclassified with cause) is **deferred to the response-based phase** and is blocked on fact-level response ownership stamps (prior study). This spec records exactly the facts that phase will need.
- Known cost, stated honestly (§12): until that phase lands, dead background clicks surface as Click cards and may reach IR as CLICK steps. This is accepted direction, not an oversight; the mitigation is the response phase, not a downstream filter.

## 6. Raw-vs-resolved lifting

- `resolveTarget` remains **the identity/locator authority** (unchanged selectors, replay honesty). It is not consulted for qualification.
- Every click records the lift audit (`lifted`, `liftStrategy`, `rawTag`, `rawInteractiveShaped`) so "the pointer hit a plain leaf and we named its ancestor" is permanently distinguishable from "the pointer hit the element we named."
- Proof-quality rule: invalidity facts about the **resolved** target are proofs about what we *recorded*, riding the lift. The hit-test is the raw-element anchor that keeps the model honest when the lift is the only reason the target exists.
- **`pointer-events-none` (R-4):** the fact is computed on the resolved target; as a **cause** it requires `lifted` AND a confirmed `hitTest.miss` — the joint gate exists because CSS re-enables `pointer-events` on descendants, and a legitimate hit child lifted to a `none` parent must not be demoted (§4.2 guard row). Computed `pointer-events:none` on the **raw** hit element is unreachable on a trusted dispatch (the browser's hit-testing skips such elements entirely) — recorded as a defensive audit fact only, never a cause; never fabricate exclusion from a contradiction with dispatch itself.

## 7. Persistence & versioning

- **DomContext**: §3 fields added additively (optional, undefined on legacy events/snapshots) — the never-landed "Phase 0" shape. Restore-stable.
- **Ledger row**: the full fact vector + verdict persisted on the durable `LedgerEntry` (versioned-additive extension, null-on-legacy — same precedent as `targetIdentity`/`ancestorRoles`). This ends ledger starvation for qualification facts: the verdict is auditable post-hoc from the record alone. The four already-computed facts (`disabled`, `ariaDisabled`, `fieldsetDisabled` via `isDisabled`, plus `pointerCursor`/`clickHandler` which remain recorded facts) stop being discarded.
- **Projection**: `createUnclassifiedFromLedger` must stop synthesizing `disabled: false` — it carries the persisted vector; the Unclassified card exposes `physicalEventType` + `invalidityCauses`.
- **Immutability**: facts and verdict are frozen at capture. Nothing downstream mutates them. Replay/locators NEVER read them (classification-input only — the 7.4-M1 affordance precedent).

## 8. Runtime consumption contract

### 8.1 Universal pre-gate before `tryDiscovery` (R-1)

In `ComponentRuntime.process`, **immediately before `tryDiscovery`**, for event type ∈ {`click`, `contextmenu`} with persisted verdict `provably-invalid`: **skip `tryDiscovery` entirely.** No semantic definition (Checkbox, Link, Modal click-branch, Expander, Tab, …) and not Click itself may claim the event. The ledger entry stays `pending`; STOP projection mints the Unclassified card with the recorded `invalidityCauses`.

This closes the hidden co-authority hole the audit exposed: semantic definitions' own `detectTrigger` gates run *before* Click's fallback today (Expander claims a disabled `button[aria-expanded]` at priority 80) and would otherwise keep typing provably-invalid clicks as semantic interactions. After the pre-gate, **no `detectTrigger` gate ever adjudicates invalidity** — they adjudicate only *what kind* of qualified click it was.

### 8.2 Accepted, pinned side effects of pre-gate placement

The pre-gate runs *after* the ownership/completion passes in `process()` — deliberately, because the physical gesture occurred regardless of the click's qualification:

- **activeStack pass (step 3):** a provably-invalid click still completes an in-flight Hover (B7-P2 consumed-by-click release). The hover's consumption is a physical fact about the pointer, independent of what the click operated on. *(Pinned test.)*
- **lifecycleOwnsTarget / 6F-M1 gesture absorption:** a provably-invalid trailing click may still be absorbed into a completed gesture's `memberEvents`; the member entry retains its verdict and causes on the ledger row — the gesture is real, the click's qualification is unchanged. *(Pinned test.)*

### 8.3 Stamping and evidence (unchanged)

`stampClass('click'|'contextmenu') = 'primary'` is written at SW message dispatch, **before** runtime classification. Invalid clicks still stamp; their network requests still attach to the projected Unclassified card via the STOP drain. Evidence windows still open on the event (WINDOW_OPEN_EVENTS unchanged). No stamp-order, evidence, or navigation change.

### 8.4 Single qualification authority (v1.1)

The verdict is computed once, at capture, by the capture layer. Nothing downstream computes, re-derives, scores, or overrides it. The future response-based phase (canvas + no owned response ⇒ provably dead) is **the same authority's second instant on the same verdict record** — one record, two instants (dispatch + horizon close), the provisional-lifecycle Shape B. It is **not** a parallel downstream filter; the architecture has no seam for one, and this spec creates none.

### 8.5 Claim rule and scope

- **Claim rule:** the Click definition (or its successor authority) claims a trusted click/contextmenu iff `verdict === 'qualified'`. The inclusion gates are deleted as authority in the same change (per §13.1); their observable vocabulary survives only as recorded facts.
- **Scope:** `click` + `contextmenu` (same physical family; contextmenu currently rides Click typing — same rule, same facts). `mousedown`/`keydown`/`dragstart`/`drop` typing is untouched in this phase.
- **Panel:** Unclassified click cards render cause chips (`physical: click · provably invalid: disabled-native`). Qualified clicks may render the insufficiency marker (presentation only). No type ever changes after emit.
- **IR/Understanding/KR:** consume final types as today. Unclassified IR-drop (B4 D2) unchanged. Qualified-insufficient clicks are Clicks for all of them (cost documented in §12).

## 9. Non-goals (this phase)

- Response-based qualification (horizons, ownership stamps, no-response demotion).
- Listener registry / MAIN-world addEventListener patching.
- Any change to resolveTarget's selectors or locator strategy.
- Any change to Hover admission, evidence windows, or Channel A behavior.
- Migration of existing KR `Unclassified` signatures (see §13).
- A second qualification layer — by construction, not just by preference (§8.4).
- The legacy `deterministic-recorder.ts` capture path (dead code; documented divergence left as-is).

## 10. Invariants

1. **Capture guarantee**: every trusted physical click reaches the panel as Click or Unclassified. Nothing dropped. (INV-LE-1..3, M5 unchanged.)
2. **Trusted dispatch is the sole creator** of click records; invalidity facts only exclude from Click typing, never create or destroy records.
3. **Verdict computed once at capture**, pure over the fact vector, persisted; no downstream re-derivation, no partial re-computation.
4. **No timing** (elementFromPoint is a dispatch-instant structural probe, not a timing rule), **no vocabulary**, **no response reads**.
5. **Facts are classification-input only** — never identity, never locators, never replayed.
6. **Honesty**: inconclusive probes never fabricate exclusion; absence of proof is recorded as absence (`checked: false` / `miss: null`), never guessed.
7. **Single authority** (v1.1): qualification decisions originate only in the capture layer. No layer downstream of EventTap re-types, scores, or overrides a click's verdict. The response phase, when built, extends the same record at horizon close — it is not a second layer.
8. **Pre-gate totality** (v1.1): a `click`/`contextmenu` with verdict `provably-invalid` is claimed by **no** definition. Semantic `detectTrigger` gates never adjudicate invalidity.
9. **Joint-gate soundness** (v1.1): `pointer-events-none` and `zero-size-lifted` never fire without `hit-test-miss`; they annotate a misattribution proof, never replace it.

## 11. Test matrix / acceptance criteria

**Fact capture (unit)**
- [ ] Each cause independently produces `provably-invalid` with exactly that cause (8 causes)
- [ ] `disabledNative` fires only on natively-disableable tags; `div[disabled]` sets `disabledAttrNonNative`, not `disabledNative` (R-2)
- [ ] `fieldsetDisabled` fires only for form-associated controls outside the first legend; div-in-disabled-fieldset and first-legend negatives stay qualified (R-3)
- [ ] `pointerEventsNone` computed on the resolved target; raw-element PE:none recorded defensively, never a cause (R-4)
- [ ] `zeroSizeLifted` recorded independently of verdict; insufficiency marker set when qualified (R-5)
- [ ] `hitTest.miss === null` (inconclusive) never produces `hit-test-miss`
- [ ] BODY/HTML raw click ⇒ `hitTarget.kind='canvas'`, verdict qualified, insufficient=true
- [ ] Lift audit recorded for each resolveTarget strategy (`path`/`parent`/`cursor`/`raw`)
- [ ] Hit-test probe is an injectable seam (jsdom lacks `elementFromPoint`) — stubbed in unit tests
- [ ] Legacy events without the fields restore and classify as qualified (additive compatibility)
- [ ] Facts frozen: no mutation post-capture

**Boundary (unit)**
- [ ] All rows of the §4.2 table hold verbatim
- [ ] Parent `pointer-events:none` + child `pointer-events:auto` + lift ⇒ **qualified** (R-4 guard pin)
- [ ] Zero-area ancestor with absolutely-positioned hittable child, miss=false ⇒ qualified + insufficient marker (R-5 pin)
- [ ] `div[disabled]` ⇒ provably-invalid, app-declared tier (R-2 pin)
- [ ] Form control in first legend of disabled fieldset ⇒ qualified (R-3 pin)
- [ ] Disabled button with `cursor:pointer` ⇒ provably-invalid (the case the old gates let through)
- [ ] aria-disabled role=button div ⇒ provably-invalid (app-declared tier recorded)
- [ ] Plain div, no facts ⇒ qualified Click (the flip from today's Unclassified)
- [ ] Click-away on BODY with a surface closing ⇒ still a qualified Click card (B3 S4 preserved)

**Runtime pre-gate (integration)** (R-1)
- [ ] Disabled `button[aria-expanded]` must **NOT** become Expander (the R-1 pin)
- [ ] Provably-invalid click completes an in-flight Hover (accepted side-effect pin, §8.2)
- [ ] 6F-M1 absorption of a provably-invalid trailing click retains verdict + causes on the member entry (accepted side-effect pin, §8.2)
- [ ] Stamping unchanged: invalid click still stamps `primary`; network attaches to the projected Unclassified card

**Pipeline (integration)**
- [ ] provably-invalid click: pending → projected Unclassified with `invalidityCauses`; no Click card
- [ ] qualified click: Click card; insufficiency marker present when applicable
- [ ] Projection carries persisted facts (no synthesized `disabled:false`)
- [ ] Inert-step pin (§13.1): with the wiring change absent, the recorded verdict is consumed by no layer (contract test)
- [ ] Ledger → panel → IR path shows no re-typing anywhere
- [ ] Real-Chrome validation: disabled/aria-disabled/inert/overlay-intercepted/body-click fixtures each land in the intended class, causes verifiable in the dump

**TDD sequence (build order)**
1. Pure verdict function — table-driven tests over every §4.2 row including the amended edges (zero-size-absolute-child, PE-re-enabled child, div[disabled], div-in-disabled-fieldset, legend exemption).
2. Per-fact capture tests with the stubbed hit-test probe.
3. Runtime pre-gate tests — R-1 pin first (disabled `button[aria-expanded]` never Expander).
4. Ledger/projection round-trip — legacy rows restore as qualified.
5. STOP integration — invalid ⇒ Unclassified with causes, no Click card, evidence still attaches.
6. Re-baseline the four pin suites (click-claim-affordance-7-4-m1, click-claim-wb-7-3, click-surface-6d1, core-definitions) + B3 census.
7. Real-Chrome fixture validation with dump verification.

**Contract pins updated (owner-visible list)**
- [ ] click-claim-affordance-7-4-m1 / click-claim-wb-7-3 / click-surface-6d1 / core-definitions — re-pinned to the new authority
- [ ] B3 census baseline re-run and re-documented

## 12. Known costs & honest limits

- **Over-inclusion until the response phase**: dead background/plain-leaf clicks become Click cards and IR CLICK steps. Accepted by direction; corrected later by owned-response demotion, not by filters here.
- **aria-disabled and `disabled`-on-non-native are app-declared, not platform-enforced** — a page may declare them and still handle clicks; such a click is demoted on the app's own word. Recorded as app-declared causes so the record can be audited.
- **fieldset restriction honesty (R-3)**: plain elements inside a disabled fieldset remain qualified — the platform gives them no semantics. Frameworks that rely on `fieldset[disabled]` styling to "disable" divs are invisible; deliberately not guessed.
- **inert is defensive tier**: Chrome suppresses trusted clicks on inert subtrees at hit-testing, so on a trusted event `inertSubtree` should never fire; if it does (retargeting/shadow edge cases), the record is still platform-honest.
- **elementFromPoint limits**: returns shadow hosts (bounded walk required), the `<iframe>` element for cross-frame points (probe inconclusive), and proves only topmost-hittability.
- **Framework-level disabling** (class-based, aria-hidden) remains invisible — `aria-hidden` hides from assistive tech, not from hit-testing; deliberately not guessed.
- **KR population shift**: Click count grows, Unclassified count shrinks; signature identity grammar unchanged but populations diverge across the boundary (§13).

## 13. Owner decisions — RESOLVED (2026-08-29, v1.2)

All four blocking decisions were analyzed read-only and ruled on by the owner. The rulings are final for this phase; an implementation may not silently reopen any of them.

### 13.1 Landing order — RESOLVED: two-step, wiring atomic (option b)

- **Step 1 (inert):** fact extraction + verdict computation + DomContext/ledger persistence + projection-truth fix (`createUnclassifiedFromLedger` stops synthesizing `disabled: false` and carries the persisted vector). Zero type-level behavior change; all existing tests and pins stay green, untouched. **[LANDED 2026-08-29]**
  - **Required inert-step contract pin:** a test asserting that **no layer consumes the verdict** in this step (NOISE_TYPES-pin style). Intermediate dumps showing `provably-invalid` causes on cards that still type as Click/Expander are pinned as inert and documented — they are not drift.
  - Real-Chrome **fact** validation (disabled / aria-disabled / inert / overlay-intercepted / body-click fixtures, dump-verified) runs in this step, while fact errors are still harmless.
- **Step 2 (wiring — one atomic change):** universal pre-gate (§8.1) + deletion of Click's inclusion-gate authority, together. Never separable: pre-gate without deletion leaves gate-1-claimable disabled buttons typed as qualified Clicks; deletion without the pre-gate reopens the R-1 hole at type level. Census baselines and the four pin suites re-baseline in this step, exactly once. **[LANDED 2026-08-29]**

### 13.2 IR exposure of qualified-insufficient clicks — RESOLVED: accept, no IR change (option i)

- Qualified-insufficient clicks reach IR as CLICK steps this phase. `NOISE_TYPES` is untouched; **no IR-bridge predicate is added.**
- Rationale: the insufficient population mixes dead background clicks with replay-necessary B3 S4 click-away dismissals, indistinguishable at capture time; excluding them without proof is the downstream filtering this spec forbids.
- **Named reopen condition:** if real-session IR noise proves materially harmful AND the ownership-stamp work (response-phase prerequisite) remains distant, a pinned IR-bridge presentation policy may be adopted — with a written removal condition (superseded by response-phase demotion), and explicitly as presentation, never as qualification.

### 13.3 KR baselines — RESOLVED: accept the population split; no migration, no version bump, no anchoring change

- Legacy `Unclassified` signatures go dormant → diverged, never evicted; occurrence history does not transfer; new `Click` signatures start at zero.
- **Required companion actions at implementation:** (1) a KR-hygiene note enumerating the dormant populations and their cause (vocabulary flip, not app change), so future divergence reads are diagnosable against a written record; (2) the empty-consequence-profile population minted by provably-invalid anchors recorded as a known accepted artifact, deferred to the negative-knowledge decision (V4).
- Migration inside frozen D1 signature keys remains forbidden.

### 13.4 Contextmenu scope — RESOLVED: included

- `contextmenu` stays in the pre-gate and the claim rule (same physical family, same facts, same predicates).
- Consequence accepted: background right-clicks flip from Unclassified (IR-dropped today) to qualified-insufficient Clicks → IR CLICK steps. Absorbed under §13.2 — not by a scope split, which has no consistent shape (verified across stamping, evidence windows, Hover terminals, ledger, and pin suites).

## 14. Relationship to the prerequisite studies

This spec implements the Clock-1 half of the two-phase capture. It requires **nothing** from the response-ownership work and can ship independently. The response phase (canvas/no-response demotion, response-qualified clicks) requires fact-level ownership stamps as proven prerequisite, and — per §8.4 — will be built as **the same authority's second instant on the same verdict record** (one record, dispatch + horizon close; provisional-lifecycle Shape B), never as a downstream filter. Capture remains the single qualification authority across both phases.

---

## Changelog

- **v1.2 IMPLEMENTED — Step 1 + Step 2 landed (2026-08-29).**
  - **Step 1 (inert)**: `src/tap/click-qualification.ts` (facts + `qualifyClick` verdict, injectable hit-test probe), EventTap attachment on click/contextmenu, `DomContext.clickQualification` additive type, ledger persistence + restore normalization, projection-truth fix (`createUnclassifiedFromLedger` derives `disabled` from facts, carries vector + `invalidityCauses`). 47 new unit tests; real-Chrome FACT matrix 10/10 (`.drytis/zz-clickqual/`).
  - **Step 2 (atomic wiring)**: universal pre-gate live in `ComponentRuntime.process` step 4 (reads the verdict, never re-derives; click/contextmenu with `provably-invalid` skip `tryDiscovery` entirely; entry stays pending → STOP projection mints Unclassified with causes); Click definition gate authority DELETED (`detectTrigger` unconditional claim; `isInteractiveElement`/`isInsideOpenSelectionSurface` imports removed). 8 wiring pins (`tests/runtime/click-qualification-step2-wiring.test.ts`) red→green; inert-step Part B rewritten to the Step-2 contract (consumer allowlist grows `component-runtime.ts`; identical-types pins inverted by design); re-baselined once: click-claim-affordance-7-4-m1 (4), click-claim-wb-7-3 (2), click-surface-6d1 (1), core-definitions (1), patterns (1), phase-6d0 (2), g2-tabindex (2), eventtap-affordance C3 (1), lifecycle-claim-probe-b3 (2). Real-Chrome BEHAVIORAL matrix 20/20 (`.drytis/zz-clickqual/zz-clickqual-step2.mjs` → `clickqual-step2-dump.json`): pre-gate totality verified in vivo (invalid rows pending, no claimType, no non-Unclassified claims), flips verified (overlay plain-div → Click, body canvas → Click + insufficient, span lift → Click), controls unchanged (live/PE buttons, legend-input R-3 exemption), platform-suppressed rows honestly absent (disabled native, fieldset input). Suite 5,096/5,096; tsc 8 pre-existing / 0 new; dist v10.9.0 rebuilt + zip mirrored. NOT published, NOT deployed (owner gate).
- **v1.2 (2026-08-29)** — §13 owner decisions resolved (read-only decision analysis accepted in full):
  - 13.1 landing order → two-step: inert facts first, then ONE atomic wiring change (pre-gate + gate-authority deletion). Inert-step no-consumer contract pin added to §11.
  - 13.2 IR exposure → over-inclusion accepted; `NOISE_TYPES` untouched; no IR predicate; named reopen condition recorded.
  - 13.3 KR → population split accepted, no migration/version bump/anchoring change; hygiene note + negative-knowledge deferral as required companion actions.
  - 13.4 contextmenu → included; background right-click IR consequence absorbed under 13.2.
  - Status moved from awaiting-approval to owner-approved. **No model, predicate, or boundary-table change in this revision.**
- **v1.1 (2026-08-29)** — amended per the implementation-readiness audit:
  - **R-1**: universal pre-gate before `tryDiscovery` (§8.1); accepted Hover-completion and 6F-M1 side effects pinned (§8.2); stamping declared unchanged (§8.3); pre-gate totality invariant (§10.8).
  - **R-2**: `disabledNative` restricted to natively-disableable tags; new app-declared fact/cause `disabledAttrNonNative` / `disabled-attr-non-native`.
  - **R-3**: `fieldsetDisabled` restricted to form-associated controls outside the fieldset's first legend.
  - **R-4**: `pointerEventsNone` is a resolved-target fact whose cause is joint-gated on `lifted && hitTest.miss`; raw-element PE:none is a defensive record, never a cause.
  - **R-5**: `zeroSizeLifted` demoted — recorded fact + insufficiency marker; auxiliary cause only jointly with `hit-test-miss`.
  - Single-authority invariant + Shape-B framing for the response phase (§1, §8.4, §10.7, §14).
  - Boundary table, test matrix, and TDD sequence updated; §13.1 landing-order constraint restated.
- **v1 (2026-08-29)** — initial spec from the capture-time exclusion-fact study.
