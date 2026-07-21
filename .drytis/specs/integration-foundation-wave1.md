# Integration Foundation + Wave 1: Click → Checkbox → RadioButton

## Overview

Wire the Evidence Engine into the live recording pipeline alongside the existing classifier.
Both run in parallel at recording stop. Outputs are stored separately for A/B comparison.
This phase adds NO user-visible changes — the side panel continues showing old classifier output.

## Scope

### Integration Foundation (infrastructure, no interaction type changes)

1. **DOM Context Enrichment** — add new fields to captured events:
   - `inputType` (input.type — currently missing, critical for FileUpload/DatePicker detection)
   - `ariaExpanded` (boolean | null)
   - `ariaPopup` (string | null — aria-haspopup value)
   - `isContentEditable` (boolean)

2. **Engine Integration in Service Worker** — at recording stop:
   - Run `detectInteractions()` (existing classifier) → store as `detected_interactions`
   - Run `detectInteractionsV2()` (evidence engine) → store as `detected_interactions_v2`
   - Compare outputs, log differences to console

3. **Dev-Only A/B Comparison** — no UI toggle, just:
   - Store both outputs in chrome.storage.local
   - Log a comparison summary to console (type mismatches, count differences)
   - Accessible via console or storage inspection during development

### Wave 1: Click → Checkbox → RadioButton

Migrate these three simple single-event types so the engine handles them correctly:
- Ensure engine output matches old classifier for these types
- No suppression rule changes yet — old rules stay in recorder
- Validate via A/B comparison on real recordings

## Files to Change

### Modified files:
- `src/recorder/recorded-event.ts` — add DomContext fields to ElementRecordedEvent
- `src/shared/types.ts` — add DomContext to RecordedEventMessage
- `src/recorder/deterministic-recorder.ts` — capture DOM context at event time
- `src/background/service-worker.ts` — run engine alongside classifier, A/B log
- `src/background/recording-session.ts` — persist V2 interactions
- `src/classifier/evidence/providers/dom-provider.ts` — consume new DomContext fields
- `src/classifier/evidence/providers/aria-provider.ts` — consume new DomContext fields

### New files:
- `src/classifier/evidence/ab-comparison.ts` — dev-only comparison utility

## Acceptance Criteria

### Foundation
- [ ] ElementRecordedEvent includes `domContext` with inputType, ariaExpanded, ariaPopup, isContentEditable
- [ ] deterministic-recorder.ts captures all 4 DomContext fields at event time
- [ ] Service worker runs detectInteractionsV2 at stop and stores output as detected_interactions_v2
- [ ] A/B comparison logs type/count differences to console (dev only)
- [ ] Existing recorder behavior unchanged — same events captured, same suppression rules active
- [ ] All 1978 existing tests still pass
- [ ] All 60 evidence engine tests still pass

### Wave 1 (Click → Checkbox → RadioButton)
- [ ] Engine classifies native checkbox clicks as Checkbox with confidence > 0.7
- [ ] Engine classifies native radio clicks as RadioButton with confidence > 0.7
- [ ] Engine classifies button/link/generic clicks as Click with confidence > 0.5
- [ ] A/B comparison shows zero mismatches for these three types on synthetic test events
- [ ] New tests for DomContext capture
- [ ] New tests for A/B comparison utility

## NOT in scope
- No changes to side panel UI
- No removal of suppression rules from recorder
- No removal of old classifier
- No new interaction type migrations (CustomDropdown, DatePicker, etc.)
- No content script engine integration (Phase 2)
