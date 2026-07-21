# CmdRunner Smart Recorder

> **Chrome Extension (Manifest V3)** that records user interactions on web pages and converts them into structured test automation artifacts — plain-English test steps, CmdRunner Execution JSON, and Playwright test code.

**Package:** `cmdrunner-smart-recorder` · **Version:** 10.4.18 · **TypeScript** (strict) · **Vite + @crxjs/vite-plugin** · **Vitest**

---

## Project Overview

CmdRunner Smart Recorder is a Chrome Extension that captures user interactions on any web page — clicks, text entry, selections, hovers, navigations, and complex pattern interactions (dropdowns, date pickers, modals, tabs, accordions) — then processes them through a multi-stage semantic pipeline that:

1. **Classifies** interactions by meaning, not just DOM event type (e.g., "select option from dropdown" rather than "click on div")
2. **Recognizes** UI component patterns using ARIA roles and behavioral signatures (11 pattern types, framework-agnostic by design)
3. **Enriches** observations with behavioral contracts, option sets, and semantic aggregation
4. **Generates** plain-English test steps, CmdRunner Execution JSON, and Playwright test code
5. **Assembles** an Application Knowledge Fragment — a semantic model of the recorded application

### Maturity

This is a **production architecture** with a complete domain model, a 3-tier recognition pipeline, a post-recording enrichment pipeline (UI Knowledge Model Phases 1–5), and a generation pipeline. **3,324 tests pass across 124 test files.** The build succeeds. The architecture has been frozen through three milestone eras and documented in a complete handover package.

---

## Current Implementation Status

| Subsystem | Status | Key Location |
|-----------|--------|--------------|
| Extension shell (MV3, Side Panel, Settings) | ✅ Complete | `src/sidepanel/`, `src/settings/`, `src/background/` |
| Recording pipeline (Architecture C) | ✅ Complete | `src/recorder/deterministic-recorder.ts`, `src/recorder/pipeline/` |
| Classification (V1 rules + V2 evidence engine) | ✅ Complete | `src/classifier/` |
| Component recognition (3-tier, 11 patterns) | ✅ Complete | `src/recorder/recognition/` |
| Post-recording enrichment (Phase 5) | ✅ Complete | `src/recorder/enrichment/` (9 modules) |
| Semantic aggregation (lifecycle segmentation) | ✅ Complete | `src/recorder/enrichment/semantic-aggregator.ts` |
| Application Knowledge Fragment | ✅ Complete | `src/domain/entities/application-knowledge.ts` |
| Generation pipeline (steps, JSON, Playwright) | ✅ Complete | `src/generation/` |
| Domain model (9 entities, execution IR, staleness) | ✅ Complete | `src/domain/` |
| Repository V2 (Dexie, Unit of Work) | ✅ Complete | `src/repository/v2/` |
| Playwright adapter | ✅ Complete | `src/adapters/playwright/` |
| AI integration (6 providers) | ✅ Complete | `src/ai/` |
| Handover documentation (14 documents) | ✅ Complete | `docs/handover/` |

**Test coverage:** 3,324 tests across 124 files — all passing.

**Not yet wired:** The Application Knowledge Fragment → Generation Pipeline connection. The fragment is assembled but not yet consumed by generation. This is the current development focus.

---

## Before Making Any Code Changes

> ⚠️ **This repository has a complete architectural documentation package. Read it before writing any code.** The architecture was designed through four eras of refinement and contains frozen invariants that must not be violated.

### Required Reading (in order)

| # | Document | Purpose |
|---|----------|---------|
| 1 | [`docs/handover/README.md`](./docs/handover/README.md) | Master index — what's in the documentation package |
| 2 | [`docs/handover/01-project-vision.md`](./docs/handover/01-project-vision.md) | What CmdRunner is, why it exists, what problems it solves |
| 3 | [`docs/handover/02-architecture-overview.md`](./docs/handover/02-architecture-overview.md) | High-level architecture, data flow, subsystems, diagrams |
| 4 | [`docs/handover/03-current-architecture.md`](./docs/handover/03-current-architecture.md) | Every implemented phase — purpose, internals, relationships |
| 5 | [`docs/handover/04-design-decisions.md`](./docs/handover/04-design-decisions.md) | 12 architectural decisions, alternatives rejected, frozen invariants |
| 6 | [`docs/handover/05-implementation-status.md`](./docs/handover/05-implementation-status.md) | What's done, partial, pending — with test counts |
| 7 | [`docs/handover/06-future-roadmap.md`](./docs/handover/06-future-roadmap.md) | Remaining phases, dependencies, recommended order |
| 8 | [`docs/handover/11-architectural-decision-log.md`](./docs/handover/11-architectural-decision-log.md) | Chronological ADR — how architecture evolved and why |
| 9 | [`docs/handover/12-ai-resume-prompt.md`](./docs/handover/12-ai-resume-prompt.md) | Onboarding protocol — read before proposing changes |

### Before Writing Code

After reading the documents above:

| # | Document | Purpose |
|---|----------|---------|
| 10 | [`docs/handover/07-development-principles.md`](./docs/handover/07-development-principles.md) | 10 engineering principles that shape every change |
| 11 | [`docs/handover/09-repository-guide.md`](./docs/handover/09-repository-guide.md) | Folder structure, entry points, build process |

### Deep Dive (as needed)

| # | Document | Purpose |
|---|----------|---------|
| 12 | [`docs/handover/08-knowledge-model.md`](./docs/handover/08-knowledge-model.md) | UI Knowledge Model, semantic aggregation, fragment assembly |
| 13 | [`docs/handover/10-ai-handover-guide.md`](./docs/handover/10-ai-handover-guide.md) | Quick reference, what's frozen, where to continue |

---

## High-Level Architecture

```
User Interaction
    │
    ▼
┌──────────────────┐
│  Recorder        │  Captures raw DOM events with rich element identity
│  (Architecture C) │  — clicks, input, selections, hovers, navigations
└────────┬─────────┘
         │ SessionEvent[]
         ▼
┌──────────────────┐
│  Classifier      │  V1 rule-based + V2 evidence engine
│  (3-tier)        │  → InteractionType + confidence + evidence
└────────┬─────────┘
         │ ClassifiedInteraction[]
         ▼
┌──────────────────┐
│  Recognition     │  3-tier pattern recognition (structural → behavioral → orchestrator)
│  Pipeline        │  → ComponentGrouping[] (dropdowns, modals, tabs, accordions, etc.)
└────────┬─────────┘
         │ EnrichedSession
         ▼
┌──────────────────┐
│  Enrichment      │  Phase 5: interaction contracts, option sets, behavioral contracts,
│  Pipeline        │  surface derivation, semantic aggregation, workflow derivation,
│  (9 modules)     │  fragment assembly → ApplicationKnowledgeFragment
└────────┬─────────┘
         │ ApplicationKnowledgeFragment
         ▼
┌──────────────────┐
│  Generation      │  Fragment → plain-English steps → CmdRunner Execution JSON → Playwright code
│  Pipeline        │
└────────┬─────────┘
         │ TestArtifacts
         ▼
┌──────────────────┐
│  Repository V2   │  Dexie/IndexedDB persistence with Unit of Work pattern
└──────────────────┘

Cross-cutting:
  • AI Layer (6 providers) — enhances classification, never overrides deterministic evidence
  • Playwright Adapter — generates executable test code
  • Domain Model — 9 entities, execution IR, staleness tracking
```

### Key Architectural Components

| Component | Purpose | Location |
|-----------|---------|----------|
| **Recorder** | Captures raw DOM events with deterministic element identity (18-field ElementIdentity) | `src/recorder/` |
| **Recognition Pipeline** | 3-tier recognition: structural (ARIA) → behavioral (signatures) → orchestrator (lifecycle) | `src/recorder/recognition/` |
| **UI Knowledge Model** | Post-recording enrichment: contracts, option sets, aggregation, workflow derivation | `src/recorder/enrichment/` |
| **Semantic Aggregation** | Lifecycle Occurrence Segmentation — groups transitions into meaningful occurrences | `src/recorder/enrichment/semantic-aggregator.ts` |
| **Application Knowledge Fragment** | Semantic model of the recorded app: elements, transitions, components, workflows, surfaces | `src/domain/entities/application-knowledge.ts` |
| **Generation Pipeline** | Converts knowledge fragment → test steps → Execution JSON → Playwright code | `src/generation/` |
| **Repository V2** | IndexedDB persistence via Dexie with Unit of Work pattern | `src/repository/v2/` |
| **Playwright Adapter** | Generates executable Playwright test scripts | `src/adapters/playwright/` |
| **AI Layer** | 6-provider integration (OpenAI, Anthropic, Google, Mistral, Groq, local) — enhances, never overrides | `src/ai/` |
| **Domain Model** | 9 entities, execution IR, staleness tracking, 19 enums | `src/domain/` |

---

## Architectural Principles

### Philosophy

This project follows **architecture-first development**: the design is documented before implementation, frozen decisions are respected, and extensions are additive — never parallel.

### Frozen Invariants

The following are **permanently frozen** and must not be changed without explicit project owner approval:

| Invariant | What It Means |
|-----------|---------------|
| **Observer captures; classifier decides** | These concerns must never be merged |
| **Evidence Sovereignty** | Deterministic evidence always overrides AI — structurally, not by configuration |
| **Three foundational entities** | `UiElement`, `ObservedTransition`, `ComponentGrouping` — only deterministic data |
| **No `actionType` enum in `LogicalAction`** | Actions are structural descriptions; consumers classify |
| **Semantic aggregator is generic** | Zero `PatternType` references in the algorithm |
| **Only CONFIRMED components are enriched** | TENTATIVE and DEVELOPING components are skipped |
| **Execution IR is derived and disposable** | Never authoritative; can be regenerated from source artifacts |
| **Source Artifacts are immutable** | Never deleted or modified |

> **If you believe a frozen decision must change:** document the architectural limitation, present your reasoning to the project owner, and await explicit approval. Do not change it unilaterally. See [`docs/handover/04-design-decisions.md`](./docs/handover/04-design-decisions.md) and [`docs/handover/11-architectural-decision-log.md`](./docs/handover/11-architectural-decision-log.md) for the rationale behind each frozen decision.

### Development Guidelines

- **Read the Architectural Decision Log** before changing any architecture — it explains what alternatives were already rejected and why
- **Preserve existing architectural patterns** — kebab-case files, PascalCase types, pure functions for core logic, typed contracts at every boundary
- **Extend existing components** instead of introducing parallel implementations — new pattern types add new catalogue entries, not new recording systems
- **Follow TDD** — write tests first, every module gets its own test file, all 3,324+ tests must pass
- **Avoid modifying frozen decisions** without careful review and project owner approval

---

## Roadmap

### ✅ Completed

- **UI Knowledge Model Phases 1–5** — foundational entities, behavioral recognition, component registry, post-recording enrichment, semantic aggregation, fragment assembly
- **Recognition Pipeline** — 3-tier recognition with 11 pattern types (6 registered, 5 placeholder)
- **Semantic Aggregation** — Lifecycle Occurrence Segmentation with Rules A/B/C
- **Application Knowledge Fragment** — complete semantic model assembly
- **Generation Pipeline** — verb mapping, canonical steps, Execution JSON, Playwright code generation
- **Domain Model** — 9 entities, execution IR, staleness tracking
- **Repository V2** — Dexie/IndexedDB with Unit of Work
- **AI Integration** — 6 providers with evidence sovereignty
- **Handover Documentation** — 14 documents covering architecture, decisions, and onboarding

### 🎯 Current Focus

**Wire the Application Knowledge Fragment into the Generation Pipeline.**

The `ApplicationKnowledgeFragment` is assembled but not yet consumed by generation. The generation pipeline currently reads raw `SessionEvent[]`; it should read `LogicalAction[]` from the fragment to produce richer test steps with business domain language.

### Future Vision

- **Repository-driven test generation** — generate tests from stored knowledge fragments without re-recording
- **Automatic Playwright project generation** — produce a complete, runnable Playwright project from recorded sessions
- **CmdRunner integration** — feed Execution JSON directly into the CmdRunner platform
- **AI-generated test suites** — positive, negative, boundary, validation, accessibility, security, and regression test suites derived from the knowledge fragment
- **Self-healing locators** — architecture designed, implementation pending
- **Legacy pipeline retirement** — remove `deterministic-recorder.ts` once Architecture C covers all cases

> See [`docs/handover/06-future-roadmap.md`](./docs/handover/06-future-roadmap.md) for the full roadmap with dependencies and recommended order.

---

## Repository Migration Note

> **The Git history was intentionally squashed into a single commit during repository migration.**

This repository combines two parallel development histories:
1. An earlier enterprise recording codebase (v1.16–v1.24 with framework-specific selectors)
2. The current architecture (UI Knowledge Model, domain model, evidence engine, recognition pipeline, enrichment)

Both histories were merged with the Drytis architecture as the active implementation. Enterprise recorder content scripts were preserved in `legacy/` for reference only — they are **not compiled, executed, or integrated** into the active architecture.

**Contributors should use the [Architectural Decision Log](./docs/handover/11-architectural-decision-log.md) and handover documentation to understand the project's evolution rather than relying on Git history.**

---

## AI Contributor Guidelines

> **You are an AI assistant about to work on this project. Follow these guidelines.**

1. **Read the complete handover documentation before proposing implementation.** Start with [`docs/handover/12-ai-resume-prompt.md`](./docs/handover/12-ai-resume-prompt.md) — it defines the standard onboarding protocol.

2. **Verify existing functionality before assuming something is missing.** This repository has 641 files across 131 source modules and 126 test files. Use `grep`, `find`, and [`docs/handover/09-repository-guide.md`](./docs/handover/09-repository-guide.md) to locate what you need.

3. **Preserve architectural consistency.** The architecture was refined through four eras. Frozen invariants are listed above and detailed in [`docs/handover/04-design-decisions.md`](./docs/handover/04-design-decisions.md). Violating them breaks the architecture.

4. **Report documentation inconsistencies before modifying implementation.** If documentation and code disagree, surface the discrepancy — don't silently "fix" it. The documentation may reflect a deliberate decision.

5. **Follow existing architectural patterns.** New pattern types extend the catalogue; new recognition rules extend the tier system; new enrichment modules follow the pure-function + DomInspector pattern. Do not introduce parallel architectures.

6. **Do not redesign frozen architecture.** If you believe a frozen decision must change, document the limitation, present reasoning, and await approval. See the [Frozen Invariants](#frozen-invariants) section above.

---

## Quick Reference

| What | Where |
|------|-------|
| Run tests | `npx vitest run` → 3,324 tests pass |
| Build | `npm run build` → succeeds in ~500ms |
| All enums | `src/domain/enums.ts` |
| Shared types | `src/shared/types.ts` |
| Pattern definitions | `src/recorder/recognition/pattern-catalogue.ts` |
| Enrichment pipeline | `src/recorder/enrichment/enrichment-orchestrator.ts` |
| Semantic aggregator | `src/recorder/enrichment/semantic-aggregator.ts` |
| Generation engine | `src/generation/engine/generation-engine.ts` |
| Verb mappings | `src/generation/verb-mapping-table.ts` |
| Service worker | `src/background/service-worker.ts` |
| Feature flag | `ARCHITECTURE_C_ENABLED` in `chrome.storage.local` |
| Legacy reference | `legacy/` (not compiled, not executed) |
| Development specs | `.drytis/specs/` |
| Development notes | `.drytis/notes/` |
| Handover documentation | `docs/handover/` |

---

## Documentation Map

```
README.md                          ← you are here
├── docs/
│   ├── handover/                  ← permanent source of truth (read this first)
│   │   ├── README.md                 master index
│   │   ├── 01-project-vision.md      what CmdRunner is
│   │   ├── 02-architecture-overview.md  big picture
│   │   ├── 03-current-architecture.md   phase-by-phase detail
│   │   ├── 04-design-decisions.md       frozen invariants + alternatives
│   │   ├── 05-implementation-status.md  what's done/pending
│   │   ├── 06-future-roadmap.md         what to build next
│   │   ├── 07-development-principles.md  engineering rules
│   │   ├── 08-knowledge-model.md        semantic model deep dive
│   │   ├── 09-repository-guide.md       folder structure + build
│   │   ├── 10-ai-handover-guide.md      AI quick reference
│   │   ├── 11-architectural-decision-log.md  chronological ADR
│   │   └── 12-ai-resume-prompt.md       AI onboarding protocol
│   ├── TECHNICAL_ARCHITECTURE.md  ← frozen at v1.0 milestone
│   ├── architecture-review.md     ← Phase 1–4 review
│   └── architecture-walkthrough.md ← end-to-end scenario
├── .drytis/                       ← working specs & notes
│   ├── spec.md / scope.md / patterns.md
│   ├── specs/                        per-feature specifications
│   └── notes/                        findings & postmortems
└── legacy/                        ← reference only, not compiled
    ├── content-scripts/             old V1 recording scripts
    ├── pipeline-v2/                 old V2 pipeline
    └── tests/                       old V1/V2 tests
```

---

## License

Proprietary — CmdRunner Smart Recorder. All rights reserved.
