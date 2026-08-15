# M9 Null Guards — targetEvidence === null / finalState === null

## Context

Real-Chrome runtime verification of the Amazon Add-to-cart flow (int-17) surfaced two M9
runtime failures, audited read-only and root-caused:

1. `signal-extraction: Cannot read properties of null (reading 'before')` —
   `TargetStateSignalExtractor.extract` (src/understanding/signal-extractors/target-state-signals.ts:33)
   dereferences `evidence.targetEvidence` before checking it for null. The G3 late-network
   re-collect (src/tap/evidence-collector.ts:1212) legitimately delivers
   `targetEvidence: null` supplements, which can become an interaction's FINAL evidence
   (direct attach / richness-replacement / richest-pending in src/runtime/sw-integration.ts).
   The throw escapes `SignalExtractionCoordinator.extract` (no per-extractor isolation),
   nulling `signalResult` for the WHOLE session → no state building, no outcomes,
   no cart-item entity, and (via failure 2) a broken knowledge-persistence stage.

2. `recorded-workflow-persistence: Cannot read properties of null (reading 'currentView')` —
   `UnderstandingPipeline.run` Stage 7 (src/understanding/pipeline/understanding-pipeline.ts:371)
   guards on `this.persistenceService && semanticKnowledge` but NOT `finalState`, then passes
   `applicationState: finalState!` (non-null assertion on null) into
   `KnowledgePersistenceService.persist` → `persistViews` → `state.currentView`
   (knowledge-persistence-service.ts:133) throws. Stage 5 (line 332) has the correct guard;
   Stage 7 must match it. Consequence: partial Dexie write (application row only, steps 2–10 skipped).

## Scope — EXACTLY these two fixes, nothing else

### Fix 1: null-guard in TargetStateSignalExtractor

File: `src/understanding/signal-extractors/target-state-signals.ts:33`
Change `if (!target.before || !target.after) return [];`
to     `if (!target || !target.before || !target.after) return [];`

### Fix 2: Stage 7 guard + drop the non-null assertion

File: `src/understanding/pipeline/understanding-pipeline.ts:371` + `:377`
- Guard becomes `if (this.persistenceService && semanticKnowledge && finalState)`.
- `applicationState: finalState!` becomes `applicationState: finalState`.

## Acceptance criteria

- [ ] AC1: An interaction whose `behavioralEvidence.targetEvidence` is `null` produces ZERO
      signals from TargetStateSignalExtractor and does NOT throw.
- [ ] AC2: A batch containing one null-targetEvidence interaction (plus one normal
      interaction) still yields signals for the NORMAL interaction — batch extraction
      survives (signals map non-empty, apiOperations preserved).
- [ ] AC3: TargetStateSignalExtractor handles the pre-existing shapes unchanged:
      before-only, after-only, both-null → [] ; full before/after → input-value-change
      and/or control-state signals as before (no behavior change for non-null targets).
- [ ] AC4: When Stage 1 fails (or finalState is otherwise null), Stage 7 does NOT call
      `persistenceService.persist` — no `recorded-workflow-persistence` warning, no
      partial Dexie write. Stage 6 enrichment still runs; return value carries
      `finalState: null` and a non-null `semanticKnowledge`.
- [ ] AC5: When finalState IS non-null, Stage 7 persists exactly as before (recorded
      workflows included) — no regression on the happy path.
- [ ] AC6: TSC 0 errors; full suite green (3,139 existing + new regression tests).
- [ ] AC7: Fresh ZIP built from the fixed tree; SW bundle still satisfies the inlining
      invariants (0 dynamic import(), 0 preload helper); no other source changes.

## Out of scope (explicitly NOT touched)

- ENTITY_HINT_PATTERNS anchored-regex miss (`ASIN.1`/`quantity.1`) — separate decision.
- Drain-guard A first-delivered-status freeze — separate decision.
- Any G4/G5 capture/attribution/ledger code.
- Any build config beyond what the already-built SW fix requires (rebuild only).

## Test plan

New file `tests/understanding/m9-null-guards.test.ts`:
- R1 (AC1): direct extractor call, targetEvidence null → returns [], does not throw.
- R2 (AC2): coordinator batch with null-target interaction + normal interaction →
  signals for the normal one survive; apiOperations length ≥ 1.
- R3 (AC3): before/after variants return [] appropriately; full diff still emits signals.
- R4 (AC4): UnderstandingPipeline (noPersistence:false, fake repo) with an interaction
  engineered so Stage 1 throws (monkeypatched coordinator extractor throwing) → run()
  completes, warnings contain `signal-extraction:` but NOT `recorded-workflow-persistence:`,
  repo.persistView calls === 0, semanticKnowledge non-null, finalState null.
- R5 (AC5): happy path with real extractors + valid targetEvidence → repo receives the
  persist call (applicationState non-null, recordedWorkflows present when workflows exist);
  no `recorded-workflow-persistence` warning.
