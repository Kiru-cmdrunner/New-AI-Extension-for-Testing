# Component Technical Specifications — Summary

**Milestone:** Component Technical Specifications  
**Date:** 2026-07-17  
**Commit:** 081e03e  
**Spec:** `.drytis/specs/milestone-component-technical-specs.md` (4010 lines)

## Scope

Complete implementation-ready technical specifications for all 26 core architectural components across 6 layers.

## Component Inventory

| Layer | Components | Key Specs |
|-------|-----------|-----------|
| Recording (5) | Browser Event Collector, DOM Snapshot Manager, Screenshot Manager, Recorder, Event Pipeline | 5-Gate decision process, ownership protocol, MV3-safe message transport, B3 immutable Timeline |
| Context (3) | Session Context Manager, State Tracker, Mental Model Manager | 3-layer structure (L1 Deterministic, L2 Mental Model, L3 Action History), single-writer-per-layer, MutationObserver-based state tracking |
| Intelligence (5) | AI Observer, Stage 3a Classifier, Stage 3b Step Generator, Confidence Engine, Workflow Analyzer | Per-interaction AI cadence, 3-tier classification (deterministic→advisory→default), 10-type taxonomy mapping, 5-track confidence, workflow pattern detection |
| Execution (5) | Generation Engine, Execution JSON Generator, Locator Resolution Engine, Playwright Generator, Engine Adapter | B2 sole orchestrator, B5.2 6-section contract, B4.4 5-tier locator priority, deterministic code gen, multi-engine routing |
| Review (4) | Review Engine, Validation Engine, Evidence Manager, Approval Manager | Human review workflow, B5.2 validation, evidence presentation, TC lifecycle (UNDER_REVIEW→APPROVED→SAVED) |
| Infrastructure (4) | Storage Manager, Configuration Manager, Logging Manager, Audit Manager | chrome.storage.local abstraction, AI config, structured logging, append-only audit trail |

## Cross-Component Findings

- **Coupling: LOW** — clean layered boundaries, upward-only dependencies
- **Cohesion: HIGH** — each component has focused single responsibility
- **Circular dependencies: NONE** — strict downward data flow
- **Write collisions: NONE** — every data structure has exactly one writer
- **AI failure blast radius: ZERO** — non-blocking, advisory only
- **Storage failure blast radius: CRITICAL** — largest impact

## 4 Implementation Improvements (Non-Architectural)

1. Unify content script shared utilities (~200 lines duplicated ×6)
2. Formalize Recorder → Stage 3a canonical type mapping table
3. Add DATE_SELECT_CAPTURED to AppMessage union (type completeness)
4. Document Evidence Store lifecycle (transient, screenshots-only persist)

## 10 Frozen Decisions (TS1-TS10)

TS1: 26 components / 6 layers; TS2: upward-only deps; TS3: single-writer; TS4: no circular deps; TS5: AI zero blast radius; TS6: stateless where possible; TS7: typed interfaces; TS8: Transient→Permanent at Stop; TS9: shared Infrastructure; TS10: 4 improvements recommended.

All 14 prior frozen milestones preserved.
