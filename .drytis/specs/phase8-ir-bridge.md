# Phase 8: Knowledge Fragment → Generation Integration (IR Bridge)

## Objective
Converge the two parallel generation pipelines (runtime CanonicalStep path and domain IR path) into a single unified flow based on ExecutionIRPlan. The IR bridge consumes SessionEvent[] + DetectedInteraction[] + ApplicationKnowledgeFragment and produces a single ExecutionIRPlan that all downstream phases consume.

## Architecture
See `docs/handover/14-target-generation-architecture.md` for the full design.

Key decisions:
- IRStep extended with 3 optional fields (aiEnrichment, sourceEventId, plainEnglish)
- IRBridgeInput model encapsulates all inputs
- IR Bridge produces ExecutionIRPlan (single source of truth downstream)
- IRCodeGenerator interface renders plan → code files
- Existing PlaywrightCodeGenerator reused (not rewritten)
- Dual-write strategy: new IR path ran alongside existing pipeline until validated
- Legacy pipeline retired after verification (Phase 8.5)

## Milestones

### 8.1: Extend IRStep + Define IRBridgeInput
- [x] Add optional fields to IRStep (aiEnrichment, sourceEventId, plainEnglish)
- [x] Define IRBridgeInput interface
- [x] All existing tests pass (additive change, non-breaking)

### 8.2: Build IR Bridge
- [x] Create src/generation/ir-bridge.ts
- [x] Implement build(IRBridgeInput) → ExecutionIRPlan
- [x] Map DetectedInteraction → IRStep (action, target, input)
- [x] Resolve element locators from ElementIdentity → ResolvedLocator[]
- [x] Derive assertions from InteractionContract.constraints → IRAssertion[]
- [x] Enrich descriptions from LogicalAction.businessField
- [x] Apply readability rules (focus-click merge)
- [x] Set IREnvironment from RecordingContext
- [x] Tests covering all interaction type mappings + enrichment

### 8.3: Wire Into Service Worker (Dual-Write)
- [x] Add EXECUTION_IR_PLAN and GENERATED_FILES StorageKeys
- [x] Call IR bridge after pipeline runner
- [x] Call PlaywrightCodeGenerator to render plan
- [x] Dual-write: both old (GENERATED_STEPS, GENERATED_PLAYWRIGHT) and new (EXECUTION_IR_PLAN, GENERATED_FILES) paths run
- [x] All existing tests pass

### 8.4: Update Side Panel
- [x] Read EXECUTION_IR_PLAN from storage
- [x] Render IRStep[] (description, action, target, assertions)
- [x] Render GENERATED_FILES (Playwright code)
- [x] Listen for storage changes
- [x] All existing tests pass

### 8.5: Validate and Retire Legacy Pipeline
- [x] Verify IR path produces equivalent or better output
- [x] Remove GenerationEngine call from service worker
- [x] Archive 17 legacy generation files to legacy/generation-pipeline/
- [x] Archive 21 legacy test files to legacy/generation-pipeline/tests/
- [x] Move ExecutionJsonObject + PlaywrightGeneratorOutput types to shared/types.ts
- [x] Remove GENERATED_STEPS, GENERATED_PLAYWRIGHT StorageKeys
- [x] Remove legacy StorageService methods (getGeneratedSteps, setGeneratedSteps, clearGeneratedSteps, getGeneratedPlaywright, setGeneratedPlaywright, clearGeneratedPlaywright)
- [x] Remove legacy side panel rendering (renderGeneratedSteps, loadGeneratedSteps, loadGeneratedPlaywright, showGeneratedPlaywright)
- [x] Remove legacy HTML sections from sidepanel/index.html
- [x] Update stale comments in architecture-types.ts
- [x] All tests pass (2475/2475 across 100 files)
- [x] Build succeeds (643ms)
