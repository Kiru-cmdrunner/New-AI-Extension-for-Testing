/**
 * Pattern Registry — Central catalog of framework and domain-specific
 * CSS class patterns, organized in three tiers:
 *
 * 1. GENERIC: Cross-framework conventions that apply to all web apps.
 *    These are the defaults baked into the core definitions.
 *
 * 2. FRAMEWORK: Stable class-name contracts from component libraries
 *    (MUI, Ant Design, OXD, PrimeReact, Bootstrap, etc.).
 *    Registered as named plugins.
 *
 * 3. DOMAIN: Business-domain vocabulary specific to a website or industry
 *    (AdaniOne travel/flight terms, e-commerce terms, etc.).
 *    Registered as named plugins.
 *
 * Architecture: §4 (Pattern Extensibility)
 *
 * Usage:
 *   import { PatternRegistry } from './pattern-registry';
 *
 *   PatternRegistry.isInteractiveClass('btn fare-option'); // true
 *   PatternRegistry.isDropdownTriggerClass('select oxd-select-text'); // true
 *
 * To add patterns for a new application or framework:
 *   PatternRegistry.registerPlugin({
 *     name: 'myApp',
 *     interactiveClasses: ['my-interactive'],
 *     dropdownTriggerClasses: ['my-select'],
 *     ...
 *   });
 */

// ── Pattern Categories ────────────────────────────────────────────────

export interface FrameworkPatterns {
  /** Name of the framework or domain (e.g., 'MUI', 'OXD', 'AdaniOne'). */
  name: string;

  /** CSS class patterns that indicate an interactive element. */
  interactiveClasses?: string[];

  /** CSS class patterns for dropdown trigger elements. */
  dropdownTriggerClasses?: string[];

  /** CSS class patterns for dropdown option elements. */
  dropdownOptionClasses?: string[];

  /** CSS class patterns for dropdown surface containers. */
  dropdownSurfaceClasses?: string[];

  /** CSS class patterns for date picker trigger elements. */
  datePickerTriggerClasses?: string[];

  /** CSS class patterns for calendar day/cell elements. */
  datePickerCellClasses?: string[];

  /** CSS class patterns for calendar surface containers. */
  calendarSurfaceClasses?: string[];

  /** CSS class patterns for calendar navigation buttons (prev/next). */
  calendarNavButtonClasses?: string[];

  /** CSS class patterns for checkbox wrapper elements. */
  checkboxWrapperClasses?: string[];

  /** CSS class patterns for radio button wrapper elements. */
  radioWrapperClasses?: string[];

  /** CSS class patterns for stepper plus/increment buttons. */
  stepperPlusClasses?: string[];

  /** CSS class patterns for stepper minus/decrement buttons. */
  stepperMinusClasses?: string[];

  /** CSS class patterns for display-value elements (SPA selected value). */
  displayValueClasses?: string[];
}

// ── Generic Defaults ──────────────────────────────────────────────────

/**
 * These are the cross-framework, cross-domain defaults.
 * They represent structural conventions that are universal across
 * modern web applications — not tied to any specific library or site.
 */
const GENERIC_PATTERNS: FrameworkPatterns = {
  name: 'generic',
  interactiveClasses: [
    'btn', 'button', 'clickable', 'selectable', 'dropdown', 'menu-item',
    'nav-item', 'tab-item', 'chip', 'toggle', 'action', 'stepper',
    'counter', 'increment', 'decrement', 'qty', 'quantity', 'plus', 'minus',
    'add-btn', 'remove-btn', 'arrow', 'chevron', 'expand', 'collapse',
    'option', 'menuitem', 'choice', 'pickable', 'tile',
  ],
  dropdownTriggerClasses: [
    'select', 'combobox', 'dropdown', 'selector',
  ],
  dropdownOptionClasses: [
    'select-option', 'option-item', 'list-option', 'selectable-item',
    'choice-item', 'chip-option', 'ant-select-item',
  ],
  dropdownSurfaceClasses: [
    'select-dropdown', 'listbox', 'dropdown-menu', 'popover', 'overlay',
    'popup', 'drawer-content', 'sheet-content', 'bottom-sheet', 'modal-body',
  ],
  datePickerTriggerClasses: [
    'datepicker', 'date-picker', 'date-input', 'calendar-input',
  ],
  datePickerCellClasses: [
    'calendar-day', 'datepicker-day', 'day-cell', 'date-day', 'calendar-date',
    'picker-day', 'cell-day', 'day-number', 'calendar-number', 'date-number',
    'flatpickr-day', 'react-datepicker__day',
  ],
  calendarSurfaceClasses: [
    'calendar', 'datepicker', 'date-picker-dropdown', 'date-dropdown',
    'date-picker-panel', 'calendar-panel', 'picker-panel',
    'flatpickr-calendar', 'react-datepicker',
  ],
  calendarNavButtonClasses: [
    'calendar.*nav', 'datepicker.*nav', 'prev', 'next', 'today',
    'switch', 'chevron',
  ],
  checkboxWrapperClasses: [
    'checkbox.*wrapper', 'checkbox.*input', 'checkbox-input', 'custom-checkbox',
  ],
  radioWrapperClasses: [
    'radio.*wrapper', 'radio.*input', 'radio-input', 'radio-btn', 'custom-radio',
  ],
  stepperPlusClasses: [
    'plus', 'increment', 'add-btn', 'add-button', 'counter-plus',
    'stepper-plus', 'qty-plus', 'btn-plus', 'inc-btn', 'increase',
  ],
  stepperMinusClasses: [
    'minus', 'decrement', 'remove-btn', 'remove-button', 'counter-minus',
    'stepper-minus', 'qty-minus', 'btn-minus', 'dec-btn', 'decrease',
  ],
  displayValueClasses: [
    'value-display', 'display-value', 'selected-value', 'display-text',
    'field-value', 'input-value', 'selected-text', 'value-text',
    'current-value', 'date-display', 'date-value',
  ],
};

// ── Framework Plugins ─────────────────────────────────────────────────

const MUI_PATTERNS: FrameworkPatterns = {
  name: 'MUI',
  interactiveClasses: [],
  dropdownTriggerClasses: ['MuiSelect'],
  dropdownOptionClasses: ['MuiMenuItem'],
  dropdownSurfaceClasses: ['MuiMenu-paper', 'MuiPopover-paper'],
  datePickerTriggerClasses: ['MuiDatePicker'],
  datePickerCellClasses: ['MuiPickersDay'],
  calendarSurfaceClasses: ['MuiCalendarPicker'],
  checkboxWrapperClasses: ['MuiCheckbox-root'],
  radioWrapperClasses: ['MuiRadio-root'],
};

const ANT_PATTERNS: FrameworkPatterns = {
  name: 'AntDesign',
  dropdownTriggerClasses: ['ant-select'],
  dropdownOptionClasses: ['ant-select-item'],
  dropdownSurfaceClasses: ['ant-select-dropdown'],
  datePickerTriggerClasses: ['ant-picker'],
  datePickerCellClasses: ['ant-picker-cell'],
  calendarSurfaceClasses: ['ant-picker-dropdown'],
};

const BOOTSTRAP_PATTERNS: FrameworkPatterns = {
  name: 'Bootstrap',
  dropdownTriggerClasses: ['dropdown-toggle'],
  dropdownOptionClasses: ['dropdown-item'],
  dropdownSurfaceClasses: ['dropdown-menu', 'dropdown'],
};

const OXD_PATTERNS: FrameworkPatterns = {
  name: 'OXD',
  dropdownTriggerClasses: ['oxd-select-text', 'oxd-select-text-input', 'oxd-select-wrapper'],
  dropdownOptionClasses: ['oxd-select-option'],
  dropdownSurfaceClasses: ['oxd-select-dropdown'],
  datePickerTriggerClasses: ['oxd-date-input', 'oxd-date-picker', 'oxd-date-wrapper'],
  datePickerCellClasses: ['oxd-date-day'],
  calendarSurfaceClasses: ['oxd-date-input-dropdown', 'oxd-calendar'],
  calendarNavButtonClasses: ['oxd-calendar-switch-button'],
  checkboxWrapperClasses: ['oxd-checkbox-wrapper', 'oxd-checkbox-input'],
  radioWrapperClasses: ['oxd-radio-wrapper'],
};

const PRIMEREACT_PATTERNS: FrameworkPatterns = {
  name: 'PrimeReact',
  dropdownTriggerClasses: ['p-dropdown'],
  dropdownOptionClasses: ['p-dropdown-item'],
  datePickerTriggerClasses: ['p-calendar'],
};

const AGGRID_PATTERNS: FrameworkPatterns = {
  name: 'AGGrid',
  interactiveClasses: [
    'ag-header-cell',
    'ag-header-cell-label',
    'ag-row',
    'ag-cell-focus',
    'ag-cell-range-selected',
  ],
  // AGGrid uses native browser controls for cell editing, not custom
  // dropdowns or date pickers. No dropdown/date patterns needed.
};

// ── Domain Plugins ────────────────────────────────────────────────────

const ADANIONE_PATTERNS: FrameworkPatterns = {
  name: 'AdaniOne',
  interactiveClasses: ['fare-option', 'class-option', 'travel-class'],
  dropdownTriggerClasses: [
    'traveler', 'traveller', 'passenger', 'pax', 'cabin',
    'class-selector', 'trip-type', 'economy', 'journey-type',
    'fare-type', 'travel-class',
  ],
  dropdownOptionClasses: [
    'pax-option', 'class-option', 'fare-option', 'travel-class-option',
    'tile-option', 'radio-tile',
  ],
  stepperPlusClasses: ['pax-plus'],
  stepperMinusClasses: ['pax-minus'],
  datePickerTriggerClasses: [
    'depart-on', 'departure-date', 'return-on', 'arrival-date',
    'journey-date', 'travel-date', 'trip-date',
  ],
  displayValueClasses: ['city-name', 'airport-name'],
};

// ── Registry ──────────────────────────────────────────────────────────

/**
 * Central pattern registry. Merges generic defaults with all registered
 * framework and domain plugins into a single set of compiled patterns.
 *
 * The registry is a singleton — plugins are registered once at module
 * load time and the merged patterns are compiled lazily on first access.
 */
export class PatternRegistry {
  private static plugins: FrameworkPatterns[] = [];
  private static merged: FrameworkPatterns | null = null;

  /**
   * Register a new pattern plugin. Call once at module load.
   * Invalidates the cached merged patterns.
   */
  static registerPlugin(patterns: FrameworkPatterns): void {
    PatternRegistry.plugins.push(patterns);
    PatternRegistry.merged = null;
  }

  /**
   * Register multiple plugins at once.
   */
  static registerPlugins(patterns: FrameworkPatterns[]): void {
    PatternRegistry.plugins.push(...patterns);
    PatternRegistry.merged = null;
  }

  /**
   * Get the merged pattern set (generic defaults + all registered plugins).
   * The merge is cached after first computation.
   */
  static getMerged(): FrameworkPatterns {
    if (PatternRegistry.merged) return PatternRegistry.merged;

    // Start with generic defaults
    const merged: FrameworkPatterns = {
      name: 'merged',
      interactiveClasses: [...(GENERIC_PATTERNS.interactiveClasses ?? [])],
      dropdownTriggerClasses: [...(GENERIC_PATTERNS.dropdownTriggerClasses ?? [])],
      dropdownOptionClasses: [...(GENERIC_PATTERNS.dropdownOptionClasses ?? [])],
      dropdownSurfaceClasses: [...(GENERIC_PATTERNS.dropdownSurfaceClasses ?? [])],
      datePickerTriggerClasses: [...(GENERIC_PATTERNS.datePickerTriggerClasses ?? [])],
      datePickerCellClasses: [...(GENERIC_PATTERNS.datePickerCellClasses ?? [])],
      calendarSurfaceClasses: [...(GENERIC_PATTERNS.calendarSurfaceClasses ?? [])],
      calendarNavButtonClasses: [...(GENERIC_PATTERNS.calendarNavButtonClasses ?? [])],
      checkboxWrapperClasses: [...(GENERIC_PATTERNS.checkboxWrapperClasses ?? [])],
      radioWrapperClasses: [...(GENERIC_PATTERNS.radioWrapperClasses ?? [])],
      stepperPlusClasses: [...(GENERIC_PATTERNS.stepperPlusClasses ?? [])],
      stepperMinusClasses: [...(GENERIC_PATTERNS.stepperMinusClasses ?? [])],
      displayValueClasses: [...(GENERIC_PATTERNS.displayValueClasses ?? [])],
    };

    // Merge each plugin's patterns into the merged set
    for (const plugin of PatternRegistry.plugins) {
      for (const key of Object.keys(plugin) as (keyof FrameworkPatterns)[]) {
        if (key === 'name') continue;
        const pluginVal = plugin[key];
        if (!pluginVal) continue;
        const mergedVal = merged[key];
        if (Array.isArray(pluginVal) && Array.isArray(mergedVal)) {
          // Merge arrays, dedup
          const set = new Set([...mergedVal, ...pluginVal]);
          (merged[key] as unknown[]) = [...set];
        }
      }
    }

    PatternRegistry.merged = merged;
    return merged;
  }

  // ── Convenience methods ────────────────────────────────────────────

  /**
   * Build a case-insensitive regex from an array of class patterns.
   *
   * Uses word boundaries (\b) to prevent false-positive substring matches
   * (e.g., pattern "select" should match "MuiSelect" but not "preselected").
   * The word boundary before the pattern requires a non-word character (or
   * string start) immediately before the match, and \b after requires a
   * non-word character (or string end) immediately after.
   *
   * NOTE: CSS class names are separated by spaces in the className string,
   * so \b correctly matches at class-name boundaries. Hyphenated class
   * segments (e.g., "dropdown-toggle") use \b at the hyphen boundary.
   *
   * Regex results are cached per patterns-array-key to avoid recompilation.
   * Cache is invalidated when registerPlugin nullifies the merged set.
   */
  private static regexCache = new Map<string, RegExp>();

  private static buildRegex(patterns: string[]): RegExp | null {
    if (patterns.length === 0) return null;
    const key = patterns.join('\0');
    const cached = PatternRegistry.regexCache.get(key);
    if (cached) return cached;

    const escaped = patterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(`(?:\\b${escaped.join('|')}\\b)`, 'i');
    PatternRegistry.regexCache.set(key, regex);
    return regex;
  }

  /** Check if a className string matches any interactive class pattern. */
  static isInteractiveClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().interactiveClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /** Check if a className string matches any dropdown trigger pattern. */
  static isDropdownTriggerClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().dropdownTriggerClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /** Check if a className string matches any dropdown option pattern. */
  static isDropdownOptionClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().dropdownOptionClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /** Check if a className string matches any dropdown surface pattern. */
  static isDropdownSurfaceClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().dropdownSurfaceClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /** Check if a className string matches any date picker trigger pattern. */
  static isDatePickerTriggerClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().datePickerTriggerClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /** Check if a className string matches any calendar cell pattern. */
  static isDatePickerCellClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().datePickerCellClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /** Check if a className string matches any calendar surface pattern. */
  static isCalendarSurfaceClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().calendarSurfaceClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /** Check if a className string matches any stepper plus button pattern. */
  static isStepperPlusClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().stepperPlusClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /** Check if a className string matches any stepper minus button pattern. */
  static isStepperMinusClass(className: string): boolean {
    const patterns = PatternRegistry.getMerged().stepperMinusClasses ?? [];
    const regex = PatternRegistry.buildRegex(patterns);
    return regex ? regex.test(className) : false;
  }

  /**
   * Initialize the registry with all built-in framework and domain plugins.
   * Call once at application startup.
   */
  static init(): void {
    PatternRegistry.registerPlugins([
      MUI_PATTERNS,
      ANT_PATTERNS,
      BOOTSTRAP_PATTERNS,
      OXD_PATTERNS,
      PRIMEREACT_PATTERNS,
      AGGRID_PATTERNS,
      ADANIONE_PATTERNS,
    ]);
  }
}

// Auto-initialize on module import
PatternRegistry.init();
