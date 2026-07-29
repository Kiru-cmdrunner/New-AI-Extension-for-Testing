/**
 * Surface Evidence Propagation — Change 2
 *
 * Tests that DomContext.surfaceType/surfaceLabel/surfaceRole are propagated
 * into DetectedInteraction.metadata.surfaceContext by the interaction detector.
 */

import { describe, it, expect } from 'vitest';
import { detectInteractions } from '../../src/classifier/interaction-detector';
import type { RecordedEvent, ElementRecordedEvent } from '../../src/recorder/recorded-event';
import type { ElementIdentity } from '../../src/shared/types';

// ── Test Helpers ─────────────────────────────────────────────────────────

let eventCounter = 0;

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    elementId: `elem-${++eventCounter}`,
    ...overrides,
  };
}

function makeClickEvent(
  target: Partial<ElementIdentity> = {},
  domContext?: ElementRecordedEvent['domContext'],
): RecordedEvent {
  return {
    eventId: `evt-${++eventCounter}`,
    eventType: 'click',
    timestamp: new Date().toISOString(),
    target: makeElementIdentity(target),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    domContext: domContext ?? {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
    },
  } as RecordedEvent;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Surface Evidence Propagation', () => {

  it('propagates surfaceType from DomContext to metadata.surfaceContext', () => {
    const events: RecordedEvent[] = [
      makeClickEvent(
        { tag: 'DIV', className: 'pax-trigger', accessibleName: 'Passengers and class' },
        {
          inputType: null,
          ariaExpanded: true,
          ariaHasPopup: 'dialog',
          isContentEditable: false,
          surfaceType: 'popover',
          surfaceRole: 'dialog',
          surfaceLabel: 'Passenger selector',
        },
      ),
    ];

    const interactions = detectInteractions(events);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].metadata.surfaceContext).not.toBeNull();
    expect(interactions[0].metadata.surfaceContext?.type).toBe('popover');
    expect(interactions[0].metadata.surfaceContext?.role).toBe('dialog');
    expect(interactions[0].metadata.surfaceContext?.label).toBe('Passenger selector');
    expect(interactions[0].metadata.surfaceContext?.openedByThisInteraction).toBe(true);
  });

  it('sets surfaceContext to null when no surface info in DomContext', () => {
    const events: RecordedEvent[] = [
      makeClickEvent({ tag: 'BUTTON', accessibleName: 'Submit' }),
    ];

    const interactions = detectInteractions(events);
    expect(interactions).toHaveLength(1);
    // surfaceContext is undefined (not set) when no surface info present
    expect(interactions[0].metadata.surfaceContext).toBeFalsy();
  });

  it('propagates surfaceType even for null surfaceLabel/surfaceRole', () => {
    const events: RecordedEvent[] = [
      makeClickEvent(
        { tag: 'DIV', className: 'dropdown-trigger', accessibleName: 'Nationality' },
        {
          inputType: null,
          ariaExpanded: true,
          ariaHasPopup: 'listbox',
          isContentEditable: false,
          surfaceType: 'popover',
          surfaceRole: null,
          surfaceLabel: null,
        },
      ),
    ];

    const interactions = detectInteractions(events);
    expect(interactions[0].metadata.surfaceContext).not.toBeNull();
    expect(interactions[0].metadata.surfaceContext?.type).toBe('popover');
    expect(interactions[0].metadata.surfaceContext?.role).toBeUndefined();
    expect(interactions[0].metadata.surfaceContext?.label).toBeUndefined();
  });

  it('handles events without DomContext (backward compatible)', () => {
    const event: RecordedEvent = {
      eventId: `evt-${++eventCounter}`,
      eventType: 'click',
      timestamp: new Date().toISOString(),
      target: makeElementIdentity({ tag: 'BUTTON', accessibleName: 'Save' }),
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      // No domContext at all
    } as RecordedEvent;

    const interactions = detectInteractions([event]);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].metadata.surfaceContext).toBeUndefined();
  });

  it('propagates surfaceType for drawer surfaces', () => {
    const events: RecordedEvent[] = [
      makeClickEvent(
        { tag: 'DIV', className: 'filter-button', accessibleName: 'Filters' },
        {
          inputType: null,
          ariaExpanded: true,
          ariaHasPopup: null,
          isContentEditable: false,
          surfaceType: 'drawer',
        },
      ),
    ];

    const interactions = detectInteractions(events);
    expect(interactions[0].metadata.surfaceContext?.type).toBe('drawer');
    expect(interactions[0].metadata.surfaceContext?.openedByThisInteraction).toBe(true);
  });
});
