# Technical Debt: Test HTML Pages Leaking Into Extension ZIP

**ID:** TD-M4-001  
**Severity:** Low (cosmetic/dead weight, no functional impact)  
**Date:** 2026-08-11  
**Introduced:** M1 (391e823) — `m1-realworld-test.html` and `stress-test.html`; M4 (919e711) — `m4-validation.html`

## Problem

`scripts/pack-zip.mjs` excludes `.ts` files and 4 named HTML files (`coverage-test.html`, `demo.html`, `test-harness.html`, `validation.html`), but does NOT exclude 4 test pages that live in `public/` and are copied to `dist/` by Vite:

| File | Size | Added In |
|---|---|---|
| `m1-realworld-test.html` | 30 KB | M1 (391e823) |
| `m1-realworld-test-v2.html` | 27 KB | M1 (391e823) |
| `m4-validation.html` | 13 KB | M4 (919e711) |
| `stress-test.html` | 3 KB | M1 (391e823) |

These 4 files (~73 KB total) appear in every `cmdrunner-extension.zip`. Chrome ignores them — they have no functional impact on the extension — but they are dead weight in the bundle.

## Fix (not applied yet)

Add these filenames to the `EXCLUDE_FILES` set in `scripts/pack-zip.mjs`, or change the exclusion to exclude ALL test HTML from `public/` by convention (e.g., any `m*-*.html` or `stress-*.html` pattern).

## Status

Recorded as tech debt. Do not fix until directed.
