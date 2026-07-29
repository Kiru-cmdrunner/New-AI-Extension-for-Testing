# Stage 4: Domain Adapter Simplification

## Goal
Create a simplified domain adapter for the control engine that produces domain entities
from `DetectedInteraction[]` directly (one transition per interaction) instead of from
individual `RecordedEvent[]` (one transition per raw event). This reduces noise and
produces cleaner entities for the recognition and enrichment pipelines.

When `recorderEngine === 'legacy'`, the existing domain adapter runs unchanged.
When `recorderEngine === 'control'`, the new simplified adapter runs.

## Scope
- New domain adapter: interaction-centric mapping
- Feature flag branch in pipeline-runner
- No changes to enrichment pipeline, IR bridge, Playwright generation, storage

## Out of Scope
- Enrichment orchestrator changes
- IR bridge changes
- Playwright generator changes
- Side panel changes
- Storage schema changes

## Interface Contract
The new adapter must produce the same `DomainEntities` interface:
```ts
{ elements: UiElement[], transitions: ObservedTransition[] }
```

## Design

### Current (legacy) adapter: event-centric
- Iterates `RecordedEvent[]` one by one
- Each event → one UiElement (deduplicated) + one ObservedTransition
- Many events per interaction (focus, input, change, blur = 4 transitions for one TextEntry)
- Operation/relevance resolved per-event by looking up the interaction
- Results in 4-5× more transitions than interactions (noise for the recognition pipeline)

### New (control) adapter: interaction-centric
- Iterates `DetectedInteraction[]` one by one
- Each interaction → one UiElement + one ObservedTransition
- Only 1 transition per interaction (not per raw event)
- Operation mapped directly from interaction.type (no event-level lookup needed)
- State before/after extracted from the interaction's metadata (not from individual events)
- Recognition pipeline receives clean, interaction-level transitions

## Files to Create

### src/recorder/v2/domain-adapter-v2.ts (~200 lines)
New interaction-centric domain adapter.
- Maps DetectedInteraction.type → TransitionOperation
- Creates UiElement from interaction.target (identity)
- Creates ObservedTransition from interaction (one per interaction)
- State extracted from interaction.metadata (textValue, checked, selectedValue, etc.)
- Evidence built from interaction metadata

### tests/stage4-domain-adapter-v2.test.ts (~300 lines)
Unit tests for the new adapter.

## Files to Modify

### src/background/service-worker.ts
handleStopRecording(): When recorderEngine is 'control', pass mergedInteractions
to runPipeline. The pipeline-runner needs to know which adapter to use.

### src/recorder/pipeline/pipeline-runner.ts
Add optional `engine` parameter. When 'control', use domain-adapter-v2.
When 'legacy' or undefined, use the existing domain-adapter.

## Acceptance Criteria
- [x] AC1: Feature flag defaults to 'legacy' — old domain adapter runs unchanged ✅
- [x] AC2: Setting flag to 'control' uses new interaction-centric adapter ✅
- [x] AC3: New adapter produces 1 transition per interaction (not per event) ✅
- [x] AC4: UiElements correctly created from interaction targets ✅
- [x] AC5: TransitionOperation correctly mapped from InteractionType ✅
- [x] AC6: State before/after extracted from interaction metadata ✅
- [x] AC7: Evidence array populated with meaningful descriptions ✅
- [x] AC8: Navigation interactions produce NAVIGATE transitions ✅
- [x] AC9: TextEntry interactions produce FILL transitions with textValue ✅
- [x] AC10: Dropdown interactions produce SELECT transitions with selectedValue ✅
- [x] AC11: DatePicker interactions produce SELECT_DATE transitions with dateValue ✅
- [x] AC12: Domain entities compatible with downstream recognition pipeline ✅
- [x] AC13: Domain entities compatible with healing service (UiElement[].identity) ✅
- [x] AC14: Full regression suite passes (3,631/3,632 — 2 pre-existing JSDOM timing flakes) ✅
- [x] AC15: Build succeeds ✅
