# WARN-4 — Active-lifecycle absorption does not supersede gesture records

**Status**: SHIPPED — commit 1 `7f8f680` (src+tests), commit 2 docs; owner gate closed 2026-08-24 10:54 UTC
**Baseline**: a26124a (7.1-W2 closure)
**Lineage**: 6F-M1 reviewer WARN-4 (2026-08-23), deferred three times (6F-M3 Wave 1, 7.0-KR, 7.1-W2)
**Owner gate**: open (this document is the gate report basis)

---

## 0. HONESTY CORRECTIONS (visible, not rewritten)

This spec has three corrections in its history, all retained visibly:

1. The original §1 "concrete failure" was corrected mid-spec after
   re-reading 3b's owner-miss else-branch — the honest damage is
   misattribution + a downstream twin, not twin-suppression.

2. During implementation (2026-08-24) the first version of the
   supersession block broke 4 of 8 6F-M1 regression pins (AC-A1, A1b,
   A5b, A4). Root cause: the completing mousedown that CREATES a record
   is itself a discrete event handled by an active lifecycle, so a
   guard-less block supersedes the record at birth. Corrected with the
   ORDERING guard `g.mousedownCaptureSeq < event.captureSeq` (ordering
   between events, not a timing window — no Date.now, no constant
   thresholds). After the guard: 17/17 6F-M1 matrix + WARN-4 matrix
   green.

3. Red-first evidence (same day) narrowed the PRE-FIX defect to a
   single shape: a **silently-absorbed CLICK**. Keydown/mousedown at an
   overlay trigger absorb silently at step 3 without superseding in the
   pre-fix tree — but they equally do not break the release click's
   ADJACENCY, because adjacency is discrete-event order and those events
   genuinely intervene in that order... they are, however, handled at
   step 3, never falling through to step 2c's supersession. The verified
   pre-fix asymmetry: only CLICKS that are absorbed silently by an
   active lifecycle fail to supersede same-page records. W4-T6 pins
   exactly this shape and is the red-first proof (pre-fix: 0 honest
   Click cards; post-fix: 1).

---

## 1. The defect

### As reported (6F-M1 reviewer WARN-4)

A click consumed by an ACTIVE lifecycle (handled=true at step 3) never
supersedes that page's gesture records — unlike step 2c (unhandled
discrete events) and the record site (:735-737, newer completing
mousedown). A stale record can claim a later genuine click for the OLD
interaction (misattribution), and the record is then consumed, so the
interaction the click actually belonged to loses its evidence.

### As verified (2026-08-24, live probes dbg11c/dbg11d + red-first run)

The defect is real but NARROWER than reported. Concretely (page pT6,
element cell-7, base fixture identical to the 6F-M1 suite):

1. `focus` at wrapper arms a DatePicker (priority 60).
2. `mousedown` at cell-7 completes it → record G1 armed (mousedownSeq 3,
   `superseded=false`).
3. A second lifecycle (overlay, priority 40, mousedown-triggered, never
   completes) is armed on cell-9 BEFORE G1 — no records exist yet, so
   its arming does not supersede anything.
4. A **click at the overlay's trigger (cell-9)** is silently absorbed by
   the active overlay (step 3, same-element, handleEvent→null). In the
   pre-fix tree this absorbed click does NOT supersede G1.
5. A genuine click at cell-7 arrives. G1 is still `superseded=false`,
   same pageId, same elementKey, captureSeq > 3 → **step 3b claims it
   for the OLD DatePicker interaction**. The user's Click card is
   stolen: no honest Click interaction is emitted, the click's evidence
   is misattributed to the DatePicker, and the record is consumed.

Damage: misattribution + missing honest card — not a visible duplicate
twin (the honest card is suppressed, not duplicated).

### Why the report was broader than reality

The reviewer's hypothetical assumed any absorbed discrete event breaks
adjacency. Verified live: a keydown/mousedown absorbed silently at step
3 pre-fix DOES leave `superseded=false` on records — but in the same
sequences, the overlay's own ARMING mousedown (a discrete event handled
at discovery) has already superseded same-page records via step 2c
before the keydown lands, or no records exist yet (arming predates
them). Only the absorbed CLICK shape both (a) leaves a record live and
(b) intervenes in discrete order between the recorded mousedown and the
genuine release click without any 2c-visible event — the exact
asymmetry the reviewer flagged.

---

## 1b. The fix

`src/runtime/component-runtime.ts` step 3 (after the active-stack offer
loop, before step 3b):

```ts
if (handled && DISCRETE_ACTION_TYPES.has(event.eventType)) {
  const warn4PageId = pageIdOf(event.eventId);
  for (const g of this.completedGestures) {
    if (g.pageId === warn4PageId && g.mousedownCaptureSeq < event.captureSeq) {
      g.superseded = true;
    }
  }
}
```

Strictly structural: pageId equality + discrete type + ordering guard.
The guard is ORDERING, not timing: it ensures only records recorded
BEFORE this event can be broken by it (the completing mousedown that
created a record is itself a discrete handled event — without the
guard it would supersede its own fresh record at birth). Matches step
2c's discipline exactly, extended to step-3-absorbed events.

---

## 4. Acceptance criteria

- [x] **AC-1** W4-T6 fails on the pre-fix tree (red-first proof of the
  defect's reality), passes post-fix. Evidence: 2026-08-24 run — pre-fix
  1 failed | 5 passed; post-fix 6 passed | 0 failed.
- [x] **AC-2** W4-T1..T6 green post-fix (T1 documents the honest
  sequence note; T2/T3/T4/T5 pin cross-shape discipline and 6F-M1
  behavior preservation).
- [x] **2c→WARN-4 parity note** — step 2c supersession (unhandled
  discrete) unchanged; the WARN-4 block mirrors it for step-3-absorbed
 discrete events with the ordering guard 2c does not need (2c runs
  before record creation).
- [x] **AC-3** Full 6F-M1 regression matrix green (11/11: 8 + 3 pins).
- [x] infra_gates passed (suite 4,606, tsc 8 baseline, build, ZIP, serve mirror, preview 200).
- [x] **AC-8** Real-Chrome regression: 6E-M2/M1 E2E still 9 PASS / 0 FAIL.
- [ ] **AC-9** Two-commit closure: commit 1 src+tests; commit 2
  spec+evidence+roadmap with WARN-4 CLOSED. No push until owner closes
  the gate.
- [ ] **AC-10** Owner gate report before commit.

## 4b. Verification record (2026-08-24, all post-fix)

- Red-first: pre-fix run 1 failed | 5 passed — failure is exactly
  W4-T6 (independently reproduced by the reviewer via stash).
- WARN-4 matrix 6/6; 6F-M1 matrix 11/11 (8 + 3 doctrine pins).
- Full suite: 4,606/4,606 — 6 consecutive leader runs + 4 reviewer runs
  (10 total; one unattributed non-recurring flake in reviewer's first
  run, characterized in
  .drytis/notes/suite-flake-observed-2026-08-24.md).
- tsc: exactly the 8-error pre-existing baseline (verified with the
  diff stashed and restored by the reviewer).
- Build + ZIP: dist v10.9.0, 40 entries, 300,099 B.
- Reviewer: PASS (criteria 1,2,3,4,5; WARNs = flake, E2E-pending,
  closure-pending, test-doc nits — nits fixed, E2E now green below).
- infra_verifier: PASS (0 failures; 2 warnings: file-server script
  never syncs download/ — the md5 skew root cause, mirror manually
  re-synced and hash corrected in §5; stale-hash advisory resolved).
- Real-Chrome E2E regression (house harness
  phase-6f-m1-e2e-2026-08-23/harness-6f.mjs on the archived AdaniOne
  clone fixture :8190): **9 PASS / 0 FAIL** — zero twin Clicks, zero
  Unclassified cells, both DatePicker round-trips, 6B/6D.1 regressions,
  IR 5 steps, KR rows written. Fixtures killed after the run.
- Honest note on harnesses: the OLDER phase-6e-m1 harness now reports
  C5/C5b/C6/C10 failures — its expectations were frozen BEFORE 6E-M2
  added the DatePicker vocabulary (it asserts TextEntry on #depart and
  a standalone Click on the cell). The 6E-M2-era card shapes (DatePicker
  + absorbed cell) are the shipped behavior those C-checks' successors
  (E1/E2/E2b) verify green. The 6e-m1 harness is stale, not the build.

---

## 5. Honesty notes

- Red-first T2-investigation honestly recorded: on the pre-fix tree,
  T2/T3/T4/T5 all pass (the sequences' arming mousedowns supersede via
  step 2c before records exist). The single red test pre-fix is T6. §1
  and §3 were rewritten to match verified reality — the defect is the
   absorbed-CLICK shape, not any-absorbed-discrete.
- The overlay fixture type is test-only ('DatePickerOverlay' as any) —
  no production type surface touched.
- ZIP md5 8d1993af19571a6625d18e2838ea8106 (300,099 B; dist v10.9.0,
  40 entries), root = download/ = serve mirror = preview-served, all four
  verified identical 2026-08-24. (A first pack at 09:51 recorded
  2d316446… — superseded by a repack at 10:12 whose only delta was zip
  mtime metadata; content byte-identical, verified by extracted-tree
  diff. The stale hash is retained here transparently.)
- Suite 274 files / 4,606 tests green at fix+tests; tsc exactly the
  8-error pre-existing baseline; 6F-M1 matrix 11/11.
- E2E expression of the WARN-4 shape needs a two-armed lifecycle on one
  element (open→select→reopen→click); the 6E DatePicker fixture cannot
  express it honestly. AC-8 stands on the 6E regression + unit matrix;
  the E2E gap is logged here, not faked.

## 6. Owner gate report — open items for decision

None blocking. WARN-4 is CLOSED as a defect; the remaining 6F engine
backlog is empty. Two parked items (unchanged, owner-decision):
version-skew (package.json 10.4.18 vs manifest 10.9.0) and
deterministic-recorder.ts dead code. Legacy untracked files remain
unarchived pending owner decision.
