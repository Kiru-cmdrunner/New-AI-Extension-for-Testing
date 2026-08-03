# UI Cutover — Switch Detected Interactions to Merged Output

## Goal
Switch the side panel's "Detected Interactions" section from V1 (`DETECTED_INTERACTIONS`)
to the merged output (`DETECTED_INTERACTIONS_MERGED`). Add engine badge and
action-oriented phrasing for semantic readability.

## Files to Change
1. `src/sidepanel/sidepanel.ts` — `loadDetectedInteractions()` reads MERGED key + cleanup
2. `src/sidepanel/timeline-renderer.ts` — add engine badge + action-oriented phrasing
3. `src/sidepanel/sidepanel.css` — add `.interaction-engine-badge` styles

## Acceptance Criteria
- [ ] `loadDetectedInteractions()` reads from `DETECTED_INTERACTIONS_MERGED`
- [ ] Each interaction card shows engine badge (V2 green, V1 amber)
- [ ] Interaction title uses action-oriented phrasing (Enter/Select/Click/Hover + name)
- [ ] Metadata values shown prominently (textValue, selectedValue, dateValue)
- [ ] Event Timeline section unchanged (still shows raw events)
- [ ] "Record Another" clears MERGED storage key
- [ ] Confidence badge shown when < 1.0 (existing behavior preserved)
- [ ] All existing tests pass
- [ ] New tests for action-oriented phrasing
