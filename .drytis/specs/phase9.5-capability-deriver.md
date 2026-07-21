# Phase 9.5: Capability Deriver + UnderstandingResult Aggregate

## Objective

Complete the Understanding Layer by adding two new artifacts:
1. **CapabilityCandidate** — semantic understanding of what the application does (derived from fragment)
2. **UnderstandingResult** — aggregate output of the Understanding Layer (fragment + capability)

These are **sibling artifacts** derived in parallel from the fragment. The Generation Layer (IR Bridge) consumes the UnderstandingResult as its input boundary.

## Architecture

```
Recording Layer (deterministic recorder, classifier)
     ↓
Understanding Layer
  ├── Domain Adapter
  ├── Recognition Orchestrator
  ├── Enrichment Orchestrator → ApplicationKnowledgeFragment
  └── Capability Deriver       → CapabilityCandidate
     ↓
UnderstandingResult { fragment, capability }
     ↓
Generation Layer (IR Bridge → ExecutionIRPlan → PlaywrightCodeGenerator)
```

## Design Principles

- Capability is a **peer artifact** alongside the fragment, not embedded inside it
- Capability is **derived** from the fragment using deterministic pattern matching
- UnderstandingResult is the **layer boundary** — the Generation Layer never imports fragment/capability directly
- All new types use `readonly` fields (immutable per-session snapshots)
- The capability does NOT carry a rigid taxonomy — names are derived from application text

## Milestones

### 9.5.1: Define Types
- [ ] Create `src/domain/entities/capability-candidate.ts` with CapabilityCandidate type
- [ ] Create `src/domain/entities/understanding-result.ts` with UnderstandingResult type
- [ ] Add StorageKeys.UNDERSTANDING_RESULT and StorageKeys.CAPABILITY_CANDIDATE
- [ ] Tests for type instantiation and immutability
- [ ] All existing tests pass

### 9.5.2: Build Capability Deriver
- [ ] Create `src/recorder/enrichment/capability-deriver.ts`
- [ ] Derive capability name from workflow + surface transitions
- [ ] Derive inputs from LogicalAction.businessField + InteractionContract.constraints
- [ ] Derive observed outcome from terminal SurfaceTransition
- [ ] Derive validation rules from InteractionContract.constraints
- [ ] Derive entry element from first logical action
- [ ] Set confidence to 'candidate' (single observation)
- [ ] Handle null/empty fragment gracefully
- [ ] Tests covering all derivation paths + edge cases
- [ ] All existing tests pass

### 9.5.3: Wire Into Pipeline + Update IR Bridge
- [ ] Update PipelineResult to include capability
- [ ] Run capability deriver after enrichment in pipeline-runner
- [ ] Add UnderstandingResult assembly in service worker
- [ ] Store UnderstandingResult in chrome.storage.local
- [ ] Update IRBridgeInput to accept UnderstandingResult
- [ ] Update IR Bridge to read fragment from UnderstandingResult
- [ ] Update service worker to pass UnderstandingResult to IR Bridge
- [ ] Update side panel to load from UnderstandingResult
- [ ] All existing tests pass

### 9.5.4: Infrastructure Gate + Review + Push
- [ ] Build succeeds
- [ ] All tests pass
- [ ] Infrastructure Gate (infra_verifier)
- [ ] Reviewer (spec compliance)
- [ ] Push to GitHub
- [ ] Update documentation
