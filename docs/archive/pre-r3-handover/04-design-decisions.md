# 4. Design Decisions

This document records every major architectural decision, the alternatives considered, the trade-offs accepted, and the invariants that must not be changed.

---

## Decision 1: Capture-First, Classify-Second (Architecture C)

### Decision
Replace the legacy multi-script recorder (6+ content scripts, each classifying at capture time) with a single universal observer that captures everything, then classifies in a pure-function pipeline.

### Why
The legacy approach had O(n²) coordination between scripts, limited evidence at classification time, and required a new content script for each new interaction type. Classification at capture time meant the classifier couldn't see mutations or state changes that happened after the initial event.

### Alternatives Rejected
- **Enhance the legacy pipeline** — would have compounded the coordination problem
- **AI-only classification** — too slow (200-500ms per event), not reliable, doesn't work offline
- **Single classifier with more rules** — would still need to run at capture time, missing evidence

### Trade-offs
- **Accepted:** More architectural complexity (7 layers vs. flat scripts)
- **Accepted:** Slightly higher latency for classification (coalescing window adds ~500ms)
- **Gained:** Complete evidence context, independent testability, extensibility without new scripts

### Invariant
> **AP1: The observer captures; the classifier decides.** These concerns must never be merged. The observer must never classify; the classifier must never capture.

---

## Decision 2: Evidence Sovereignty (Deterministic > AI)

### Decision
Tier 1/2 deterministic evidence structurally overrides Tier 3 AI opinions. When a structural rule says "this is a select", AI cannot reclassify it as a "toggle".

### Why
AI is probabilistic and can hallucinate. Deterministic evidence (ARIA roles, DOM structure, state changes) is reproducible and trustworthy. The system must produce correct results without AI — AI is an enhancement, not a dependency.

### Alternatives Rejected
- **AI-primary with deterministic fallback** — AI latency (200-500ms) would make the pipeline too slow; hallucinations would corrupt the timeline
- **Weighted voting between AI and deterministic** — deterministic evidence should be authoritative, not merely weighted higher

### Trade-offs
- **Accepted:** AI cannot fix classification errors that have deterministic evidence (even if the deterministic evidence is wrong)
- **Gained:** Reproducibility, offline capability, trustworthiness of foundational data

### Invariant
> **AP4: Deterministic evidence always overrides AI.** This is structural, not configurable. A classification with Tier 1/2 evidence cannot be changed by Tier 3 AI.

---

## Decision 3: Three Foundational Entities + Derived Views

### Decision
Only three entities are persisted as observations: `UiElement`, `ObservedTransition`, `ComponentGrouping`. All other knowledge (`InteractionContract`, `BehavioralContract`, `LogicalAction`, etc.) is derived.

### Why
Foundational entities must carry only deterministic, observation-derived knowledge. AI opinions, probabilistic inference, and semantic interpretations are derived views that reference foundational entities by ID. This separation ensures:
- Foundational data is reproducible (same recording → same entities)
- Derived views can be recomputed if algorithms improve
- No AI pollution in the foundational layer

### Alternatives Rejected
- **Flat entity model** (all data in one type) — mixes observation with inference
- **AI-populated entities** — AI opinions would be persisted, making the data non-reproducible
- **Separate persistence for each view** — unnecessary complexity, derived views are regenerable

### Trade-offs
- **Accepted:** Derived views must be recomputed on demand (not free)
- **Gained:** Clean separation of observation and inference, reproducibility, evolutionary capacity

### Invariant
> **Foundational entities carry only deterministic observation-derived knowledge.** The fields Phase 5 populates (`optionSet` from DOM inspection, `businessField` from accessible name) are deterministic observations, not interpretations. AI opinions live only in derived views.

---

## Decision 4: No actionType Enum in LogicalAction

### Decision
A `LogicalAction` is described structurally — by its component, transitions, business field, resulting change, and lifecycle completeness. It does not have an `actionType` classification.

### Why
The project owner explicitly required that logical actions be "structurally described, not classified." Consumers (test generators, UI displays, AI enrichment) derive classifications from the structural data. The model does not impose a taxonomy.

### Alternatives Rejected
- **actionType enum** (e.g., "select_option", "toggle_state", "enter_text") — would freeze a taxonomy that might not fit future patterns

### Invariant
> **LogicalAction has no actionType field.** It is a structural description. Consumers classify; the model describes.

---

## Decision 5: Semantic Aggregation Is Generic

### Decision
The semantic aggregator has zero pattern-specific logic. All pattern knowledge comes from `PatternDefinition.expectedLifecycle` in the catalogue. The same algorithm works for dropdowns, checkboxes, accordions, and any future pattern.

### Why
If the aggregator had pattern-specific branches (`if (patternType === 'dropdown') { ... }`), adding a new pattern would require modifying the aggregator. With a generic algorithm, adding a pattern only requires adding its lifecycle to the catalogue.

### Alternatives Rejected
- **Pattern-specific aggregation logic** — violates the open-closed principle, creates maintenance burden

### Invariant
> **The semantic aggregator references no PatternType constants.** Its behavior is driven entirely by `expectedLifecycle` from the pattern catalogue.

---

## Decision 6: Progressive 3-Tier Component Recognition

### Decision
Component recognition happens in three tiers:
1. **Structural** (<1ms, ~40-50% coverage) — ARIA roles, HTML structure
2. **Behavioral** (~5ms, ~35-45% additional) — evidence signatures from coalescer
3. **AI-Assisted** (async, ~10-20%) — AI interpretation of unrecognized patterns

Components progress through lifecycle states: TENTATIVE → DEVELOPING → CONFIRMED/REJECTED.

### Why
No single tier covers all patterns. Structural recognition is fast but misses custom widgets. Behavioral recognition is slower but catches patterns by their effects. AI catches the long tail but is slow and unreliable.

### Trade-offs
- **Accepted:** Some components never reach CONFIRMED (insufficient evidence)
- **Gained:** Graceful degradation, independent tier testability, coverage statistics

### Invariant
> **Only CONFIRMED components are enriched.** TENTATIVE and DEVELOPING components exist in the registry but are not eligible for behavioral contracts, option extraction, or semantic aggregation.

---

## Decision 7: Dual Output (Test Artifacts + Knowledge Fragment)

### Decision
Every recording produces both test artifacts (plain-English steps, Execution JSON, Playwright code) and an Application Knowledge Fragment (semantic model of the app).

### Why
Test artifacts tell you *what to do*; the knowledge fragment tells you *what the application is*. These are complementary. The knowledge fragment enables future capabilities: test impact analysis, coverage visualization, automated maintenance.

### Alternatives Rejected
- **Test artifacts only** — loses semantic understanding, can't support future capabilities
- **Knowledge fragment only** — too abstract, users need executable tests

---

## Decision 8: Provider-Agnostic AI

### Decision
Support 6 AI providers (OpenAI, Claude, Gemini, Azure OpenAI, OpenRouter, Custom) through a common interface.

### Why
Users have different AI provider preferences, budgets, and compliance requirements. Locking to one provider would limit adoption. The provider abstraction also enables A/B testing between models.

### Alternatives Rejected
- **OpenAI-only** — excludes users on other platforms
- **Multiple separate integrations** — code duplication, maintenance burden

---

## Decision 9: Execution IR is Derived and Disposable

### Decision
The Execution IR is always regenerable from an ATC version + Element Repository. It is never the source of truth.

### Why
If the IR were authoritative, changing a locator strategy would require updating the IR. By making it derived, locator changes flow through automatically. Staleness tracking detects when the IR needs regeneration.

### Invariant
> **P2: The IR is derived and disposable.** Never treat it as authoritative. It can always be regenerated.

---

## Decision 10: Feature Flag for Architecture C

### Decision
Architecture C runs behind the `ARCHITECTURE_C_ENABLED` feature flag in `chrome.storage.local`. When ON, the new pipeline produces timeline entries. When OFF, the legacy pipeline runs unchanged.

### Why
Architecture C was a major architectural change. The feature flag allowed:
- Gradual rollout
- A/B comparison between pipelines
- Safe rollback if issues emerged
- Independent development without disrupting production

### Current State
The flag is currently enabled by default. Both pipelines exist in the codebase. The legacy pipeline (`deterministic-recorder.ts`) is still the primary content script listed in the manifest, but Architecture C's observer and state tracker are also registered as content scripts.

---

## Decision 11: Chrome Side Panel (Not Popup)

### Decision
Use Chrome's Side Panel API for the primary UI surface, not a popup.

### Why
Popups close when the user clicks away. The Side Panel persists, allowing users to see the recording timeline while interacting with the web page. The Side Panel also has more screen real area.

---

## Decision 12: Dexie (IndexedDB) for Repository

### Decision
Use Dexie.js (an IndexedDB wrapper) for the repository layer, not chrome.storage.local.

### Why
`chrome.storage.local` has practical limits (~10MB) and no query capabilities. IndexedDB handles large datasets with indexed queries. Dexie provides a clean promise-based API and supports the Unit of Work pattern.

---

## Frozen Invariants Summary

These must not be changed without strong justification and explicit project owner approval:

1. **AP1:** Observer captures; classifier decides (never merged)
2. **AP4:** Deterministic evidence overrides AI (structural, not configurable)
3. **AP5:** Linear data flow (no feedback loops in the pipeline)
4. **Foundational entities carry only deterministic knowledge** (no AI opinions)
5. **LogicalAction has no actionType enum** (structural description only)
6. **Semantic aggregator is generic** (zero pattern-specific logic)
7. **Only CONFIRMED components are enriched**
8. **IR is derived and disposable** (never authoritative)
9. **Source Artifacts are immutable** (never deleted, never modified)
10. **Test Runs pin to ATC versions** (frozen at execution time)
11. **AI confidence range is [0.05, 0.95]** (never 0 or 1)
12. **Max 3 AI hypotheses** (ranked, evidence-cited)
