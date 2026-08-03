# Stage 3: New Classifier (Recognition)

## Goal
Replace the legacy V1/V2 classification pipeline (detectInteractions + detectInteractionsV2 + mergeV1V2)
with the new Control Model recognition pipeline when `recorderEngine === 'control'`.
The legacy classifier remains fully functional when `recorderEngine === 'legacy'` (default).
Downstream pipeline (pipeline-runner, IR bridge, Playwright generator, side panel, persistence) is unchanged.

## Scope
1. New classifier producing `DetectedInteraction[]` from `RecordedEvent[]`
2. Date picker support in control-recorder.ts (deferred from Stage 2)
3. Feature flag branch in handleStopRecording()

## Out of Scope
- Content script changes beyond date picker events
- Pipeline runner changes
- IR bridge changes
- Side panel changes
- Storage/persistence changes

## Interface Contract
The new classifier must produce `DetectedInteraction[]` identical in shape to the existing classifiers:
- `interactionId`: string (prefix "ctrl-" for control engine)
- `type`: valid InteractionType union member
- `eventIds`: string[] referencing actual RecordedEvent.eventId values
- `rawEventTypes`: string[] of source event types
- `target`: ElementIdentity from source events
- `metadata`: InteractionMetadata with correct fields per interaction type
- `confidence`: number 0.0–1.0
- `engine`: 'control'

## Files to Create

### src/recorder/v2/interaction-recognizer.ts (~450 lines)
New classifier: RecordedEvent[] → DetectedInteraction[]
- Event grouping (same-element events within 500ms windows, standalone navigation/dateSelect)
- Control-node-aware classification using ElementIdentity fields
- Ordered classification cascade:
  1. Navigation (standalone events)
  2. DatePicker (dateSelect events with DomContext)
  3. Scroll (scroll events, burst coalescing)
  4. Hover (mouseenter events)
  5. TextEntry (focus→input→change→blur sequences on text inputs)
  6. NativeDropdown (change on <select>)
  7. CustomDropdown (click on combobox + change)
  8. Checkbox (click with checked state transition)
  9. RadioButton (click on radio elements)
  10. Slider (change/drag on range inputs)
  11. FileUpload (change on file inputs)
  12. Click (generic clicks)
- Temporal dedup (2000ms per-type window)
- Metadata extraction per type

### tests/stage3-interaction-recognizer.test.ts (~500 lines)
Unit tests covering:
- OrangeHRM 9-step workflow recognition
- Text entry (focus→input→blur sequences)
- Native dropdown selection
- Custom dropdown (combobox click + option select)
- Checkbox toggle
- Radio button selection
- Date picker (native and custom)
- Scroll coalescing
- Navigation
- Click resolution
- Temporal dedup
- Feature flag integration

## Files to Modify

### src/background/service-worker.ts
handleStopRecording(): Add recorderEngine branch.
When 'control': call new recognizer instead of V1+V2+merge.
Store result in DETECTED_INTERACTIONS_MERGED so the side panel reads it.

### src/recorder/v2/control-recorder.ts
Add date picker event capture:
- Detect native date inputs (type=date/time/datetime-local/month/week)
- Detect calendar grid cell clicks
- Emit dateSelect events with DomContext (dateType, isoValue, displayValue, dateConfidence)
- Set ownedByDatePicker on calendar-internal events

## Acceptance Criteria
- [x] AC1: Feature flag defaults to 'legacy' — old V1/V2/merge classifier runs unchanged ✅
- [x] AC2: Setting flag to 'control' activates new recognizer ✅
- [x] AC3: TextEntry recognised from focus→input→blur sequences ✅
- [x] AC4: NativeDropdown recognised from <select> change events ✅
- [x] AC5: CustomDropdown recognised from combobox interactions ✅
- [x] AC6: Checkbox recognised with correct checked state ✅
- [x] AC7: RadioButton recognised ✅
- [x] AC8: DatePicker recognised from dateSelect events (native + custom + time + datetime) ✅
- [x] AC9: Scroll events coalesced (not one-per-scroll-tick) ✅
- [x] AC10: Navigation events produce PageNavigation interactions ✅
- [x] AC11: Generic clicks produce Click interactions ✅
- [x] AC12: Temporal dedup prevents duplicate same-type interactions ✅
- [x] AC13: All DetectedInteraction[].metadata fields match downstream expectations ✅
- [x] AC14: IR bridge accepts control-engine interactions (no crashes) ✅
- [x] AC15: Full regression suite passes (3,593/3,594 — 1 pre-existing JSDOM timing flake) ✅
- [x] AC16: Build succeeds ✅
- [x] AC17: Side panel displays control-engine interactions correctly ✅

## Post-Review Fixes Applied
- WARN FIXED: Slider value extraction dead-code bug — `?? ''` short-circuited ARIA fallback values. Restructured to proper nullish coalescing chain.
- WARN FIXED: dialogMessage/dialogResult type mismatch — added `?? undefined` coercion for null → undefined.
- WARN FIXED: Unused imports cleaned (ElementIdentity in control-recorder, DetectedInteraction in test file).
- WARN NOTED: CustomDropdown ariaExpanded check matches both true/false (collapsed combobox). Guarded by hasValueChange || hasClick requirement — acceptable for Stage 3.
