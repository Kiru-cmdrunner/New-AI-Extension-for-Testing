# 7.0-KR E2E provenance — real Chrome, two-session reinforcement

Date: 2026-08-24 (UTC) · Harness: `harness-7kr.mjs` (this dir) ·
Spec: `.drytis/specs/phase-7-0-kr-app-identity.md` §7

## Build under test

- Source tree: post-implementation working tree (pre-commit) at
  baseline `15974fa` + 7.0-KR changes.
- Extension ZIP: `cmdrunner-extension.zip` md5 `74d31466c8ba24b69a0cd0f63959c263`
  (root and `download/` byte-identical), v10.9.0, loaded unpacked from
  `dist/` in a fresh profile via CDP.
- Suite at this state: 269 files / 4,584 tests green; `tsc --noEmit` = exactly
  the 8 pre-existing baseline errors; reviewer PASS; infra_verifier PASS.

## Harness design (the mis-stamp reproducer)

Panel-first START — the side panel is the active surface when START fires,
which is exactly the historical mis-stamp condition (`recordingStartUrl` =
panel URL → `chrome-extension://…/src/sidepanel/index.html` app row, proven
in phase-6e-m2 and phase-6f-m2b Dexie dumps). The recovery path (last
main-frame `webNavigation.onCommitted` URL for a recording-scope tab) must
supply the app origin. Fixture: `public/kr-app-identity-validation.html`
(entity-bearing: `[data-auto-id][data-sku]` items + counter + `/search?q=`
entity landing). Two sessions on path-differing URLs of the same origin.

## Results — run on the final build

- 7.0-KR E2E: **10 PASS / 0 FAIL**
  - K2 s1: entities seeded (search-query via `/search?q=`) —
    `["product:FL-6E-231"]`
  - K3 s2: exactly ONE app row, origin-only (`http://127.0.0.1:8213`),
    `sessionCount === 2` — reinforcement on real Chrome
  - K4 s2: at least one signature reinforced — occurrenceCount 2 for
    `Click/add to cart` AND `Click/search flights`
  - K5 s2: entities shared, not duplicated (s1=1, s2=1, same row)
  - K6: ZERO chrome-extension app rows ever (apps list = only the localhost
    origin row)
- 6E-M2 / 6F-M1 regression on the same build: **9 PASS / 0 FAIL**
  ( DatePicker claimed cards, zero twin Clicks, IR plan 5 steps, zero
  Unclassified leak, data-auto-id + options-list regressions intact).

## Dumps

- `dumps/kr-after-s1.json` — KR tables after session 1
- `dumps/kr-after-s2.json` — KR tables after session 2 (the reinforcement proof)
- `dumps/storage-after-s1.json` — storage state after session 1

## Honest notes

- First harness run (before the serve-mirror restart, on a stale build) showed
  an E9 transient (0 KR rows). The canonical rerun on the final build is the
  one recorded above — 9/9 regression, 10/10 7.0-KR. Dumps regenerated from
  the final build.
- `viewTransitions=0 / views=0` on the single-page fixture — observation only,
  per spec §11 (fixture performs one navigation; not an AC).
- A parallel 6E-M2 regression rerun rewrote the three tracked
  `m1-regression-dumps/*.json` files; those refreshes are honest run artifacts
  and are included in the closure commits.
- Existing panel-origin app rows from Aug-22/23 profiles remain in those
  profiles' Dexie stores (inert, untouched — read-only-KR doctrine).
