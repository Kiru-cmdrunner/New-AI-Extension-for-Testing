# Adani One Date Picker Duplication — Real Root Cause

## Date: 2026-07-29

## Problem
User reported date picker entries duplicated in the side panel (int-27/int-28, int-30/int-31).

## Initial (Wrong) Fix
Fixed `isDatePickerActivation()` in `src/classifier/semantic/detectors.ts` — removed DatePicker type from activation check. This was the WRONG layer. The Semantic Reasoner runs AFTER STOP on the V1/V2/merge pipeline, but the **side panel reads from `LIVE_INTERACTIONS_KEY` (Component Runtime output)**, NOT from the semantic pipeline (`DETECTED_INTERACTIONS_MERGED`). The Semantic Reasoner fix was correct as defense-in-depth but didn't address the user-visible duplication.

## Real Root Cause
Two interacting mechanisms in the Component Runtime + EventTap:

1. **Post-click value poll** (event-tap.ts): After a calendar cell click, the EventTap polls the date input's value at 50/150/400ms. When it changes, it emits a synthetic `change` event on the date input.

2. **Cross-element dedup failure** (component-runtime.ts): `isDuplicate()` compares `elementKey(ctx.trigger)`. Interaction #1's trigger = calendar cell, interaction #2's trigger = date input. Different elementKeys → dedup returns false before reaching dateValue comparison.

## Fix
1. **Cross-element DatePicker dedup** — added a path before the standard elementKey check that compares selectedDate/dateValue + day-number extraction when two DatePicker interactions within the dedup window have different triggers (cell vs input).
2. **stopRecording double-push** — `flush()` emits via onEmit (which pushes to liveInteractions), then `stopRecording` pushed the return value again. Removed duplicate push.

## Key Architectural Insight
**The side panel displays Component Runtime output, not the V1/V2/semantic pipeline output.** This is critical for debugging any user-visible issue:
- `LIVE_INTERACTIONS_KEY` = Component Runtime → what the user SEES
- `DETECTED_INTERACTIONS_MERGED` = V1/V2/merge/semantic → feeds IR plan generation
- Both are populated on STOP, but they run on different data (ComponentInteractions vs RecordedEvents)

## Files Changed
- `src/runtime/component-runtime.ts` — cross-element DatePicker dedup
- `src/runtime/sw-integration.ts` — stopRecording double-push fix
- `src/classifier/semantic/detectors.ts` — retained from earlier (defense-in-depth)
