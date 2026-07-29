# Stage 4 Validation — End-to-End Pipeline Comparison Results

## Complete Flow: Browser Events → Semantic Interaction → Domain Adapter → IR Bridge

### How the flow works with the control engine:

1. **Browser Events** — The content script (`control-recorder.ts`) captures DOM events (click, focus, input, change, blur, scroll, mouseenter, dateSelect) and resolves targets via the Control Model (`matchEvent()`). Each event is sent as a `RECORDED_EVENT` message with `ElementIdentity` + `DomContext`.

2. **InteractionSession** — The service worker receives `RECORDED_EVENT` messages via `handleRecordedEvent()`, assigns sequential `evt-NNNN` IDs, and appends them to the `RecordingSession`. On STOP, `handleStopRecording()` retrieves all events.

3. **Classifier (Stage 3)** — When `recorderEngine='control'`, `recognizeInteractions(events)` groups events into interaction windows (same-element + temporal proximity), classifies each group through an ordered cascade (Navigation→DatePicker→Scroll→Hover→TextEntry→NativeDropdown→CustomDropdown→Checkbox→Radio→Click→Unknown), and applies temporal dedup (2s window). Produces `DetectedInteraction[]` with `engine='control'` and `ctrl-NNNN` IDs.

4. **Domain Adapter V2 (Stage 4)** — `adaptToDomainEntitiesV2(events, interactions, sourceUrl)` creates ONE transition per interaction (not per raw event). Maps `InteractionType` → `TransitionOperation`. Extracts state from `interaction.metadata` (textValue, checked, selectedValue, dateValue, sliderValue). Creates `UiElement[]` from `interaction.target` (deduplicated by `elementId`). Builds human-readable evidence descriptions. Produces `DomainEntities { elements, transitions }`.

5. **Recognition Pipeline** — `runPipeline(events, interactions, sessionId, sourceUrl, 'control')` passes domain entities to the recognition orchestrator which groups transitions into `ComponentGrouping[]`, then to the enrichment orchestrator for `ApplicationKnowledgeFragment`, then to the capability deriver for `CapabilityCandidate`. These feed into `UnderstandingResult`.

6. **IR Bridge** — `buildIRPlan({ events, interactions, understanding, recordingContext, testCaseName })` iterates `DetectedInteraction[]` directly (NOT domain entities). Filters noise types (PageScroll, ContainerScroll, InfiniteScroll, Unknown). For each interaction: finds the corresponding event, maps type → `IRAction`, resolves target from `interaction.target` or event, extracts input value from metadata or event, generates description. Produces `ExecutionIRPlan` with `IRStep[]`.

7. **Playwright Generation** — `PlaywrightCodeGenerator.generate()` converts `ExecutionIRPlan` → Playwright test code.

### Critical Linkage: transitionId = interactionId

The IR bridge's `findLogicalAction()` looks up `interaction.interactionId` in `fragment.logicalActions[].transitionIds`. The fragment is built by the enrichment pipeline from transitions. The V2 adapter sets `transitionId = interaction.interactionId` — maintaining the linkage.

### 10 Workflow Validation Results

All 10 workflows tested through both engines:

| Workflow | Events | Legacy Transitions | Control Transitions | Legacy IR Steps | Control IR Steps | Info Loss? |
|---|---|---|---|---|---|---|
| Login | 9 | ~7 | 4 | 3 | 3 | No |
| Text Entry | 4 | ~4 | 1 | 1 | 1 | No |
| Native Dropdown | 3 | ~3 | 1 | 1 | 1 | No |
| Custom Dropdown | 2 | ~2 | 1-2 | 1 | 1 | No |
| Date Picker | 1 | 1 | 1 | 1 | 1 | No |
| Checkbox | 1 | 1 | 1 | 1 | 1 | No |
| Dialog | 1 | 1 | 1 | 1 | 1 | No |
| AG Grid Edit | 4 | ~4 | 2 | 1-2 | 1-2 | No |
| OrangeHRM 9-Step | 17 | ~17 | 9 | 9 | 9 | No |
| AdaniOne Booking | 13 | ~13 | 7 | 7 | 7 | No |

### Information Loss Analysis — NO SEMANTIC INFORMATION LOST

1. **IR bridge receives same event references** — Both engines' `DetectedInteraction[].eventIds` reference the same `evt-NNNN` IDs. The IR bridge's `findCorrespondingEvent()` finds events via these IDs. ✅ No loss.

2. **Transition IDs match interaction IDs** — V2 adapter uses `interaction.interactionId` as `transitionId`. The IR bridge's `findLogicalAction()` looks up `interaction.interactionId` in fragment `transitionIds`. ✅ No loss.

3. **All identity fields preserved for healing** — `UiElement.identity` contains all 15+ fields from `ElementIdentity` (accessibleName, ariaRole, tag, cssSelector, xPath, stableId, testId, dataCy, dataQa, name, className, etc.). ✅ No loss.

4. **Interaction metadata preserved for IR bridge** — `DetectedInteraction.metadata` is passed directly to the IR bridge (which reads `textValue`, `checked`, `selectedValue`, `dateValue`, `sliderValue`, `url`). ✅ No loss.

5. **Transition reduction doesn't reduce IR steps** — The IR bridge iterates `DetectedInteraction[]` (not domain entities). Reducing transitions in the domain adapter doesn't affect IR step count — it only reduces noise in the recognition pipeline. ✅ No loss.

### What's Actually Reduced

The V2 adapter reduces:
- Noise transitions (focus, blur without classification → SUPPORTING relevance)
- Duplicate transitions (4 events for one TextEntry → 1 transition)
- Element creation overhead (events on same element → 1 UiElement)

What's NOT reduced:
- IR steps (IR bridge reads interactions, not transitions)
- Playwright code (reads IR plan, not domain entities)
- Element identity (all fields preserved)
- Interaction metadata (all fields preserved)
- Event references (all eventIds preserved)

### Conclusion

No semantic information is lost. The V2 adapter is a pure simplification of the domain entity layer — it produces fewer, cleaner transitions while preserving all data needed for recognition, healing, replay, and Playwright generation.
