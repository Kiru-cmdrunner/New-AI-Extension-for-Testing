# Phase 2 Engineering Specifications — Summary

**Milestone:** Phase 2 (Milestones 9-11)  
**Date:** 2026-07-17  
**Commit:** e56ca02  
**Spec:** `.drytis/specs/phase2-engineering-specifications.md` (1987 lines)

## Three Milestones Delivered

### Milestone 9 — Data Models & Interface Contracts
- **42 shared objects** catalogued across 6 layers (Recording, Context, Intelligence, Execution, Review, Infrastructure)
- Each object: purpose, sole-writer ownership, typed fields with validation, relationships, lifecycle (creation→persistence→expiration), serialization (JSON-only), versioning (additive only — no removal/rename/type-change), producer/consumer interface contracts
- Serialization strategy: all objects JSON-serializable, chrome.storage.local compatible
- Compatibility matrix: add field=OK, add union member=OK, remove/rename/type-change=FORBIDDEN

### Milestone 10 — Algorithms & Decision Logic
- **15 algorithms** fully specified:
  - 5-Gate event capture (deterministic, O(1) per gate)
  - Event filtering (static skip selectors per recorder)
  - Event normalization (sequential ID generation)
  - Session Context layer update (single-writer enforcement)
  - State tracking (MutationObserver, 100ms debounce)
  - AI observation (3-channel prompt, fire-and-forget, 10s timeout)
  - 3-tier semantic classification (14 priority rules, Tier 1→2→3)
  - Canonical step generation (10 templates + OR-1 readability merge)
  - Confidence calculation (5-track weighted, P5 bounds 0.05-0.95)
  - Execution JSON generation (B5.2 6 sections, verb mapping)
  - Locator resolution (B4.4 5-tier, 17 auto-gen ID patterns, max 3)
  - Playwright generation (2 static tables, zero AI)
  - MV3 SW restart recovery (session restore from storage)
  - Generation failure recovery (required vs optional)
  - Duplicate detection + incremental processing
- **AI vs Deterministic matrix:** AI NEVER makes a final decision. AI provides advisory input (Tier 2) consumed by deterministic logic. System always has deterministic fallback.

### Milestone 11 — Runtime Behaviour
- **3 state machines:** TC lifecycle (8 states: DRAFT→SAVED), Recording (3 states: READY→STOPPED), Generation (4 states: IDLE→COMPLETE/FAILED)
- **3 processing pipelines:** Recording (real-time per interaction, ~10ms), Generation (batch on Stop, sequential stages), Review (interactive, user-driven)
- **Concurrency model:** MV3 execution contexts, serialization rules, race condition prevention (ownership protocol, recording state check, SW restart detection)
- **Event ordering:** Sequential processing, monotonic IDs, navigation debounce (200ms)
- **Runtime guarantees:** Consistency (B3 immutable, single-writer, atomic batch), Reliability (AI non-blocking, SW restart recovery, generation auto-retry), Idempotency (generation, locator resolution, Playwright gen are idempotent)

## Cross-Phase Review

All 5 consistency checks PASS:
1. Data consistency: sole-writer for all objects, no mutations, JSON-serializable
2. Component interoperability: no circular deps, typed interfaces
3. Algorithm correctness: all cases have fallback (Gate 5, Rule 14, Tier 3)
4. Runtime consistency: no invalid transitions, race conditions prevented
5. Scalability: 500 events/session, < 5s generation, acceptable for current scale

## 4 Recommendations (Non-Architectural)
1. Add DATE_SELECT_CAPTURED to AppMessage union (type completeness)
2. Extract shared content script utilities (~200 lines ×6 duplication)
3. Add schemaVersion field to persisted objects (future migration path)
4. Freeze the Semantic Interaction → Execution Verb mapping table

## 10 Frozen Decisions (E1-E10)
E1: 42 objects sole-writer; E2: JSON additive versioning; E3: 5-Gate deterministic; E4: 3-tier classification; E5: AI advisory only; E6: generation deterministic; E7: TC state machine; E8: MV3 recovery; E9: ownership race prevention; E10: downward info flow.

All 15 prior frozen milestones preserved.
