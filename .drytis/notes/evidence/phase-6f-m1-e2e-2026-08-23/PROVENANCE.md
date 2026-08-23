# 6F-M1 provenance pointer

The passing E2E artifacts (`harness-6f.mjs`, `run-2.log`, `dumps/m2-*.json`)
in this directory were produced **after commit 1 (`89ff297`)** with a dist
rebuilt from the identical src tree that commit contains (the 12:39 build
that also packed ZIP md5 `586daa2c…`). The src diff between 527f73b and
89ff297 is zero for everything the harness exercises (component-runtime,
episode-builder, evidence-collector; the other commit-1 files are tests
only), so the run is valid evidence for the committed code.

`run-1.log` is the falsification run against the ORIGINAL `captureSeq+1`
draft (8 PASS / 3 FAIL, twins present) — kept deliberately as the record of
why the rule was corrected. See spec changelog:
`.drytis/specs/phase-6f-m1-gesture-ownership.md`.

The 6E-M2 historical dumps at
`.drytis/notes/evidence/phase-6e-m2-e2e-2026-08-23/dumps/` were restored to
their `527f73b` committed state after the two 6F-M1 runs (which had
overwritten them in place via the original harness OUT path).
