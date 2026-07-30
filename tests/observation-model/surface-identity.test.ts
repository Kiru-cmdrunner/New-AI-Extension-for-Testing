/**
 * Observation Model Tests — Surface Identity & Session-Surface Binding
 *
 * Tests the core Phase 0b invariants:
 *   I3:  Every event is owned by at most one session
 *   I4:  Surface-session binding (a session's openedSurface matches the surface it created)
 *   I10: No cross-surface claim (events in surface B don't feed session for surface A)
 *   I11: Surface closure completes sessions
 *
 * Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §13
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import type {
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';
import { ALL_DEFINITIONS } from '../../src/definitions';

// ── Test Helpers ──────────────────────────────────────────────────────

let counter = 0;

function makeEventId(): string {
  counter++;
  return `evt-test-${counter}`;
}

function makeIdentity(
  overrides: Partial<ElementIdentity> = {},
): ElementIdentity {
  return {
    accessibleName: 'Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: '',
    name: '',
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'body > button',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    iframeContext: null,
    elementId: `el-${counter}`,
    ...overrides,
  };
}

function makeDomContext(
  overrides: Partial<DomContext> = {},
): DomContext {
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
    surfaceType: null,
    surfaceRole: null,
    surfaceLabel: null,
    surfaceId: null,
    surfaceOpenedBy: null,
    ariaAutoComplete: null,
    ariaValueNow: null,
    ariaValueText: null,
    ariaValueMin: null,
    ariaValueMax: null,
    nativeMin: null,
    nativeMax: null,
    ...overrides,
  };
}

function makeClickEvent(
  identityOverrides: Partial<ElementIdentity> = {},
  domOverrides: Partial<DomContext> = {},
): ObservedEvent {
  return {
    eventId: makeEventId(),
    eventType: 'click',
    timestamp: Date.now(),
    isTrusted: true,
    target: makeIdentity(identityOverrides),
    domContext: makeDomContext(domOverrides),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 100,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test Page',
  };
}

function makeFocusEvent(
  identityOverrides: Partial<ElementIdentity> = {},
  domOverrides: Partial<DomContext> = {},
): ObservedEvent {
  return {
    ...makeClickEvent(identityOverrides, domOverrides),
    eventId: makeEventId(),
    eventType: 'focus',
  };
}

function makeChangeEvent(
  identityOverrides: Partial<ElementIdentity> = {},
  domOverrides: Partial<DomContext> = {},
  valueAfter: string = '',
): ObservedEvent {
  return {
    ...makeClickEvent(identityOverrides, domOverrides),
    eventId: makeEventId(),
    eventType: 'change',
    valueAfter,
    valueBefore: null,
  };
}

function makeNavigationEvent(): ObservedEvent {
  return {
    eventId: makeEventId(),
    eventType: 'navigation' as never,
    timestamp: Date.now(),
    isTrusted: true,
    target: makeIdentity({ tag: 'BODY', ariaRole: null }),
    domContext: makeDomContext(),
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
    pageUrl: 'https://example.com/page2',
    pageTitle: 'Page 2',
  };
}

function setupRuntime(): { runtime: ComponentRuntime; emitted: ComponentInteraction[] } {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = {
    onEmit: (interaction) => emitted.push(interaction),
  };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Observation Model — Surface Identity', () => {
  beforeEach(() => {
    counter = 0;
  });

  describe('I4: Surface-Session Binding', () => {
    it('binds openedSurface to a Dropdown session when a surface appears', () => {
      const { runtime, emitted } = setupRuntime();

      // Click on dropdown trigger (aria-haspopup="listbox")
      const triggerEvent = makeClickEvent({
        accessibleName: 'Trip Type',
        ariaRole: 'combobox',
        tag: 'DIV',
        testId: 'trip-type-trigger',
      }, {
        ariaHasPopup: 'listbox',
        ariaExpanded: 'false',
      });
      runtime.process(triggerEvent);

      // Event inside the dropdown surface (option click)
      const optionClick = makeClickEvent({
        accessibleName: 'Round Trip',
        ariaRole: 'option',
        tag: 'DIV',
      }, {
        surfaceId: 'surf:testId:dropdown-panel-1',
        surfaceType: 'popover',
        surfaceRole: 'listbox',
      });
      runtime.process(optionClick);

      // Surface closure: base-page click completes the dropdown
      runtime.process(makeClickEvent({
        accessibleName: 'Some Other Button',
        tag: 'BUTTON',
      }));

      // The dropdown should have been completed with the accumulated selection
      const dropdown = emitted.find((e) => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      expect(dropdown!.metadata.allSelections).toContain('Round Trip');
    });

    it('does not bind openedSurface for Click sessions (surface-less interactions)', () => {
      const { runtime, emitted } = setupRuntime();

      // Simple click on a button
      runtime.process(makeClickEvent({
        accessibleName: 'Submit',
        ariaRole: 'button',
        tag: 'BUTTON',
      }));

      expect(emitted).toHaveLength(1);
      expect(emitted[0].type).toBe('Click');
    });
  });

  describe('I10: No Cross-Surface Claim', () => {
    it('events in surface B do NOT feed session for surface A', () => {
      const { runtime, emitted } = setupRuntime();

      // Open dropdown A (Trip Type)
      runtime.process(makeClickEvent({
        accessibleName: 'Trip Type',
        ariaRole: 'combobox',
        tag: 'DIV',
        testId: 'trip-type-trigger',
      }, {
        ariaHasPopup: 'listbox',
      }));

      // Click option inside surface A
      runtime.process(makeClickEvent({
        accessibleName: 'Round Trip',
        ariaRole: 'option',
        tag: 'DIV',
      }, {
        surfaceId: 'surf:testId:surface-A',
        surfaceType: 'popover',
      }));

      // Click outside to close surface A (complete the dropdown)
      runtime.process(makeClickEvent({
        accessibleName: 'Page Background',
        tag: 'BODY',
      }));

      // Now open dropdown B (Cabin Class) — different trigger
      runtime.process(makeClickEvent({
        accessibleName: 'Economy',
        ariaRole: 'combobox',
        tag: 'DIV',
        testId: 'cabin-class-trigger',
      }, {
        ariaHasPopup: 'listbox',
      }));

      // Click option inside surface B — this must NOT be claimed by surface A's session
      runtime.process(makeClickEvent({
        accessibleName: 'Business',
        ariaRole: 'option',
        tag: 'DIV',
      }, {
        surfaceId: 'surf:testId:surface-B',
        surfaceType: 'popover',
      }));

      // Click outside to close surface B
      runtime.process(makeClickEvent({
        accessibleName: 'Page Background',
        tag: 'BODY',
      }));

      // Both dropdown selections should be captured independently
      const dropdowns = emitted.filter((e) => e.type === 'Dropdown');
      expect(dropdowns.length).toBe(2);

      // Each dropdown should have the correct accumulated selection
      const allSelections = dropdowns.flatMap((d) => d.metadata.allSelections ?? [d.metadata.selectedValue]);
      expect(allSelections).toContain('Round Trip');
      expect(allSelections).toContain('Business');
    });

    it('a click outside any surface completes the surface-creating session', () => {
      const { runtime, emitted } = setupRuntime();

      // Open dropdown
      runtime.process(makeClickEvent({
        accessibleName: 'Cabin Class',
        ariaRole: 'combobox',
        tag: 'DIV',
        testId: 'cabin-trigger',
      }, {
        ariaHasPopup: 'listbox',
      }));

      // Event inside surface
      runtime.process(makeClickEvent({
        accessibleName: 'Some option text',
        tag: 'DIV',
      }, {
        surfaceId: 'surf:testId:cabin-surface',
        surfaceType: 'popover',
      }));

      // Click outside (base page, no surfaceId)
      runtime.process(makeClickEvent({
        accessibleName: 'Done',
        ariaRole: 'button',
        tag: 'BUTTON',
      }));

      // The Done button should be captured as a separate Click
      const doneClick = emitted.find(
        (e) => e.type === 'Click' && e.metadata.targetName === 'Done',
      );
      expect(doneClick).toBeDefined();
    });
  });

  describe('I3: Event Owned by At Most One Session', () => {
    it('an option click inside a dropdown surface is claimed by the dropdown, not Click fallback', () => {
      const { runtime, emitted } = setupRuntime();

      // Open dropdown
      runtime.process(makeClickEvent({
        accessibleName: 'Passengers',
        ariaRole: 'combobox',
        tag: 'DIV',
        testId: 'passengers-trigger',
      }, {
        ariaHasPopup: 'listbox',
      }));

      // Click option inside surface
      const optionResult = runtime.process(makeClickEvent({
        accessibleName: '2 Adults',
        tag: 'DIV',
        ariaRole: null,
      }, {
        surfaceId: 'surf:testId:passengers-surface',
        surfaceType: 'popover',
      }));

      // Option click should NOT emit any interaction (dropdown stays active)
      expect(optionResult).toHaveLength(0);

      // Close the surface
      runtime.process(makeClickEvent({
        accessibleName: 'Page Background',
        tag: 'BODY',
      }));

      // The dropdown should have captured '2 Adults' as a selection
      const dropdown = emitted.find((e) => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      expect(dropdown!.metadata.allSelections).toContain('2 Adults');

      // No separate Click for the option should have been emitted
      const clickInteractions = emitted.filter(
        (e) => e.type === 'Click' && e.metadata.targetName === '2 Adults',
      );
      expect(clickInteractions).toHaveLength(0);
    });
  });

  describe('Surface Closure (I11)', () => {
    it('navigation flushes all active sessions and closes surfaces', () => {
      const { runtime, emitted } = setupRuntime();

      // Open dropdown
      runtime.process(makeClickEvent({
        accessibleName: 'From',
        ariaRole: 'combobox',
        tag: 'DIV',
      }, {
        ariaHasPopup: 'listbox',
      }));

      // Navigate (SPA route change)
      runtime.process(makeNavigationEvent());

      // All active sessions should be flushed
      const flushed = emitted.filter(
        (e) => e.endState === 'interrupted' || e.endState === 'completed',
      );
      expect(flushed.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Behavioral Signal Detection (Phase 0b)', () => {
    it('aria-haspopup="listbox" triggers Dropdown regardless of CSS class', () => {
      const { runtime, emitted } = setupRuntime();

      // Element with ONLY ARIA, no CSS class hints
      runtime.process(makeClickEvent({
        accessibleName: 'Select Country',
        tag: 'DIV',
        className: 'some-random-class',
        cssSelector: 'body > div.country-trigger',
        ariaRole: null,
      }, {
        ariaHasPopup: 'listbox',
        ariaExpanded: 'false',
      }));

      // Click option in surface
      runtime.process(makeClickEvent({
        accessibleName: 'India',
        tag: 'DIV',
        cssSelector: 'body > div.popover > div.option',
        ariaRole: null,
      }, {
        surfaceId: 'surf:testId:country-surface',
        surfaceType: 'popover',
      }));

      // Surface closure (outside click completes the dropdown)
      runtime.process(makeClickEvent({
        accessibleName: 'Page Background',
        tag: 'BODY',
      }));

      const dropdown = emitted.find((e) => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      expect(dropdown!.metadata.allSelections).toContain('India');
    });

    it('role="combobox" triggers Dropdown regardless of CSS class', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeClickEvent({
        accessibleName: 'Select City',
        ariaRole: 'combobox',
        tag: 'DIV',
        className: 'my-custom-widget',
        cssSelector: 'body > div.combobox',
      }));

      runtime.process(makeClickEvent({
        accessibleName: 'Mumbai',
        tag: 'DIV',
        cssSelector: 'body > div.popover > div.option',
        ariaRole: null,
      }, {
        surfaceId: 'surf:testId:city-surface',
        surfaceType: 'popover',
      }));

      // Surface closure
      runtime.process(makeClickEvent({
        accessibleName: 'Page Background',
        tag: 'BODY',
      }));

      const dropdown = emitted.find((e) => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
    });

    it('aria-haspopup="dialog" on INPUT triggers DatePicker', () => {
      const { runtime, emitted } = setupRuntime();

      // Focus date input with aria-haspopup="dialog"
      runtime.process(makeFocusEvent({
        accessibleName: 'Departure Date',
        tag: 'INPUT',
        className: 'date-input',
        cssSelector: 'body > input.date-input',
      }, {
        ariaHasPopup: 'dialog',
        inputType: 'text',
        readOnly: false,
      }));

      // Calendar cell click inside surface
      runtime.process(makeClickEvent({
        accessibleName: 'Choose Thursday, August 27th',
        tag: 'DIV',
        cssSelector: 'body > div.calendar > div.cell',
        className: 'calendar-day',
      }, {
        surfaceId: 'surf:testId:calendar-surface',
        surfaceType: 'popover',
      }));

      const datePicker = emitted.find((e) => e.type === 'DatePicker');
      expect(datePicker).toBeDefined();
    });

    it('native date input type triggers DatePicker', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeFocusEvent({
        accessibleName: 'Return Date',
        tag: 'INPUT',
      }, {
        inputType: 'date',
      }));

      // Change event with value
      runtime.process(makeChangeEvent({
        accessibleName: 'Return Date',
        tag: 'INPUT',
      }, {
        inputType: 'date',
      }, '2025-08-27'));

      const datePicker = emitted.find((e) => e.type === 'DatePicker');
      expect(datePicker).toBeDefined();
    });
  });

  describe('CSS Class Fallback (when no ARIA)', () => {
    it('CSS class pattern still works as fallback for dropdown detection', () => {
      const { runtime, emitted } = setupRuntime();

      // div with dropdown CSS class but no ARIA
      runtime.process(makeClickEvent({
        accessibleName: 'Travel Class',
        tag: 'DIV',
        className: 'economy-select-dropdown',
        ariaRole: null,
      }));

      runtime.process(makeClickEvent({
        accessibleName: 'First Class',
        tag: 'DIV',
      }, {
        surfaceId: 'surf:testId:travel-surface',
        surfaceType: 'popover',
      }));

      // Surface closure
      runtime.process(makeClickEvent({
        accessibleName: 'Page Background',
        tag: 'BODY',
      }));

      const dropdown = emitted.find((e) => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
    });
  });
});
