# CmdRunner Smart Recorder — Extension Downloads

## Canonical build — `cmdrunner-extension.zip`

Always download **`cmdrunner-extension.zip`** from this directory (the
unversioned name is kept current; versioned files are archived and 404).

- **Current build:** manifest **10.9.0**, packed **2026-08-26 ~10:00 UTC**
  (7.4-B5 build) from commit `544059c` on `capability-surgical-removal`
  (B4 closure `ff8eb15` + 7.4-B5 Modal definition).
- **MD5:** `9a879ef9cb1fcfa742d57f0459775c49`
- **SHA-256:** `e3a896d257bdc4e558753d01a458d0ac253d803fa0fcfa46c6845b1c0185d5a6`
- **Size:** 305,561 bytes / 40 files
- **What it contains beyond the Aug-26 `fabec454` B4 closure build:**
  - 7.4-B5 Modal definition: dialog open (aria-haspopup=dialog) + Escape
    dismissal (dialog in ancestry-or-self) at priority 75
  - KEYBOARD_SHORTCUT replay: renderer case (page.keyboard.press), both
    executor cases (KeyboardEvent keydown+keyup), ir-bridge NoTarget path
  - Incidentally fixes F3 (latent modifier-shortcut replay defect)
  - Deleted modal-tracker.ts (114 lines dead code)
  - Six new test files + five pin updates (309 files / 4,867 tests green)
- **Verified:** real-Chrome E2E 12 PASS / 0 FAIL (`b5-full-final`,
  harness-74b5.mjs); ZIP four-way md5 identical (root, download/, serve
  mirror, live URL); suite 309 files / 4,867 tests green; tsc exactly 8
  pre-existing errors. NOTE: the ZIP packer embeds build mtimes, so the md5
  above refers to THIS build served from this directory; entry content is
  deterministic across rebuilds.

Historical builds live under `.drytis/artifacts/archive-2026-08-23/`
(workspace-only, not served).