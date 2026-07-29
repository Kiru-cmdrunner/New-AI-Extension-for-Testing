# Phase 4: Recognition Pipeline

## Summary

Implement the recognition pipeline that consumes EvidenceBatches (from Phase 3's
EventTap) and produces RecognitionResults (RecognisedInteraction | UnrecognisedInteraction).

The recognition pipeline has three stages:
1. **Event Grouper** — merges related EvidenceBatches into interaction candidates
2. **Pattern Matcher** — evaluates declarative PatternDefinitions against each candidate
3. **Confidence Gate** — accepts matches above threshold, defers others to UnrecognisedInteraction

These modules are NOT yet wired into the content script or service worker. They
coexist alongside the existing classifier. The existing recorder continues to
function exactly as today.

## Design Decisions

### 1. Event Grouper (not "Event Grouping" — distinct from integration's V1)
The grouper merges EvidenceBatches that belong to the same user interaction. For
example: focus → input → input → blur on the same text field = one TextEntry
interaction. A click on a dropdown trigger + click on an option = one Select.

**Grouping rules** (synthesized from all three references):
- **Same-element grouping**: Batches with the same primary locator on events
  within 500ms (standard) or 30s (text-entry, dropdown) form one candidate.
- **Cross-element grouping**: Dropdown trigger → option, DatePicker trigger →
  calendar cell. Related through ARIA semantics (combobox→option, dialog→gridcell).
- **Standalone events**: scroll, navigation, contextmenu, dblclick are never grouped.
- **Two clicks on the same element** = two separate interactions (same as integration).

### 2. Declarative Pattern Definitions (not procedural if/else)
Patterns are data objects implementing Phase 1's `PatternDefinition` interface.
The pattern matcher is a **generic engine** that evaluates conditions against
evidence — it contains NO interaction-specific logic. Adding a new interaction
type = adding a new pattern definition, not changing the matcher.

This is the key architectural improvement over both references:
- **vs integration**: replaces 807-line if/else cascade + 5 evidence providers
- **vs working-better**: replaces 10 procedural ComponentDefinition files

### 3. Recognition is single-tier (not two-tier like integration)
We merge structural and behavioural recognition into ONE pattern-matching pass.
A pattern can have conditions that check ARIA roles (structural) AND conditions
that check value transitions (behavioural). This eliminates the two-tier
complexity and the merge/identity-resolution overhead.

This aligns with working-better's single-pass model but uses declarative
patterns instead of procedural definitions.

### 4. Pattern evaluation: weighted conditions
Each condition has a `weight` (from Phase 1 PatternCondition). The pattern's
overall confidence = weighted average of matched condition confidences.
A pattern matches if ALL conditions are satisfied AND confidence ≥ threshold.

### 5. Confidence thresholds
- Immediate/single-event patterns (click, toggle, selectOption): threshold 0.7
- Multi-event patterns (fill, select, selectDate): threshold 0.6
- Hover: threshold 0.5 (accumulated evidence, lower certainty)
- Scroll: threshold 0.4 (very simple signal)

## Pattern Catalogue (15 patterns)

### Immediate Patterns (single-event)
| ID | Verb | ComponentType | Key Conditions |
|----|------|---------------|----------------|
| checkbox-toggle-v1 | toggle | Checkbox | tag/role=checkbox, click event, checkedTransition exists |
| radio-select-v1 | selectOption | RadioButton | tag/role=radio, click event |
| link-click-v1 | click | Link | tag=A or role=link, click event |
| button-click-v1 | click | Button | tag=BUTTON or role=button, click event |
| generic-click-v1 | click | Generic | any interactive element, click event (fallback) |
| navigation-v1 | navigate | NavigationBar | navigation event |

### Multi-Event Patterns (require grouping)
| ID | Verb | ComponentType | Key Conditions |
|----|------|---------------|----------------|
| text-entry-v1 | fill | TextInput/TextArea | focus→input→blur, valueTransition exists |
| dropdown-select-v1 | select | DropDownListbox | combobox/select trigger + option click, valueTransition |
| date-picker-v1 | selectDate | DatePicker | date input + calendar cell click, date value |
| slider-drag-v1 | selectOption | Slider | role=slider, value change |

### Gestural/Behavioural Patterns
| ID | Verb | ComponentType | Key Conditions |
|----|------|---------------|----------------|
| scroll-v1 | scroll | Generic | scroll event, non-zero delta |
| hover-v1 | hover | Tooltip/MenuItem | mouseenter, aria-expanded change OR dwell≥3s |

## Files to Create

### Source Files
1. `src/pipeline/recognition/event-grouper.ts` — merges EvidenceBatches into InteractionCandidates
2. `src/pipeline/recognition/pattern-evaluator.ts` — generic condition evaluator
3. `src/pipeline/recognition/pattern-registry.ts` — pattern catalogue + registry
4. `src/pipeline/recognition/patterns/` — directory with pattern definition files:
   - `click-patterns.ts` (checkbox, radio, link, button, generic)
   - `text-entry-pattern.ts`
   - `dropdown-pattern.ts`
   - `date-picker-pattern.ts`
   - `scroll-pattern.ts`
   - `hover-pattern.ts`
   - `navigation-pattern.ts`
   - `slider-pattern.ts`
   - `index.ts` (aggregates all patterns)
5. `src/pipeline/recognition/recognition-pipeline.ts` — orchestrator
6. `src/pipeline/recognition/index.ts` — barrel export

### Test Files
- `tests/unit/pipeline/recognition/event-grouper.test.ts`
- `tests/unit/pipeline/recognition/pattern-evaluator.test.ts`
- `tests/unit/pipeline/recognition/pattern-registry.test.ts`
- `tests/unit/pipeline/recognition/recognition-pipeline.test.ts`
- `tests/unit/pipeline/recognition/patterns.test.ts` (pattern definition correctness)

## Acceptance Criteria

- [ ] Event grouper merges same-element batches within time windows
- [ ] Event grouper handles cross-element grouping (dropdown trigger→option)
- [ ] Event grouper treats scroll/navigation/contextmenu as standalone
- [ ] Event grouper never merges two clicks on the same element
- [ ] Pattern evaluator implements all 9 PatternOperators correctly
- [ ] Pattern evaluator computes weighted confidence from condition weights
- [ ] Pattern registry contains 12+ patterns covering all InteractionVerbs
- [ ] Recognition pipeline produces RecognisedInteraction for matching evidence
- [ ] Recognition pipeline produces UnrecognisedInteraction for non-matching evidence
- [ ] Recognition pipeline includes evidenceTrace and closestMatch diagnostics
- [ ] Recognition pipeline produces RecognitionOutput with correct counts
- [ ] All modules are standalone (no content script or SW dependency)
- [ ] Existing deterministic-recorder.ts is NOT modified
- [ ] Full test suite passes with 0 new failures
- [ ] TypeCheck: 0 new errors
- [ ] Build succeeds
