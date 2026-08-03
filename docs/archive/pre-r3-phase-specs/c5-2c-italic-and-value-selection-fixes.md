# C5.2C — Italic Text Classification + Value Selection Runtime Fixes

## Context

Two runtime validation failures observed during manual testing on Adani One and OrangeHRM:

1. **Italic Text Misclassification**: Clicking controls with `<i>` icon tags (chevron-down,
   settings icons) records as "Italic Text" / "Text Formatting" instead of meaningful names.
   Reproduced on both Adani One and OrangeHRM.

2. **Value Selection Not Recognized (Adani One)**: Selecting "Premium Economy" in the travel
   class segmented control produces generic Click events instead of Select events. No Select
   events appear in the timeline.

## Root Cause Analysis

### Defect 1: Italic Text Misclassification (CONFIRMED)

**Root Cause**: The `<i>` tag is sent to the AI as `tag: "I"` with no icon context. The LLM
interprets the HTML tag name literally as italic text formatting. The AI's businessName
("Italic Text") then unconditionally overrides the accessible name in resolveDisplayName().

**Fix (already applied)**: 
- TAG_ROLE_MAP now maps `I → 'img'` and `SVG → 'img'`
- Icon guard in resolveDisplayName() detects icon tags (I, SVG, PATH, SPAN) with no accessible
  name, and rejects AI businessNames matching `/italic|text\s*format/i`
- className is now propagated through the pipeline to the AI prompt with icon-library awareness
- AI prompt includes guidance about modern `<i>` usage for icons

**Verification needed**: Confirm the fix handles the specific runtime scenario from screenshots.

### Defect 2: Value Selection Not Recognized (ADDITIONAL INVESTIGATION NEEDED)

**Observed evidence**: Adani One timeline shows only Click events (classified as Italic Text
due to <i> icon tags on dropdown triggers) — no Select events at all. The segmented control
likely uses React state with CSS classes for the active state, without `aria-pressed`,
`role="radio"`, or other ARIA attributes.

**Complete execution path traced**:

1. **mousedown fires** (capture phase) — three handlers in select-content-script run:
   - `handleOptionClick`: looks for `[role="option"]` → not found → returns
   - `handleSegmentedControlClick`: looks for `[aria-pressed]` → not found → returns
   - `handleGenericSelectionGroup`: snapshots sibling CSS classes → sets
     `data-cmdrunner-pending-select="true"` on target

2. **click fires** (capture phase) — `handleClick` in click-content-script runs:
   - Decisions 2b-2e: target doesn't match any skip selector (no checkbox/radio/option/
     aria-pressed) → all pass
   - Decision 3: `isOwnedByAnother(target)` checks `data-cmdrunner-handled` → **NOT set yet**
     (only `data-cmdrunner-pending-select` was set) → passes
   - Decision 5: **commits CLICK_CAPTURED** ← generic click recorded

3. **setTimeout(0) fires** — `checkPendingSelectionGroup` runs:
   - Reads CSS class differential (clicked element gained "active"/"selected" class, sibling
     lost it) → `isSelection = true`
   - `commitSelect()` → **commits SELECT_CAPTURED** ← select recorded
   - Sets `data-cmdrunner-handled="select"`

**Result: DOUBLE RECORDING** — Both a Click and a Select are recorded for the same interaction.

**BUT** the user reported only seeing Click events, not Select events. Two possible reasons:

A. The CSS class pattern might not match SELECTION_CLASS_PATTERN. If Adani One uses class
   names like "premium-economy-tab" (no "selected"/"active"/"checked" word), the differential
   check fails silently, and only the Click is recorded.

B. The target resolution in handleGenericSelectionGroup uses `event.target` directly (line 1199)
   instead of resolving via composedPath/parent walk. If the user clicks on an inner element
   (text span, icon) inside a segment button, `event.target` is the inner element, and the
   sibling structure may not match the expected group layout.

**Primary hypothesis**: The `data-cmdrunner-pending-select` attribute is set but never checked
by the click recorder. This causes the double-recording race condition. The fix is to make
the click recorder check for `data-cmdrunner-pending-select` as well.

**Secondary hypothesis**: Target resolution in handleGenericSelectionGroup doesn't use
resolveTargetFromEvent, so clicks on child elements (spans, icons) inside segment buttons
don't resolve to the parent button, causing the snapshot to capture the wrong sibling group.

## Files to Modify

### Fix 1 (Italic Text) — already applied, needs verification
- `src/recorder/click-content-script.ts` — TAG_ROLE_MAP, I/SVG → img
- `src/recorder/interaction-types.ts` — isIconElement(), icon guard in resolveDisplayName()
- `src/ai/ai-understanding.ts` — icon awareness in prompt
- `src/background/service-worker.ts` — className propagation
- `src/shared/types.ts` — className field in RawElementIdentity

### Fix 2 (Value Selection)
- `src/recorder/select-content-script.ts`:
  - Fix target resolution in handleGenericSelectionGroup to use resolveTargetFromEvent
  - Fix the pending-select suppression mechanism
- `src/recorder/click-content-script.ts`:
  - Check for `data-cmdrunner-pending-select` in Decision 3 (isOwnedByAnother)
- `src/recorder/select-content-script.ts`:
  - Clean up `data-cmdrunner-pending-select` if the deferred check finds no selection

## Acceptance Criteria

- [ ] AC1: An `<i>` element clicked in a page is NOT recorded as "Italic Text" — it is
  recorded as "Click the i icon" or better, using accessible name/icon library identification
- [ ] AC2: An `<svg>` element clicked in a page is NOT recorded as "Italic Text"
- [ ] AC3: A CSS-only segmented control (no aria-pressed, no role=radio) with buttons in a
  sibling group, where clicking toggles a class matching SELECTION_CLASS_PATTERN, is recorded
  as a Select event, NOT a Click
- [ ] AC4: The same CSS-only segmented control interaction does NOT produce a duplicate Click
  event
- [ ] AC5: Existing aria-pressed, role=option, role=radio, and native <select> recording paths
  are unaffected
- [ ] AC6: All existing tests pass (773+ tests across 28 files)
- [ ] AC7: New tests cover: (a) icon tag click → not italic text, (b) CSS-only segmented
  control → Select event, (c) no double recording, (d) pending-select cleanup

## Edge Cases

- Click on inner element (span/icon) inside a segment button → must resolve to the button
- Binary toggle (single button, not part of a group) → must NOT be recorded as Select
- CSS class pattern doesn't match (e.g., "premium-economy-active" → matches because of
  "active" substring) → this is correct behavior
- Click on a button outside any sibling group → unaffected (captureSiblingSnapshot returns early)
- React virtual DOM recreation between mousedown and setTimeout → element reference may be stale;
  the snapshot stores Element reference, but React may have re-rendered. The CSS differential
  compares className on the SAME element reference, which may now be detached. This is a known
  limitation — the pre-state map uses elementKey (tag|id|cssSelector) for resilience, but the
  snapshot uses Element references directly.

## Known Limitations After Fix

1. CSS-class-differential detection only fires when the class name contains a recognized
   selection word (selected, active, checked, current, chosen, on). Apps using non-standard
   class names for selection state will not be detected. This is a deliberate trade-off to
   avoid false positives.
2. The snapshot uses Element references, not element keys. React virtual DOM recreation may
   cause the snapshot's element references to become detached, preventing detection. This is
   a known limitation of the deferred-check approach.
3. Icon classification for `<i>` tags with no className relies on the AI seeing the tag name
   "I" — the icon guard catches the most common misclassification ("Italic Text") but may not
   catch all LLM hallucinations.
