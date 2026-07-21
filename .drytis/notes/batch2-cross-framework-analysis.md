# Batch 2 Cross-Framework Pattern Analysis

## Date Picker

### Detection Patterns (7 variants)
1. **Native HTML**: `<input type="date">` — fires `change`+`input`, value YYYY-MM-DD, no ARIA role
2. **Native variants**: `<input type="datetime-local">`, `<input type="time">`, `<input type="month">`, `<input type="week">`
3. **Material UI X DatePicker**: `.MuiDatePicker-root` → TextField + popover with PickerDay buttons. `renderInput` wraps TextField. ButtonBase for day selection.
4. **Ant Design DatePicker**: `.ant-picker` container, `@rc-component/picker` based, text input + calendar popup. `onChange` fires with dayjs.
5. **React Aria**: `role="group"` → DateInput with DateSegment `<div>` segments (role="spinbutton"). Calendar with CalendarGrid/CalendarCell, `data-selected`/`data-pressed` attributes.
6. **W3C APG Dialog Pattern**: Textbox + `aria-describedby`, Button with `aria-label="Choose Date"/"Change Date, DATE"`, dialog role for calendar popup.
7. **Custom text input**: `<input type="text">` with a date picker library attached (flatpickr, pikaday, etc.)

### State Reading Priority
1. `el.value` (native input) — YYYY-MM-DD or locale string
2. `aria-valuenow` on spinbutton segments (React Aria)
3. Container `.MuiDatePicker-root` or `.ant-picker` → read input child `.value`
4. Text content of input field for custom pickers

### Capture Strategy
- Native: listen for `change` event on `input[type=date|datetime-local|time|month|week]`
- MUI/AntD: listen for `change` on the inner `<input>` inside `.MuiDatePicker-root` / `.ant-picker`
- React Aria: listen for `focusout` on the DateInput group, read segment values
- Key: capture on `change` (committed value) not `input` (intermediate)

---

## Slider

### Detection Patterns (6 variants)
1. **Native HTML**: `<input type="range">` — implicit slider role, `aria-valuemin`(0), `aria-valuemax`(100), `aria-valuenow`, `aria-valuetext`. Events: `input` (continuous), `change` (on release).
2. **Material UI Slider**: `.MuiSlider-root` → `.MuiSlider-thumb` (span, role="slider"), `.MuiSlider-track`, `.MuiSlider-rail`. `aria-labelledby`/`aria-label`. Supports range (array values), marks.
3. **Ant Design Slider**: `rc-slider` based. `div.ant-slider` → `div.ant-slider-rail`, `div.ant-slider-track`, `div.ant-slider-handle`. Events: `onChange`, `onChangeComplete`.
4. **React Aria**: `react-aria-SliderThumb` with nested `<input type="range">`. Data attributes: `data-dragging`, `data-hovered`, `data-focused`, `data-orientation`.
5. **Base UI**: Thumb `<div>` with nested `<input type="range">`.
6. **Generic ARIA**: `role="slider"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.

### State Reading Priority
1. `el.value` (native input[type=range])
2. `aria-valuenow` attribute (MUI thumb span, generic role=slider)
3. `aria-valuetext` (human-readable value)
4. `aria-valuemin` / `aria-valuemax` (range bounds)

### Capture Strategy
- Listen for `change` event (fires on release) — NOT `input` (fires continuously during drag)
- For MUI: `change` on the inner input or on the thumb span's focusout
- For AntD: `change` on the div.ant-slider or mouseup
- Key: capture committed value only, not intermediate drag values

---

## Multi-select

### Detection Patterns (6 variants)
1. **Native HTML**: `<select multiple>` with `<option>` children. `change` event. `selectedOptions` property returns HTMLCollection.
2. **MUI Autocomplete (multiple)**: `.MuiAutocomplete-root` div → Chip components (`.MuiAutocomplete-tag`, `.MuiChip-root`). Popper for dropdown. `multiple` prop. `renderValue`/`renderTags`.
3. **MUI Select (multiple)**: Uses `<select multiple>` pattern with MenuItem + Checkbox + ListItemText. onChange fires with array.
4. **Ant Design Select (multiple)**: `.ant-select` with `mode="multiple"`. Renders tags/chips for selected items.
5. **Svelte multi-select**: `div.multiselect` → `input` + `ul.selected` (li items) + `ul.options` (li items).
6. **Checkbox list**: Multiple checkboxes within a container, each represents one option.

### State Reading Priority
1. `el.selectedOptions` (native select multiple) → array of text labels
2. Chip/tag elements within `.MuiAutocomplete-root` → text content of each `.MuiChip-root`
3. Tag elements within `.ant-select` → text content
4. Checked checkboxes within a group → labels
5. `aria-selected="true"` on option elements

### Capture Strategy
- Native: `change` event on `<select multiple>`
- MUI Autocomplete: `change` on the root, read chip labels
- MUI/AntD Select: `close` or `blur` event, then read selected items
- Checkbox list: reuse checkbox content script's events but group them
- Key: capture the full selected set, not individual toggles
