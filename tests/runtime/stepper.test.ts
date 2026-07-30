/**
 * Standalone Stepper Tests
 *
 * Validates DOM-proximity grouping for independent +/- button pairs
 * outside dropdown/modal surfaces. Verifies:
 * 1. Multiple + clicks on the same field group as one interaction
 * 2. Different fields produce separate interactions
 * 3. Decrement tracking (negative deltas)
 * 4. Field name extraction
 * 5. No interference with Dropdown steppers (inside surfaces)
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
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'button',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    elementId: '',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    surfaceId: null,
    surfaceType: null,
    surfaceRole: null,
    surfaceLabel: null,
    ...overrides,
  };
}

let evtCounter = 0;
function makeEvent(
  eventType: string,
  targetOverrides: Partial<ElementIdentity> = {},
  domContextOverrides: Partial<DomContext> = {},
  extras: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: `evt-${++evtCounter}`,
    eventType: eventType as BrowserEventType,
    timestamp: Date.now(),
    isTrusted: true,
    target: makeTarget(targetOverrides),
    domContext: makeDomContext(domContextOverrides),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com/cart',
    pageTitle: 'Shopping Cart',
    ...extras,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Standalone Stepper', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  it('groups multiple + clicks on the same field as one Stepper interaction', () => {
    const PLUS_BTN = {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Increase quantity',
      ariaRole: 'button',
      stableId: 'qty-plus',
      cssSelector: 'button.qty-plus',
    };

    // Click + three times
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product-item', 'cart'],
    }));
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product-item', 'cart'],
    }));
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product-item', 'cart'],
    }));

    // Click outside to complete
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Page',
      stableId: 'page',
      cssSelector: 'div#page',
    }));

    const stepper = emitted.find((i) => i.type === 'Stepper');
    expect(stepper).toBeDefined();
    expect(stepper!.endState).toBe('completed');
    expect(stepper!.metadata.totalDelta).toBe(3);
    expect(stepper!.metadata.incrementCount).toBe(3);
    expect(stepper!.metadata.decrementCount).toBe(0);
  });

  it('produces separate Stepper interactions for different fields', () => {
    const ADULTS_PLUS = {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Add adult',
      ariaRole: 'button',
      stableId: 'adults-plus',
      cssSelector: 'button.adults-plus',
    };

    const CHILDREN_PLUS = {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Add child',
      ariaRole: 'button',
      stableId: 'children-plus',
      cssSelector: 'button.children-plus',
    };

    // Click + on Adults
    runtime.process(makeEvent('click', ADULTS_PLUS, {
      ancestorClasses: ['adults-group', 'counter-section', 'page'],
    }));

    // Click outside to complete Adults stepper
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Page',
      stableId: 'page',
      cssSelector: 'div#page',
    }));

    // Click + on Children
    runtime.process(makeEvent('click', CHILDREN_PLUS, {
      ancestorClasses: ['children-group', 'counter-section', 'page'],
    }));

    // Click outside to complete Children stepper
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Page',
      stableId: 'page2',
      cssSelector: 'div#page2',
    }));

    const steppers = emitted.filter((i) => i.type === 'Stepper');
    expect(steppers.length).toBe(2);
    expect(steppers[0].metadata.totalDelta).toBe(1);
    expect(steppers[1].metadata.totalDelta).toBe(1);
  });

  it('tracks negative deltas for decrement clicks', () => {
    const MINUS_BTN = {
      tag: 'BUTTON',
      accessibleName: '-',
      ariaLabel: 'Decrease quantity',
      ariaRole: 'button',
      stableId: 'qty-minus',
      cssSelector: 'button.qty-minus',
    };

    // Click - twice
    runtime.process(makeEvent('click', MINUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product-item', 'cart'],
    }));
    runtime.process(makeEvent('click', MINUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product-item', 'cart'],
    }));

    // Click outside to complete
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Page',
      stableId: 'page',
      cssSelector: 'div#page',
    }));

    const stepper = emitted.find((i) => i.type === 'Stepper');
    expect(stepper).toBeDefined();
    expect(stepper!.metadata.totalDelta).toBe(-2);
    expect(stepper!.metadata.decrementCount).toBe(2);
    expect(stepper!.metadata.incrementCount).toBe(0);
  });

  it('extracts field name from aria-label', () => {
    const PLUS_BTN = {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Add adult',
      ariaRole: 'button',
      stableId: 'plus-btn',
      cssSelector: 'button.plus',
    };

    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['adults-group', 'counter-section', 'form'],
    }));

    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Page',
      stableId: 'page',
      cssSelector: 'div#page',
    }));

    const stepper = emitted.find((i) => i.type === 'Stepper');
    expect(stepper).toBeDefined();
    // Field name should be extracted from aria-label or ancestor classes
    const fieldName = stepper!.metadata.fieldName;
    expect(fieldName).toBeTruthy();
  });

  it('extracts field name from ancestor classes', () => {
    const PLUS_BTN = {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: '+',
      ariaRole: 'button',
      stableId: 'plus-btn',
      cssSelector: 'button.plus',
    };

    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['adults-group', 'counter-row', 'form'],
    }));

    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Page',
      stableId: 'page',
      cssSelector: 'div#page',
    }));

    const stepper = emitted.find((i) => i.type === 'Stepper');
    expect(stepper).toBeDefined();
    // Should infer "Adults" from "adults-group" ancestor class
    const fieldName = stepper!.metadata.fieldName ?? '';
    expect(fieldName.toLowerCase()).toContain('adult');
  });

  it('does NOT trigger inside a Dropdown surface (Dropdown claims stepper)', () => {
    const PLUS_BTN = {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Add adult',
      ariaRole: 'button',
      stableId: 'dd-plus',
      cssSelector: 'button.dd-plus',
    };

    // Click inside a surface (surfaceId set)
    runtime.process(makeEvent('click', PLUS_BTN, {
      surfaceId: 'dropdown-panel-1',
      surfaceType: 'popover',
      ancestorClasses: ['dropdown-panel', 'pax-selector', 'page'],
    }));

    // Should NOT be a Stepper — Dropdown or another surface handler should claim it
    const stepper = emitted.find((i) => i.type === 'Stepper');
    expect(stepper).toBeUndefined();
  });

  it('handles mixed increment and decrement on the same field', () => {
    const PLUS_BTN = {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Increase',
      ariaRole: 'button',
      stableId: 'qty-plus',
      cssSelector: 'button.qty-plus',
    };

    const MINUS_BTN = {
      tag: 'BUTTON',
      accessibleName: '-',
      ariaLabel: 'Decrease',
      ariaRole: 'button',
      stableId: 'qty-minus',
      cssSelector: 'button.qty-minus',
    };

    // +, +, +, -, -
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product', 'cart'],
    }));
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product', 'cart'],
    }));
    runtime.process(makeEvent('click', PLUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product', 'cart'],
    }));
    runtime.process(makeEvent('click', MINUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product', 'cart'],
    }));
    runtime.process(makeEvent('click', MINUS_BTN, {
      ancestorClasses: ['qty-stepper', 'product', 'cart'],
    }));

    // Complete
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Page',
      stableId: 'page',
      cssSelector: 'div#page',
    }));

    const stepper = emitted.find((i) => i.type === 'Stepper');
    expect(stepper).toBeDefined();
    expect(stepper!.metadata.totalDelta).toBe(1); // +3 -2 = +1
    expect(stepper!.metadata.incrementCount).toBe(3);
    expect(stepper!.metadata.decrementCount).toBe(2);
  });
});
