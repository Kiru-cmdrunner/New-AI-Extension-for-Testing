/**
 * Adani One Verification — Issue 7 & Issue 8b Fixes
 *
 * Issue 7: "Cheapest" button click outside the multiConfig panel is absorbed
 *          and silently swallowed. Root cause: shouldAbsorbMultiConfig()
 *          Strategy 1 absorbed ALL Click types when surface-anchored, with
 *          no boundary check.
 *
 *          Fix: Click interactions require boundary evidence — either the
 *          interaction itself has surfaceContext (detectSurface() found a
 *          surface ancestor), is a stepper button, or shares CSS class
 *          tokens with the trigger. Clicks without any boundary evidence
 *          fall through to outside-click cancellation.
 *
 * Issue 8b: Stepper values overwrite instead of accumulating. Three "+" clicks
 *           on "Adults" produce { Adults: '+1' } instead of { Adults: '+3' }.
 *
 *           Fix: When the field value is '+1' or '-1', accumulate into an
 *           integer count instead of overwriting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reasonAboutInteractions, resetSessionCounter } from '../src/classifier/semantic';
import type { DetectedInteraction, InteractionMetadata } from '../src/classifier/interaction-types';
import type { SessionEvent, ElementIdentity } from '../src/shared/types';

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

describe('Adani One — Issue 7: Outside-click boundary check', () => {
  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  it('clicks INSIDE the panel (with surfaceContext) are absorbed', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    // Trigger opens a popover — activates multiConfig
    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Economy',
      className: 'pax-summary',
    });

    // Click inside the panel (has surfaceContext from detectSurface())
    const insideClick = makeInteraction('Click', {
      surfaceContext: { type: 'popover' },
    }, {
      accessibleName: 'Premium Economy',
      className: 'cabin-option',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, insideClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    // Should produce 1 multiConfig interaction (inside click absorbed)
    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Selection']).toBe('Premium Economy');
  });

  it('clicks OUTSIDE the panel (no surfaceContext) are NOT absorbed', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';

    // Trigger opens a popover — activates multiConfig
    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Economy',
      className: 'pax-summary',
    });

    // "Cheapest" fare button — OUTSIDE the panel (no surfaceContext)
    // No CSS class overlap with trigger, not a stepper
    const outsideClick = makeInteraction('Click', {}, {
      accessibleName: 'Cheapest',
      className: 'fare-card',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, outsideClick, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3)],
    );

    // The outside click should NOT be absorbed — it triggers multiConfig
    // cancellation (commit what we have), then the doneClick is standalone.
    // We should get more than 1 interaction.
    expect(result.interactions.length).toBeGreaterThan(1);

    // The "Cheapest" click should appear in the output
    const hasCheapest = result.interactions.some(
      i => i.target?.accessibleName === 'Cheapest',
    );
    expect(hasCheapest).toBe(true);
  });

  it('stepper clicks outside CSS class overlap are still absorbed (inside panel)', () => {
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

    // Stepper button — no CSS overlap but detected as stepper via aria-label
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

    // Should produce 1 multiConfig (stepper absorbed)
    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Adults']).toBe('+1');
  });

  it('outside click commits multiConfig with accumulated fields', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';
    const ts4 = '2025-01-01T00:00:04.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Economy',
      className: 'pax-summary',
    });

    // Stepper inside panel — absorbed
    const plusClick = makeInteraction('Click', {}, {
      accessibleName: '',
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });

    // Click outside panel — no surfaceContext, no class overlap, not stepper
    // Note: "Search Flights" would match PANEL_COMPLETION_KEYWORDS because
    // 'search' is a completion keyword. Use a name that won't match to
    // isolate the outside-click absorption boundary test.
    const outsideClick = makeInteraction('Click', {}, {
      accessibleName: 'View Details',
      className: 'fare-card',
    });

    const result = reasonAboutInteractions(
      [trigger, plusClick, outsideClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3), makeEvent('click', ts4)],
    );

    // The multiConfig should be committed (had fields from stepper),
    // and the outside click should pass through.
    const multiConfigResults = result.interactions.filter(
      i => i.metadata.semanticAction === 'configure',
    );
    expect(multiConfigResults.length).toBe(1);

    const fields = multiConfigResults[0]!.metadata.configuredFields as Record<string, string>;
    expect(fields['Adults']).toBe('+1');

    // The outside click should also be in the output
    const hasOutside = result.interactions.some(
      i => i.target?.accessibleName === 'View Details',
    );
    expect(hasOutside).toBe(true);
  });
});

describe('Adani One — Issue 8b: Stepper value accumulation', () => {
  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  it('multiple +1 clicks on same field accumulate to +3', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';
    const ts4 = '2025-01-01T00:00:04.000Z';
    const ts5 = '2025-01-01T00:00:05.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Economy',
      className: 'pax-summary',
    });

    // Three "+" clicks on Adults
    const plus1 = makeInteraction('Click', {}, {
      accessibleName: '',
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });
    const plus2 = makeInteraction('Click', {}, {
      accessibleName: '',
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });
    const plus3 = makeInteraction('Click', {}, {
      accessibleName: '',
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plus1, plus2, plus3, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3),
       makeEvent('click', ts4), makeEvent('click', ts5)],
    );

    expect(result.interactions.length).toBe(1);
    expect(result.interactions[0].metadata.semanticAction).toBe('configure');
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    // Three +1 clicks should accumulate to +3
    expect(fields['Adults']).toBe('+3');
  });

  it('mixed + and - clicks on same field accumulate correctly', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';
    const ts4 = '2025-01-01T00:00:04.000Z';
    const ts5 = '2025-01-01T00:00:05.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Economy',
      className: 'pax-summary',
    });

    // 2 plus + 1 minus = +1
    const plus1 = makeInteraction('Click', {}, {
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });
    const plus2 = makeInteraction('Click', {}, {
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });
    const minus1 = makeInteraction('Click', {}, {
      className: 'minus-icon',
      ariaLabel: 'Decrease Adults',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plus1, plus2, minus1, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3),
       makeEvent('click', ts4), makeEvent('click', ts5)],
    );

    expect(result.interactions.length).toBe(1);
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    // 2 + 1 - 1 = +1 (net)
    expect(fields['Adults']).toBe('+1');
  });

  it('steppers on different fields accumulate independently', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';
    const ts4 = '2025-01-01T00:00:04.000Z';
    const ts5 = '2025-01-01T00:00:05.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: '2 • Economy',
      className: 'pax-summary',
    });

    const plusAdults1 = makeInteraction('Click', {}, {
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });
    const plusAdults2 = makeInteraction('Click', {}, {
      className: 'plus-icon',
      ariaLabel: 'Increase Adults',
    });
    const plusChildren = makeInteraction('Click', {}, {
      className: 'plus-icon',
      ariaLabel: 'Increase Children',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, plusAdults1, plusAdults2, plusChildren, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3),
       makeEvent('click', ts4), makeEvent('click', ts5)],
    );

    expect(result.interactions.length).toBe(1);
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    expect(fields['Adults']).toBe('+2');
    expect(fields['Children']).toBe('+1');
  });

  it('non-stepper field values (Selection, Selected, On, Off) still overwrite', () => {
    const ts1 = '2025-01-01T00:00:01.000Z';
    const ts2 = '2025-01-01T00:00:02.000Z';
    const ts3 = '2025-01-01T00:00:03.000Z';
    const ts4 = '2025-01-01T00:00:04.000Z';

    const trigger = makeInteraction('Click', {
      surfaceContext: {
        type: 'popover',
        openedByThisInteraction: true,
      },
    }, {
      accessibleName: 'Options',
      className: 'pax-summary',
    });

    // First selection
    const select1 = makeInteraction('Click', {
      surfaceContext: { type: 'popover' },
    }, {
      accessibleName: 'Premium Economy',
      className: 'cabin-option',
    });

    // Second selection on same panel — should overwrite (not accumulate)
    const select2 = makeInteraction('Click', {
      surfaceContext: { type: 'popover' },
    }, {
      accessibleName: 'Business',
      className: 'cabin-option',
    });

    const doneClick = makeInteraction('Click', {}, {
      tag: 'BUTTON',
      accessibleName: 'Done',
    });

    const result = reasonAboutInteractions(
      [trigger, select1, select2, doneClick],
      [makeEvent('click', ts1), makeEvent('click', ts2), makeEvent('click', ts3), makeEvent('click', ts4)],
    );

    expect(result.interactions.length).toBe(1);
    const fields = result.interactions[0].metadata.configuredFields as Record<string, string>;
    // Selection overwrites — last value wins
    expect(fields['Selection']).toBe('Business');
  });
});
