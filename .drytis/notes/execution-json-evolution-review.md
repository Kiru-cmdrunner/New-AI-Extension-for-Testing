# Architecture Review — Execution JSON Evolution: Execution Plan Investigation

Saved at: `.drytis/specs/execution-json-evolution-review.md`

## Recommendation: Option D — Layered Execution Plan

The Execution JSON should evolve from a static artifact into an Execution Plan — but incrementally via layers, not all at once.

### Four Options Evaluated
- A: Static (current) — insufficient for resilience
- B: AI-Enriched (previous recommendation) — strong but lacks multi-engine identity
- C: Full Execution Plan — elegant but premature; 15-20 new fields across 3 sections without execution experience
- **D: Layered Execution Plan — RECOMMENDED** — Option B as first layer of Option C

### Layered Architecture
- **Layer 0:** Frozen B5.2 6-section contract (immutable, mandatory, all engines)
- **Layer 1:** Resilience (AI-enriched, optional) — locatorChain, waitStrategy, recoveryHints
- **Layer 2:** Validation (future) — preconditions, postconditions, expectedResult
- **Layer 3:** Workflow Context (future) — intent, stepGroup, dependentOn
- **Layer 4:** Execution Strategy (future) — retryPolicy, recoveryPolicy

### Multi-Engine Support
Each engine declares layer support. Playwright v6.2: Layer 0+1. Cypress v1.0: Layer 0 only. Same plan, different resilience levels.

### Migration: E0 (executable fallbacks, no AI) → E1 (Layer 1 section) → E2 (Playwright consumption) → E3-E5 (future layers)

### Consistency: ALL FROZEN DECISIONS PRESERVED. Layer 0 is immutable B5.2. Higher layers are additive and optional.
