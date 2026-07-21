/**
 * ARIA Semantics Provider
 *
 * Observes ARIA roles and state attributes to contribute evidence.
 * Highly authoritative for component type detection when present, but
 * less reliable for interaction completion (aria states may be stale).
 *
 * Strengths: MUI, Angular Material, React Aria — strong ARIA compliance
 * Weaknesses: Enterprise apps, legacy widgets, Ant Design complex components
 *
 * DOM Context: When event.domContext is available, reads ariaExpanded and
 * ariaHasPopup as first-class booleans/strings instead of regex on cssSelector.
 */

import type { InteractionType, InteractionMetadata } from '../../interaction-types.ts';
import type { RecordedEvent } from '../../../recorder/recorded-event.ts';
import type { Evidence, EvidenceProvider, InteractionBuffer } from '../types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// ARIA role → interaction type mapping
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_TYPE_MAP: Record<string, InteractionType> = {
  'button': 'Click' as InteractionType,
  'checkbox': 'Checkbox' as InteractionType,
  'radio': 'RadioButton' as InteractionType,
  'switch': 'ToggleSwitch' as InteractionType,
  'slider': 'Slider' as InteractionType,
  'combobox': 'CustomDropdown' as InteractionType,
  'listbox': 'CustomDropdown' as InteractionType,
  'tab': 'Tab' as InteractionType,
  'link': 'Link' as InteractionType,
  'option': 'CustomDropdown' as InteractionType,
  // Note: 'menuitem' is intentionally NOT mapped to an interaction type.
  // A menuitem is an element description, not an action. The interaction type
  // should come from the event (click→Click, mouseenter→Hover), while
  // role=menuitem stays as target metadata.
};

// aria-haspopup values that indicate dropdown-like behavior
const DROPDOWN_POPUP_VALUES = new Set(['listbox', 'combobox', 'tree', 'grid']);

// ─────────────────────────────────────────────────────────────────────────────
// ARIA Provider
// ─────────────────────────────────────────────────────────────────────────────

export class AriaProvider implements EvidenceProvider {
  name = 'aria';

  onEvent(event: RecordedEvent, buffer: InteractionBuffer): Evidence[] {
    if (event.eventType === 'navigation') return [];

    const evidence: Evidence[] = [];
    const role = (event.target.ariaRole || '').toLowerCase();
    const domCtx = event.domContext;

    // ── Role-based type detection ──
    if (role && role in ROLE_TYPE_MAP) {
      const suggestedType = ROLE_TYPE_MAP[role];

      // Click-type roles (button, link, tab) should only emit on click events.
      // On mouseenter, they should not contribute element-type evidence —
      // let EventSequenceProvider's Hover (0.85) win uncontested.
      // Switch and button are handled below for ToggleSwitch (also click-only).
      const isClickTypeRole = suggestedType === 'Click' || suggestedType === 'Link' || suggestedType === 'Tab';
      if (isClickTypeRole && event.eventType !== 'click' && event.eventType !== 'auxclick') {
        // Skip element-type evidence for non-click events on click-type roles
      } else {

        // Confidence varies by role reliability
        let confidence = 0.85;
        let weight = 0.85;
        let reason = `ARIA role="${role}" detected`;
        let actualSuggestedType = suggestedType;

        // ── Autocomplete detection ──
        // If the element has aria-autocomplete, upgrade from CustomDropdown to Autocomplete.
        // This is the strongest signal: aria-autocomplete="list" or "both" means the user
        // can type to filter — that's autocomplete, not a plain dropdown.
        if (role === 'combobox' && domCtx?.ariaAutoComplete) {
          actualSuggestedType = 'Autocomplete' as InteractionType;
          reason = `ARIA role="combobox" with aria-autocomplete="${domCtx.ariaAutoComplete}" — autocomplete input`;
        }

        // 'option' role is contextual — only suggests CustomDropdown if the buffer
        // already has events on a combobox/listbox ancestor
        if (role === 'option') {
          const hasComboboxInBuffer = buffer.events.some(e =>
            e.eventType !== 'navigation' &&
            (e.target.ariaRole || '').toLowerCase() === 'combobox'
          );
          const hasAutocompleteInBuffer = buffer.events.some(e =>
            e.domContext?.ariaAutoComplete
          );
          if (hasAutocompleteInBuffer) {
            // Option selected from an autocomplete suggestion list
            actualSuggestedType = 'Autocomplete' as InteractionType;
            confidence = 0.8;
            weight = 0.7;
            reason = `ARIA role="option" selected from autocomplete dropdown`;
          } else if (!hasComboboxInBuffer) {
            // Option outside a combobox context — lower confidence
            confidence = 0.5;
            weight = 0.4;
            reason = `ARIA role="option" detected (no combobox in buffer yet)`;
          } else {
            confidence = 0.8;
            weight = 0.7;
            reason = `ARIA role="option" selected from combobox dropdown`;
          }
        }

        // Switch and button with aria-pressed/checked → ToggleSwitch
        if (role === 'button' || role === 'switch') {
          const ariaChecked = event.checkedAfter !== null ? event.checkedAfter : null;
          const cssSelector = event.target.cssSelector || '';
          const ariaPressedMatch = cssSelector.match(/aria-pressed=["']?(true|false)["']?/i);
          if (ariaPressedMatch || ariaChecked !== null) {
            evidence.push({
              provider: this.name,
              suggestedType: 'ToggleSwitch' as InteractionType,
              confidence: 0.85,
              weight: 0.8,
              metadata: extractCheckedMetadata(event),
              reason: `ARIA role="${role}" with aria-pressed/checked detected`,
            });
            return evidence; // Don't also suggest Click
          }
        }

        evidence.push({
          provider: this.name,
          suggestedType: actualSuggestedType,
          confidence,
          weight,
          metadata: extractMetadataForType(actualSuggestedType, event),
          reason,
        });
      }
    }

    // ── aria-haspopup detection (prefer domContext, fall back to cssSelector) ──
    let popupValue: string | null = null;
    if (domCtx?.ariaHasPopup) {
      popupValue = domCtx.ariaHasPopup.toLowerCase();
    } else {
      const cssSelector = event.target.cssSelector || '';
      const hasPopupMatch = cssSelector.match(/aria-haspopup=["']?(\w+)["']?/i);
      if (hasPopupMatch) popupValue = hasPopupMatch[1].toLowerCase();
    }

    if (popupValue && DROPDOWN_POPUP_VALUES.has(popupValue)) {
      evidence.push({
        provider: this.name,
        suggestedType: 'CustomDropdown' as InteractionType,
        confidence: 0.7,
        weight: 0.6,
        metadata: {},
        reason: `aria-haspopup="${popupValue}" suggests dropdown behavior`,
      });
    }

    // ── aria-expanded on non-role elements (prefer domContext) ──
    // If an element has aria-expanded but no explicit role, it's likely a custom trigger
    let ariaExpanded: boolean | null = null;
    if (domCtx) {
      ariaExpanded = domCtx.ariaExpanded;
    } else {
      const cssSelector = event.target.cssSelector || '';
      const ariaExpandedMatch = cssSelector.match(/aria-expanded=["']?(true|false)["']?/i);
      if (ariaExpandedMatch) ariaExpanded = ariaExpandedMatch[1].toLowerCase() === 'true';
    }

    if (ariaExpanded !== null && !role) {
      evidence.push({
        provider: this.name,
        suggestedType: 'CustomDropdown' as InteractionType,
        confidence: 0.5,
        weight: 0.4,
        metadata: {},
        reason: `aria-expanded present without explicit role — likely custom trigger`,
      });
    }

    return evidence;
  }

  onCommit(buffer: InteractionBuffer): Evidence[] {
    // At commit time, check if we have evidence of a completed dropdown interaction
    const events = buffer.events;
    if (events.length < 2) return [];

    // Look for: click on combobox → click on option → value change
    const hasComboboxClick = events.some(e =>
      e.eventType !== 'navigation' &&
      (e.target.ariaRole || '').toLowerCase() === 'combobox' &&
      e.eventType === 'click'
    );
    const hasOptionClick = events.some(e =>
      e.eventType !== 'navigation' &&
      (e.target.ariaRole || '').toLowerCase() === 'option' &&
      e.eventType === 'click'
    );
    const hasValueChange = events.some(e =>
      e.eventType === 'change' || e.eventType === 'input'
    );

    // ── Autocomplete detection at commit time ──
    // Check for autocomplete signals: focus+blur on a combobox input with
    // text change, OR aria-autocomplete present on any event
    const hasAriaAutoComplete = events.some(e =>
      e.domContext?.ariaAutoComplete
    );
    const hasComboboxFocusBlur = events.some(e =>
      e.eventType === 'focus' &&
      (e.target.ariaRole || '').toLowerCase() === 'combobox'
    ) && events.some(e =>
      e.eventType === 'blur' &&
      (e.target.ariaRole || '').toLowerCase() === 'combobox'
    );
    const blurEvent = events.find(e => e.eventType === 'blur');
    const focusEvent = events.find(e => e.eventType === 'focus');
    const hasTextChange = blurEvent && focusEvent &&
      blurEvent.valueAfter !== null && blurEvent.valueAfter !== undefined &&
      blurEvent.valueAfter !== (focusEvent.valueBefore || '');

    // If we have autocomplete signals, emit Autocomplete (higher confidence than CustomDropdown)
    if ((hasAriaAutoComplete || (hasComboboxFocusBlur && hasTextChange)) && (hasOptionClick || hasValueChange)) {
      // Extract search text from blur valueAfter and selected value from option
      const optionEvent = events.find(e =>
        e.eventType !== 'navigation' &&
        (e.target.ariaRole || '').toLowerCase() === 'option' &&
        e.eventType === 'click'
      );
      const optionName = optionEvent && optionEvent.eventType !== 'navigation'
        ? optionEvent.target.accessibleName : undefined;
      const changeEvent = events.find(e => e.eventType === 'change');
      const changeValue = changeEvent && changeEvent.eventType !== 'navigation'
        ? changeEvent.valueAfter : undefined;
      const searchText = blurEvent && blurEvent.eventType !== 'navigation'
        ? blurEvent.valueAfter : undefined;
      const selectedValue = optionName || changeValue;

      const metadata: Partial<InteractionMetadata> = {};
      if (searchText) metadata.textValue = searchText;
      if (selectedValue) metadata.selectedValue = selectedValue;

      return [{
        provider: this.name,
        suggestedType: 'Autocomplete' as InteractionType,
        confidence: 0.9,
        weight: 0.85,
        metadata,
        reason: 'Autocomplete pattern: combobox focus/blur with text input → option selection',
      }];
    }

    if (hasComboboxClick && (hasOptionClick || hasValueChange)) {
      // Find the value from the change/input event
      const changeEvent = events.find(e => e.eventType === 'change');
      const valueAfter = changeEvent && changeEvent.eventType !== 'navigation'
        ? changeEvent.valueAfter : undefined;
      // Find option name
      const optionEvent = events.find(e =>
        e.eventType !== 'navigation' &&
        (e.target.ariaRole || '').toLowerCase() === 'option' &&
        e.eventType === 'click'
      );
      const optionName = optionEvent && optionEvent.eventType !== 'navigation'
        ? optionEvent.target.accessibleName : undefined;

      // If the combobox has autocomplete signals, classify as Autocomplete
      const hasAutocompleteSignal = hasAriaAutoComplete ||
        events.some(e => {
          const cls = (e.target.className || '').toLowerCase();
          return cls.includes('autocomplete') || cls.includes('typeahead');
        });

      if (hasAutocompleteSignal) {
        const metadata: Partial<InteractionMetadata> = {};
        if (valueAfter) metadata.selectedValue = valueAfter;
        if (optionName) metadata.selectedValue = optionName;
        return [{
          provider: this.name,
          suggestedType: 'Autocomplete' as InteractionType,
          confidence: 0.85,
          weight: 0.8,
          metadata,
          reason: 'Complete autocomplete pattern: combobox click → option selection',
        }];
      }

      return [{
        provider: this.name,
        suggestedType: 'CustomDropdown' as InteractionType,
        confidence: 0.85,
        weight: 0.8,
        metadata: valueAfter ? { selectedValue: valueAfter } : (optionName ? { selectedValue: optionName } : {}),
        reason: 'Complete ARIA combobox pattern: trigger click → option selection → value change',
      }];
    }

    // Check for listbox pattern
    const hasListboxClick = events.some(e =>
      e.eventType !== 'navigation' &&
      (e.target.ariaRole || '').toLowerCase() === 'listbox'
    );
    if (hasListboxClick && hasOptionClick) {
      const optionEvent = events.find(e =>
        e.eventType !== 'navigation' &&
        (e.target.ariaRole || '').toLowerCase() === 'option' &&
        e.eventType === 'click'
      );
      const optionName = optionEvent && optionEvent.eventType !== 'navigation'
        ? optionEvent.target.accessibleName : undefined;

      return [{
        provider: this.name,
        suggestedType: 'CustomDropdown' as InteractionType,
        confidence: 0.85,
        weight: 0.8,
        metadata: optionName ? { selectedValue: optionName } : {},
        reason: 'ARIA listbox → option selection pattern detected',
      }];
    }

    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractMetadataForType(
  type: InteractionType,
  event: RecordedEvent,
): Partial<InteractionMetadata> {
  if (event.eventType === 'navigation') return {};

  switch (type) {
    case 'Checkbox':
    case 'ToggleSwitch':
      return extractCheckedMetadata(event);
    case 'RadioButton': {
      const meta: Partial<InteractionMetadata> = extractCheckedMetadata(event);
      if (event.target.accessibleName) meta.selectedValue = event.target.accessibleName;
      return meta;
    }
    case 'TextEntry':
      if (event.valueAfter) return { textValue: event.valueAfter };
      return {};
    case 'NativeDropdown':
    case 'CustomDropdown':
      if (event.valueAfter) return { selectedValue: event.valueAfter };
      return {};
    case 'Autocomplete':
      if (event.valueAfter) {
        // For option clicks, valueAfter is the selected value
        // For input focus/blur, valueAfter is the search text
        const role = (event.target.ariaRole || '').toLowerCase();
        return role === 'option' ? { selectedValue: event.valueAfter } : { textValue: event.valueAfter };
      }
      return {};
    case 'DatePicker':
      if (event.valueAfter) return { dateValue: event.valueAfter };
      return {};
    case 'TimePicker':
      if (event.valueAfter) return { timeValue: event.valueAfter };
      return {};
    case 'DateTimePicker':
      if (event.valueAfter) return { dateTimeValue: event.valueAfter };
      return {};
    case 'Slider': {
      const meta: Partial<InteractionMetadata> = {};
      const dCtx = event.domContext;
      // Value: prefer event.valueAfter (from captureValue), then DomContext ARIA fields
      const val = event.valueAfter || dCtx?.ariaValueText || dCtx?.ariaValueNow;
      if (val) meta.sliderValue = val;
      // Min/max from DomContext ARIA attributes
      if (dCtx?.ariaValueMin) meta.sliderMin = dCtx.ariaValueMin;
      if (dCtx?.ariaValueMax) meta.sliderMax = dCtx.ariaValueMax;
      return meta;
    }
    case 'Menu':
    case 'Click':
      return event.target.accessibleName
        ? { accessibleName: event.target.accessibleName }
        : {};
    case 'Tab':
      return event.target.accessibleName
        ? { selectedTab: event.target.accessibleName }
        : {};
    default:
      return {};
  }
}

function extractCheckedMetadata(event: RecordedEvent): Partial<InteractionMetadata> {
  if (event.eventType === 'navigation') return {};
  if (event.checkedAfter !== null && event.checkedAfter !== undefined) {
    return { checked: event.checkedAfter };
  }
  return {};
}
