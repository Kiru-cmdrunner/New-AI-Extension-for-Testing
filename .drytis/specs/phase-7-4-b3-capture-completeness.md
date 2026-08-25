# Phase 7.4-B3 — Capture Completeness Residuals (SPEC)

**Status:** OWNER-REVIEW GATE — no implementation until approved.
**Branch:** `capability-surgical-removal` (post-`6f94df4`).
**Predecessors:** 7.4-M1 (affordance), 7.4-B1 (Expander), 7.4-B2 (typeable
combobox, SHIPPED @ `393ad61`/`6f94df4`).
**Source audits:** capture-model grounding audit (2026-08-25 AM, session log)
+ promotion-substrate grounding audit (2026-08-25 PM, session log). Both
read-only; no src changes precede this spec.

---

## §0 Decision requested

Approve 7.4-B3 with four implementation slices + one measurement slice:

| Slice | Name | Nature |
|---|---|---|
| S0 | Unclassified census | measurement only — zero src changes |
| S1 | Projection evidence join | src — close the stranded-evidence gap |
| S2 | Dedup fold (no resurrection) | src — honesty fix |
| S3 | Typed-text terminal sample | src — loss channel A |
| S4 | Body/HTML click capture | src — loss channel B |
| S5 | `actionabilityEvidence` flag | src — metadata only, **no relabel, no IR change** |

Two explicit deferrals (owner decision, not in this phase):
- **D1 promotion relabel** (Unclassified → Click / IR inclusion of flagged
  clicks). B3 ships the *evidence and the flag*; relabeling is decided by the
  S0 census + a dedicated B4 spec if justified.
- **D2 adapter/bridge IR policy reconciliation** (`output-adapter.toIRAction`
  maps Unclassified click → CLICK with `unclassified:true` while
  `ir-bridge` NOISE_TYPES drops ALL Unclassified — inconsistent since
  deff878 audit). Same gate: census first, then one deliberate policy.

**Hard scope boundary:** no new claim gates, no widening of
`INTERACTIVE_CLASS_RE`, no capture-model reversal. The capture-model audits
(2026-08-25) concluded the architecture is already capture-first at the
preservation layers; B3 closes the residual *loss channels* that audit found.

---

## §1 Problem — grounded findings

### F1 — Dedup resurrection manufactures fake Unclassified cards (CRITICAL)

**Evidence:** shipped B2 E2E storage dump
(`.drytis/notes/evidence/phase-7-4-b2-e2e-2026-08-25/dumps/b2-storage.json`):
`int-11` = `Unclassified, physicalEventType: click, targetTag: BUTTON,
targetRole: button, targetName: "Save", reason: unclaimed-at-projection` —
the *maximally-interactive* element ended Unclassified.

Reconstruction from the 25-entry ledger:
```
evt-41 click   claimed    int-8  (Click "Save" — first gesture)
evt-64 mousedown pending    —     (second gesture begins)
evt-68 click   unclaimed  lc-12  (absorbed → isDuplicate → releaseClaims)
```

Mechanism (`src/runtime/component-runtime.ts:705-710`): the second Save
click within `DEDUP_WINDOW_MS` (2s) triggers a Click lifecycle whose
`completeComponent` → `isDuplicate` (same type + same elementKey + gap ≤ 2s)
suppresses the interaction and calls `ledger.releaseClaims(lifecycleId)`,
flipping the click from `absorbed` → `unclaimed`. The Projection Engine
(`projection-engine.ts:301-305`) surfaces every unclaimed/pending entry as
an Unclassified card — **resurrecting as "unrecognized" an event the system
correctly recognized and deliberately suppressed as a duplicate.**

Consequences:
- The Unclassified residual measured by any census is contaminated by this
  class; misdiagnosis risk for every downstream decision (including D1/D2).
- The card lies: `recognized: false` is false in spirit — the click WAS
  recognized; it was deduplicated.
- Repeat information (user clicked Save twice) is lost entirely.

### F2 — Behavioral evidence strands at STOP; projected cards carry none (HIGH)

**Evidence:** same dump, `cmdrunner_pending_evidence` holds one stranded
entry for `evt-pmt8kb63m-68` (= int-11's click) containing a **real DOM
consequence**: `body > div#flow-c > ul#search-c-list > li → style
display:none` — the click-away dismissal closing the options list. Exactly
the consequence signal a promotion rule needs, and it is unreachable.

Mechanism: `attachEvidenceToInteraction` tier-1/2 joins
(`sw-integration.ts:517-552`) scan **`liveInteractions` only**
(runtime-emitted). lc-12 was dedup-suppressed → no card → evidence lands in
`pendingEvidence` forever. `drainPendingEvidence` (`sw-integration.ts:568-606`)
runs **only from `onEmit`**. Projected Unclassified cards are minted at STOP
(`sw-integration.ts:751`) — after all emission — so **no projected
Unclassified card ever receives evidence**. Verified across every available
dump containing Unclassified cards: 0-for-N (B2 runs ×2, full-pipeline-audit
run2, multipattern) — `hasEvidence: false` universally.

The join key already exists and is populated: the projected card's
`triggerEvent.eventId` === the stranded evidence's `sourceEventId`
(verified: `evt-pmt8kb63m-68` on both sides). The gap is one missing drain
step, not missing data.

### F3 — Typed text with no completing lifecycle is silently lost (HIGH)

`DISCRETE_ACTION_TYPES` (`evidence-ledger.ts:27-30`) excludes
`input`/`change` — accumulating types are never ledgered. When a TextEntry
lifecycle never starts (missed focus: autofocus, SW restart mid-focus,
iframe focus weirdness, programmatic `.focus()` without event) the input
events are routed to discovery, claimed by nothing, and dropped with **no
ledger entry, no Unclassified card, no trace**. This is the same loss class
7.4-B2 fixed for typeable comboboxes (Flow B keyboard commit) — still open
generically for plain inputs.

Capture-guarantee-v2 pins the semantics deliberately
("does NOT preserve non-discrete events (scroll, input, change)") — the fix
must not violate that pin by ledgering every keystroke.

### F4 — Click-away dismissals never enter the ledger (MEDIUM)

`resolveTarget` strategy 3 (`identity-extractor.ts:551-554`) returns `null`
for structural tags (`NON_INTERACTIVE_TAGS`, :485-489 — includes BODY, HTML,
SVG internals) → `event-tap.ts:232-234` drops the event before observation.
A click on empty page background to dismiss a popover/modal — a **genuine
application interaction** in most SPAs (often the only close affordance) —
is never captured at all. This is a *capture* gap, not a classification gap:
the event doesn't exist downstream in any form.

### F5 — Adapter/bridge IR policy inconsistency for Unclassified (MEDIUM, deferred)

`output-adapter.toIRAction` (:297-325) maps Unclassified click →
`CLICK {unclassified:true}`; `ir-bridge` NOISE_TYPES (:81-92) drops ALL
Unclassified from the IR plan. Known since the deff878 audit (5-C-2), never
reconciled. **Deferred to D2** — changing IR output before the census would
change generated tests on intuition, violating evidence-gated discipline.

### F6 — The Unclassified residual has never been measured on a current build

"Unclassified % on benchmark flows" is a listed roadmap success metric; no
fresh census exists post-7.4-M1/B1/B2. Every model debate (including this
one) has proceeded without the number. S0 supplies it and *classifies* the
residual — the F1 finding proves the residual is heterogeneous and that
classification, not just counting, is required.

### F7 — The promotion substrate exists and is deterministic

Grounded in `behavioral-evidence-types.ts` + collector:
- Every click opens an evidence window (`WINDOW_OPEN_EVENTS`,
  `evidence-collector.ts:105-107`); mousedown is capture-only (:176-179).
- Consequence signals available deterministically: `attributeDeltas`
  (aria-expanded flips, style display), `newSurfaces`/`removedSurfaces`
  (popover open/close), `visibilityChanges`, `characterDataDelta`,
  `navigation`, `networkActivity` (exact `sourceEventId` join for
  webRequest rows).
- `consequence-settled` endReason + `resultingState` mark settled windows.
- INV-BEHAV-1 keeps evidence free of classification — a flag derived from
  evidence *shape* at presentation time violates no invariant and adds no
  causal claim (the flag says "the app's DOM changed in this click's
  window", which is recorded fact).

What's missing is only F2's join. S1+S5 deliver the substrate; D1 decides
what it earns.

---

## §2 Design

### S0 — Unclassified census (measurement, zero src)

Deliverables:
1. `scripts/unclassified-census.mjs` — storage-dump analyzer. Input: any
   `chrome.storage.local` dump (harness-produced). Output per Unclassified
   card, classified by joining ledger + pendingEvidence + interactions:
   - `dedup-resurrected` — ledger entry `disposition: unclaimed` with
     `claimedBy: lc-*` where that lifecycle's type matches a dedup-eligible
     pattern (same elementKey as a prior completed interaction of same type
     within DEDUP_WINDOW_MS) — the F1 signature.
   - `gate-rejected` — no dedup signature; element carries no claim-gate
     signal (the honest "we don't know" population).
   - `evidence-consequential` — stranded/attached evidence with ≥1
     consequence signal (domChanges/newSurfaces/removedSurfaces/
     visibilityChanges/navigation/network-with-sourceEventId).
   - (post-S4 builds) `body-structural` — targetTag BODY/HTML.
2. `harness-74b3.mjs` (evidence dir, B1/B2 CDP pattern) — drives the B2
   fixture + a new census fixture (plain divs, body click-away, double-click
   repeat, no-focus typing) → dump → census → `CENSUS-REPORT.md`.

S0 runs **before** S2–S4 land (baseline) and **after** (delta). The
baseline report is commit-2 evidence either way; D1/D2 consume it.

### S1 — Projection evidence join (F2)

In `handleStopRecording` after `projectInteractions`:
- For each projected Unclassified card, look up `pendingEvidence` by
  `card.triggerEvent.eventId` (paired mousedown has no window — CAPTURE_ONLY;
  the surviving entry of `pairPhysicalPress` is the click).
- Reuse the drain semantics: richest-candidate selection via existing
  `scoreEvidenceRichness`; attach, delete drained keys, persist once.
- Storage shape (`cmdrunner_pending_evidence`, `[key, value]` array) read
  path already exists (MV3 restart recovery reads it); drain is additive.
- LP2 enrichment loop (already iterates projected Unclassified,
  `sw-integration.ts:758-770`) is untouched — S5 hooks the same loop.

S1 is scoped to **projected cards only**; runtime-emitted cards drain at
emission (existing path) — no double-attach (guard: `if
(interaction.behavioralEvidence) return`, same as drainPendingEvidence).

### S2 — Dedup fold, not resurrection (F1)

Replace the `isDuplicate` → `releaseClaims` branch
(`component-runtime.ts:705-710`) with a **fold into the prior interaction**,
reusing the 6F-M1 gesture append-only pattern (:457-479):
- `DedupRecord` gains `interactionId` + the runtime keeps
  `lastInteractionByType: Map<InteractionType, ComponentInteraction>`
  (object ref; one per type).
- On suppression: for each discrete member event →
  `ledger.setDisposition(eventId, 'claimed', prior.interactionId, type)`;
  append to `prior.memberEvents` (eventId-guarded);
  `prior.metadata.repeatCount = (… ?? 0) + 1`.
- New optional `RuntimeConfig.onDedupFold?: (prior) => void` — SW
  implementation calls `persistLiveInteractions()` so the fold survives MV3
  death (INV-5 parity: disposition changes already persist per-event).
- **Degradation (pinned):** after SW restart, `lastInteractionByType` is
  empty (snapshot serializes dedup metadata only) → suppress-and-release
  (current behavior) — an honest Unclassified rather than a lost fold.
  Documented accepted cost; census delta quantifies how often it matters.
- Scope: the `isDuplicate` branch ONLY. Abandoned/interrupted
  `releaseClaims` paths are untouched (R4: RCA2 S3' displaced-end pins
  depend on them).

Self-consistency (M5 check, `sw-integration.ts:790+`): folded events are
`claimed` **and** represented (appended memberEvents) — coverage improves,
not regresses.

### S3 — Typed-text terminal sample (F3)

One synthetic ledger entry per *lost-typing episode*, minted at the
**structural boundary** (blur of the same element), not per keystroke:
- SW-level tracking: input events observed while **no active lifecycle
  claims them** (post-discovery fall-through) accumulate per elementKey
  (elementKey → last valueAfter, first input captureSeq).
- On `blur` of that element with a tracked unclaimed episode: construct ONE
  `LedgerEntry` (eventType `'change'`, `valueAfter` = terminal value,
  `targetIdentity` from the input event, `synthetic: true` marker) appended
  via a new `ledger.appendSynthetic(entry)` that bypasses the
  DISCRETE_ACTION_TYPES filter (the filter stays intact for raw events —
  R1). Clear the tracker entry.
- Projection surfaces it as Unclassified (`physicalEventType: 'change'`)
  → visible, honest, greppable. IR mapping for it is **D2**, not this phase
  (adapter currently returns null for non-click physical types — preserved,
  not replayable; unchanged).
- Guard pins: no synthetic entry when a TextEntry lifecycle exists or later
  completes (normal typing untouched); no entry on blur-without-input
  (untouched fields); one entry per episode (tracker cleared on mint).

### S4 — Body/HTML click capture (F4)

- `NON_INTERACTIVE_TAGS`: remove **BODY and HTML only** (SVG internals stay).
  Strategy 3 then returns the body element for clicks on empty background;
  parent-walk termination unchanged (html.parentElement === null).
- Result: body clicks become observed events → ledgered (click/contextmenu;
  mousedown pairs via S1') → projected **Unclassified** cards. NOT Click —
  no claim gate matches body; no fabrication.
- Noise posture: accepted as cost initially (§6); S0 census quantifies
  volume. If volume is high, a follow-up normalizer fold rule (body-target
  Unclassified with no `actionabilityEvidence` adjacent to a recognized
  interaction → folded) is a **census-gated** addition, NOT in this spec's
  core — measure first.
- Focus/blur/mousemove on body are non-discrete → unledgered → no noise.

### S5 — `actionabilityEvidence` flag (F7, metadata only)

Computed in the LP2 projected-Unclassified enrichment loop (post-S1, evidence
now attached):

```
actionabilityEvidence = evidence && (
  domChanges.length > 0 ||
  newSurfaces.length + removedSurfaces.length > 0 ||
  visibilityChanges.length > 0 ||
  navigation.length > 0 ||
  networkActivity.some(n => n.sourceEventId === card eventId)
)
```

- Presentation metadata ONLY: no type change, no NOISE_TYPES change, no IR
  change, no KR signature change (metadata not hashed into signatures —
  verified B1: signatures key on type+element shape).
- Panel rendering of the flag: one badge line in the Unclassified card
  ("app responded — DOM change in click window"), same pattern as B2's
  comboboxSignal why-line.
- Deterministic: pure shape check over recorded facts. Honesty: the flag
  claims only what the evidence records (a change occurred in the window),
  never causality (INV-APP-1 preserved — no claim *the click caused it*;
  the badge copy says "in click window").

---

## §3 Regression constraints (R1–R12)

| # | Constraint | Protection |
|---|---|---|
| R1 | capture-guarantee-v2 pins: plain DIV/SVG/span → Unclassified; **raw non-discrete events NOT preserved** (scroll/input/change) | S3 mints synthetic entries only on the guarded blur-boundary path; explicit pin: raw `change` alone → still no card |
| R2 | B2 combobox flows (292 files) — no double evidence attach, no card-count drift | S1 drains projected cards only (guarded); E2E re-run must reproduce the exact 9-step IR plan byte-parity |
| R3 | 6F-M1 gesture ownership 8/0 + WARN-4 W4-T4/T5 pins | S2 reuses the append-only memberEvents pattern; mousedownCaptureSeq guard untouched |
| R4 | RCA2 S3' displaced-end pins (abandoned dropdown → releaseClaims → Unclassified) | S2 touches ONLY the isDuplicate branch; abandoned/interrupted release paths byte-untouched |
| R5 | TextEntry 6C dual-sample + B2 Flows A/B/C | S3 fires only when no lifecycle claims the inputs; pins: normal typing produces zero synthetic entries |
| R6 | 7.4-M1 affordance 12/0, 7.3 W-B, 6D.1 W3f | untouched; suite gates |
| R7 | 7.4-B1 Expander 13/0 + 3/0 | untouched; suite gates |
| R8 | IR plan parity on existing recordings | S5 metadata-only; NOISE_TYPES/INTERACTION_TO_IR_ACTION untouched; E2E asserts identical step arrays pre/post |
| R9 | `cmdrunner_pending_evidence` schema + MV3 restart recovery read path | S1 is additive drain; older stranded entries drain at next STOP (accepted behavior change, honest) |
| R10 | M5 self-consistency check (every ledger entry represented) | S2 folded events claimed+appended (coverage ↑); S3 synthetic entries surface as projected cards (represented); S4 body entries surface; pins added for each |
| R11 | S1' pairPhysicalPress adjacency folding | untouched; S4 body mousedown→click pair folds to one card (pinned) |
| R12 | resolveTarget parent-walk termination (no infinite loop without BODY/HTML sentinels) | `html.parentElement === null` terminates; unit pin |

House regression matrix at closure: 6E-M2 28/0, 6F-M1 8/0, 7.4-M1 12/0,
B1 13/0 + 3/0, capture-guarantee-v2, vocabulary-freeze (no new `*_CLASS_RE`
— S0–S5 add none).

---

## §4 Acceptance criteria

### S1 — projection evidence join
- [x] S1-1 Projected Unclassified card whose eventId has a pendingEvidence
      entry → card.behavioralEvidence attached post-STOP.
- [x] S1-2 Richest-candidate wins when multiple pending entries match.
- [x] S1-3 Drained keys removed from `cmdrunner_pending_evidence`;
      persist happens once per STOP.
- [x] S1-4 Runtime-emitted cards unaffected (no double attach; guard pin).
- [x] S1-5 Real-Chrome: the B2 Flow-C click-away Save click → its Unclassified
      card (pre-S2 build) or folded card (post-S2) carries the
      `display:none` domChange evidence.

### S2 — dedup fold
- [x] S2-1 Two clicks, same interactive element, gap ≤ 2s → ONE interaction,
      `metadata.repeatCount === 1`, ZERO Unclassified resurrection.
- [x] S2-2 Folded click's ledger disposition `claimed` by the prior
      interactionId; memberEvents appended (eventId-guarded).
- [x] S2-3 M5 self-consistency passes with folded events.
- [x] S2-4 onDedupFold → persist called (MV3 survival pin).
- [x] S2-5 Post-restart degradation → suppress-and-release (documented);
      pinned explicitly.
- [x] S2-6 Abandoned/interrupted releaseClaims paths byte-identical (R4).
- [x] S2-7 Real-Chrome: B2 E2E re-run shows zero dedup-resurrected cards
      (census class empty post-S2 on fresh runs).

### S3 — typed-text terminal sample
- [x] S3-1 input events with no claiming lifecycle, then blur → exactly ONE
      synthetic ledger entry (eventType change, terminal value).
- [x] S3-2 Projects as Unclassified card with `physicalEventType: 'change'`,
      terminal value visible in metadata.
- [x] S3-3 Normal typing (lifecycle present/completing) → zero synthetic
      entries, zero extra cards (R5).
- [x] S3-4 Blur without prior unclaimed input → zero entries.
- [x] S3-5 Raw `change` event alone (no input tracking) → still nothing
      (R1 pin).
- [x] S3-6 Real-Chrome: no-focus typing scenario (autofocus fixture)
      surfaces the typed value.

### S4 — body/HTML capture
- [x] S4-1 Click on body background → observed event → ledgered → ONE
      Unclassified card (mousedown paired via S1').
- [x] S4-2 Focus/blur/mousemove on body → no ledger entries, no cards.
- [x] S4-3 SVG internals still rejected (set minus BODY/HTML).
- [x] S4-4 Parent-walk termination pin (R12).
- [x] S4-5 Real-Chrome: popover dismissed by body click → card exists AND
      (post-S1/S5) carries the removal evidence + flag.

### S5 — actionabilityEvidence
- [x] S5-1 Unclassified click with consequence-bearing evidence →
      `actionabilityEvidence: true` in metadata.
- [x] S5-2 Unclassified click with empty evidence → flag absent/false.
- [x] S5-3 Flag never changes type/IR/KR: NOISE_TYPES untouched, IR plan
      byte-identical with and without flag (R8 pin).
- [x] S5-4 Panel renders the badge line when flag true (textContent —
      XSS-safe like comboboxSignal).
- [x] S5-5 Real-Chrome: body click-away dismissal card shows the badge.

### S0 — census
- [x] S0-1 Analyzer classifies a given dump into the four classes with
      counts + per-card detail.
- [x] S0-2 Baseline report captured on pre-B3 build (committed as evidence).
- [x] S0-3 Post-B3 delta report: dedup-resurrected class empty; body
      structural class present; evidence-consequential measurable.
- [x] S0-4 CENSUS-REPORT.md consumed by the D1/D2 decision record.

### X — cross-cutting
- [x] X1 Full suite green; tsc remains exactly 8 pre-existing errors.
- [x] X2 ZIP four-way identity discipline (root, download/, serve mirror,
      PROVENANCE md5).
- [x] X3 House regression matrix green (§3 list).
- [x] X4 Reviewer PASS + infra_verifier PASS + E2E harness 74b3 all-green.
- [x] X5 Doctrine intact: no timing rules introduced (all boundaries
      structural: dedup window pre-existing, blur boundary, tag sets);
      no new claim gates; no IR output change.

---

## §5 Test plan

| Layer | Files |
|---|---|
| Unit — S1 | `tests/runtime/projection-evidence-join-7-4-b3.test.ts` (S1-1..S1-4) |
| Unit — S2 | `tests/runtime/dedup-fold-7-4-b3.test.ts` (S2-1..S2-6) |
| Unit — S3 | `tests/runtime/typed-text-terminal-sample-7-4-b3.test.ts` (S3-1..S3-5) |
| Unit — S4 | `tests/tap/body-click-capture-7-4-b3.test.ts` (S4-1..S4-4) |
| Unit — S5 | `tests/runtime/actionability-flag-7-4-b3.test.ts` (S5-1..S5-4) |
| Doctrine | extend `tests/doctrine/vocabulary-freeze-7-4-b2.test.ts` sibling: no new `*_CLASS_RE` (S0–S5 add none) |
| E2E | `harness-74b3.mjs` + `public/census-validation.html` (body click-away popover, double-click repeat, autofocus-no-focus typing, plain-div click) — asserts S1-5, S2-7, S3-6, S4-5, S5-5, X-IR parity |
| Census | `scripts/unclassified-census.mjs` + `CENSUS-REPORT.md` (S0-1..S0-4) |

Red-first for every S2–S5 unit pin (B1/WARN-4 house rule): each pin written
and shown failing against current HEAD before implementation.

---

## §6 Accepted costs

1. **Body-click card volume** (S4): every stray background click becomes an
   Unclassified card until/unless a census-gated fold rule is added. Cost
   accepted for honesty; measured by S0; revisit explicitly.
2. **Post-restart dedup degradation** (S2): folds impossible after SW death
   → honest resurrection returns for that window. Pinned, quantified by
   census delta.
3. **`change`-type Unclassified cards** (S3): a new card shape users will
   see. Not replayable until D2 decides adapter policy.
4. **Old stranded evidence drains on next STOP** (S1): sessions recorded
   pre-B3 will suddenly attach old pending evidence to projected cards on
   their next STOP within that session. Honest; noted.
5. **pendingEvidence map shrinks** (S1): less forensic residue in dumps —
   the census analyzer must account for drained entries when reading
   pre/post-B3 dumps (differently-shaped inputs).

## §7 Risks & mitigations

| Risk | Mitigation |
|---|---|
| S2 fold corrupts memberEvents across restarts | eventId-guarded append (same as 6F-M1); degradation path pinned; M5 check extended |
| S3 tracker leaks (element removed before blur) | tracker entries also cleared on element-removal observation + MAX cap; pinned |
| S4 body-click flood degrades panel | S0 measures first; census-gated fold rule is a separate decision with the number in hand |
| S5 flag misread as causality | badge copy scoped to "in click window"; INV-APP-1 comment pinned in code |
| Evidence attach changes existing card snapshots (LP2 re-enrichment ordering) | flag computed after attach, enrichment loop order pinned |

## §8 Closure

Two-commit, owner-gated: commit 1 src+tests+fixtures; commit 2
spec+evidence (harness, dumps, CENSUS-REPORT, PROVENANCE)+roadmap+handover.
House matrix + ZIP four-way + doctrine statement in the closure report.
D1/D2 decision record attached (decide, don't default).
