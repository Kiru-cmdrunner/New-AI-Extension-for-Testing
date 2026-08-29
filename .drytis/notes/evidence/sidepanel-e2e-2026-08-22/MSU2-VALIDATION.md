# MS-U2 — Evidence Drill-Downs · Validation Record

Status: VALIDATED, awaiting owner commit gate
Base: capability-surgical-removal @ f3452d5 (+ uncommitted MS-U2 WIP) · 2026-08-22

## Files (all renderer-only)

- M  src/sidepanel/evidence-renderer.ts (+198)
- M  src/sidepanel/styles.css (+66)
- M  tests/sidepanel/evidence-renderer.test.ts (+5/−1 — AC-R8 raw-JSON exemption)
- A  src/sidepanel/evidence-drilldown.ts (pure helpers: truncateJson, stabilityBars, networkSourceLabel)
- A  tests/sidepanel/evidence-drilldown.test.ts (24 tests, pins P1–P10)

## Verification chain

1. **Suite**: 238 files / 4,239 tests green (~83s); sidepanel dir 12 files / 173 tests.
   tsc: 8 pre-existing errors (verified identical count at bare f3452d5 via stash; zero in WIP files).
2. **Reviewer (round 1, full)**: A1–A9 PASS. A1 verified EMPIRICALLY byte-identical
   collapsed output vs HEAD renderer (outerHTML equality on rich fixture). Security PASS
   (raw-JSON <pre> via textContent; zero new innerHTML). §0 constraints all PASS.
   Pin non-vacuity verified (DOM-ancestry scoping defeats jsdom open-details quirk).
   Corrected the leader's tsc distribution: 8 errors across 4 files, 1 in a pre-existing
   sidepanel test — all pre-existing, none in WIP.
3. **Infra verifier**: MS-U2 introduced zero new findings. One carried FAIL
   (preview URL @ tests/integration/form-submit-e2e.test.ts:64, documented defect,
   byte-identical to baseline). dist-staleness WARN raised → resolved by clean rebuild
   (see §4); the "missing truncation note" sub-claim was a false positive — the note is
   assembled via `${RAW_JSON_MAX_CHARS.toLocaleString()}` so it never appears as a
   bundle literal; hash BV9ll-Xy unchanged across 09:22→09:57 builds proves the
   09:22 bundle was content-identical.
4. **dist rebuild**: rm -rf dist → npm run build → 33 files, v10.9.0, clean.
5. **Real-Chrome E2E**:
   - Original multipattern run (archived earlier): D2/D4/D7 expanded+verified live;
     D6 live on classic card (winDrills=1, bars=3); D3/D5 unexercised (harness apps
     produce no captured POSTs / no dialog-class surfaces) → supplement created.
   - **A10 supplement** (.drytis/notes/evidence/sidepanel-e2e-2026-08-22/
     msu2-a10-supplement.mjs + msu2-a10-supplement-run.log + /tmp dialogapp):
     new generic dialog-pattern app (:8188) — escalate click → role=dialog overlay
     (5 descendants) → confirm click → POST /escalate with formData (tid/sev/note).
     Results: **8 PASS / 1 FAIL**.
     - D5 live: "surface detail — 5 descendants · role: dialog · name: Confirm
       escalation · batch 1 · at 121ms · emergence: inserted"
     - D3 live: "network detail — source: webRequest · type: unknown · request: 31 ·
       joined to causal event evt-… · note: … · sev: high · tid: T-101" (requestBody
       pairs rendered)
     - D7 storage-side: raw JSON contains networkActivity incl. the POST
     - All 13–14 drill-downs collapsed by default; zero panel console errors.
   - The single FAIL: D6 on dialog cards — root-caused (see NEW ENGINE FINDING).
6. **Window probe** (msu2-window-probe.mjs): stored evidence for both dialog cards
   shows endReason "consequence-settled" with stabilityTrace length 0 — the renderer
   is honestly absent because storage has no samples.

## NEW ENGINE FINDING (pre-existing, OUT OF MS-U2 SCOPE — for Phase 6 backlog)

**stabilityTrace is discarded by the settle-mode delivery path.**
Every `consequence-settled` window rebuilds the window object with
`stabilityTrace: []` (src/tap/evidence-collector.ts:1841, settle-mode branch since
commit 6132571 "Lifecycle-Driven Evidence Finalization v3"), discarding the samples
AdaptiveWindow actually accumulated (adaptive-window.ts:356-368 — arm() + recordMutation()
+ close() all push). Consequences:
- Side panel D6 window-internals drill-down never renders for consequence-settled
  cards (samples=0 → honest absence) — the ONLY cards left without a D6 view.
- Knowledge/episode consumers that could read stabilityTrace get nothing for the
  most evidence-rich window class in the engine.
Fix belongs engine-side (copy `evidenceWindow.stabilityTrace` at :1841 — the
EvidenceWindow handed to closeWindow already carries the real trace at
adaptive-window.ts:191); blocked from MS-U2 by the renderer-only constraint. Recommend
scheduling as a small Phase 6 engine fix with a pin asserting samples>0 for a
consequence-settled window in the unit layer.

## tsc correction on record

8 pre-existing errors, distribution: 5× ir-executor-navigate.test.ts, 1×
ir-bridge-repeated-clicks.test.ts, 1× resulting-state-seeded-display.test.ts:61,
1× changed-element-seed-honesty.test.ts. None in MS-U2 files. (Reviewer verified
identical at bare HEAD via throwaway worktree.)
