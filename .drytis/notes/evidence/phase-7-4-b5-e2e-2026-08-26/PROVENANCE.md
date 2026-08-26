# 7.4-B5 E2E Provenance

## Build state
- **Commit (feat):** `544059c` — Modal definition (dialog open + Escape dismissal + KEYBOARD_SHORTCUT replay)
- **Commit (docs):** `<pending>` — spec + evidence + roadmap + handover
- **Branch:** `capability-surgical-removal`
- **ZIP:** `cmdrunner-extension.zip`, manifest 10.9.0, 305,561 bytes, 40 files
- **MD5:** `9a879ef9cb1fcfa742d57f0459775c49` (four-way identical: root, download/, serve mirror, live URL)
- **SHA-256:** `e3a896d257bdc4e558753d01a458d0ac253d803fa0fcfa46c6845b1c0185d5a6`

## E2E harness
- **Harness:** `harness-74b5.mjs` (real Chrome 148 CDP, fixture server :8245)
- **Fixture:** `public/modal-validation.html`
- **Run:** `b5-full-final` — 12 PASS / 0 FAIL
- **Checks M1–M10:**
  - M1: Modal open — aria-haspopup=dialog trigger claimed by Modal (not Click)
  - M2: Modal open IR — CLICK step on trigger element
  - M3: Modal dismiss — bare Escape inside dialog claimed by Modal
  - M4: Modal dismiss IR — KEYBOARD_SHORTCUT step with NoTarget {kind:"none"}
  - M5: Both-present — aria-expanded + haspopup=dialog → Modal wins at 75 < Expander 80
  - M6: Backdrop parity — in-overlay backdrop stays Click (unchanged)
  - M7: Non-dialog Escape — bare Escape outside dialog → Unclassified (unchanged)
  - M8: No double-claim — no event claimed by two definitions
  - M9: KEYBOARD_SHORTCUT renderer — renders page.keyboard.press
  - M10: Console errors — zero

## Suite
- 309 files / 4,867 tests green
- tsc exactly 8 pre-existing errors

## What B5 changed in shipped bytes
- `service-worker-inline.js` now includes Modal claim logic, KEYBOARD_SHORTCUT executor + renderer cases, ir-bridge NoTarget path
- Deleted `modal-tracker.ts` (dead code, never imported)
- Net: +1,586 / −125 lines across 23 files (commit 1)