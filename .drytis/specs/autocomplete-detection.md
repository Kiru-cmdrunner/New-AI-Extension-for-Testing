# Autocomplete Detection

## Goal
Differentiate autocomplete/typeahead interactions (user types text, selects from filtered suggestions) from pure dropdown selections (user clicks trigger, picks from fixed list). Currently all combobox interactions are classified as `CustomDropdown`.

## Architecture

### Differentiation Signals (priority order)
1. `aria-autocomplete` attribute present (`"list"`, `"both"`) → definitive Autocomplete
2. `role="combobox"` + focus/blur with text value change → user typed then selected
3. Native `<input list="datalist-id">` → native datalist autocomplete
4. CSS class patterns (`MuiAutocomplete`, `autocomplete`, `typeahead`) → framework autocomplete

### Phase 1: Data Model + Recorder
- Add `ariaAutoComplete: string | null` and `listId: string | null` to DomContext
- Capture in recorder's captureDomContext()

### Phase 2: Provider Logic
**AriaProvider** (primary detector):
- onEvent: role=combobox + ariaAutoComplete present → Autocomplete @ 0.85 (instead of CustomDropdown)
- onCommit: detect autocomplete conditions → emit Autocomplete @ 0.9 with textValue + selectedValue

**DomProvider**: input with listId → Autocomplete @ 0.75

**CssClassnameProvider**: autocomplete class patterns → Autocomplete instead of CustomDropdown

### Phase 3: Display
- Timeline: `Search "New" and select "New York (JFK)"` when both available
- Fallback: `Search and select "New York (JFK)"` (no search text)
- Fallback: `Search "New"` (no selection)

### Phase 4: Tests
- Unit: all 4 detection signals
- Integration: full pipeline (recorder events → engine → interaction)
- Real-world: MUI, AntD, React-Select, Google Flights, native datalist
- Regression: CustomDropdown still works when no autocomplete signals

## Acceptance Criteria
- [ ] ariaAutoComplete present → Autocomplete (not CustomDropdown)
- [ ] Combobox with focus/blur text change → Autocomplete
- [ ] Native datalist (input[list]) → Autocomplete
- [ ] MUI/AntD/React-Select class patterns → Autocomplete
- [ ] CustomDropdown still detected when no autocomplete signals
- [ ] textValue (search text) extracted from blur valueAfter
- [ ] selectedValue extracted from option accessibleName
- [ ] Timeline renders Search/Select phrasing
- [ ] All existing tests pass
