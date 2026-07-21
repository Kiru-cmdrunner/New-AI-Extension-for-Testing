/**
 * CSS Classname Provider
 *
 * Detects UI framework component types by pattern-matching CSS class names.
 * This unlocks detection for framework widgets without ARIA roles — Material UI
 * (MUI), Ant Design (AntD), and Bootstrap components.
 *
 * Class names are a heuristic signal (not as authoritative as ARIA roles or
 * DOM structure), so confidence values are conservative (0.6–0.9).
 *
 * Framework detection:
 *   MUI        — `MuiButton-root`, `MuiCheckbox-root`, `MuiSwitch-root`, etc.
 *   AntD       — `ant-btn`, `ant-checkbox`, `ant-switch`, etc.
 *   Bootstrap  — `btn`, `form-check-input`, `form-control`, etc.
 *   Headless UI — `headlessui-listbox-*`, `headlessui-combobox-*`, `headlessui-menu-*`
 *   React-Select — `select__control`, `select__option`, `select__value-container`
 *   react-datepicker — `react-datepicker__day`, `react-datepicker__month`
 *   Generic   — `dropdown`, `listbox`, `calendar`, `menu-item` substring matching
 */

import type { InteractionType } from '../../interaction-types.ts';
import type { RecordedEvent } from '../../../recorder/recorded-event.ts';
import type { Evidence, EvidenceProvider, InteractionBuffer } from '../types.ts';

// ── MUI Component → Interaction Type Map ────────────────────────────────────

/**
 * Maps the component name extracted from MUI class prefixes (e.g. "Checkbox"
 * from "MuiCheckbox-root") to an interaction type.
 */
const MUI_COMPONENT_MAP: Record<string, { type: InteractionType; confidence: number; weight: number }> = {
  'Button':       { type: 'Click',         confidence: 0.75, weight: 0.7 },
  'ButtonBase':   { type: 'Click',         confidence: 0.7,  weight: 0.65 },
  'Checkbox':     { type: 'Checkbox',      confidence: 0.85, weight: 0.8 },
  'Radio':        { type: 'RadioButton',   confidence: 0.85, weight: 0.8 },
  'RadioGroup':   { type: 'RadioButton',   confidence: 0.7,  weight: 0.6 },
  'Switch':       { type: 'ToggleSwitch',  confidence: 0.85, weight: 0.8 },
  'Select':       { type: 'CustomDropdown', confidence: 0.8, weight: 0.75 },
  'Autocomplete': { type: 'Autocomplete', confidence: 0.85, weight: 0.8 },
  'TextField':    { type: 'TextEntry',     confidence: 0.6,  weight: 0.5 },
  'Input':        { type: 'TextEntry',     confidence: 0.6,  weight: 0.5 },
  'InputBase':    { type: 'TextEntry',     confidence: 0.55, weight: 0.45 },
  'PickersDay':   { type: 'DatePicker',    confidence: 0.9,  weight: 0.85 },
  'CalendarPicker': { type: 'DatePicker',  confidence: 0.85, weight: 0.8 },
  'DatePickerToolbar': { type: 'DatePicker', confidence: 0.75, weight: 0.7 },
  'ClockPicker':  { type: 'TimePicker',    confidence: 0.85, weight: 0.8 },
  'TimePickerToolbar': { type: 'TimePicker', confidence: 0.75, weight: 0.7 },
  'DateTimePickerToolbar': { type: 'DateTimePicker', confidence: 0.75, weight: 0.7 },
  'Tabs':         { type: 'Tab',           confidence: 0.65, weight: 0.55 },
  'Tab':          { type: 'Tab',           confidence: 0.8,  weight: 0.75 },
  'Slider':       { type: 'Slider',         confidence: 0.85, weight: 0.8 },
  'AccordionSummary': { type: 'Click',     confidence: 0.75, weight: 0.7 },
  'IconButton':   { type: 'Click',         confidence: 0.75, weight: 0.7 },
  'Fab':          { type: 'Click',         confidence: 0.75, weight: 0.7 },
  'MenuItem':     { type: 'CustomDropdown', confidence: 0.7, weight: 0.6 },
  // File upload components
  'Dropzone':      { type: 'FileUpload' as InteractionType,     confidence: 0.85, weight: 0.8 },
  'DropzoneArea':  { type: 'FileUpload' as InteractionType,     confidence: 0.85, weight: 0.8 },
  // Breadcrumb
  'Breadcrumbs':   { type: 'Breadcrumb' as InteractionType,     confidence: 0.85, weight: 0.8 },
  'BreadcrumbsLi':  { type: 'Breadcrumb' as InteractionType,    confidence: 0.8,  weight: 0.75 },
};

// ── AntD Component → Interaction Type Map ───────────────────────────────────

/**
 * Maps the component name extracted from AntD class prefixes (e.g. "checkbox"
 * from "ant-checkbox") to an interaction type.
 */
const ANTD_COMPONENT_MAP: Record<string, { type: InteractionType; confidence: number; weight: number }> = {
  'btn':              { type: 'Click',         confidence: 0.75, weight: 0.7 },
  'checkbox':         { type: 'Checkbox',      confidence: 0.85, weight: 0.8 },
  'radio':            { type: 'RadioButton',   confidence: 0.85, weight: 0.8 },
  'switch':           { type: 'ToggleSwitch',  confidence: 0.85, weight: 0.8 },
  'select':           { type: 'CustomDropdown', confidence: 0.8, weight: 0.75 },
  'select-selector':  { type: 'CustomDropdown', confidence: 0.8, weight: 0.75 },
  'select-item':      { type: 'CustomDropdown', confidence: 0.7, weight: 0.6 },
  'input':            { type: 'TextEntry',     confidence: 0.6,  weight: 0.5 },
  'input-number':     { type: 'TextEntry',     confidence: 0.6,  weight: 0.5 },
  'picker':           { type: 'DatePicker',    confidence: 0.85, weight: 0.8 },
  'picker-cell':      { type: 'DatePicker',    confidence: 0.9,  weight: 0.85 },
  'time-picker':      { type: 'TimePicker',    confidence: 0.85, weight: 0.8 },
  'tabs-tab':         { type: 'Tab',           confidence: 0.8,  weight: 0.75 },
  'slider':           { type: 'Slider',         confidence: 0.85, weight: 0.8 },
  'slider-handle':    { type: 'Slider',         confidence: 0.85, weight: 0.8 },
  'menu-item':        { type: 'CustomDropdown', confidence: 0.7, weight: 0.6 },
  'collapse-header':  { type: 'Click',         confidence: 0.75, weight: 0.7 },
  // File upload components
  'upload':           { type: 'FileUpload' as InteractionType,     confidence: 0.85, weight: 0.8 },
  'upload-dragger':   { type: 'DragDropUpload' as InteractionType, confidence: 0.85, weight: 0.8 },
  'upload-btn':       { type: 'FileUpload' as InteractionType,     confidence: 0.8,  weight: 0.75 },
  // Breadcrumb
  'breadcrumb-link':  { type: 'Breadcrumb' as InteractionType,     confidence: 0.85, weight: 0.8 },
  'breadcrumb':       { type: 'Breadcrumb' as InteractionType,     confidence: 0.75, weight: 0.7 },
};

// ── Bootstrap Component → Interaction Type Map ──────────────────────────────

/**
 * Maps Bootstrap class names to interaction types.
 */
const BOOTSTRAP_CLASS_MAP: Record<string, { type: InteractionType; confidence: number; weight: number }> = {
  'btn':                 { type: 'Click',         confidence: 0.6,  weight: 0.55 },
  'form-check-input':    { type: 'Checkbox',      confidence: 0.7,  weight: 0.65 },
  'form-control':        { type: 'TextEntry',     confidence: 0.6,  weight: 0.55 },
  'form-select':         { type: 'NativeDropdown', confidence: 0.65, weight: 0.6 },
  'dropdown-item':       { type: 'CustomDropdown', confidence: 0.7, weight: 0.65 },
  'nav-link':            { type: 'Link',          confidence: 0.6,  weight: 0.55 },
  'nav-tab':             { type: 'Tab',           confidence: 0.7,  weight: 0.65 },
  'form-switch':         { type: 'ToggleSwitch',  confidence: 0.8,  weight: 0.75 },
  'custom-switch':       { type: 'ToggleSwitch',  confidence: 0.75, weight: 0.7 },
  'form-range':          { type: 'Slider',        confidence: 0.85, weight: 0.8 },
  // File upload components
  'form-control-file':   { type: 'FileUpload' as InteractionType, confidence: 0.8, weight: 0.75 },
  'custom-file-input':   { type: 'FileUpload' as InteractionType, confidence: 0.8, weight: 0.75 },
  'custom-file':         { type: 'FileUpload' as InteractionType, confidence: 0.75, weight: 0.7 },
  // Breadcrumb
  'breadcrumb-item':     { type: 'Breadcrumb' as InteractionType, confidence: 0.85, weight: 0.8 },
};

// ── Headless UI Component → Interaction Type Map ────────────────────────────

/**
 * Maps Headless UI class patterns (e.g. "headlessui-listbox-option" → "listbox")
 * to interaction types. Headless UI uses `headlessui-<component>-<part>` naming.
 */
const HEADLESS_UI_MAP: Record<string, { type: InteractionType; confidence: number; weight: number }> = {
  'listbox':       { type: 'CustomDropdown', confidence: 0.75, weight: 0.7 },
  'combobox':      { type: 'Autocomplete',   confidence: 0.8,  weight: 0.75 },
  'menu':          { type: 'CustomDropdown', confidence: 0.7,  weight: 0.65 },
  'disclosure':    { type: 'Click',          confidence: 0.65, weight: 0.6 },
  'tabs':          { type: 'Tab',            confidence: 0.7,  weight: 0.65 },
  'switch':        { type: 'ToggleSwitch',   confidence: 0.8,  weight: 0.75 },
};

// ── React-Select Component → Interaction Type Map ───────────────────────────

/**
 * Maps React-Select class patterns (e.g. "select__option" → "option").
 * React-Select uses `select__<part>` naming (with configurable classNamePrefix).
 */
const REACT_SELECT_MAP: Record<string, { type: InteractionType; confidence: number; weight: number }> = {
  'control':          { type: 'CustomDropdown', confidence: 0.75, weight: 0.7 },
  'option':           { type: 'CustomDropdown', confidence: 0.7,  weight: 0.65 },
  'value-container':  { type: 'CustomDropdown', confidence: 0.7,  weight: 0.65 },
  'input':            { type: 'Autocomplete',   confidence: 0.7,  weight: 0.65 },
  'menu':             { type: 'CustomDropdown', confidence: 0.7,  weight: 0.65 },
  'indicator':        { type: 'CustomDropdown', confidence: 0.6,  weight: 0.55 },
};

// ── react-datepicker Component → Interaction Type Map ───────────────────────

/**
 * Maps react-datepicker class patterns (e.g. "react-datepicker__day" → "day").
 */
const REACT_DATEPICKER_MAP: Record<string, { type: InteractionType; confidence: number; weight: number }> = {
  'day':           { type: 'DatePicker',    confidence: 0.85, weight: 0.8 },
  'month':         { type: 'DatePicker',    confidence: 0.7,  weight: 0.65 },
  'month-container': { type: 'DatePicker',  confidence: 0.75, weight: 0.7 },
  'year':          { type: 'DatePicker',    confidence: 0.7,  weight: 0.65 },
  'week':          { type: 'DatePicker',    confidence: 0.65, weight: 0.6 },
  'day-name':      { type: 'DatePicker',    confidence: 0.65, weight: 0.6 },
  'header':        { type: 'DatePicker',    confidence: 0.65, weight: 0.6 },
  'time':          { type: 'TimePicker',    confidence: 0.75, weight: 0.7 },
  'input':         { type: 'DatePicker',    confidence: 0.7,  weight: 0.65 },
  'container':     { type: 'DatePicker',    confidence: 0.7,  weight: 0.65 },
  'triangle':      { type: 'DatePicker',    confidence: 0.6,  weight: 0.55 },
};

// ── Interaction types that should only fire on click events ─────────────────

const CLICK_TYPE_INTERACTIONS = new Set<string>([
  'Click', 'Link', 'Tab',
]);

// ── Regex patterns ──────────────────────────────────────────────────────────

// MUI: "MuiCheckbox-root" → "Checkbox"
// Also matches "MuiButton-containedPrimary" → "Button"
const MUI_PATTERN = /^Mui([A-Z][a-zA-Z0-9]*)(?:-[a-zA-Z0-9]+)*$/;

// AntD: "ant-checkbox" → "checkbox", "ant-select-item" → "select-item"
// Also matches "ant-checkbox-checked" → "checkbox"
const ANTD_PATTERN = /^ant-([a-z]+(?:-[a-z]+)*)(?:-[a-z0-9]+)*$/;

// Bootstrap: "btn-primary" → "btn", "btn-outline-success" → "btn"
const BOOTSTRAP_PATTERN = /^btn(?:-[a-z]+)*$/;

// Headless UI: "headlessui-listbox-option" → "listbox"
// Also matches "headlessui-combobox-button" → "combobox"
const HEADLESS_UI_PATTERN = /^headlessui-([a-z]+)(?:-[a-z]+)*$/;

// React-Select: "select__option" → "option", "select__control" → "control"
// Also matches custom prefix like "my-select__option" if prefix ends with "select"
const REACT_SELECT_PATTERN = /([a-z-]*select)__([a-z-]+)$/;

// react-datepicker: "react-datepicker__day" → "day"
// Also matches "react-datepicker__day--selected" → "day", "react-datepicker__month-container" → "month-container"
const REACT_DATEPICKER_PATTERN = /^react-datepicker__([a-z]+(?:-[a-z]+)*)(?:--|$)/;

// ── Provider ────────────────────────────────────────────────────────────────

export class CssClassnameProvider implements EvidenceProvider {
  name = 'css-classname';

  onEvent(event: RecordedEvent, _buffer: InteractionBuffer): Evidence[] {
    if (event.eventType === 'navigation') return [];

    const className = event.target?.className;
    if (!className) return [];

    // Split into individual class tokens
    const classes = className.split(/\s+/).filter(Boolean);
    if (classes.length === 0) return [];

    const evidence: Evidence[] = [];
    const seenTypes = new Set<string>(); // avoid duplicate suggestions for the same type

    for (const cls of classes) {
      const match = this.matchClass(cls);
      if (!match) continue;

      // Skip if we already have evidence for this type from this provider
      const typeKey = match.type;
      if (seenTypes.has(typeKey)) continue;
      seenTypes.add(typeKey);

      // Gate click-type suggestions on click events only
      if (
        CLICK_TYPE_INTERACTIONS.has(typeKey) &&
        event.eventType !== 'click' &&
        event.eventType !== 'auxclick'
      ) {
        continue;
      }

      evidence.push({
        provider: this.name,
        suggestedType: match.type,
        confidence: match.confidence,
        weight: match.weight,
        reason: `CSS class "${cls}" detected (${match.framework} pattern)`,
      });
    }

    return evidence;
  }

  /**
   * Try to match a class name against known framework patterns.
   * Returns null if no match is found.
   */
  private matchClass(cls: string): { type: InteractionType; confidence: number; weight: number; framework: string } | null {
    // ── MUI ──
    const muiMatch = cls.match(MUI_PATTERN);
    if (muiMatch) {
      const componentName = muiMatch[1];
      const mapping = MUI_COMPONENT_MAP[componentName];
      if (mapping) {
        return { ...mapping, framework: 'MUI' };
      }
    }

    // ── AntD ──
    const antdMatch = cls.match(ANTD_PATTERN);
    if (antdMatch) {
      const componentName = antdMatch[1];
      const mapping = ANTD_COMPONENT_MAP[componentName];
      if (mapping) {
        return { ...mapping, framework: 'AntD' };
      }
    }

    // ── Bootstrap ──
    // First check exact matches (form-check-input, dropdown-item, nav-link, etc.)
    if (cls in BOOTSTRAP_CLASS_MAP) {
      return { ...BOOTSTRAP_CLASS_MAP[cls], framework: 'Bootstrap' };
    }
    // Then check btn-* prefix pattern
    if (BOOTSTRAP_PATTERN.test(cls)) {
      return { ...BOOTSTRAP_CLASS_MAP['btn'], framework: 'Bootstrap' };
    }

    // ── Headless UI ──
    const headlessMatch = cls.match(HEADLESS_UI_PATTERN);
    if (headlessMatch) {
      const componentName = headlessMatch[1];
      const mapping = HEADLESS_UI_MAP[componentName];
      if (mapping) {
        return { ...mapping, framework: 'Headless UI' };
      }
    }

    // ── React-Select ──
    const reactSelectMatch = cls.match(REACT_SELECT_PATTERN);
    if (reactSelectMatch) {
      const partName = reactSelectMatch[2];
      const mapping = REACT_SELECT_MAP[partName];
      if (mapping) {
        return { ...mapping, framework: 'React-Select' };
      }
    }

    // ── react-datepicker ──
    const datepickerMatch = cls.match(REACT_DATEPICKER_PATTERN);
    if (datepickerMatch) {
      const partName = datepickerMatch[1];
      const mapping = REACT_DATEPICKER_MAP[partName];
      if (mapping) {
        return { ...mapping, framework: 'react-datepicker' };
      }
    }

    // ── Generic patterns ──
    // Catches React-Select, Downshift, Google Flights, and other libraries
    // that use 'autocomplete', 'typeahead', 'combobox', or 'suggestion' class names.
    const lower = cls.toLowerCase();
    if (lower.includes('autocomplete') || lower.includes('typeahead')) {
      return { type: 'Autocomplete' as InteractionType, confidence: 0.7, weight: 0.65, framework: 'Generic' };
    }
    if (lower.includes('combobox') && lower !== 'combobox') {
      return { type: 'Autocomplete' as InteractionType, confidence: 0.65, weight: 0.6, framework: 'Generic' };
    }
    // Generic toggle/switch patterns
    if (lower.includes('toggle-switch') || lower.includes('toggle-button') || lower.includes('switch-input')) {
      return { type: 'ToggleSwitch' as InteractionType, confidence: 0.75, weight: 0.7, framework: 'Generic' };
    }
    // Generic slider patterns (catches custom sliders without ARIA)
    if (lower.includes('range-slider') || lower === 'slider') {
      return { type: 'Slider' as InteractionType, confidence: 0.75, weight: 0.7, framework: 'Generic' };
    }
    // Generic tab patterns
    if (lower === 'tab-item' || lower === 'tab-header') {
      return { type: 'Tab' as InteractionType, confidence: 0.7, weight: 0.65, framework: 'Generic' };
    }
    // Generic datetime picker patterns (must check BEFORE time picker — "datetimepicker" contains "timepicker")
    if (lower.includes('datetimepicker') || lower.includes('datetime-picker') || lower.includes('date-time-picker')) {
      return { type: 'DateTimePicker' as InteractionType, confidence: 0.75, weight: 0.7, framework: 'Generic' };
    }
    // Generic time picker patterns
    if (lower.includes('timepicker') || lower.includes('time-picker')) {
      return { type: 'TimePicker' as InteractionType, confidence: 0.75, weight: 0.7, framework: 'Generic' };
    }
    // Generic dropzone / drag-drop upload patterns (must check before generic upload)
    if (lower.includes('dropzone') || lower.includes('drop-zone') || lower.includes('file-drop') || lower.includes('upload-drop')) {
      return { type: 'DragDropUpload' as InteractionType, confidence: 0.75, weight: 0.7, framework: 'Generic' };
    }
    // Generic upload area / file upload patterns
    if (lower.includes('upload-area') || lower.includes('upload-zone') || lower.includes('file-upload') || lower.includes('fileinput')) {
      return { type: 'FileUpload' as InteractionType, confidence: 0.7, weight: 0.65, framework: 'Generic' };
    }
    // Generic breadcrumb patterns — checked before generic menu/nav to avoid
    // the 'nav' substring matching before 'breadcrumb' is tested
    if (lower.includes('breadcrumb') || lower.includes('crumb')) {
      return { type: 'Breadcrumb' as InteractionType, confidence: 0.75, weight: 0.7, framework: 'Generic' };
    }
    // Generic navigation menu patterns (navbar/sidebar menu items, not dropdown menus)
    if (lower.includes('navbar-item') || lower.includes('sidebar-item') || lower.includes('menu-link') || lower.includes('nav-menu')) {
      return { type: 'Menu' as InteractionType, confidence: 0.7, weight: 0.65, framework: 'Generic' };
    }

    // ── Expanded generic patterns for custom controls ──
    // These catch custom div-based dropdowns, date pickers, and option lists
    // that don't use a recognized framework but DO include semantic words in their
    // class names. Confidence/weight kept below framework-specific (0.8+) to ensure
    // stronger evidence from AriaProvider/DomProvider wins when both are present.

    // CSS-in-JS hashed classes (emotion, styled-components) — explicitly excluded.
    // Pattern: "css-" followed by alphanumeric hash, with no semantic word elsewhere.
    // We check this BEFORE the generic patterns so "css-1abc2de" is never falsely matched.
    if (/^css-[a-z0-9]+$/i.test(cls)) {
      return null;
    }

    // Generic dropdown patterns — catches custom dropdowns with semantic class names
    // e.g. "dropdown-trigger", "dropdown-menu", "custom-select", "select-option",
    // "listbox-option", "combo-input"
    if (
      lower.includes('dropdown-trigger') || lower.includes('dropdown-toggle') ||
      lower.includes('dropdown-menu') || lower.includes('dropdown-list') ||
      lower.includes('dropdown-item') || lower.includes('dropdown-option') ||
      lower === 'dropdown' || lower === 'listbox' ||
      lower.includes('select-option') || lower.includes('select-item') ||
      lower.includes('list-option') || lower.includes('combo-box')
    ) {
      return { type: 'CustomDropdown' as InteractionType, confidence: 0.65, weight: 0.6, framework: 'Generic' };
    }

    // Generic calendar / date picker patterns — catches custom date pickers
    // e.g. "calendar-day", "date-cell", "datepicker-day", "picker-day",
    // "calendar-grid", "date-selector"
    if (
      lower.includes('calendar-day') || lower.includes('calendar-cell') ||
      lower.includes('date-cell') || lower.includes('datepicker-day') ||
      lower.includes('picker-day') || lower.includes('calendar-grid') ||
      lower.includes('date-grid') || lower.includes('date-selector') ||
      lower.includes('day-cell') || lower.includes('calendar-container')
    ) {
      return { type: 'DatePicker' as InteractionType, confidence: 0.7, weight: 0.65, framework: 'Generic' };
    }

    // Generic menu-item / option-item patterns — catches options in custom popovers
    if (
      lower.includes('menu-item') || lower.includes('option-item') ||
      lower.includes('list-item-option') || lower.includes('suggestion-item')
    ) {
      return { type: 'CustomDropdown' as InteractionType, confidence: 0.65, weight: 0.6, framework: 'Generic' };
    }

    return null;
  }
}
