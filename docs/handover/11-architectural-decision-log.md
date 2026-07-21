# Architectural Decision Log

> This is a chronological record of the major architectural decisions that shaped the CmdRunner AI Extension. It shows how the project evolved from a basic recorder into a semantic interaction engine with a full knowledge model.
>
> For thematic analysis (organized by topic rather than date), see [04-design-decisions.md](./04-design-decisions.md).

---

## Decision Records

### ADR-001: Execution JSON as Primary Output Format

| Field | Value |
|-------|-------|
| **Date** | 2026-07-14 |
| **Commit** | `debf502` |
| **Status** | ✅ Frozen |
| **Decision** | The primary machine-readable output format is CmdRunner's Execution JSON — a structured format with typed steps, locators, and assertions. |
| **Reason** | The extension's purpose is to produce automation for CmdRunner. The Execution JSON is the contract between the recorder and the runner. Plain-English steps and Playwright code are derived from the same data. |
| **Related** | [03-current-architecture.md](./03-current-architecture.md) §Generation Pipeline |

---

### ADR-002: Playwright as First Code Generator

| Field | Value |
|-------|-------|
| **Date** | 2026-07-14 |
| **Commit** | `dd294b3` |
| **Status** | ✅ Frozen |
| **Decision** | Playwright is the first code-generation target. The generator produces complete, runnable TypeScript test files. |
| **Reason** | Playwright is modern, well-maintained, and supports the locator strategies (role, text, CSS, test ID) the extension resolves. The generator architecture (IR → adapter) allows adding other frameworks later without changing the core. |
| **Related** | [03-current-architecture.md](./03-current-architecture.md) §Playwright Adapter |

---

### ADR-003: Verb Mapping Table Frozen

| Field | Value |
|-------|-------|
| **Date** | 2026-07-15 |
| **Commit** | `7979149` (documented), `4381f85` (final freeze) |
| **Status** | ✅ Frozen |
| **Decision** | The verb mapping table (`verb-mapping-table.ts`) is the single source of truth for how interaction types map to human-readable verbs in test steps. |
| **Reason** | Without a frozen mapping, step phrasing drifts between sessions. The table ensures consistent, readable output across the project's lifetime. |
| **Related** | `src/generation/verb-mapping-table.ts`, [04-design-decisions.md](./04-design-decisions.md) Decision 12 |

---

### ADR-004: Readability Optimizer — Same Element Detection + Merge Eligibility

| Field | Value |
|-------|-------|
| **Date** | 2026-07-15 |
| **Commit** | `6fe5571` |
| **Status** | ✅ Frozen |
| **Decision** | The Readability Optimizer merges consecutive steps targeting the same element when the merge produces a more readable result. Two frozen rules: (1) Same Element Detection — steps on the same element are merge candidates. (2) Merge Eligibility Principle — merge only when readability strictly improves. |
| **Reason** | Without merging, typing 10 characters produces 10 steps. With merging, it produces one "enter text" step. The frozen rules prevent aggressive merging that loses information. |
| **Related** | [03-current-architecture.md](./03-current-architecture.md) §Generation Pipeline |

---

### ADR-005: Hover Recording Strategy — PERMANENTLY Frozen

| Field | Value |
|-------|-------|
| **Date** | 2026-07-15 |
| **Commit** | `1a1d515` |
| **Status** | ✅ Permanently Frozen |
| **Decision** | The hover recording strategy (when to record, when to ignore, how to classify hover-induced state changes) is permanently frozen. |
| **Reason** | Hover behavior is one of the hardest interaction types to get right (timing, intent, mutation coupling). The strategy was designed through extensive analysis and validated. Reopening it risks destabilizing the hover pipeline. |
| **Related** | `.drytis/specs/milestone-c3.1-hover-strategy*.md` |

---

### ADR-006: Date Picker — 5-Gate Decision Tree

| Field | Value |
|-------|-------|
| **Date** | 2026-07-16 |
| **Commit** | `2df9c7c` |
| **Status** | ✅ Frozen |
| **Decision** | Date picker detection uses a 5-gate decision tree: (1) native date input, (2) calendar grid structure, (3) editable text with date pattern, (4) date range detection, (5) click/text-entry exclusion for calendar overlays. |
| **Reason** | Date pickers have the most implementation variety of any UI pattern (native, jQuery, MUI, custom div grids). The 5-gate tree handles all variants without false positives on regular text inputs. |
| **Related** | `.drytis/specs/milestone-c6.1-date-picker*.md` |

---

### ADR-007: Architecture C — Capture-First, Classify-Second

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 (design: `0186a10`–`112ab28`), (implementation: `d94e95a`–`5b0b371`) |
| **Status** | ✅ Frozen |
| **Decision** | Replace the legacy multi-script recorder (6+ content scripts, each classifying at capture time) with a single universal observer that captures everything, then classifies in a pure-function pipeline with full evidence context. Seven principles (AP1–AP7) govern the architecture. |
| **Reason** | The legacy pipeline had O(n²) script coordination, classification at capture time (limited evidence), and required a new content script per interaction type. Architecture C solves all three: single observer, complete evidence in the classifier, extensibility via new rules not new scripts. |
| **Alternatives Rejected** | (1) Enhance the legacy pipeline — would compound coordination problems. (2) AI-only classification — too slow, unreliable offline. (3) More rules in the legacy classifier — still runs at capture time. |
| **Related** | [04-design-decisions.md](./04-design-decisions.md) Decision 1, `.drytis/architecture-c-production.md` |

---

### ADR-008: Evidence Sovereignty (AP4) — Deterministic Overrides AI

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Commit** | `112ab28` (AI Philosophy), `ef0591f` (AI Observer implementation) |
| **Status** | ✅ Frozen (structural invariant) |
| **Decision** | Tier 1/2 deterministic evidence structurally overrides Tier 3 AI opinions. A click classified by structural rules as a "select" cannot be reclassified by AI as a "toggle". |
| **Reason** | AI is probabilistic and can hallucinate. Deterministic evidence is reproducible. The system must produce correct results without AI — AI enhances but never overrides deterministic classification. |
| **Related** | [04-design-decisions.md](./04-design-decisions.md) Decision 2, [07-development-principles.md](./07-development-principles.md) |

---

### ADR-009: 8 Frozen AI Principles (P1–P8)

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Commit** | `112ab28` |
| **Status** | ✅ Frozen |
| **Decision** | Eight principles govern AI behavior: (1) Observation First, (2) Progressive Understanding, (3) Evidence Sovereignty, (4) Hypothesis Discipline (max 3), (5) Honest Confidence [0.05, 0.95], (6) Evidence Citation, (7) Hallucination Rejection, (8) Provider Independence. |
| **Reason** | Without disciplined constraints, AI output is unbounded and unreliable. These 8 principles produce structured, traceable, honest AI advisory that enhances the pipeline without corrupting it. |
| **Related** | [04-design-decisions.md](./04-design-decisions.md) Decision 2, [02-architecture-overview.md](./02-architecture-overview.md) §AI Interaction |

---

### ADR-010: Semantic Interaction Language as Source of Truth for Plain English

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Commit** | `168e659` |
| **Status** | ✅ Frozen |
| **Decision** | The Semantic Interaction Language (canonical interaction taxonomy + verb mapping) is the single source of truth for all plain-English output. Generation does not invent phrasing — it renders from the taxonomy. |
| **Reason** | Before this decision, step phrasing was inconsistent across code paths. Centralizing the language ensures every output path produces the same English for the same interaction type. |
| **Related** | ADR-003 (verb mapping table) |

---

### ADR-011: Engineering Formalization — 42 Shared Objects + Infrastructure Layer

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Commit** | `62625e8`–`9b5712b` |
| **Status** | ✅ Frozen |
| **Decision** | Formalize the codebase with 42 shared objects (types, interfaces, constants), a typed message union (AppMessage, 21 types), schema versioning for persisted objects, a confidence engine, and a dedicated infrastructure layer (audit, error handling, logging). |
| **Reason** | The V1 codebase had untyped message passing, duplicated types, and no infrastructure separation. This formalization made the codebase maintainable and prevented regression. |
| **Related** | [07-development-principles.md](./07-development-principles.md) §Typed Contracts |

---

### ADR-012: Multi-Tier Classifier — 16 Rules, 3 Tiers

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Commit** | `efd708e` |
| **Status** | ✅ Frozen |
| **Decision** | The classifier uses 16 rules organized in 3 tiers: Tier 1 structural (R1–R6, <1ms), Tier 2 behavioral (R7–R14, ~5ms), Tier 3 AI advisory + default (R15–R16, async). |
| **Reason** | No single tier covers all interaction types. The progressive structure allows fast classification for common cases and deeper analysis for ambiguous ones, with AI as the final fallback. |
| **Related** | [03-current-architecture.md](./03-current-architecture.md) §Architecture C Phase 1 |

---

### ADR-013: Feature Flag for Architecture C

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Commit** | `5b0b371` (flag introduced), `e93181a` (enabled by default) |
| **Status** | ✅ Active (enabled by default) |
| **Decision** | Architecture C runs behind the `ARCHITECTURE_C_ENABLED` feature flag. When ON, the new pipeline produces timeline entries. When OFF, the legacy pipeline runs. |
| **Reason** | Big-bang architectural replacements are risky. The flag allows A/B comparison, gradual rollout, and safe rollback. It was enabled by default after validation. |
| **Related** | [04-design-decisions.md](./04-design-decisions.md) Decision 10 |

---

### ADR-014: Interaction Assembler — Transaction State Machine

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Commit** | `45a43bd` |
| **Status** | ✅ Frozen |
| **Decision** | Composite interactions (dropdown open → select → close) are handled by a transaction state machine that buffers events and emits a single complete interaction. |
| **Reason** | Without buffering, a dropdown selection produces 3 separate events. The assembler treats it as one transaction, producing cleaner output. |
| **Related** | `src/recorder/pipeline/interaction-assembler.ts` |

---

### ADR-015: Semantic Interaction Engine v1.0

| Field | Value |
|-------|-------|
| **Date** | 2026-07-19 |
| **Commit** | `ce7327a` (tagged `semantic-interaction-engine-v1.0`) |
| **Status** | ✅ Frozen (tagged milestone) |
| **Decision** | The complete interaction engine (33 interaction types across 8 categories, evidence engine with 5 providers, generation pipeline) is frozen as v1.0. This is the baseline — future work builds on top, not by modifying v1.0. |
| **Reason** | After 5 days of intensive development and validation (real-world testing on Google Flights, Avis Ford, MUI/AntD components), the engine reached stability. Freezing prevents regression while new architectural layers (domain model, knowledge model) are built. |
| **Related** | `docs/TECHNICAL_ARCHITECTURE.md` (frozen at this tag) |

---

### ADR-016: Domain Model with 9 Core Entities + Execution IR

| Field | Value |
|-------|-------|
| **Date** | 2026-07-20 |
| **Commit** | `f39d81c` |
| **Status** | ✅ Frozen |
| **Decision** | Introduce a formal domain model with 9 core entities (SourceArtifact, Project, ApprovedTestCase, Element, TestSuite, EnvironmentProfile, TestRun, Test Data, ExecutionIRPlan) organized by owning context. Introduce the Execution IR as a derived, disposable intermediate representation. |
| **Reason** | Without a formal domain model, test cases and elements have no persistence structure. The IR provides engine-agnostic output that decouples test case definition from code generation. |
| **Key invariant** | The IR is derived and disposable (P2) — always regenerable from an ATC version + Element Repository. |
| **Related** | [03-current-architecture.md](./03-current-architecture.md) §Domain Model & Execution IR |

---

### ADR-017: Three Foundational Entities + Derived Views

| Field | Value |
|-------|-------|
| **Date** | 2026-07-20 |
| **Commit** | `8de454d` (entities introduced), `f6eb2ee` (derived views complete) |
| **Status** | ✅ Frozen |
| **Decision** | Only three entities are persisted as observations: `UiElement`, `ObservedTransition`, `ComponentGrouping`. All other knowledge (contracts, actions, workflow, fragment) is derived. Foundational entities carry only deterministic, observation-derived knowledge. |
| **Reason** | This separation ensures reproducibility (same recording → same entities) and evolutionary capacity (derived views can be recomputed when algorithms improve). AI opinions never pollute the foundational layer. |
| **Alternatives Rejected** | (1) Flat entity model mixing observation with inference. (2) AI-populated entities. (3) Separate persistence for each derived view. |
| **Related** | [04-design-decisions.md](./04-design-decisions.md) Decision 3, [08-knowledge-model.md](./08-knowledge-model.md) |

---

### ADR-018: Progressive 3-Tier Component Recognition

| Field | Value |
|-------|-------|
| **Date** | 2026-07-20 |
| **Commit** | `8de454d` (structural), `62e799a` (behavioral) |
| **Status** | ✅ Frozen |
| **Decision** | Component recognition happens in three tiers: structural (<1ms, ~40-50% coverage), behavioral (~5ms, ~35-45% additional), AI-assisted (async, ~10-20%). Components progress through lifecycle states: TENTATIVE → DEVELOPING → CONFIRMED/REJECTED. |
| **Reason** | No single tier covers all patterns. Structural is fast but misses custom widgets. Behavioral catches patterns by their effects. AI catches the long tail. The lifecycle ensures components accumulate evidence before being enriched. |
| **Key invariant** | Only CONFIRMED components are enriched. |
| **Related** | [04-design-decisions.md](./04-design-decisions.md) Decision 6 |

---

### ADR-019: Semantic Aggregation — Generic, No actionType Enum

| Field | Value |
|-------|-------|
| **Date** | 2026-07-21 |
| **Commit** | `f6eb2ee` |
| **Status** | ✅ Frozen |
| **Decision** | The semantic aggregator groups transitions into logical actions using lifecycle occurrence segmentation (Rules A/B/C). The algorithm is completely generic (zero PatternType references). LogicalAction has no actionType enum — it is a structural description. |
| **Reason** | If the aggregator had pattern-specific branches, adding a pattern would require modifying it. If LogicalAction had an actionType, it would freeze a taxonomy. Both decisions preserve extensibility. |
| **Related** | [04-design-decisions.md](./04-design-decisions.md) Decisions 4 & 5, [08-knowledge-model.md](./08-knowledge-model.md) §Semantic Aggregation |

---

### ADR-020: Dual Output — Test Artifacts + Application Knowledge Fragment

| Field | Value |
|-------|-------|
| **Date** | 2026-07-21 |
| **Commit** | `f6eb2ee` |
| **Status** | ✅ Frozen |
| **Decision** | Every recording produces both test artifacts (steps, JSON, Playwright code) and an Application Knowledge Fragment (semantic model of the app). These are complementary, not competing. |
| **Reason** | Test artifacts tell you *what to do*; the knowledge fragment tells you *what the application is*. The fragment enables future capabilities (coverage analysis, impact detection, AI-assisted generation). |
| **Related** | [04-design-decisions.md](./04-design-decisions.md) Decision 7, [08-knowledge-model.md](./08-knowledge-model.md) §ApplicationKnowledgeFragment |

---

## Chronological Summary

```
Jul 14  ADR-001  Execution JSON format
Jul 14  ADR-002  Playwright as first generator
Jul 15  ADR-003  Verb mapping table frozen
Jul 15  ADR-004  Readability optimizer rules frozen
Jul 15  ADR-005  Hover strategy PERMANENTLY frozen
Jul 16  ADR-006  Date picker 5-gate decision tree
Jul 17  ADR-007  Architecture C: capture-first, classify-second
Jul 17  ADR-008  Evidence Sovereignty (AP4)
Jul 17  ADR-009  8 AI principles (P1–P8)
Jul 17  ADR-010  Semantic Interaction Language as source of truth
Jul 17  ADR-011  Engineering formalization (42 shared objects)
Jul 17  ADR-012  16-rule, 3-tier classifier
Jul 17  ADR-013  Feature flag for Architecture C
Jul 17  ADR-014  Interaction Assembler (transaction state machine)
Jul 19  ADR-015  Semantic Interaction Engine v1.0 (tagged freeze)
Jul 20  ADR-016  Domain model (9 entities) + Execution IR
Jul 20  ADR-017  Three foundational entities + derived views
Jul 20  ADR-018  Progressive 3-tier component recognition
Jul 21  ADR-019  Semantic aggregation — generic, no actionType enum
Jul 21  ADR-020  Dual output (test artifacts + knowledge fragment)
```
