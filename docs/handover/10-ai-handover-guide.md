# 10. AI Handover Guide

> **You are a new AI assistant. A user just said: "Let's resume the CmdRunner AI Extension project." This document tells you everything you need to know.**

---

## What Is This Project?

CmdRunner AI Extension is a **Chrome Extension (Manifest V3)** that records user interactions on web pages and converts them into structured test automation artifacts. It captures clicks, text entry, selections, hovers, navigations, and complex pattern interactions (dropdowns, date pickers, modals, tabs), then processes them through a multi-stage pipeline that:

1. Classifies interactions semantically (not just "click" but "select option from dropdown")
2. Recognizes UI component patterns (11 pattern types)
3. Enriches observations with behavioral contracts and semantic aggregation
4. Generates plain-English test steps, CmdRunner Execution JSON, and Playwright test code
5. Assembles an Application Knowledge Fragment — a semantic model of the app

**Tech stack:** TypeScript, Vite, @crxjs/vite-plugin, Vitest, Dexie (IndexedDB). No heavy frameworks.

**Scale:** ~140 TypeScript source files, 124 test files, 3324 tests, 82 git commits.

---

## What Is Already Completed?

### Fully Built and Tested

| Subsystem | Status | Key Files |
|-----------|--------|-----------|
| Extension shell (MV3, Side Panel, Settings) | ✅ Complete | `src/sidepanel/`, `src/settings/`, `src/background/` |
| Recording pipeline (legacy V1 + Architecture C) | ✅ Complete | `src/recorder/deterministic-recorder.ts`, `src/recorder/pipeline/` |
| Classification (V1 rules + V2 evidence engine) | ✅ Complete | `src/classifier/` |
| Component recognition (3-tier, 11 patterns) | ✅ Complete | `src/recorder/recognition/` |
| Post-recording enrichment (Phase 5) | ✅ Complete | `src/recorder/enrichment/` (9 modules) |
| Generation pipeline (steps, JSON, Playwright) | ✅ Complete | `src/generation/` |
| Domain model (9 entities, IR, staleness) | ✅ Complete | `src/domain/` |
| Repository V2 (Dexie, Unit of Work) | ✅ Complete | `src/repository/v2/` |
| Playwright adapter | ✅ Complete | `src/adapters/playwright/` |
| AI integration (6 providers) | ✅ Complete | `src/ai/` |

### Not Yet Done

| Capability | Status |
|-----------|--------|
| Knowledge fragment → generation pipeline wiring | Not started |
| Legacy pipeline retirement (Phase 7) | Not started |
| Self-healing locators | Architecture designed, not implemented |
| Test execution engine | Interface defined, no runner |
| Test suite composition UI | Entities designed, no UI |
| Natural language authoring | Infrastructure exists, no NL→ATC conversion |
| Coverage visualization | Data available, no UI |

---

## What Architectural Decisions Are Frozen?

**These must NOT be changed without explicit project owner approval. Violating them breaks the architecture.**

### The 7 Architecture C Principles (AP1–AP7)
1. **AP1:** Observer captures; classifier decides — never merge these
2. **AP2:** Graceful degradation — system works without AI
3. **AP3:** Progressive classification — Tier 1 → Tier 2 → Tier 3
4. **AP4:** Evidence sovereignty — deterministic evidence ALWAYS overrides AI
5. **AP5:** Linear data flow — no feedback loops
6. **AP6:** Contract-based boundaries — typed interfaces everywhere
7. **AP7:** Additive extensibility — new types = new rules, not new scripts

### The 8 AI Principles (P1–P8)
1. Observation First
2. Progressive Understanding
3. Evidence Sovereignty
4. Hypothesis Discipline (max 3)
5. Honest Confidence [0.05, 0.95]
6. Evidence Citation
7. Hallucination Rejection
8. Provider Independence

### Knowledge Model Invariants
- **Three foundational entities only:** UiElement, ObservedTransition, ComponentGrouping
- **Foundational entities carry ONLY deterministic data** — no AI opinions in persisted entities
- **LogicalAction has NO actionType enum** — structural description only
- **Semantic aggregator is GENERIC** — zero PatternType references
- **Only CONFIRMED components are enriched**
- **Execution IR is derived and disposable** — never authoritative
- **Source Artifacts are immutable** — never deleted or modified

---

## What Should Never Be Changed Without Strong Justification?

1. **The pattern catalogue structure** (`pattern-catalogue.ts`) — adding patterns is fine; changing the structure breaks all recognizers
2. **The verb mapping table** (`verb-mapping-table.ts`) — frozen; changes affect all generated output
3. **The AppMessage type** (`shared/types.ts`) — adding messages is fine; changing existing ones breaks messaging
4. **The ElementIdentity 18-field structure** — adding fields is fine; removing/renaming breaks persistence
5. **The three foundational entity types** — these are the bedrock; everything else is derived
6. **The enrichment module interfaces** — they follow the pure-function pattern with DomInspector abstraction

---

## Where Should Development Continue?

### Immediate Next Steps (Recommended Priority)

**1. Wire Knowledge Fragment → Generation Pipeline**
- The `ApplicationKnowledgeFragment` is assembled but not consumed by generation
- The generation pipeline should use `LogicalAction[]` instead of raw `SessionEvent[]`
- This will produce richer test steps with business domain language

**2. Push to Remote**
- Local HEAD is ahead of origin/main — the latest Phase 5 work needs pushing
- Run: `git push origin main`

**3. Fix `docs/architecture-validation.md`**
- This file is corrupted (contains npm debug log instead of documentation)
- Either restore from git history or write fresh

### Medium-Term Work

**4. Legacy Pipeline Retirement (Phase 7)**
- Remove `deterministic-recorder.ts` once Architecture C covers all cases
- Requires E2E validation against real applications

**5. Self-Healing Locators**
- Architecture is fully designed (staleness, heal history, identity matching)
- Implementation would complete the core value proposition

**6. Test Execution Engine**
- IRExecutor interface exists
- Need actual test runner that executes IR plans

---

## What Should the Next AI Read First?

### Required Reading (in order)
1. **This document** (`docs/handover/10-ai-handover-guide.md`)
2. **[01-project-vision.md](./01-project-vision.md)** — what you're building and why
3. **[04-design-decisions.md](./04-design-decisions.md)** — what's frozen and why
4. **[05-implementation-status.md](./05-implementation-status.md)** — what exists and what doesn't

### Before Writing Code
5. **[07-development-principles.md](./07-development-principles.md)** — how development works here
6. **[09-repository-guide.md](./09-repository-guide.md)** — where things are

### Onboarding Protocol (required for all new AI assistants)
**Follow [12-ai-resume-prompt.md](./12-ai-resume-prompt.md)** — the standard onboarding process. It defines a step-by-step protocol: read docs in order, summarize your understanding, identify the current stage, explain frozen decisions, explain remaining work, and confirm principles before proposing changes.

### Deep Dive (as needed)
7. **[02-architecture-overview.md](./02-architecture-overview.md)** — full architecture
8. **[03-current-architecture.md](./03-current-architecture.md)** — phase-by-phase detail
9. **[08-knowledge-model.md](./08-knowledge-model.md)** — knowledge model deep dive
10. **[06-future-roadmap.md](./06-future-roadmap.md)** — what to build next
11. **[11-architectural-decision-log.md](./11-architectural-decision-log.md)** — chronological ADR showing how architecture evolved

### Source Code (read these files)
- `src/domain/enums.ts` — all enums
- `src/shared/types.ts` — shared types
- `src/recorder/recognition/pattern-catalogue.ts` — pattern definitions
- `src/recorder/enrichment/semantic-aggregator.ts` — the core algorithm
- `src/recorder/enrichment/enrichment-orchestrator.ts` — how enrichment is wired

### Development Specs (in `.drytis/specs/`)
- `ui-knowledge-model-phase5.md` — Phase 5 spec (the latest completed work)
- `phase5-pipeline-integration.md` — Architecture C integration
- `product-architecture-design-v1.0.md` — FROZEN product architecture

---

## How Should Future Architectural Decisions Be Evaluated?

### Decision Framework

When considering a new architectural change, evaluate it against:

1. **Does it violate any frozen invariant?** → If yes, STOP. Discuss with project owner.
2. **Does it follow AP1–AP7?** → If it merges capture and classification, adds feedback loops, or bypasses evidence sovereignty, reject.
3. **Is it additive?** → Can it be added without modifying existing code? If it requires modifying frozen modules, reconsider.
4. **Is it testable independently?** → Can you write tests without spinning up the entire pipeline?
5. **Does it preserve provenance?** → Does the new data carry information about where it came from?
6. **Is it deterministic by default?** → Does it work without AI? AI should enhance, not enable.

### Process

1. **Write a spec** in `.drytis/specs/<feature>.md` with acceptance criteria
2. **Create blueprint files** if the scope is large (update `.drytis/*.md`)
3. **Build a todo list** with `todo_write`
4. **Write tests first** (TDD per phase)
5. **Implement** following the coding patterns
6. **Run the full test suite** — 3324 tests must pass
7. **Run the build** — `npm run build` must succeed
8. **Verify with the reviewer** — spec compliance, security, patterns
9. **Commit** with a descriptive message following the existing convention

### Coding Conventions
- **Files:** kebab-case (`storage-service.ts`)
- **Types/Classes:** PascalCase (`RecordingSession`)
- **Constants:** UPPER_SNAKE (`STORAGE_KEYS`)
- **CSS classes:** BEM-ish (`.status-indicator__dot--recording`)
- **TypeScript strict mode** — no `any` without justification
- **Enums** for finite states
- **Pure functions** for core logic
- **Typed contracts** at every boundary
- **Tests** for every public function

### Commit Message Convention
```
feat: <milestone> — <description> (<test count>)

<Optional body explaining what was implemented>
```

---

## Quick Reference

| What | Where |
|------|-------|
| Run tests | `npx vitest run` |
| Build | `npm run build` |
| Preview | `npx serve dist -l 5173` |
| All enums | `src/domain/enums.ts` |
| All shared types | `src/shared/types.ts` |
| Pattern definitions | `src/recorder/recognition/pattern-catalogue.ts` |
| Enrichment pipeline | `src/recorder/enrichment/enrichment-orchestrator.ts` |
| Semantic aggregator | `src/recorder/enrichment/semantic-aggregator.ts` |
| Generation engine | `src/generation/engine/generation-engine.ts` |
| Verb mappings | `src/generation/verb-mapping-table.ts` |
| Service worker | `src/background/service-worker.ts` |
| Feature flag | `ARCHITECTURE_C_ENABLED` in `chrome.storage.local` |
| Test count | 3324 tests across 124 files |
| Current version | 10.4.18 |

---

## Final Notes

- **The `.drytis/` directory contains the development blueprints, specs, and notes.** These are working documents, not final documentation. The `docs/handover/` directory is the permanent source of truth.
- **The `legacy/` directory contains archived old architecture code.** Do not modify it. It exists for reference only.
- **The `docs/TECHNICAL_ARCHITECTURE.md` is frozen at the V1 milestone.** It documents the semantic interaction engine, not the current architecture. Read it for V1 context, but refer to `docs/handover/` for current state.
- **There are 162 pre-existing TypeScript errors in legacy code.** These are all in `deterministic-recorder.ts` and related V1 files. New code has zero TS errors. Don't try to fix the legacy errors unless specifically asked.
- **The project follows TDD.** Tests are written before implementation. Every module has its own test file.
