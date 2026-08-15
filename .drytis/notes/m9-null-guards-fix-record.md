# M9 Null Guards — fix + verification record (uncommitted)

Date: Aug 15 (session continuing G4→G5→SW-fix work; all UNCOMMITTED at b4a58f3)

## Source changes (exactly two)

1. `src/understanding/signal-extractors/target-state-signals.ts:39`
   `if (!target.before || !target.after) return [];`
   → `if (!target || !target.before || !target.after) return [];`
   Root cause: G3 late-network re-collect supplements (evidence-collector.ts:1212)
   legitimately carry `targetEvidence: null` and can become an interaction's FINAL
   evidence (direct attach / richness-replacement / richest-pending in
   src/runtime/sw-integration.ts). Pre-fix, the deref threw inside the coordinator
   (no per-extractor isolation) and nulled the ENTIRE Stage-1 batch.

2. `src/understanding/pipeline/understanding-pipeline.ts` Stage 7 (was line 371/377)
   Guard `persistenceService && semanticKnowledge` → `persistenceService && semanticKnowledge && finalState`;
   dropped `applicationState: finalState!` → `applicationState: finalState`.
   Root cause: Stage-1 failure leaves finalState null; Stage 7 passed it (non-null
   asserted) into KnowledgePersistenceService.persist → persistViews →
   `state.currentView` (knowledge-persistence-service.ts:133) threw AFTER the
   application-row upsert — partial Dexie write (steps 2–10 skipped).

## Regression tests

`tests/understanding/m9-null-guards.test.ts` — 6 tests (R1–R5, R3 split a/b).
TDD proof (git stash of the two source files): pre-fix failures = exactly R1, R2, R4
(the 3 bug-catchers); R3a/R3b/R5 (behavior preservation) passed pre-fix.
Uses `new UnderstandingPipeline({ db })` directly — the `createDefaultUnderstandingPipeline`
factory does not accept `db`.

## Verification (all green)

- tsc --noEmit: 0 errors
- Full suite: 153 files / 3,145 tests (was 152 / 3,139 — +6 new)
- G4/G5 regression files: multi-tab-capture-attribution + native-form-submit-ownership
  = 41 tests green
- Build: node scripts/build.mjs exit 0; SW inlined bundle 507,436 bytes;
  ZIP-internal SW: fix1-present=true, fix2-present=true, dynamic-imports=0,
  preload-helper=0
- ZIP v10.9.0: 26 files, 218.6 KB; md5 2cc4c19df4d19699ca62a7bbaf19d8bd at both
  cmdrunner-extension.zip and download/cmdrunner-extension.zip; download URL serves
  byte-identical ZIP (HTTP 200, md5 match)
- Real-Chrome runtime harness (Playwright Chromium 151.0.7922.34, /tmp/pe14, CDP 9343):
  system Chrome 151.0.7922.108 silently ignores --load-extension in headless=new;
  Playwright chromium honors it. SW console 0 lines (was: 5 stage errors → then 5
  window errors). understanding_result WRITTEN: appId, semanticKnowledge, outcomes,
  transitions, sessionId, schemaVersion, generatedAt; knowledgeWarnings null; no
  'signal-extraction:' / 'recorded-workflow-persistence:' warnings.
  Domain 'unknown'/confidence 0 expected — harness flow is example.com click only
  (no e-commerce signals), matches prior baseline shape.

## Tree state (NOT committed)

Modified: package.json, vite.config.ts (SW build fixes, prior task),
target-state-signals.ts, understanding-pipeline.ts (this task)
Untracked: scripts/build.mjs, scripts/sw-inline-finalize.mjs,
tests/understanding/m9-null-guards.test.ts, .drytis/specs/m9-null-guards.md,
.drytis/notes/* (7), .drytis/sw-cdp-verify.mjs, sw-runtime-verify.mjs, harness-out.txt

## Open decisions for user

- Commit/push of: SW build fix + M9 null guards (+ harness scripts, notes, spec).
- ASIN.1/quantity.1 ENTITY_HINT_PATTERNS anchored-regex miss (2-line extraction fix).
- Drain-guard A first-delivered-status freeze (status null frozen for early-captured
  requestIds).
