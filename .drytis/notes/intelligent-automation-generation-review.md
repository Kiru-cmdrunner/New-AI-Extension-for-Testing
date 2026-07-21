# Architecture Review — Intelligent Automation Generation

Saved at: `.drytis/specs/intelligent-automation-generation-review.md`

## Key Recommendation: AI-Enriched Execution JSON + Deterministic Playwright

The current generation pipeline is deterministic but brittle: primary-locator-only, fallback locators are comments (not executable), no smart waits, no recovery, no workflow context.

### Recommended Architecture (Alternative C)
Add an **AI Enrichment Layer** between execution-json-generator and playwright-generator:
- Optional, feature-flagged, additive
- Enriches Execution JSON with 2 new optional sections:
  - `resilience`: ranked locator chain (executable fallbacks), wait hints, recovery data
  - `workflowContext`: intent, step group, expected result
- Playwright generator translates enriched JSON deterministically
- Without AI, pipeline runs unchanged (graceful degradation)

### 5 Architectural Alternatives Evaluated
A. Pure deterministic (current) — insufficient for resilience
B. AI-assisted Playwright generation — rejected (breaks determinism)
C. AI-assisted ExecJSON + deterministic Playwright — **RECOMMENDED**
D. Runtime self-healing engine — aspirational, too complex initially
E. Hybrid C+D — long-term target

### Implementation Phases
- G1: Executable fallback chains (no AI, pure generator enhancement)
- G2: AI enrichment layer (additive sections, feature-flagged)
- G3: Smart wait insertion (from recording evidence)
- G4: Assertion generation (from workflow context)
- G5-G7: Runtime self-healing, cross-test optimization, multi-engine support

### Consistency Review: ALL PASS
B5.2 §8.1 explicitly allows additive extension. 6 existing sections unchanged. 2 optional sections added. Playwright generation stays deterministic. All frozen decisions preserved.
