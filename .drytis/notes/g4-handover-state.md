# G4 handover state — 2026-08-15 03:52 UTC

## Working tree (UNCOMMITTED, verified directly — not from reports)
- Branch `capability-surgical-removal`, HEAD `696f0d9`, **ahead of origin by 9**.
- G4 (multi-tab capture & triple-key attribution) fully present in working tree:
  - 10 modified files (539+/166−): evidence-attribution, network-drain,
    network-observation, service-worker, sw-integration, component-types,
    3 test files, form-submit spec.
  - 2 untracked: `.drytis/specs/multi-tab-capture-attribution.md` (R12–R23),
    `tests/unit/background/multi-tab-capture-attribution.test.ts` (464 lines).
- G4-A gate = `recordingActiveFlag` tri-state (network-observation.ts);
  G4-B stamp map = `lastTrustedActionByFrame` keyed `tabId:frameId` +
  `captureOrigin` on payloads; G4-C `stampEligible()` (click/contextmenu/
  change/submit/drop + Enter-only keydown); G4-D `bootRestorePromise`;
  G4-E wholesale stop cleanup. Storage key is `cmdrunner_net_last_action`
  (not `cmdrunner_last_trusted_action`).

## Validation reproduced 03:55 UTC
- TSC 0 errors; **151 test files / 3,127 tests passed** (52s).

## ZIP built 03:57 UTC (fresh, dist wiped first)
- v10.9.0 (manifest.json), 39 files, 166,993 bytes,
  md5 `b7f695e58e98a5eee04d1b4bac01d90d`.
- Download URL verified: HTTP 200, byte-identical to local file.
- NOTE: package.json version says 10.4.18 but manifest.json (what Chrome
  reads) says 10.9.0 — manifests disagree; harmless for Chrome but worth
  syncing at next commit.

## Next step
Manual R12 repro with the ZIP: record in Tab A → Amazon flow in Tab B →
Add to cart → `/cart/add-to-cart` captured + attributed exactly once to the
originating click. AI-layer work blocked until this passes.
