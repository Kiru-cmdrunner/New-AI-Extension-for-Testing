/**
 * DOM Structure Provider
 *
 * Observes the element's HTML tag name and input type to contribute evidence.
 * This is the most reliable provider for native HTML elements — tag names are
 * 100% stable across all frameworks and libraries.
 *
 * Strengths: <select>, <input type="checkbox/radio/file/date">, <button>, <a>,
 *            <textarea>, <dialog>
 * Weaknesses: Useless for div-based custom widgets
 *
 * DOM Context: When event.domContext is available, uses inputType directly
 * (captured at event time from el.type) instead of regex-hacking cssSelector.
 * Falls back to cssSelector parsing for events without domContext (backwards compat).
 */

import type { InteractionType, InteractionMetadata } from '../../interaction-types.ts';
import type { RecordedEvent, DomContext } from '../../../recorder/recorded-event.ts';
import type { Evidence, EvidenceProvider, InteractionBuffer } from '../types.ts';

export class DomProvider implements EvidenceProvider {
  name = 'dom';

  onEvent(event: RecordedEvent, _buffer: InteractionBuffer): Evidence[] {
    if (event.eventType === 'navigation') return [];

    const evidence: Evidence[] = [];
    const tag = event.target.tag.toUpperCase();
    const cssSelector = event.target.cssSelector || '';
    const name = event.target.name || '';
    const domCtx = event.domContext;
    const role = (event.target.ariaRole || '').toLowerCase();

    // ── Native <select> → NativeDropdown ──
    if (tag === 'SELECT') {
      evidence.push({
        provider: this.name,
        suggestedType: 'NativeDropdown' as InteractionType,
        confidence: 0.99,
        weight: 1.0,
        metadata: extractValueMetadata(event),
        reason: `Native <select> element detected`,
      });
    }

    // ── Native checkbox ──
    if (isNativeCheckbox(domCtx, cssSelector)) {
      evidence.push({
        provider: this.name,
        suggestedType: 'Checkbox' as InteractionType,
        confidence: 0.99,
        weight: 1.0,
        metadata: extractCheckedMetadata(event),
        reason: `Native checkbox input detected`,
      });
    }

    // ── Native radio ──
    if (isNativeRadio(domCtx, cssSelector)) {
      const radioMeta = extractCheckedMetadata(event);
      // Map the selected radio's accessibleName to selectedValue
      if (event.target.accessibleName) radioMeta.selectedValue = event.target.accessibleName;
      evidence.push({
        provider: this.name,
        suggestedType: 'RadioButton' as InteractionType,
        confidence: 0.99,
        weight: 1.0,
        metadata: radioMeta,
        reason: `Native radio input detected`,
      });
    }

    // ── Native range/slider input ──
    if (isNativeRangeInput(domCtx, cssSelector)) {
      evidence.push({
        provider: this.name,
        suggestedType: 'Slider' as InteractionType,
        confidence: 0.99,
        weight: 1.0,
        metadata: extractSliderMetadata(event, domCtx),
        reason: `Native range input detected (type=range)`,
      });
    }

    // ── Custom slider via ARIA role="slider" ──
    // MUI Slider, AntD Slider, React Aria Slider all use span[role="slider"]
    // with aria-valuenow/aria-valuemin/aria-valuemax. DomContext captures these.
    if (
      !isNativeRangeInput(domCtx, cssSelector) && // don't double-emit for native
      role === 'slider' &&
      domCtx?.ariaValueNow !== undefined && domCtx.ariaValueNow !== null
    ) {
      evidence.push({
        provider: this.name,
        suggestedType: 'Slider' as InteractionType,
        confidence: 0.9,
        weight: 0.9,
        metadata: extractSliderMetadata(event, domCtx),
        reason: `Custom slider detected (role=slider, aria-valuenow=${domCtx.ariaValueNow})`,
      });
    }

    // ── Native date/time inputs ──
    const dateType = detectNativeDateInput(domCtx, cssSelector);
    if (dateType) {
      evidence.push({
        provider: this.name,
        suggestedType: dateType,
        confidence: 0.99,
        weight: 1.0,
        metadata: extractDateTimeMetadata(dateType, event),
        reason: `Native ${dateType} input detected (inputType=${domCtx?.inputType ?? 'unknown'})`,
      });
    }

    // ── dateSelect event type (from recorder date picker pipeline) ──
    // When the recorder detects a date picker interaction, it emits a
    // dateSelect event with normalized metadata in domContext. This is
    // higher-confidence than tag/attribute detection.
    if (event.eventType === 'dateSelect' && domCtx?.dateType) {
      const pickerType: InteractionType =
        domCtx.dateType === 'time' ? 'TimePicker' as InteractionType
        : domCtx.dateType === 'dateTime' ? 'DateTimePicker' as InteractionType
        : 'DatePicker' as InteractionType;
      const meta: InteractionMetadata = {};
      const isoVal = domCtx.isoValue || event.valueAfter || '';
      if (isoVal) {
        if (pickerType === 'TimePicker') meta.timeValue = isoVal;
        else if (pickerType === 'DateTimePicker') meta.dateTimeValue = isoVal;
        else meta.dateValue = isoVal;
      }
      if (domCtx.displayValue) meta.displayValue = domCtx.displayValue;
      if (domCtx.dateAmbiguous) meta.dateAmbiguous = domCtx.dateAmbiguous;
      evidence.push({
        provider: this.name,
        suggestedType: pickerType,
        confidence: domCtx.dateConfidence ?? 1.0,
        weight: 1.0,
        metadata: meta,
        reason: `dateSelect event with dateType=${domCtx.dateType}, isoValue=${isoVal}`,
      });
    }

    // ── Native file input ──
    if (isFileInput(domCtx, cssSelector, name)) {
      evidence.push({
        provider: this.name,
        suggestedType: 'FileUpload' as InteractionType,
        confidence: 0.95,
        weight: 0.9,
        metadata: extractFileMetadata(domCtx),
        reason: `File input detected (type=file or name contains file/upload)`,
      });
    }

    // ── Drop event with files → DragDropUpload ──
    // Files dragged from the OS into the browser appear in domContext.fileData.
    // This is a drag-drop file upload, distinct from element drag-drop (which
    // has a preceding dragstart on an in-page element).
    if (event.eventType === 'drop' && domCtx?.fileData && domCtx.fileData.length > 0) {
      const meta = extractFileMetadata(domCtx);
      evidence.push({
        provider: this.name,
        suggestedType: 'DragDropUpload' as InteractionType,
        confidence: 0.95,
        weight: 0.9,
        metadata: meta,
        reason: `Drop event with ${domCtx.fileData.length} file(s) — drag-drop file upload`,
      });
    }

    // ── Native <button> ──
    // Only suggest Click for click events — a mouseenter on a button is a Hover.
    if (tag === 'BUTTON' && (event.eventType === 'click' || event.eventType === 'auxclick')) {
      evidence.push({
        provider: this.name,
        suggestedType: 'Click' as InteractionType,
        confidence: 0.8,
        weight: 0.8,
        metadata: extractNameMetadata(event),
        reason: `Native <button> element detected`,
      });
    }

    // ── Native <a> link ──
    // Only suggest Link for click events — a mouseenter on an <a> is a Hover,
    // not a Link interaction. The interaction type is driven by the user's
    // action; the element type is metadata.
    // Skip if the element has breadcrumb or nav-menu CSS classes — those are
    // more specific navigation types (checked below).
    {
      const lowerClass = (event.target.className || '').toLowerCase();
      const isBreadcrumb = lowerClass.includes('breadcrumb') || lowerClass.includes('crumb');
      const isNavMenu = lowerClass.includes('navbar-item') || lowerClass.includes('sidebar-item') ||
        lowerClass.includes('menu-link') || lowerClass.includes('nav-menu');
      if (tag === 'A' && !isBreadcrumb && !isNavMenu &&
          (event.eventType === 'click' || event.eventType === 'auxclick')) {
        evidence.push({
          provider: this.name,
          suggestedType: 'Link' as InteractionType,
          confidence: 0.9,
          weight: 0.8,
          metadata: {},
          reason: `Native <a> link element detected`,
        });
      }
    }

    // ── Breadcrumb link ──
    // CSS classes containing "breadcrumb" or "crumb" identify breadcrumb
    // navigation elements. This must be checked separately from Link so
    // breadcrumb clicks get the more specific Breadcrumb type.
    {
      const className = (event.target.className || '').toLowerCase();
      if (className.includes('breadcrumb') || className.includes('crumb')) {
        if (event.eventType === 'click' || event.eventType === 'auxclick') {
          evidence.push({
            provider: this.name,
            suggestedType: 'Breadcrumb' as InteractionType,
            confidence: 0.85,
            weight: 0.8,
            metadata: extractNameMetadata(event),
            reason: `Breadcrumb element detected (CSS class contains breadcrumb/crumb)`,
          });
        }
      }
    }

    // ── Navigation menu item ──
    // CSS classes for navigation menu items (navbar, sidebar, nav menu).
    // These are distinct from dropdown menu items (CustomDropdown context).
    {
      const className = (event.target.className || '').toLowerCase();
      if ((className.includes('navbar-item') || className.includes('sidebar-item') ||
           className.includes('menu-link') || className.includes('nav-menu')) &&
          (event.eventType === 'click' || event.eventType === 'auxclick')) {
        evidence.push({
          provider: this.name,
          suggestedType: 'Menu' as InteractionType,
          confidence: 0.75,
          weight: 0.7,
          metadata: extractNameMetadata(event),
          reason: `Navigation menu element detected`,
        });
      }
    }

    // ── Browser Alert (native alert/confirm/prompt triggered by click) ──
    {
      const dialog = domCtx?.triggeredDialog;
      if (dialog && (event.eventType === 'click' || event.eventType === 'auxclick')) {
        const meta: Partial<InteractionMetadata> = {
          dialogType: dialog,
        };
        if (domCtx?.dialogMessage) meta.dialogMessage = domCtx.dialogMessage;
        if (domCtx?.dialogResult !== undefined && domCtx?.dialogResult !== null) {
          meta.dialogResult = domCtx.dialogResult;
        }
        evidence.push({
          provider: this.name,
          suggestedType: 'BrowserAlert' as InteractionType,
          confidence: 0.98,
          weight: 1.0,
          metadata: meta,
          reason: `Browser ${dialog} dialog triggered by click`,
        });
      }
    }

    // ── New Tab / New Window ──
    {
      if ((event.eventType === 'click' || event.eventType === 'auxclick')) {
        const meta: Partial<InteractionMetadata> = {};
        if (domCtx?.openedUrl) meta.openedUrl = domCtx.openedUrl;
        if (event.target.accessibleName) meta.accessibleName = event.target.accessibleName;

        if (domCtx?.opensNewWindow) {
          evidence.push({
            provider: this.name,
            suggestedType: 'NewWindow' as InteractionType,
            confidence: 0.98,
            weight: 1.0,
            metadata: meta,
            reason: `Click opens new window (window.open with features)`,
          });
        } else if (domCtx?.opensNewTab) {
          evidence.push({
            provider: this.name,
            suggestedType: 'NewTab' as InteractionType,
            confidence: 0.98,
            weight: 1.0,
            metadata: meta,
            reason: `Click opens new tab (target=_blank or window.open)`,
          });
        }
      }
    }

    // ── Calendar cell clicks (gridcell role, calendar/day class patterns) ──
    if (isCalendarCellElement(domCtx, tag, event)) {
      // Extract date from accessibleName or value
      const dateValue = event.target.accessibleName || '';
      evidence.push({
        provider: this.name,
        suggestedType: 'DatePicker' as InteractionType,
        confidence: 0.9,
        weight: 1.0,
        metadata: dateValue ? { dateValue } : {},
        reason: `Calendar cell detected (role=gridcell or calendar class pattern)`,
      });
    }

    // ── Native <datalist> autocomplete ──
    // <input list="browsers"> associated with a <datalist> — native browser autocomplete.
    // Also catches CSS class-based autocomplete/typeahead inputs (React-Select, Downshift).
    if (domCtx?.listId && tag === 'INPUT') {
      evidence.push({
        provider: this.name,
        suggestedType: 'Autocomplete' as InteractionType,
        confidence: 0.75,
        weight: 0.7,
        metadata: event.valueAfter ? { textValue: event.valueAfter } : {},
        reason: `Native <datalist> autocomplete input (list="${domCtx.listId}") detected`,
      });
    }

    // ── CSS class-based autocomplete / typeahead ──
    // Input elements with autocomplete/typeahead class names — catches frameworks
    // that don't use aria-autocomplete (React-Select, Downshift, Google Flights).
    {
      const className = (event.target.className || '').toLowerCase();
      if (tag === 'INPUT' && (className.includes('autocomplete') || className.includes('typeahead'))) {
        evidence.push({
          provider: this.name,
          suggestedType: 'Autocomplete' as InteractionType,
          confidence: 0.7,
          weight: 0.65,
          metadata: event.valueAfter ? { textValue: event.valueAfter } : {},
          reason: `Autocomplete/typeahead CSS class detected on input element`,
        });
      }
    }

    // ── Text input / textarea ──
    // Skip if this element has combobox/dropdown semantics — it's a dropdown
    // trigger that happens to use an <input>, not a pure text field.
    // The AriaProvider will classify it as CustomDropdown.
    // Also skip if it has a datalist (native autocomplete — handled above).
    if (!hasComboboxSemantics(domCtx, event) && !domCtx?.listId && isTextEntryElement(domCtx, tag, cssSelector)) {
      evidence.push({
        provider: this.name,
        suggestedType: 'TextEntry' as InteractionType,
        confidence: 0.85,
        weight: 0.8,
        metadata: extractValueMetadata(event),
        reason: `Text entry element (${tag}) detected`,
      });
    }

    // ── Data-attribute structural heuristics ──
    // When no native tag, ARIA role, or CSS class signal is present, data
    // attributes (data-testid, data-cy, data-qa) can carry semantic hints.
    // This is the weakest detection layer — low confidence/weight, only useful
    // as supplementary evidence or a tiebreaker when other providers are silent.
    const dataAttrEvidence = detectDataAttributeHints(event);
    if (dataAttrEvidence) {
      evidence.push(dataAttrEvidence);
    }

    return evidence;
  }

  onCommit(buffer: InteractionBuffer): Evidence[] {
    const commitEvidence: Evidence[] = [];

    // ── TextEntry reinforcement: focus+blur on text element ──
    const hasFocus = buffer.events.some(e => e.eventType === 'focus');
    const hasBlur = buffer.events.some(e => e.eventType === 'blur');

    if (hasFocus && hasBlur) {
      const lastFocus = [...buffer.events].reverse().find(e => e.eventType === 'focus');
      if (lastFocus && lastFocus.eventType !== 'navigation') {
        const tag = lastFocus.target.tag.toUpperCase();
        const cssSelector = lastFocus.target.cssSelector || '';
        const domCtx = lastFocus.domContext;
        // Skip if combobox — it's a dropdown trigger, not a text field
        if (!hasComboboxSemantics(domCtx, lastFocus) && isTextEntryElement(domCtx, tag, cssSelector)) {
          const blurEvent = buffer.events.find(e => e.eventType === 'blur');
          const valueAfter = blurEvent && blurEvent.eventType !== 'navigation'
            ? blurEvent.valueAfter : undefined;
          commitEvidence.push({
            provider: this.name,
            suggestedType: 'TextEntry' as InteractionType,
            confidence: 0.9,
            weight: 0.8,
            metadata: valueAfter ? { textValue: valueAfter } : {},
            reason: 'Focus → blur sequence on text element confirms text entry',
          });
        }
      }
    }

    // ── DatePicker reinforcement: calendar trigger + cell click ──
    const hasCalendarTrigger = buffer.events.some(e => {
      if (e.eventType === 'navigation') return false;
      const domCtx = e.domContext;
      if (domCtx?.inputType) {
        const t = domCtx.inputType;
        if (t === 'date' || t === 'datetime-local' || t === 'time' || t === 'month' || t === 'week') {
          return true;
        }
      }
      const className = e.target.className || '';
      return /date.?picker|calendar|datepicker/i.test(className);
    });
    const hasCalendarCell = buffer.events.some(e => {
      if (e.eventType === 'navigation') return false;
      const role = (e.target.ariaRole || '').toLowerCase();
      const className = e.target.className || '';
      return role === 'gridcell' || /\bday\b|\bcell\b|\bdate\b|gridcell|calendar/i.test(className);
    });

    if ((hasCalendarTrigger || hasCalendarCell) && hasCalendarCell) {
      // Find the cell's accessibleName for the date value
      const cellEvent = buffer.events.find(e => {
        if (e.eventType === 'navigation') return false;
        const role = (e.target.ariaRole || '').toLowerCase();
        const className = e.target.className || '';
        return role === 'gridcell' || /\bday\b|\bcell\b|\bdate\b|gridcell|calendar/i.test(className);
      });
      const dateValue = cellEvent && cellEvent.eventType !== 'navigation'
        ? cellEvent.target.accessibleName : undefined;
      // When calendar cell is present, use higher confidence to override
      // any TextEntry evidence from the date input trigger (e.g. MUI DatePicker
      // input without type=date or date-specific className).
      commitEvidence.push({
        provider: this.name,
        suggestedType: 'DatePicker' as InteractionType,
        confidence: hasCalendarTrigger ? 0.9 : 0.85,
        weight: 1.0,
        metadata: dateValue ? { dateValue } : {},
        reason: hasCalendarTrigger
          ? 'Calendar trigger + cell click pattern confirms date selection'
          : 'Calendar cell click in buffer — date selection inferred',
      });
    }

    // ── Autocomplete reinforcement: CSS-class autocomplete with option click ──
    // When the buffer contains a typeahead/autocomplete input AND an option click,
    // extract the selectedValue from the option at commit time. This catches
    // frameworks (React-Select, Downshift) where the input has no role=combobox
    // and onEvent only captures textValue from the blur.
    const hasAutocompleteInput = buffer.events.some(e => {
      if (e.eventType === 'navigation') return false;
      const cls = (e.target.className || '').toLowerCase();
      const dc = e.domContext;
      return e.target.tag.toUpperCase() === 'INPUT' && (
        cls.includes('typeahead') || cls.includes('autocomplete') ||
        dc?.ariaAutoComplete || dc?.listId
      );
    });
    const hasOptionClick = buffer.events.some(e =>
      e.eventType !== 'navigation' &&
      (e.target.ariaRole || '').toLowerCase() === 'option' &&
      e.eventType === 'click'
    );

    if (hasAutocompleteInput && hasOptionClick) {
      const optionEvent = buffer.events.find(e =>
        e.eventType !== 'navigation' &&
        (e.target.ariaRole || '').toLowerCase() === 'option' &&
        e.eventType === 'click'
      );
      const optionName = optionEvent && optionEvent.eventType !== 'navigation'
        ? optionEvent.target.accessibleName : undefined;
      const blurEvt = [...buffer.events].reverse().find(e => e.eventType === 'blur');
      const searchText = blurEvt && blurEvt.eventType !== 'navigation'
        ? blurEvt.valueAfter : undefined;

      const metadata: Partial<InteractionMetadata> = {};
      if (searchText) metadata.textValue = searchText;
      if (optionName) metadata.selectedValue = optionName;

      commitEvidence.push({
        provider: this.name,
        suggestedType: 'Autocomplete' as InteractionType,
        confidence: 0.8,
        weight: 0.75,
        metadata,
        reason: 'Autocomplete input + option selection confirmed at commit',
      });
    }

    return commitEvidence;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection helpers — prefer domContext.inputType, fall back to cssSelector
// ─────────────────────────────────────────────────────────────────────────────

const NATIVE_DATE_PATTERN = /type=["']?(date|datetime-local|time|month|week)["']?/i;
const CHECKBOX_PATTERN = /type=["']?checkbox["']?/i;
const RADIO_PATTERN = /type=["']?radio["']?/i;
const RANGE_PATTERN = /type=["']?range["']?/i;
const TEXT_ENTRY_TAGS = new Set(['TEXTAREA']);
const TEXT_INPUT_PATTERN = /type=["']?(text|email|password|tel|url|search|number)["']?/i;

/**
 * The set of input types that represent text entry.
 * Derived from HTML spec — these are all <input> types that produce text.
 */
const TEXT_INPUT_TYPES = new Set([
  'text', 'email', 'password', 'tel', 'url', 'search', 'number',
]);

/**
 * The set of input types that represent date/time pickers.
 * Maps directly to Evidence Engine interaction types.
 */
const DATE_INPUT_TYPES: Record<string, InteractionType> = {
  'date': 'DatePicker' as InteractionType,
  'datetime-local': 'DateTimePicker' as InteractionType,
  'time': 'TimePicker' as InteractionType,
  'month': 'DatePicker' as InteractionType,
  'week': 'DatePicker' as InteractionType,
};

/**
 * Check if an element is a text-entry element.
 * Uses domContext.inputType when available, falls back to cssSelector parsing.
 */
export function isTextEntryElement(
  domCtx: DomContext | undefined,
  tag: string,
  cssSelector: string,
): boolean {
  // Prefer first-class inputType from DomContext
  if (domCtx?.inputType) {
    if (TEXT_INPUT_TYPES.has(domCtx.inputType)) return true;
  }
  // Textarea
  if (TEXT_ENTRY_TAGS.has(tag)) return true;
  // Contenteditable (via DomContext)
  if (domCtx?.isContentEditable) return true;
  // Fallback: cssSelector parsing (backwards compatibility for events without domContext)
  if (tag === 'INPUT' && TEXT_INPUT_PATTERN.test(cssSelector)) return true;
  // Input without explicit type defaults to text
  if (tag === 'INPUT' && !/type=["']?/i.test(cssSelector) && !domCtx) return true;
  // Fallback: contenteditable in cssSelector
  if (!domCtx && cssSelector.includes('contenteditable')) return true;
  return false;
}

function detectNativeDateInput(
  domCtx: DomContext | undefined,
  cssSelector: string,
): InteractionType | null {
  // Prefer first-class inputType
  if (domCtx?.inputType && domCtx.inputType in DATE_INPUT_TYPES) {
    return DATE_INPUT_TYPES[domCtx.inputType];
  }
  // Fallback: cssSelector parsing
  const match = cssSelector.match(NATIVE_DATE_PATTERN);
  if (!match) return null;
  const inputType = match[1].toLowerCase();
  return DATE_INPUT_TYPES[inputType] ?? null;
}

function isNativeCheckbox(
  domCtx: DomContext | undefined,
  cssSelector: string,
): boolean {
  // Prefer first-class inputType
  if (domCtx?.inputType === 'checkbox') return true;
  // Fallback: cssSelector parsing
  return CHECKBOX_PATTERN.test(cssSelector);
}

function isNativeRadio(
  domCtx: DomContext | undefined,
  cssSelector: string,
): boolean {
  // Prefer first-class inputType
  if (domCtx?.inputType === 'radio') return true;
  // Fallback: cssSelector parsing
  return RADIO_PATTERN.test(cssSelector);
}

function isNativeRangeInput(
  domCtx: DomContext | undefined,
  cssSelector: string,
): boolean {
  // Prefer first-class inputType
  if (domCtx?.inputType === 'range') return true;
  // Fallback: cssSelector parsing
  return RANGE_PATTERN.test(cssSelector);
}

function isFileInput(
  domCtx: DomContext | undefined,
  cssSelector: string,
  name: string,
): boolean {
  // Prefer first-class inputType
  if (domCtx?.inputType === 'file') return true;
  // Fallback: cssSelector or name
  if (/type=["']?file["']?/i.test(cssSelector)) return true;
  if (/file|upload/i.test(name)) return true;
  return false;
}

/**
 * Check if an element is a calendar cell (gridcell, day cell, calendar button).
 * Uses ariaRole when available, falls back to className patterns.
 * This complements the native date input detection — this catches calendar
 * popup cell clicks (React DatePicker, Flatpickr, etc.).
 */
function isCalendarCellElement(
  _domCtx: DomContext | undefined,
  _tag: string,
  event: RecordedEvent,
): boolean {
  if (event.eventType === 'navigation') return false;
  const role = (event.target.ariaRole || '').toLowerCase();
  const className = event.target.className || '';

  // ARIA gridcell role — used by React DatePicker, MUI DatePicker
  if (role === 'gridcell') return true;

  // Class patterns common across date picker libraries
  // Matches: react-datepicker__day, calendar-day, day-cell, date-cell, etc.
  if (/\bday\b|\bcell\b|\bdate\b|gridcell|calendar/i.test(className)) return true;

  return false;
}

/**
 * Check if an element has combobox/dropdown semantics that override text entry.
 * This prevents classifying an autocomplete search input (which IS an <input type=text>)
 * as TextEntry when it's actually a CustomDropdown trigger.
 *
 * Signals: role=combobox/listbox, aria-expanded present, or aria-haspopup present.
 */
function hasComboboxSemantics(
  domCtx: DomContext | undefined,
  event: RecordedEvent,
): boolean {
  if (event.eventType === 'navigation') return false;
  const role = (event.target.ariaRole || '').toLowerCase();
  if (role === 'combobox' || role === 'listbox') return true;

  if (domCtx) {
    if (domCtx.ariaExpanded !== null) return true;
    if (domCtx.ariaHasPopup) return true;
    if (domCtx.ariaAutoComplete) return true;
    if (domCtx.listId) return true;
  }

  // CSS class-based autocomplete/typeahead detection
  const className = (event.target.className || '').toLowerCase();
  if (className.includes('autocomplete') || className.includes('typeahead')) {
    return true;
  }

  return false;
}

function extractValueMetadata(event: RecordedEvent): Partial<InteractionMetadata> {
  if (event.eventType === 'navigation') return {};
  const meta: Partial<InteractionMetadata> = {};
  if (event.valueAfter !== null && event.valueAfter !== undefined) {
    meta.selectedValue = event.valueAfter;
    meta.dateValue = event.valueAfter;
    meta.textValue = event.valueAfter;
  }
  return meta;
}

/**
 * Extract metadata for date/time interaction types using the correct field name.
 * - DatePicker → dateValue
 * - TimePicker → timeValue
 * - DateTimePicker → dateTimeValue
 */
function extractDateTimeMetadata(
  type: InteractionType,
  event: RecordedEvent,
): Partial<InteractionMetadata> {
  if (event.eventType === 'navigation' || event.valueAfter === null || event.valueAfter === undefined) {
    return {};
  }
  const value = event.valueAfter;
  switch (type) {
    case 'DatePicker':
      return { dateValue: value };
    case 'TimePicker':
      return { timeValue: value };
    case 'DateTimePicker':
      return { dateTimeValue: value };
    default:
      return { dateValue: value };
  }
}

function extractCheckedMetadata(event: RecordedEvent): Partial<InteractionMetadata> {
  if (event.eventType === 'navigation') return {};
  const meta: Partial<InteractionMetadata> = {};
  if (event.checkedAfter !== null && event.checkedAfter !== undefined) {
    meta.checked = event.checkedAfter;
  }
  return meta;
}

function extractNameMetadata(event: RecordedEvent): Partial<InteractionMetadata> {
  if (event.eventType === 'navigation') return {};
  return event.target.accessibleName
    ? { accessibleName: event.target.accessibleName }
    : {};
}

/**
 * Extract file upload metadata from DomContext.
 * Captures file names, count, upload method, accepted types, and multiple flag.
 */
function extractFileMetadata(domCtx: DomContext | undefined): Partial<InteractionMetadata> {
  if (!domCtx) return {};
  const meta: Partial<InteractionMetadata> = {};
  if (domCtx.fileData && domCtx.fileData.length > 0) {
    meta.files = domCtx.fileData.map(f => f.name);
    meta.fileCount = domCtx.fileData.length;
  }
  if (domCtx.uploadMethod) meta.uploadMethod = domCtx.uploadMethod;
  if (domCtx.acceptedFileTypes) meta.acceptedFileTypes = domCtx.acceptedFileTypes;
  if (domCtx.multipleFiles !== undefined && domCtx.multipleFiles !== null) {
    meta.multiple = domCtx.multipleFiles;
  }
  return meta;
}

/**
 * Extract slider metadata from event + DomContext.
 * Reads aria-valuenow/aria-valuetext for custom sliders (MUI, AntD, etc.)
 * and native el.min/el.max for native range inputs.
 */
function extractSliderMetadata(
  event: RecordedEvent,
  domCtx: DomContext | undefined,
): Partial<InteractionMetadata> {
  const meta: Partial<InteractionMetadata> = {};

  // Value: prefer valueAfter (from captureValue at event time), then DomContext ARIA fields
  const val = event.valueAfter || event.valueBefore ||
    domCtx?.ariaValueText || domCtx?.ariaValueNow;
  if (val) meta.sliderValue = val;

  // Min/max: prefer DomContext ARIA fields, then native min/max
  const min = domCtx?.ariaValueMin || domCtx?.nativeMin;
  const max = domCtx?.ariaValueMax || domCtx?.nativeMax;
  if (min) meta.sliderMin = min;
  if (max) meta.sliderMax = max;

  return meta;
}

// ─────────────────────────────────────────────────────────────────────────────
// Data Attribute Heuristics — weakest detection layer, used as supplementary
// evidence when no native tag, ARIA role, or CSS class signal is available.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check data-testid, data-cy, data-qa attributes for semantic control hints.
 * These attributes are commonly used in test suites and carry semantic meaning:
 *   data-testid="city-option" → CustomDropdown
 *   data-testid="date-picker-day" → DatePicker
 *   data-testid="search-suggestion" → Autocomplete
 *
 * Only fires when the element is a generic DIV/SPAN/LI (not already detected by
 * stronger signals). Returns null for non-matching elements.
 */
function detectDataAttributeHints(event: RecordedEvent): Evidence | null {
  if (event.eventType === 'navigation') return null;

  // Collect all data attribute values
  const testId = (event.target.testId || '').toLowerCase();
  const dataCy = (event.target.dataCy || '').toLowerCase();
  const dataQa = (event.target.dataQa || '').toLowerCase();
  const combined = `${testId} ${dataCy} ${dataQa}`.trim();

  if (!combined) return null;

  // Only apply to generic container tags — stronger signals handle semantic tags
  const tag = event.target.tag.toUpperCase();
  if (!['DIV', 'SPAN', 'LI', 'UL', 'P', 'TD', 'TR'].includes(tag)) return null;

  // Dropdown option patterns in data attributes
  if (
    combined.includes('dropdown') || combined.includes('option') ||
    combined.includes('list-item') || combined.includes('menu-item') ||
    combined.includes('select-option') || combined.includes('choice')
  ) {
    return {
      provider: 'dom',
      suggestedType: 'CustomDropdown' as InteractionType,
      confidence: 0.55,
      weight: 0.5,
      metadata: event.target.accessibleName ? { selectedValue: event.target.accessibleName } : {},
      reason: `Data attribute hint: "${combined}" contains dropdown/option semantic pattern`,
    };
  }

  // Calendar/date patterns in data attributes
  if (
    combined.includes('calendar') || combined.includes('datepicker') ||
    combined.includes('date-cell') || combined.includes('day-cell') ||
    combined.includes('date-day') || combined.includes('date-picker')
  ) {
    return {
      provider: 'dom',
      suggestedType: 'DatePicker' as InteractionType,
      confidence: 0.6,
      weight: 0.55,
      metadata: event.target.accessibleName ? { dateValue: event.target.accessibleName } : {},
      reason: `Data attribute hint: "${combined}" contains calendar/date semantic pattern`,
    };
  }

  // Autocomplete/suggestion patterns in data attributes
  if (
    combined.includes('suggestion') || combined.includes('autocomplete') ||
    combined.includes('typeahead')
  ) {
    return {
      provider: 'dom',
      suggestedType: 'Autocomplete' as InteractionType,
      confidence: 0.55,
      weight: 0.5,
      metadata: event.target.accessibleName ? { selectedValue: event.target.accessibleName } : {},
      reason: `Data attribute hint: "${combined}" contains autocomplete/suggestion pattern`,
    };
  }

  return null;
}
