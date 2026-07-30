/**
 * End-to-End Validation: Adani One Passenger/Travel Class Flow
 *
 * Simulates the complete recording flow on Adani One's flight booking interface:
 *
 *   1. User clicks "2 • Premium Economy" (passenger/class trigger)
 *      → opens a popover panel with stepper controls and cabin class toggles
 *   2. User clicks "+" (increase adults) — icon-only button with aria-label
 *   3. User clicks "+" (increase children) — icon-only button with aria-label
 *   4. User clicks "Premium Economy" — toggle div (no role=radio)
 *   5. User clicks "Done" — completion button
 *
 * BEFORE the 5 detection changes:
 *   - Click target resolved to SVG chevron icon (Change 1)
 *   - No surface evidence propagated (Change 2)
 *   - multiConfig not activated — no CSS class match (Change 3)
 *   - Even if activated, internal clicks not absorbed — no class overlap (Change 4)
 *   - Stepper buttons not detected as +/- — empty accessibleName (Change 5)
 *   → Result: 5 individual Click interactions
 *
 * AFTER the 5 detection changes:
 *   → Result: 1 multiConfig interaction with configuredFields:
 *     { Adults: '+1', Children: '+1', 'Premium Economy': 'Selected' }
 *
 * Also tests the date picker flow:
 *   1. User clicks departure date field
 *   2. User clicks a date cell in the calendar popover
 *   → Result: 1 DatePicker interaction (existing behavior, no regression)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reasonAboutInteractions, resetSessionCounter } from '../../src/classifier/semantic';
import { detectInteractions } from '../../src/classifier/interaction-detector';
import type { DetectedInteraction, InteractionMetadata } from '../../src/classifier/interaction-types';
import type { SessionEvent, ElementIdentity } from '../../src/shared/types';
import type { RecordedEvent, ElementRecordedEvent } from '../../src/recorder/recorded-event';

// ── Test Helpers ─────────────────────────────────────────────────────────

let eventCounter = 0;
let interactionCounter = 0;

function resetCounters(): void {
  eventCounter = 0;
  interactionCounter = 0;
}

function makeEvent(type: string, ts: string): SessionEvent {
  return {
    actionId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    type,
    timestamp: ts,
    elementIdentity: {
      accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
      placeholder: null, tag: 'DIV', className: null, name: null,
      stableId: null, testId: null, dataCy: null, dataQa: null,
      cssSelector: '', xPath: '', inIframe: false, shadowDom: false,
      elementId: `elem-${eventCounter}`,
    },
  } as SessionEvent;
}

function makeInteraction(
  type: DetectedInteraction['type'],
  metadata: Partial<InteractionMetadata> = {},
  target?: Partial<ElementIdentity>,
): DetectedInteraction {
  return {
    interactionId: `int-${String(++interactionCounter).padStart(4, '0')}`,
    type,
    eventIds: [],
    rawEventTypes: ['click'],
    target: {
      accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
      placeholder: null, tag: 'DIV', className: null, name: null,
      stableId: null, testId: null, dataCy: null, dataQa: null,
      cssSelector: '', xPath: '', inIframe: false, shadowDom: false,
      elementId: `elem-${interactionCounter}`,
      ...target,
    },
    metadata: metadata as InteractionMetadata,
    confidence: 0.9,
    engine: 'test',
  };
}

/**
 * Create a RecordedEvent as the content script would send it.
 * This is used for detectInteractions() — the Phase 1→2 pipeline.
 */
function makeRecordedEvent(
  eventType: string,
  ts: string,
  target: Partial<ElementIdentity>,
  domContext?: Record<string, unknown>,
): RecordedEvent {
  const elEvent: ElementRecordedEvent = {
    eventId: `rev-${String(++eventCounter).padStart(4, '0')}`,
    eventType: eventType as RecordedEvent['eventType'],
    timestamp: ts,
    target: {
      accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
      placeholder: null, tag: 'DIV', className: null, name: null,
      stableId: null, testId: null, dataCy: null, dataQa: null,
      cssSelector: '', xPath: '', inIframe: false, shadowDom: false,
      elementId: `elem-${eventCounter}`,
      ...target,
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    domContext: domContext as any,
  };
  return elEvent;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Adani One End-to-End Validation', () => {
  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  // ══════════════════════════════════════════════════════════════════════
  // PASSENGER / TRAVEL CLASS FLOW
  // ══════════════════════════════════════════════════════════════════════

  describe('Passenger/Travel Class composite component', () => {

    it('BEFORE fixes: 5 individual Click interactions (baseline)', () => {
      // Simulate what the OLD pipeline would have produced:
      // No surfaceContext on trigger, no ancestor resolution,
      // no surface-anchored activation/absorption, no stepper detection.
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';
      const ts4 = '2025-01-01T00:00:04.000Z';
      const ts5 = '2025-01-01T00:00:05.000Z';

      // Trigger: SVG chevron resolved as click target (before Change 1)
      // No surfaceContext (before Change 2)
      // No CSS class match for PANEL_TRIGGER_CLASSES
      const trigger = makeInteraction('Click', {}, {
        accessibleName: '',        // SVG icon — no name (before Change 1)
        tag: 'SVG',
        className: 'chevron-down',
      });

      const plusAdults = makeInteraction('Click', {}, {
        accessibleName: '',        // Icon-only, no aria-label in old recording
        className: 'plus-icon',
      });

      const plusChildren = makeInteraction('Click', {}, {
        accessibleName: '',
        className: 'plus-icon',
      });

      const cabinToggle = makeInteraction('Click', {}, {
        accessibleName: 'Premium Economy',
        className: 'cabin-option',
      });

      const doneClick = makeInteraction('Click', {}, {
        tag: 'BUTTON',
        accessibleName: 'Done',
      });

      const result = reasonAboutInteractions(
        [trigger, plusAdults, plusChildren, cabinToggle, doneClick],
        [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3),
         makeEvent('click', ts4), makeEvent('click', ts5)],
      );

      // BEFORE fixes: all 5 interactions pass through as individual Clicks
      // (trigger has no surface context, no CSS class match → no multiConfig)
      expect(result.interactions.length).toBe(5);
      expect(result.interactions.every(i => i.type === 'Click')).toBe(true);
      expect(result.sessionsActivated).toBe(0);
    });

    it('AFTER fixes: 1 multiConfig with configuredFields', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';
      const ts4 = '2025-01-01T00:00:04.000Z';
      const ts5 = '2025-01-01T00:00:05.000Z';

      // Trigger: Change 1 resolves SVG to parent button with meaningful name
      // Change 2: surfaceType propagated from DomContext
      const trigger = makeInteraction('Click', {
        surfaceContext: {
          type: 'popover',
          label: 'Passenger selector',
          openedByThisInteraction: true,
        },
      }, {
        accessibleName: '2 • Economy',   // Change 1: resolved to trigger
        tag: 'BUTTON',
        className: 'pax-summary',
      });

      // Change 5: stepper detected via CSS class + aria-label
      const plusAdults = makeInteraction('Click', {}, {
        accessibleName: '',
        tag: 'BUTTON',
        className: 'plus-icon',
        ariaLabel: 'Increase Adults',
      });

      const plusChildren = makeInteraction('Click', {}, {
        accessibleName: '',
        tag: 'BUTTON',
        className: 'plus-icon',
        ariaLabel: 'Increase Children',
      });

      // Change 4: absorbed even though no role=radio and no class overlap
      // In the real runtime, detectSurface() walks ancestors and finds the popover,
      // so the interaction carries surfaceContext indicating it's inside the surface.
      const cabinToggle = makeInteraction('Click', {
        surfaceContext: {
          type: 'popover',
        },
      }, {
        accessibleName: 'Premium Economy',
        tag: 'DIV',
        className: 'cabin-option',
      });

      const doneClick = makeInteraction('Click', {}, {
        tag: 'BUTTON',
        accessibleName: 'Done',
      });

      const result = reasonAboutInteractions(
        [trigger, plusAdults, plusChildren, cabinToggle, doneClick],
        [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3),
         makeEvent('click', ts4), makeEvent('click', ts5)],
      );

      // AFTER fixes: 1 multiConfig interaction
      expect(result.interactions.length).toBe(1);
      expect(result.sessionsActivated).toBe(1);
      expect(result.sessionsCompleted).toBe(1);

      const interaction = result.interactions[0]!;
      expect(interaction.metadata.semanticAction).toBe('configure');
      expect(interaction.metadata.configuredFields).toBeDefined();

      const fields = interaction.metadata.configuredFields as Record<string, string>;
      expect(fields['Adults']).toBe('+1');
      expect(fields['Children']).toBe('+1');
      // Generic clicks inside the panel are recorded as Selection: <name>
      expect(fields['Selection']).toBe('Premium Economy');
    });

    it('AFTER fixes: full pipeline (detectInteractions → reasonAboutInteractions)', () => {
      // Test the full Phase 1→2→5 pipeline using RecordedEvents as the
      // content script would send them, with DomContext.surfaceType set.

      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';
      const ts4 = '2025-01-01T00:00:04.000Z';
      const ts5 = '2025-01-01T00:00:05.000Z';

      const events: RecordedEvent[] = [
        // Trigger click — opens popover (surfaceType in domContext)
        makeRecordedEvent('click', ts1, {
          accessibleName: '2 • Economy',
          tag: 'BUTTON',
          className: 'pax-summary',
          ariaRole: 'button',
        }, {
          surfaceType: 'popover',
          surfaceLabel: 'Passenger selector',
          surfaceRole: 'dialog',
        }),
        // Plus Adults — icon-only button
        makeRecordedEvent('click', ts2, {
          accessibleName: '',
          tag: 'BUTTON',
          className: 'plus-icon',
          ariaLabel: 'Increase Adults',
          ariaRole: 'button',
        }),
        // Plus Children — icon-only button
        makeRecordedEvent('click', ts3, {
          accessibleName: '',
          tag: 'BUTTON',
          className: 'plus-icon',
          ariaLabel: 'Increase Children',
          ariaRole: 'button',
        }),
        // Cabin class toggle — div with no role=radio
        // In the real runtime, detectSurface() walks ancestors and finds the
        // popover container, so domContext.surfaceType is set. This propagates
        // through extractSurfaceContext() to interaction.metadata.surfaceContext.
        makeRecordedEvent('click', ts4, {
          accessibleName: 'Premium Economy',
          tag: 'DIV',
          className: 'cabin-option',
        }, {
          surfaceType: 'popover',
          surfaceLabel: 'Passenger selector',
          surfaceRole: 'dialog',
        }),
        // Done button — completion
        makeRecordedEvent('click', ts5, {
          accessibleName: 'Done',
          tag: 'BUTTON',
          ariaRole: 'button',
        }),
      ];

      // Phase 2: detect interactions
      const interactions = detectInteractions(events);

      // Phase 5: semantic reasoning
      const sessionEvents: SessionEvent[] = events.map((e, i) => ({
        actionId: (e as ElementRecordedEvent).eventId,
        type: 'click',
        timestamp: e.timestamp,
        elementIdentity: (e as ElementRecordedEvent).target,
      }));
      const result = reasonAboutInteractions(interactions, sessionEvents);

      // Should produce 1 multiConfig interaction
      expect(result.interactions.length).toBe(1);
      expect(result.sessionsActivated).toBe(1);
      expect(result.sessionsCompleted).toBe(1);

      const interaction = result.interactions[0]!;
      expect(interaction.metadata.semanticAction).toBe('configure');

      const fields = interaction.metadata.configuredFields as Record<string, string>;
      expect(fields['Adults']).toBe('+1');
      expect(fields['Children']).toBe('+1');
      // Generic clicks inside the panel are recorded as Selection: <name>
      expect(fields['Selection']).toBe('Premium Economy');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // DATE PICKER FLOW (regression check)
  // ══════════════════════════════════════════════════════════════════════

  describe('Departure Date DatePicker (no regression)', () => {

    it('produces a single DatePicker interaction (existing behavior preserved)', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      // Click on departure date field — opens calendar popover
      const dateTrigger = makeInteraction('Click', {
        surfaceContext: {
          type: 'popover',
          openedByThisInteraction: true,
        },
      }, {
        accessibleName: 'Departure',
        tag: 'INPUT',
        className: 'date-field',
        ariaRole: 'combobox',
      });

      // Click on a calendar cell — should be classified as DatePicker
      // and complete the datePicker session (NOT activate multiConfig)
      const dateCellClick = makeInteraction('DatePicker', {
        dateValue: '2025-07-20',
      }, {
        accessibleName: '20 July 2025',
        tag: 'DIV',
        className: 'calendar-cell',
        ariaRole: 'gridcell',
      });

      const result = reasonAboutInteractions(
        [dateTrigger, dateCellClick],
        [makeEvent('click', ts1), makeEvent('click', ts2)],
      );

      // Should NOT produce multiConfig — the datePicker session should
      // activate first (priority: datePicker > multiConfig in the reasoner)
      // and the date cell click should complete it.
      const hasMultiConfig = result.interactions.some(
        i => i.metadata.semanticAction === 'configure'
      );
      expect(hasMultiConfig).toBe(false);

      // Should produce a DatePicker interaction
      const datePickerResults = result.interactions.filter(i => i.type === 'DatePicker');
      expect(datePickerResults.length).toBe(1);
      expect(datePickerResults[0]!.metadata.dateValue).toBe('2025-07-20');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // DEPARTURE DATE NOT CAPTURED TWICE
  // ══════════════════════════════════════════════════════════════════════

  describe('Departure date not captured twice', () => {

    it('a single date selection produces exactly one DatePicker interaction', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      // Click on departure date field — uses a class that matches DATEPICKER_TRIGGER_CLASSES
      const dateTrigger = makeInteraction('Click', {}, {
        accessibleName: 'Departure',
        tag: 'INPUT',
        className: 'date-picker',
        ariaRole: 'combobox',
      });

      // Click on a calendar cell — classified as DatePicker
      const dateCellClick = makeInteraction('DatePicker', {
        dateValue: '2025-07-20',
      }, {
        accessibleName: '20 July 2025',
        tag: 'DIV',
        className: 'calendar-cell',
        ariaRole: 'gridcell',
      });

      const result = reasonAboutInteractions(
        [dateTrigger, dateCellClick],
        [makeEvent('click', ts1), makeEvent('click', ts2)],
      );

      // Should produce exactly 1 DatePicker interaction (trigger + cell merged)
      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('DatePicker');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // EXISTING INTERACTIONS NOT BROKEN
  // ══════════════════════════════════════════════════════════════════════

  describe('Existing interactions not broken', () => {

    it('plain button click passes through unchanged', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';

      const click = makeInteraction('Click', {}, {
        tag: 'BUTTON',
        accessibleName: 'Search Flights',
      });

      const result = reasonAboutInteractions(
        [click],
        [makeEvent('click', ts1)],
      );

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('Click');
      expect(result.interactions[0]!.metadata.semanticAction).toBeUndefined();
    });

    it('dropdown selection still works (existing session type)', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      const trigger = makeInteraction('Click', {}, {
        accessibleName: 'From',
        tag: 'DIV',
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      const optionClick = makeInteraction('Click', {}, {
        accessibleName: 'Mumbai',
        tag: 'DIV',
        className: 'oxd-select-option',
        ariaRole: 'option',
      });

      const result = reasonAboutInteractions(
        [trigger, optionClick],
        [makeEvent('click', ts1), makeEvent('click', ts2)],
      );

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('NativeDropdown');
    });

    it('text entry passes through unchanged', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';

      const textEntry = makeInteraction('TextEntry', {
        textValue: 'BOM',
      }, {
        tag: 'INPUT',
        accessibleName: 'From City',
        ariaRole: 'textbox',
      });

      const result = reasonAboutInteractions(
        [textEntry],
        [makeEvent('input', ts1)],
      );

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('TextEntry');
    });
  });
});
