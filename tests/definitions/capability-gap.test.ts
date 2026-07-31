/**
 * Tests for Phase 2 Capability Gap definitions:
 * - DoubleClick subtype (already in Click definition, verified here)
 * - RightClick subtype (new in Click definition)
 * - NewTab definition
 * - NewWindow definition
 * - Breadcrumb definition
 */

import { describe, it, expect } from 'vitest';
import { createRuntime, type ComponentInteraction } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions/index';
import type { ObservedEvent, ElementIdentity, DomContext } from '../../src/shared/component-types';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    cssSelector: 'button.test',
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaLabel: null,
    tag: 'BUTTON',
    testId: null,
    dataCy: null,
    dataQa: null,
    stableId: null,
    className: 'test-btn',
    placeholder: null,
    inputType: null,
    isContentEditable: false,
    ariaExpanded: null,
    ariaHasPopup: null,
    ancestorRoles: [],
    ancestorClasses: [],
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
    ...overrides,
  };
}

function makeClickEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  domContextOverrides: Partial<DomContext> = {},
): ObservedEvent {
  return {
    eventId: `evt-1-${Math.random()}`,
    eventType: 'click',
    timestamp: Date.now(),
    isTrusted: true,
    target: makeElementIdentity(targetOverrides),
    domContext: makeDomContext(domContextOverrides),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 200,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com/page',
    pageTitle: 'Test Page',
  };
}

function processEvent(runtime: ReturnType<typeof createRuntime>, event: ObservedEvent): ComponentInteraction[] {
  const interactions: ComponentInteraction[] = [];
  const runtimeWithCapture = createRuntime(
    ALL_DEFINITIONS,
    { onEmit: (ci) => interactions.push(ci) },
  );
  runtimeWithCapture.process(event);
  runtimeWithCapture.flush();
  return interactions;
}

// ── RightClick ─────────────────────────────────────────────────────────

describe('RightClick subtype', () => {
  it('produces Click with RightClick subtype for contextmenu events', () => {
    const event = makeClickEvent(
      { tag: 'BUTTON', ariaRole: 'button', className: 'btn' },
    );
    event.eventType = 'contextmenu';

    const interactions = processEvent(null as never, event);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('Click');
    expect(interactions[0].interactionSubtype).toBe('RightClick');
    expect(interactions[0].metadata.rightClick).toBe(true);
  });
});

// ── NewTab ─────────────────────────────────────────────────────────────

describe('NewTab definition', () => {
  it('classifies click on target=_blank link as NewTab', () => {
    const event = makeClickEvent(
      { tag: 'A', ariaRole: 'link', className: 'ext-link' },
      {
        opensNewTab: true,
        openedUrl: 'https://external.com',
      },
    );

    const interactions = processEvent(null as never, event);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('NewTab');
    expect(interactions[0].metadata.opensNewTab).toBe(true);
    expect(interactions[0].metadata.openedUrl).toBe('https://external.com');
  });

  it('does not trigger on regular links without opensNewTab', () => {
    const event = makeClickEvent(
      { tag: 'A', ariaRole: 'link', className: 'internal-link' },
      { opensNewTab: null },
    );

    const interactions = processEvent(null as never, event);
    expect(interactions).toHaveLength(1);
    // Should be classified as Link, not NewTab
    expect(interactions[0].type).toBe('Link');
  });
});

// ── NewWindow ──────────────────────────────────────────────────────────

describe('NewWindow definition', () => {
  it('classifies click with opensNewWindow as NewWindow', () => {
    const event = makeClickEvent(
      { tag: 'BUTTON', ariaRole: 'button', className: 'popup-btn' },
      {
        opensNewWindow: true,
        openedUrl: 'https://popup.example.com',
      },
    );

    const interactions = processEvent(null as never, event);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('NewWindow');
    expect(interactions[0].metadata.opensNewWindow).toBe(true);
    expect(interactions[0].metadata.openedUrl).toBe('https://popup.example.com');
  });
});

// ── Breadcrumb ─────────────────────────────────────────────────────────

describe('Breadcrumb definition', () => {
  it('classifies click on breadcrumb element as Breadcrumb', () => {
    const event = makeClickEvent(
      { tag: 'A', ariaRole: 'link', className: 'crumb-link', accessibleName: 'Home' },
      { ancestorClasses: ['breadcrumb-nav'] },
    );

    const interactions = processEvent(null as never, event);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('Breadcrumb');
    expect(interactions[0].metadata.crumbText).toBe('Home');
  });

  it('classifies click on element with breadcrumb class directly', () => {
    const event = makeClickEvent(
      { tag: 'LI', ariaRole: 'listitem', className: 'breadcrumb-item', accessibleName: 'Products' },
    );

    const interactions = processEvent(null as never, event);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('Breadcrumb');
    expect(interactions[0].metadata.crumbText).toBe('Products');
  });

  it('does not trigger on non-breadcrumb elements', () => {
    const event = makeClickEvent(
      { tag: 'BUTTON', ariaRole: 'button', className: 'action-btn', accessibleName: 'Submit' },
    );

    const interactions = processEvent(null as never, event);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('Click');
  });
});

// ── DoubleClick (existing, verify still works) ────────────────────────

describe('DoubleClick subtype', () => {
  it('produces Click with DoubleClick subtype for dblclick events', () => {
    const event = makeClickEvent(
      { tag: 'BUTTON', ariaRole: 'button', className: 'btn' },
    );
    event.eventType = 'dblclick';

    const interactions = processEvent(null as never, event);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('Click');
    expect(interactions[0].interactionSubtype).toBe('DoubleClick');
    expect(interactions[0].metadata.doubleClick).toBe(true);
  });
});
