/**
 * Surface-Anchored Activation — Change 3
 *
 * Tests that multiConfig session activates when a click causes a surface
 * (popover, drawer) to appear — even without trigger CSS classes.
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

describe('Surface-Anchored multiConfig Activation', () => {
  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  it('activates multiConfig when click opens a popover (no trigger classes)', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        label: 'Passenger selector',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Premium Economy',
      className: 'pax-summary',  // NOT in PANEL_TRIGGER_CLASSES
    });

    const plusClick = makeInteraction('Click', {}, {
      accessibleName: 'Add Adult',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plusClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    // Should produce 1 interaction (the multiConfig collapsed result)
    expect(result.interactions.length).toBe(1);
    // The result should have semanticAction='configure'
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    // Should have configuredFields
    expect(result.interactions[0].metadata.configuredFields).toBeDefined();
  });

  it('activates multiConfig when click opens a drawer', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'drawer',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: 'Filters',
      className: 'filter-button',
    });

    const applyClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Apply',
    });

    const result = reasonAboutInteractions(
      [trigger, applyClick],
      [makeEvent('click', ts1), makeEvent('click', ts2)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
  });

  it('does NOT activate multiConfig when click opens a tooltip', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';

    const click = makeInteraction('Click', {
      surfaceContext: {
        type: 'tooltip',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: 'Help',
    });

    const result = reasonAboutInteractions(
      [click],
      [makeEvent('click', ts1)],
    );

    // Tooltip doesn't activate multiConfig — passes through as Click
    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].type).toBe('Click');
    expect(result.interactions[0].metadata.semanticAction).toBeUndefined();
  });

  it('does NOT activate multiConfig for normal button clicks (no surface)', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';

    const click = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Submit',
    });

    const result = reasonAboutInteractions(
      [click],
      [makeEvent('click', ts1)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].type).toBe('Click');
    expect(result.interactions[0].metadata.semanticAction).toBeUndefined();
  });

  it('still activates via CSS class matching when no surfaceContext', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';

    const trigger = makeInteraction('Click', {}, {
      accessibleName: 'Preferences',
      className: 'preferences-panel',  // In PANEL_TRIGGER_CLASSES
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
  });
});
