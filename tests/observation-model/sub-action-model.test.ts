/**
 * SubAction Model Tests — Multi-Config Dropdown Compound Interaction
 *
 * Validates that the Dropdown definition:
 *   1. Captures each in-surface event as a structured SubAction
 *   2. Emits subActions array in buildResult metadata
 *   3. Correctly classifies steppers, options, toggles, Done buttons
 *   4. Does NOT leak individual events as separate Click interactions
 *   5. Backward-compatible selectedValue/allSelections still populated
 *   6. isMultiConfig flag correctly distinguishes simple vs compound
 *
 * Architecture: docs/architecture/OBSERVATION_MODEL_DESIGN.md §8
 */

import { describe, it, expect } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';

// ── Helpers ──────────────────────────────────────────────────────────

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

function makeContext(overrides: Partial<DomContext> = {}): DomContext {
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
    ...overrides,
  };
}

function makeEvent(
  eventId: string,
  eventType: string,
  target: Partial<ElementIdentity>,
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType: eventType as any,
    target: makeTarget(target),
    domContext: makeContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime() {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

// A multi-config dropdown surface (like Adani One Economy panel)
const ECONOMY_SURFACE = 'dropdown-surface popover';

// ── Tests ────────────────────────────────────────────────────────────

describe('SubAction Model — Multi-Config Dropdown', () => {
  it('captures steppers, options, and Done as subActions within a single Dropdown interaction', () => {
    const { runtime, emitted } = setupRuntime();

    // Open Economy dropdown
    const trigger = { tag: 'DIV', stableId: 'economy-trigger', accessibleName: 'Economy', className: 'traveler-selector' };
    runtime.process(makeEvent('e1', 'click', trigger));

    // Increase Adults (stepper +)
    runtime.process(makeEvent('e2', 'click', {
      tag: 'BUTTON', accessibleName: 'Increase adults', ariaLabel: 'Increase adults',
      stableId: 'adults-plus', className: 'stepper-btn',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    // Increase Children (stepper +)
    runtime.process(makeEvent('e3', 'click', {
      tag: 'BUTTON', accessibleName: 'Increase children', ariaLabel: 'Increase children',
      stableId: 'children-plus', className: 'stepper-btn',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    // Select Premium Economy (radio/option)
    runtime.process(makeEvent('e4', 'click', {
      tag: 'DIV', ariaRole: 'radio', accessibleName: 'Premium Economy',
      stableId: 'premium-economy', className: 'class-option',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    // Click Done
    runtime.process(makeEvent('e5', 'click', {
      tag: 'BUTTON', accessibleName: 'Done', ariaLabel: 'Done',
      stableId: 'done-btn', className: 'done-button',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.endState).toBe('completed');

    // Should have 4 subActions (stepper+, stepper+, option, Done)
    const subActions = dropdown!.metadata.subActions as any[];
    expect(subActions).toBeDefined();
    expect(subActions).toHaveLength(4);

    // Verify each subAction type
    expect(subActions[0].action).toBe('increment');
    expect(subActions[0].label).toMatch(/adult/i);
    expect(subActions[1].action).toBe('increment');
    expect(subActions[1].label).toMatch(/children/i);
    expect(subActions[2].action).toBe('selectOption');
    expect(subActions[2].value).toBe('Premium Economy');
    expect(subActions[3].action).toBe('confirm');

    // isMultiConfig should be true (has steppers + options)
    expect(dropdown!.metadata.isMultiConfig).toBe(true);

    // Done should be marked
    expect(dropdown!.metadata.doneClicked).toBe(true);
  });

  it('does NOT leak individual stepper clicks as separate Click interactions', () => {
    const { runtime, emitted } = setupRuntime();

    const trigger = { tag: 'DIV', stableId: 'econ-trigger', accessibleName: 'Economy', className: 'traveler-selector' };
    runtime.process(makeEvent('e1', 'click', trigger));

    // Stepper clicks inside the surface
    runtime.process(makeEvent('e2', 'click', {
      tag: 'BUTTON', accessibleName: 'Increase adults', stableId: 'adults-plus',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    runtime.process(makeEvent('e3', 'click', {
      tag: 'BUTTON', accessibleName: 'Done', stableId: 'done-btn',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    // Complete the dropdown
    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.endState).toBe('completed');

    // No separate Click interactions should be emitted for steppers
    const clicks = emitted.filter((e) => e.type === 'Click');
    expect(clicks).toHaveLength(0);
  });

  it('marks simple single-option dropdown as isMultiConfig=false', () => {
    const { runtime, emitted } = setupRuntime();

    const trigger = { tag: 'DIV', stableId: 'trip-trigger', accessibleName: 'One Way', className: 'dropdown-trigger' };
    runtime.process(makeEvent('e1', 'click', trigger));

    // Single option click
    runtime.process(makeEvent('e2', 'click', {
      tag: 'DIV', ariaRole: 'option', accessibleName: 'Round Trip',
      stableId: 'option-rt', className: 'trip-option',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    // Surface closes (outside click)
    runtime.process(makeEvent('e3', 'click', {
      tag: 'BODY', accessibleName: 'Page', stableId: 'body',
    }));

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();

    // Single selectOption subAction, no steppers/toggles
    const subActions = dropdown!.metadata.subActions as any[];
    expect(subActions).toHaveLength(1);
    expect(subActions[0].action).toBe('selectOption');

    // NOT multi-config (just a single option selection)
    expect(dropdown!.metadata.isMultiConfig).toBe(false);
  });

  it('captures toggle/checkbox subActions inside multi-config panel', () => {
    const { runtime, emitted } = setupRuntime();

    const trigger = { tag: 'DIV', stableId: 'econ-trigger-2', accessibleName: 'Options', className: 'traveler-selector' };
    runtime.process(makeEvent('e1', 'click', trigger));

    // Toggle a checkbox inside the panel
    runtime.process(makeEvent('e2', 'click', {
      tag: 'INPUT', ariaRole: 'checkbox', accessibleName: 'Add insurance',
      stableId: 'insurance-check', className: 'panel-checkbox', inputType: 'checkbox',
    }, { ancestorClasses: [ECONOMY_SURFACE] }, { checkedAfter: true }));

    // Click Done
    runtime.process(makeEvent('e3', 'click', {
      tag: 'BUTTON', accessibleName: 'Done', stableId: 'done-btn-2',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();

    const subActions = dropdown!.metadata.subActions as any[];
    expect(subActions.some(s => s.action === 'toggle')).toBe(true);
    expect(subActions.some(s => s.action === 'confirm')).toBe(true);
    expect(dropdown!.metadata.isMultiConfig).toBe(true);
  });

  it('populates backward-compatible selectedValue and allSelections', () => {
    const { runtime, emitted } = setupRuntime();

    const trigger = { tag: 'DIV', stableId: 'econ-trigger-3', accessibleName: 'Economy', className: 'traveler-selector' };
    runtime.process(makeEvent('e1', 'click', trigger));

    // Select Premium Economy
    runtime.process(makeEvent('e2', 'click', {
      tag: 'DIV', ariaRole: 'radio', accessibleName: 'Premium Economy',
      stableId: 'pe-option', className: 'class-option',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    // Click Done
    runtime.process(makeEvent('e3', 'click', {
      tag: 'BUTTON', accessibleName: 'Done', stableId: 'done-btn-3',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();

    // Backward compat: selectedValue should be the last selected option
    expect(dropdown!.metadata.selectedValue).toBe('Premium Economy');
    expect(dropdown!.metadata.allSelections).toContain('Premium Economy');
  });

  it('classifies Done/Apply/Confirm buttons correctly via various labels', () => {
    const { runtime, emitted } = setupRuntime();

    const trigger = { tag: 'DIV', stableId: 'econ-trigger-4', accessibleName: 'Passengers', className: 'traveler-selector' };
    runtime.process(makeEvent('e1', 'click', trigger));

    // Use "Apply" button instead of "Done"
    runtime.process(makeEvent('e2', 'click', {
      tag: 'BUTTON', accessibleName: 'Apply', stableId: 'apply-btn',
    }, { ancestorClasses: [ECONOMY_SURFACE] }));

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.endState).toBe('completed');
    expect(dropdown!.metadata.doneClicked).toBe(true);

    // Should have a confirm subAction
    const subActions = dropdown!.metadata.subActions as any[];
    expect(subActions.some(s => s.action === 'confirm')).toBe(true);
  });
});
