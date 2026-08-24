# 6F-M3 Wave 1 — Provenance

**Committed:** 2026-08-24 (owner-approved two-commit closure; unpushed).
**Baseline:** `1c054bb` (branch `capability-surgical-removal`).
**Build:** vite production build from the commit-1 tree — v10.9.0, 38 files.
**ZIP:** `cmdrunner-extension.zip` (and `download/` copy) md5
`e31d48e88cff540442614ffd66a1a309`, 297,175 bytes, packed 2026-08-24 01:06
UTC from dist built 01:06 — byte-identical across root / download / live
preview URL (`/download/cmdrunner-extension.zip` → 200, md5-verified).

## Contents
- `harness-m3w1.mjs` — real-Chrome CDP E2E harness (house pattern: fresh
  port/profile per run, panel-context START/STOP, trusted CDP input,
  storage + panel-DOM probes). Final matrix: M5 regressions (DatePicker
  round-trip, 6B data-auto-id, 6F-M1 twin-click), M2-O2 no-op churn
  fixture, M4-O14 untitled navigation with query URL (card label display
  form + IR raw-URL retention), M1-O13 stopped-view placeholder sweep,
  M3-O12 no-notice non-regression.
- `app-base.mjs` — verbatim copy of the proven 6E-M2/6F-M1 fixture
  (`phase-6f-m1-e2e-2026-08-23/app-verbatim.mjs`) used as the derivation
  base (provenance record; not executed directly).
- `app-m3.mjs` — M3 fixture on 127.0.0.1:8191: base clone + `#noop-churn`
  button (attribute-only churn, old==new) + `#nav-away` link to
  `/flights?origin=MAA&dest=DEL&utm_source=test` served with NO `<title>`
  (deliberately empty → Chrome URL-synthesized pseudo-title).
- `dumps/m3-storage.json`, `m3-cards.json` — final run storage/cards.
- `dumps/m3-panel-stopped.txt` — stopped-view panel text (terminal-note
  sweep, `DOM CHANGES (1 · 1 NO-OP HIDDEN)`, nav label display form).
- `dumps/m3-nav-card.txt` — nav card scoped text (label-line pin).
- `harness-m1-regression.mjs` — the committed 6F-M1 harness with ONLY the
  dump-output path repointed to this directory (fixture + logic verbatim).
- `m1-regression-run.log` + `m1-regression-dumps/` — 9 PASS / 0 FAIL run
  on the final build.
- `run-1..9.log` — full run history.

## Run history (all real Chrome 148, headless, --no-sandbox)
- run-1/2: harness bring-up failures (fixture subshell died with the
  harness shell; `setsid` detach fixed). No product signal.
- run-3: fixture not yet listening (same cause). No product signal.
- run-4: **first full run — M4-O14 FAIL, real finding**: Chrome synthesizes
  the tab title from the URL for untitled pages (`chrome.tabs.get` at
  onCommitted returns the full query URL as pageTitle) → title-first
  branch rendered the raw query URL. Fixed via `isUrlDerivedTitle`
  (exact match) + unit pins; rebuilt.
- run-5: M4-O14 still FAIL — second real finding: Chrome's synthesized
  title omits the SCHEME (`127.0.0.1:8191/flights?...`), so exact
  equality missed. `isUrlDerivedTitle` extended to scheme-stripped match;
  pins added; rebuilt.
- run-6 (dump mtime evidence): post-fix build; nav label confirmed
  display-form but harness assertion scanned the whole panel body,
  matching the IR/Playwright section's legitimate full raw URL (AC6).
- run-7: same harness-assertion overreach (card text includes the
  evidence section's truncated raw URL — allowed by design).
- run-8: assertion scoped to the IR split (M4-O14b added: IR KEEPS the
  raw URL) but card-body scan still over-broad.
- run-9 (FINAL): assertion scoped to the card LABEL line —
  **11 PASS / 0 FAIL**, 0 panel JS errors.

## M1 regression
`m1-regression-run.log`: 9 PASS / 0 FAIL (Depart-on/Return-on DatePicker
values, zero Unclassified cells, zero twin Clicks, 6B search-flights,
6D.1 W3 Bengaluru, W2 counter, IR 5 steps, KR Dexie rows).

## Suite / gates
Suite 267 files / 4,562 green; tsc exactly the 8-error pre-existing
baseline; reviewer PASS (21/21 ACs, WARNs closed); infra_verifier PASS
(0 failures, 0 new warnings); ZIP + serve mirror live-verified.
