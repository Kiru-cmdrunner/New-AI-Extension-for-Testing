# deff878 ZIP Size Optimization Investigation

**Date:** 2026-08-10
**Commit:** deff878 (pre-DF baseline)
**ZIP:** cmdrunner-extension-deff878-pre-df-baseline.zip (659.5 KB / 675,347 bytes)

## Key Finding

**81% of the ZIP (534 KB) is waste** — stale inner ZIPs and test HTML files that Chrome never loads. The actual runtime extension is only ~125 KB of legitimate, already-minified, already-tree-shaken code.

## Size Breakdown

| Category | Files | Compressed | % of ZIP |
|----------|-------|-----------|----------|
| Stale inner ZIPs (download/) | 4 | 519.0 KB | 79.3% |
| Test/debug HTML | 3 | 15.0 KB | 2.3% |
| **Runtime extension code** | **32** | **120.3 KB** | **18.4%** |
| **TOTAL** | **39** | **654.3 KB** | 100% |

## Root Cause of Bloat

`public/download/` contains 4 untracked ZIP files (in .gitignore) from the `capability-v1-complete` branch. When `git checkout deff878` was done, these survived because they're untracked. Vite copies `public/*` to `dist/` during build, so they ended up in the extension ZIP.

## Runtime Code Breakdown (120.3 KB)

- 36.1 KB (30%): Dexie library + Repository V2
- 21.5 KB (18%): Service Worker (all runtime logic)
- 10.0 KB (8%): Side Panel JS
- 6.8 KB (6%): Content Script
- 5.4 KB (5%): Playwright generator
- 4.8 KB (4%): Repository page JS
- 4.7 KB (4%): Settings CSS
- 4.5 KB (4%): Settings JS (AI provider config)
- 20.3 KB (17%): Remaining 21 files

## Build Status

- ✅ Minification: ENABLED (esbuild production)
- ✅ Tree-shaking: ENABLED (Rollup)
- ✅ Code splitting: GOOD (21 JS bundles, 14 shared chunks)
- ✅ No source maps generated
- ✅ CSS minified
- ✅ No dead dependencies (fake-indexeddb, puppeteer-core excluded)
- ✅ Zero cross-bundle code duplication (verified via 100-char block comparison)

## Safe Optimizations

1. 🟢 Remove 4 stale inner ZIPs: -519.0 KB
2. 🟢 Remove 3 test HTML files: -15.0 KB
3. 🟢 Add .gitignore for public/download/: prevention only

**Projected result: 659.5 KB → ~125 KB (81% reduction)**

## Not Recommended

- 🔴 Replace Dexie with raw IndexedDB (-25 KB, HIGH RISK architectural change)
- 🔴 Remove AI provider code (-4.5 KB, removes feature)
- 🟡 Remove Verification Mode (-2 KB, removes safety mechanism)
- 🟡 Raise to ES2022 target (-1-3 KB, may break older Chrome)
