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

// ── Helpers ───────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    tag: 'A',
    cssPath: 'body > nav > a',
    accessibleName: 'Services',
    ariaLabel: null,
    textContent: 'Services',
    href: '/services',
    type: null,
    inputType: null,
    role: null,
    ariaRole: null,
    className: null,
    id: null,
    value: null,
    placeholder: null,
    checkedBefore: null,
    checkedAfter: null,
    elementKey: 'a-services',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  const target = overrides.target ? makeTarget(overrides.target) : makeTarget();
  return {
    eventId: 'evt-1-0',
    eventType: 'mouseenter',
    timestamp: 1000,
    isTrusted: true,
    target,
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 200,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Example',
    ...overrides,
    target,
  };
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
    data: {},
  };
}

// ── CSS Overlay Evidence Tests ────────────────────────────────────────

describe('Hover: CSS overlay evidence signal', () => {
  it('promotes hover for element with "has-submenu" class + dwell ≥ 500ms', () => {
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
    expect((ctx.data.confidence as number) ?? 0).toBeGreaterThanOrEqual(50);
    expect(ctx.data.evidenceReason).toBe('overlay-css');
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
      },
    });

    const ctx = makeCtx(enter);

    const leave = makeLeaveEvent(enter, 600);
    const completion = hoverDefinition.handleEvent(leave, ctx);

    expect(completion).not.toBeNull();
    expect(completion!.endState).toBe('completed');
    // nav-link matches OVERLAY_CSS_RE, so overlay-css reason takes priority
    expect(['overlay-css', 'nav-ancestor']).toContain(ctx.data.evidenceReason);
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

  it('does NOT promote hover with CSS evidence but dwell < 500ms', () => {
    const enter = makeEvent({
      target: makeTarget({ className: 'has-submenu' }),
    });

    const trigger = hoverDefinition.detectTrigger(enter);
    expect(trigger).not.toBeNull();

    const ctx = makeCtx(enter);

    const leave = makeLeaveEvent(enter, 200);
    const completion = hoverDefinition.handleEvent(leave, ctx);

    // Below 500ms threshold → discarded (no evidence accumulated)
    expect(completion).not.toBeNull();
    expect(completion!.endState).toBe('discarded');
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
        elementKey: 'dropdown-trigger-0',
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
        elementKey: 'stepper-plus-0',
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
        elementKey: 'dropdown-trigger-0',
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
        elementKey: 'option-premium',
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
        elementKey: 'dropdown-trigger-0',
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
        elementKey: 'label-0',
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
      },
    });

    const dropdownInScope = dropdownDefinition.isInScope(divClick, ctx);
    expect(dropdownInScope).toBe(true);
  });
});
