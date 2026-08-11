# M7 Final Baseline Verification Report

**Date:** 2026-08-11
**Baseline commit:** b238b7a (M7 implementation + report)
**Spec:** Behavioral Evidence Model v3.0 §12.4

---

## 1. Commit Chain Verification — ✅ PASS

Full chain verified via `git rev-parse <commit>^`:

```
b238b7a (M7 report)
  → ac20b93 (M7 source)
    → dfbb766 (M6 verification)
      → 026cd2e (M6 report)
        → 9a1800d (M6 verification)
          → 11b513e (M6 source)
            → 14dec89 (M5 verification)
              → d8f67c4 (M5 report)
                → 74873bb (M5 source)
                  → 897e611 (M4 verification)
                    → 919e711 (M4 report)
                      → ef62970 (M4 source)
                        → 68f576e (M3 source)
                          → 20f5be8 (M2 source)
                            → 391e823 (M1 source)
                              → 3bc28f6 (clean baseline)
```

`git merge-base --is-ancestor 3bc28f6 HEAD` → **YES** (3bc28f6 is ancestor of HEAD).

Working tree: **CLEAN** (no uncommitted changes).

---

## 2. b238b7a Report-Only Scope — ✅ PASS

```
b238b7a diff (vs ac20b73):
  .drytis/notes/m7-implementation-report.md | 147 ++++++
  1 file changed, 147 insertions(+)
```

b238b7a contains **only** the M7 implementation report. Zero source code changes.

---

## 3. M7 Source Diff Scope — ✅ PASS

```
ac20b93 diff (vs dfbb766):
  src/sidepanel/evidence-renderer.ts        | 640 ++++++++  (NEW)
  src/sidepanel/interaction-renderer.ts     |  28 +-        (+28/-1)
  src/sidepanel/sidepanel.css               | 116 ++         (+116)
  src/sidepanel/sidepanel.ts                |  52 ++         (+52)
  tests/sidepanel/evidence-renderer.test.ts | 590 ++++++++  (NEW)
  5 files changed, 1425 insertions(+), 1 deletion(-)
```

All changes are side-panel display layer only. No recording, classification, generation, or persistence code modified.

---

## 4. No M8 Persistence / Dexie V4 Leakage — ✅ PASS

**Dexie schema version:** V3 (3 versions, same as 3bc28f6 baseline).
- V1: projects, elements, testCases, testCaseVersions, sourceArtifacts, executionIRs
- V2: + recordingSessions
- V3: + executionRuns

**No M8 tables:** No `interactionEventId`, `behavioralEvidenceId`, `behavioralEvidence` table, or Dexie V4 found anywhere in source.

**No M8 persistence code:** grep for `interactionEventId`, `behavioralEvidenceId`, `evidence_table`, `evidenceTable`, `V4` across all `src/**/*.ts` → only a comment about RepositoryTestCase V4 in architecture-types.ts (unrelated, pre-existing).

---

## 5. M1–M6 Test Regression — ✅ PASS

```
tsc --noEmit: 0 errors

vitest run:
  Test Files  102 passed (102)
  Tests       2204 passed (2204)
  Duration    38.26s
```

Evidence-renderer tests: 26/26 pass.
All prior milestone tests continue to pass.

---

## 6. ZIP Audit — ✅ PASS

### Current build vs saved M7 ZIP

Built fresh from HEAD (b238b7a):
- **40 files**, 142.8 KB total
- File list: **identical** to saved `download/cmdrunner-extension-m7.zip`
- Content hashes: **all 40 files match** (zero differences)

### Clean artifact check

| Check | Result |
|-------|--------|
| Nested ZIPs | None found |
| Source maps (.map) | None found |
| TypeScript source (.ts) | None found |
| Old Capability Model / Behavioral Observer system files | None in compiled bundles |

**Pre-existing tech debt (not M7-introduced):**
- `m1-realworld-test.html` and `m1-realworld-test-v2.html` contain references to old "behavioral observer" in inline test code. These are test HTML pages leaking into the ZIP via `public/` (tracked as TD-M4-001, Low severity). Not compiled bundles, not part of extension runtime.

### M7 symbols in side panel bundle

Side panel bundle (`assets/index.html-CvjyNFHd.js`) contains:
- `evidence-section--target` ✓
- `evidence-section--application` ✓
- `evidence-placeholder` ✓
- `Collecting behavioral evidence` ✓
- `INTERACTION_EVIDENCE_UPDATE` ✓

### Manifest references

All manifest-referenced entry points are present as compiled CRXJS bundles:
- Background: `service-worker-loader.js` + `assets/service-worker.ts-*.js` ✓
- Content script: `assets/recorder-entry.ts-loader-*.js` + `assets/recorder-entry.ts-*.js` ✓
- Side panel: `src/sidepanel/index.html` + `assets/index.html-*.js` ✓
- Repository: `src/repository/index.html` + `assets/repository-*.js` ✓

---

## 7. Summary

| Check | Verdict |
|-------|---------|
| Commit chain to 3bc28f6 | ✅ PASS — 15 links, all verified |
| b238b7a report-only | ✅ PASS — 1 file (+147 lines) |
| M7 source scope | ✅ PASS — side panel only, 5 files |
| No M8 leakage | ✅ PASS — Dexie V3, no evidence tables |
| M1–M6 regression | ✅ PASS — 2204/2204 tests, 0 tsc errors |
| ZIP clean | ✅ PASS — 40 files, no stale/nested/debug |
| ZIP matches build | ✅ PASS — all 40 file hashes identical |

**RESULT: M7 VERIFIED — READY FOR M8**

---

## M7 Extension ZIP

- **Download:** `download/cmdrunner-extension-m7.zip`
- **SHA256:** `5b89eb67e468d3b0d7a643500425f3faee48832bd2aeda2d24217b9ee91e238e`
- **Size:** 142.8 KB (40 files)
- **Commit:** b238b7a
