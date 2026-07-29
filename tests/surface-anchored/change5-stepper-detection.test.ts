/**
 * Stepper Detection Enhancement — Change 5
 *
 * Tests that icon-only +/- stepper buttons are correctly detected via:
 * 1. CSS class patterns (plus-icon, counter-btn, etc.)
 * 2. aria-label patterns ("Increase Adults", "Decrease Children")
 * 3. accessibleName ("+", "-", "Add", "Remove")
 *
 * Also tests that extractConfigField produces correct field names and values.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reasonAboutInteractions, resetSessionCounter } from '../../src/classifier/semantic';
import type { DetectedInteraction, InteractionMetadata } from '../../src/classifier/interaction-types';
import type { SessionEvent, ElementIdentity } from '../../src/shared/types';

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

// ── Tests ────────────────────────────────────────────────────────────────

describe('Stepper Detection Enhancement', () => {
  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  it('detects icon-only plus button via CSS class and extracts +1', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: { type: 'popover', openedByThisInteraction: true },
    }, {
      accessibleName: '2 • Premium Economy',
      className: 'pax-summary',
    });

    // Icon-only plus button — no text, detected via CSS class
    const plusClick = makeInteraction('Click', {}, {
      accessibleName: '',
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plusClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Adults']).toBe('+1');
  });

  it('detects icon-only minus button via CSS class and extracts -1', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: { type: 'popover', openedByThisInteraction: true },
    }, {
      accessibleName: '2 • Premium Economy',
      className: 'pax-summary',
    });

    const minusClick = makeInteraction('Click', {}, {
      accessibleName: '',
      className: 'minus-icon',
      ariaLabel: 'Decrease Children',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, minusClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    expect(result.interactions.length).toBe(1);
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Children']).toBe('-1');
  });

  it('detects stepper via aria-label only (no CSS class)', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: { type: 'popover', openedByThisInteraction: true },
    }, {
      accessibleName: 'Guests',
      className: 'guest-trigger',
    });

    // Button has only aria-label, no CSS class pattern, no accessibleName
    const plusClick = makeInteraction('Click', {}, {
      accessibleName: '',
      className: 'btn-icon',
      ariaLabel: 'Add Infant',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plusClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    expect(result.interactions.length).toBe(1);
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Infant']).toBe('+1');
  });

  it('detects stepper via accessibleName "+" or "-"', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';
    const ts4 = '2025-01-01T00:00:04.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: { type: 'popover', openedByThisInteraction: true },
    }, {
      accessibleName: 'Passengers',
      className: 'pax-trigger',
    });

    const plusClick = makeInteraction('Click', {}, {
      accessibleName: '+',
      className: 'btn',
    });

    const minusClick = makeInteraction('Click', {}, {
      accessibleName: '-',
      className: 'btn',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plusClick, minusClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3), makeEvent('click', ts4)],
    );

    expect(result.interactions.length).toBe(1);
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    // Both steppers should be in the fields
    expect(Object.keys(fields).length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT absorb non-stepper icon buttons as steppers (Strategy 2)', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    // Non-surface session — uses Strategy 2 (CSS class overlap)
    const trigger = makeInteraction('Click', {}, {
      accessibleName: 'Options',
      className: 'preferences-panel',
    });

    // Close X button — NOT a stepper
    const closeClick = makeInteraction('Click', {}, {
      accessibleName: 'Close',
      className: 'close-icon',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, closeClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    // Close button should NOT be absorbed as a stepper — it either passes
    // through (outside-click cancellation) or is absorbed as a generic click.
    // Either way, it should NOT produce a configuredFields entry with '+1' or '-1'.
    const configInteraction = result.interactions.find(
      i => i.metadata.semanticAction === 'configure'
    );
    if (configInteraction) {
      const fields = configInteraction.metadata.configuredFields as Record<string, string>;
      // Close button should not produce a stepper value
      expect(Object.values(fields)).not.toContain('+1');
      expect(Object.values(fields)).not.toContain('-1');
    }
  });

  it('extracts field name from aria-label "Increase Adults" → "Adults"', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: { type: 'popover', openedByThisInteraction: true },
    }, {
      accessibleName: 'Passengers',
      className: 'pax-trigger',
    });

    const plusAdults = makeInteraction('Click', {}, {
      accessibleName: '',
      ariaLabel: 'Increase Adults',
      className: 'stepper-plus',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plusAdults, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    expect(result.interactions.length).toBe(1);
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Adults']).toBe('+1');
  });

  it('multiple steppers for different fields produce separate entries', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';
    const ts4 = '2025-01-01T00:00:04.000Z';
    const ts5 = '2025-01-01T00:00:05.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: { type: 'popover', openedByThisInteraction: true },
    }, {
      accessibleName: 'Passengers',
      className: 'pax-trigger',
    });

    const plusAdults = makeInteraction('Click', {}, {
      accessibleName: '',
      ariaLabel: 'Increase Adults',
      className: 'plus-icon',
    });

    const plusChildren = makeInteraction('Click', {}, {
      accessibleName: '',
      ariaLabel: 'Increase Children',
      className: 'plus-icon',
    });

    const minusInfants = makeInteraction('Click', {}, {
      accessibleName: '',
      ariaLabel: 'Decrease Infants',
      className: 'minus-icon',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plusAdults, plusChildren, minusInfants, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3), makeEvent('click', ts4), makeEvent('click', ts5)],
    );

    expect(result.interactions.length).toBe(1);
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Adults']).toBe('+1');
    expect(fields['Children']).toBe('+1');
    expect(fields['Infants']).toBe('-1');
  });
});
