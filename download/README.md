# CmdRunner Smart Recorder — Extension Downloads

## Canonical build — `cmdrunner-extension.zip`

Always download **`cmdrunner-extension.zip`** from this directory (the
unversioned name is kept current; versioned files are archived and 404).

- **Current build:** manifest **10.9.0**, packed **2026-08-25 ~21:24 UTC**
  (closure build) from the 7.4-B3 working tree on `capability-surgical-removal`
  (baseline HEAD `6f94df4` + B3 changes + reviewer-critical fixes; closure
  commits follow).
- **MD5:** `b702ac441996d015ca0efa404c0dafb8`
- **SHA-256:** `d2eb9c0d4cc4c56cd24bebb8b3120c0984b462731e1e13b5d5c4472d47e78e90`
- **Size:** 304,841 bytes / 40 files
- **What it contains beyond the Aug-25 `762de56e` B2 build:**
  - 7.4-B3 S1: STOP-time projection evidence join — stranded
    `cmdrunner_pending_evidence` now attaches to projected Unclassified
    cards (eventId join, persist-exactly-once guard)
  - 7.4-B3 S2: dedup fold — dedup-suppressed clicks fold into the prior
    interaction (repeatCount, claimed members, press-half recovery) instead
    of resurrecting as Unclassified
  - 7.4-B3 S3: typed-text terminal sample — one synthetic `change` ledger
    entry per typing episode surfaces the final value even when no
    TextEntry card exists
  - 7.4-B3 S4: BODY/HTML click-away capture — body-dismissal clicks are
    now captured as (Unclassified) cards instead of invisible
  - 7.4-B3 S5: `actionabilityEvidence` flag + panel badge; RCA fix —
    folded lifecycles release their evidence bindings (FINALIZE_EVIDENCE
    at fold time)
- **Verified:** real-Chrome E2E 14 PASS / 0 FAIL
  (`phase-7-4-b3-e2e-2026-08-25/b3-full-closure`, harness-74b3.mjs against
  this closure build); suite 300 files / 4,800 tests green; tsc exactly 8
  pre-existing errors; infra audit PASS after serve-mirror + provenance
  refresh. NOTE: the ZIP packer embeds build mtimes, so byte-identity holds
  only within one build — the pinned md5 above refers to THE closure build
  served from this directory; entry content is deterministic across
  rebuilds (verified entry-hash-equal).

Historical builds live under `.drytis/artifacts/archive-2026-08-23/`
(workspace-only, not served).
