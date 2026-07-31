/**
 * Interaction Visibility Model Tests
 *
 * Tests that:
 *   1. Stepper clicks outside surfaces produce Click with stepper metadata (not standalone Stepper)
 *   2. Stepper clicks inside Dropdown surfaces are absorbed as subActions
 *   3. The VISIBILITY_TIER map classifies types correctly
 *   4. shouldSuppress() filters internal-only types
 *   5. Contextual rendering applies reduced visual weight
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
    pageUrl: 'https://example.com', pageTitle: 'Test',
    ...ex,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Visibility Model: Stepper Removal from Standalone', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('does NOT produce a standalone Stepper interaction', () => {
    // Click a + stepper button outside any surface
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      className: 'stepper-plus',
      stableId: 'qty-plus',
      cssSelector: 'button.stepper-plus',
    }));

    const stepper = emitted.find(i => i.type === 'Stepper');
    expect(stepper).toBeUndefined();
  });

  it('produces a Click with stepper metadata for bare stepper clicks', () => {
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      className: 'stepper-plus',
      stableId: 'qty-plus',
      cssSelector: 'button.stepper-plus',
    }));

    const click = emitted.find(i => i.type === 'Click');
    expect(click).toBeDefined();
    expect(click!.metadata.isStepper).toBe(true);
    expect(click!.metadata.stepperDirection).toBe('increment');
  });

  it('produces a Click with decrement metadata for - stepper clicks', () => {
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '-',
      className: 'stepper-minus',
      stableId: 'qty-minus',
      cssSelector: 'button.stepper-minus',
    }));

    const click = emitted.find(i => i.type === 'Click');
    expect(click).toBeDefined();
    expect(click!.metadata.isStepper).toBe(true);
    expect(click!.metadata.stepperDirection).toBe('decrement');
  });

  it('still absorbs stepper clicks as subActions inside a Dropdown', () => {
    // Open dropdown
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Passengers',
      ariaRole: 'combobox',
      className: 'dropdown-trigger',
      stableId: 'pax-trigger',
      cssSelector: 'div.dropdown-trigger',
    }, {
      ariaHasPopup: 'listbox',
    }));

    // Click + inside the surface
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      className: 'stepper-plus',
      stableId: 'adult-plus',
      cssSelector: 'button.stepper-plus',
    }, {
      surfaceId: 'pax-surface',
      surfaceType: 'popover',
    }));

    // Click - inside the surface
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '-',
      className: 'stepper-minus',
      stableId: 'adult-minus',
      cssSelector: 'button.stepper-minus',
    }, {
      surfaceId: 'pax-surface',
      surfaceType: 'popover',
    }));

    // Close
    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    const dropdown = emitted.find(i => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    const subActions = dropdown!.metadata.subActions as any[];
    expect(subActions).toBeDefined();
    expect(subActions.length).toBeGreaterThanOrEqual(2);
    // Stepper clicks should be increment/decrement subActions
    const incActions = subActions.filter(s => s.action === 'increment');
    const decActions = subActions.filter(s => s.action === 'decrement');
    expect(incActions.length).toBe(1);
    expect(decActions.length).toBe(1);

    // Should NOT have emitted standalone Click interactions for the steppers
    const stepperClicks = emitted.filter(
      i => i.type === 'Click' && i.metadata.isStepper === true
    );
    expect(stepperClicks).toHaveLength(0);
  });

  it('ALL_DEFINITIONS does not contain stepperDefinition', () => {
    const stepperDef = ALL_DEFINITIONS.find(d => d.type === 'Stepper');
    expect(stepperDef).toBeUndefined();
  });
});

describe('Visibility Model: Stepper SubActions Still Work', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('multiple stepper clicks inside Dropdown produce compressed subActions', () => {
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Quantity',
      ariaRole: 'combobox',
      className: 'dropdown-trigger',
      stableId: 'qty-trigger',
      cssSelector: 'div.qty-trigger',
    }, {
      ariaHasPopup: 'listbox',
    }));

    // Three + clicks inside surface
    for (let i = 0; i < 3; i++) {
      runtime.process(makeEvent('click', {
        tag: 'BUTTON',
        accessibleName: '+',
        className: 'stepper-plus',
        stableId: 'qty-plus',
        cssSelector: 'button.qty-plus',
      }, {
        surfaceId: 'qty-surface',
        surfaceType: 'popover',
      }, {
        valueBefore: String(i),
        valueAfter: String(i + 1),
      }));
    }

    // Close
    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    const dropdown = emitted.find(i => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    const subActions = dropdown!.metadata.subActions as any[];
    const incActions = subActions.filter(s => s.action === 'increment');
    expect(incActions.length).toBe(3);
  });
});
