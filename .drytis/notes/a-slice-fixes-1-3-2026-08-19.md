# A-Slice Fixes 1-3 — post-1703e43 corrective slice (2026-08-19)

Fixes the three confirmed product failures from the real-Chrome audit of HEAD 1703e43
(.drytis/notes/head-audit-1703e43.md). NOT committed/pushed (awaiting user review).

## Fix 1 — resulting-state consequence mis-attribution (TextEntry photographs click's DOM)
- **Root cause (2 layers)**: settle scan is live-DOM at settlement (INV-CS3). (a) A type
  window finalized on blur can enter settle mode AFTER the next interaction's window opens
  (click event fires synchronously in-page; blur-driven FINALIZE arrives via async SW
  round-trip). (b) The naive "any newer open window supersedes" rule OVER-SUPPRESSES: the
  native form `submit` window opens ~0.4ms after the submit-button `click` and kills the
  click's own scan (found in re-audit round 2 — click RS went null).
- **Fix**: `settleSuperseded` flag with TWO symmetric halves:
  1. openWindow marks any already-settling window superseded when a new window opens;
  2. enterSettleMode (late FINALIZE) marks the entering window superseded when a newer,
     live, non-superseded window opened ≥ COMPANION_WINDOW_MS (300ms, mirrors
     companionSuppressUntil) LATER — companions (form submit after button click, change
     during typing) of the same physical action never supersede.
- Evidence (real Chrome, run4): TextEntry rs:[] ; Go-Click owns ul#results collection (3) ;
  navigation owns cart-page items; each ATC click owns counter+collection (1→2).

## Fix 2 — executor element resolution after navigation
- **Root cause**: navigate steps were a SILENT NO-OP at the SW layer (`updateTabUrl` was
  never called; content script's `case 'navigate'` returned success without acting). Run
  tab stayed on the start URL → step-0003 textMatch "not found" (element on /cart) AND
  step-0004 #add1 ElementNotFound shared this single root cause.
- **Fix**: executeStep navigate branch: `updateTabUrl` (chrome.tabs.update) →
  `waitForPageLoad` → re-`injectScript` (old document destroyed) → EVALUATE_ASSERTIONS on
  destination page with normal soft/hard semantics (navigate steps carry step-scoped
  assertions about the destination — dropped them before).
- Evidence: run tab URL observed http://127.0.0.1:8152/cart during RUN_TEST; 4/4 steps
  passed; no ElementNotFound.

## Fix 3 — textMatch failure diagnostics
- **Root cause**: not an evaluator bug. Both layers (canonical assertion-evaluator +
  executor-content-script) already report real text when the element EXISTS; the audit's
  "Element not found / actualValue null" was accurate — for the WRONG page (consequence
  of fix 2's no-op navigate). Tests that appeared to fail were fixture errors (canonical
  evaluator takes a PRE-RESOLVED element, not raw locators).
- **Fix**: regression tests pin exists-but-differs (actualValue = real text + real mismatch
  message) and genuinely-missing (null + "Element not found") on BOTH layers. No evaluator
  change.
- Evidence: step-0004 soft textMatch actualValue "1 items" vs expected "2 items", message
  `Text "1 items" did not match "2 items"` — real diagnostics. step-0003 "0 items" passes.

## Tests
- tests/tap/resulting-state-consequence-ownership.test.ts (4 tests: audit repro w/ early
  lifecycle bind + real pacing; blur-owned consequence kept; unsuperseded click keeps
  scanning; companion submit doesn't suppress).
- tests/execution/ir-executor-navigate.test.ts (3: navigate + re-inject + dest-page
  assertion eval; element-after-navigate resolves; navigate-free parity).
- tests/execution/executor-textmatch-diagnostics.test.ts (7: canonical+content-script,
  both cases, cross-layer parity).
- tests/ir-executor-impl.test.ts: createMockOptions extended with updateTabUrl mock
  (legacy navigate test pinned no-op behavior).
- Full suite: 3,913/3,913 PASS (212 files). Build OK. ZIP packed (uncommitted).

## Real-Chrome re-audit
/tmp → preserved at .drytis/notes/evidence/a-slice-fixes/ (harness + run3/run4 logs + dumps:
evidence, ir-plan, execution-result, generated-spec, scenario B). Final: **33 PASS / 0 FAIL**
(vs audit-1 Scenario A 26/5). COUNT>1 path re-verified (B: actual=3=exp, live parity).
Soft assertions: 5 evaluated / 3 pass / 2 fail; soft failures don't fail run.

## OR-1 correction (follow-up, 2026-08-19 evening — same worktree, uncommitted)
Investigation (.drytis/specs/or1-repeated-clicks.md) confirmed the collapse was OR-1 in
applyReadabilityRules (src/generation/ir-bridge.ts): unconditional same-element click merge
(freshest-assertion carryover from Phase 4c) represented two DELIBERATE clicks as one step
asserting an unreachable state; pairwise i+=2 also made 3 clicks → 2 steps.

Fix: merge only GENUINELY REDUNDANT duplicates — a following same-element click merges
iff it carries no new resulting-state assertions (assertions.length === 0). Stateful
repeats stay separate steps, each keeping its own sourceEventId + assertions; maximal
runs of stateless duplicates collapse run-length-correctly. Focus+click residue and
double-fire still merge (that's the empty-assertions case). Different elements never merge.

Tests: tests/generation/ir-bridge-repeated-clicks.test.ts (7) + updated the Phase-4c-era
test that pinned the old merge. Full suite 3,920/3,920 (213 files). Build OK.

Real-Chrome (run5/run6 logs): 5 IR steps now (fill/#go/navigate/#add1/#add1), distinct
sourceEventIds; first ATC asserts 1, final asserts 2 (its own observations); replay
clicks twice → counter 2 → "2 items" textMatch PASSES, COUNT 2 PASSES; 7/7 soft
assertions pass (was 3 pass/2 fail); spec contains TWO #add1 clicks with the full
0→1→2 assertion ladder. Audit total 35 PASS / 0 FAIL.
- Backend repo record still on stale branch; manifest v10.9.0 vs package 10.4.18;
  ENGINEERING-HANDOVER.md stale.
