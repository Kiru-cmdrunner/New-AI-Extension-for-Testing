# Batch 2 — Date Picker, Slider, Multi-select

## Objective
Implement three interaction types using the existing Interaction Registry,
with content scripts that reliably detect controls across native HTML, React,
Material UI, Ant Design, React Aria, Base UI, and generic ARIA implementations.

## Research Summary
Full cross-framework analysis saved at `.drytis/notes/batch2-cross-framework-analysis.md`.

## Type Definitions

### Date Picker
```typescript
interface DatePickerEvent {
  actionId: string; type: 'date_picker';
  timestamp: string; elementIdentity: ElementIdentity;
  dateValue: string;        // selected date (YYYY-MM-DD or locale string)
  datePickerVariant: 'native' | 'mui' | 'antd' | 'react-aria' | 'generic';
  aiUnderstanding?: AIUnderstanding; aiError?: string;
}
```

### Slider
```typescript
interface SliderEvent {
  actionId: string; type: 'slider';
  timestamp: string; elementIdentity: ElementIdentity;
  sliderValue: number;       // current committed value
  sliderMin: number;         // min value (default 0)
  sliderMax: number;         // max value (default 100)
  sliderVariant: 'native' | 'mui' | 'antd' | 'react-aria' | 'generic';
  aiUnderstanding?: AIUnderstanding; aiError?: string;
}
```

### Multi-select
```typescript
interface MultiSelectEvent {
  actionId: string; type: 'multi_select';
  timestamp: string; elementIdentity: ElementIdentity;
  selectedValues: string[];  // currently selected option labels
  multiSelectVariant: 'native' | 'mui-autocomplete' | 'mui-select' | 'antd' | 'checkbox-list' | 'generic';
  aiUnderstanding?: AIUnderstanding; aiError?: string;
}
```

## Execution JSON
- date_picker: `{ action: "date_picker", dateValue, datePickerVariant }`
- slider: `{ action: "slider", sliderValue, sliderMin, sliderMax }`
- multi_select: `{ action: "multi_select", selectedValues: [...] }`

## Plain English
- date_picker: `Select "2024-03-15" from the "Start Date" date picker`
- slider: `Set the "Volume" slider to 75`
- multi_select: `Select ["Red", "Blue"] in the "Colors" field`

## Detection Patterns

### Date Picker (7 variants)
1. `<input type="date|datetime-local|time|month|week">` → `change` event, read `.value`
2. MUI X DatePicker: `.MuiDatePicker-root` inner input
3. Ant Design DatePicker: `.ant-picker` inner input
4. React Aria: `role="group"` DateInput with spinbutton segments
5. W3C APG dialog pattern: button + textbox + dialog
6. Flatpickr/Pikaday: text input with attached picker
7. Generic `[role="datepicker"]` or date-related class names

### Slider (6 variants)
1. `<input type="range">` → `change` event, read `.value`
2. MUI Slider: `.MuiSlider-root` → thumb span with `aria-valuenow`
3. Ant Design Slider: `.ant-slider` → handle with aria attributes
4. React Aria: `react-aria-SliderThumb` → nested `<input type="range">`
5. Base UI: `<div>` thumb → nested `<input type="range">`
6. Generic `role="slider"` with aria-valuenow

### Multi-select (6 variants)
1. `<select multiple>` → `change` event, read `selectedOptions`
2. MUI Autocomplete: `.MuiAutocomplete-root` → Chip labels
3. MUI Select multiple: MenuItem + Checkbox
4. Ant Design Select: `.ant-select[multiple]` → tags
5. Svelte multi-select: `.multiselect` → li.selected items
6. Checkbox list: grouped checkboxes within a fieldset/container

## Acceptance Criteria
- [ ] All 7 date picker variants detected
- [ ] All 6 slider variants detected
- [ ] All 6 multi-select variants detected
- [ ] Plain English correct for each
- [ ] Execution JSON correct for each
- [ ] AI prompts include relevant state info
- [ ] Action IDs: `date-NNNN`, `slider-NNNN`, `multiselect-NNNN`
- [ ] Element ID, iframeContext, Screenshot reused
- [ ] All 328 existing tests pass unmodified
- [ ] Registry validation: only registration + content scripts + types + wiring

## Out of Scope
File Upload, Hover, Scroll, Right Click, Double Click, Drag & Drop, Keyboard Shortcuts
