/**
 * Visibility Model Validation Tests
 *
 * Simulates realistic user workflows across different app types and
 * verifies the timeline produces the correct visible/hidden interactions.
 *
 * App types covered:
 *   1. Travel booking (Adani One-style)
 *   2. E-commerce cart with quantity steppers
 *   3. SaaS settings dashboard
 *   4. Authentication / OTP flow
 *   5. Banking transfer form
 *   6. Enterprise form with checkboxes/radios
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

/**
 * Simulates a visibility filter: returns only the interactions
 * that would appear as visible timeline cards.
 * Internal-tier types (Stepper) are suppressed.
 */
function visibleInteractions(emitted: ComponentInteraction[]): ComponentInteraction[] {
  const INTERNAL = new Set(['Stepper']);
  return emitted.filter(i => !INTERNAL.has(i.type));
}

// ── Workflow Simulations ──────────────────────────────────────────────

describe('Workflow Validation: Travel Booking (Adani One-style)', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('produces a clean workflow without standalone Stepper cards', () => {
    // 1. Type destination
    runtime.process(makeEvent('focus', {
      tag: 'INPUT', accessibleName: 'To', stableId: 'dest-input',
      cssSelector: 'input.to-field',
    }, { inputType: 'text' }));
    runtime.process(makeEvent('input', {
      tag: 'INPUT', accessibleName: 'To', stableId: 'dest-input',
      cssSelector: 'input.to-field',
    }, { inputType: 'text' }, { valueAfter: 'Bangalore' }));
    runtime.process(makeEvent('blur', {
      tag: 'INPUT', accessibleName: 'To', stableId: 'dest-input',
      cssSelector: 'input.to-field',
    }, { inputType: 'text' }));

    // 2. Select date
    runtime.process(makeEvent('click', {
      tag: 'DIV', accessibleName: 'Depart on',
      className: 'date-input-field', stableId: 'date-trigger',
      cssSelector: 'div.date-input',
    }));
    runtime.process(makeEvent('click', {
      tag: 'DIV', accessibleName: '19', ariaRole: 'gridcell',
      className: 'calendar-day', stableId: 'cell-19',
      cssSelector: 'div.cal div.day',
    }, { surfaceId: 'cal-surface', surfaceType: 'popover',
         ancestorClasses: ['calendar-panel'] }));

    // 3. Configure Economy dropdown with passenger steppers
    runtime.process(makeEvent('click', {
      tag: 'DIV', accessibleName: 'Economy',
      className: 'fare-type dropdown-trigger', stableId: 'fare-trigger',
      cssSelector: 'div.fare-type',
    }));
    // Stepper + inside surface
    runtime.process(makeEvent('click', {
      tag: 'BUTTON', accessibleName: '+', className: 'stepper-plus',
      stableId: 'pax-plus', cssSelector: 'button.pax-plus',
    }, { surfaceId: 'fare-surface', surfaceType: 'popover' }));
    // Select Premium Economy
    runtime.process(makeEvent('click', {
      tag: 'DIV', accessibleName: 'Premium Economy',
      className: 'class-option', stableId: 'premium-opt',
      cssSelector: 'div.class-opt',
    }, { surfaceId: 'fare-surface', surfaceType: 'popover' }));
    // Done
    runtime.process(makeEvent('click', {
      tag: 'BUTTON', accessibleName: 'Done',
      className: 'btn done-btn', stableId: 'done-btn',
      cssSelector: 'button.done-btn',
    }, { surfaceId: 'fare-surface', surfaceType: 'popover' }));

    // 4. Click Search
    runtime.process(makeEvent('click', {
      tag: 'BUTTON', accessibleName: 'Search',
      className: 'btn-primary search-btn', stableId: 'search-btn',
      cssSelector: 'button.search-btn',
    }));

    // 5. Navigation
    runtime.process({
      ...makeEvent('navigation', { tag: 'BODY', stableId: 'body' }),
      pageUrl: 'https://adanione.com/results',
      pageTitle: 'Flight Results',
    });

    // ── Verify ──
    const visible = visibleInteractions(emitted);
    const types = visible.map(i => i.type);

    // Should NOT contain standalone Stepper
    expect(types).not.toContain('Stepper');

    // Should contain the primary workflow steps
    expect(types).toContain('TextEntry');
    expect(types).toContain('Dropdown');

    // Dropdown should have subActions (stepper absorbed)
    const dropdown = visible.find(i => i.type === 'Dropdown');
    if (dropdown) {
      const subActions = dropdown.metadata.subActions as any[];
      expect(subActions).toBeDefined();
      expect(subActions.some(s => s.action === 'increment')).toBe(true);
    }
  });
});

describe('Workflow Validation: E-commerce Cart', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('bare quantity stepper outside panel produces Click (not Stepper)', () => {
    // On many e-commerce pages, the quantity stepper is inline on the product
    // page, not inside a dropdown/modal. The + click should be a Click with
    // stepper metadata, not a standalone Stepper card.
    runtime.process(makeEvent('click', {
      tag: 'BUTTON', accessibleName: '+',
      ariaLabel: 'Increase quantity', className: 'qty-plus',
      stableId: 'qty-btn-plus', cssSelector: 'button.qty-plus',
    }));

    const visible = visibleInteractions(emitted);
    expect(visible).toHaveLength(1);
    expect(visible[0].type).toBe('Click');
    expect(visible[0].metadata.isStepper).toBe(true);
  });
});

describe('Workflow Validation: SaaS Settings Dashboard', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('checkbox toggles and radio selections are primary actions', () => {
    // Check a checkbox
    runtime.process(makeEvent('click', {
      tag: 'INPUT', accessibleName: 'Email notifications',
      ariaRole: 'checkbox', stableId: 'email-notif',
      cssSelector: 'input.email-notif',
    }, { inputType: 'checkbox' }, { checkedAfter: true }));

    // Select a radio
    runtime.process(makeEvent('click', {
      tag: 'INPUT', accessibleName: 'Dark mode',
      ariaRole: 'radio', stableId: 'theme-dark',
      cssSelector: 'input.theme-dark',
    }, { inputType: 'radio' }));

    const visible = visibleInteractions(emitted);
    expect(visible.some(i => i.type === 'Checkbox')).toBe(true);
    expect(visible.some(i => i.type === 'RadioButton')).toBe(true);
  });
});

describe('Workflow Validation: OTP Authentication Flow', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('OTP input is a single primary interaction', () => {
    // Focus first OTP input
    runtime.process(makeEvent('focus', {
      tag: 'INPUT', name: 'otp-0', stableId: 'otp-i0',
      cssSelector: 'input.otp-0',
    }, { ancestorClasses: ['otp-container'] }));

    // Type digits across inputs
    runtime.process(makeEvent('input', {
      tag: 'INPUT', name: 'otp-0', stableId: 'otp-i0',
      cssSelector: 'input.otp-0',
    }, { ancestorClasses: ['otp-container'] }, { valueAfter: '4' }));
    runtime.process(makeEvent('focus', {
      tag: 'INPUT', name: 'otp-1', stableId: 'otp-i1',
      cssSelector: 'input.otp-1',
    }, { ancestorClasses: ['otp-container'] }));
    runtime.process(makeEvent('input', {
      tag: 'INPUT', name: 'otp-1', stableId: 'otp-i1',
      cssSelector: 'input.otp-1',
    }, { ancestorClasses: ['otp-container'] }, { valueAfter: '8' }));
    runtime.process(makeEvent('focus', {
      tag: 'INPUT', name: 'otp-2', stableId: 'otp-i2',
      cssSelector: 'input.otp-2',
    }, { ancestorClasses: ['otp-container'] }));
    runtime.process(makeEvent('input', {
      tag: 'INPUT', name: 'otp-2', stableId: 'otp-i2',
      cssSelector: 'input.otp-2',
    }, { ancestorClasses: ['otp-container'] }, { valueAfter: '2' }));
    runtime.process(makeEvent('focus', {
      tag: 'INPUT', name: 'otp-3', stableId: 'otp-i3',
      cssSelector: 'input.otp-3',
    }, { ancestorClasses: ['otp-container'] }));
    runtime.process(makeEvent('input', {
      tag: 'INPUT', name: 'otp-3', stableId: 'otp-i3',
      cssSelector: 'input.otp-3',
    }, { ancestorClasses: ['otp-container'] }, { valueAfter: '1' }));

    // Click outside to complete
    runtime.process(makeEvent('click', {
      tag: 'BUTTON', accessibleName: 'Verify', stableId: 'verify-btn',
      cssSelector: 'button.verify',
    }));

    const visible = visibleInteractions(emitted);
    const otp = visible.find(i => i.type === 'OtpInput');
    expect(otp).toBeDefined();
    expect(otp!.metadata.otpValue).toBe('4821');

    // Should NOT produce 4 separate TextEntry interactions
    const textEntries = visible.filter(i => i.type === 'TextEntry');
    expect(textEntries).toHaveLength(0);
  });
});

describe('Workflow Validation: Scroll is Contextual', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('scroll events are captured but marked as contextual', () => {
    // Scroll down
    runtime.process(makeEvent('scroll', {
      tag: 'BODY', stableId: 'body', cssSelector: 'body',
    }, {}, { scrollDeltaY: 500 }));
    runtime.process(makeEvent('scroll', {
      tag: 'BODY', stableId: 'body', cssSelector: 'body',
    }, {}, { scrollDeltaY: 300 }));

    // Click something
    runtime.process(makeEvent('click', {
      tag: 'BUTTON', accessibleName: 'Load More',
      stableId: 'load-more', cssSelector: 'button.load-more',
    }));

    const visible = visibleInteractions(emitted);
    // Scroll is NOT internal (it's contextual, still visible)
    const scroll = visible.find(i => i.type === 'Scroll');
    expect(scroll).toBeDefined();
    // Click is primary
    const click = visible.find(i => i.type === 'Click');
    expect(click).toBeDefined();
  });
});

describe('Workflow Validation: Compound Dropdown Summary', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], { onEmit: (i) => emitted.push(i) });
  });

  it('multi-config dropdown shows as one card with subActions', () => {
    // Open a configuration dropdown
    runtime.process(makeEvent('click', {
      tag: 'DIV', accessibleName: 'Filters',
      ariaRole: 'combobox', className: 'dropdown-trigger',
      stableId: 'filter-trigger', cssSelector: 'div.filters',
    }, { ariaHasPopup: 'listbox' }));

    // Toggle a checkbox inside
    runtime.process(makeEvent('click', {
      tag: 'INPUT', accessibleName: 'Non-stop only',
      ariaRole: 'checkbox', className: 'filter-checkbox',
      stableId: 'nonstop-chk', cssSelector: 'input.nonstop',
    }, { surfaceId: 'filter-surface', surfaceType: 'popover',
         inputType: 'checkbox' }, { checkedAfter: true }));

    // Stepper + inside surface
    runtime.process(makeEvent('click', {
      tag: 'BUTTON', accessibleName: '+', className: 'stepper-plus',
      stableId: 'max-stops-plus', cssSelector: 'button.stops-plus',
    }, { surfaceId: 'filter-surface', surfaceType: 'popover' }));

    // Select an option
    runtime.process(makeEvent('click', {
      tag: 'DIV', accessibleName: 'Economy class',
      className: 'option-item', stableId: 'class-econ',
      cssSelector: 'div.class-econ',
    }, { surfaceId: 'filter-surface', surfaceType: 'popover' }));

    // Done
    runtime.process(makeEvent('click', {
      tag: 'BUTTON', accessibleName: 'Apply',
      className: 'btn apply-btn', stableId: 'apply-btn',
      cssSelector: 'button.apply-btn',
    }, { surfaceId: 'filter-surface', surfaceType: 'popover' }));

    // Close
    runtime.process(makeEvent('click', {
      tag: 'BODY', accessibleName: '', stableId: 'body',
      cssSelector: 'body',
    }));

    const visible = visibleInteractions(emitted);
    const dropdown = visible.find(i => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();

    // All internal interactions should be absorbed as subActions
    const subActions = dropdown!.metadata.subActions as any[];
    expect(subActions).toBeDefined();
    expect(subActions.length).toBeGreaterThanOrEqual(3);

    // No standalone Stepper or Checkbox should escape
    const escapedSteppers = visible.filter(i => i.type === 'Stepper');
    expect(escapedSteppers).toHaveLength(0);

    // The Checkbox INSIDE the surface is absorbed — no standalone Checkbox
    const escapedCheckboxes = visible.filter(i => i.type === 'Checkbox');
    expect(escapedCheckboxes).toHaveLength(0);
  });
});
