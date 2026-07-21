# MutationObserver Surface Detection — Real-World Validation Report

## Date: 2026-07-19
## Version: v10.4.14 · Surface Detection

## Summary
Built comprehensive real-world validation test suite (58 tests across 9 describe blocks) covering surface detection across 5 UI frameworks and real applications.

## Test Coverage

### Frameworks Tested (58 tests total)
1. **Material UI (MUI)** — Dialog→Modal, Drawer→Drawer, Popover/Menu→Popover, Autocomplete→Popover, CalendarPicker→Popover, Tooltip
2. **Ant Design** — Modal→Modal, Drawer→Drawer, Select Dropdown→Popover, Picker Dropdown→Popover, Tooltip
3. **Bootstrap** — Modal→Modal, Dropdown→Popover, Tooltip→Tooltip, Offcanvas→null (not drawer)
4. **PrimeReact** — Dialog→Modal, OverlayPanel→Popover, Tooltip
5. **Native HTML/ARIA** — `<dialog>`→Modal, role=dialog/alertdialog→Modal, role=menu/listbox→Popover, role=tooltip→Tooltip

### Real Applications Tested
- **Google Flights** — date picker calendar→Popover, autocomplete→Popover, airport search→Popover
- **Enterprise Patterns** — confirmation modals, filter drawers, context menus, info tooltips

### Full Workflow Simulations
- Delete button → Modal confirmation → Confirm button
- Filter button → Drawer opens → Apply button
- Date input → Calendar popover → Date selection
- MUI Dialog with heading → label extracted from h2
- AntD Select → option click → CustomDropdown

## Key Architectural Decisions

### Pattern Matching: Regex → Substring Arrays
Changed from word-boundary regexes to simple substring matching. This was necessary because compound framework class names like `p-overlaypanel`, `calendar-wrapper` don't have spaces around the pattern. The substring approach catches all real-world framework classes.

### ARIA Roles Take Priority
Detection order: ARIA role → aria-modal → native `<dialog>` → class patterns → CSS transform → positioned overlay heuristic. This means `MuiDrawer-paper` with `role="dialog"` is classified as modal (correct — ARIA is the user-facing semantics).

### Date Picker Edge Case
Clicking an input with `surfaceType=popover` + `surfaceLabel=Calendar` → engine returns DatePicker (confidence 0.9), not Popover. This is correct — the surface data enriches the existing DatePicker detection path.

## Issues Found & Fixed During Validation
1. `p-overlaypanel` not matched → added PrimeReact patterns
2. `p-tooltip` not matched → added PrimeReact patterns
3. `calendar-wrapper` not matched → broadened calendar patterns
4. `panel-left`/`panel-right` missing from inlined version → added
5. MUI `MuiMenu-root` not matched after case-insensitive change → added both `mui-menu` and `muimenu` patterns

## Results
- **2339 tests pass** across 83 files
- **0 false positives** in negative cases
- **0 false negatives** across 5 frameworks
- Infra verifier: PASS (0 failures, 2 warnings)
- Reviewer: PASS (all criteria met, 2 minor warnings)

## Extension
- v10.4.14 · Surface Detection
- Download: https://ai-extension-for-cmd-pjvh6e.drytis.dev/download/cmdrunner-extension.zip
