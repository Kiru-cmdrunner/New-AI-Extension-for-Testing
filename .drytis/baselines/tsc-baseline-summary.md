# tsc Baseline Summary — Commit c4e4ade

**Captured:** 2026-08-07T11:30:58Z
**Total errors:** 626

## Error Count by Code

```
    150 TS6133
    136 TS2740
     77 TS2353
     64 TS2339
     53 TS2322
     26 TS6196
     22 TS2345
     19 TS2459
     13 TS2741
      8 TS2532
      8 TS2367
      7 TS2307
      6 TS2352
      4 TS2739
      4 TS2540
      3 TS2820
      3 TS18047
      3 TS1354
      2 TS7022
      2 TS7016
      2 TS4104
      2 TS2678
      2 TS2304
      2 TS18046
      2 TS1117
      1 TS7053
      1 TS7006
      1 TS6192
      1 TS2695
      1 TS2561
      1 TS2551
```

## Error Count by Top-Level Directory

```
    158 tests
    106 tests/capabilities
     89 tests/evidence-engine
     66 tests/runtime
     20 src/classifier/evidence/providers
     16 tests/definitions
     15 src/recorder
     13 src/recorder/recognition
     12 src/background
     11 tests/repository-v2
      9 src/runtime
      9 src/execution
      8 tests/semantics
      8 tests/adapters/playwright
      7 tests/sidepanel
      7 src/sidepanel
      6 tests/domain/execution-ir
      6 src/tap
      5 tests/validation
      5 tests/domain
      5 src/repository
      5 src/definitions
      4 tests/recognition
      4 src/recorder/pipeline
      3 src/repository/services
      3 src/recorder/phase5
      3 src/domain/entities
      3 src/classifier
      3 src/capabilities
      2 tests/presentation
      2 src/semantics
      2 src/repository/v2/dexie
      2 src/recorder/enrichment
      2 src/presentation
      2 src/enrichment
      1 tests/tap
      1 tests/repository-ui
      1 tests/helpers
      1 src/storage
      1 src/repository/v2/interfaces
```

## Dead vs Live Breakdown

**Dead source dirs (to be removed in Phase 1.1):**
- `src/classifier/`
- `src/recorder/recognition/`
- `src/recorder/enrichment/`
- `src/recorder/pipeline/`

**Dead test dirs (to be removed in Phase 1.1):**
- `tests/evidence-engine/`
- `tests/recognition/`
- `tests/recorder/`

**Errors in dead code:**
```
42
```
**Errors in dead tests:**
```
93
```

**Errors in live source:**
```
90
```

**Errors in live tests:**
```
401
```

## Test Baseline
```
 Test Files  175 passed (175)
      Tests  4072 passed (4072)
```

## Build Baseline
```
dist/assets/recorder-entry.ts-CVjKpTCy.js             22.38 kB │ gzip:  6.98 kB
dist/assets/index.html-Dn0N6-Sw.js                    39.28 kB │ gzip: 10.43 kB
dist/assets/service-worker.ts-DmtSl4bX.js             80.23 kB │ gzip: 22.59 kB
dist/assets/dexie-unit-of-work-factory-dpEFNe5u.js   111.84 kB │ gzip: 36.18 kB
✓ built in 2.01s
Packed extension v10.9.0 (47 files, 296075.1 KB)
  -> cmdrunner-extension.zip
  -> download/cmdrunner-extension.zip
```
