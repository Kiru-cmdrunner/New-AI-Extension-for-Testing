# M9.7 — Deterministic Semantic Enrichment

## Objective

Turn the M9.1–M9.6 knowledge model into a machine-readable **Application Understanding** that can answer:

1. What is this application? → Domain Classification
2. What does each page contain? → Application Surface
3. What can the user do? → Surface capabilities + Interaction Contracts + Components
4. What does each interaction mean? → Intent Labels
5. What workflows exist? → Workflow Discovery
6. What state changes result? → Workflow Effects
7. What workflows recur? → Recorded Workflows

No LLM/AI. Pure deterministic enrichment from evidence already captured.

## Self-Review: Duplication Check

| Capability | M9.1–M9.6 has | M9.7 adds | Duplicate? |
|---|---|---|---|
| Domain Classification | Raw entity types, view IDs | Domain label + confidence via scoring | No |
| Component Recognition | ComponentInteraction.componentType (when enriched) | Tier 2 behavioral + per-view aggregation | No |
| Interaction Contracts | ElementIdentity.inputType, TargetStateSnapshot | Structured constraint model | No |
| Intent Labeling | ActionOutcome (did it work?) | Intent label (what was the goal?) | No |
| Workflow Discovery | Flat JourneyTimeline steps | Grouped workflows with effects | No |
| Application Surface | Flat ConsolidatedView + knowledge lists | Per-view model with capabilities | No |
| Recorded Workflows | Per-session journey data | Cross-session pattern matching | No |

## Three Refinements

1. SemanticWorkflow carries explicit WorkflowEffects (aggregated state changes)
2. SurfaceView carries explicit capabilities[] (what can you do here)
3. Component Recognition reuses src/enrichment/ detection + adds Tier 2 behavioral only

## Architecture

```
ComponentInteraction[] + ApplicationKnowledge + JourneyTimeline
    ↓ SemanticEnricher
SemanticKnowledge {
  domain, surface, contracts, components,
  workflows, recordedWorkflows, intents, metadata
}
```

All pure functions. No side effects. No I/O. No M1–M8 or M9.1–M9.6 modifications.

## Files

| File | Purpose |
|------|---------|
| semantic-types.ts | All M9.7 output types |
| domain-signatures.ts | Built-in domain signatures |
| domain-classifier.ts | Weighted domain scoring |
| component-recognizer.ts | Tier 1 reuse + Tier 2 behavioral |
| interaction-contract.ts | Constraint extraction |
| intent-vocabulary.ts | Button text → intent table |
| intent-labeler.ts | 3-priority template resolution |
| workflow-discoverer.ts | Grouping + WorkflowEffects |
| application-surface.ts | View graph + capabilities |
| recorded-workflow.ts | Cross-session dedup + variants |
| semantic-enricher.ts | Orchestrator |

## Acceptance Criteria

- [ ] DomainClassifier scores e-commerce fixtures >0.7
- [ ] DomainClassifier returns `unknown` with evidence for unrecognized apps
- [ ] DomainClassifier extensible via registerDomainSignature()
- [ ] ComponentRecognizer Tier 1 reads existing enrichment results
- [ ] ComponentRecognizer Tier 2 detects behavioral patterns (combobox lifecycle)
- [ ] InteractionContractExtractor derives format from inputType
- [ ] InteractionContractExtractor derives type from tag
- [ ] InteractionContractExtractor extracts state (disabled/checked/expanded)
- [ ] IntentLabeler resolves via API op type (P1), vocabulary (P2), fallback (P3)
- [ ] WorkflowDiscoverer groups steps by temporal + view-boundary
- [ ] WorkflowDiscoverer carries WorkflowEffects per workflow
- [ ] ApplicationSurfaceBuilder enriches views with capabilities + components
- [ ] RecordedWorkflowBuilder deduplicates across sessions
- [ ] SemanticEnricher orchestrates all seven in one call
- [ ] All pure functions — no side effects, no I/O
- [ ] No M1–M8 or M9.1–M9.6 modifications (additive index.ts only)
- [ ] Full regression passes, TSC 0 errors, clean build
