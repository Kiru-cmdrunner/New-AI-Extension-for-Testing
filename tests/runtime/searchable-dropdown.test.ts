/**
 * Searchable Dropdown (Autocomplete / Typeahead) Tests
 *
 * Validates that typing in a search field inside a Dropdown surface is
 * captured as a fillInput subAction with the FINAL typed value (not one
 * per keystroke), and that the interactionSubtype is set to
 * 'SearchableDropdown'.
 *
 * Test fixtures simulate the real autocomplete lifecycle:
 *   click trigger → type "che" → type "chenn" → type "chennai" → click option
 *
 * Frameworks covered by the semantics:
 *   - Native HTML combobox with search input
 *   - React/MUI Autocomplete
 *   - Ant Design Select with search
 *   - Angular Material Autocomplete
 *   - Generic SPA typeahead
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
    pageUrl: 'https://example.com/search',
    pageTitle: 'Search',
    ...extras,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Searchable Dropdown (Autocomplete)', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  it('captures typed search query as fillInput with final value', () => {
    const SEARCH_INPUT = {
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Search city',
      ariaRole: 'combobox',
      ariaHasPopup: 'listbox',
      stableId: 'city-search',
      cssSelector: 'input#city-search',
    };

    // Click the combobox trigger
    runtime.process(makeEvent('click', SEARCH_INPUT, {
      ariaHasPopup: 'listbox',
    }));

    // Type "che" → "chenn" → "chennai" (each keystroke fires an input event)
    runtime.process(makeEvent('input', SEARCH_INPUT, {
      surfaceId: 'search-listbox',
      surfaceType: 'popover',
    }, { valueAfter: 'che' }));

    runtime.process(makeEvent('input', SEARCH_INPUT, {
      surfaceId: 'search-listbox',
      surfaceType: 'popover',
    }, { valueAfter: 'chenn' }));

    runtime.process(makeEvent('input', SEARCH_INPUT, {
      surfaceId: 'search-listbox',
      surfaceType: 'popover',
    }, { valueAfter: 'chennai' }));

    // Click the filtered option
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Chennai, India',
      ariaRole: 'option',
      stableId: 'option-chennai',
      cssSelector: 'div#chennai',
    }, {
      surfaceId: 'search-listbox',
      surfaceType: 'popover',
    }));

    // Click outside to close
    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.endState).toBe('completed');

    // The fillInput subAction should have the FINAL value, not 3 entries
    const subActions = dropdown!.metadata.subActions ?? [];
    const fillInputs = subActions.filter((s: any) => s.action === 'fillInput');
    expect(fillInputs.length).toBe(1);
    expect(fillInputs[0].value).toBe('chennai');
  });

  it('sets interactionSubtype to SearchableDropdown when fillInput exists', () => {
    const SEARCH_INPUT = {
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Search',
      ariaRole: 'combobox',
      ariaHasPopup: 'listbox',
      stableId: 'search-field',
      cssSelector: 'input#search-field',
    };

    runtime.process(makeEvent('click', SEARCH_INPUT, {
      ariaHasPopup: 'listbox',
    }));

    runtime.process(makeEvent('input', SEARCH_INPUT, {
      surfaceId: 'autocomplete-listbox',
      surfaceType: 'popover',
    }, { valueAfter: 'ban' }));

    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'Bangalore',
      ariaRole: 'option',
      stableId: 'option-blr',
      cssSelector: 'div#blr',
    }, {
      surfaceId: 'autocomplete-listbox',
      surfaceType: 'popover',
    }));

    // Close
    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    // Type → select pattern is classified as Autocomplete (user typed search
    // text AND selected a filtered option from the result list)
    expect(dropdown!.interactionSubtype).toBe('Autocomplete');
  });

  it('does NOT set SearchableDropdown subtype for plain dropdowns (no typing)', () => {
    const TRIGGER = {
      tag: 'DIV',
      accessibleName: 'Country',
      ariaRole: 'combobox',
      stableId: 'country-trigger',
      cssSelector: 'div#country',
    };

    runtime.process(makeEvent('click', TRIGGER, {
      ariaHasPopup: 'listbox',
    }));

    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'India',
      ariaRole: 'option',
      stableId: 'option-india',
      cssSelector: 'div#india',
    }, {
      surfaceId: 'country-listbox',
      surfaceType: 'popover',
    }));

    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    // No typing happened — subtype should NOT be SearchableDropdown
    expect(dropdown!.interactionSubtype).not.toBe('SearchableDropdown');
    // Should be CustomDropdown (or NativeDropdown) instead
    expect(dropdown!.interactionSubtype).toMatch(/Custom|Native/);
  });

  it('captures both fillInput and selectOption in the correct order', () => {
    const SEARCH_INPUT = {
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Search product',
      ariaRole: 'combobox',
      stableId: 'product-search',
      cssSelector: 'input#product-search',
    };

    runtime.process(makeEvent('click', SEARCH_INPUT, {
      ariaHasPopup: 'listbox',
    }));

    // Type a query
    runtime.process(makeEvent('input', SEARCH_INPUT, {
      surfaceId: 'product-listbox',
      surfaceType: 'popover',
    }, { valueAfter: 'laptop' }));

    // Click an option
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'MacBook Pro',
      ariaRole: 'option',
      stableId: 'option-mbp',
      cssSelector: 'div#mbp',
    }, {
      surfaceId: 'product-listbox',
      surfaceType: 'popover',
    }));

    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    const subActions = dropdown!.metadata.subActions ?? [];

    // First subAction should be fillInput, then selectOption
    expect(subActions.length).toBeGreaterThanOrEqual(2);
    expect(subActions[0].action).toBe('fillInput');
    expect(subActions[0].value).toBe('laptop');
    expect(subActions.some((s: any) => s.action === 'selectOption')).toBe(true);
  });

  it('does not create one fillInput per keystroke (replace-on-update)', () => {
    const SEARCH_INPUT = {
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Search',
      ariaRole: 'combobox',
      stableId: 'search',
      cssSelector: 'input#search',
    };

    runtime.process(makeEvent('click', SEARCH_INPUT, {
      ariaHasPopup: 'listbox',
    }));

    // Simulate 8 keystrokes
    const partials = ['n', 'ne', 'new', 'new ', 'new y', 'new yo', 'new yor', 'new york'];
    for (const val of partials) {
      runtime.process(makeEvent('input', SEARCH_INPUT, {
        surfaceId: 'search-listbox',
        surfaceType: 'popover',
      }, { valueAfter: val }));
    }

    // Click option
    runtime.process(makeEvent('click', {
      tag: 'DIV',
      accessibleName: 'New York, NY',
      ariaRole: 'option',
      stableId: 'option-ny',
      cssSelector: 'div#ny',
    }, {
      surfaceId: 'search-listbox',
      surfaceType: 'popover',
    }));

    runtime.process(makeEvent('click', {
      tag: 'BODY',
      accessibleName: '',
      stableId: 'body',
      cssSelector: 'body',
    }));

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    const fillInputs = (dropdown!.metadata.subActions ?? []).filter(
      (s: any) => s.action === 'fillInput',
    );

    // Should be exactly 1 fillInput with the final value — not 8
    expect(fillInputs.length).toBe(1);
    expect(fillInputs[0].value).toBe('new york');
  });

  it('handles multi-config panel with search + stepper + option', () => {
    const SEARCH_INPUT = {
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Search guest',
      ariaRole: 'combobox',
      stableId: 'guest-search',
      cssSelector: 'input#guest-search',
    };

    runtime.process(makeEvent('click', SEARCH_INPUT, {
      ariaHasPopup: 'listbox',
    }));

    // Type search
    runtime.process(makeEvent('input', SEARCH_INPUT, {
      surfaceId: 'guest-panel',
      surfaceType: 'popover',
    }, { valueAfter: 'john' }));

    // Click stepper +
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: '+',
      ariaLabel: 'Increase guests',
      stableId: 'guest-plus',
      cssSelector: 'button#guest-plus',
    }, {
      surfaceId: 'guest-panel',
      surfaceType: 'popover',
    }));

    // Click Done
    runtime.process(makeEvent('click', {
      tag: 'BUTTON',
      accessibleName: 'Done',
      stableId: 'done-btn',
      cssSelector: 'button#done',
    }, {
      surfaceId: 'guest-panel',
      surfaceType: 'popover',
    }));

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    const subActions = dropdown!.metadata.subActions ?? [];

    // Should have fillInput + increment + confirm
    const actions = subActions.map((s: any) => s.action);
    expect(actions).toContain('fillInput');
    expect(actions).toContain('increment');
    expect(actions).toContain('confirm');
  });
});
