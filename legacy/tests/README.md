# Legacy Tests

**Archived:** July 2026  
**Status:** Tests for archived legacy content scripts

## What's Here

- `hover-content-script.test.ts` — 66 tests for the legacy hover content script

These tests verified the standalone content scripts that have been superseded by
the deterministic recorder. The interaction types they tested (hover detection,
behavioral classification) are now covered by:

- `tests/evidence-engine/` — V1 + V2 detection tests
- `tests/recording-session-phase1.test.ts` — session-level event capture

**Do not run these tests.** They import from `legacy/content-scripts/` which is
not part of the active build.
