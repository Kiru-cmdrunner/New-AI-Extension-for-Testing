# Phase 2 — Semantic Interaction Architecture Recommendation

Saved at: `.drytis/specs/phase2-semantic-interaction-architecture.md`

## Key Architecture Decision

**Problem:** Interaction type classification at capture time in 6 independent content scripts creates O(n²) cross-recorder complexity. Each new type requires skip rules in ALL existing recorders. Real-world validation confirms recurring misclassifications (date→click, dropdown→click, icon mislabeling).

**Solution:** Three-layer separation:
1. **Evidence Collector** (ONE content script) — captures ALL browser events + DOM context, NO classification, NO skip rules, NO ownership
2. **Snapshot Coalescer** (service worker) — groups related events (mousedown+click+change) into one InteractionSnapshot with before/after value diffs, state changes, CSS class changes, DOM mutations, ancestor context
3. **Semantic Classifier** (service worker, deterministic pure function) — 14 ordered priority rules assign interaction type from snapshot evidence; AI is OPTIONAL enhancement input, not required

## Critical Design Decisions

- AI is optional: evidence-only rules produce correct results without AI. System degrades gracefully.
- Two-phase classification: Phase 1 (immediate, <5ms, evidence-only) → Timeline renders live; Phase 2 (async, AI refines) → updates Timeline if type changes
- InteractionSnapshot is the central data structure: carries identity + event evidence + value change + state change + CSS class change + DOM mutations + ancestor context + behavioral timing
- Classifier rules ordered by specificity: value-outcome (date) → ARIA roles → CSS class differential → click fallback
- Adding new interaction type = adding classifier rules to ONE file. No content script changes.

## Migration Strategy (6 phases)

- M1: Build classifier (pure function, unit tested, not wired)
- M2: Build coalescer (service worker module, not wired)
- M3: Build evidence collector (new content script, runs alongside existing, feature-flagged OFF)
- M4: Wire new pipeline (feature flag controls old vs new path)
- M5: AI integration refinement (prompt redesigned for snapshot input)
- M6: Remove old content scripts (after validation)

## Consistency Review: ALL PASS

Every frozen decision (B1-B8, C3-C6) is preserved. The architecture changes ONLY the recording layer (how events enter the Timeline). Everything downstream (Timeline shape, generation pipeline, artifact contracts, locator resolution, Playwright generation) is untouched.
