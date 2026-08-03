# Milestone C3.2 — Hover Recording Foundation

**Type:** Implementation
**Status:** IN PROGRESS
**Date:** 2026-07-15
**Depends on:** C3.1 (PERMANENTLY FROZEN), Milestone 2 (Click Architecture, FROZEN), B1–B8

---

## Objective

Implement the Hover recorder per the permanently frozen C3.1 Hover Recording Product Strategy. Implementation milestone only — no product redesign, no frozen decision modifications.

## Scope

**In scope:**
- `src/recorder/hover-content-script.ts` (new) — the complete Hover recorder
- `src/shared/types.ts` (modified) — add HoverEvent type, HOVER_CAPTURED message
- `src/recorder/interaction-types.ts` (modified) — register hover interaction type
- `src/background/service-worker.ts` (modified) — add HOVER_CAPTURED handler
- `src/generation/generators/execution-json-generator.ts` (modified) — map hover action type
- `src/manifest.json` (modified) — register hover-content-script.ts
- `tests/hover-content-script.test.ts` (new) — unit tests

**Out of scope (C3.1 explicitly defers these):**
- Canonical Test Step generation changes (existing pipeline handles new types generically)
- Readability Optimizer changes (no rule applies to hover per C3.1 §4.5)
- Playwright generation changes (hover case already exists per B6)
- Generation Engine changes (existing pipeline handles new types generically)
- Validation Framework changes

## Implementation Plan

### Phase 1 — Hover Detection (6-gate decision tree, Gates 1–4)

Gate 1: Genuine event (`event.isTrusted`)
Gate 2: Not owned by another interaction (`data-cmdrunner-handled` check)
Gate 3: Hover-responsive target (has `onmouseenter`/`onmouseover` handler, or `:hover` CSS rule changing display/visibility/opacity, or ARIA disclosure attributes like `aria-haspopup`)
Gate 4: Intentional pause (dwell ≥ DWELL_THRESHOLD=500ms via `mouseenter`/`mouseleave` timer)

### Phase 2 — Hover Qualification (Gates 5–6)

Gate 5: Observable application behavior (MutationObserver detects childList additions/removals or attribute changes to display/visibility/opacity — cosmetic changes excluded)
Gate 6: Follow-up interaction confidence boost (optional — hover still recorded at medium confidence without it)

### Cosmetic Exclusion

Cosmetic CSS properties that do NOT qualify as observable behavior:
- `background-color`, `background`, `background-image`
- `color`, `border-color`, `border`, `outline`
- `cursor`
- `text-decoration`, `text-shadow`
- `box-shadow`, `filter`
- `transform` (visual repositioning is cosmetic)

Non-cosmetic (qualifies as observable behavior):
- `display` (none → block/inline/etc.)
- `visibility` (hidden → visible)
- `opacity` (0 → >0 — element becoming interactable)
- Child elements added/removed (DOM mutation)

### Integration Points

1. Content script sends `HOVER_CAPTURED` message with element identity
2. Service worker routes to `processAction(identity, 'hover', tabId)`
3. `processAction` calls `getInteractionType('hover').addToSession(session, identity, {})`
4. `addToSession` delegates to `session.addAction(rawIdentity, 'hover', 'hover')`
5. Canonical Step Generator reads the event, calls registry `toPlainEnglish()` → "Hover over \"[name]\""
6. Execution JSON Generator maps `hover` → `hover` action type
7. Playwright Generator already has `hover` case → `.hover()` statement

### Recording Flow

```
User mouseenter on element
  → Gate 1: isTrusted? NO → discard
  → Gate 2: data-cmdrunner-handled? YES → discard
  → Gate 3: hover-responsive? NO → discard
  → Start dwell timer (500ms)
  → Attach MutationObserver (observe childList + attributes)
  → User mouseleave before threshold? → cancel timer + disconnect observer → discard

After dwell threshold met:
  → Gate 4: dwelled ≥ 500ms? YES → proceed
  → Gate 5: MutationObserver saw non-cosmetic change? NO → discard
  → Gate 5 passes → disconnect observer, extract identity, send HOVER_CAPTURED
```

## Acceptance Criteria

- [ ] hover-content-script.ts implements all 6 gates of the C3.1 decision tree
- [ ] DWELL_THRESHOLD = 500ms (implementation detail, not user-configurable)
- [ ] MutationObserver attached only after dwell threshold (performance per C3.1 R1)
- [ ] Cosmetic changes (background-color, cursor, text-decoration) do NOT qualify as observable behavior
- [ ] `mouseenter`/`mouseleave` used (not mouseover/mouseout — per C3.1 §3.5)
- [ ] Hover does NOT set `data-cmdrunner-handled` (transient, per C3.1 §6.2)
- [ ] HOVER_CAPTURED message type added to types.ts
- [ ] hover interaction type registered in interaction-types.ts
- [ ] service-worker.ts handles HOVER_CAPTURED
- [ ] execution-json-generator maps hover → hover action type
- [ ] hover-content-script.ts registered in manifest.json content_scripts
- [ ] Identity extraction reuses the same pattern as click-content-script.ts
- [ ] Recording state uses async checkRecording() fallback (same pattern as click/text)
- [ ] No regressions: existing click, text, navigation recording unchanged
- [ ] All existing tests pass
- [ ] New hover unit tests pass

## Regression Validation

Run existing 480-test suite. All must pass unchanged.
