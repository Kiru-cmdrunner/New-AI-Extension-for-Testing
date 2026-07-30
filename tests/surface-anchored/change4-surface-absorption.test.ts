/**
 * Surface-Anchored Absorption — Change 4
 *
 * Tests that interactions inside a surface-activated multiConfig session
 * are absorbed regardless of CSS class overlap with the trigger.
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

describe('Surface-Anchored multiConfig Absorption', () => {
  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  it('absorbs +/- button clicks with no CSS class overlap (surface-anchored)', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';
    const ts4 = '2025-01-01T00:00:04.000Z';

    // Trigger opens a popover — activates via surface evidence
    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Premium Economy',
      className: 'pax-summary',  // No overlap with counter-btn
    });

    // Plus button — has DIFFERENT class than trigger
    const plusClick = makeInteraction('Click', {}, {
      accessibleName: 'Add Adult',
      className: 'counter-btn increment',  // No class overlap with 'pax-summary'
    });

    // Minus button
    const minusClick = makeInteraction('Click', {}, {
      accessibleName: 'Remove Adult',
      className: 'counter-btn decrement',
    });

    // Done button — completes the session
    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plusClick, minusClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3), makeEvent('click', ts4)],
    );

    // Should produce 1 interaction (multiConfig with configured fields)
    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    expect(result.interactions[0].metadata.configuredFields).toBeDefined();
    // Should have absorbed the +/- clicks as field values
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(Object.keys(fields).length).toBeGreaterThanOrEqual(2);
  });

  it('absorbs travel class toggle clicks with no role=radio (surface-anchored)', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Economy',
      className: 'pax-summary',
    });

    // Toggle button for Premium Economy — no role=radio, just a div with click
    // In the real runtime, detectSurface() walks ancestors and finds the popover,
    // so the interaction carries surfaceContext indicating it's inside the surface.
    const toggleClick = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
      },
    }, {
      accessibleName: 'Premium Economy',
      className: 'cabin-option',  // No overlap with 'pax-summary'
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, toggleClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    // The toggle click should be absorbed as a field
    expect(Object.keys(fields).length).toBeGreaterThanOrEqual(1);
  });

  it('absorbs slider interactions inside surface-anchored session', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'drawer',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: 'Filters',
      className: 'filter-trigger',
    });

    const sliderChange = makeInteraction('Slider', {
      sliderValue: '5000',
    }, {
      accessibleName: 'Price Range',
    });

    const applyClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Apply',
    });

    const result = reasonAboutInteractions(
      [trigger, sliderChange, applyClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Price Range']).toBe('5000');
  });

  it('does NOT absorb when session was NOT surface-activated and no class overlap', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    // Trigger activates via CSS class (no surfaceContext)
    const trigger = makeInteraction('Click', {}, {
      accessibleName: 'Preferences',
      className: 'preferences-panel',  // In PANEL_TRIGGER_CLASSES
    });

    // Click with NO class overlap and NO stepper keyword
    const unrelatedClick = makeInteraction('Click', {}, {
      accessibleName: 'Some Other Button',
      className: 'unrelated-component',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, unrelatedClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    // The unrelated click should NOT be absorbed — it passes through.
    // The trigger activates multiConfig, the unrelated click is not absorbed
    // (outside-click cancellation), and doneClick would then be standalone.
    // So we should get more than 1 interaction.
    expect(result.interactions.length).toBeGreaterThan(1);
  });

  it('still uses CSS class overlap for non-surface sessions', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    // Trigger activates via CSS class matching (no surface)
    const trigger = makeInteraction('Click', {}, {
      accessibleName: 'Options',
      className: 'preferences-panel',
    });

    // Click with class overlap — name must NOT match PANEL_COMPLETION_KEYWORDS
    const internalClick = makeInteraction('Click', {}, {
      accessibleName: 'Option A',
      className: 'preferences-panel-item',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, internalClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
  });

  it('absorbs TextEntry inside surface-anchored session', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: 'Guest Details',
      className: 'guest-trigger',
    });

    const textEntry = makeInteraction('TextEntry', {
      textValue: 'John Doe',
    }, {
      tag: 'INPUT',
      accessibleName: 'Full Name',
      className: 'form-input',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, textEntry, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Full Name']).toBe('John Doe');
  });

  it('does NOT absorb PageNavigation inside surface-anchored session', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: 'Menu',
      className: 'menu-trigger',
    });

    // PageNavigation is handled by the navigation lookback merge, not absorption
    const navigation = makeInteraction('PageNavigation', {
      url: 'https://example.com/other',
    });

    const result = reasonAboutInteractions(
      [trigger, navigation],
      [makeEvent('click', ts1), makeEvent('click', ts2)],
    );

    // PageNavigation should NOT be absorbed — it's not in the absorbable types set.
    // The multiConfig session should be cancelled/committed and the navigation
    // should appear in the output.
    const hasNav = result.interactions.some(i => i.type === 'PageNavigation');
    expect(hasNav).toBe(true);
  });
});
