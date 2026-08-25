# 7.4-M1 — Affordance Capture · E2E Provenance

**Date:** 2026-08-25 (01:20–01:35 UTC) · **Commit under test:** working tree @ baseline `aca8082`
+ 7.4-M1 changes (identical to what became commit `2cd31d1`)
**Build:** dist v10.9.0 · ZIP md5 `889b8c4bff2bc8b8f31977fdb1237a33` (301,562 B, four-way
identical: root / download/ / serve/download/ / preview-served) — `pointerCursor` +
`clickHandler` tokens verified inside shipped `service-worker-inline.js` and
`assets/recorder-entry.ts-BS_1VMgu.js`.
**Chrome:** Chrome for Testing 148.0.7778.97, `--headless=new`, `--load-extension=/workspace/dist`.
**Fixture:** `public/affordance-validation.html` — GENERIC (no test attributes, no roles,
no site tokens; interactivity expressed ONLY via CSS affordance), served by a zero-dependency
`node:http` static server on 127.0.0.1:8242.

## Files

| File | Meaning |
|---|---|
| harness-74m1.mjs | CDP harness (house pattern: panel-context START/STOP, trusted Input.dispatchMouseEvent clicks, engine truth from `chrome.storage.local.cmdrunner_live_interactions`) |
| run-1.log | empty marker (run 1 output captured to /tmp — infra-only runs) |
| /tmp/74m1-run1.log, -run2.log | archived runs 1-2 (12 PASS / 4 FAIL pre-harness-fix) |
| run-6e-regression.log | house 6E-M2 DatePicker regression on the 7.4-M1 build |
| run-6f-regression.log | house 6F-M1 gesture-ownership regression on the 7.4-M1 build |
| dumps/session-74m1.json | the six fixture interactions as engine cards (type/tag/cls/name/css/pc/ch) |
| dumps/console-74m1.json | panel-context console errors (empty) |
| dumps/regression/ | fresh dump copies of the 6E-M2 + 6F-M1 regression runs (original evidence dirs restored to their committed bytes) |

## Run history (honest)

- **Run 1-2 (12 PASS / 4 FAIL)** — all core pins green (V1 pointer chip, V2 honest
  Unclassified, V4 onclick, V7 fact persistence, V8 zero console errors). The 4 FAILs:
  (a) V3/V3b — harness expectation wrong: assumed inner-span → parent lift, but real Chrome
  INHERITS cursor:pointer so the span is itself affordance-carrying; Strategy 2 (unchanged
  code) resolves the leaf and claims Click ON THE SPAN. Honest + replayable. Corrected the
  harness to the Chrome truth and pinned BOTH truths in units (C4 explicit cursor:auto leaf →
  lift; C4b inherited-pointer leaf → claim on itself). (b) V5/V6 — harness bug: below-fold
  targets not scrolled into view (the documented 7.3-harness lesson); fixed via
  scrollIntoView in rectOf().
- **Run 3 (16 PASS / 0 FAIL)** — the recorded result.

## Environmental truths discovered (documented for the next harness author)

1. `execSync('curl …')` inside an ESM module with top-level await **deadlocks** in this
   Node v20.20.2 container build — use a pure `node:http` readiness probe instead
   (isolated with /tmp/probe*.sh + /tmp/loop.mjs).
2. `http-server` is not installed in this session's container — the harness ships its own
   zero-dependency `node:http` static server.
3. The house app-verbatim fixture on :8190 (`phase-6e-m2-e2e-2026-08-23/app-verbatim.mjs`)
   must be started manually (documented /tmp persistence gap) before running the 6E-M2 /
   6F-M1 regression harnesses.

## Results

| Suite | Result |
|---|---|
| 7.4-M1 E2E (V1..V8) | **16 PASS / 0 FAIL** |
| 6E-M2 DatePicker regression | **8 PASS / 0 FAIL** |
| 6F-M1 gesture-ownership regression | **9 PASS / 0 FAIL** |
| Unit/integration suite | 283 files / 4,694 tests green |
| tsc | exactly 8 baseline errors |
| Doctrine genericity pin | green |
| reviewer / infra_verifier | PASS / PASS (after serve-mirror fixture sync) |
