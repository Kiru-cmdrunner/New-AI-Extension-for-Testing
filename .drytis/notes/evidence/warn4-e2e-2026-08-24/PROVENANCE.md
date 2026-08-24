# WARN-4 closure — evidence provenance

**Milestone**: WARN-4 — active-lifecycle supersession (6F engine backlog)
**Date**: 2026-08-24
**Baseline**: a26124a (7.1-W2 closure)
**Spec**: `.drytis/specs/warn4-active-lifecycle-supersession.md`
**Status at close**: SHIPPED, owner gate closed

## Change

- `src/runtime/component-runtime.ts` (+24 lines): guarded WARN-4
  supersession block between step 3 (active-stack absorption) and step
  3b (gesture ownership). Step-3-absorbed discrete events now supersede
  same-page gesture records, mirroring step 2c. Ordering guard
  `g.mousedownCaptureSeq < event.captureSeq` prevents a completing
  mousedown from superseding its own fresh record at birth.
- `tests/runtime/gesture-supersession-warn4.test.ts` (new, 6 tests
  W4-T1..T6): overlay-lifecycle fixture (mousedown-triggered, never
  completing, same-cell silent absorber) + DatePicker/Click shapes from
  the 6F-M1 harness family.

## Gate record (all on the fixed tree)

| Gate | Result |
|---|---|
| Red-first (fix stashed, pre-fix tree) | 1 failed \| 5 passed — failure exactly W4-T6; reviewer independently reproduced via its own stash |
| WARN-4 matrix post-fix | 6/6 green |
| 6F-M1 regression matrix | 11/11 (gesture-ownership-6f-m1 8 + doctrine-pin 3) |
| Full suite | 4,606/4,606 — 6 leader runs + 4 reviewer runs; one non-recurring flake (reviewer run 1) preserved in `suite-flake-observed-2026-08-24.md` |
| tsc --noEmit | exactly the 8-error pre-existing baseline (stashed vs restored) |
| Build + ZIP | dist v10.9.0, 40 entries, 300,099 B; md5 `8d1993af19571a6625d18e2838ea8106` — root = download/ = serve mirror = preview-served, all four verified |
| Reviewer | PASS (criteria 1–5; doc nits fixed; flake characterized; E2E run below) |
| infra_verifier | PASS (0 failures; file-server download/-sync gap logged as standing WARN — root cause of the transient md5 skew, corrected same day) |
| Real-Chrome E2E (re-run at commit time) | 9 PASS / 0 FAIL — house harness `phase-6f-m1-e2e-2026-08-23/harness-6f.mjs` + archived AdaniOne clone fixture (:8190); log in `e2e-run.log` / `run-final.log` |

## Real-Chrome regression detail (same build)

Zero twin Click cards on calendar cells; zero Unclassified cells; both
DatePicker round-trips completed with verbatim aria-label values
(Depart on "Choose Sunday, September 6th, 2026", Return on "Choose
Tuesday, September 8th, 2026"); 6B data-auto-id Click; 6D.1 options-list
Click; #id-only counter seeded; IR plan 5 steps
(`selectDate,selectDate,click,click,click`); KR rows written (1 app, 1
session, 3 signatures). KR views/viewTransitions 0 in this run is
expected — the AdaniOne clone performs no SPA URL changes.

## Honesty notes preserved

1. **Suite flake** — one full-suite run in ten showed `1 failed | 4605
   passed`; name not captured (reviewer's first run, unlogged). WARN-4
   and 6F-M1 files were green in that run and in 5+ subsequent runs.
   Characterized in `.drytis/notes/suite-flake-observed-2026-08-24.md`
   with a standing action: always tee suite output to a log file so a
   flake's name is captured on first occurrence.
2. **Stale phase-6e-m1 harness** — reports C5/C5b/C6/C10 failures on
   any post-6E-M2 build. Its expectations were frozen BEFORE 6E-M2 added
   the DatePicker vocabulary (asserts TextEntry on #depart and a
   standalone Click on the date cell). The shipped behavior those
   checks' successors verify green (DatePicker card + absorbed cell,
   E1/E2/E2b). The harness is stale, not the build; preserved as-is for
   history, not deleted. Do not "fix" product code against it.
3. **E2E expression of the WARN-4 shape itself** needs a two-armed
   lifecycle on one element (open→select→reopen→click) which the
   AdaniOne clone cannot express honestly; AC-8 stands on the 6E
   regression + the unit matrix. Logged, not faked.

## Commits

- Commit 1 (src+tests): `src/runtime/component-runtime.ts` +
  `tests/runtime/gesture-supersession-warn4.test.ts`.
- Commit 2 (spec+evidence+roadmap): this directory (PROVENANCE.md,
  e2e-run.log, run-final.log), the spec, and the roadmap entry.
  Refreshed 6E dump JSONs from the regression runs are included as
  evidence of the current build's behavior (the dumps carry fresh run
  IDs/timestamps; content equivalent to the shipped baselines).
- No push. Both commits remain local until the owner publishes.
