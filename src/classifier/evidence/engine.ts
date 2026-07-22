/**
 * Interaction Engine — Evidence-Based Interaction Detection
 *
 * The engine processes a raw event stream through the evidence pipeline:
 *
 *   1. Each event is fed to all registered providers
 *   2. Providers contribute Evidence (observations with confidence)
 *   3. Events are buffered — multi-element interactions are kept together
 *      when events are related (e.g., combobox click → option click)
 *   4. When a commit signal fires (unrelated element switch, navigation,
 *      standalone event, end of stream), the buffer is committed
 *   5. At commit, providers get a final onCommit() call
 *   6. All evidence is combined via weighted voting
 *   7. The winning type is emitted as a DetectedInteraction
 *
 * No timing windows. No debouncing. No type-specific completion rules.
 */

import type { DetectedInteraction, InteractionMetadata } from '../interaction-types.ts';
import type { RecordedEvent, ElementRecordedEvent } from '../../recorder/recorded-event.ts';
import type { ElementIdentity } from '../../shared/types.ts';
import type { EvidenceProvider, InteractionBuffer, CombinationResult } from './types.ts';
import { elementKey } from './types.ts';
import { combineEvidence, extractMetadata } from './combination.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Standalone events — these are immediately committed as their own interaction
// ─────────────────────────────────────────────────────────────────────────────

const STANDALONE_EVENT_TYPES = new Set([
  'dblclick',
  'contextmenu',
  'scroll',
  'mouseenter',
  // NOTE: 'dragstart' and 'drop' are NOT standalone — they're handled as a
  // multi-event pair by the drag coordinator (see isRelatedToBuffer + the
  // dragstart/drop special handling in processEvent).
]);

// ─────────────────────────────────────────────────────────────────────────────
// Interaction Engine
// ─────────────────────────────────────────────────────────────────────────────

export class InteractionEngine {
  private providers: EvidenceProvider[];
  private currentBuffer: InteractionBuffer | null = null;
  private interactions: DetectedInteraction[] = [];
  private eventIdCounter = 0;

  constructor(providers: EvidenceProvider[]) {
    this.providers = providers;
  }

  /**
   * Process a complete event stream and return detected interactions.
   */
  detect(events: RecordedEvent[]): DetectedInteraction[] {
    for (const event of events) {
      this.processEvent(event);
    }
    this.flush();
    return this.interactions;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Event processing
  // ─────────────────────────────────────────────────────────────────────────

  private processEvent(event: RecordedEvent): void {
    // Navigation events are always standalone interactions
    if (event.eventType === 'navigation') {
      this.flush();
      this.emitNavigationInteraction(event);
      return;
    }

    // Skip events owned by a date picker — they are evidence-only
    // (scrolls, hovers, clicks inside calendar popovers that are part of
    // a date picker interaction). These events remain in the session for
    // audit/debugging but must not produce standalone interactions.
    const domCtx = (event as ElementRecordedEvent).domContext;
    if (domCtx?.ownedByDatePicker && event.eventType !== 'dateSelect') {
      return;
    }

    const key = elementKey(event);

    // ── Drag & Drop coordination ──
    // dragstart: start a new drag buffer. Flush ANY pending buffer first
    // (could be a non-drag interaction like a click, or an incomplete prior drag).
    if (event.eventType === 'dragstart') {
      this.flush();
      // Start a fresh buffer for this dragstart
      this.currentBuffer = this.createBuffer(event, key);
      this.collectEventEvidence(event, this.currentBuffer);
      return;
    }

    // drop: if there's a pending dragstart buffer, add this drop to it
    if (event.eventType === 'drop') {
      if (this.currentBuffer && this.currentBuffer.events.some(e => e.eventType === 'dragstart')) {
        // Group drop with the pending dragstart
        this.addToBuffer(event, this.currentBuffer);
        return;
      }
      // Orphaned drop (no preceding dragstart) — treat as standalone
      this.flush();
      this.processStandaloneEvent(event, key);
      return;
    }

    // Non-drag event arriving while a dragstart is pending → flush the incomplete drag first
    if (this.currentBuffer && this.currentBuffer.events.some(e => e.eventType === 'dragstart')) {
      this.flush();
    }

    // Standalone events get their own interaction immediately
    if (STANDALONE_EVENT_TYPES.has(event.eventType)) {
      this.flush();
      this.processStandaloneEvent(event, key);
      return;
    }

    // Check if this event should continue the current buffer or start a new one
    if (this.currentBuffer) {
      const sameElement = this.currentBuffer.elementKey === key;
      const related = this.isRelatedToBuffer(event, this.currentBuffer);

      if (sameElement || related) {
        // Continue accumulating in current buffer
        this.addToBuffer(event, this.currentBuffer);
        return;
      } else {
        // Different, unrelated element — commit current buffer, start new one
        this.flush();
      }
    }

    // Start a new buffer for this element
    this.currentBuffer = this.createBuffer(event, key);
    this.collectEventEvidence(event, this.currentBuffer);
  }

  /**
   * Check if an event is related to the current buffer's interaction.
   *
   * Multi-element interactions: if the buffer has events on a trigger element,
   * and the new event is on a related child element, they're part of the same
   * interaction. Two patterns are recognized:
   *
   * 1. Dropdown: trigger (combobox/listbox/aria-haspopup) ↔ option (role=option, class*=option)
   * 2. Calendar: trigger (date input/calendar button) ↔ gridcell (role=gridcell, calendar class)
   *
   * Uses domContext fields (ariaExpanded, ariaHasPopup, inputType) when available,
   * falls back to cssSelector/classname regex for backwards compatibility.
   */
  private isRelatedToBuffer(event: RecordedEvent, buffer: InteractionBuffer): boolean {
    if (event.eventType === 'navigation') return false;

    const eventRole = (event.target.ariaRole || '').toLowerCase();
    const eventClass = event.target.className || '';
    const eventDomCtx = event.domContext;

    for (const bufEvent of buffer.events) {
      if (bufEvent.eventType === 'navigation') continue;
      const bufRole = (bufEvent.target.ariaRole || '').toLowerCase();
      const bufClass = bufEvent.target.className || '';
      const bufDomCtx = bufEvent.domContext;

      // ── Dropdown: Trigger → Option ──
      const bufIsDropdownTrigger = isDropdownTrigger(bufRole, bufClass, bufDomCtx, bufEvent);
      const eventIsDropdownOption = isDropdownOption(eventRole, eventClass);

      if (bufIsDropdownTrigger && eventIsDropdownOption) return true;

      // ── Dropdown: Option → Trigger (change/input event fires on trigger after option click) ──
      // This only applies when the event is a change/input (not a click) — a click on a
      // different combobox is a NEW interaction, not part of the current buffer.
      // The change event fires on the combobox element after the option is selected.
      const bufIsOption = bufRole === 'option';
      const eventIsTriggerChange = (event.eventType === 'change' || event.eventType === 'input') &&
        isDropdownTrigger(eventRole, eventClass, eventDomCtx, event);

      if (bufIsOption && eventIsTriggerChange) return true;

      // ── Calendar: Trigger → Gridcell ──
      // Date input or calendar button followed by a gridcell/calendar cell click.
      // Two detection levels:
      //   1. Explicit calendar trigger (type=date, datepicker class, etc.)
      //   2. ANY non-calendar element followed by a gridcell click — gridcells
      //      only exist in calendars, so if we see one after a non-calendar
      //      element, the preceding element was a trigger. This catches Google
      //      Flights-style date inputs that are plain <input type="text"
      //      aria-label="Departure"> with no date-specific markers.
      //      BUT: a gridcell after another gridcell is a SEPARATE date
      //      selection (e.g. date range picker), so we don't group those.
      // (bufEvent is already non-navigation due to the continue at the top of the loop)
      const bufCssSelector = bufEvent.target.cssSelector || '';
      const bufIsCalendarTrigger = isCalendarTrigger(bufRole, bufClass, bufDomCtx, bufCssSelector);
      const eventIsCalendarCell = isCalendarCell(eventRole, eventClass);
      const bufIsCalendarCell = isCalendarCell(bufRole, bufClass);

      if (bufIsCalendarTrigger && eventIsCalendarCell) return true;

      // Broad calendar grouping: non-calendar buffer element + calendar cell click
      // (only for click events — avoids false positives from focus/input on unrelated elements)
      if (event.eventType === 'click' && eventIsCalendarCell && !bufIsCalendarCell) return true;

      // ── Calendar: Gridcell → Trigger (change/input event on date input after cell click) ──
      // Only applies for change/input events — a click on a different calendar is new.
      // bufIsCalendarCell is already declared above (Calendar: Trigger → Gridcell section)
      const eventIsCalendarTriggerChange = (event.eventType === 'change' || event.eventType === 'input') &&
        isCalendarTrigger(eventRole, eventClass, eventDomCtx, event.target.cssSelector || '');

      if (bufIsCalendarCell && eventIsCalendarTriggerChange) return true;
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Buffer management
  // ─────────────────────────────────────────────────────────────────────────

  private createBuffer(event: RecordedEvent, key: string): InteractionBuffer {
    return {
      elementKey: key,
      events: [event],
      evidence: [],
      startTime: event.timestamp,
      lastEventTime: event.timestamp,
    };
  }

  private addToBuffer(event: RecordedEvent, buffer: InteractionBuffer): void {
    buffer.events.push(event);
    buffer.lastEventTime = event.timestamp;
    this.collectEventEvidence(event, buffer);
  }

  private collectEventEvidence(event: RecordedEvent, buffer: InteractionBuffer): void {
    for (const provider of this.providers) {
      const providerEvidence = provider.onEvent(event, buffer);
      buffer.evidence.push(...providerEvidence);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Standalone event handling
  // ─────────────────────────────────────────────────────────────────────────

  private processStandaloneEvent(event: RecordedEvent, key: string): void {
    const buffer: InteractionBuffer = {
      elementKey: key,
      events: [event],
      evidence: [],
      startTime: event.timestamp,
      lastEventTime: event.timestamp,
    };

    this.collectEventEvidence(event, buffer);
    this.commitBuffer(buffer);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Commit — combine evidence and emit interaction
  // ─────────────────────────────────────────────────────────────────────────

  private flush(): void {
    if (this.currentBuffer) {
      this.commitBuffer(this.currentBuffer);
      this.currentBuffer = null;
    }
  }

  private commitBuffer(buffer: InteractionBuffer): void {
    if (buffer.events.length === 0) return;

    // Collect final evidence from providers
    for (const provider of this.providers) {
      if (provider.onCommit) {
        const commitEvidence = provider.onCommit(buffer);
        buffer.evidence.push(...commitEvidence);
      }
    }

    // ── Evidence conflict resolution ──
    // When a buffer contains both a calendar cell interaction AND TextEntry
    // evidence from a trigger input (e.g. Google Flights date input is an
    // <input> without type="date"), suppress the TextEntry evidence. A calendar
    // cell in the buffer means this IS a date picker interaction, not text entry.
    const hasCalendarCell = buffer.events.some(e => {
      if (e.eventType === 'navigation') return false;
      const role = (e.target.ariaRole || '').toLowerCase();
      const className = (e.target.className || '').toLowerCase();
      return isCalendarCell(role, className);
    });
    if (hasCalendarCell) {
      buffer.evidence = buffer.evidence.filter(
        e => e.suggestedType !== 'TextEntry',
      );
    }

    // Combine all evidence
    const result = combineEvidence(buffer.evidence);

    // Build interaction
    const metadata = extractMetadata(result.type, buffer.evidence) as InteractionMetadata;
    const eventIds = buffer.events.map(e => e.eventId);
    const rawEventTypes = [...new Set(buffer.events.map(e => e.eventType))];
    const target = this.extractTarget(buffer.events);

    const interaction: DetectedInteraction & { _evidenceTrail?: CombinationResult } = {
      interactionId: `evidence-${++this.eventIdCounter}`,
      type: result.type,
      eventIds,
      rawEventTypes,
      target: target ?? undefined,
      metadata,
      confidence: result.confidence,
      _evidenceTrail: result,
    };

    // Iframe enrichment: if the target element is inside an iframe, add
    // iframe context to the metadata. Mirrors the V1 detector's enrichment.
    enrichWithIframeContext(interaction, target);

    this.interactions.push(interaction);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Navigation interaction
  // ─────────────────────────────────────────────────────────────────────────

  private emitNavigationInteraction(event: RecordedEvent): void {
    if (event.eventType !== 'navigation') return;

    let navType: DetectedInteraction['type'] = 'PageNavigation';

    if (event.transitionType?.includes('reload')) {
      navType = 'Refresh';
    } else if (event.transitionType?.includes('forward_back') || event.transitionType?.includes('back')) {
      // Chrome reports back navigation as 'forward_back'. Check this BEFORE the
      // forward check below, because 'forward_back' also contains 'forward'.
      navType = 'Back';
    } else if (event.transitionType?.includes('forward')) {
      // Pure forward navigation (user clicked browser forward button)
      navType = 'Forward';
    }

    this.interactions.push({
      interactionId: `evidence-${++this.eventIdCounter}`,
      type: navType,
      eventIds: [event.eventId],
      rawEventTypes: ['navigation'],
      metadata: {
        url: event.url,
        title: event.title,
        transitionType: event.transitionType,
      },
      confidence: 1.0,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private extractTarget(events: RecordedEvent[]): ElementIdentity | null {
    for (const event of events) {
      if (event.eventType !== 'navigation') {
        return event.target;
      }
    }
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Relationship detection helpers — shared between engine and providers
// ─────────────────────────────────────────────────────────────────────────────

import type { DomContext } from '../../recorder/recorded-event.ts';

/**
 * Check if an element is a dropdown trigger (combobox, listbox, or has popup attributes).
 * Uses domContext when available, falls back to cssSelector/classname regex.
 */
function isDropdownTrigger(
  role: string,
  className: string,
  domCtx: DomContext | undefined,
  event: RecordedEvent,
): boolean {
  // ARIA role check
  if (role === 'combobox' || role === 'listbox') return true;

  // domContext checks (preferred — captured at event time)
  if (domCtx) {
    if (domCtx.ariaExpanded !== null) return true;
    if (domCtx.ariaHasPopup) return true;
  }

  // Fallback: cssSelector and className regex
  const cssSelector = event.eventType === 'navigation' ? '' : (event.target.cssSelector || '');
  if (/aria-haspopup|aria-expanded/i.test(cssSelector)) return true;
  if (/dropdown|select|combobox/i.test(className)) return true;

  // Expanded: custom dropdown class patterns (catches Headless UI, React-Select,
  // and generic semantic class names like 'dropdown-trigger', 'select-control')
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

/**
 * Check if an element is a dropdown option.
 * Aligns with MutationProvider's broader pattern: option|item|choice|result.
 */
function isDropdownOption(role: string, className: string): boolean {
  if (role === 'option') return true;
  if (/\boption\b|\bitem\b|\bchoice\b|\bresult\b/i.test(className)) return true;

  // Expanded: custom option class patterns
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
 * Check if an element is a calendar trigger (date input or calendar button).
 * Uses domContext.inputType when available, falls back to role/class/cssSelector.
 */
function isCalendarTrigger(
  role: string,
  className: string,
  domCtx: DomContext | undefined,
  cssSelector?: string,
): boolean {
  // domContext: native date/time input types
  if (domCtx?.inputType) {
    const t = domCtx.inputType;
    if (t === 'date' || t === 'datetime-local' || t === 'time' || t === 'month' || t === 'week') {
      return true;
    }
  }

  // ARIA role
  if (role === 'gridcell' || role === 'row') return false; // cells are not triggers

  // Class patterns common in date picker libraries
  if (/date.?picker|calendar|datepicker/i.test(className)) return true;

  // Fallback: cssSelector for date inputs without domContext
  if (cssSelector && /type=["']?(date|datetime-local|time|month|week)["']?/i.test(cssSelector)) {
    return true;
  }

  // Expanded: react-datepicker and custom date picker trigger patterns
  const lower = className.toLowerCase();
  if (
    lower.includes('react-datepicker__input') ||
    lower.includes('react-datepicker__container') ||
    lower.includes('calendar-container') || lower.includes('calendar-grid') ||
    lower.includes('date-selector') || lower.includes('date-grid')
  ) {
    return true;
  }

  return false;
}

/**
 * Check if an element is a calendar cell (gridcell, day cell, calendar button).
 */
function isCalendarCell(role: string, className: string): boolean {
  // ARIA role
  if (role === 'gridcell') return true;

  // Class patterns common in date picker libraries — word-bounded to avoid
  // false positives like 'update', 'delayed', 'cellar'
  if (/\bday\b|\bcell\b|\bdate\b|gridcell|calendar/i.test(className)) return true;

  // Expanded: react-datepicker and custom date picker class patterns
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
 * If the target element is inside an iframe, enrich the interaction metadata
 * with iframe context (frameSrc, frameName, frameDepth). This is additive —
 * it never changes the interaction type.
 */
function enrichWithIframeContext(
  interaction: DetectedInteraction,
  target: ElementIdentity | null,
): void {
  if (!target?.inIframe || !target.iframeContext) return;

  const ctx = target.iframeContext;
  if (ctx.frameSrc) interaction.metadata.iframeSrc = ctx.frameSrc;
  if (ctx.frameName) interaction.metadata.iframeName = ctx.frameName;
  if (typeof ctx.frameDepth === 'number') interaction.metadata.iframeDepth = ctx.frameDepth;
}
