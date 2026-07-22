/**
 * Mutation Provider
 *
 * Detects dynamically appearing UI surfaces (modals, drawers, popovers, tooltips)
 * and infers DOM mutations from the event stream.
 *
 * Two detection paths:
 *
 *   1. Surface Detection (onEvent): Reads domContext.surfaceType captured by the
 *      recorder's click-triggered MutationObserver. This is DIRECT detection —
 *      the recorder saw a modal/drawer/popover/tooltip appear after a click.
 *
 *   2. Inferred Mutations (onCommit): Analyzes the full event buffer for
 *      aria-expanded transitions, trigger→option patterns, and multiple-element
 *      grouping. Used as supplementary evidence for dropdown inference.
 */

import type { InteractionType } from '../../interaction-types.ts';
import type { RecordedEvent } from '../../../recorder/recorded-event.ts';
import type { Evidence, EvidenceProvider, InteractionBuffer } from '../types.ts';

/** Map surface type to interaction type with confidence/weight */
const SURFACE_EVIDENCE_MAP: Record<string, { type: InteractionType; confidence: number; weight: number }> = {
  'modal':   { type: 'Modal' as InteractionType,   confidence: 0.85, weight: 0.8 },
  'drawer':  { type: 'Drawer' as InteractionType,  confidence: 0.85, weight: 0.8 },
  'popover': { type: 'Popover' as InteractionType, confidence: 0.8,  weight: 0.75 },
  'tooltip': { type: 'Tooltip' as InteractionType, confidence: 0.8,  weight: 0.75 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Mutation Provider
// ─────────────────────────────────────────────────────────────────────────────

export class MutationProvider implements EvidenceProvider {
  name = 'mutation';

  onEvent(event: RecordedEvent, _buffer: InteractionBuffer): Evidence[] {
    // ── Surface Detection: read domContext.surfaceType ──
    const domCtx = event.domContext;
    if (!domCtx || !domCtx.surfaceType) return [];

    // Skip popover evidence when the click is inside a calendar popover —
    // the calendar's surface detection is part of a date picker interaction,
    // not a standalone Popover interaction.
    if (domCtx.ownedByDatePicker) return [];

    const mapping = SURFACE_EVIDENCE_MAP[domCtx.surfaceType];
    if (!mapping) return [];

    // Build metadata from surface info
    const metadata: Record<string, unknown> = {};
    if (domCtx.surfaceRole) metadata.surfaceRole = domCtx.surfaceRole;
    if (domCtx.surfaceLabel) metadata.surfaceLabel = domCtx.surfaceLabel;

    return [{
      provider: this.name,
      suggestedType: mapping.type,
      confidence: mapping.confidence,
      weight: mapping.weight,
      metadata,
      reason: `${domCtx.surfaceType} surface detected after ${event.eventType}${domCtx.surfaceRole ? ` (role="${domCtx.surfaceRole}")` : ''}`,
    }];
  }

  onCommit(buffer: InteractionBuffer): Evidence[] {
    const events = buffer.events;
    if (events.length < 2) return [];

    const elementEvents = events.filter(e => e.eventType !== 'navigation');
    if (elementEvents.length === 0) return [];

    const evidence: Evidence[] = [];

    // ── Detect aria-expanded state changes (prefer domContext) ──
    const expandedStates = extractAriaExpandedStates(elementEvents);
    if (expandedStates.length >= 2) {
      const opened = expandedStates.some(s => s === true);
      const closed = expandedStates.some(s => s === false);
      if (opened && closed) {
        // Element was expanded then closed — strong dropdown/modal signal
        evidence.push({
          provider: this.name,
          suggestedType: 'CustomDropdown' as InteractionType,
          confidence: 0.7,
          weight: 0.6,
          reason: 'aria-expanded transitioned true→false (open→close cycle detected)',
        });
      }
    }

    // ── Detect multiple elements in the same buffer ──
    // If the buffer has events on different element keys, it suggests a popup
    // or overlay appeared and was interacted with.
    const hasMultipleElements = new Set(
      elementEvents.map(e => e.target.elementId),
    ).size > 1;

    // Check for option-like elements appearing after a trigger click
    const hasTriggerClick = elementEvents.some(
      e => e.eventType === 'click' && this.looksLikeTrigger(e),
    );
    const hasOptionInteraction = elementEvents.some(
      e => this.looksLikeOption(e) || this.looksLikeListboxChild(e),
    );

    if (hasTriggerClick && hasOptionInteraction) {
      const optionEvent = elementEvents.find(
        e => this.looksLikeOption(e) || this.looksLikeListboxChild(e),
      );
      const optionName = optionEvent
        ? optionEvent.target.accessibleName : undefined;

      evidence.push({
        provider: this.name,
        suggestedType: 'CustomDropdown' as InteractionType,
        confidence: hasMultipleElements ? 0.75 : 0.7,
        weight: 0.6,
        metadata: optionName ? { selectedValue: optionName } : {},
        reason: 'trigger click followed by interaction with option-like element — popup lifecycle detected',
      });
    }

    // ── Detect Calendar lifecycle (trigger → gridcell) ──
    // If the buffer has a trigger click followed by a calendar cell click,
    // it's a date picker interaction even without ARIA roles.
    const hasCalendarCell = elementEvents.some(e => this.looksLikeCalendarCell(e));
    const hasCalendarTrigger = elementEvents.some(
      e => e.eventType === 'click' && this.looksLikeCalendarTrigger(e),
    );
    if (hasCalendarCell) {
      // Find the cell event that is NOT the trigger (triggers can also match cell patterns)
      const cellEvent = elementEvents.find(
        e => this.looksLikeCalendarCell(e) && !this.looksLikeCalendarTrigger(e),
      ) || elementEvents.find(e => this.looksLikeCalendarCell(e));
      const cellValue = cellEvent ? cellEvent.target.accessibleName : undefined;

      evidence.push({
        provider: this.name,
        suggestedType: 'DatePicker' as InteractionType,
        confidence: hasCalendarTrigger ? 0.8 : 0.75,
        weight: 0.55,
        metadata: cellValue ? { dateValue: cellValue } : {},
        reason: 'calendar cell interaction detected — date picker lifecycle',
      });
    }

    // ── Detect Autocomplete lifecycle (typing → suggestion click) ──
    // If the buffer has focus/input events on an input followed by a suggestion
    // click, it's an autocomplete interaction even without aria-autocomplete.
    const hasTypingEvents = elementEvents.some(
      e => (e.eventType === 'focus' || e.eventType === 'input') &&
        (e.target.tag === 'INPUT' || e.target.tag === 'TEXTAREA'),
    );
    const hasSuggestionClick = elementEvents.some(
      e => e.eventType === 'click' && this.looksLikeSuggestion(e),
    );
    if (hasTypingEvents && hasSuggestionClick) {
      const suggestionEvent = elementEvents.find(
        e => e.eventType === 'click' && this.looksLikeSuggestion(e),
      );
      const suggestionValue = suggestionEvent
        ? suggestionEvent.target.accessibleName : undefined;

      evidence.push({
        provider: this.name,
        suggestedType: 'Autocomplete' as InteractionType,
        confidence: 0.7,
        weight: 0.6,
        metadata: suggestionValue ? { selectedValue: suggestionValue } : {},
        reason: 'typing followed by suggestion click — autocomplete lifecycle detected',
      });
    }

    // ── Detect InfiniteScroll (scroll + DOM content growth) ──
    const scrollCount = elementEvents.filter(e => e.eventType === 'scroll').length;
    if (scrollCount >= 2) {
      // Check if multiple distinct elements appeared during the scroll sequence
      // (indicating new content was loaded dynamically)
      const distinctElements = new Set(
        elementEvents.map(e => e.target.elementId),
      ).size;
      if (distinctElements >= 2 || hasMultipleElements) {
        evidence.push({
          provider: this.name,
          suggestedType: 'InfiniteScroll' as InteractionType,
          confidence: 0.6,
          weight: 0.5,
          reason: 'multiple scrolls with new elements appearing — infinite scroll pattern detected',
        });
      }
    }

    return evidence;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private looksLikeTrigger(event: RecordedEvent): boolean {
    if (event.eventType === 'navigation') return false;
    const role = (event.target.ariaRole || '').toLowerCase();
    const domCtx = event.domContext;

    if (role === 'combobox') return true;
    if (domCtx?.ariaHasPopup) return true;
    if (domCtx?.ariaExpanded !== null) return true;
    // Fallback: cssSelector
    const cssSelector = event.target.cssSelector || '';
    const className = event.target.className || '';
    if (/aria-haspopup/i.test(cssSelector)) return true;
    if (/aria-expanded/i.test(cssSelector)) return true;
    if (/dropdown|select|combobox/i.test(className)) return true;

    // Expanded: Headless UI, React-Select, and generic dropdown trigger patterns
    const lower = className.toLowerCase();
    if (
      lower.includes('headlessui-listbox') || lower.includes('headlessui-combobox') ||
      lower.includes('headlessui-menu') ||
      lower.includes('dropdown-trigger') || lower.includes('dropdown-toggle') ||
      lower.includes('select__control') || lower.includes('select__value-container') ||
      lower.includes('combo-box')
    ) {
      return true;
    }

    return false;
  }

  private looksLikeOption(event: RecordedEvent): boolean {
    if (event.eventType === 'navigation') return false;
    const role = (event.target.ariaRole || '').toLowerCase();
    if (role === 'option') return true;
    return false;
  }

  private looksLikeListboxChild(event: RecordedEvent): boolean {
    if (event.eventType === 'navigation') return false;
    const role = (event.target.ariaRole || '').toLowerCase();
    const className = event.target.className || '';

    if (role === 'option') return true;
    // Class-based detection for option-like elements
    if (/\boption\b|\bitem\b|\bchoice\b|\bresult\b/i.test(className)) {
      return true;
    }
    // Expanded: Headless UI, React-Select, and generic option patterns
    const lower = className.toLowerCase();
    if (
      lower.includes('headlessui-listbox') || lower.includes('headlessui-combobox') ||
      lower.includes('headlessui-menu') ||
      lower.includes('select__option') || lower.includes('select__menu') ||
      lower.includes('dropdown-item') || lower.includes('dropdown-option') ||
      lower.includes('select-option') || lower.includes('select-item') ||
      lower.includes('menu-item') || lower.includes('option-item') ||
      lower.includes('suggestion-item')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Check if an event target looks like a calendar cell (date picker day/month cell).
   */
  private looksLikeCalendarCell(event: RecordedEvent): boolean {
    if (event.eventType === 'navigation') return false;
    const role = (event.target.ariaRole || '').toLowerCase();
    const className = event.target.className || '';

    if (role === 'gridcell') return true;
    if (/\bday\b|\bcell\b|\bdate\b|gridcell|calendar/i.test(className)) return true;

    const lower = className.toLowerCase();
    if (
      lower.includes('react-datepicker__day') ||
      lower.includes('react-datepicker__month') ||
      lower.includes('calendar-day') || lower.includes('calendar-cell') ||
      lower.includes('date-cell') || lower.includes('day-cell') ||
      lower.includes('datepicker-day') || lower.includes('picker-day')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Check if an event target looks like a calendar trigger (date input or date button).
   * Excludes cell-like elements (day, cell, date with day) to avoid false matches.
   */
  private looksLikeCalendarTrigger(event: RecordedEvent): boolean {
    if (event.eventType === 'navigation') return false;
    const className = event.target.className || '';
    const domCtx = event.domContext;

    if (domCtx?.inputType) {
      const t = domCtx.inputType;
      if (t === 'date' || t === 'datetime-local' || t === 'time' || t === 'month' || t === 'week') {
        return true;
      }
    }

    // Exclude cell-like classes — they are NOT triggers
    if (/\bday\b|\bcell\b|\bdate\b/i.test(className) && !/container|selector|input|wrapper|header/i.test(className)) {
      return false;
    }

    if (/date.?picker|datepicker/i.test(className)) return true;
    // Only match generic "calendar" if it's a container/input, not a cell
    if (/calendar/i.test(className) && /container|input|wrapper|selector|header|grid/i.test(className)) return true;

    const lower = className.toLowerCase();
    if (
      lower.includes('react-datepicker__input') ||
      lower.includes('react-datepicker__container') ||
      lower.includes('calendar-container') || lower.includes('calendar-grid') ||
      lower.includes('date-selector')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Check if an event target looks like an autocomplete suggestion.
   */
  private looksLikeSuggestion(event: RecordedEvent): boolean {
    if (event.eventType === 'navigation') return false;
    const className = event.target.className || '';
    const lower = className.toLowerCase();

    // Suggestion-specific patterns
    if (
      lower.includes('suggestion') || lower.includes('autocomplete') ||
      lower.includes('typeahead') || lower.includes('predict') ||
      lower.includes('headlessui-combobox-option') ||
      lower.includes('select__option')
    ) {
      return true;
    }
    // Generic option/item patterns (also used in looksLikeListboxChild)
    if (/\boption\b|\bchoice\b|\bresult\b/i.test(className)) return true;
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
function extractAriaExpandedStates(events: RecordedEvent[]): boolean[] {
  const states: boolean[] = [];

  for (const event of events) {
    if (event.eventType === 'navigation') continue;
    const domCtx = event.domContext;
    if (domCtx && domCtx.ariaExpanded !== null) {
      states.push(domCtx.ariaExpanded);
    } else {
      const cssSelector = event.target.cssSelector || '';
      const match = cssSelector.match(/aria-expanded=["']?(true|false)["']?/i);
      if (match) {
        states.push(match[1].toLowerCase() === 'true');
      }
    }
  }

  return states;
}
