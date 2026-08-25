# 7.4-B2 — Typeable Combobox: Honest Decomposition (TextEntry + Click)

**Status:** DRAFT — awaiting owner review. No implementation has started.
**Date:** 2026-08-25
**Predecessors:** 7.4-M1 (affordance capture, `2cd31d1`), 7.4-B1 (Expander, `5140736`/`d525911`)
**Grounding:** independent audit 2026-08-25 (this session), verified against source,
pinned tests, and empirical runtime probes (real runtime + ledger + projection;
probe artifacts removed after the audit — results recorded in §2).

---

## 0. Decision requested from the owner

Approve this spec (three slices: **S1 substrate → S2a classification → S2b IR
honesty**), or amend. S2b is separable and can be declined independently — the
residual defect is then documented and queued instead of fixed.

---

## 1. Problem

A *typeable combobox* (W3C ARIA 1.2 pattern: `<input role="combobox"
aria-haspopup="listbox" aria-autocomplete="list|both">`, plus framework
descendants — MUI Autocomplete, AntD show-search, React-Select, native
`<input list>` datalist) is **one widget with two facets**: a typed query and a
selection. The runtime can only represent it as **one** interaction type — or,
in two of three user flows, as **zero** interactions.

### Grounding evidence (file:line, verified 2026-08-25)

- `src/definitions/dropdown.ts:43-47` — Dropdown (priority 20) triggers on
  `focus`; `detectTrigger` (line ~51) claims via `isDropdownTrigger` which
  returns true for `role=combobox` (`src/definitions/patterns.ts:276-283`).
- `src/definitions/dropdown.ts:~86` — `isInScope` returns true for same-element
  events → every `input` event on the combobox input is silently absorbed as a
  member event of the Dropdown lifecycle (`src/runtime/component-runtime.ts`
  step 3, same-element accumulating absorption).
- `src/definitions/text-entry.ts:27-39` — TextEntry (priority 50, also
  focus-triggered) never sees the event: discovery order is priority ascending,
  Dropdown claims first. The typed query has **no representation**.
- **Empirical probe results** (real `createRuntime` + `EvidenceLedger` +
  `projectInteractions`, production event ordering):

| Flow | Events (browser order) | Output today | Loss |
|---|---|---|---|
| A: type + click option | focus→input×n→mousedown→blur→click(option) | 1 Dropdown card, `selectedValue` set; **typed query absent from all metadata** | query lost |
| B: type + Enter + blur | focus→input→keydown(Enter)→input→blur | **ZERO cards** (lifecycle `interrupted` at flush, filtered by `completedOnly` — `projection-engine.ts:285`); only the Enter keydown later projects as one Unclassified | query AND committed value lost |
| C: type, click elsewhere | focus→input→mousedown→click(other)→blur | 1 Click card (the other button); Dropdown ends interrupted → query invisible | query lost |
| D: readonly combobox (OXD) | click→option click | 1 Dropdown card, confirmed selection | healthy — **must not regress** |
| E: plain input / datalist | focus→input→change→blur | 1 TextEntry card (typed + committed) | healthy |

### F4 — the SELECT-on-INPUT replay defect (pre-existing, latent)

Any Dropdown completed on a non-`<select>` element emits `IRAction.SELECT`:

- `src/generation/ir-bridge.ts:~58` (`Dropdown: IRAction.SELECT`),
  `extractInputValue` line ~332 (`selectedValue`).
- `src/execution/executor-content-script.ts:376-385` — `executeSelect` casts to
  `HTMLSelectElement` and reads `el.options` → **throws on INPUT** →
  `'Select failed'`.
- Playwright render path emits `selectOption('…')` — also invalid on non-select
  elements (`src/adapters/playwright/action-renderer.ts:80-83,180-186`).

So flow A **and flow D** (the readonly OXD family) both generate IR steps that
cannot replay. This is the same class of defect B1 eliminated for Expander
(TOGGLE sets `.checked`, a no-op on div/button → Expander maps to CLICK). The
honest IR for "open a list, click an option" is **two CLICKs**.

### Second steal found during this audit (new, verified)

`src/definitions/date-picker.ts:~46` + `src/definitions/patterns.ts:401-429` —
DatePicker (priority **10**, also focus-triggered) claims any INPUT whose
`name`/placeholder matches `DATE_NAME_HINT_RE` (word-bounded
`depart|return|onward|arrival`, substrings `date|birth|dob|expire|expiry|calendar`).
A typeable combobox with `name="arrival"` is claimed by DatePicker **before
Dropdown or TextEntry are ever consulted**. The unambiguous disambiguator is
already captured: `aria-haspopup` — W3C combobox-with-list uses `listbox`;
calendar popups use `dialog`/`grid` (MUI Desktop DatePicker input is
`role=combobox aria-haspopup=dialog`). A narrow, ARIA-based guard is therefore
possible without touching the name-hint vocabulary.

### Why not a dedicated `Autocomplete` InteractionType (shape (b), rejected)

Considered and rejected for this milestone: it requires the full B1-style L1–L5
ripple (union + registry + IR map + badge map + DDC-3 + TYPE_DISPLAY + count
pins), must still answer the IR question (SELECT is select-element-specific —
a truthful one-card mapping needs either a new IRAction or fill+click anyway),
collides conceptually with the existing enrichment `componentType: 'Autocomplete'`
(`src/enrichment/component-detector.ts:~65,125`), and rebuilds the hybrid inside
one type. Shape (a) reuses existing typed vocabulary, existing replay-safe IR
actions, and has no registry ripple at all.

---

## 2. Design

### Principles (inherited, restated)

1. **Honesty over fabrication** — the typed query and the selection are two
   distinct pieces of user intent; representing either one as the other (or
   dropping both) is the defect.
2. **Replay-correctness** — generated IR must be executable by the existing
   executors; a step that throws on the target's tag shape is worse than a
   plainer step that works (B1 precedent).
3. **Structural signals only** — no timing rules, no site tokens, no new class
   vocabulary. The claims/disclaimers below use tag + inputType + readOnly +
   ARIA attributes only.
4. **Vocabulary shrinks, never grows** — the guard *removes* INPUT-tag exposure
   of `DROPDOWN_TRIGGER_CLASS_RE`; no tokens are added anywhere.
5. **Boolean-valued / null-safe gates** (B1-12 lesson) — every new gate reads a
   field that may be `undefined` on legacy events; gates must treat `undefined`
   as "no signal", never as a positive claim.

### Slice S1 — capture substrate (zero behavior change)

Fill the **declared-but-unfilled** fields (the recurring lesson-4 sin; declared
in `src/recorder/recorded-event.ts:44-47`, filled only by the dead
`src/recorder/deterministic-recorder.ts:987-996`, invisible to the live
pipeline):

- `src/shared/component-types.ts` — add optional DomContext fields, exactly the
  7.4-M1 `pointerCursor`/`clickHandler` pattern:
  - `ariaAutoComplete?: string | null` — raw value of `aria-autocomplete`
    (`"list" | "both" | "inline"` in practice), `null` when absent.
  - `listId?: string | null` — raw value of `list` on `<input>` (native
    datalist association), `null` when absent.
- `src/definitions/dom-context-extractor.ts` — extract both attributes
  following the existing `ariaHasPopup` string pattern (attribute absent → do
  not set / set `null`; never `undefined` from the live extractor).
- No definition reads them in S1. No consumer changes. Suite must stay green at
  the grown count with **zero** behavioral pins changed.

### Slice S2a — typeable combobox → TextEntry (typed query) + Click (selection)

**The rule (structural):** *if the event target is a typeable entry field, the
typed query is TextEntry evidence.* A list that opens from it is opened by a
click that Click already represents; an option picked from it is a click that
Click already represents (via `role=option ∈ INTERACTIVE_ROLES`, gate 1 of
`click.ts`).

1. **Dropdown disclaims typeable inputs** — at the top of
   `dropdown.ts detectTrigger`:
   ```ts
   // 7.4-B2a: a TYPEABLE entry field's typed query belongs to TextEntry
   // (priority 50). The selection side falls through to Click discovery
   // (role=option is interactive). Readonly display-inputs (OXD family)
   // keep the Dropdown lifecycle.
   if (isTextEntry(tag, inputType, ariaRole, isContentEditable)
       && event.domContext.readOnly !== true) {
     return null;
   }
   ```
   - `isTextEntry` is the existing helper (`patterns.ts:563`) — INPUT with
     text/email/password/search/tel/url/number/null, TEXTAREA, `role=textbox`,
     contentEditable. No new vocabulary.
   - Exemptions preserved by construction: `readOnly === true` (OXD readonly
     combobox — Bug-2 fixtures), `tag === 'SELECT'` (native select — P11),
     DIV/span comboboxes (not typeable — 6D.1 W3f pin).
   - The guard covers ALL Dropdown claim paths for typeable inputs, including
     `DROPDOWN_TRIGGER_CLASS_RE` matches and `aria-haspopup='listbox'` on the
     input itself.
2. **W-A.3 option guard in Dropdown `detectTrigger`** — verified hazard
   (probe `wa3-hazard`): `isDropdownOption` is role-OR-class, and
   `DROPDOWN_TRIGGER_CLASS_RE` matches several option classes
   (`ant-select-item`, `select-option`, `oxd-select-option`). Once the
   S2a typeable-input guard above diverts the typeable combobox's focus to
   TextEntry, the *option* falls through to discovery at the option click —
   and **without** a guard, `isDropdownTrigger('LI', 'option',
   'ant-select-item')` is **true** (class match), starting a stray Dropdown
   lifecycle ON THE OPTION itself. This is the 6E-M2 W-A.3 hazard (cells whose
   class contains `datepicker` would start a DatePicker) applied to Dropdown —
   the same fix applies:
   ```ts
   // 7.4-B2a W-A.3: an OPTION-shaped target may COMPLETE a Dropdown
   // lifecycle (containment-proven selection, dropdown.ts:134-172) but
   // never START one. Without this guard, option classes that match
   // DROPDOWN_TRIGGER_CLASS_RE (ant-select-item, select-option,
   // oxd-select-option) start a stray Dropdown on the option at discovery
   // when the combobox's own lifecycle was diverted to TextEntry above.
   if (isDropdownOption(event.target.ariaRole, event.target.className)) {
     return null;
   }
   ```
   - Placed AFTER the typeable-input guard (1) and BEFORE any other claim path.
   - Does NOT affect today's behavior: on today's flows, the combobox Dropdown
     lifecycle already claimed the focus and the option click is *absorbed*
     by `isInScope`'s `isDropdownOption` branch — `detectTrigger` is never
     reached for the option at all. The guard only fires when the typeable
     combobox lifecycle was diverted (the new path) — the 6D.1 W3f, P11,
     Bug-2, and DIV-combobox fixtures all start the lifecycle on the
     trigger, never on the option.
   - Pinned by R2/R3 parity (DIV `role=combobox` trigger + option click
     under listbox → still Dropdown: the option is *absorbed*, never
     *discovered*; the guard is not consulted).
3. **DatePicker disclaims listbox popups** — at the top of
   `date-picker.ts detectTrigger`:
   ```ts
   // 7.4-B2a: aria-haspopup="listbox" is the W3C combobox-with-list popup
   // shape — never a calendar (calendars use dialog/grid). Prevents the
   // name-hint vocabulary (e.g. name="arrival") from stealing typeable
   // comboboxes at priority 10.
   if (event.domContext.ariaHasPopup === 'listbox') return null;
   ```
   - Deliberately NARROW: `role=combobox` alone is NOT declined (MUI Desktop
     DatePicker input is `role=combobox aria-haspopup=dialog` and must keep
     its DatePicker classification); `aria-haspopup='dialog'` keeps the
     existing `isDatePickerTrigger` dialog path.
4. **TextEntry needs no claim change** — `isTextEntry('INPUT','text',
   'combobox', false)` is already true; once Dropdown stops stealing, the
   focus lands on TextEntry through ordinary discovery ordering.
5. **Completion ordering is already correct** — browser order on option pick
   is `mousedown(option) → blur(input) → click(option)`:
   - TextEntry completes on the **blur** (`text-entry.ts:61-80`) with
     `typedValue` = last input sample (the query, e.g. `"New"`) and
     `textValue` = blur-committed value. The framework's post-selection value
     rewrite happens on the click, after blur, and fires no further events on
     the blurred input — so the card honestly carries query/committed as
     sampled.
   - The option `mousedown` is a different-target discrete event inside
     TextEntry scope → `lifecycleOwnsTarget` fails (TextEntry has no semantic
     children) → memberEvent push is undone → falls through
     (`component-runtime.ts` step 3 fall-through) → nothing triggers on
     mousedown → stays `pending`.
   - The option `click` → discovery → **Click** claims it (gate 1: `option ∈
     INTERACTIVE_ROLES`; or gate 2 LP1 open-surface for class-only options —
     the 6D.1 W3 tokens).
   - The pending option `mousedown` projects as `Unclassified(mousedown)` and
     is folded by `normalizeWorkflow` (same elementKey, precedes the Click
     within `GESTURE_WINDOW_MS`, `src/presentation/workflow-normalizer.ts:34`)
     — **the identical mechanism already applies today to every
     input-then-button flow**; verified empirically. Raw projection (tests,
     Verification Mode) shows it; the SW output view folds it. No change.
   - No gesture-record interaction: records are created only when a lifecycle
     *completes* on a mousedown; nothing completes on the option mousedown →
     no twin-absorption path is engaged.
6. **Keyboard commit (flow B) needs no new machinery** — the Enter `keydown`
   is a same-element discrete event absorbed by the active TextEntry
   lifecycle; when blur completes the lifecycle, the keydown is **claimed** as
   a member event. Output: exactly ONE TextEntry card (typed + committed), no
   Unclassified. (Today: zero cards.)
7. **Honest metadata surfacing** — `text-entry.ts buildResult` adds
   `comboboxSignal` when S1 captured a signal (values: the raw
   `aria-autocomplete` string, or `'datalist'` when `listId` present):
   ```ts
   const ariaAC = ctx.triggerEvent.domContext.ariaAutoComplete;
   const listId = ctx.triggerEvent.domContext.listId;
   const comboboxSignal =
     typeof ariaAC === 'string' && ariaAC !== '' ? ariaAC
     : typeof listId === 'string' && listId !== '' ? 'datalist'
     : undefined;
   ```
   `undefined` on legacy events (field absent) — never a fabricated signal.
   Panel: add a `TextEntry` case to `buildWhyBlock`
   (`src/sidepanel/understanding-badge.ts`) rendering
   `why: combobox input (aria-autocomplete=list)` only when the metadata is a
   non-empty string. Pure renderer addition; no engine import.
8. **Understanding layer benefits with zero changes** — TextEntry is already in
   `INPUT_INTERACTION_TYPES` (`episode-builder.ts:146-155`), so the typed query
   becomes a **parameter input** on the episode anchored by the option Click —
   strictly better for capability derivation than today's swallowed query.

### Slice S2b — IR honesty for INPUT-triggered Dropdowns (the readonly family)

S2a removes SELECT-on-INPUT for the *typeable* family by construction. The
*readonly* family (OXD display-input comboboxes) still completes as Dropdown on
an INPUT trigger — its IR must stop lying:

- `src/generation/ir-bridge.ts` — when `interaction.type === 'Dropdown'` &&
  `trigger.tag === 'INPUT'` (non-select) && `selectedValue` non-empty:
  emit **two steps** instead of one SELECT:
  1. `CLICK` on the trigger identity — description `Open the {name} list`.
  2. `CLICK` on the **completing option member event's target identity** —
     description `Select {selectedValue}`; `sourceEventId` = the option click's
     eventId (better assertion binding than the trigger's).
  - The completing option event is identified deterministically from recorded
    data: the last member event with `eventType === 'click'` whose target
    satisfies `isDropdownOption(role, class)`. For INPUT-triggered Dropdowns
    this always exists — the only completion path for that shape is the
    containment-proven option click (`dropdown.ts:134-172`); the native-SELECT
    path requires `tag === 'SELECT'`.
- `tag === 'SELECT'` Dropdowns keep single-step `SELECT` (replayable via
  `selectOption`/`executeSelect`) — parity pinned.
- Unconfirmed selections (`selectionConfirmed !== true`, no `selectedValue`)
  already carry no selection input; they keep today's shape.
- `src/presentation/output-adapter.ts` `toIRAction` (Dropdown → SELECT):
  verify consumers during TDD; mirror the two-step change **only if** a
  consumer executes its output (else leave and record as WARN — presentation
  shape, not the replay path).
- **No executor changes.** `executeSelect` stays for SELECT; CLICK already
  executes on any element shape.

### What deliberately does NOT change

- No new `InteractionType`, no registry change, no IR-action enum change, no
  DDC-3 change, no `DEFINITION_PRIORITIES` change, no `TYPE_DISPLAY` change.
- No changes to: `executeSelect`/`executeFill`, Dropdown's lifecycle/S3'
  containment machinery, evidence-collector, `DROPDOWN_TRIGGER_CLASS_RE`
  tokens, understanding pipeline (beyond natural ripple), KR writers.
- No capture of `aria-controls` / `aria-activedescendant` in S1 (new
  declarations beyond the legacy-designed pair — deferred; `aria-activedescendant`
  is already read for value capture at `identity-extractor.ts:421` and stays
  value-only).
- No keyboard-commit IR step: after S2a, flow B yields an honest TextEntry card
  whose typed/committed pair is recorded, but no IR step presses Enter. A
  generic "Enter-commit" step is a future slice if the owner wants it — not
  fabricated here.

---

## 3. Regression constraints (must all stay green)

| # | Constraint | Guarded by |
|---|---|---|
| R1 | Readonly OXD combobox → Dropdown card, `noOpSelection` semantics (Bug-2 fixtures `core-definitions.test.ts:235-262`) | readOnly exemption in the guard + new pin |
| R2 | DIV/`role=combobox` trigger + option click under listbox → Dropdown (6D.1 W3f, `click-surface-6d1.test.ts:174-216`); W-A.3 option guard does NOT affect absorbed options (lifecycle claims via `isInScope`, never reaches `detectTrigger`) | guard scope: DIV not typeable + W-A.3 guard pin (S2A-8b) |
| R3 | Native `<select>` keyboard flow, P11 typed-wins (`dropdown-intermediate-change.test.ts`) | guard scope: SELECT not typeable + pin |
| R4 | DatePicker family — react-datepicker shapes, OXD date inputs, `aria-haspopup=dialog` (6E-M2 house regression 28/0) | narrow listbox-only guard + new pins |
| R5 | Expander no-steal ordering + boolean gates (`expander-claim-7-4-b1.test.ts`) | untouched; suite gate |
| R6 | 6F-M1 gesture ownership / WARN-4 supersession (8/0) | no mousedown-completions introduced; house regression |
| R7 | 7.4-M1 affordance Click gates (12/0) | untouched; house regression |
| R8 | Plain-input TextEntry flows incl. 6C dual-sample (`text-entry-6c.test.ts`) | TextEntry claim logic untouched; metadata addition is additive — if any deep-equal pin exists, correct pin+code in the SAME commit and log it (6F-M1 lesson) |
| R9 | `input[list=]` datalist → TextEntry (unchanged shape) | pin |
| R10 | Workflow normalizer folding of stray mousedown Unclassified (`workflow-normalizer.test.ts` 21 tests) | untouched; integration pin exercises the fold end-to-end |
| R11 | Enrichment on all new card shapes renders (component-detector never crashes on combobox inputs) | E2E assertion |
| R12 | `DROPDOWN_TRIGGER_CLASS_RE` token list byte-identical before/after | doctrine pin (source parse) |

---

## 4. Acceptance criteria

### S1 — substrate
- [ ] **S1-1** `extractDomContext` returns `ariaAutoComplete` = raw attribute
      value (`'list'`, `'both'`, `'inline'`, any string) when present, and the
      field is absent/`null` when the attribute is missing (jsdom pin).
- [ ] **S1-2** `listId` extracted from `<input list="…">`; absent/`null`
      otherwise (jsdom pin).
- [ ] **S1-3** DomContext interface accepts both fields; `tsc` error count
      remains exactly 8.
- [ ] **S1-4** Zero behavior change: full suite green at the grown count; no
      existing pin modified.

### S2a — classification
- [ ] **S2A-1** `focus` on `<input role=combobox type=text>` (not readonly)
      starts a **TextEntry** lifecycle, not Dropdown (`activeCount` 1, type
      TextEntry).
- [ ] **S2A-2** Flow A (type + option click, production event order incl.
      blur between mousedown and click) → exactly: 1 TextEntry card
      (`typedValue` = query, `textValue` = committed-at-blur) + 1 Click card
      (option, `targetName` = option name) + 0 Dropdown cards; option click
      `claimed`; raw projection contains the option mousedown as
      Unclassified and `normalizeWorkflow` folds it (two-layer pin).
- [ ] **S2A-3** Flow B (type + Enter + blur) → exactly 1 TextEntry card; the
      Enter keydown is a claimed member event; 0 Unclassified cards;
      `typedValue` = query, `textValue` = final committed value.
- [ ] **S2A-4** Flow C (type + click elsewhere) → 1 TextEntry card (query
      preserved) + 1 Click card (the other button).
- [ ] **S2A-5** Readonly combobox (`readOnly: true`, OXD fixture shape) →
      still Dropdown with containment-proven completion (R1 pin, mirrors
      Bug-2 fixture).
- [ ] **S2A-6** DIV `role=combobox` trigger + option click under
      `div[role=listbox]` → still Dropdown (R2 pin).
- [ ] **S2A-7** Native `<select>` change/blur flow → still Dropdown,
      `selectedValue` = final choice (R3 pin).
- [ ] **S2A-8** Typeable INPUT whose own class matches
      `DROPDOWN_TRIGGER_CLASS_RE` (e.g. `class="selector"`, not readonly) →
      TextEntry, not Dropdown (guard covers the class claim path).
- [ ] **S2A-8b** W-A.3 option guard: an option-shaped target (`role=option`
      OR option class) whose class also matches `DROPDOWN_TRIGGER_CLASS_RE`
      (e.g. `ant-select-item`, `select-option`, `oxd-select-option`) does
      NOT start a stray Dropdown lifecycle when the typeable combobox's
      focus was diverted to TextEntry. Option click → Click discovery (gate
      1 role or gate 2 LP1), not Dropdown.
- [ ] **S2A-9** `<input aria-haspopup="listbox" name="arrival" type=text>` →
      NOT DatePicker (listbox guard) → TextEntry; AND
      `<input aria-haspopup="dialog">` (MUI-datepicker shape) → still
      DatePicker.
- [ ] **S2A-10** `comboboxSignal` metadata: present with the raw
      aria-autocomplete value / `'datalist'` when captured; absent on legacy
      events whose DomContext lacks the fields (boolean-valued lesson).
- [ ] **S2A-11** Panel why-block renders `why: combobox input
      (aria-autocomplete=list)` for signaled TextEntry cards; renders nothing
      for unsignaled ones.
- [ ] **S2A-12** Doctrine pin: `DROPDOWN_TRIGGER_CLASS_RE` source token list
      unchanged (R12); no new class/keyword vocabulary introduced anywhere in
      `src/definitions/`.

### S2b — IR honesty
- [ ] **S2B-1** Dropdown completed on INPUT trigger (readonly OXD fixture) →
      IR plan = [`CLICK` trigger ("Open the {name} list"), `CLICK` option
      ("Select {selectedValue}")]; no `SELECT` step for INPUT triggers.
- [ ] **S2B-2** Step-2 target identity = the completing option member event's
      captured identity; step-2 `sourceEventId` = the option click eventId.
- [ ] **S2B-3** Dropdown on `tag === 'SELECT'` → single `SELECT` step with
      `selectedValue` input (parity pin).
- [ ] **S2B-4** Executor: the two CLICK steps execute against the content-script
      executor without error (jsdom pin using `executeAction('click')` path);
      `executeSelect` unchanged.
- [ ] **S2B-5** `output-adapter.toIRAction` consumer audit recorded in the
      closure notes: mirrored if (and only if) an executing consumer exists.

### Cross-cutting
- [ ] **X1** Full suite green at the grown count (baseline 286 files / 4,715
      tests @ `d525911`); `tsc` exactly 8 errors.
- [ ] **X2** House regressions green: 6E-M2 8/0, 6F-M1 9/0, 7.4-M1 16/0,
      B1 expander pins.
- [ ] **X3** Real-Chrome E2E on a generic fixture `public/combobox-validation.html`
      (vanilla W3C combobox with `aria-autocomplete=list` + listbox filtering,
      an autocomplete-class variant, a readonly OXD-style variant, a native
      datalist input): type+click, type+Enter, abandon flows → correct card
      types/counts, IR plan contains FILL+CLICK (no SELECT on INPUT) and
      CLICK+CLICK for the readonly variant, panel badges render, zero console
      errors.
- [ ] **X4** Build + ZIP four-way identical (root/download/serve/preview),
      md5 recorded in closure evidence.
- [ ] **X5** Reviewer + infra_verifier PASS; owner gate; two-commit closure
      (src+tests+fixture / spec+evidence+roadmap+handover).

---

## 5. Test plan (red-first)

**Unit (vitest/jsdom):**
- `tests/definitions/dom-context-extractor-7-4-b2.test.ts` — S1-1..S1-3.
- `tests/definitions/combobox-typeable-7-4-b2.test.ts` — S2A-1..S2A-10b, R1/R2/R3
  parity pins; house `makeObservedEvent` fixture style; ledger appended per
  event (production shape). Includes a W-A.3 guard pin: typeable combobox
  focus→option click with an option-class that matches
  `DROPDOWN_TRIGGER_CLASS_RE` → Click card on the option (NOT Dropdown on the
  option).
- `tests/sidepanel/understanding-badge-combobox-7-4-b2.test.ts` — S2A-11 (+
  P4c fs-parse map unchanged — no priority edits).
- `tests/ir/dropdown-input-replay-7-4-b2.test.ts` — S2B-1..S2B-4.
- `tests/doctrine/vocabulary-freeze-7-4-b2.test.ts` — S2A-12 (R12).

**Integration:** ledger + runtime + projection + normalizer end-to-end for
flows A/B/C (S2A-2/3/4 at the SW-shape level, including the mousedown fold).

**E2E (real Chrome):** X3 fixture + harness in the B1 style (`:8242`-style
zero-dependency server + `node:http` probe; panel-DOM assertions after
post-STOP panel reload; fixture and harness in the same shell invocation).

**House regressions:** X2 list, run from the standing evidence harnesses.

---

## 6. Accepted costs (owner-visible, pinned in closure)

1. **Typeable-markup-but-used-as-pure-dropdown** (user never types; MUI
   Autocomplete used as a plain select): output changes from 1 Dropdown card
   to 2 Click cards (open + option). The card is plainer, but the IR becomes
   *replayable* (today it is a guaranteed-failing SELECT). Honesty +
   replay-correctness over card prettiness — the B1 trade, again.
2. **KR signature fragmentation** for typeable-combobox flows previously typed
   Dropdown: `signatureKey` hashes `actionType` verbatim (FROZEN v1) → cold
   restart, demote-not-destroy, no backfill. Same accepted cost class as B1.
3. **Raw projection shows the option mousedown** as an Unclassified card until
   the normalizer folds it — identical to the existing input-then-button
   behavior; Verification Mode (raw compare) sees it by design.
4. **Keyboard-commit has no IR step**: flow B records honest typed/committed
   values but no Enter step is generated (documented gap, future slice).
5. **DatePicker guard is deliberately narrow**: `role=combobox` without
   `aria-haspopup` on a name-hinted input still goes to DatePicker
   (pre-existing overlap, out of scope, documented).

---

## 7. Risks / mitigations

- **Guard too broad?** A typeable INPUT with dropdown-ish classes that is
  genuinely a filter box: under the guard its typed query surfaces as
  TextEntry — which is the honest representation of the typing either way.
  Mitigated by R1–R3 parity pins and E2E coverage of all four fixture shapes.
- **Metadata ripple on TextEntry consumers**: additive key only; deep-equal
  pins (if any) corrected in-commit with a logged spec-note (6F-M1 lesson).
- **Two-step IR emission changes generated artifacts** for INPUT-Dropdowns:
  pinned (S2B-1..4), Playwright renderers already handle CLICK steps; step
  count per interaction is new surface — assertions bind step-2 to the option
  eventId, which strengthens (not weakens) evidence linkage.
- **Registry untouched** (unlike B1) — but the full-suite gate runs anyway
  after every slice (B1 lesson: always full-suite).

---

## 8. Closure

Two-commit closure after owner gate: (1) src + tests + fixture; (2) spec
checkboxes + E2E evidence dir (`.drytis/notes/evidence/phase-7-4-b2-e2e-*` with
PROVENANCE incl. ZIP md5) + ROADMAP entry + HANDOVER refresh. Publish remains
owner-gated and separate.

**Out of scope (queued):** Enter-commit IR step; `aria-controls` /
`aria-activedescendant` capture; child-held `aria-expanded` (B1 accepted
cost); Modal B-slice (still no live repro); Tab-by-class; icon-child names;
submit ledgering; dead `aria-value*` fields; `DROPDOWN_TRIGGER_CLASS_RE` token
shrink (standing debt, now with reduced INPUT exposure).
