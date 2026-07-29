# Stage 5: Semantic Reasoning Engine — Component-Aware Interaction Recognition

## Vision

The recorder currently classifies browser events into interactions as they arrive,
without understanding the user's intent. The Semantic Reasoning Engine transforms
the raw `DetectedInteraction[]` + `RecordedEvent[]` stream into a sequence of
semantic actions that represent **what the user accomplished**, not which browser
events fired.

## Architecture

### Insertion Point

```
mergeV1V2() → DetectedInteraction[]
    ↓
[NEW: SemanticReasoner]
  Input:  DetectedInteraction[] + RecordedEvent[]
  Output: SemanticInteraction[]
    ↓
buildIRPlan({ interactions: semanticInteractions })
```

### Component Session Model

A **ComponentSession** represents a user's interaction with a composite UI component.
It has a lifecycle:

1. **Activate** — a trigger event opens the component (dropdown opens, calendar appears)
2. **Sustain** — events arrive while the component is open (scrolls, internal clicks, typing)
3. **Complete** — a completion event arrives (option selected, date chosen, panel closed)
4. **Cancel** — the user dismisses without completing (Escape, outside click, navigation away)

While a session is active, all events and interactions it absorbs are held. When
the session completes, a single `SemanticInteraction` is emitted with the full
semantic context (selected value, configured fields, etc.).

### Supported Component Types

| Type | Activate Signal | Completion Signal | Value Source |
|------|----------------|-------------------|--------------|
| **Dropdown** | Click on combobox/select trigger | Click on option element | Option's accessibleName or change event valueAfter |
| **DatePicker** | Click on date trigger input | dateSelect event or calendar cell click + blur | isoValue or cell aria-label |
| **Autocomplete** | Focus on typeahead/autocomplete input | Click on suggestion option | Suggestion's accessibleName or valueAfter |
| **Navigation** | Click on submit/link button | Navigation event within 2s | Navigation URL |
| **MultiConfig** | Click opening a multi-field panel | Click on "Done"/"Apply" button or panel close | Dictionary of field→value pairs |

### Noise Filtering

Events inside an active component session that are **not** the completion signal
are absorbed and suppressed:
- Scrolls inside dropdowns
- Month navigation clicks in calendars
- Hover events inside popovers
- Internal clicks that don't select an option

### Canonical Semantic Types

From `semantic-interaction-language-validation.md` (10-type canonical language):

| Type | Example |
|------|---------|
| navigate | Navigate to https://example.com/dashboard |
| click | Click "Save" |
| fill | Fill "John" in "First Name" |
| select | Select "Belgian" for "Nationality" |
| selectDate | Select date "2005-10-27" |
| toggle | Toggle "Smoker" (checked) |
| scroll | Scroll page |
| hover | Hover over "Help" |
| drag | Drag "item.png" to "upload-zone" |
| configure | Configure Flight Options: Cabin Class = Premium Economy, Adults = 2 |

## Files

### New: `src/classifier/semantic/`
- `types.ts` — SemanticInteraction, ComponentSession, SemanticType
- `detectors.ts` — Activation/completion/cancellation detection per component type
- `reasoner.ts` — SemanticReasoner (stream processor)
- `descriptions.ts` — Human-readable description builders
- `index.ts` — Exports + `reasonAboutInteractions()`

### Modified
- `src/background/service-worker.ts` — Insert SemanticReasoner between merge and IR bridge

## Acceptance Criteria

### Dropdown
- [ ] Click trigger + scroll + click option → ONE `select` with selected value
- [ ] No standalone `click` emitted for the trigger
- [ ] No `scroll` emitted for internal dropdown scrolling
- [ ] If user dismisses without selecting, trigger click passes through

### Date Picker
- [ ] Click trigger + calendar navigation + cell click → ONE `selectDate` with date value
- [ ] No internal calendar clicks emitted separately
- [ ] Typed date + blur → ONE `selectDate`

### Navigation
- [ ] Submit click + navigation → ONE `navigate` with URL
- [ ] Non-navigating click (no navigation within 2s) → regular `click`

### Autocomplete
- [ ] Focus + type + click suggestion → ONE `select` with value
- [ ] Focus + type + blur without selection → `fill` with typed value

### Checkbox / Radio
- [ ] Pass through with value and label enrichment

### Text Entry
- [ ] Pass through with value enrichment from correlated events

### Multi-Config Panel
- [ ] Multiple interactions inside a panel → ONE `configure` with field=value pairs
- [ ] Panel's "Done"/"Apply" click absorbed (not emitted separately)

### General
- [ ] Non-component interactions pass through unchanged
- [ ] Stale sessions (15s) are committed as-is
- [ ] End-of-stream flush commits all remaining sessions
- [ ] All existing tests pass
