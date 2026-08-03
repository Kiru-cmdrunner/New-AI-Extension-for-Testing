# Milestone C5.2B — Universal Dropdown Recording

**Status**: Implementation
**Created**: 2026-07-16T09:30:00Z
**Depends on**: C5.1 (frozen), C5.2 (frozen with defects)

## Problem

C5.2 implemented dropdown recording with two detection mechanisms:
1. `change` event for native `<select>`
2. `mousedown` on `[role="option"]` for ARIA custom dropdowns

Runtime validation identified 9 defects across 3 root categories:

### Category A: Single-Selection-Only (Ownership Ratchet) — BLOCKING
`claimOwnership()` sets `data-cmdrunner-handled` on the dropdown container as a
one-way ratchet. `isOwnedByAnother()` uses `closest()` which checks the element
itself. After the first selection, all future selections on the same dropdown are
silently dropped at Gate 2.

### Category B: Incomplete Detection Coverage — BLOCKING
- No keyboard selection detection (Enter/Space on highlighted options)
- Non-ARIA custom dropdowns (OrangeHRM OXD: `div.oxd-select-option` with no `role`)
  are completely undetected
- Portaled option lists (Radix, Headless UI) capture the transient portal container
  identity instead of the stable trigger

### Category C: Value Extraction & Redundancy — HIGH
- `aria-activedescendant` conflates keyboard-focused with selected
- Opening click on custom combobox trigger recorded as redundant Click
- `getSelectedValue` assumes `aria-selected="true"` is the only selection indicator

## Acceptance Criteria

- [ ] **AC-1**: Multiple selections on the same dropdown are ALL recorded (ownership ratchet eliminated)
- [ ] **AC-2**: Native `<select>` with mouse selection works (change event path)
- [ ] **AC-3**: Native `<select>` with keyboard selection works (arrow keys + Enter)
- [ ] **AC-4**: ARIA combobox/listbox with mouse selection works (mousedown on `[role="option"]`)
- [ ] **AC-5**: ARIA combobox/listbox with keyboard selection works (Enter/Space on `[role="option"]`)
- [ ] **AC-6**: Non-ARIA custom dropdowns detected via `aria-selected` state changes and click patterns
- [ ] **AC-7**: Portaled option lists resolve identity to the stable trigger, not the portal
- [ ] **AC-8**: Searchable/autocomplete dropdowns record only the final selection
- [ ] **AC-9**: Async-loaded options work (options appear after async fetch)
- [ ] **AC-10**: No duplicate Click + Select for the same interaction
- [ ] **AC-11**: Existing interaction types unaffected (click, hover, text, checkbox, radio, navigation)
- [ ] **AC-12**: All 748+ existing tests pass
- [ ] **AC-13**: New tests cover each detection mechanism

## Implementation Strategy

### Fix 1: Ownership Model Redesign
Remove the one-way ownership ratchet for dropdowns. Instead:
- Use pre-state value comparison (Gate 4) as the dedup mechanism
- The ownership attribute on options/containers prevents only the generic Click recorder from duplicating, NOT the select recorder from detecting future selections
- `isOwnedByAnother` in select-content-script returns false for "select" ownership (only blocks cross-interaction ownership like hover claiming a select)

### Fix 2: Multi-Mechanism Detection
Add detection for the major patterns:

| Pattern | Detection Mechanism | Event |
|---------|-------------------|-------|
| Native `<select>` mouse | DOM `change` event | change (capture) |
| Native `<select>` keyboard | DOM `change` event | change (capture) |
| ARIA `[role="option"]` mouse | mousedown on option | mousedown (capture) |
| ARIA `[role="option"]` keyboard | keydown Enter/Space on option | keydown (capture) |
| ARIA combobox keyboard commit | keydown Enter on `[role="combobox"]` | keydown (capture) |
| Non-ARIA option click | mousedown on clicked option + aria-selected check | mousedown (capture) |
| Portaled options | mousedown/click on `[role="option"]` → resolve trigger via aria-controls | mousedown (capture) |

### Fix 3: Trigger Resolution for Portaled Dropdowns
When an option is clicked in a portaled listbox:
1. Find the listbox container via `closest('[role="listbox"]')`
2. If listbox has `aria-labelledby` → resolve to the label element → that's near the trigger
3. If listbox has `id` → search for `[aria-controls="<id>"]` → that's the trigger
4. Fallback: use the listbox itself

### Fix 4: Value Extraction Improvements
- Check `aria-selected="true"` first
- Fallback to clicked element's `textContent`
- For combobox with `aria-activedescendant`: only use it on keydown Enter (committed selection), not during navigation

### Fix 5: Click Content Script Exclusions
- Exclude clicks on `[role="option"]` (already done — Decision 2d)
- Exclude clicks on `[role="listbox"]` children that are options
- Keep recording the trigger open-click (it's a meaningful action per C5.1)

## Known Limitations (to document)
- Virtualized dropdowns: only visible options have DOM elements; if the selected option is scrolled out, it may not be in the DOM when we try to extract the value
- Shadow DOM: closed shadow roots are not crossed
- Frameworks that use non-standard selection indicators (data-selected, CSS classes only) without aria-selected or role attributes
