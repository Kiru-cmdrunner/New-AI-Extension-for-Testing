/**
 * Event Sequence Provider
 *
 * Detects interaction types by recognizing patterns across multiple events
 * on the same element. This is the most flexible provider — it works regardless
 * of ARIA support or DOM structure, making it essential for custom widgets.
 *
 * Strengths: Multi-step interactions (dropdowns, autocompletes), works on any site
 * Weaknesses: Needs multiple events to build confidence — slow start
 *
 * Key patterns detected:
 *   1. Click → change value             → Dropdown (native or custom)
 *   2. Focus → blur with value change   → TextEntry
 *   3. Click → click (same element)     → Toggle (checkbox/radio/switch)
 *   4. Standalone click                 → Click (weak evidence)
 *   5. Scroll events                    → Scroll
 *   6. dblclick                         → DoubleClick
 *   7. contextmenu                      → RightClick
 *   8. mouseenter                       → Hover
 *   9. dragstart → drop                 → DragDrop
 */

import type { InteractionType, InteractionMetadata } from '../../interaction-types.ts';
import type { RecordedEvent } from '../../../recorder/recorded-event.ts';
import type { Evidence, EvidenceProvider, InteractionBuffer } from '../types.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Event Sequence Provider
// ─────────────────────────────────────────────────────────────────────────────

export class EventSequenceProvider implements EvidenceProvider {
  name = 'event-sequence';

  onEvent(event: RecordedEvent, _buffer: InteractionBuffer): Evidence[] {
    if (event.eventType === 'navigation') return [];

    // ── Standalone events → immediate strong evidence ──
    switch (event.eventType) {
      case 'dblclick':
        return [{
          provider: this.name,
          suggestedType: 'DoubleClick' as InteractionType,
          confidence: 0.95,
          weight: 0.9,
          reason: 'dblclick event detected',
        }];

      case 'contextmenu':
        return [{
          provider: this.name,
          suggestedType: 'RightClick' as InteractionType,
          confidence: 0.95,
          weight: 0.9,
          reason: 'contextmenu event detected',
        }];

      case 'scroll':
        return [{
          provider: this.name,
          suggestedType: detectScrollType(event),
          confidence: 0.8,
          weight: 0.7,
          metadata: {},
          reason: 'scroll event detected',
        }];

      case 'mouseenter':
        return [{
          provider: this.name,
          suggestedType: 'Hover' as InteractionType,
          confidence: 0.85,
          weight: 0.8,
          reason: 'mouseenter event detected',
        }];

      case 'dragstart':
        return [{
          provider: this.name,
          suggestedType: 'DragDrop' as InteractionType,
          confidence: 0.85,
          weight: 0.8,
          metadata: event.target.accessibleName
            ? { sourceElement: event.target.accessibleName }
            : {},
          reason: 'dragstart event detected',
        }];

      case 'drop': {
        // Check if files were dropped from the OS — this is a file upload,
        // not an element drag-drop.
        const fileData = event.domContext?.fileData;
        if (fileData && fileData.length > 0) {
          const meta: Partial<InteractionMetadata> = {
            files: fileData.map(f => f.name),
            fileCount: fileData.length,
            uploadMethod: 'drag-drop',
          };
          if (event.domContext?.acceptedFileTypes) {
            meta.acceptedFileTypes = event.domContext.acceptedFileTypes;
          }
          if (event.target.accessibleName) {
            meta.dropTarget = event.target.accessibleName;
          }
          return [{
            provider: this.name,
            suggestedType: 'DragDropUpload' as InteractionType,
            confidence: 0.9,
            weight: 0.85,
            metadata: meta,
            reason: 'drop event with file data — drag-drop file upload',
          }];
        }
        // No file data — this is an element drag-drop
        return [{
          provider: this.name,
          suggestedType: 'DragDrop' as InteractionType,
          confidence: 0.85,
          weight: 0.8,
          metadata: extractDropMetadata(event),
          reason: 'drop event detected',
        }];
      }
    }

    // Real-time evidence for non-standalone events
    // For most events, the real insight comes from looking at the full sequence at commit time
    return [];
  }

  onCommit(buffer: InteractionBuffer): Evidence[] {
    const events = buffer.events;
    if (events.length === 0) return [];

    // Filter to non-navigation events on this element
    const elementEvents = events.filter(e => e.eventType !== 'navigation');
    if (elementEvents.length === 0) return [];

    const eventTypes = elementEvents.map(e => e.eventType);
    const evidence: Evidence[] = [];

    // ── Pattern: Focus → Blur with value change → TextEntry ──
    const focusIdx = eventTypes.indexOf('focus');
    const blurIdx = eventTypes.indexOf('blur');
    if (focusIdx !== -1 && blurIdx !== -1 && blurIdx > focusIdx) {
      const blurEvent = elementEvents[blurIdx];
      const focusEvent = elementEvents[focusIdx];

      // Skip if this element has combobox/autocomplete/slider/switch semantics —
      // it's not a plain text field. AriaProvider/DomProvider/CssClassnameProvider
      // will emit the appropriate type instead.
      const focusRole = (focusEvent.target.ariaRole || '').toLowerCase();
      const focusDomCtx = focusEvent.domContext;
      const focusClassName = (focusEvent.target.className || '').toLowerCase();
      const hasAutocompleteSemantics =
        focusRole === 'combobox' ||
        !!focusDomCtx?.ariaAutoComplete ||
        !!focusDomCtx?.listId ||
        focusClassName.includes('autocomplete') ||
        focusClassName.includes('typeahead');
      const hasSliderSemantics =
        focusRole === 'slider' ||
        focusDomCtx?.inputType === 'range' ||
        focusClassName.includes('slider') ||
        focusClassName.includes('range-slider');
      const hasSwitchSemantics =
        focusRole === 'switch';

      if (!hasAutocompleteSemantics && !hasSliderSemantics && !hasSwitchSemantics) {
        const valueChanged =
          blurEvent.valueAfter !== null &&
          blurEvent.valueAfter !== undefined &&
          (focusEvent.valueBefore === null ||
            focusEvent.valueBefore === undefined ||
            blurEvent.valueAfter !== focusEvent.valueBefore);

        if (valueChanged || elementEvents.length <= 2) {
          evidence.push({
            provider: this.name,
            suggestedType: 'TextEntry' as InteractionType,
            confidence: 0.85,
            weight: 0.8,
            metadata: blurEvent.valueAfter ? { textValue: blurEvent.valueAfter } : {},
            reason: 'focus → blur sequence with text input detected',
          });
        }
      }
    }

    // ── Pattern: Click → change → Dropdown ──
    const hasClick = eventTypes.includes('click');
    const hasChange = eventTypes.includes('change');
    if (hasClick && hasChange) {
      const changeEvent = elementEvents.find(e => e.eventType === 'change');
      evidence.push({
        provider: this.name,
        suggestedType: 'NativeDropdown' as InteractionType,
        confidence: 0.75,
        weight: 0.7,
        metadata: changeEvent?.valueAfter ? { selectedValue: changeEvent.valueAfter } : {},
        reason: 'click → change event sequence suggests dropdown selection',
      });
    }

    // ── Pattern: Click with checked state → Checkbox/Radio/Toggle ──
    if (hasClick) {
      const clickEvent = elementEvents.find(e => e.eventType === 'click');
      if (clickEvent) {
        // Check if there's a checked state transition
        if (clickEvent.checkedAfter !== null && clickEvent.checkedAfter !== undefined) {
          // This could be checkbox, radio, or toggle — event sequence alone can't distinguish
          // Let the DOM/ARIA providers win this one. Provide weak evidence.
          evidence.push({
            provider: this.name,
            suggestedType: 'Checkbox' as InteractionType,
            confidence: 0.4,
            weight: 0.3,
            metadata: { checked: clickEvent.checkedAfter },
            reason: 'click with checkedAfter state detected (type depends on DOM/ARIA)',
          });
        }
      }
    }

    // ── Pattern: Click triggered a native dialog (alert/confirm/prompt) ──
    if (hasClick) {
      const clickEvent = elementEvents.find(e => e.eventType === 'click');
      const dialog = clickEvent?.domContext?.triggeredDialog;
      if (dialog) {
        const meta: Partial<InteractionMetadata> = {
          dialogType: dialog,
          dialogMessage: clickEvent?.domContext?.dialogMessage,
          dialogResult: clickEvent?.domContext?.dialogResult,
        };
        evidence.push({
          provider: this.name,
          suggestedType: 'BrowserAlert' as InteractionType,
          confidence: 0.9,
          weight: 0.85,
          metadata: meta,
          reason: `click triggered ${dialog} dialog`,
        });
      }
    }

    // ── Pattern: Click opened a new window ──
    if (hasClick) {
      const clickEvent = elementEvents.find(e => e.eventType === 'click');
      const ctx = clickEvent?.domContext;
      if (ctx?.opensNewWindow) {
        evidence.push({
          provider: this.name,
          suggestedType: 'NewWindow' as InteractionType,
          confidence: 0.9,
          weight: 0.85,
          metadata: ctx.openedUrl ? { openedUrl: ctx.openedUrl } : {},
          reason: 'click opened a new window',
        });
      } else if (ctx?.opensNewTab) {
        evidence.push({
          provider: this.name,
          suggestedType: 'NewTab' as InteractionType,
          confidence: 0.9,
          weight: 0.85,
          metadata: ctx.openedUrl ? { openedUrl: ctx.openedUrl } : {},
          reason: 'click opened a new tab',
        });
      }
    }

    // ── Pattern: Just a click (no focus, blur, change, or other events) ──
    if (elementEvents.length === 1 && eventTypes[0] === 'click') {
      const clickEvent = elementEvents[0];
      const name = clickEvent.target.accessibleName || '';
      evidence.push({
        provider: this.name,
        suggestedType: 'Click' as InteractionType,
        confidence: 0.6,
        weight: 0.5,
        metadata: name ? { accessibleName: name } : {},
        reason: 'single click event with no other interaction signals',
      });
    }

    // ── Pattern: Multiple clicks on same element → possible toggle ──
    const clickCount = eventTypes.filter(t => t === 'click').length;
    if (clickCount >= 2 && !hasChange && !eventTypes.includes('focus')) {
      evidence.push({
        provider: this.name,
        suggestedType: 'Checkbox' as InteractionType,
        confidence: 0.4,
        weight: 0.3,
        metadata: {},
        reason: `${clickCount} clicks on same element suggest toggle behavior`,
      });
    }

    return evidence;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function detectScrollType(event: RecordedEvent): InteractionType {
  if (event.eventType === 'navigation') return 'Unknown' as InteractionType;
  const tag = event.target.tag.toUpperCase();
  if (tag === 'HTML' || tag === 'BODY') {
    return 'PageScroll' as InteractionType;
  }
  return 'ContainerScroll' as InteractionType;
}

function extractDropMetadata(event: RecordedEvent): Partial<InteractionMetadata> {
  if (event.eventType === 'navigation') return {};
  return event.target.accessibleName
    ? { dropTarget: event.target.accessibleName }
    : {};
}
