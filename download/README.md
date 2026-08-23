# CmdRunner Smart Recorder — Extension Downloads

## Canonical build — `cmdrunner-extension.zip`

Always download **`cmdrunner-extension.zip`** from this directory (the
unversioned name is kept current; versioned files are archived and 404).

- **Current build:** manifest **10.9.0**, packed **2026-08-23 12:39 UTC**
  from HEAD `be5faf3` (branch `capability-surgical-removal`; src state of
  commit `89ff297` + tests-only commits after).
- **MD5:** `586daa2cf9e7d2ee394445828e281c19`
- **SHA-256:** `8a1118d37222771e084fd8debc8ab3017a48bf0d67fabd49e9bb09b7baf49008`
- **Size:** 296,202 bytes / 38 files
- **What it contains beyond the Aug-22 `7594401` build (last manual-test
  build):**
  - 6E-M2 react-datepicker family (separator-tolerant triggers, travel-date
    vocab, `datepicker__day` cells, ancestor-path guard) — AdaniOne dates
    defect CLOSED
  - 6F-M1 structural gesture ownership — twin Click cards after
    mousedown-completed DatePickers are absorbed (no duplicate cards/IR
    steps); KR parameter values render for date params; settle-window
    stabilityTrace delivered
- **Verified:** real-Chrome E2E 9 PASS / 0 FAIL (`phase-6f-m1-e2e-2026-08-23`);
  suite 260 files / 4,513 tests green; infra audit PASS.

Historical builds live under `.drytis/artifacts/archive-2026-08-23/`
(workspace-only, not served).
