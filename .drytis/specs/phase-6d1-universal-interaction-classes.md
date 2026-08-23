# Phase 6D.1 — Universal Interaction Classes & Semantic Selector Expansion

**Status:** IMPLEMENTED & VERIFIED (2026-08-23) — awaiting owner gate for commits. Suite 254 files / 4464 tests green; tsc at the 8-error baseline; doctrine pin green; reviewer PASS (all unit ACs, 5 WARNs addressed); infra_verifier PASS (0 failures); real-Chrome E2E 16/16 PASS + KR Dexie probe PASS. Evidence: `.drytis/notes/evidence/phase-6d1-e2e-2026-08-23/`.
**Baseline:** `92de517` (capability-surgical-removal, 11 commits ahead of origin, unpushed)
**Predecessors:** 6D.0 surface vocabulary (`568adfe`), 6A+6C (`bd8e907`), 6B (`72bb6ed`), U1–U5, doctrine pin (`153f5c2`), full-pipeline audit of `92de517` (clean — `.drytis/notes/evidence/full-pipeline-audit-92de517-2026-08-22/`)
**Roadmap source:** `.drytis/notes/ROADMAP-2026-08-22.md` §Phase 6 — 6D.1 + 6E-slice.

---

## 0. Owner directive (2026-08-23)

Spec 6D.1 first, covering the two audit-confirmed gaps:

1. **notification/status-badge semantic selector expansion** (the L4 remainder folded out of 6B — owner decision 2026-08-22, AC5 fold record);
2. **#id-only counter seeding + options-list click classification** (the two unclassified/missing-observation cases confirmed in the `92de517` full-pipeline audit, both matching archived baselines).

And explicitly preserve the existing architecture and genericity doctrine (§5). This spec is the gate: nothing below ships until the owner ticks the approval box.

---

## 1. Problem statement (all evidence-anchored)

### Gap 1 — Notification/status-badge selector surface is thin

`page-content-config.ts` `DEFAULT_SEMANTIC_SELECTORS` has exactly **2 notification** selectors (`[role="alert"], [role="status"]`; `[data-testid*="toast" i], [class*="toast-message" i]`) and **2 status-badge** selectors (`[class*="badge" i][class*="status" i], [data-testid*="status" i]`; `[class*="pill" i], [class*="chip" i]`). Real conventions the audit app and industry UIs actually use are missing:

- status text via `[aria-live]` (polite/assertive) — the W3C-native announcement channel;
- toast/snackbar containers and messages via `[class*="snackbar" i]`, `[class*="toast" i]` (current one requires the *compound* `toast-message`);
- status pills via `[data-state]` / `[aria-selected]`/`[aria-expanded]`/`[aria-current]` state-attribute convention — the audit app's badge is exactly `class="state-badge state-pill" data-state="idle"→"planned"` and IS matched today only because `pill` appears in the class;
- badge containers via `[role="status"]` where the status ROLE is present but class tokens are absent.

Risk if expanded naively: `[class*="pill" i]` and `[class*="chip" i]` already over-match (any Chip in a MUI app). The expansion must **narrow where it adds breadth** — new selectors must be as specific as or more specific than existing ones, and any compound already covered must NOT be duplicated (first-match-wins per element is per-family kind, not global).

### Gap 2 — `#id`-only counters never seed (audit: classic `p#result-count` "0 tickets" → "2 tickets" produced no counter observation)

Root cause chain (audit + code read):
1. The app updates the counter with `el.textContent = "2 tickets"`.
2. `dom-observer.ts` childList handling (line ~623) counts added/removed nodes; a textContent assignment is a net-zero childList swap (1 removed text node + 1 added text node) and — because the `characterData` mutation is on the *text node*, not the parent `<p>` — does not surface as a `characterDataDelta` on the parent summary.
3. `changed-element-seed.ts` line ~243: `else if (added === removed)` → "Net-zero churn (mount/unmount swap) with no other signal — drop." Kinds array empty → no candidate.
4. Result: the DOM change stays in raw `domChanges` evidence (honest — not lost) but produces **no seeded observation**, so no counter assertion in IR ("N tickets" never checked) and no KR counter row.

This is the O8 finding from the archived multipattern baseline, restated: #id-only counters match no selector family. But 6A's seed machinery now exists — the gap is the classifier's **net-zero-churn gate**, which was designed to drop mount/unmount churn but also drops exactly the text-swap shape a counter update produces.

### Gap 3 — Options-list click lands Unclassified (audit: reactish typeahead `li.opt` inside `ul.options-list[hidden]`)

Root cause chain:
1. `click.ts` `detectTrigger` rejects non-interactive targets unless `isInsideOpenSelectionSurface(ancestorRoles, ancestorClasses)` (6D.0, S6/LP1).
2. `patterns.ts` line ~206: `OPEN_SELECTION_SURFACE_CLASS_RE = /(listbox|dropdown|popover|overlay|modal|dialog|flyout|menu|popup|...)/i` — `options-list` contains none of these tokens.
3. `li.opt` has no interactive tag/role/tabindex/class → rejected → falls to Unclassified with `unclaimed-at-projection`.
4. Dropdown definition could not claim it either: `isDropdownOption(role, class)` needs `role=option` or class matching `/(oxd-select-option|select-option|option-item|list-option|ant-select-item)/i`; `opt` matches none; and there is no open-Dropdown lifecycle at all (the typeahead is not a dropdown trigger).

The user intent ("selected Bengaluru from the suggestions") is lost; the generated IR step carries no semantic meaning; the TextEntry carries the committed value (6C) but the selection act itself is unnamed.

### Carried scope from the roadmap (in 6D.1 per owner)

- **DatePicker positive wiring** — `DATE_CELL_NAME_RE` exists (`patterns.ts:408`) and Dropdown excludes date cells (`dropdown.ts:139`), but the DatePicker definition itself has no positive trigger/completion path that USES the name shape. Reactish `.date-input` triggered DatePicker only via `isDatePickerTrigger`'s class check (`date-input` matches `DATEPICKER_TRIGGER_CLASS_RE` — check at implementation time; if class-based it's fragile and the name-shape wiring is the durable fix).
- **Filter-chip definitions** — no definition exists for chip-toggle interactions (aria-pressed / aria-selected / data-state toggles). Fold into W1's status-badge work where selectors overlap; the definitions layer gets a `Toggle`… → decision point §3 W4.
- **Flight-card entity recognition via identity attrs** — already partially live via entity co-occurrence selectors (`[data-auto-id][data-sku]` etc.). 6E-slice clone harness adds the widgets; verify breadth, don't add selectors yet.

---

## 2. Design principle (doctrine constraints, unchanged)

- **Deterministic-first, AI-last.** All new recognition is structural DOM facts (roles, attributes, class conventions, name shapes). Zero timing rules. Zero DOM probing at classification time (resolution stays path-structural).
- **Site-agnostic engine.** Every new token passes the genericity tripwire (`tests/doctrine/genericity-pin.test.ts` — comment-only citations allowed; engine tokens must be convention tokens, never site tokens). The token list grows only with GENERIC conventions: `aria-live`, `data-state`, `snackbar`, `toast`, `options`, `suggestion`, `combobox-popup`, `listbox` — none are site names.
- **Additive-only where possible.** New selectors append; existing selector strings are byte-identical (STAB pins exist for family outputs — `tests/understanding/page-content-alt-testid.test.ts`, seeded-scan tests). Widening a selector = re-specced change with new pins.
- **No capture/projection/ledger changes.** 6D.1 touches `src/understanding/page-content/*` (config, seed classifier, observer resolution), `src/definitions/*` (click/dropdown/DatePicker patterns), and matching tests ONLY. EventTap (`src/tap/event-tap.ts`), evidence-collector window semantics, Evidence Ledger, projection engine ordering, and NOISE_TYPES are **out of scope** — one exception below (§3 W2) which is a classifier-input shape, not a capture semantic.
- **KR is read-only from the UI.** No KR writes from the panel/repository pages. KR signatureKey v1 stays frozen.
- **Understanding never leaks into generation incorrectly.** Seeded observations flow via the existing `resultingState → assertion-derivation` path (6A contract). No new generation-layer imports.
- **Owner gate before commits.** Full MS discipline: implementation → reviewer → infra_verifier → real-Chrome evidence → owner gate → commit.

---

## 2.1 Authorized touch surface (the ONLY files 6D.1 may modify)

| File | Work item |
|---|---|
| `src/understanding/page-content/page-content-config.ts` | W1 selector expansion (notifications, status-badges) |
| `src/understanding/page-content/changed-element-seed.ts` | W2 net-zero-churn text-swap → counter/text candidate |
| `src/understanding/page-content/page-content-observer.ts` | W2 resolution guard (if needed for text-swap anchor) |
| `src/definitions/patterns.ts` | W3 option/suggestion surface vocabulary + W4 date-cell positive wiring |
| `src/definitions/click.ts` | W3 claim path (via patterns helper — click.ts logic unchanged unless required) |
| `src/definitions/date-picker.ts` | W4 positive trigger/completion wiring |
| `src/definitions/dropdown.ts` | W3 option claim (containment proof reuse) |
| `tests/**` | new pins + regression suites |
| `.drytis/**` | spec updates, evidence, roadmap |

Any file outside this list requires an explicit scope-change approval before edit.

## 2.2 Explicitly OUT of scope (protected surfaces)

- `src/tap/event-tap.ts`, `src/tap/evidence-collector.ts` (window/settle semantics), `src/tap/dom-observer.ts` capture shape, `src/runtime/projection-engine.ts`, `src/shared/behavioral-evidence-types.ts` (types are the wire contract), Evidence Ledger, NOISE_TYPES.
  - *Exception note:* if W2 analysis shows the net-zero text-swap cannot be recovered from `DomChangeSummary` facts as captured today, the fallback is a **read-only resolution-time probe** inside the seed resolution (structural, at scan time — already the resolution model), NOT a capture change. Capture changes need a new phase scope.
- KR persistence schema (v3), signatureKey derivation, `session-element-harvest`, healing, locator tiers (all 6B-verified).
- Executor/renderer family logic (6B-verified; PARITY pins).
- `page-content-wire` types.

## 2.3 Architecture decision record (pre-committed)

1. **Selector expansion adds selectors; it does not widen existing ones.** Each new selector string is a NEW entry in the family list. `[class*="pill" i]` / `[class*="chip" i]` stay byte-identical.
2. **Net-zero-churn relaxation is shape-gated, not tag-gated.** W2 relaxes the gate ONLY when the swap is a single-text-node child swap (`added === removed === 1`) on the same target AND the new text (or old text) carries a counter/semantic shape. Mount/unmount of ELEMENTS stays dropped. Element-churn stays dropped.
3. **The options-list claim is a Click (fallback tier), not a new definition.** `li.opt` in an open suggestion surface claims as Click with enriched metadata (targetName from the option text). No new InteractionType enum member. The Dropdown definition's containment-proof machinery is reused only if an open Dropdown lifecycle actually exists (it does not in the typeahead case).
4. **dataAutoId fuzzy matching stays OUT** (owner: future 6D/7.1 backlog — roadmap already records this).
5. **`deriveAppId` path-sensitivity stays OUT** (audit observation; 7.x review, needs its own phase — changing appId derivation would fragment existing KR rows).
6. **Reviewer WARN resolutions (2026-08-23, implementation-stage):**
   - Snackbar ships as `[class*="snackbar" i]:not([class*="snackbar-container" i])` — accepted deviation from §3 W1's bare token: the `:not()` mirrors the guard pattern already used by the entity entries, and the unit/E2E pins lock the behavior (containers stay unmatched).
   - W4 placeholder arm carries the §4.3 INPUT gate (`tag === 'INPUT'`), pinned by a dedicated test.
   - W3 runtime pin asserts `metadata.targetName === 'Bengaluru'`.
   - W2 parity: `isNonCounterShapedText` (the classifier's own NON_COUNTER_NUMERAL_RE) is exported and applied at text-swap resolution, so date/duration shapes ("22 Aug", "02h 30m") cannot claim counter — same exclusion as the characterData path.

---

## 3. Work items

### W1 — Notification & status-badge selector expansion (page-content-config)

**Add to `notification` family** (after existing entries — order matters only within family):
- `[aria-live]` — W3C announcement channel (polite/assertive/any). Extract text, visible-only.
- `[class*="snackbar" i]` — Material/snackbar convention.
- `[class*="toast" i]` as a standalone simple entry (today only compound `toast-message`); accept over-match risk? → **Decision: keep standalone `toast` OUT** (over-match on toast containers/holders); add `[class*="toast" i]:not([class*="toast-container" i]):not([class*="toast-holder" i])`? → **No** — `:not()` chains on substring classes are fragile. **Final: add `[class*="toast-message" i], [class*="toast-body" i], [class*="toast-content" i]` as ONE new entry** — message-bearing children only, matching the existing entry's intent.
- `[role="log"]` — W3C live region for append-only logs (chat/feeds). Low volume, high precision.

**Add to `status-badge` family:**
- `[data-state]` — the generic state attribute convention (Vue/Alpine/htmx/audit app). Must be text-bearing and visible; a `data-state` holder with no text stays unmatched.
- `[aria-pressed]` — toggle-button state surface (chip/toggle).
- `[aria-current]` — nav/current-item state.
- `[aria-selected="true"]` — selected option/tab state (only when the element itself has text — a bare container stays unmatched).

**Rules:** every addition is a new family entry (no string edits to existing entries); `extractNumeric` false for badges; text-bearing/visible gates enforced by the existing observer scan (verify in tests); STAB pins assert existing family outputs byte-identical.

**Acceptance criteria:**
- [x] AC-W1a: new notification entries match `[aria-live]`, `[role="log"]`, snackbar class, toast message/body/content class — pinned with 4 unit fixtures (one per convention).
- [x] AC-W1b: new status-badge entries match `data-state`, `aria-pressed`, `aria-current`, `aria-selected=true` — 4 unit fixtures.
- [x] AC-W1c: STAB — existing selector outputs for the archived fixture corpus byte-identical (extend `page-content-alt-testid.test.ts`'s STAB approach or add a new pin file).
- [x] AC-W1d: negative pin — `data-state` element with empty text does NOT produce an item; `[class*="toast" i]` container-only element does NOT produce an item (no new entry matches it unless message-bearing).
- [x] AC-W1e: genericity tripwire green (tokens are conventions, not sites).
- [x] AC-W1f: real-Chrome — the audit app's state-badge (`data-state="planned"`, class pill+state-badge) still seeds as status-badge (today via `pill`; must not regress), AND a new `[aria-live]` toast fixture produces a notification item.

### W2 — `#id`-only counter seeding (changed-element-seed + observer resolution)

**Classifier change (`changed-element-seed.ts`):** the net-zero-churn branch gains a shape exception:

```
added === removed === 1 && target carries text (via a NEW fact) → evaluate as text-swap
```

Problem: the summary for a `textContent` swap on the PARENT may carry neither `characterDataDelta` (that fires on the text node's own summary) nor a usable text fact for the new node. Options analyzed:
- (a) Require `characterDataDelta` — fails for the parent-summary shape (audit case) → insufficient.
- (b) Use `addedNodesCount/removedNodesCount === 1/1` + resolve-time text read: classifier emits a `text-swap` candidate kind carrying NO text; resolution (observer) reads the element's current text structurally (existing `extractText`) and applies the SAME noise/kind gates (transient vocab, numeric shape, identity-coordinate rung 7). Honest skips preserved (changed text no longer present → skip).

**Chosen: (b)** — classification stays pure (no DOM reads), resolution stays structural at scan time. This respects the module contract ("NOT a selector engine"; resolution owns DOM facts).

**Resolution change (`page-content-observer.ts`):** for a `text-swap` candidate, use the existing resolution pipeline with one addition: the anchor is the ELEMENT's path (already resolved structurally); after resolution, if the resolved element's text parses numeric (`extractSeedNumeric`) → `counter` with numericValue; else if text ≥ MIN_TEXT_LENGTH → apply notification/status-badge gates (identity-coordinate rung 7 required). Counter does NOT require an identity coordinate TODAY in the seed path (numeric shape is the signal — check `pickSeedKind`'s counter branch: `facts.numeric != null || ariaLabel == null` → counter). Confirm at implementation: `#result-count` has an own #id → the identity-coordinate ALSO holds, so rung 7 is satisfied either way for the audit case. Keep the no-coordinate counter allowed only when the numeric shape is verified (existing rule — don't widen).

**Acceptance criteria:**
- [x] AC-W2a: unit — `textContent` swap on a `p#counter` ("0 tickets" → "2 tickets") produces a `counter` seed candidate and, in the seeded-scan test, a `counter` observed item with numericValue 2, matchedSelector `changed-element-seed`, uniqueInSnapshot true (own #id).
- [x] AC-W2b: unit — same shape on an element with NO identity coordinate and non-numeric text ("Search complete") produces NO item (rung 7 gate holds; honest skip).
- [x] AC-W2c: unit — element mount/unmount churn (added===removed===2, or element nodes not text) stays DROPPED (net-zero gate preserved for churn).
- [x] AC-W2d: STAB — existing seed tests (`changed-element-seed.test.ts`, `seeded-scan.test.ts`, `seeded-scan-honesty.test.ts`) unchanged and green (additive only).
- [x] AC-W2e: real-Chrome — classic run: click → resultingState carries counter "2 tickets" (kind=counter, numericValue 2) in addition to the existing collection item; IR gains a `toContainText`/value assertion on the counter; generated spec contains the counter assertion.
- [x] AC-W2f: KR — classic app's counters table gains the `p#result-count` counter row (verify via Dexie dump in the audit harness).

### W3 — Options-list / suggestion-surface click classification

**Vocabulary addition (`patterns.ts`):** extend `OPEN_SELECTION_SURFACE_CLASS_RE` with suggestion-family tokens: `suggestion`, `autocomplete`, `typeahead`, `options-list`. Analysis of each:
- `options-list` — exact convention the audit missed (generic: dozens of UIs name it this).
- `suggestion` — Google/Material/Firebase style (`suggestions-wrapper`, `pac-container` is site-ish — EXCLUDED).
- `autocomplete` — W3C `autocomplete` is an INPUT attribute, but as a class token it's the common container naming (`autocomplete-list`). Risk: an input with class `autocomplete` itself would match the surface test on the ANCESTOR scan only — the test is on ancestorClasses of the CLICKED element, so an input's own class can't self-promote. Bounded.
- `typeahead` — Bootstrap 5 typeahead convention.
- Also add `combobox-popup` and `listbox`-family role coverage: `OPEN_SELECTION_SURFACE_ROLES` already has `listbox`; add `combobox` (ARIA 1.2 combobox pattern pops a listbox, but some frameworks role the popup itself `combobox`)? → **Decision: do NOT add roles here.** The role set is for OPEN surfaces; `combobox` is the trigger role, not the popup. Class tokens only.

**Claim path:** `click.ts` `detectTrigger` already consults `isInsideOpenSelectionSurface` — no click.ts change needed if the vocabulary carries it. Verify with the audit app (`ul.options-list` + `li.opt`). The claim is plain `Click` with `targetName` from the option's text (`bestName` already reads className → will read the parent ul's `options-list`? — verify; if the name is poor, enrich `buildResult` metadata with the option text via existing domContext text facts — additive metadata only).

**Negative containment (P3 risk from RCA):** tokens are substring tokens like the existing ones; the same bounded-honesty argument applies (over-promotion yields a plain Click card, no fabricated semantics). Pin a negative: a `<div class="options-list-ad">` (ad banner)? `options-list-ad` CONTAINS `options-list` → matches → over-promotes. Substring anchoring is the pre-existing family style (existing `menu` matches `menu-item` etc.) — accepted convention, noted as P3-measured, not fixed here.

**Acceptance criteria:**
- [x] AC-W3a: unit — click on `li.opt` inside `ul.options-list` (no role) → Click definition claims it (detectTrigger passes via surface gate); metadata targetName = "Bengaluru" (or at minimum non-empty, from the option's own text).
- - [x] AC-W3b: unit — click on `li` inside a plain `ul` (no surface token anywhere) → still Unclassified (no regression of the honesty gate).
- [x] AC-W3c: unit — click inside `div.suggestion-container` and `div.typeahead-menu` → Click claimed (two more conventions pinned).
- [x] AC-W3d: real-Chrome — reactish run: the typeahead option click renders as a Click card (not Unclassified); IR step named by the option text; no Unclassified cards in the run (the DatePicker/TextEntry/Click set is the full card set).
- [x] AC-W3e: doctrine pin green (tokens: suggestion, autocomplete, typeahead, options-list — generic conventions).
- [x] AC-W3f: dropdown regression — native `#prio` select flow (dropdown-intermediate-change.test.ts) still completes as Dropdown, not Click (surface vocabulary must not steal dropdown options from an OPEN dropdown lifecycle).

### W4 — DatePicker positive wiring + filter-chip (carried roadmap items)

**DatePicker (`date-picker.ts` + `patterns.ts`):**
- Add a positive trigger path: text input whose accessible NAME matches the date-cell naming shape context? No — trigger wiring uses the input's OWN name (`placeholder`/`label` matching date vocabulary `DATE_NAME_RE`-style). Today `.date-input` triggers via class. Add name-shape trigger: input whose `placeholder` or accessible name matches `/(date|birth|dob|expire|expiry|calendar)/i` — WAIT, this exists at `isDatePickerTrigger` line 381 (`name` attribute hints). The audit app's input has `placeholder="Choose a date"` — placeholder is NOT the `name` attr. **Fix: extend `isDatePickerTrigger` to consult placeholder/aria-label text with the same vocabulary** (structural fact, no timing). This is the durable wiring vs the class match.
- Completion: existing typed-value tracking + blur completion already work (audit: DatePicker completed prio 10). No change.

**Filter-chip / toggle interactions (`definitions` — decision):** a bare "Toggle" definition risks over-claiming (every aria-pressed button would become Toggle). **Decision: NO new definition in 6D.1.** Chips with `aria-pressed`/`data-state` are claimed by Click (they're interactive tags) and their STATE change is captured by W1's status-badge selectors (the `data-state`/`aria-pressed` entries) — semantics flow through page-content, not a new type. Defer a dedicated Toggle definition to 6D.2+ with the P1 census data. This keeps the enum frozen (decision record #3) and avoids over-claiming.

**Acceptance criteria:**
- [x] AC-W4a: unit — input with `placeholder="Choose a date"` and no class/date-type hints → DatePicker triggers (name-shape path).
- [x] AC-W4b: unit — input with `placeholder="Search"` → NOT DatePicker (vocabulary gate precision).
- [x] AC-W4c: STAB — existing DatePicker fixtures (class-triggered, native type=date) unchanged.
- [x] AC-W4d: real-Chrome — reactish DatePicker card still prio 10, completed; the date value dual-sample (typed "08222026" → committed display) still lands in IR as 6C pins it.

---

## 4. Verification path (MS discipline, full gate)

1. **Stage 0 lock:** suite + tsc baseline at `92de517` (250 files / 4405 tests / 8 pre-existing tsc errors) — record numbers, protect STAB surfaces (list in §4.2).
2. **TDD:** every AC has its unit pin FIRST (red), then implementation, then green. Files: `tests/understanding/page-content-*`, `tests/definitions/patterns-6d1.test.ts`, `tests/definitions/click-surface-6d1.test.ts`, `tests/definitions/date-picker-name-trigger.test.ts`, plus STAB extensions.
3. **Full suite:** 250+ files green; tsc stays at exactly 8.
4. **dist build + static markers.**
5. **Real-Chrome E2E:** extend the full-audit harness (proven): classic run asserts the counter item (W2e) + KR counter row (W2f); reactish run asserts options-click card (W3d) + DatePicker (W4d) + state-badge non-regression (W1f); NEW minimal fixtures: `[aria-live]` toast, `data-state` badge with no class tokens, `suggestion`/`typeahead` surfaces. All logs + dumps archived under `.drytis/notes/evidence/phase-6d1-*/`.
6. **Reviewer:** spec-compliance + security (regex anchors, no timing rules, no site tokens) + doctrine containment (touch surface §2.1 respected).
7. **infra_verifier:** env-keys unchanged (none), services unchanged, dist fresh, preview reachable.
8. **Owner gate:** present evidence pack; commits only after approval. Two commits: src+tests; docs/spec/evidence (house style).
9. **No push** until owner says so.

## 4.2 STAB (protected surfaces)

- Existing selector family outputs (byte-identical) — extend the pinned corpus.
- `changed-element-seed` outputs for ALL existing shapes (net-zero churn of elements, mount/unmount, attribute churn) — the relaxation must be additive ONLY for the 1/1 text-swap shape.
- DatePicker class-trigger and native-type trigger paths.
- Dropdown containment/completion (dropdown-intermediate-change).
- 6B locator families and executor parity (untouched by this phase).
- IR/codegen outputs for the archived multipattern corpus (regression via existing tests + audit harness re-run).

## 4.3 Risks

- **Over-match on new badge selectors** (`data-state`, `aria-pressed`): bounded by text-bearing + visible + first-match-wins per kind; pinned negatives in tests. If real-site breadth shows noise, NARROW by requiring compound signals in a follow-up — never by deleting coverage.
- **Net-zero relaxation widening**: gated to added===removed===1 with text-shape evaluation at resolution; element churn pins stay dropped.
- **Substring over-promotion of new surface tokens** (`options-list-ad`): pre-existing anchoring family; measured at P3, accepted convention.
- **Placeholder-based DatePicker trigger false positives** (input with placeholder "date" in a form about dates): bounded by the vocabulary list and by DatePicker's priority (checked before Click fallback only when trigger matches; a false DatePicker claim steals a TextEntry — mitigate by requiring the input ALSO be text-type or have hasPopup hint? → **implementation decision: require tag INPUT + (type text|undefined) — verify against fixtures**).

---

## 5. Doctrine preservation statement (explicit)

The architecture rules in force are restated and honored by this spec:

1. **Site-agnostic engine** — all new tokens are generic conventions (aria-live, data-state, snackbar, toast-message, suggestion, autocomplete, typeahead, options-list, role=log); the genericity pin test must stay green; no site tokens enter `src/`.
2. **Deterministic-first, AI-last** — every change is a structural DOM fact or a pure-function classification; zero timing rules, zero classification-time DOM probing (resolution stays scan-time structural).
3. **No site-specific hacks** — see 1; `registerDomainSelectors` remains the ONLY site-specific extension point (unused by the engine defaults).
4. **No capture/projection/ledger changes without explicit phase scope** — this spec IS the scope: capture untouched (§2.2), projection untouched, ledger untouched. The one adjacent file (`changed-element-seed.ts`) is the understanding-layer classifier fed by already-captured summaries — within the 6A-established understanding scope.
5. **KR is read-only from UI** — no UI-driven KR writes; signatureKey v1 frozen; `deriveAppId` untouched.
6. **Understanding must not leak into generation layer incorrectly** — seeded items flow only via the existing 6A `resultingState → assertion-derivation` contract.
7. **Owner gate before commits** — §4.8; nothing commits without the owner's tick on the evidence pack.

---

## 6. Out of scope (explicit)

- dataAutoId fuzzy/alias-family matching (6D/7.1 backlog).
- `deriveAppId` path-sensitivity (audit observation → 7.x review).
- Raw toast/notification ASSERTION derivation beyond existing textMatch seeds (if a notification item exists, existing derivation handles it — no new derivation kinds).
- A dedicated Toggle/Filter-chip definition (deferred to 6D.2+ with P1 census).
- Flight-card entity selector breadth (6E-slice clone harness verifies; no new selectors this phase).
- Executor/renderer (6B-verified; parity frozen).
- KR maturity items (Phase 7).

---

## 7. Approval

- [x] Owner approves 6D.1 scope as specced (this file, §3 W1–W4, §2.1 touch surface, §2.3 decisions). — approved with the five §2.3 decisions frozen ("Proceed with Stage 0 and TDD for W1–W4").
- [x] Owner approves the two-commit plan (src+tests; docs). — "Proceed with the 6D.1 commit gate. Commit 1: src + tests only. Commit 2: spec/docs/evidence/roadmap only."
- [x] Owner confirms "no push until said". — "Do not push." (2026-08-23 commit-gate directive)

**Baseline for implementation:** `92de517` · suite 250/4405 · tsc 8 · dist v10.9.0.
**Shipped state:** 254 files / 4464 tests green · tsc exactly the 8 baseline errors · real Chrome 16/16 PASS (see `.drytis/notes/evidence/phase-6d1-e2e-2026-08-23/VALIDATION-RECORD.md`).
