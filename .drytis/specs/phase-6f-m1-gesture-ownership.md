# Phase 6F-M1 — Gesture Ownership (Runtime) + KR dateValue Mapping + stabilityTrace Delivery

**Status:** IMPLEMENTED + VERIFIED — at owner gate, uncommitted. Owner-approved 2026-08-23 11:15 UTC ("Approve 6F-M1 as A + B + C. Keep A strictly structural: `captureSeq` adjacency + same `elementKey`, with no timing rules. B and C can ride the same phase. Proceed spec → TDD → implementation → full verification → real-Chrome E2E, then stop at the owner gate. No push.").

**Baseline:** `527f73b` (capability-surgical-removal, 16 commits ahead of
origin, unpushed). Suite 255 files / 4,492 tests green; tsc 8 pre-existing
baseline errors (`ir-executor-navigate` ×5, `ir-bridge-repeated-clicks`,
`resulting-state-seeded-display`, `changed-element-seed-honesty`).

**Predecessors:** 6E-M2 shipped (`24e1340` + `527f73b`); 6D.2 M1 closed the
timing-rule debate (2026-08-20 owner correction: S1/S3 as written were timing
rules — corrected to captureSeq adjacency + elementKey equality); S1'
projection pairing shipped (`pairedAtProjection`).

**Roadmap source:** `ROADMAP-2026-08-22.md` §Phase 6 — 6F-eng (stabilityTrace),
6F polish (KR dateValue), 6E-M2 entry residual: "paired cell click (~90ms
after a mousedown-completed DatePicker) falls to the Click fallback → twin
Click card + duplicate IR click step; candidate fixes a/b/c".

## §0 Problem statements (all evidence-grounded)

### A — Click-twin after mousedown-completed DatePicker (O11 family)

Run-3 E2E dumps (`.drytis/notes/evidence/phase-6e-m2-e2e-2026-08-23/dumps/`):

- Cards: int-2 DatePicker "Depart on" → int-3 Click "Choose Sunday, September
  6th, 2026" (twin); int-6 DatePicker "Return on" → int-7 Click twin.
- IR: 7 steps; orders 1 and 3 are duplicate `click` steps on the calendar
  cells (elementName "Choose Sunday/Tuesday …").
- Mechanism: cell `mousedown` completes the DatePicker (completes on click OR
  mousedown) → `activeStack.splice(i,1)` removes the lifecycle → the paired
  `click` of the same gesture finds no owner → discovery → Click fallback
  (role=option ∈ INTERACTIVE_ROLES) → twin Click card + duplicate IR step.
- KR dump: the twin clicks anchor extra low-value episodes.

**Root cause is structural:** the runtime forgets the gesture after its
mousedown-completion; nothing in the event stream says the click belongs to
the same gesture.

### B — KR parameter VALUE mapping for DatePicker

`episode-builder.ts:546-547` reads `metadata.textValue ?? triggerEvent.valueAfter`.
DatePicker writes `metadata.dateValue` (`date-picker.ts:120,158,168`). Params
render `value: null` in the KR browser despite the date being captured.
Evidence: `m2-kr-dexie.json` parameterInputs with null values.

### C — stabilityTrace discarded for consequence-settled windows

`evidence-collector.ts:1841` (settle branch of `closeWindow`) hardcodes
`stabilityTrace: []`. AdaptiveWindow records samples (`adaptive-window.ts:363`),
caps at 50 (`MAX_TRACE`), and delivers them at `:191` — but the settle branch
never copies the trace. Symptom: side panel D6 window-internals drill-down
never renders for the most evidence-rich window class (consequence-settled
windows are exactly those with rich settling activity).

## §1 Goal

- **A:** after a lifecycle completes on `mousedown`, the captureSeq-adjacent
  same-`elementKey` `click` of the same gesture is absorbed by that completed
  lifecycle — no twin Click card, no duplicate IR step, no extra KR episode.
  All existing behavior otherwise unchanged.
- **B:** DatePicker interaction params read `dateValue` when
  `textValue`/`valueAfter` are absent → KR browser shows the selected date.
- **C:** consequence-settled windows deliver the recorded stability trace →
  D6 drill-down renders; knowledge consumers get the real trace.

## §2 Scope & authorized touch surface

### §2.1 Authorized files (exactly three)

**A — `src/runtime/component-runtime.ts`:**
1. Track recently completed mousedown-gestures in a bounded list (≤16
   entries): `{ elementKey, eventType: 'mousedown', captureSeq, pageId,
   lifecycleId, interactionId }`. Bound is memory hygiene only — no
   time-based expiry.
2. In `completeComponent`, when a lifecycle completes with the completing
   event being a discrete `mousedown`, record the entry; any earlier gesture
   record on the same page is marked superseded (the new mousedown broke
   exact discrete adjacency).
3. In `process()`: (a) any discrete non-click event supersedes gesture
   records on its page (adjacency break); (b) before discovery (step 3b),
   for a `click` with no active owner, if an unsuperseded tracked gesture
   matches — same `pageId`, same `elementKey`, click after the mousedown in
   capture order — then `ledger.setDisposition(click.eventId, 'claimed',
   interactionId, ctx.type)`, append the click to the emitted interaction's
   `memberEvents` (append-only, eventId-guarded), consume the gesture record
   (one release per gesture), do NOT run discovery, do NOT emit a new
   interaction. A click that matches no record itself supersedes that
   page's records.
4. **No timing fields in the predicate** (no `Date.now`, no timestamp
   deltas, no elapsed-ms, no captureSeq arithmetic against constants —
   captureSeq is used only for relative ORDER). The predicate is the
   runtime analog of the shipped S1' projection rule: exact adjacency in
   DISCRETE-event order (the ledger's own filtering), interleaved
   non-discrete events (focus/mousemove/input) never break a gesture.
   **Correction during implementation (2026-08-23 E2E run-1):** the
   original draft said `click.captureSeq === mousedown.captureSeq + 1`;
   the real ledger dump falsified that (the pair sits ~90ms apart in raw
   captureSeq because non-discrete events share the browser counter —
   mousedown 6935.5 → click 7025.1, yet consecutive in ledger order).
   Corrected to the S1'-family exact-discrete-adjacency rule before
   re-running the E2E; spec updated in the same change.
5. Type-generic: applies to any definition that completes on mousedown
   (today only DatePicker does; Click triggers on click/contextmenu,
   Dropdown/Checkbox on click) — no DatePicker-specific branch.

**B — `src/understanding/behavior-model/episode-builder.ts`:**
- Param value chain becomes `textValue ?? dateValue ?? valueAfter`. One
  expression + tests.

**C — `src/tap/evidence-collector.ts`:**
- In the settle branch of `closeWindow` (evidence built at `:1841`), replace
  `stabilityTrace: []` with the trace from the delivered `evidenceWindow`
  parameter (it carries `[...this.stabilityTrace]` per `adaptive-window.ts:191`).
- The `:1901` site (`lc-` lifecycle windows) stays `[]` — those have no
  adaptive window; honest empty.

### §2.2 Protected (read-only)

capture/EventTap (except evidence-collector.ts settle-branch trace copy),
projection engine, evidence ledger data model (existing dispositions only),
KR anchor semantics, IR bridge/executor, understanding (except the B mapper
expression), generation, sidepanel, all definitions (click.ts, date-picker.ts,
dropdown.ts, patterns.ts unchanged).

### §2.3 Frozen decisions

1. **No timing rules, ever, in the pairing predicate.** pageId + elementKey +
   captureSeq adjacency only. The ≤16 bound is memory hygiene, not a rule —
   no time-based expiry.
2. **Type-generic rule** — no DatePicker-specific branching in the runtime.
3. **memberEvents append is optional-but-safe** if append-only with eventId
   guard; disposition-only is the fallback. Decision pinned in tests.
4. **B fallback order:** `textValue ?? dateValue ?? valueAfter`.
5. **C copies from the delivered `evidenceWindow`** in the settle branch; the
   `lc-` site stays `[]`.
6. The absorbed event must be a `click` (not contextmenu/drag) — the classic
   click-gesture half.
7. Cross-target drag twin stays in 6F display backlog (not this phase).

## §3 Acceptance criteria

### A — runtime gesture ownership

- [x] AC-A1: DatePicker completes on mousedown; click arrives AFTER the
  mousedown in capture order with ONLY non-discrete events interleaved (raw
  captureSeq gap allowed — the browser counter is shared) → click
  dispositioned `claimed` for the completed interaction; **no new interaction
  emitted**; no twin Click card exists.
- [x] AC-A1b (corrected-rule pin): the falsified-draft scenario — mousedown
  seq ~6935, non-discrete interleaves, click seq ~7025, NO discrete event
  between — still absorbs. A regression to `=== mousedown + 1` must FAIL
  this test. (Added after review WARN-2.)
- [x] AC-A2: click on a different elementKey → discovery proceeds; Click card
  emitted (no over-suppression).
- [x] AC-A2b: an intervening DISCRETE event (keydown/contextmenu/dragstart/
  drop/mousedown) breaks exact discrete adjacency → gesture record
  superseded; no absorption; honest Click card emitted. (Corrected from the
  falsified "gap ≥ 2" wording — a raw captureSeq gap alone is NOT a break.)
- [x] AC-A3: plain Click gesture (no mousedown-completed lifecycle) →
  behavior identical to baseline (no regression).
- [x] AC-A4: integration over the 6E-M2 E2E event-stream shapes → **5 cards /
  5 IR steps** (selectDate, selectDate, click Search Flights, click Bengaluru,
  click Notify) — twins gone.
- [x] AC-A5: doctrine pin — AUTOMATED source test: the gesture-ownership
  regions of component-runtime.ts contain no `Date.now(`/`performance.now(`
  /timestamp deltas/captureSeq arithmetic against constants. (Upgraded from
  inspection-only after review WARN-1.)
- [x] AC-A5b: 20 mousedown completions with NO clicks → list bounded to 16
  with oldest-first eviction: the 17th-oldest cell's click is NO LONGER
  absorbed (honest Click card); the most recent gesture still absorbs.
  (Behavioral bound pin, added after review WARN-2.)

### B — KR dateValue mapping

- [x] AC-B1: `dateValue` present, `textValue`/`valueAfter` absent → param
  `value === dateValue`.
- [x] AC-B1b: `textValue` present → wins (precedence pin).
- [x] AC-B1c: `dateValue` + `valueAfter` both present → dateValue wins.
- [x] AC-B2: textEntry/Dropdown/Checkbox param values unchanged
  (no-regression pin).

### C — stabilityTrace delivery

- [x] AC-C1: settle-branch window with 3 recorded samples → delivered
  `evidence.window.stabilityTrace.length === 3`.
- [x] AC-C2: non-settle windows unchanged; `lc-` lifecycle windows keep `[]`.

### Doctrine & regressions

- [x] Full suite green (≥ 255 files; 4,492 + new tests).
- [x] tsc exactly the 8 pre-existing baseline errors.
- [x] Real-Chrome E2E (harness-m2 verbatim clone): 5 cards / 5 steps; zero
  Unclassified cell cards; twins gone; DatePicker KR params non-null; 6B
  dataAutoId, 6D.1 W1/W2/W3 regressions green.
- [x] ZIP contains the new code (token grep in service-worker-inline.js).
- [x] Infrastructure Gate + infra_verifier + reviewer PASS before owner gate.

## §4 Verification path (ordered)

1. TDD red→green per item (A runtime tests, B episode-builder tests, C
   evidence-collector tests).
2. Full suite + tsc-8 baseline.
3. Build dist + pack ZIP + provenance (md5, tokens).
4. Real-Chrome E2E on the verbatim AdaniOne clone (harness-m2).
5. Infrastructure Gate (procmgr, curl preview, Caddy) + infra_verifier +
   reviewer.
6. Stop at owner gate. **No commit, no push.**

## §5 Doctrine

Site-agnostic; deterministic-first (no timing/DOM probing/site constants in
the pairing rule); captureSeq is the browser's own monotonic capture order —
structural, not temporal. signatureKey v1 frozen. Evidence-preserving:
absorbed clicks stay in the ledger with `claimed` disposition and full
evidence, never dropped.

## §6 Out of scope

F4/MV3 SW-lifecycle (panel arming/active-tab binding; sw-recovered identity),
filter-chip/flight-card definitions, 6F display hygiene batch
(O1/O2/O7/O12/O13/O14), cross-target drag twin display, KR dateValue display
formatting, sidepanel renderers.

## §7 Approvals & history

- 2026-08-23 11:15:32 UTC — owner: "Approve 6F-M1 as A + B + C. Keep A
  strictly structural: `captureSeq` adjacency + same `elementKey`, with no
  timing rules. B and C can ride the same phase. Proceed spec → TDD →
  implementation → full verification → real-Chrome E2E, then stop at the
  owner gate. No push."

- 2026-08-23 (implementation day, ~12:40 UTC) — status flip to
  IMPLEMENTED + VERIFIED at owner gate: A (runtime gesture ownership),
  B (dateValue param chain), C (settle-branch stabilityTrace delivery)
  all green; 19/19 ACs verified; suite 259 files / 4,512 tests green;
  tsc = 8 pre-existing baseline; E2E run-2 archived at
  `.drytis/notes/evidence/phase-6f-m1-e2e-2026-08-23/` (9 PASS / 0 FAIL;
  5 cards / 5 IR steps; KR params non-null); ZIP repacked 12:39 with the
  6F-M1 tokens (md5 586daa2c…). Review WARNs 1-3 resolved: doctrine-pin
  source test, corrected-rule + bound behavior pins, evidence provenance
  split (6E-M2 baseline dumps restored at 527f73b). WARN-4 (active-
  lifecycle click cannot supersede) logged for the 6F display backlog.
  Nothing committed; no push.
