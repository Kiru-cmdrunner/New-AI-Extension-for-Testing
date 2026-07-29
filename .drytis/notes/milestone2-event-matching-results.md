# Milestone 2: Event Matching — VALIDATED

## Assumption Tested
**A4 (Event Traceability):** Given a DOM event, can we correctly identify which
logical Control the user intended to interact with?

## Result: A4 VALIDATED ✓

All 34 tests pass across 7 test suites:
- Semantic HTML (baseline): 5/5
- OrangeHRM OXD (the original failure): 10/10
- MUI (React Material UI): 4/4
- Ant Design: 4/4
- Shadow DOM (Web Components): 3/3
- Composite Controls (listbox, tablist): 4/4
- Deeply Nested Decorative Elements: 3/3
- Control Model Statistics: 1/1

## Architecture Validated

### Control Model + WeakMap<Element,ControlNode> + composedPath()
The event matching pipeline works:
1. Build Control Model by walking DOM (with open shadow roots)
2. Each control element registered in WeakMap → controlId
3. On event: composedPath() gives element chain
4. Walk chain checking WeakMap for direct hit
5. If no hit, check framework wrapper fallback (label wrapping input)

### Match Strategies (3 proven)
- **direct-target**: event.target IS the control element (fastest)
- **ancestor-walk**: event.target is decorative (icon/span inside button)
- **label-wrapper-fallback**: event.target is a <label> wrapping an input
  (OXD radio-wrapper, MUI FormControlLabel, Ant checkbox-wrapper)

## Critical Bug Fixes During Validation

### Fix 1: OXD Dropdown Container Recognition
**Bug:** `.oxd-select-text-icon` (dropdown arrow) had no control ancestor
because `.oxd-select-text` (the clickable container with tabindex) was not
in the OXD role map. Only `.oxd-select-text-input` was mapped.

**Fix:** Added `oxd-select-text` → combobox to the OXD adapter.
Now clicking anywhere in the dropdown trigger (text, icon, container)
resolves to the combobox control.

### Fix 2: Deep Label Ancestor Walking
**Bug:** Name resolution only checked `parent.tagName === 'LABEL'`.
MUI/Ant nest input 2+ levels deep inside labels:
`<label><span><span><input/></span></span>Text</label>`

**Fix:** Walk full ancestor chain (up to 10 levels) looking for LABEL tag.
Clone it, remove inputs, read textContent.

### Fix 3: OXD Label Resolution Priority
**Bug:** OXD wrapper text ("-- Select --") was read as the name because
wrapper text check ran before the form group label check.

**Fix:** Check `.oxd-input-group > .oxd-label` BEFORE wrapper text.
Also added isPlaceholderText() filter to skip "-- Select --" patterns.

### Fix 4: OXD Dropdown Boundary Integrity
**The v10.4.18 bug (Nationality → Blood Type) is FIXED.**
Each OXD dropdown trigger is discovered as a separate control with its
correct name from the `.oxd-label` in its `.oxd-input-group` ancestor.
No cross-dropdown contamination.

### Fix 5: Shadow DOM Slot Text
**Bug:** Button inside shadow root has empty textContent because slot
content doesn't populate inside the shadow root.

**Fix:** Read `shadowRoot.host.textContent` for slot-assigned text.

### Fix 6: Placeholder Filtering
**Bug:** OXD dropdown trigger textContent is "-- Select --" which was
used as the control name.

**Fix:** Added isPlaceholderText() to filter "-- Select --", "Select...",
etc. during name resolution.

### Fix 7: Removed Generic Container Fallback
**Bug:** Original Strategy 2 had a generic "find any input/button inside
any ancestor" fallback. This incorrectly matched clicking a wrapper div
to a button nested deep inside it.

**Fix:** Restricted fallback to `<label>` wrappers only. A generic `<div>`
that happens to contain a button should NOT resolve to that button.

## Remaining Known Limitations (Non-Blocking)

1. **Closed Shadow DOM**: Cannot discover or track controls inside closed
   shadow roots (hostElement.shadowRoot returns null). No workaround possible.
   Impact: Low — most component libraries use open shadow roots.

2. **getAncestorChain depth limit (10)**: Deeply nested enterprise apps with
   15+ levels of wrapper divs may miss labels. Engineering fix: increase limit
   or make it adaptive. No architectural concern.

3. **Framework adapter specificity**: OXD adapter handles the known patterns.
   Other frameworks (Ionic, SAP Fiori) will need similar adapters (~50-100 LOC).
   All follow the same pattern: class-to-role mapping + name resolution.

## Performance Characteristics (JSDOM, not real browser)
- OXD form with 5 controls: <1ms for full discover + match
- Build + match is O(n) in number of DOM elements
- WeakMap lookup is O(1) per composedPath element
- Total event matching cost: O(path_length) — typically 3-8 elements

## Test Location
tests/milestone2-validation.test.ts (34 tests, ~1000 lines)
