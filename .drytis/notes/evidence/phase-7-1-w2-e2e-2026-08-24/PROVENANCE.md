# 7.1-W2 E2E provenance — real Chrome, full-reload navigation → view layer

Date: 2026-08-24 (UTC) · Harness: `harness-71w2.mjs` (this dir) ·
Spec: `.drytis/specs/phase-7-1-w2-full-reload-views.md` §5 (E2E pin ⑪)

## Build under test

- Source: working tree at baseline `9ad9359` + 7.1-W2 changes (spec, test
  file, public/ fixtures — ZERO `src/` changes; `git diff HEAD` empty for
  tracked files). Uncommitted at run time.
- Extension: `dist/` loaded unpacked (fresh `npm run build`);
  ZIP `cmdrunner-extension.zip` md5 `c30ca19f210a263fa188fbb025c885f1`
  (300,082 B). md5 drift vs the 7.1-W1 closure ZIP (`a7a29aee…`, same byte
  size) is zip mtime metadata from the rebuild — the extension bundle is
  built from identical, unchanged `src/`.
- Suite at this state: 273 files / 4,600 tests green; tsc = 8-error
  pre-existing baseline; reviewer PASS (AC-1..5, AC-9; 2 advisory WARNs);
  infra_verifier PASS (1 advisory WARN: `serve/` not gitignored).

## Harness design

Fixture server serves the REAL `public/` files from disk (same bytes the
preview serves) on a fresh localhost port. Fresh Chrome + fresh profile +
fresh CDP port; PANEL-FIRST START (keeps the 7.0 mis-stamp recovery in the
flow), then the app tab on the entry form. Every navigation is a REAL
document replacement via form GET submit — content script destroyed at
each commit, `webNavigation.onCommitted` transitionType `form_submit` —
exactly the full-reload path under test. CDP sessions re-attach after each
reload. Two sessions on the same profile.

Session flow: submit `#search-form-submit` (→ `/search-results.html?q=…`),
submit `#add-to-cart-button` (→ `/cart.html?ASIN=…`), follow
`a[data-auto-id="back-to-results"]` (→ `/search-results.html`), STOP.

## Results (final run on the final build)

- **7.1-W2 pin ⑪: 9 PASS / 0 FAIL**
  - W5 pre-flight: `data-cmdrunner-nav-ready` present (7.1-W1 regression)
  - W1 s1: `knowledgeViews = ["cart","search-results"]` — sourced from the
    FULL-RELOAD path (first full-reload view rows ever on real Chrome;
    7.1-W1 proved only the SPA half)
  - W2 s1: transitions `search-results->cart` present
  - W2b s1: 2 transitions total (`cart->search-results` back-nav too)
  - W3 s1: exactly ONE origin-only app row `http://127.0.0.1:8231`
    (7.0-KR identity regression intact)
  - W4 s1: IR plan actions
    `["navigate","click","navigate","click","navigate","click","navigate"]`
    — 4 NAVIGATE steps + 3 clicks: the full-reload synthetic path produced
    Navigation interactions through to the generated plan. (Also: exactly
    one click per physical click — no twin cards.)
  - W6 s2: sessionCount 2, one app row, view rows SHARED (2→2, not
    duplicated), both transitions REINFORCED ×2
  - W7 obs: 0 `chrome-extension://` app rows (identity honesty under
    full reloads)

## Honest notes

- Run 1 was 8 PASS / 1 FAIL: W4 asserted on `s.type`, but `IRStep` carries
  `action` (enum value `'navigate'`) — the same cosmetic harness
  type-mapping artifact documented in the 7.1-W1 provenance. Harness-only
  fix (read `s.action`); zero product code involved; run 2 fully green.
- The 6E-M2/M1 DatePicker regression was NOT re-run: the spec's AC-7 names
  the 7.0-KR and 7.1-W1 regressions only (both PASS here), and this
  milestone ships ZERO `src/` changes — the DatePicker surface is
  byte-identical to the state that regression last proved (7.1-W1 closure).
- `knowledgeViews` first-view honesty: the first full-reload's view change
  has `fromView=null` (no prior view) — consistent with the jsdom pins.

## Dumps

- `dumps/kr-after-s1.json`, `dumps/kr-after-s2.json` (view-layer proof)
- `dumps/summary.txt`
