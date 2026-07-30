/**
 * Multi-Config Dropdown Tests — Accumulation + Done Detection
 *
 * Tests the new dropdown behavior where:
 * - Option clicks ACCUMULATE selections (don't complete on first click)
 * - Done/Apply button click completes the dropdown with all selections
 * - Surface closure (outside click) also completes with accumulated selections
 * - Regular single-select dropdowns still work via change event or surface closure
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

function makeEventId(): string { return `evt-mc-${++counter}`; }

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

// ── Tests ─────────────────────────────────────────────────────────────

describe('Multi-Config Dropdown — Accumulation + Done Detection', () => {
  beforeEach(() => { counter = 0; });

  it('accumulates multiple selections in a single Dropdown interaction', () => {
    const { runtime, emitted } = setupRuntime();
    const SURFACE = 'surf:testId:economy-panel';

    // Open economy/passenger dropdown
    runtime.process(makeClickEvent({
      accessibleName: '1 • Economy', ariaRole: 'combobox', tag: 'DIV',
      testId: 'economy-trigger', cssSelector: 'body > div.economy-trigger',
    }, { ariaHasPopup: 'listbox' }));

    // Select Premium Economy
    runtime.process(makeClickEvent({
      accessibleName: 'Premium Economy', tag: 'DIV', ariaRole: null,
      cssSelector: 'body > div.panel > div.option-1',
    }, { surfaceId: SURFACE, surfaceType: 'popover' }));

    // No completion yet — dropdown stays active
    expect(emitted.filter(e => e.type === 'Dropdown')).toHaveLength(0);

    // Select something else (e.g., "2 Adults")
    runtime.process(makeClickEvent({
      accessibleName: '2 Adults', tag: 'DIV', ariaRole: null,
      cssSelector: 'body > div.panel > div.option-2',
    }, { surfaceId: SURFACE, surfaceType: 'popover' }));

    // Still no completion
    expect(emitted.filter(e => e.type === 'Dropdown')).toHaveLength(0);

    // Click Done button inside surface
    runtime.process(makeClickEvent({
      accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
      cssSelector: 'body > div.panel > button.done',
    }, { surfaceId: SURFACE, surfaceType: 'popover' }));

    // Now the dropdown should complete with BOTH selections
    const dropdown = emitted.find(e => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.endState).toBe('completed');
    expect(dropdown!.metadata.allSelections).toContain('Premium Economy');
    expect(dropdown!.metadata.allSelections).toContain('2 Adults');
    expect(dropdown!.metadata.doneClicked).toBe(true);
  });

  it('Done button is NOT captured as a separate Click interaction', () => {
    const { runtime, emitted } = setupRuntime();
    const SURFACE = 'surf:testId:economy-panel';

    runtime.process(makeClickEvent({
      accessibleName: '1 • Economy', ariaRole: 'combobox', tag: 'DIV',
      testId: 'economy-trigger', cssSelector: 'body > div.economy-trigger',
    }, { ariaHasPopup: 'listbox' }));

    // Click Done directly (no selections)
    runtime.process(makeClickEvent({
      accessibleName: 'Done', tag: 'BUTTON', ariaRole: 'button',
      cssSelector: 'body > div.panel > button.done',
    }, { surfaceId: SURFACE, surfaceType: 'popover' }));

    // Should emit a Dropdown, NOT a Click
    const dropdown = emitted.find(e => e.type === 'Dropdown');
    const doneClick = emitted.find(e => e.type === 'Click' && e.metadata.targetName === 'Done');

    expect(dropdown).toBeDefined();
    expect(doneClick).toBeUndefined();
  });

  it('surface closure (outside click) completes dropdown with accumulated selections', () => {
    const { runtime, emitted } = setupRuntime();
    const SURFACE = 'surf:testId:cabin-panel';

    runtime.process(makeClickEvent({
      accessibleName: 'Cabin', ariaRole: 'combobox', tag: 'DIV',
      testId: 'cabin-trigger', cssSelector: 'body > div.cabin-trigger',
    }, { ariaHasPopup: 'listbox' }));

    // Select an option
    runtime.process(makeClickEvent({
      accessibleName: 'Business', tag: 'DIV', ariaRole: null,
      cssSelector: 'body > div.panel > div.option-1',
    }, { surfaceId: SURFACE, surfaceType: 'popover' }));

    // Click outside (surface closure)
    runtime.process(makeClickEvent({
      accessibleName: 'Search Flights', tag: 'BUTTON',
      cssSelector: 'body > button.search',
    }));

    const dropdown = emitted.find(e => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.endState).toBe('completed');
    expect(dropdown!.metadata.allSelections).toContain('Business');
  });

  it('simple single-select dropdown completes via SPA change event', () => {
    const { runtime, emitted } = setupRuntime();

    // Open Trip Type dropdown
    runtime.process(makeClickEvent({
      accessibleName: 'One Way', ariaRole: 'combobox', tag: 'DIV',
      testId: 'trip-type-trigger', cssSelector: 'body > div.trip-type',
    }, { ariaHasPopup: 'listbox' }));

    // Select "Round Trip"
    runtime.process(makeClickEvent({
      accessibleName: 'Round Trip', ariaRole: 'option', tag: 'DIV',
      cssSelector: 'body > div.popover > div.option',
    }, { surfaceId: 'surf:testId:trip-surface', surfaceType: 'popover' }));

    // SPA change event on trigger input (surface closed, value updated)
    runtime.process({
      ...makeClickEvent({
        accessibleName: 'Round Trip', tag: 'DIV',
        testId: 'trip-type-trigger', cssSelector: 'body > div.trip-type',
      }),
      eventId: makeEventId(),
      eventType: 'change',
      valueAfter: 'Round Trip',
    });

    const dropdown = emitted.find(e => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('Round Trip');
  });

  it('regular dropdown with ARIA role=option still works with surface closure', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeClickEvent({
      accessibleName: 'Country', ariaRole: 'combobox', tag: 'DIV',
      cssSelector: 'body > div.country-trigger',
    }, { ariaHasPopup: 'listbox' }));

    runtime.process(makeClickEvent({
      accessibleName: 'India', ariaRole: 'option', tag: 'DIV',
      cssSelector: 'body > div.popover > div.option',
    }, { surfaceId: 'surf:testId:country-popover', surfaceType: 'popover' }));

    // Outside click completes
    runtime.process(makeClickEvent({
      accessibleName: 'Submit', tag: 'BUTTON',
      cssSelector: 'body > button.submit',
    }));

    const dropdown = emitted.find(e => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.allSelections).toContain('India');
  });

  it('Apply button also completes dropdown', () => {
    const { runtime, emitted } = setupRuntime();
    const SURFACE = 'surf:testId:filter-panel';

    runtime.process(makeClickEvent({
      accessibleName: 'Filters', ariaRole: 'combobox', tag: 'DIV',
      testId: 'filter-trigger', cssSelector: 'body > div.filter-trigger',
    }, { ariaHasPopup: 'listbox' }));

    runtime.process(makeClickEvent({
      accessibleName: 'Direct Flights Only', tag: 'DIV', ariaRole: null,
      cssSelector: 'body > div.panel > div.option',
    }, { surfaceId: SURFACE, surfaceType: 'popover' }));

    // Click Apply
    runtime.process(makeClickEvent({
      accessibleName: 'Apply', tag: 'BUTTON', ariaRole: 'button',
      cssSelector: 'body > div.panel > button.apply',
    }, { surfaceId: SURFACE, surfaceType: 'popover' }));

    const dropdown = emitted.find(e => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.doneClicked).toBe(true);
    expect(dropdown!.metadata.allSelections).toContain('Direct Flights Only');
  });
});
