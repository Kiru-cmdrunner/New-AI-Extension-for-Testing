/**
 * Regression Test: Economy/Passenger-Class Dropdown Capture
 *
 * Bug: Clicking the "Economy" / "Passenger Class" dropdown on Adani One was
 * captured as a bare Click instead of a full Dropdown interaction with
 * subActions (stepper clicks, class selection, Done button).
 *
 * Root cause: detectSurfaceClosure's surfaceId-based branch unconditionally
 * completed the Dropdown session when a click inside the panel lacked a
 * surfaceId (React portal rendering gap). Stepper +/- buttons inside the
 * panel were treated as "outside surface" clicks, prematurely completing
 * the session. Combined with the downcast protocol firing on completed
 * endStates, the Dropdown was downcast to Click.
 *
 * Fix:
 * 1. detectSurfaceClosure now has stepper-button + confirm-button + CSS-class
 *    surface protection in the surfaceId-based branch (matching the fallback branch).
 * 2. Dropdown.downcast() only fires on non-completed endStates.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions/index';
import type {
  ComponentInteraction,
  ObservedEvent,
  DomContext,
  BrowserEventType,
} from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTarget(o: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null,
    stableId: null, testId: null, dataCy: null, dataQa: null,
    cssSelector: 'div', xPath: '/html/body/div',
    inIframe: false, shadowDom: false, elementId: '',
    ...o,
  };
}

function makeDomContext(o: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [],
    surfaceId: null, surfaceType: null, surfaceRole: null, surfaceLabel: null,
    ...o,
  };
}

let evtCounter = 0;
function makeEvent(
  et: string, to: Partial<ElementIdentity> = {}, dc: Partial<DomContext> = {},
  ex: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: `evt-${++evtCounter}`, eventType: et as BrowserEventType,
    timestamp: Date.now() + evtCounter, isTrusted: true,
    target: makeTarget(to), domContext: makeDomContext(dc),
    valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
    clientX: null, clientY: null, key: null, code: null,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://adanione.com', pageTitle: 'Adani One',
    ...ex,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Economy Dropdown Regression', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('captures full Dropdown with stepper clicks inside surfaceId-bound panel', () => {
    // Click the combined "One Way 4 Premium Economy" trigger
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'One Way 4 Premium Economy',
      className: 'trip-type economy travel-class',
      stableId: 'pax-trigger',
      cssSelector: 'div.trip-type',
    }));

    expect(emitted).toHaveLength(0); // Dropdown lifecycle started
    expect(runtime.activeCount).toBe(1);

    // Panel opens → surface detected and bound
    // User clicks + (increment adults) — this event HAS a surfaceId (normal case)
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      className: 'stepper-plus pax-plus',
      stableId: 'adult-plus',
      cssSelector: 'button.stepper-plus',
    }, {
      surfaceId: 'pax-surface',
      surfaceType: 'popover',
    }));

    expect(runtime.activeCount).toBe(1); // Still active, not completed

    // Click - (decrement adults) — also has surfaceId
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '-',
      className: 'stepper-minus pax-minus',
      stableId: 'adult-minus',
      cssSelector: 'button.stepper-minus',
    }, {
      surfaceId: 'pax-surface',
      surfaceType: 'popover',
    }));

    expect(runtime.activeCount).toBe(1); // Still active

    // Select Premium Economy class
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Premium Economy',
      className: 'class-option selected',
      stableId: 'class-premium',
      cssSelector: 'div.class-option',
    }, {
      surfaceId: 'pax-surface',
      surfaceType: 'popover',
    }));

    expect(runtime.activeCount).toBe(1); // Still active

    // Click Done button
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: 'Done',
      className: 'btn-primary done-btn',
      stableId: 'done-btn',
      cssSelector: 'button.done-btn',
    }, {
      surfaceId: 'pax-surface',
      surfaceType: 'popover',
    }));

    // Should emit one Dropdown with subActions
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('Dropdown');
    expect(emitted[0].endState).toBe('completed');
    expect(emitted[0].interactionSubtype).toBe('CustomDropdown');
    const subActions = emitted[0].metadata.subActions as any[];
    expect(subActions.length).toBeGreaterThanOrEqual(3);
    // Should have stepper subActions
    const stepperActions = subActions.filter(s => s.action === 'increment' || s.action === 'decrement');
    expect(stepperActions.length).toBe(2);
    // Should have doneClicked
    expect(emitted[0].metadata.doneClicked).toBe(true);
  });

  it('preserves Dropdown when stepper click LACKS surfaceId (portal render gap)', () => {
    // This is the core regression scenario: React portal renders the panel
    // but the stepper button's DOM context doesn't carry the surfaceId.

    // Click trigger
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Economy',
      className: 'fare-type economy dropdown-trigger',
      stableId: 'fare-trigger',
      cssSelector: 'div.fare-type',
    }));

    // Panel opens → first in-panel event carries surfaceId, binds to session
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Premium Economy',
      className: 'class-card',
      stableId: 'premium-card',
      cssSelector: 'div.class-card',
    }, {
      surfaceId: 'fare-surface',
      surfaceType: 'popover',
    }));

    expect(runtime.activeCount).toBe(1);

    // Stepper + click WITHOUT surfaceId (the regression trigger)
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      className: 'stepper-plus counter-plus',
      stableId: 'pax-plus-btn',
      cssSelector: 'button.counter-plus',
    }));  // ← NO surfaceId, NO ancestorClasses

    // CRITICAL: session must still be active, not prematurely completed
    expect(runtime.activeCount).toBe(1);

    // Click outside to complete
    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    // Should produce a Dropdown, NOT a Click
    const dropdown = emitted.find(i => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.endState).toBe('completed');

    // Should NOT have been downcast to Click
    const click = emitted.find(i => i.type === 'Click');
    expect(click).toBeUndefined();
  });

  it('still downcasts false-positive Dropdown to Click (no surface opened)', () => {
    // A DIV with dropdown-like CSS classes but no panel actually opens.
    // This is a genuinely false-positive trigger — should still downcast.

    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Fare Type Tile',
      className: 'fare-type dropdown-trigger',
      stableId: 'fare-tile',
      cssSelector: 'div.fare-type',
    }));

    // No surface opens. User clicks elsewhere.
    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    // Flush to complete the interrupted Dropdown session
    runtime.flush();

    // Should downcast to Click — no surface opened, no subActions
    const dropdown = emitted.find(i => i.type === 'Dropdown');
    const click = emitted.find(i => i.type === 'Click');
    expect(dropdown).toBeUndefined();
    expect(click).toBeDefined();
  });

  it('still downcasts Dropdown to Click when session is interrupted (not completed)', () => {
    // Dropdown triggers, no surface opens, interrupted by a new trigger
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Selector',
      className: 'dropdown-trigger',
      stableId: 'trigger-1',
      cssSelector: 'div.dropdown-trigger',
    }));

    // A new trigger event interrupts (different element, no surface)
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: 'Search',
      className: 'btn-primary search-btn',
      stableId: 'search-btn',
      cssSelector: 'button.search-btn',
    }));

    // The interrupted Dropdown should downcast to Click
    const click = emitted.find(i => i.type === 'Click');
    expect(click).toBeDefined();
  });
});
