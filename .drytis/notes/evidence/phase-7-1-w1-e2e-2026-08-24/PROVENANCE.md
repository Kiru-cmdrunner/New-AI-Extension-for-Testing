# 7.1-W1 E2E provenance — real Chrome, SPA navigation → view layer

Date: 2026-08-24 (UTC) · Harness: `harness-71w1.mjs` (this dir) ·
Spec: `.drytis/specs/phase-7-1-w1-spa-nav-inject.md` §5 (E2E pin ⑩)

## Build under test

- Source: working tree at baseline `bb264c8` + 7.1-W1 changes (uncommitted
  at run time; commit hashes to be added at closure).
- Extension: `dist/` loaded unpacked; ZIP
  `cmdrunner-extension.zip` md5 `66d761d2b2d893bd521647d8717e8954`
  (300,082 B) — contains `assets/nav-inject.js` byte-identical to
  `public/assets/nav-inject.js`, manifest entry 4 `world: MAIN`,
  `all_frames: false`, `document_start`.
- Suite at this state: 272 files / 4,598 tests green; tsc = 8-error
  pre-existing baseline; reviewer PASS (12 ACs, 3 non-blocking nits);
  infra_verifier PASS.

## Harness design

Panel-first START (7.0 mis-stamp reproducer — also re-proves identity
recovery), then the app tab with the entity-bearing SPA fixture
(`public/kr-app-identity-validation.html`). Session flow per the FIXTURE'S
DOCUMENTED flow: click `#search-flights-button` (pushState →
`/search?q=flights+to+chennai`), click `#add-to-cart-button`
(data-auto-id Click anchor), then `history.back()` (popstate → home). Two
sessions on the same profile. V0 pre-flight checks the MAIN-world marker
(`data-cmdrunner-nav-ready`) is present in the app tab.

## Results (final run on the final build)

- **7.1-W1 pin ⑩: 8 PASS / 0 FAIL**
  - V0 MAIN-world marker present in app tab
  - V1 s1: `knowledgeViews = ["home","search-results"]` (≥2, incl.
    search-results) — FIRST view rows ever on real Chrome
  - V2 s1: `viewTransitions = ["search-results->home"]`
  - V3 s1: exactly ONE origin-only app row `http://127.0.0.1:8223`
    (7.0 regression intact)
  - V4 s2: sessionCount 2; view rows shared not duplicated (s1=2, s2=2);
    transition REINFORCED (`search-results->home(x2)`)
  - V5 s2: signatures `Click/search flights` occ:2 AND
    `Click/add to cart` occ:2
- **V6 observations (not ACs):**
  - `no-live-horizon` gaps: **s1=0, s2=0** (pre-7.1-W1 same fixture showed
    1–4 per session) — the audit's "likely-coupled" hypothesis CONFIRMED:
    with nav events in episodes the SPA render windows get owned.
  - IR plan s1 types: `["?","?","?","?"]` — 4 steps present (the harness's
    type field mapping is cosmetic; steps exist). No NAVIGATE step field
    mapping asserted — left as an honest observation.
- **7.0-KR harness regression (same build): 10 PASS / 0 FAIL**
  (one origin-only app row, sessionCount 2, occ 2, zero chrome-extension
  rows, IR generated).
- **6E-M2/M1 DatePicker regression (same build): 9 PASS / 0 FAIL**
  (zero twin Clicks, zero Unclassified cells, IR 5 steps, 6B/6D.1
  regressions, counter seeded; KR rows written).
  Note: this run required the archived AdaniOne clone fixture
  (`phase-6f-m1-e2e-2026-08-23/app-verbatim.mjs` on :8190) — it is NOT
  started by the harness itself. Server killed after the run.

## Honest notes

- First 7.1-W1 harness run (before the `history.back()` step was added)
  was 5/8 with views=["search-results"] only — the harness had simplified
  away the fixture's documented "→ back to /" flow, so no `home` view
  resolved and no transition row could exist (first view change honestly
  has before=null). Fixed by exercising the documented flow; not a code
  change.
- Two harness-only crashes during iteration (JSON.parse of a
  storage-shaped object; irPlan shape) — harness bugs, fixed, no product
  code involved.
- `knowledgeViews/knowledgeViewTransitions` in the 6E-M2 regression run
  are 0 because the AdaniOne clone fixture performs NO SPA URL changes
  (dialog-only flows) — consistent with pre-7.1-W1 behavior; not a
  regression signal.

## Dumps

- `dumps/kr-after-s1.json`, `dumps/kr-after-s2.json` (the view-layer proof)
- `dumps/storage-after-s1.json`, `dumps/summary.txt`
