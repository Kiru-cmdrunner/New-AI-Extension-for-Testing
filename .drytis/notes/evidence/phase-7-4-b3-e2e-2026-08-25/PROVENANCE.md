# 7.4-B3 Build & Closure Provenance

## Build (closure artifact)
- Date: 2026-08-25 ~21:24 UTC (closure build; final3 at 20:36 was the
  reviewer-verified semantic twin)
- Tree: working tree on `capability-surgical-removal` (baseline HEAD
  `6f94df4` + B3 changes + two reviewer-critical fixes)
- Command: `npm run build` (Vite multi-entry + pack-zip)
- **Closure ZIP md5: `b702ac441996d015ca0efa404c0dafb8`**
- sha256: `d2eb9c0d4cc4c56cd24bebb8b3120c0984b462731e1e13b5d5c4472d47e78e90`
- 40 files, 304,841 bytes, manifest 10.9.0
- Four-way identity verified: root = `download/` = serve mirror = live
  preview URL `/download/cmdrunner-extension.zip` (all `b702ac44…`)
- `download/README.md` provenance block pins exactly this build.
- **Packer non-determinism (documented):** zip entries embed build mtimes,
  so raw md5 differs across rebuilds of identical content. Entry content is
  deterministic (entry-hash-equal verified across consecutive builds).
  Discipline: build once per closure, pin that md5, serve that artifact.

## Reviewer-critical fixes in this build
1. **Critical #1 (twin-recovery break):** S3 synthetic eventId was
   `evt-{pageId}-syn-{lastInputEventId}` — broke `extractPageId`'s greedy
   regex, so the synthetic entry sorted outside its page and the S2 fold's
   twin scan hit it first, resurrecting the Repeat-Me press-half as an
   Unclassified half-card. Fix: canonical `evt-{pageId}-{counter}` shape,
   counter seeded 1e9 (never collides with raw counters), reset in
   resetState. Unit pins: dedup-fold S2-7, typed-text S3-1 (id shape).
   Latent second defect surfaced during fix verification: the sample's
   captureSeq was the BLUR's seq, which can fire between another element's
   mousedown→click (focus moves on mousedown), wedging the sample between
   gesture halves and splitting the BODY card into two. Fix: position the
   sample at the episode's LAST INPUT (`lastInputCaptureSeq`).
2. **Critical #2 (evidence integrity):** the earlier "definitive" run's
   dumps were captured pre-fix and mislabeled; corrected by re-running with
   dumps preserved (`b3-full-final3/`), renaming the stale dir with a
   PREFIX marker, and rewriting CENSUS-REPORT with an explicit correction
   note.
3. **C3 RCA (stale-lifecycleBindings leak):** folded lifecycles never emit
   → their EvidenceCollector binding was never released → later windows
   held open past the S1 drain → dismissal evidence stranded. Fix:
   FINALIZE_EVIDENCE for the suppressed lifecycle at fold time
   (`sendFinalizeForSuppressedLifecycle`, unit pin S2-4b).

## Real-Chrome E2E
- Harness: `harness-74b3.mjs` (this directory), real Chrome + CDP, extension
  loaded from `dist/`, fixture `public/census-validation.html` on
  127.0.0.1:8244.
- final3 run (ZIP `55948f9f…`): **14 PASS / 0 FAIL** — detailed semantic
  evidence.
- Closure run (ZIP `b702ac44…`, `b3-full-closure/`): **14 PASS / 0 FAIL** —
  identical composition (16 cards, census dedup-resurrected 0,
  unclassifiedTotal 14 = 10 gate-rejected / 1 body-structural / 3
  evidence-consequential; IR `[fill,click,fill,fill,click]`, zero select;
  M5 diffs=[]; zero panel console errors).

## Regression suite state at closure
- vitest: **300 files / 4,800 tests PASS** (baseline 292/4,764 at B2)
- tsc --noEmit: exactly 8 pre-existing errors (unchanged set)
- House regressions: 6E-M2 28/0, 6F-M1 8/0, 7.4-M1 12/0,
  vocabulary-freeze-7-4-b3 4/0

## Infrastructure at closure
- Download-server containment fix: raw port 8080 previously listed the
  entire /workspace (incl. .git/, .drytis/, src/) — jailed to
  serve-download-root/download (ZIP + README only); preview /download/*
  1:1; verified by infra_verifier re-run (PASS, 0 failures).
- infra_verifier: PASS all sections (env keys empty backend+container,
  no hardcoded secrets, production static servers, preview 200, Caddy
  routing intact, setup script deploy-ready).

## D1/D2 decision record
`.drytis/notes/phase-7-4-b3-d1-d2-decision-record.md` — census-fed
recommendations, owner-gated: D1 = do NOT relabel (keep flag
presentation-only); D2 = resolve toward DROP (align output-adapter to not
emit Unclassified CLICKs).
