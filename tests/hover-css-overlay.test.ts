/**
 * Tests for Hover CSS Overlay Evidence Signal + Dropdown isInScope Fix
 *
 * Verifies:
 * - Signal 2b: CSS/structural overlay detection for hover
 * - Dropdown isInScope: interactive elements inside dropdown surface fall through
 *
 * Architecture: hover.ts Signal 2b, dropdown.ts isInScope fix
 */

import { describe, it, expect } from 'vitest';
import { hoverDefinition } from '../src/definitions/hover';
import { dropdownDefinition } from '../src/definitions/dropdown';
import type { ObservedEvent, ElementIdentity, ComponentContext } from '../src/shared/component-types';
import { makeElementIdentity, makeObservedEvent, makeDomContext } from './helpers/fixtures';

// ── Helpers ───────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return makeElementIdentity({
    tag: 'A',
    cssSelector: 'body > nav > a',
    accessibleName: 'Services',
    ariaLabel: 'Services',
    href: '/services',
    elementId: 'a-services',
    ...overrides,
  });
}

function makeEvent(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  return makeObservedEvent({
    eventId: 'evt-1-0',
    eventType: 'mouseenter',
    target: makeTarget(overrides.target),
    clientX: 100,
    clientY: 200,
    ...overrides,
    domContext: overrides.domContext
      ? makeDomContext(overrides.domContext)
      : makeDomContext(),
  });
}

function makeCtx(enter: ObservedEvent): ComponentContext {
  return {
    type: 'Hover',
    trigger: enter.target,
    triggerEvent: enter,
    memberEvents: [enter],
    startTime: enter.timestamp,
    endTime: 0,
    state: 'active',
    lifecycleId: 'lc-001',
    scopeKeys: new Set([enter.target.elementId]),
    data: {},
  };
}

function makeLeaveEvent(trigger: ObservedEvent, dwellMs: number): ObservedEvent {
  return makeEvent({
    eventId: 'evt-1-1',
    eventType: 'mouseleave',
    timestamp: trigger.timestamp + dwellMs,
    target: trigger.target,
    domContext: trigger.domContext,
  });
}

function makeDropdownCtx(enter: ObservedEvent): ComponentContext {
  return {
    type: 'Dropdown',
    trigger: enter.target,
    triggerEvent: enter,
    memberEvents: [enter],
    startTime: enter.timestamp,
    endTime: 0,
    state: 'active',
    lifecycleId: 'lc-001',
    scopeKeys: new Set([enter.target.elementId]),
    data: {},
  };
}

// ── Hover discovery + terminals (B7-P2: the CSS-overlay signal model is
// REPEALED — classes never gate, dwell never gates; the affordance
// predicate discovers, the "left" terminal completes, downstream evidence
// admission decides production-worthiness). ────────────────────────────

describe('Hover: discovery and terminals (B7-P2)', () => {
  it('has-submenu link (interactive affordance) discovers and completes on leave', () => {
    const enter = makeEvent({
      target: makeTarget({ className: 'nav-link has-submenu' }),
    });

    const trigger = hoverDefinition.detectTrigger(enter);
    expect(trigger).not.toBeNull();

    const ctx = makeCtx(enter);

    const leave = makeLeaveEvent(enter, 600);
    const completion = hoverDefinition.handleEvent(leave, ctx);

    expect(completion).not.toBeNull();
    expect(completion!.endState).toBe('completed');
    expect(ctx.data.terminal).toBe('left');
  });

  it('promotes hover for element inside a navbar ancestor', () => {
    const enter = makeEvent({
      target: makeTarget({ className: 'nav-link', ariaRole: 'link' }),
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: ['primary-nav', 'main-header'],
        tabIndex: null,
      },
    });

    const ctx = makeCtx(enter);

    const leave = makeLeaveEvent(enter, 600);
    const completion = hoverDefinition.handleEvent(leave, ctx);

    expect(completion).not.toBeNull();
    expect(completion!.endState).toBe('completed');
    expect(ctx.data.terminal).toBe('left');
  });

  it('promotes hover for element with "dropdown-trigger" class', () => {
    const enter = makeEvent({
      target: makeTarget({
        className: 'menu-trigger dropdown-trigger',
        tag: 'DIV',
      }),
    });

    const ctx = makeCtx(enter);

    const leave = makeLeaveEvent(enter, 700);
    const completion = hoverDefinition.handleEvent(leave, ctx);

    expect(completion).not.toBeNull();
    expect(completion!.endState).toBe('completed');
  });

  it('promotes hover for element with "mega-menu" class', () => {
    const enter = makeEvent({
      target: makeTarget({
        className: 'header-link mega-menu',
        tag: 'A',
      }),
    });

    const ctx = makeCtx(enter);

    const leave = makeLeaveEvent(enter, 800);
    const completion = hoverDefinition.handleEvent(leave, ctx);

    expect(completion).not.toBeNull();
    expect(completion!.endState).toBe('completed');
  });

  it('does NOT promote hover for plain element without overlay CSS', () => {
    const enter = makeEvent({
      target: makeTarget({ className: 'content-area', tag: 'DIV' }),
    });

    const trigger = hoverDefinition.detectTrigger(enter);
    expect(trigger).toBeNull();
  });

  it('short dwell still completes on leave — no transit threshold (DC-1)', () => {
    const enter = makeEvent({
      target: makeTarget({ className: 'has-submenu' }),
    });

    const trigger = hoverDefinition.detectTrigger(enter);
    expect(trigger).not.toBeNull();

    const ctx = makeCtx(enter);

    const leave = makeLeaveEvent(enter, 200);
    const completion = hoverDefinition.handleEvent(leave, ctx);

    // 200ms leave completes identically (dwell is a recorded FACT, never a
    // gate). Admission decides downstream via evidence classes.
    expect(completion).not.toBeNull();
    expect(completion!.endState).toBe('completed');
  });
});

// ── Dropdown isInScope Fix Tests ──────────────────────────────────────

describe('Dropdown: isInScope does not swallow clicks on interactive elements', () => {
  it('allows button click inside dropdown surface to fall through', () => {
    const triggerEvent = makeEvent({
      eventType: 'click',
      target: makeTarget({
        tag: 'DIV',
        className: 'traveler-selector',
        elementId: 'dropdown-trigger-0',
      }),
    });

    const ctx = makeDropdownCtx(triggerEvent);

    // Click on a stepper "+" button inside the dropdown surface
    const stepperClick = makeEvent({
      eventType: 'click',
      target: makeTarget({
        tag: 'BUTTON',
        className: 'stepper-plus',
        accessibleName: 'Add adult',
        elementId: 'stepper-plus-0',
      }),
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: ['dropdown-menu', 'popover'],
        tabIndex: null,
      },
    });

    const dropdownInScope = dropdownDefinition.isInScope(stepperClick, ctx);
    expect(dropdownInScope).toBe(false);
  });

  it('still claims dropdown option clicks inside surface', () => {
    const triggerEvent = makeEvent({
      eventType: 'click',
      target: makeTarget({
        tag: 'DIV',
        className: 'traveler-selector',
        elementId: 'dropdown-trigger-0',
      }),
    });

    const ctx = makeDropdownCtx(triggerEvent);

    // Click on a dropdown option
    const optionClick = makeEvent({
      eventType: 'click',
      target: makeTarget({
        tag: 'DIV',
        className: 'select-option',
        ariaRole: 'option',
        accessibleName: 'Premium',
        elementId: 'option-premium',
      }),
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: ['dropdown-menu', 'popover'],
        tabIndex: null,
      },
    });

    const dropdownInScope = dropdownDefinition.isInScope(optionClick, ctx);
    expect(dropdownInScope).toBe(true);
  });

  it('still claims non-interactive element clicks inside surface', () => {
    const triggerEvent = makeEvent({
      eventType: 'click',
      target: makeTarget({
        tag: 'DIV',
        className: 'traveler-selector',
        elementId: 'dropdown-trigger-0',
      }),
    });

    const ctx = makeDropdownCtx(triggerEvent);

    // Click on a non-interactive div inside the surface
    const divClick = makeEvent({
      eventType: 'click',
      target: makeTarget({
        tag: 'DIV',
        className: 'passenger-label',
        accessibleName: 'Adults',
        elementId: 'label-0',
      }),
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: ['dropdown-menu', 'popover'],
        tabIndex: null,
      },
    });

    const dropdownInScope = dropdownDefinition.isInScope(divClick, ctx);
    expect(dropdownInScope).toBe(true);
  });
});
