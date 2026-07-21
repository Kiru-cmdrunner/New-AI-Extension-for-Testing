# Selection Controls Completion

## Goal
Complete detection for the remaining selection control types — ToggleSwitch, Tab, and Slider — so the Selection Controls category reaches feature completeness. These are the most common control types missing reliable detection in real-world applications.

## Current State

| Type | Status | What Exists | What's Missing |
|------|--------|-------------|----------------|
| **ToggleSwitch** | Partial | role=switch in ROLE_TYPE_MAP, button+aria-pressed, CSS classes, checked extraction, timeline phrasing | MUI/AntD class patterns incomplete, no commit-time reinforcement |
| **Tab** | Partial | role=tab in ROLE_TYPE_MAP, CSS classes | No timeline phrasing, no aria-selected extraction, no tabpanel context |
| **Slider** | **None** | Not even in type system | Everything: type definition, detection, metadata, phrasing |

## Phase 1: ToggleSwitch Hardening

### Detection Improvements
- **AriaProvider onEvent**: role=switch already emits ToggleSwitch. Verify it's not gated on click-only (switches toggle on click, space, and sometimes keyboard arrows — all captured as click by the recorder's event model).
- **AriaProvider onEvent**: button + aria-pressed detection already exists. Verify it handles `checkedAfter` correctly for MUI Switch (which uses role=button + aria-pressed=false/true).
- **CssClassnameProvider**: Expand toggle class patterns:
  - MUI: `MuiSwitch-root`, `MuiSwitch-switchBase`, `MuiSwitch-thumb`
  - AntD: `ant-switch`
  - Bootstrap: `custom-switch`, `form-switch`
  - Generic: `toggle-switch`, `toggle-button`, `switch-input`
- **DomProvider**: `<input type="checkbox">` with toggle CSS classes → ToggleSwitch (not Checkbox). This catches MUI switches that render as checkboxes with switch styling.
- **AriaProvider onCommit**: focus/click + blur with checkedAfter transition → reinforce ToggleSwitch @ 0.9.

### Metadata
- `checked: boolean` — extracted from `checkedAfter` (already exists in schema)

### Timeline Phrasing
- Already exists: `Enable "X"` / `Disable "X"` / `Toggle "X"`

## Phase 2: Tab Detection

### Detection
- **AriaProvider onEvent**: role=tab already maps to Tab @ 0.85. Verify click gating works.
- **CssClassnameProvider**: Already has MUI Tabs patterns. Add:
  - AntD: `ant-tabs-tab`
  - Bootstrap: `nav-link` inside `.nav-tabs`
  - Generic: `tab-item`, `tab-header`
- **EventSequenceProvider onCommit**: Two clicks on different tabs in the same tablist → reinforce Tab type (second tab click confirms tab context).
- **MutationProvider onCommit**: If after a click a tabpanel appears/changes → boost Tab confidence.

### Metadata
- Add `selectedTab?: string` to InteractionMetadata — the accessibleName of the clicked tab
- Extract from the click event's `target.accessibleName`

### Timeline Phrasing
- `Click "Settings" tab` (with tab name)
- `Click tab` (no name)

## Phase 3: Slider (New Type)

### Type System
- Add `'Slider'` to InteractionType union
- Add to TYPE_DISPLAY: `Slider: { label: 'Slider', icon: '🎚️', color: '#6366f1' }`
- Add to TIER1_TYPES (deterministic via role/input type)
- Add to INTERACTION_CATEGORIES: Navigation UI or new "Range Controls" category? → Selection Controls

### Detection
- **AriaProvider onEvent**: `role="slider"` → Slider @ 0.85. Currently unmapped.
- **DomProvider onEvent**: `<input type="range">` → Slider @ 0.85. Currently falls to TextEntry.
- **CssClassnameProvider**: Change `Slider` → `Slider` (currently maps to Click!). Patterns:
  - MUI: `MuiSlider-root`, `MuiSlider-thumb`
  - AntD: `ant-slider`
  - Generic: `slider`, `range-slider`, `slider-handle`

### Metadata
- Add `sliderValue?: string` to InteractionMetadata — the aria-valuenow or input.value
- Extract from `valueAfter` on the change/blur event

### Timeline Phrasing
- `Set slider to "50"` (with value)
- `Adjust "Volume" slider` (no value)

## Acceptance Criteria

### ToggleSwitch
- [ ] role=switch → ToggleSwitch (not Click)
- [ ] role=button + aria-pressed → ToggleSwitch (not Click)
- [ ] MUI Switch CSS classes → ToggleSwitch
- [ ] AntD Switch CSS classes → ToggleSwitch
- [ ] checked state extracted correctly
- [ ] No regression: plain checkbox → Checkbox, plain button → Click

### Tab
- [ ] role=tab click → Tab (not Click)
- [ ] MUI/AntD/Bootstrap tab CSS classes → Tab
- [ ] selectedTab metadata extracted from accessibleName
- [ ] Timeline shows "Click 'X' tab"
- [ ] No regression: plain link → Link

### Slider
- [ ] role=slider → Slider (not Click or Unknown)
- [ ] <input type="range"> → Slider (not TextEntry)
- [ ] MUI/AntD slider CSS classes → Slider (not Click)
- [ ] sliderValue extracted from valueAfter
- [ ] Timeline shows "Set slider to 'X'"
- [ ] Slider type appears in TYPE_DISPLAY

### Regression
- [ ] All 2426 existing tests pass
- [ ] No interaction type changes for existing test fixtures
