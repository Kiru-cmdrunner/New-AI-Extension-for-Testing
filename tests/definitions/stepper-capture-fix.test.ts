/**
 * Stepper Capture Fix Tests
 *
 * Tests that +/- stepper buttons in dropdown panels are correctly captured as
 * increment/decrement subActions. Covers three root causes:
 *
 * 1. Regex \b word boundary doesn't match standalone "+" / "-" symbols
 * 2. Icon-only stepper buttons (SVG, no text) produce empty accessibleName
 * 3. detectSurfaceClosure prematurely kills the Dropdown session on stepper clicks
 *
 * Spec: .drytis/specs/stepper-plus-minus-capture-fix.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import type {
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';

// ── Test Helpers ──────────────────────────────────────────────────────

let counter = 0;

function makeEventId(): string { return `evt-sc-${++counter}`; }

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Button', ariaRole: 'button', ariaLabel: null,
    ariaLabelledBy: null, placeholder: null, tag: 'BUTTON', className: '',
    name: '', stableId: null, testId: null, dataCy: null, dataQa: null,
    cssSelector: 'body > button', xPath: '/html/body/button',
    inIframe: false, shadowDom: false, iframeContext: null, elementId: `el-${counter}`,
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
    disabled: false, readOnly: false, required: false, ancestorRoles: [], ancestorClasses: [],
    surfaceType: null, surfaceRole: null, surfaceLabel: null, surfaceId: null, surfaceOpenedBy: null,
    ariaAutoComplete: null, ariaValueNow: null, ariaValueText: null, ariaValueMin: null, ariaValueMax: null,
    nativeMin: null, nativeMax: null, ...overrides,
  };
}

function makeClickEvent(
  identityOverrides: Partial<ElementIdentity> = {},
  domOverrides: Partial<DomContext> = {},
): ObservedEvent {
  return {
    eventId: makeEventId(), eventType: 'click', timestamp: Date.now(), isTrusted: true,
    target: makeIdentity(identityOverrides), domContext: makeDomContext(domOverrides),
    valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
    clientX: 100, clientY: 100, key: null, code: null, shiftKey: false, ctrlKey: false,
    altKey: false, metaKey: false, scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://example.com', pageTitle: 'Test',
  };
}

function setupRuntime(): { runtime: ComponentRuntime; emitted: ComponentInteraction[] } {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  return { runtime: createRuntime(ALL_DEFINITIONS, config), emitted };
}

/**
 * Open a passenger/class dropdown with surfaceId tracking, then simulate
 * interactions inside it.
 */
function openDropdown(
  runtime: ComponentRuntime,
  surfaceId: string,
  triggerName: string = '1 • Economy',
) {
  runtime.process(makeClickEvent({
    accessibleName: triggerName, ariaRole: 'combobox', tag: 'DIV',
    testId: 'pax-trigger', cssSelector: 'body > div.pax-trigger',
  }, { ariaHasPopup: 'listbox' }));
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Stepper +/- Capture Fix', () => {
  beforeEach(() => { counter = 0; });

  // ── Fix 1: Standalone "+" / "-" symbols are detected as steppers ──

  describe('Fix 1: Standalone +/- symbol detection', () => {
    it('captures "+" accessibleName as increment subAction', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      // Click the "+" button for Adults
      runtime.process(makeClickEvent({
        accessibleName: '+', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.plus-adults',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      // Click Done to complete
      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      expect(dropdown!.metadata.subActions).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increments = subActions.filter(s => s.action === 'increment');
      expect(increments.length).toBeGreaterThanOrEqual(1);
    });

    it('captures "-" accessibleName as decrement subAction', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      runtime.process(makeClickEvent({
        accessibleName: '-', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.minus-adults',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const decrements = subActions.filter(s => s.action === 'decrement');
      expect(decrements.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Fix 2: Icon-only buttons (no text, CSS class only) ──

  describe('Fix 2: Icon-only stepper detection via CSS class', () => {
    it('captures icon-only "+" button (plus-icon CSS class, no text)', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      // Icon-only button: no accessibleName, no aria-label, SVG icon only
      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-icon stepper-btn',
        cssSelector: 'body > div.panel > button.plus-icon',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increments = subActions.filter(s => s.action === 'increment');
      expect(increments.length).toBeGreaterThanOrEqual(1);
    });

    it('captures icon-only "-" button (minus-icon CSS class, no text)', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        className: 'minus-icon stepper-btn',
        cssSelector: 'body > div.panel > button.minus-icon',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const decrements = subActions.filter(s => s.action === 'decrement');
      expect(decrements.length).toBeGreaterThanOrEqual(1);
    });

    it('captures increment via increment-btn CSS class', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        className: 'counter increment-btn',
        cssSelector: 'body > div.panel > button.inc',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increments = subActions.filter(s => s.action === 'increment');
      expect(increments.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Fix 2b: aria-label stepper detection ──

  describe('Fix 2b: aria-label stepper detection', () => {
    it('captures "+" with aria-label "Increase Adults" as increment with label "Adults"', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        ariaLabel: 'Increase Adults',
        className: 'plus-icon',
        cssSelector: 'body > div.panel > button.plus',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increment = subActions.find(s => s.action === 'increment');
      expect(increment).toBeDefined();
      expect(increment!.label).toBe('Adults');
    });

    it('captures "-" with aria-label "Decrease Children" as decrement with label "Children"', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        ariaLabel: 'Decrease Children',
        className: 'minus-icon',
        cssSelector: 'body > div.panel > button.minus',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const decrement = subActions.find(s => s.action === 'decrement');
      expect(decrement).toBeDefined();
      expect(decrement!.label).toBe('Children');
    });
  });

  // ── Fix 3: detectSurfaceClosure doesn't prematurely kill session ──

  describe('Fix 3: Session survives stepper clicks (CSS-class fallback)', () => {
    it('does NOT close the dropdown session when clicking a stepper without surfaceId', () => {
      const { runtime, emitted } = setupRuntime();

      // Open dropdown — CSS-class fallback session (no surfaceId tracking)
      runtime.process(makeClickEvent({
        accessibleName: '1 • Economy', tag: 'DIV', ariaRole: 'combobox',
        className: 'pax-selector travel-class',
        cssSelector: 'body > div.pax-selector',
      }, {
        ariaHasPopup: 'listbox',
        ancestorClasses: ['travel-class-wrapper', 'form-container'],
      }));

      // Click "+" for Adults — this is the button that was being lost.
      // It has no surfaceId and its CSS class doesn't match surface patterns.
      runtime.process(makeClickEvent({
        accessibleName: '+', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-btn stepper-control',
        cssSelector: 'body > div.pax-panel > button.plus-adults',
      }, {
        // No surfaceId — would normally trigger surface closure detection
        ancestorClasses: ['stepper-row', 'pax-panel', 'form-container'],
      }));

      // Session should STILL be active — not closed prematurely
      expect(emitted.filter(e => e.type === 'Dropdown')).toHaveLength(0);

      // Click Done — this should complete the session with the stepper captured
      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.pax-panel > button.done',
      }, {
        ancestorClasses: ['pax-panel', 'form-container'],
      }));

      // Now the dropdown should be completed with the increment
      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increment = subActions.find(s => s.action === 'increment');
      expect(increment).toBeDefined();
    });

    it('does NOT close session for icon-only stepper (CSS class detection) in CSS-fallback mode', () => {
      const { runtime, emitted } = setupRuntime();

      // CSS-class fallback dropdown
      runtime.process(makeClickEvent({
        accessibleName: '4', tag: 'DIV', ariaRole: 'combobox',
        className: 'passenger-count pax-selector',
        cssSelector: 'body > div.passenger-count',
      }, {
        ariaHasPopup: 'listbox',
        ancestorClasses: ['form-field', 'search-form'],
      }));

      // Select Premium Economy first
      runtime.process(makeClickEvent({
        accessibleName: 'Premium Economy', tag: 'DIV', ariaRole: null,
        className: 'fare-option class-tile',
        cssSelector: 'body > div.pax-panel > div.fare',
      }, {
        ancestorClasses: ['fare-options', 'pax-panel', 'search-form'],
      }));

      // No premature completion
      expect(emitted.filter(e => e.type === 'Dropdown')).toHaveLength(0);

      // Click icon-only "+" (no text, no aria-label, CSS class only)
      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-icon icon-btn',
        cssSelector: 'body > div.pax-panel > button.plus-icon',
      }, {
        ancestorClasses: ['stepper', 'pax-panel', 'search-form'],
      }));

      // Session should STILL be active
      expect(emitted.filter(e => e.type === 'Dropdown')).toHaveLength(0);

      // Done completes it
      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.pax-panel > button.done',
      }, {
        ancestorClasses: ['pax-panel', 'search-form'],
      }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      expect(subActions.some(s => s.action === 'increment')).toBe(true);
    });
  });

  // ── Integration: Full AdaniOne-style flow ──

  describe('Integration: AdaniOne-style passenger panel flow', () => {
    it('captures Premium Economy + Adults increment + Children increment + Done', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      // Open passenger dropdown
      openDropdown(runtime, SURFACE, '4 • Premium Economy');

      // Select Premium Economy class
      runtime.process(makeClickEvent({
        accessibleName: 'Premium Economy', tag: 'DIV', ariaRole: null,
        className: 'fare-tile class-option',
        cssSelector: 'body > div.panel > div.fare-premium',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      // Click + for Adults
      runtime.process(makeClickEvent({
        accessibleName: '+', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-btn',
        cssSelector: 'body > div.panel > button.plus-adults',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      // Click + for Children
      runtime.process(makeClickEvent({
        accessibleName: '+', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-btn',
        cssSelector: 'body > div.panel > button.plus-children',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      // Click Done
      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      expect(dropdown!.endState).toBe('completed');

      const subActions = dropdown!.metadata.subActions as any[];
      expect(subActions.length).toBeGreaterThanOrEqual(3);

      // One option selection
      const options = subActions.filter(s => s.action === 'selectOption');
      expect(options.length).toBe(1);
      expect(options[0].label).toBe('Premium Economy');

      // Two increments
      const increments = subActions.filter(s => s.action === 'increment');
      expect(increments.length).toBe(2);

      // One confirm
      const confirms = subActions.filter(s => s.action === 'confirm');
      expect(confirms.length).toBe(1);
    });
  });

  // ── Dedup: mousedown + click should not double-count ──

  describe('Dedup: mousedown + click same target', () => {
    it('captures only ONE increment when mousedown+click fire on same button', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      // mousedown on +
      runtime.process(makeClickEvent({
        accessibleName: '+', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-icon', elementId: 'plus-adults',
        cssSelector: 'body > div.panel > button.plus-adults',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      // click on same +
      runtime.process(makeClickEvent({
        accessibleName: '+', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-icon', elementId: 'plus-adults',
        cssSelector: 'body > div.panel > button.plus-adults',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        elementId: 'done-btn',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increments = subActions.filter(s => s.action === 'increment');
      // Should be exactly 1, not 2 — dedup prevents double-counting
      expect(increments.length).toBe(1);
    });

    it('captures multiple increments when different buttons are clicked', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      // + Adults
      runtime.process(makeClickEvent({
        accessibleName: '+', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-icon', elementId: 'plus-adults',
        cssSelector: 'body > div.panel > button.plus-adults',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      // + Children (different button)
      runtime.process(makeClickEvent({
        accessibleName: '+', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-icon', elementId: 'plus-children',
        cssSelector: 'body > div.panel > button.plus-children',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        elementId: 'done-btn',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increments = subActions.filter(s => s.action === 'increment');
      expect(increments.length).toBe(2);
    });
  });

  // ── Label extraction from CSS selector / class ──

  describe('Label extraction from CSS selector', () => {
    it('infers "Adults" from CSS selector "button.plus-adults"', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-btn', elementId: 'plus-adults',
        cssSelector: 'body > div.panel > button.plus-adults',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        elementId: 'done-btn',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increment = subActions.find(s => s.action === 'increment');
      expect(increment).toBeDefined();
      expect(increment!.label).toBe('Adults');
    });

    it('infers "Infant" from CSS selector "button.inc-infant"', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        className: 'increment-btn', elementId: 'infant-plus',
        cssSelector: 'body > div.panel > button.inc-infant',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        elementId: 'done-btn',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increment = subActions.find(s => s.action === 'increment');
      expect(increment).toBeDefined();
      expect(increment!.label).toBe('Infant');
    });

    it('infers "Children" from className "plus-children"', () => {
      const { runtime, emitted } = setupRuntime();
      const SURFACE = 'surf:testId:pax-panel';

      openDropdown(runtime, SURFACE);

      runtime.process(makeClickEvent({
        accessibleName: '', tag: 'BUTTON', ariaRole: 'button',
        className: 'plus-children icon-btn', elementId: 'child-plus',
        cssSelector: 'body > div.panel > button.icon',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      runtime.process(makeClickEvent({
        accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
        elementId: 'done-btn',
        cssSelector: 'body > div.panel > button.done',
      }, { surfaceId: SURFACE, surfaceType: 'popover' }));

      const dropdown = emitted.find(e => e.type === 'Dropdown');
      expect(dropdown).toBeDefined();
      const subActions = dropdown!.metadata.subActions as any[];
      const increment = subActions.find(s => s.action === 'increment');
      expect(increment).toBeDefined();
      expect(increment!.label).toBe('Children');
    });
  });
});
