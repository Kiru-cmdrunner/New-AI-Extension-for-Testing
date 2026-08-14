# M9.12 — Production Wiring

## Goal

Wire the complete deterministic M9 Application Understanding pipeline into the
real recording flow, replacing the stub `UnderstandingResult` with real output.

```
Recorded Behavioral Evidence (M1–M8 ComponentInteractions)
  → M9.1 Signal Extraction
  → M9.2 State Building
  → M9.3 Outcome Determination
  → M9.5 Knowledge Persistence
  → M9.6 Knowledge Consolidation (load + merge)
  → M9.7 Semantic Enrichment
  → M9.8–M9.11 domain config applied at construction time
  → UnderstandingResult (real, complete)
```

## Design Decisions

### D1 — Pipeline runs at stopRecording, batch (not streaming)
Signals/state/outcomes are computed over the full session's interactions in one
batch at `handleStopRecording()`. M9.1–M9.3 were designed for this shape
(`SignalExtractionCoordinator.extract(interactions[])`). No per-interaction
streaming — that would change M9.2's accumulator contract.

### D2 — The orchestrator is a new module, not a service-worker function
New file `src/understanding/pipeline/understanding-pipeline.ts` exporting
`runUnderstandingPipeline()` and `preloadPriorKnowledge()`. The service worker
imports and calls these. All orchestration logic lives in the understanding
module (testable without a service worker harness).

### D3 — Domain pack selection: install ALL packs, classify, then prefer
At pipeline construction time:
1. Install HR_PACK + DEVTOOLS_PACK into a `DomainPackRegistry` (e-commerce
   stays on built-in defaults — installing ECOMMERCE_PACK would duplicate the
   hard-coded defaults it was extracted from).
2. Build extractors/state-builder/outcome-determiner with the registry's
   sub-registries (they check domain data BEFORE built-in defaults).
3. After M9.6 loads prior knowledge, `classifyDomain()` picks the domain.
All packs coexist: sub-registries merge their data (M9.11 multi-pack
coexistence is designed for exactly this). Domain classification REPORTS which
domain won; it does not switch algorithms, because the M9.11 boundary is
data-driven, not code-driven.

### D4 — Failure isolation: pipeline wrapped in its own try/catch in the SW
If ANY M9 stage throws, `handleStopRecording` continues to the Generation
Layer and Repository V2 persistence with a minimal UnderstandingResult
(sessionId/generatedAt/schemaVersion only — same shape as today's stub).
Recording, code generation, and M1–M8 persistence are never blocked by M9.

Inside the pipeline, M9.5 persistence and M9.6 consolidation each get their
own try/catch: a persistence failure must not stop enrichment, and vice versa.
The pipeline returns a `PipelineOutcome` with a `warnings` array.

### D5 — UnderstandingResult gains optional additive fields
`src/domain/entities/understanding-result.ts` gains:

```ts
semanticKnowledge?: SemanticKnowledge;   // M9.7 output
applicationKnowledge?: ApplicationKnowledge; // M9.6 consolidated read model
knowledgeLoaderWarnings?: string[];
```

All optional — persistSession's existing call shape stays valid. Domain layer
imports types from the understanding module (type-only import, no runtime
coupling).

### D6 — Preload at startRecording
`handleStartRecording` calls `preloadPriorKnowledge(origin)` (own try/catch).
The seed is held in a module-level variable in the SW and passed to the
pipeline at stop. Preloading warms the cross-session entity map so the second
recording on the same app recognizes entities from session one. It does NOT
block recording start if IndexedDB is unavailable.

### D7 — Session/app identification
- `appId = deriveAppId(origin)` (M9.5 hash of origin)
- `origin` = recording start URL's origin
- `sessionId` = the Repository V2 session ID (persisted first, then used) or
  `session-<ts>` fallback when Repository V2 persistence is skipped/failed.

### D8 — Retrieval: one coherent model
`SemanticKnowledge` is stored via `chrome.storage.local` under
`StorageKeys.UNDERSTANDING_RESULT` (new key) so the side panel can display it,
and carried on UnderstandingResult into persistSession. Storage is best-effort
(non-fatal).

## Files Changed

### New
1. `src/understanding/pipeline/understanding-pipeline.ts` — orchestrator
   - `runUnderstandingPipeline(input): Promise<PipelineOutcome>`
   - `preloadPriorKnowledge(origin): Promise<StateBuilderSeed>`
   - `createDefaultUnderstandingPipeline(): UnderstandingPipeline`
2. `tests/understanding/production-wiring.test.ts` — focused integration tests

### Modified (additive only)
3. `src/domain/entities/understanding-result.ts` — optional fields (D5)
4. `src/background/service-worker.ts` —
   - `handleStartRecording`: preload prior knowledge (try/catch, non-fatal)
   - `handleStopRecording`: replace stub with real pipeline call (try/catch,
     non-fatal), store result in chrome.storage
5. `src/shared/storage-keys.ts` (or equivalent) — add UNDERSTANDING_RESULT key
6. `src/understanding/index.ts` — export pipeline module

## Acceptance Criteria

- [ ] AC1: `runUnderstandingPipeline()` with a realistic OrangeHRM-style
      interaction set produces SemanticKnowledge with domain=admin-crm,
      ≥1 entity, ≥1 view, ≥1 workflow, and persists knowledge rows.
- [ ] AC2: Second run against same origin loads prior knowledge
      (hasPriorKnowledge=true) and enrichment reflects it (surface
      enriched with prior views/entities).
- [ ] AC3: Pipeline throws → service worker still completes
      stopRecording; UnderstandingResult keeps minimal stub shape;
      persistSession still called.
- [ ] AC4: E-commerce session (Amazon-style) produces domain=e-commerce
      via built-in defaults (no pack installed for e-commerce) — behavior
      unchanged from M9.1–M9.10.
- [ ] AC5: All 3 packs installed + e-commerce session → e-commerce still
      wins classification (built-in default signature score wins).
- [ ] AC6: `UnderstandingResult.semanticKnowledge` round-trips through
      persistSession (chromified storage) without loss.
- [ ] AC7: Performance: 100-interaction session completes pipeline in <2s.
- [ ] AC8: Full regression suite green; TSC 0 errors; build passes.
- [ ] AC9: Zero M1–M8 source files modified.
- [ ] AC10: Zero M9.1–M9.11 source files modified EXCEPT additive
      understanding/index.ts exports.

## Test Plan

Focused tests (`tests/understanding/production-wiring.test.ts`):
1. Full pipeline over synthetic OrangeHRM interactions → admin-crm
2. Full pipeline over synthetic Amazon interactions → e-commerce
3. Two sequential runs → prior knowledge used on second run
4. Pipeline internal failure simulation → warnings reported, result still
   returned (or minimal result)
5. UnderstandingResult additive fields round-trip
6. Storage key present after pipeline run
