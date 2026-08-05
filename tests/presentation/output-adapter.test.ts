/**
 * Unit Tests: Presentation Layer (Output Adapter)
 *
 * Tests the production interaction filter and IR action mapping.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 6
 */

import { describe, it, expect } from 'vitest';
import {
  isProductionInteraction,
  filterProductionInteractions,
  toIRAction,
  toIRActions,
} from '../../src/presentation/output-adapter';
import type { ComponentInteraction } from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

// ── Helpers ──────────────────────────────────────────────────────────

function makeInteraction(
  overrides: Partial<ComponentInteraction> & { type: string },
): ComponentInteraction {
  const event = makeObservedEvent({
    eventId: 'e1',
    eventType: 'click',
    target: {
      accessibleName: 'Test Element',
      tag: 'BUTTON',
      ariaRole: 'button',
      stableId: 'test-btn',
      cssSelector: '#test-btn',
      xPath: '/html/body/button',
      className: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      name: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      inIframe: false,
      shadowDom: false,
    href: null,
      elementId: '',
    } as any,
  });

  return {
    interactionId: 'int-1',
    trigger: event.target,
    triggerEvent: event,
    memberEvents: [event],
    startTime: 1000,
    endTime: 1200,
    endState: 'completed',
    metadata: {},
    ...overrides,
  } as ComponentInteraction;
}

// ── isProductionInteraction ──────────────────────────────────────────

describe('isProductionInteraction', () => {
  it('passes completed Click interactions', () => {
    const interaction = makeInteraction({
      type: 'Click',
      metadata: { targetName: 'Login' },
    });
    expect(isProductionInteraction(interaction)).toBe(true);
  });

  it('filters abandoned interactions', () => {
    const interaction = makeInteraction({
      type: 'Click',
      endState: 'abandoned',
      metadata: { targetName: 'Login' },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  it('filters interrupted interactions', () => {
    const interaction = makeInteraction({
      type: 'TextEntry',
      endState: 'interrupted',
      metadata: { targetName: 'Search' },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  // Bug 4: TextEntry without typing
  it('filters TextEntry with userTyped=false (Bug 4)', () => {
    const interaction = makeInteraction({
      type: 'TextEntry',
      metadata: { targetName: 'Username', textValue: '', userTyped: false },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  it('passes TextEntry with userTyped=true and non-empty value', () => {
    const interaction = makeInteraction({
      type: 'TextEntry',
      metadata: { targetName: 'Username', textValue: 'admin', userTyped: true },
    });
    expect(isProductionInteraction(interaction)).toBe(true);
  });

  it('filters TextEntry with empty textValue', () => {
    const interaction = makeInteraction({
      type: 'TextEntry',
      metadata: { targetName: 'Search', textValue: '', userTyped: true },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  // Bug 2: Dropdown no-op
  it('filters Dropdown with noOpSelection=true (Bug 2)', () => {
    const interaction = makeInteraction({
      type: 'Dropdown',
      metadata: { targetName: 'User Role', selectedValue: 'Admin', noOpSelection: true },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  it('passes Dropdown with noOpSelection=false', () => {
    const interaction = makeInteraction({
      type: 'Dropdown',
      metadata: { targetName: 'User Role', selectedValue: 'ESS', noOpSelection: false },
    });
    expect(isProductionInteraction(interaction)).toBe(true);
  });

  // Bug 4: RadioButton no-op
  it('filters RadioButton with noOpSelection=true (Bug 4)', () => {
    const interaction = makeInteraction({
      type: 'RadioButton',
      metadata: { targetName: 'Female', noOpSelection: true },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  it('passes RadioButton with noOpSelection=false', () => {
    const interaction = makeInteraction({
      type: 'RadioButton',
      metadata: { targetName: 'Male', noOpSelection: false },
    });
    expect(isProductionInteraction(interaction)).toBe(true);
  });

  // Empty date selection
  it('filters DatePicker with empty selectedDate', () => {
    const interaction = makeInteraction({
      type: 'DatePicker',
      metadata: { targetName: 'Birthday', selectedDate: '', dateValue: '' },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  it('passes DatePicker with non-empty selectedDate', () => {
    const interaction = makeInteraction({
      type: 'DatePicker',
      metadata: { targetName: 'Birthday', selectedDate: '15', dateValue: '2026-07-15' },
    });
    expect(isProductionInteraction(interaction)).toBe(true);
  });

  // Bug 5: Scroll 0px
  it('filters Scroll with hasDelta=false (Bug 5)', () => {
    const interaction = makeInteraction({
      type: 'Scroll',
      metadata: { hasDelta: false, scrollDeltaY: 0, scrollDeltaX: 0 },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  it('passes Scroll with hasDelta=true', () => {
    const interaction = makeInteraction({
      type: 'Scroll',
      metadata: { hasDelta: true, scrollDeltaY: 100, scrollDeltaX: 0 },
    });
    expect(isProductionInteraction(interaction)).toBe(true);
  });
});

// ── filterProductionInteractions ─────────────────────────────────────

describe('filterProductionInteractions', () => {
  it('filters an array correctly', () => {
    const interactions = [
      makeInteraction({ type: 'Click', metadata: { targetName: 'Login' } }),
      makeInteraction({ type: 'Scroll', metadata: { hasDelta: false } }),
      makeInteraction({ type: 'TextEntry', metadata: { userTyped: false, textValue: '' } }),
      makeInteraction({ type: 'Click', metadata: { targetName: 'Save' } }),
    ];

    const filtered = filterProductionInteractions(interactions);
    expect(filtered.length).toBe(2);
    expect(filtered[0].metadata.targetName).toBe('Login');
    expect(filtered[1].metadata.targetName).toBe('Save');
  });
});

// ── toIRAction ───────────────────────────────────────────────────────

describe('toIRAction', () => {
  it('maps Click to CLICK', () => {
    const action = toIRAction(makeInteraction({ type: 'Click', metadata: { targetName: 'Login' } }));
    expect(action).not.toBeNull();
    expect(action!.type).toBe('CLICK');
    expect(action!.target.name).toBe('Login');
  });

  it('maps TextEntry to FILL', () => {
    const action = toIRAction(
      makeInteraction({ type: 'TextEntry', metadata: { targetName: 'Username', textValue: 'admin', userTyped: true } }),
    );
    expect(action).not.toBeNull();
    expect(action!.type).toBe('FILL');
    expect(action!.value).toBe('admin');
  });

  it('maps Dropdown to SELECT', () => {
    const action = toIRAction(
      makeInteraction({ type: 'Dropdown', metadata: { targetName: 'Role', selectedValue: 'Admin', noOpSelection: false } }),
    );
    expect(action).not.toBeNull();
    expect(action!.type).toBe('SELECT');
    expect(action!.value).toBe('Admin');
  });

  it('maps Checkbox to TOGGLE', () => {
    const action = toIRAction(
      makeInteraction({ type: 'Checkbox', metadata: { targetName: 'Subscribe', checked: true } }),
    );
    expect(action).not.toBeNull();
    expect(action!.type).toBe('TOGGLE');
    expect(action!.value).toBe('check');
  });

  it('maps DatePicker to SELECT_DATE', () => {
    const action = toIRAction(
      makeInteraction({ type: 'DatePicker', metadata: { targetName: 'Birthday', selectedDate: '15', dateValue: '2026-07-15' } }),
    );
    expect(action).not.toBeNull();
    expect(action!.type).toBe('SELECT_DATE');
    expect(action!.value).toBe('2026-07-15');
  });

  it('maps Navigation to NAVIGATE', () => {
    const action = toIRAction(
      makeInteraction({ type: 'Navigation', metadata: { pageUrl: 'https://example.com', pageTitle: 'Home' } }),
    );
    expect(action).not.toBeNull();
    expect(action!.type).toBe('NAVIGATE');
    expect(action!.value).toBe('https://example.com');
  });

  it('maps Hover to HOVER', () => {
    const action = toIRAction(
      makeInteraction({ type: 'Hover', metadata: { targetName: 'Menu', dwellMs: 800 } }),
    );
    expect(action).not.toBeNull();
    expect(action!.type).toBe('HOVER');
  });
});

// ── toIRActions (end-to-end filter + map) ────────────────────────────

describe('toIRActions', () => {
  it('filters then maps to IR actions', () => {
    const interactions = [
      makeInteraction({ type: 'TextEntry', metadata: { targetName: 'Username', textValue: 'admin', userTyped: true } }),
      makeInteraction({ type: 'TextEntry', metadata: { targetName: 'Prefilled', textValue: '', userTyped: false } }),
      makeInteraction({ type: 'Click', metadata: { targetName: 'Login' } }),
      makeInteraction({ type: 'Scroll', metadata: { hasDelta: false } }),
    ];

    const actions = toIRActions(interactions);
    expect(actions.length).toBe(2);
    expect(actions[0].type).toBe('FILL');
    expect(actions[1].type).toBe('CLICK');
  });
});
