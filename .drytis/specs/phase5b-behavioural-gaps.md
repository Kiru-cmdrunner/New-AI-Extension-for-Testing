# Phase 5b — Behavioural Gap Closure

## Objective
Close interaction quality gaps identified by comparing our Phase 1–5 pipeline
against the v10.9.0 reference implementation (commit 9976ff8). All changes
are additive — no existing behaviour is removed.

## Files to Change

### Phase 2b — Channel B Enhancement
- `src/pipeline/channels/channel-b-dom-structure.ts` — add ancestorClasses signal

### Phase 5b — Recognition + Lifecycle Improvements
- `src/pipeline/channels/channel-b-dom-structure.ts` — captureAncestorChain + ancestorClasses
- `src/pipeline/recognition/pattern-evaluator.ts` — augmentFromBatchFields: expose ancestorClasses
- `src/pipeline/recognition/patterns/click-patterns.ts` — add interactive element filter to GENERIC_CLICK
- `src/pipeline/recognition/pattern-registry.ts` — add priority-based ordering
- `src/pipeline/recognition/patterns/index.ts` — export priority-sorted patterns
- `src/pipeline/lifecycle/lifecycle-definitions.ts` — add SCROLL_LIFECYCLE, update DATE_PICKER_LIFECYCLE
- `src/pipeline/lifecycle/lifecycle-engine.ts` — support multi-mode commit, nav button rejection
- `src/pipeline/lifecycle/semantic-action-builder.ts` — add dropdown no-op detection
- `src/pipeline/recognition/event-grouper.ts` — add per-type temporal dedup
- `src/pipeline/types/foundation.ts` — add `ancestorClasses` to SignalType if needed

## Acceptance Criteria

### AC-1: Ancestor CSS class extraction
- [ ] `captureAncestorChain` extracts CSS classes alongside tag + role
- [ ] Channel B emits `signalType: 'ancestorClasses'` evidence record
- [ ] Framework wrapper classes (oxd-checkbox, MuiSelect, etc.) are captured

### AC-2: Scroll burst coalescing
- [ ] SCROLL_LIFECYCLE definition exists with 500ms burst gap
- [ ] Multiple scroll events within 500ms coalesce into one lifecycle
- [ ] Any non-scroll event finalizes the scroll gesture
- [ ] Zero-delta scroll is filtered (no test step)

### AC-3: Date picker multi-mode completion
- [ ] DATE_PICKER_LIFECYCLE supports calendar cell click (existing)
- [ ] DATE_PICKER_LIFECYCLE supports blur with typed value (new)
- [ ] DATE_PICKER_LIFECYCLE supports native input change (new)
- [ ] Navigation buttons (prev/next/switch/today/chevron) are lifecycle-internal

### AC-4: Dropdown no-op detection
- [ ] If selected value === trigger display value, SemanticAction is suppressed
- [ ] `normalizeDisplayValue` strips dashes/colons/whitespace for comparison

### AC-5: Per-type temporal dedup
- [ ] Same event type + same element within 2000ms is suppressed
- [ ] Checkbox/radio same-name cross-element within 2s is suppressed
- [ ] Scroll events are exempt (burst coalescing handles them)

### AC-6: Interactive element filter
- [ ] GENERIC_CLICK pattern rejects bare divs/spans without interactive signals
- [ ] Elements with ARIA roles, interactive tags, tabIndex≥0, or interactive classes pass
- [ ] Clickable heuristic (cursor:pointer) still works

### AC-7: Priority-based pattern discovery
- [ ] Patterns have a `priority` field (higher = tried first)
- [ ] Click pattern has lowest priority (fallback)
- [ ] Pattern registry returns patterns sorted by priority

## Test Requirements
- Unit tests for each acceptance criterion
- Existing 3360 tests still pass
- TypeCheck at 344 baseline (0 new errors)
- Build succeeds
