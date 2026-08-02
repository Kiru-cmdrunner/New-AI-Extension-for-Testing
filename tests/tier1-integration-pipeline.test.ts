/**
 * Tier 1 integration test: full production pipeline
 *
 * Uses runPipeline — the ACTUAL production entry point in service-worker.ts.
 * No mock objects, no FixtureDomInspector. Proves that semantic knowledge
 * travels ComponentInteraction → adapter → recognition → enrichment →
 * capability → CapabilityCandidate with non-empty inputs.
 */
import { describe, it, expect } from 'vitest';
import { runPipeline } from '../src/recorder/pipeline/pipeline-runner';
import type { ComponentInteraction } from '../src/shared/component-types';
import type { ElementIdentity } from '../src/shared/types';
import type { RecordedEvent } from '../src/recorder/recorded-event';

let idCounter = 5000;
function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    elementId: nextId('elem'),
    accessibleName: 'Test Field',
    ariaRole: 'textbox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '#test',
    xPath: '//input',
    inIframe: false,
    shadowDom: false,
    ...overrides,
  };
}

function makeEvent(
  type: string,
  identity: ElementIdentity,
  domCtx?: Record<string, unknown>,
): RecordedEvent {
  return {
    eventId: nextId('evt'),
    eventType: type as RecordedEvent['eventType'],
    timestamp: new Date().toISOString(),
    targetElementId: identity.elementId,
    domContext: {
      inputType: 'text',
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      ...domCtx,
    } as RecordedEvent['domContext'],
  } as RecordedEvent;
}

function makeInteraction(
  type: string,
  trigger: ElementIdentity,
  memberEvents: { eventId: string }[],
): ComponentInteraction {
  return {
    interactionId: nextId('int'),
    type,
    subtype: null,
    trigger,
    memberEvents: memberEvents.map((e) => ({ eventId: e.eventId, frameId: null })),
    timestamp: Date.now(),
    metadata: {},
  } as unknown as ComponentInteraction;
}

describe('Tier 1 Integration: Production Pipeline (runPipeline)', () => {
  it('login form produces CapabilityCandidate with non-empty inputs', () => {
    const emailIdentity = makeIdentity({
      accessibleName: 'Email Address',
      elementId: 'elem-email',
      name: 'email',
    });
    const passwordIdentity = makeIdentity({
      accessibleName: 'Password',
      elementId: 'elem-password',
      name: 'password',
    });

    const emailEvents: RecordedEvent[] = [
      makeEvent('click', emailIdentity, { inputType: 'email', required: true }),
      makeEvent('input', emailIdentity, { inputType: 'email', required: true }),
    ];
    const passwordEvents: RecordedEvent[] = [
      makeEvent('click', passwordIdentity, { inputType: 'password', required: true }),
      makeEvent('input', passwordIdentity, { inputType: 'password', required: true }),
    ];

    const interactions: ComponentInteraction[] = [
      makeInteraction('TextEntry', emailIdentity, emailEvents),
      makeInteraction('TextEntry', passwordIdentity, passwordEvents),
    ];

    const result = runPipeline(
      [...emailEvents, ...passwordEvents],
      interactions,
      'session-001',
      'https://app.com/login',
    );

    // Pipeline must succeed
    expect(result.fragment).not.toBeNull();
    expect(result.capability).not.toBeNull();

    // C2/D1: LogicalActions have non-null businessField from accessibleName
    const dataActions = result.fragment!.logicalActions.filter((a) => a.businessField !== null);
    expect(dataActions.length).toBeGreaterThanOrEqual(2);

    // C1: sourceInteractionType carried through
    const textActions = result.fragment!.logicalActions.filter(
      (a) => a.sourceInteractionType === 'TextEntry',
    );
    expect(textActions.length).toBeGreaterThanOrEqual(2);

    // C3: InteractionContracts have constraints
    const emailContract = result.fragment!.interactionContracts.find(
      (c) => c.appliesTo.id === 'elem-email',
    );
    expect(emailContract).toBeDefined();
    expect(emailContract!.constraints.required).toBe(true);
    expect(emailContract!.constraints.inputType).toBe('email');

    // THE KEY ASSERTION: CapabilityCandidate has non-empty inputs
    expect(result.capability!.inputs.length).toBeGreaterThanOrEqual(2);

    const emailInput = result.capability!.inputs.find(
      (i) => i.label === 'Email Address',
    );
    expect(emailInput).toBeDefined();
    expect(emailInput!.required).toBe(true);
    expect(emailInput!.inputType).toBe('email');
    expect(emailInput!.sourceInteractionType).toBe('TextEntry');
    expect(emailInput!.displayLabel).toBe('Email Address');

    const passwordInput = result.capability!.inputs.find(
      (i) => i.label === 'Password',
    );
    expect(passwordInput).toBeDefined();
    expect(passwordInput!.required).toBe(true);
    expect(passwordInput!.sourceInteractionType).toBe('TextEntry');
  });

  it('R3-reclassified custom checkbox (div[role=checkbox]) reaches capability', () => {
    const checkboxIdentity = makeIdentity({
      accessibleName: 'Accept Terms',
      elementId: 'elem-terms',
      tag: 'DIV',
      ariaRole: 'checkbox',
    });

    const events: RecordedEvent[] = [makeEvent('click', checkboxIdentity)];
    const interactions: ComponentInteraction[] = [
      makeInteraction('Checkbox', checkboxIdentity, events),
    ];

    const result = runPipeline(events, interactions, 'session-002', 'https://app.com/signup');

    expect(result.fragment).not.toBeNull();
    expect(result.capability).not.toBeNull();

    const termsAction = result.fragment!.logicalActions.find(
      (a) => a.businessField === 'Accept Terms',
    );
    expect(termsAction).toBeDefined();
    expect(termsAction!.sourceInteractionType).toBe('Checkbox');
    expect(termsAction!.displayLabel).toBe('Accept Terms');

    const termsInput = result.capability!.inputs.find((i) => i.label === 'Accept Terms');
    expect(termsInput).toBeDefined();
    expect(termsInput!.sourceInteractionType).toBe('Checkbox');
  });

  it('R2 custom slider (div[role=slider]) with aria-value constraints reaches capability', () => {
    const sliderIdentity = makeIdentity({
      accessibleName: 'Maximum Price',
      elementId: 'elem-slider',
      tag: 'DIV',
      ariaRole: 'slider',
    });

    const events: RecordedEvent[] = [
      makeEvent('click', sliderIdentity, {
        inputType: null,
        ariaValueMin: '0',
        ariaValueMax: '1000',
        ariaValueNow: '500',
        ariaValueText: '500',
      }),
    ];
    const interactions: ComponentInteraction[] = [
      makeInteraction('Slider', sliderIdentity, events),
    ];

    const result = runPipeline(events, interactions, 'session-003', 'https://app.com/filters');

    expect(result.fragment).not.toBeNull();
    expect(result.capability).not.toBeNull();

    const sliderAction = result.fragment!.logicalActions.find(
      (a) => a.businessField === 'Maximum Price',
    );
    expect(sliderAction).toBeDefined();
    expect(sliderAction!.sourceInteractionType).toBe('Slider');

    const sliderInput = result.capability!.inputs.find((i) => i.label === 'Maximum Price');
    expect(sliderInput).toBeDefined();
    expect(sliderInput!.sourceInteractionType).toBe('Slider');
  });

  it('element with empty accessibleName produces null businessField (boundary)', () => {
    const identity = makeIdentity({
      accessibleName: '',
      elementId: 'elem-unlabeled',
    });

    const events: RecordedEvent[] = [makeEvent('click', identity, { inputType: 'text' })];
    const interactions: ComponentInteraction[] = [
      makeInteraction('TextEntry', identity, events),
    ];

    const result = runPipeline(events, interactions, 'session-004', 'https://app.com');

    expect(result.fragment).not.toBeNull();
    const unlabeled = result.fragment!.logicalActions.find(
      (a) => a.businessField === null || a.businessField === '',
    );
    expect(unlabeled).toBeDefined();
  });
});
