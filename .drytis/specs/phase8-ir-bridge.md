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
- Dual-write strategy: new IR path runs alongside existing pipeline until validated
- Legacy pipeline retired only after verification

## Milestones

### 8.1: Extend IRStep + Define IRBridgeInput
- [x] Add optional fields to IRStep (aiEnrichment, sourceEventId, plainEnglish)
- [x] Define IRBridgeInput interface
- [x] All existing tests pass (additive change, non-breaking)

### 8.2: Build IR Bridge
- [ ] Create src/generation/ir-bridge.ts
- [ ] Implement build(IRBridgeInput) → ExecutionIRPlan
- [ ] Map DetectedInteraction → IRStep (action, target, input)
- [ ] Resolve element locators from ElementIdentity → ResolvedLocator[]
- [ ] Derive assertions from InteractionContract.constraints → IRAssertion[]
- [ ] Enrich descriptions from LogicalAction.businessField
- [ ] Apply readability rules (focus-click merge)
- [ ] Set IREnvironment from RecordingContext
- [ ] Tests covering all interaction type mappings + enrichment

### 8.3: Wire Into Service Worker (Dual-Write)
- [ ] Add EXECUTION_IR_PLAN and GENERATED_FILES StorageKeys
- [ ] Call IR bridge after pipeline runner
- [ ] Call PlaywrightCodeGenerator to render plan
- [ ] Dual-write: both old (GENERATED_STEPS, GENERATED_PLAYWRIGHT) and new (EXECUTION_IR_PLAN, GENERATED_FILES) paths run
- [ ] All existing tests pass

### 8.4: Update Side Panel
- [ ] Read EXECUTION_IR_PLAN from storage
- [ ] Render IRStep[] (description, action, target, assertions)
- [ ] Render GENERATED_FILES (Playwright code)
- [ ] Listen for storage changes
- [ ] All existing tests pass

### 8.5: Validate and Retire Legacy Pipeline
- [ ] Verify IR path produces equivalent or better output
- [ ] Remove GenerationEngine, GeneratorRegistry, GeneratorContract
- [ ] Remove canonical-step-generator, execution-json-generator, playwright-generator (runtime)
- [ ] Remove CanonicalStep, ExecutionJsonObject types
- [ ] Remove GENERATED_STEPS, GENERATED_PLAYWRIGHT StorageKeys
- [ ] Update side panel to read only from IR path
- [ ] All tests pass
- [ ] Build succeeds
