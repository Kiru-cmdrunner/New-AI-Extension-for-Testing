# Phase 6E-M2 — react-datepicker Family Recognition (Definitions Layer)

**Status:** SHIPPED 2026-08-23 @ commit 1 `24e1340` + closure commit 2 (this tree) — owner gate APPROVED 10:02 UTC. Suite 255 files / 4,492 tests green; tsc exactly the 8-error baseline; real-Chrome E2E run 3: 8 PASS / 0 FAIL (one DatePicker per flow, zero Unclassified cell cards, 6B/6D.1 regressions green). Evidence: `.drytis/notes/evidence/phase-6e-m2-e2e-2026-08-23/VALIDATION-RECORD.md`. Residuals → 6F: click-twin (O11 family, Finding 2), KR dateValue mapping (Finding 4). Unpushed (per directive: no push).

**Baseline:** `317c527` (capability-surgical-removal, 14 commits ahead of
origin, unpushed). Suite 254 files / 4,464 tests green; tsc 8 pre-existing
baseline errors (`ir-executor-navigate` ×5, `ir-bridge-repeated-clicks`,
`resulting-state-seeded-display`, `changed-element-seed-honesty`).

**Predecessors:** 6D.0 (`68d831e`), 6A+6C (`bd8e907`), 6B (`72bb6ed`),
6D.1 (`476e086`), 6D.2 evidence-closed (`317c527`), 6E-M1 measurement
(`317c527`, evidence pack `phase-6e-m1-2026-08-23`), doctrine pin
(`153f5c2`).

**Roadmap source:** `ROADMAP-2026-08-22.md` §Phase 6 — 6E slice;
user-evidence loop "post-6D.1 → results-page recognition (O10)".

## §0 Owner directive

> "Approved with 6E-M2 as scoped" (2026-08-23 07:41 UTC), on the scope
> presented from evidence batches `user-batch-2026-08-23-0700` and
> `user-batch-2026-08-23-0724` (real AdaniOne DevTools outerHTML).

## §1 Problem

Real-site manual testing (batch 1) showed calendar date cells ("Choose
Saturday, September 5th, 2026") projecting as **Unclassified** on AdaniOne.
Batch-2 DevTools markup pinned three root causes against HEAD:

- **RC-A (trigger):** real wrapper class `date_picker` (underscore) fails
  `DATEPICKER_TRIGGER_CLASS_RE = /(oxd-date-input|datepicker|date-picker|date-input|calendar-input)/i`
  (substring `datepicker` ≠ `date_picker`); input class `withIcon
  form-control` carries no token; field names/placeholders 'Depart on' /
  'Return on' fail `DATE_NAME_HINT_RE = /(?:date|birth|dob|expire|expiry|calendar)/i`;
  input type=text; no aria-haspopup=dialog. DatePicker lifecycle never
  starts (real framework: **react-datepicker**, one of the most common
  React pickers — fix is library-generic, not site-specific).
- **RC-B (cell):** real class `react-datepicker__day` fails
  `DATEPICKER_CELL_CLASS_RE = /(oxd-date-day|calendar-day|datepicker-day|day-cell|flatpickr-day)/i`
  (`datepicker__day` double-underscore ≠ `datepicker-day` hyphen), while
  role=option alone is (correctly) insufficient. The 6D.0 W3C name-shape
  `hasDateCellName()` DOES match — shipped machinery, unused by the cell
  claim path.
- **RC-C (fallback):** 6E-M1 C6 measured that a cell with W3C name but
  unknown class falls to NOTHING on the real site (clone gave a plain
  Click because the clone cell was `.cal-cell` under an open listbox
  surface — LP1 claimed it; the real site's cells went Unclassified during
  SW recovery in batch 1 and will claim as Click once identity survives,
  but a cell with no open-surface ancestry and unknown class remains
  unclaimed-at-projection → honest Unclassified → IR-filtered).

The date FIELDS are already correctly captured (batch 1: TextEntry `Mon, 24
Aug → Sat, 05 Sep`, `Sun, 06 Sep → Sun, 27 Sep`). The gap is calendar-lifecycle
grouping and cell steps.

## §2 Design principle

Deterministic-first: **separator-tolerant token matching + reuse of the
shipped W3C date-name shape**. No timing rules, no site names, no
AdaniOne-specific constants, no DOM probing beyond captured attributes. All
changes in `src/definitions/` only.

### §2.1 Authorized touch surface (exhaustive)

| File | Change |
|---|---|
| `src/definitions/patterns.ts` | W-A.1 trigger-class separator tolerance (`date[_-]?picker`); W-A.1b `DATE_NAME_HINT_RE` vocabulary += `depart`, `return`, `onward`, `arrival` (name/placeholder/aria-label hints); W-A.2 cell-class family += `datepicker__day`, `react-datepicker__day` (and surface family verification only — `react-datepicker` already matches `CALENDAR_SURFACE_CLASS_RE` via `calendar`? NO — verified: `/…|calendar|…/` — `react-datepicker` matches via `datepicker` token; verify in tests); W-A.2b `isCalendarCell` accepts the W3C name shape (`hasDateCellName`) as an additional sufficient signal when role is `option`/`gridcell`/`button`. |
| `src/definitions/date-picker.ts` | W-A.3 guard: a calendar CELL must not itself be treated as a trigger (trigger detection passes target placeholder etc.; ensure cell-shaped targets do not start a lifecycle from their own `datepicker__day` class). |
| `src/definitions/click.ts` | W-C fallback: none required if W-A.2b claims cells into DatePicker; Click fallback arises naturally when a DatePicker lifecycle is not active (cell outside any lifecycle, LP1 surface claim unchanged). Verify via tests; only touch if a gap is proven. |
| `tests/definitions/…` (new) | `react-datepicker-family-6e-m2.test.ts` — unit matrix pinned to real markup from batch 2. |

### §2.2 Protected surfaces (unchanged)

capture/EventTap, projection engine, evidence ledger, KR (schema +
signatureKey v1 frozen), IR bridge/executor (NOISE_TYPES unchanged —
Unclassified stays filtered), understanding layer (page-content config),
generation layer, manifest version handling, all 6D.1 §2.3 frozen
decisions.

### §2.3 Pre-committed decisions (frozen for this phase)

1. **W-A.1 separator tolerance is a token rewrite, not a broadened
   substring**: `datepicker`, `date-picker`, `date_picker` all match;
   `dated picker`-style loose text does not. Implemented as
   `date[_-]?picker`.
2. **W-A.1b name vocabulary additions are the four evidenced travel
   tokens** (`depart`, `return`, `onward`, `arrival`) — 'Depart on' →
   `depart` matches; 'Return on' → `return` matches. Bounded, generic
   travel vocabulary, same substring rule, no full dictionary.
3. **W-A.2b W3C-name-as-cell-signal requires an interactive role**
   (`option` | `gridcell` | `button`) — the name shape alone (e.g. a
   heading "Choose Saturday…") must NOT make arbitrary text a calendar
   cell. Belt = name shape, braces = role.
4. **W-A.3 cells never trigger**: `isDatePickerTrigger` returns false for
   cell-shaped targets even when their class contains `datepicker__day`
   (the real cell class contains `react-datepicker__day` which W-A.1's
   `date[_-]?picker` token must not mistake for a trigger — guard by
   checking the cell class FIRST).
5. **No new selector families, no bare `auto-id` reading, no card-body
   classification** (held out per owner scope).
6. **Fallback honesty preserved**: a date-cell-shaped click with no active
   DatePicker and no other claimer projects Unclassified (unchanged
   behavior); W-C is the *verification* that plain-Click fallback works
   when a surface/listbox claim applies, not a new Click rule.

## §3 Work items & acceptance criteria

### W-A.1 — Trigger class separator tolerance
- [x] `isDatePickerTrigger('DIV', null, 'date_picker undefined', null, null)` → true
- [x] `isDatePickerTrigger('INPUT', 'text', 'withIcon form-control', null, 'Depart on')` → true (via W-A.1b, see below — placeholder path)
- [x] Existing tokens unchanged: `oxd-date-input`, `datepicker`, `date-picker`, `date-input`, `calendar-input` all still match
- [x] Negative: `datepicker-like`? — `date[_-]?picker` followed by `-like` still matches `datepicker` prefix token; accepted (substring family, same as shipped). Negative pin: `update_picker` does NOT match (no `date` prefix), `deadline` does NOT match.

### W-A.1b — Travel date-name vocabulary
- [x] `DATE_NAME_HINT_RE` matches: 'Depart on', 'Return on', 'onward date', 'arrival date', 'departure' (via `depart`), plus all existing tokens (date, birth, dob, expire, expiry, calendar)
- [x] `isDatePickerTrigger('INPUT','text','withIcon form-control',null,'Depart on')` → true via placeholder; same for name='Return on'
- [x] Negative: 'Department store' does NOT match (`depart` substring WOULD match — DECISION: use word-boundary `\bdepart|\breturn` to avoid 'Department'… but 'Depart on' has 'Depart' capitalized standalone → `\b(?:depart|return|onward|arrival)` matches. PIN: word-boundary alternation, case-insensitive. 'Department' → `\bdepart` matches 'Depart'ment — boundary is before D, 'Department' contains 'Depart' + 'ment'; `\bdepart\b`? No: 'Department' = 'Depart'+'ment', no boundary after t → `\bdepart\b` does NOT match 'Department'. Use `\b(?:date|birth|dob|expire|expiry|calendar|depart|return|onward|arrival)\b`? 'dob' inside 'adobe'? `\bdob` no boundary after. PIN: all tokens word-bounded: `(?:\bdate|\bbirth|\bdob\b|\bexpire|\bexpiry|\bcalendar|\bdepart|\breturn|\bonward|\barrival)` — keep existing tokens' current semantics where `\bdate` matches 'Depart on date'? verify no shipped test regresses; run suite.)
- [x] Suite green after vocabulary change (existing date-picker-name-trigger-6d1 tests must not break; if a token change breaks a pinned negative, re-pin ONLY that negative with evidence)

### W-A.2 — Cell class family + W3C name signal
- [x] `isCalendarCell('option', 'react-datepicker__day react-datepicker__day--weekend')` → true (new family token `datepicker__day`)
- [x] `isCalendarCell('option', 'full datepicker-date')` → false (inner holder is NOT a cell — `datepicker-date` does not contain `datepicker__day`; keep family tight: `react-datepicker__day` OR `datepicker__day` OR existing tokens)
- [x] W-A.2b: `isCalendarCell('option', null)` with name "Choose Saturday, September 5th, 2026" → true (new name-shape path; requires role ∈ {option, gridcell, button})
- [x] `isCalendarCell(null, null)` name-shaped → false (role braces)
- [x] `isCalendarCell('option', 'some-random-class')` name-shaped → true (name belt + role braces)
- [x] Existing tokens still work: `oxd-date-day`, `calendar-day`, `flatpickr-day`
- [x] Negative: a listbox option WITHOUT date-name and without cell class → false (unchanged guard)

### W-A.3 — Cell-never-triggers guard
- [x] `isDatePickerTrigger('DIV', null, 'react-datepicker__day react-datepicker__day--weekend', null, null)` → FALSE (cell class is not a trigger signal even though W-A.1 makes `date_picker` a trigger token — `react-datepicker__day` contains `datepicker` only as `react-datepicker` prefix; verify regex semantics: `date[_-]?picker` matches inside `react-datepicker__day` substring `datepicker`! PIN: trigger RE must NOT match cell classes → reorder checks in `isDatePickerTrigger` (cell-class check first, return false) OR constrain trigger RE to class-start/delimiter boundary. DECISION: check `isCalendarCell(null, className)` first in `isDatePickerTrigger` and return false.)
- [x] `isDatePickerTrigger('DIV', null, 'react-datepicker', null, null)` (the surface container) → true is ACCEPTABLE (a container click starting a lifecycle is harmless: lifecycle completes on cell or times out honestly) — pin as informational, no assertion change.

### W-C — Fallback verification (no new Click rule)
- [x] Unit: cell-shaped target (role=option, W3C name, unknown class) under an open listbox ancestor with NO active DatePicker → claimed by Click via LP1 (unchanged 6D.0 behavior; pin with existing helpers) — pinned in `react-datepicker-family-6e-m2.test.ts` W-C block; sharpened by verification: Click's claim gate is `isInteractiveElement` over the shipped `INTERACTIVE_ROLES` family, which contains `option` — so the cell-shaped target is a legitimate Click claim **without needing open-surface ancestry (LP1 unnecessary)**, and a cell with NO interactive role and unknown class stays honest Unclassified. No new Click rule was added (W-C was verification-only, as specced).
- [x] E2E (clone below): with W-A shipped, the cell click completes the DatePicker lifecycle (this is the primary path); the LP1 fallback remains pinned only at unit level.

### E2E — real-Chrome on real-markup clone
- [x] Clone app carries VERBATIM batch-2 markup: `react-datepicker__day…` cells (aria-label W3C names, role=option), `react-datepicker__month[role=listbox]` container, `date_picker undefined` wrapper, `INPUT.withIcon.form-control` 'Depart on'/'Return on' fields (value write at mousedown — M1 evidence).
- [x] Recording: click Depart on → calendar opens → click cell → value transition `Mon, 24 Aug → Sat, 05 Sep`; **DatePicker card completed** with selected date; **zero Unclassified cell cards**.
- [x] Return-on field + second cell click → second DatePicker completed (round-trip shape).
- [x] 6B/6D.1 regression cells on the same run: data-auto-id click claim, options-list Click (W3), snackbar/aria-live notification (W1), #id-only counter swap (W2) — all green.
- [x] IR: fill-or-datepicker steps present for both dates; no Unclassified leak into IR.
- [x] KR: signatures written for DatePicker interactions — **mis-specified AC, closed as evidence-resolved (Finding 4)**: KR signature anchors are exclusively discrete-action triggers (`DISCRETE_ACTION_TYPES` — click/contextmenu/mousedown/keydown/drag/drop; `evidence-ledger.ts`); a DatePicker card's trigger is a FOCUS event → DatePicker is structurally always a `parameterInput`, never a signature anchor. Same shape as shipped 6D.1 behavior (its DatePicker wrote zero signatures too). The `value: null` on the param is also shipped behavior (params read `metadata.textValue ?? triggerEvent.valueAfter`; DatePicker writes `dateValue`, unread by episode-builder) — filed as 6F KR-mapper polish (map `dateValue` into parameter values). Evidence: VALIDATION-RECORD Finding 4.

## §4 Verification path

TDD: red units → implement → green units → full suite (254+ files) → tsc
exactly 8 baseline errors → doctrine pin test green → build dist → reviewer
→ infra_verifier → real-Chrome E2E (above) → owner gate → commit 1 (src +
tests) → commit 2 (spec + evidence + roadmap). No push.

## §5 Doctrine preservation

- Site-agnostic: no `adaniione`/`DEL`/`BOM` tokens; `react-datepicker` is a
  LIBRARY family (like the existing `flatpickr-day`, `oxd-date-day`
  tokens), plus library-agnostic name-shape signal (W3C ARIA APG).
- Deterministic-first: substring/word-boundary tokens + captured-attribute
  name shape; no timing, no DOM probing, no site constants.
- Understanding/generation layers untouched; KR read-only from UI;
  signatureKey v1 frozen.
- Owner gate before commits; evidence archived under
  `.drytis/notes/evidence/phase-6e-m2-*/`.

## §6 Out of scope (held per owner)

W-B bare `auto-id` identity family (6B territory, separate spec); card-body
classification for `result-item` cards (booking works via Book Now button);
DELBOM/16:55 SW-recovery identity loss (F4 → 6F window); filter-chip tokens
for `srp-d-filter` chips; dataAutoId fuzzy matching; stabilityTrace; 6F
display items; any capture/projection/ledger/KR-schema change.

## §7 Approvals

- [x] Owner approval of scope — QUOTED §0 (2026-08-23 07:41 UTC) ✓
- [x] Round 2 (E2E findings): ancestor-path cell guard added 2026-08-23
      08:42 UTC — reviewer PASS (7/7 items), infra PASS (0 failures).
      Residuals documented in
      `.drytis/notes/evidence/phase-6e-m2-e2e-2026-08-23/VALIDATION-RECORD.md`:
      (a) click-twin after mousedown-completed DatePicker (runtime/projection
      fix → 6F window, O11 twin family, candidate fixes a/b/c recorded);
      (b) spec AC "KR signatures for DatePicker" was mis-specified —
      DatePicker is focus-triggered → always parameterInput, never a
      signature anchor (shipped architecture, unchanged); KR param VALUE
      mapping (`dateValue` not read by episode-builder) filed as 6F KR-mapper
      polish.
- [x] Owner approval of E2E evidence + ship — **APPROVED 2026-08-23 10:02 UTC** ("Proceed with 6E-M2 closure exactly as specified. Commit 1: src + tests only; commit 2: spec + evidence + roadmap. Tick the owner-gate/closure ACs and verify the committed tree, suite, tsc baseline, dist and ZIP provenance afterward. Do not push."). Closure executed: commit 1 `24e1340` (src+tests), commit 2 = this commit (spec ticks + evidence archive + roadmap). No push.
