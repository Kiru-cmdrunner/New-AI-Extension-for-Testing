# CmdRunner Smart Recorder — Extension Downloads

## Canonical build — `cmdrunner-extension.zip`

Always download **`cmdrunner-extension.zip`** from this directory (the
unversioned name is kept current; versioned files are archived and 404).

- **Current build:** manifest **10.9.0**, packed **2026-08-26 ~03:27 UTC**
  (7.4-B4 build) from the B4 working tree on `capability-surgical-removal`
  (B3 closure `21e6bf8` + 7.4-B4 D2 policy alignment).
- **MD5:** `fabec45419834c511d65300b7c6a91eb`
- **SHA-256:** `c9c7228c6abd97a214010ee2247450141fe21c4635b2cec2587d908d807c977c`
- **Size:** 304,895 bytes / 40 files
- **What it contains beyond the Aug-25 `b702ac44` B3 closure build:**
  - 7.4-B4 (D2 DROP): the dead-path output-adapter's Unclassified EMIT
    branch is removed — `toIRAction` returns null for every Unclassified
    physical type, aligning with the live bridge's NOISE_TYPES policy;
    local IRAction union reduced (no RIGHT_CLICK)
  - **No behavioral change in shipped bytes**: the semantic bundle diff
    vs the B3 closure is exactly ONE comment line (the ir-bridge
    annotation); the adapter was already tree-shaken out. Both pre/post
    SW bundles are archived in
    `.drytis/notes/evidence/phase-7-4-b4-e2e-2026-08-26/`.
- **Verified:** real-Chrome E2E 14 PASS / 0 FAIL (`b4-full`,
  harness-74b3.mjs); census-flow IR plan identical to the B3 closure run
  (volatile-id-normalized); suite 303 files / 4,817 tests green; tsc
  exactly 8 pre-existing errors. NOTE: the ZIP packer embeds build
  mtimes, so the md5 above refers to THIS build served from this
  directory; entry content is deterministic across rebuilds.

Historical builds live under `.drytis/artifacts/archive-2026-08-23/`
(workspace-only, not served).
