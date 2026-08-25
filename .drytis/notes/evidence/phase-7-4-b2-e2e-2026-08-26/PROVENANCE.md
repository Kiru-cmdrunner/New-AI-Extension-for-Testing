# 7.4-B2 Typeable Combobox — Build & E2E Provenance

## Build
- Date: 2026-08-26 (closure rebuild 2026-08-25 ~13:54 UTC)
- HEAD at build: pre-closure working tree on `capability-surgical-removal` (baseline d525911 + B2 changes)
- Command: `npm run build` (Vite multi-entry + ZIP pack)
- ZIP: `cmdrunner-extension.zip` v10.9.0 — 40 files, 295.5 KB
- **ZIP md5 (closure rebuild): `762de56e9ef7dfd75cc30c96e36c6b9f`**
  - earlier in-session run: `a22ed18285898cc282bf54e758996fd4` (pre-WARN-fix tree)
  - ZIP two-way identical root vs `download/`; dist/manifest four-way consistent with serve mirror
- dist/manifest.json md5: `c204e8d2e0b0ad135de6c392e36e98ce`
- serve/dist/manifest.json md5: `c204e8d2e0b0ad135de6c392e36e98ce` (byte-identical mirror)
- `diff -rq dist serve/dist` → empty (file-server mirror verified fresh)

## Real-Chrome E2E
- Harness: `harness-74b2.mjs` (this directory)
- Chrome: linux-148.0.7778.97 headless=new, extension loaded from `dist/`
- Fixture: `public/combobox-typeable-validation.html` served on 127.0.0.1:8242 (zero-dependency Node http server)
- Result: **18 PASS / 0 FAIL** (closure confirmation run 2026-08-25 ~13:56 UTC against the final rebuilt ZIP)
- Console errors in panel context: 0
- IR plan captured: `["fill","click","fill","fill","click","click","click","fill","click"]` — zero `select` steps (S2b verified in real Chrome)

## S2b dead-path resolution evidence
First run was executed against a stale dist (built 11:02, before the dropdown.ts
metadata change at 11:46): the readonly Flow-D Dropdown card carried
`selectedValue: "Active"` but NO `selectionConfirmed` key, and the IR plan
contained a `select` step. Rebuild + file-server restart → third run shows
`metadata.selectionConfirmed: true` and the IR plan switched to `click,click`.
This is the empirical proof that the pre-B2 SELECT-on-INPUT path was live in
production-shaped builds and that B2 fixed it.

## Regression suite state at evidence time
- vitest: 292 files / 4,764 tests PASS (baseline 286/4,715 → +6 files/+49 tests)
- tsc --noEmit: 8 errors, all pre-existing (unchanged set)
- House regression files: all green (6E-M2 28/0, 6F-M1 8/0, 7.4-M1 12/0, B1 expander 13/0)

## Reviewer WARNs addressed post-review
1. S2A-9b tautological pin → replaced with strict ZERO-TextEntry assertion (code behavior unchanged: dialog → DatePicker claims).
2. Integration Flow A now asserts the raw-layer Unclassified mousedown presence (spec §6 accepted-cost-3 pin).
3. This PROVENANCE.md (WARN #4).
4. `dropdown-whyline-dead-path.md` note marked RESOLVED with B2 reference (WARN #7).

Remaining WARNs are documentation-only and tracked for the closure commit:
- X2 spec house-regression counts stale (8/9/16 → actual 28/8/12) — spec §5 X2 will be corrected at closure.
- X3 `autocomplete-class` E2E fixture variant — unit pin S2A-8 covers the shape; E2E variant deferred (documented).
- S2B-4 executor invocation pin — the executor's click path is covered by tests/action-executor.test.ts; a B2-specific two-step→executor connection pin is deferred (documented).
- S2B-5 output-adapter audit recorded in test comment + here (closure note covers it).
