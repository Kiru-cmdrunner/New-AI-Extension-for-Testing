# CmdRunner Smart Recorder — Extension Downloads

## Install

1. Download **`cmdrunner-extension.zip`** from this directory.
2. Unzip it anywhere (e.g. `~/cmdrunner-extension`).
3. Open Chrome and go to `chrome://extensions`.
4. Enable **Developer mode** (top-right toggle).
5. Click **Load unpacked** and select the unzipped folder (the one
   containing `manifest.json`).
6. Pin "CmdRunner Smart Recorder" from the puzzle-piece menu; open the
   side panel from the extension icon to start/stop recording.

## Canonical build — `cmdrunner-extension.zip`

Always download **`cmdrunner-extension.zip`** from this directory (the
unversioned name is kept current; versioned files are archived and 404).

- **Current build:** manifest **10.9.0**, packed **2026-08-29 ~12:22 UTC**
  (7.4-B7-P4 + provenance-regression fix build) from working tree on
  `capability-surgical-removal` (B6/B6.1 Enter commits + B7-P1/P2/P3/P4
  Hover evidence-observation + Click Qualification v1.2 Steps 1–2 +
  C-1…C-6 click-ordinal completeness fix).
- **MD5:** `fe8d3e98ef7fc4eb660b61957b8398fe`
- **SHA-256:** `fe32682f18e81dc66cc8c8487cdb7207062f5b44c845661f782265b0c8f89d34`
- **Size:** 320,819 bytes / 40 files
- **What this build contains beyond the Aug-28 7.4-B7-P3 build:**
  - Click Qualification v1.2 (Steps 1+2): capture-time click
    qualification — immutable invalidity facts captured at the dispatch
    instant (disabled-native, fieldset-disabled, inert-subtree,
    aria-disabled, pointer-events-none, hit-test-miss, zero-size-lifted);
    provably-invalid clicks → Unclassified with invalidityCauses; every
    other trusted click (incl. plain divs and BODY background clicks)
    claims Click unconditionally (capture is the single qualification
    authority).
  - B7-P4 ownership-safe hover IR assertions: ONE shared adversarial
    surface-fact ownership pass (batch boundary + primary-action veto +
    container precedence) consumed at both the provenance-link seam and
    the new `surface-visible` IR derivation — a Hover gains assertions
    only for facts its window genuinely OWNS (Channel A Variants 1+2
    produce zero hover assertions in real Chrome; the canonical menu
    yields two soft `toBeAttached()` expects).
  - Panel: hover rows render evidence-derived per-class consequence
    chips; gesture-only hovers group behind the existing show-hidden
    toggle row; hover admission derives from recorded evidence at render
    time.
  - Capture-level hover dedup exemption (folding destroyed lifecycle
    evidence; grouping is now presentation-only).
  - Compat bridge deleted: `filterProductionInteractions` is a pure
    filter again; the ledger anchor gate and panel derive admission from
    evidence (stored P2/P3-era `consequenceClasses` arrays remain valid
    reads for legacy rows).
  - 2026-08-29 C-1…C-6 provenance-regression fix: click-family events
    record their DOM-observer batch ordinal at capture time
    (`clickOrdinals`), lifecycle synthetic (`lc-`) windows are stamped
    with it, and attach replacements can never strip it — the ownership
    veto now discriminates on ordinals instead of window shape, restoring
    B7-P3 surface-reuse provenance links (S1/S2, KR coverage) while
    keeping Channel A V1/V2 at zero hover assertions (validated together
    in one real-Chrome run).

- **Previous build (B7-P3, kept for reference):**
- **What this build contains beyond the Aug-26 7.4-B5 build:**
  - B6 Enter-Submit Commit: TextEntry completes on the trusted native
    `submit` of its owner form (Enter-caused commits carry commitSignal
    `submit`); IR restores FILL-before-submit-CLICK ordering.
  - B6.1 form-less SPA Enter commits: two evidence-grounded tiers —
    navigation-terminal completion (shouldCompleteOnNavigation) and the
    STOP-time rescue via exact Enter↔fetch network join with
    corroboration (reconcileFormlessEnterCommits).
  - B7-P1 Hover evidence enablement: provisional hover evidence windows
    (hold-open from birth, R-2 binding race), pointer-path facts capped,
    TRIGGER_REMOVED evidence-window close on structural removal,
    byte-identical transitional gates.
  - B7-P2 Hover semantic swap (atomic): dwell/confidence/vocabulary
    thresholds deleted; six structural terminals (left, consumed-by-click,
    navigation, target-removed, recording-end, idle-timeout); gated
    discovery enters claim ledger lives; evidence-keyed admission rule
    (reveal/insertion/removal/stamped-fetch/nav/revert/pointer-reach);
    pre-STOP hover evidence drain (STOP_EVIDENCE_DRAIN) so no-leave
    hovers admit; T4 target-removed lifecycle completion via the CS→SW
    TRIGGER_REMOVED notification (completesOnTriggerRemoved +
    completeTriggerRemoved + resolveTriggerRemovedLifecycle R-2 fallback
    join).
  - B7-P3 hover understanding: admitted hovers now ANCHOR their own
    episodes (admission-keyed predicate in the evidence ledger —
    non-hover anchoring byte-identical); `surface-reuse` provenance
    links (non-causal, degraded joins labeled) connect a hover-reveal
    episode to the click episode that consumed the revealed surface via
    the shared deterministic surface join (id-exact / chain-degraded /
    tag-floor-degraded), with first-window fact ownership stopping
    replay windows from fabricating links; hover episodes and signatures
    persist to the Knowledge Repository with zero schema change
    (frozen appId:sig:hash identity; occurrenceCount reinforcement
    verified 1→2 across sessions); pointer-reach admission join fixed to
    the real carrier grammar (was real-Chrome-dead).
- **Verified:** real-Chrome harnesses — B7-P3 all 7 scenarios PASS
  (anchoring, link emission, gesture-only exclusion, unrelated-click,
  two-consumers), B7-P3 KR persistence 3 sessions PASS, B6 enter-submit
  PASS (fill→click→navigate), B6.1 all three fixtures PASS; suite 341
  files / 5,031 tests green; tsc exactly 8 pre-existing errors;
  reviewer PASS; infra PASS; public /download md5-matched.
  NOTE: the ZIP packer embeds build mtimes, so the md5 above refers to
  THIS build served from this directory; entry content is deterministic
  across rebuilds.

Historical builds live under `.drytis/artifacts/archive-2026-08-23/`
(workspace-only, not served).
