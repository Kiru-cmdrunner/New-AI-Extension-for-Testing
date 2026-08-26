/**
 * 7.4-B5 Modal — IR bridge pins (spec B5-1-6, B5-2c-3, B5-1-7, R1, R6, R12).
 *
 * Red-first: fails until Modal type exists in the bridge and the NoTarget
 * path + extractInputValue + generateDescription cases are wired.
 */
import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import type {
  ComponentInteraction,
  ObservedEvent,
  ElementIdentity,
} from '../../src/shared/component-types';

// ── Factories (shape proven by tests/generation/ir-bridge-noise-drop-7-4-b4.test.ts) ──

function makeIdentity(over: Partial<ElementIdentity>): ElementIdentity {
  return {
    accessibleName: 'Open Settings',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: null,
    name: null,
    stableId: 'open-settings',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '#open-settings',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: '',
    ...over,
  } as ElementIdentity;
}

function makeObserved(over: Partial<ObservedEvent> & {
  eventId: string;
  eventType: string;
}): ObservedEvent {
  return {
    timestamp: 1,
    captureSeq: 1,
    isTrusted: true,
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
      tabIndex: null,
    },
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
    pageUrl: 'https://example.com',
    pageTitle: 'Test',
    ...over,
  } as unknown as ObservedEvent;
}

function makeInteraction(over: Partial<ComponentInteraction> & {
  type: string;
  triggerEvent: ObservedEvent;
  metadata: Record<string, unknown>;
}): ComponentInteraction {
  return {
    interactionId: 'int-1',
    trigger: makeIdentity({}),
    startTime: 1000,
    endTime: 1000,
    endState: 'completed',
    memberEvents: [],
    ...over,
  } as ComponentInteraction;
}

describe('7.4-B5 Modal — IR bridge (B5-1-6, B5-2c-3)', () => {
  it('B5-1-6: open Modal → CLICK with element target', () => {
    const triggerEvent = makeObserved({
      eventId: 'evt-p-1',
      eventType: 'click',
    });
    const interaction = makeInteraction({
      type: 'Modal',
      triggerEvent,
      trigger: makeIdentity({ stableId: 'open-modal', cssSelector: '#open-modal' }),
      metadata: { action: 'open', targetName: 'Open Modal', targetTag: 'BUTTON' },
    });

    const plan = build({
      interactions: [interaction],
      recordingContext: {
        startUrl: 'https://example.com',
        title: 'Test',
      },
      testCaseName: 'test-modal-open',
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe('click');
    expect(plan.steps[0].target.kind).toBe('element');
    expect(plan.steps[0].sourceEventId).toBe('evt-p-1');
  });

  it('B5-2c-3: dismiss Modal → KEYBOARD_SHORTCUT with NoTarget + input "Escape"', () => {
    const triggerEvent = makeObserved({
      eventId: 'evt-p-2',
      eventType: 'keydown',
      key: 'Escape',
    });
    const interaction = makeInteraction({
      type: 'Modal',
      triggerEvent,
      trigger: makeIdentity({ tag: 'INPUT', ariaRole: null, stableId: 'modal-input' }),
      metadata: {
        action: 'dismiss-escape',
        key: 'Escape',
        dialogInAncestry: true,
      },
    });

    const plan = build({
      interactions: [interaction],
      recordingContext: {
        startUrl: 'https://example.com',
        title: 'Test',
      },
      testCaseName: 'test-modal-dismiss',
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe('keyboardShortcut');
    expect(plan.steps[0].target.kind).toBe('none');
    expect(plan.steps[0].input).toBe('Escape');
    expect(plan.steps[0].sourceEventId).toBe('evt-p-2');
  });

  it('B5-1-7: open description is plain-English', () => {
    const triggerEvent = makeObserved({
      eventId: 'evt-p-3',
      eventType: 'click',
    });
    const interaction = makeInteraction({
      type: 'Modal',
      triggerEvent,
      trigger: makeIdentity({ accessibleName: 'Open Settings', stableId: 'open-settings' }),
      metadata: { action: 'open', targetName: 'Open Settings', targetTag: 'BUTTON' },
    });

    const plan = build({
      interactions: [interaction],
      recordingContext: { startUrl: 'https://example.com', title: 'Test' },
      testCaseName: 'test-modal-desc-open',
    });

    expect(plan.steps[0].description).toBeTruthy();
    expect(plan.steps[0].description.toLowerCase()).toContain('open');
    expect(plan.steps[0].description.toLowerCase()).toContain('settings');
  });

  it('B5-1-7: dismiss description is plain-English', () => {
    const triggerEvent = makeObserved({
      eventId: 'evt-p-4',
      eventType: 'keydown',
      key: 'Escape',
    });
    const interaction = makeInteraction({
      type: 'Modal',
      triggerEvent,
      trigger: makeIdentity({ tag: 'INPUT' }),
      metadata: { action: 'dismiss-escape', key: 'Escape', dialogInAncestry: true },
    });

    const plan = build({
      interactions: [interaction],
      recordingContext: { startUrl: 'https://example.com', title: 'Test' },
      testCaseName: 'test-modal-desc-dismiss',
    });

    expect(plan.steps[0].description).toBeTruthy();
    // Direction-neutral (B1 discipline) — mentions Escape
    expect(plan.steps[0].description.toLowerCase()).toContain('escape');
  });

  it('R6: Modal is NOT in NOISE_TYPES (plan has steps)', () => {
    const triggerEvent = makeObserved({
      eventId: 'evt-p-5',
      eventType: 'click',
    });
    const interaction = makeInteraction({
      type: 'Modal',
      triggerEvent,
      trigger: makeIdentity({}),
      metadata: { action: 'open', targetName: 'X' },
    });

    const plan = build({
      interactions: [interaction],
      recordingContext: { startUrl: 'https://example.com', title: 'Test' },
      testCaseName: 'test-modal-noise',
    });

    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('R12: other types still get element targets (not NoTarget)', () => {
    const triggerEvent = makeObserved({
      eventId: 'evt-p-6',
      eventType: 'click',
    });
    const interaction = makeInteraction({
      type: 'Click',
      triggerEvent,
      trigger: makeIdentity({ stableId: 'btn-1', cssSelector: '#btn-1' }),
      metadata: { physicalEventType: 'click', targetName: 'Click Me' },
    });

    const plan = build({
      interactions: [interaction],
      recordingContext: { startUrl: 'https://example.com', title: 'Test' },
      testCaseName: 'test-modal-r12',
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].target.kind).toBe('element');
  });
});