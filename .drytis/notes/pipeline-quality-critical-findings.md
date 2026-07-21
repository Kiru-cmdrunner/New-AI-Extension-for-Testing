# Pipeline Quality Validation — Critical Findings (2026-07-18)

## Test Results
- 35 interactions tested through the FULL pipeline (observer → boundary → state diff → pattern → assembler → intent → SessionEvent)
- **6/35 ACCURATE (17%)**, 22 PARTIAL (63%), 7 INACCURATE (20%), 0 NOT RECORDED

## 5 Root Causes Found

### RC-1: Previous Interaction's Blur Contaminates Next Unit (CRITICAL)
The boundary detector includes the blur event from the PREVIOUS interaction as the first event in the CURRENT interaction's unit. The assembler then uses the FIRST event's element as the target.

Evidence: "Hyperlink click" recorded as click on "Primary Button" (the previous test's target). "Text input" recorded on "Internal Hyperlink". "Checkbox toggle" → "N/A" (blur from text input).

Fix: Filter out leading blur events when extracting the primary event for target attribution, OR start new units on focus events rather than continuing the previous unit.

### RC-2: State Diff Finds 0 Changes for Most Interactions (CRITICAL)
The state snapshot is captured at event time, but for many interactions (especially synthetic change events), the value/state change isn't reflected in the snapshot yet. The diff shows "0 value, 0 toggle, 0 radio, 0 surface, 0 range" for checkboxes, radios, selects, toggles, ARIA widgets.

Evidence: Native select → "0 value changes" despite a change event firing. Radio → "0 radio changes". Checkbox → "0 toggle changes".

Fix: Add a short delay (50-100ms) after each event before capturing the state snapshot, OR take a second snapshot after the boundary unit closes.

### RC-3: Custom ARIA Widgets Fall to Generic Click (HIGH)
No mousedown + setTimeout(0) deferred ARIA state reading. The pattern registry has no data to match because the state diff shows nothing changed. All ARIA checkboxes, radios, segmented controls, toggle switches resolve to generic-fallback → click at 0.30 confidence.

Evidence: ARIA checkbox → click at 0.30. ARIA radio → click at 0.30. Toggle switch → click at 0.30.

Fix: Port the mousedown deferred ARIA read from legacy content scripts.

### RC-4: Multi-Step Interactions Not Grouped (HIGH)
Opening a dropdown then selecting an option produces TWO separate click events instead of one select event. The boundary detector closes the trigger click as one unit, then the option click as another.

Evidence: ARIA combobox → 2 clicks ("Choose option..." + "Beta"). Custom calendar → 2 clicks (trigger + day cell). CSS dropdown → click on trigger only (option click was a separate unit).

Fix: Add surface-aware boundary detection — when a surface (dropdown/menu/dialog) opens, don't close the unit until the surface closes or an option is selected.

### RC-5: Range Slider Misclassified as Text (MEDIUM)
The range slider interaction produces keydown+input+change events that the pattern registry matches as text-entry-commit (0.92 confidence) because input events are present. The text-entry-commit pattern doesn't exclude range inputs.

Fix: Add input[type=range] exclusion to text-entry-commit pattern.
