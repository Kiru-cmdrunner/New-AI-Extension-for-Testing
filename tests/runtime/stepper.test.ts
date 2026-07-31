/**
 * Stepper Visibility Model Tests (Phase 2)
 *
 * The standalone Stepper definition is now registered in ALL_DEFINITIONS.
 * Bare stepper clicks (+/- buttons outside a Dropdown/ModalDialog surface)
 * produce Stepper interactions with stepper metadata.
 *
 * Stepper clicks inside Dropdown/ModalDialog surfaces are still absorbed
 * as increment/decrement subActions — that behavior is unchanged.
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

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'BUTTON', className: null, name: null,
    stableId: null, testId: null, dataCy: null, dataQa: null,
    cssSelector: 'button', xPath: '/html/body/button',
    inIframe: false, shadowDom: false, elementId: '',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [],
    surfaceId: null, surfaceType: null, surfaceRole: null, surfaceLabel: null,
    ...overrides,
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

describe('Bare Stepper Clicks → Click with Metadata', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('produces Stepper for + click', () => {
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Increase quantity',
      stableId: 'qty-plus',
      cssSelector: 'button.qty-plus',
    }));
    runtime.flush();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('Stepper');
  });

  it('produces Stepper for - click', () => {
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '-',
      ariaLabel: 'Decrease quantity',
      stableId: 'qty-minus',
      cssSelector: 'button.qty-minus',
    }));
    runtime.flush();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('Stepper');
  });

  it('produces Stepper for repeated + clicks', () => {
    const PLUS_BTN = {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Increase quantity',
      stableId: 'qty-plus',
      cssSelector: 'button.qty-plus',
    };

    // Three + clicks on the same element — the stepper definition accumulates
    // these and produces a Stepper interaction.
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper'],
    }));
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper'],
    }));
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper'],
    }));
    runtime.flush();

    const steppers = emitted.filter(i => i.type === 'Stepper');
    expect(steppers.length).toBeGreaterThanOrEqual(1);
  });

  it('produces standalone Stepper type for bare stepper clicks', () => {
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      stableId: 'qty-plus',
      cssSelector: 'button.qty-plus',
    }));
    runtime.flush();

    const stepper = emitted.find(i => i.type === 'Stepper');
    expect(stepper).toBeDefined();
  });
});

describe('Stepper Clicks Inside Dropdown → Absorbed as SubActions', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('stepper clicks inside Dropdown surface are absorbed as increment subActions', () => {
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

    // + click inside surface
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      stableId: 'adults-plus',
      cssSelector: 'button.adults-plus',
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
    expect(subActions.some(s => s.action === 'increment')).toBe(true);

    // No standalone stepper click should escape
    const escaped = emitted.filter(
      i => i.type === 'Click' && i.metadata.isStepper === true
    );
    expect(escaped).toHaveLength(0);
  });
});
