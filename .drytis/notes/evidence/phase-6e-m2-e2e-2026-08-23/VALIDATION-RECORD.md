# 6E-M2 E2E Validation Record — react-datepicker verbatim clone (real Chrome 148 headless CDP)

Date: 2026-08-23 · Fixture: `app-verbatim.mjs` (port 8190) · Harness: `harness-m2.mjs`
· Extension: `/workspace/dist` (v10.9.0, rebuilt with 6E-M2 + round-2 guard)

## Runs

| Run | Log | Result | Notes |
|---|---|---|---|
| 1 (pre-fix build) | `run-1-FIRST-PASS.log` | 8 PASS / 0 FAIL* | *Duplicate DatePicker cards (one per cell) — diagnosed below |
| 2 (first retry) | `run-2.log` | INVALID — stale Chrome | Fixed debug port + never-killed Chrome → harness attached to run-1's browser (old build, old profile). Evidence: `knowledgeBehaviorSessions: 2`, identical `int-*` ids. Dumps preserved in `dumps-round1/`. HARNESS BUG, fixed (random port, fresh profile, teardown) |
| 3 (round 2 = fixed build + fixed harness) | `run-2b.log` | 8 PASS / 0 FAIL | Authoritative run. Dumps in `dumps/` |

## Run 3 card inventory (7 cards)

```
int-2  DatePicker  Depart on                          (#onward focus; dateValue "Choose Sunday, September 6th, 2026")
int-3  Click       Choose Sunday, September 6th, 2026  ← twin finding, below
int-6  DatePicker  Return on                          (#return focus; dateValue "Choose Tuesday, September 8th, 2026")
int-7  Click       Choose Tuesday, September 8th, 2026 ← twin finding, below
int-9  Click       Search Flights                     (data-auto-id=search-flights — 6B regression PASS)
int-10 Click       Bengaluru                          (options-list li.opt — 6D.1 W3 regression PASS)
int-12 Click       Notify                             (snackbar W1 — notification in KR `knowledgeNotifications`)
```

- Zero Unclassified calendar-cell cards (user batch-1 defect CLOSED at definitions layer).
- IR plan: `selectDate, click, selectDate, click, click, click, click` — date steps present, no Unclassified leak.
- KR: 1 session; 5 signatures (all Click-anchored — see Finding 2); counter `p#result-count` seeded (W2 PASS).

## Finding 1 (product, FIXED in this round): nested-wrapper double-spawn

**Symptom (run 1):** each cell click produced TWO DatePicker cards — the
input's (`Depart on`, value OK) and a duplicate whose trigger was the CELL
itself (name = the cell's aria-label), plus duplicate KR parameterInputs
(4 params for 2 flows).

**Root cause:** AdaniOne nests the calendar INSIDE the trigger wrapper
(`travel_date > div.date_picker > react-datepicker > … > __day`). In
`datePickerDefinition.detectTrigger`, the OXD wrapper path feeds
`event.domContext.ancestorClasses` into `isDatePickerTrigger`; on a CELL
event those ancestors contain `date_picker`/`react-datepicker` → trigger
token matched → the cell spawned its own lifecycle with ITSELF as trigger
(cells have `tabindex=0` + focus events → focus-started lifecycle; the
cell's own click then completed it instantly).

**Fix (definitions layer, `src/definitions/date-picker.ts`):** W-A.3
("cells never trigger") now also guards the ANCESTOR path — a cell-shaped
EVENT TARGET (cell class family OR W3C date-cell name shape, via
`isCalendarCell`) returns null before the ancestor token is tested.
Red→green pinned in `react-datepicker-family-6e-m2.test.ts` round-2 block
(4 tests: cell-class target, name-shape target, wrapper positive, full
`detectTrigger` integration pin on verbatim batch-2 domContext).

**Result:** run 3 emits exactly one DatePicker per flow.

## Finding 2 (product, residual — needs owner decision): click-twin after a mousedown-completed DatePicker

**Symptom (run 3):** int-3/int-7 are Click cards for the SAME physical
press whose mousedown completed the DatePicker. Ledger: cell mousedown →
`claimed by int-2`; cell click → `claimed by int-3` (Click fallback
lifecycle). 87ms apart, same element.

**Mechanism:** the cell's mousedown completes the DatePicker lifecycle
(`handleEvent` completes on click OR mousedown). The lifecycle is removed
from the active stack; the cell's click (same gesture, ~90ms later) has no
active scope → discovery → Click fallback claims it (cells are interactive:
role=option). S1' pairing cannot collapse this pair — it only projects
UNCLAIMED pairs, and both halves were claimed by different lifecycles at
runtime.

**Why it is NEW:** pre-6E-M2 the cell was never claimed by anything
(Unclassified at projection), so no twin could form. It is the honest cost
of the cell now being recognized; the 6D.2 O11 finding was the same shape
from the other side (orphan twins when NOTHING claims).

**Impact:** duplicate card in the panel + duplicate IR click step + a
low-value KR signature (`Click:choose sunday…` with T4-window-only
consequence). Not a correctness break — the DatePicker step is correct and
first; the twin is redundant.

**Candidate fixes (NOT implemented — runtime/projection layers are outside
this spec's authorized touch surface):**
a) Click definition excludes calendar-cell targets (definitions-layer;
   simple, but silently drops a deliberate press if no DatePicker owns it —
   honesty regression risk), or
b) DatePicker completes on click, not mousedown (changes the captured
   shape: value-at-mousedown evidence from the real site would be lost —
   batch-1 sequencing showed framework writes value at MOUSEDOWN), or
c) Runtime: a lifecycle that completed on mousedown stays "owning" for the
   paired click of the same gesture (S1' analog at runtime) — cleanest but
   touches `component-runtime.ts` (out of 6E-M2 scope).

**Recommendation:** ship 6E-M2 as-is (the primary user-visible defect —
Unclassified dates — is fixed; regressions all green), file the twin as a
6F-window item under the O11 family with candidate (c).

## Finding 3 (harness, FIXED): stale-Chrome attachment

Fixed debug port + no teardown let run 2 attach to run 1's Chrome. Fixed:
random port per run, fresh profile, `browser.close()` + `chrome.kill()` +
profile cleanup at exit. Rule for all future harnesses: PORT + PROFILE must
be unique per run (or teardown verified) — `ps aux | grep 6em2-profile`.

## Finding 4 (spec honesty, documented): "KR signatures for DatePicker"

The spec AC "signatures written for DatePicker interactions" was
mis-specified: KR signatures anchor ONLY on discrete-action triggers
(`DISCRETE_ACTION_TYPES` — click/contextmenu/mousedown/keydown/drag/drop;
`evidence-ledger.ts`), and a DatePicker card's trigger is a FOCUS event →
DatePicker is always a `parameterInput`, never a signature anchor. Same
shape as shipped 6D.1 behavior (its DatePicker wrote zero signatures too).
The param `value` being null is ALSO shipped behavior (params read
`metadata.textValue ?? triggerEvent.valueAfter`; DatePicker writes
`dateValue`, which the mapper does not read) — filed as a 6F KR-mapper
polish item: map `dateValue` into parameter values.

## Regressions verified (all PASS, run 3)

- 6B dataAutoId: exactly one Click on `search-flights`.
- 6D.1 W1: snackbar `role=status` "Saved" → `knowledgeNotifications` row.
- 6D.1 W2: `p#result-count` counter seeded (`counter:body > main > div > p#result-count`, currentValue 2).
- 6D.1 W3: options-list `li.opt` Bengaluru → exactly one Click.
- Unit suite after round-2 fix: 255 files / 4,492 tests green; tsc exactly
  the 8 pre-existing baseline errors.
