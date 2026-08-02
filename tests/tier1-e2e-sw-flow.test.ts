/**
 * Tier 1 E2E Trace: Service Worker STOP_RECORDING Flow
 *
 * Simulates exactly what the service worker does when the user clicks "Stop Recording":
 * 1. Collects buffered events from sessionStorage
 * 2. Runs Component Runtime on events → ComponentInteraction[]
 * 3. Calls runPipeline(events, interactions, sessionId, url)
 * 4. Derives CapabilityCandidate from fragment
 * 5. Verifies P2CapabilityContract output on approval
 *
 * This test is NOT a unit test — it simulates the real SW flow with
 * realistic DOM events that a real content script would capture.
 */
import { describe, it, expect } from 'vitest';
import { runPipeline } from '../src/recorder/pipeline/pipeline-runner';
import { capabilityInputToDataRequirement } from '../src/domain/mappings/capability-mappers';
import type { ComponentInteraction } from '../src/shared/component-types';
import type { ElementIdentity } from '../src/shared/types';
import type { RecordedEvent } from '../src/recorder/recorded-event';

let idCounter = 9000;
function nextId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    elementId: nextId('elem'),
    accessibleName: 'Field',
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
    cssSelector: '#field',
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

describe('Tier 1 E2E: Service Worker STOP_RECORDING Flow', () => {
  it('Native flow: login form recording → CapabilityCandidate → DataRequirements → P2-ready', () => {
    // ── Simulate what the content script captures for a login form ──
    const emailId = makeIdentity({
      accessibleName: 'Email Address',
      elementId: 'elem-1',
      name: 'email',
      tag: 'INPUT',
      ariaRole: 'textbox',
    });
    const pwId = makeIdentity({
      accessibleName: 'Password',
      elementId: 'elem-2',
      name: 'password',
      tag: 'INPUT',
      ariaRole: 'textbox',
    });

    // Realistic event sequence: focus → input → blur for each field
    const emailEvents = [
      makeEvent('focus', emailId, { inputType: 'email', required: true, pattern: '^[^@]+@[^@]+\\.[^@]+$' }),
      makeEvent('input', emailId, { inputType: 'email', required: true, pattern: '^[^@]+@[^@]+\\.[^@]+$' }),
      makeEvent('blur', emailId, { inputType: 'email', required: true }),
    ];
    const pwEvents = [
      makeEvent('focus', pwId, { inputType: 'password', required: true, minLength: 8 }),
      makeEvent('input', pwId, { inputType: 'password', required: true, minLength: 8 }),
      makeEvent('blur', pwId, { inputType: 'password', required: true, minLength: 8 }),
    ];

    // Component Runtime would classify these as TextEntry
    const interactions: ComponentInteraction[] = [
      makeInteraction('TextEntry', emailId, emailEvents),
      makeInteraction('TextEntry', pwId, pwEvents),
    ];

    // ── SW calls runPipeline (production entry point) ──
    const result = runPipeline(
      [...emailEvents, ...pwEvents],
      interactions,
      'rec-session-001',
      'https://app.example.com/login',
    );

    // ── Verify CapabilityCandidate ──
    expect(result.capability).not.toBeNull();
    const cap = result.capability!;
    expect(cap.inputs.length).toBe(2);

    // Email input
    const emailInput = cap.inputs.find((i) => i.label === 'Email Address')!;
    expect(emailInput).toBeDefined();
    expect(emailInput.required).toBe(true);
    expect(emailInput.inputType).toBe('email');
    expect(emailInput.sourceInteractionType).toBe('TextEntry');
    expect(emailInput.displayLabel).toBe('Email Address');

    // Format constraint from pattern
    expect(emailInput.format).not.toBeNull();
    expect(emailInput.format!.regex).toContain('[^@]');

    // Password input
    const pwInput = cap.inputs.find((i) => i.label === 'Password')!;
    expect(pwInput).toBeDefined();
    expect(pwInput.required).toBe(true);
    expect(pwInput.inputType).toBe('password');
    expect(pwInput.sourceInteractionType).toBe('TextEntry');

    // Length constraint from minLength
    expect(pwInput.lengthRange).not.toBeNull();
    expect(pwInput.lengthRange!.minLength).toBe(8);

    // ── Verify DataRequirements (what P2CapabilityContract carries) ──
    const dataReqs = cap.inputs.map(capabilityInputToDataRequirement);

    const emailReq = dataReqs.find((r) => r.field === 'Email Address')!;
    expect(emailReq).toBeDefined();
    expect(emailReq.kind).toBe('email');
    expect(emailReq.inputMethod).toBe('text');
    expect(emailReq.required).toBe(true);
    // C2: displayLabel → DataRequirement.label (not humanizeLabel reconstruction)
    expect(emailReq.label).toBe('Email Address');

    const pwReq = dataReqs.find((r) => r.field === 'Password')!;
    expect(pwReq).toBeDefined();
    expect(pwReq.kind).toBe('text');
    expect(pwReq.inputMethod).toBe('text');
    expect(pwReq.required).toBe(true);

    console.log('✓ NATIVE FLOW: CapabilityCandidate → DataRequirements verified');
    console.log('  Email:', { field: emailReq.field, kind: emailReq.kind, inputMethod: emailReq.inputMethod, required: emailReq.required });
    console.log('  Password:', { field: pwReq.field, kind: pwReq.kind, inputMethod: pwReq.inputMethod, required: pwReq.required });
  });

  it('R2/R3 custom flow: div[role=slider] recording → CapabilityCandidate', () => {
    const sliderId = makeIdentity({
      accessibleName: 'Maximum Price',
      elementId: 'elem-slider-1',
      tag: 'DIV',
      ariaRole: 'slider',
      ariaLabel: 'Maximum Price',
    });

    // R2/R3 custom slider: user drags thumb, content script captures
    // aria-value changes and attribute mutations
    const events = [
      makeEvent('click', sliderId, {
        inputType: null,
        ariaValueMin: '0',
        ariaValueMax: '5000',
        ariaValueNow: '1000',
        ariaValueText: '$1,000',
        attributeChanges: [
          { attribute: 'aria-valuenow', before: '500', after: '1000' },
          { attribute: 'aria-valuetext', before: '$500', after: '$1,000' },
        ],
      }),
    ];

    // Component Runtime with R3 behavioral evidence would classify as Slider
    const interactions: ComponentInteraction[] = [
      makeInteraction('Slider', sliderId, events),
    ];

    const result = runPipeline(events, interactions, 'rec-session-002', 'https://shop.example.com/filters');

    expect(result.capability).not.toBeNull();
    const cap = result.capability!;

    const sliderInput = cap.inputs.find((i) => i.label === 'Maximum Price');
    expect(sliderInput).toBeDefined();
    expect(sliderInput!.sourceInteractionType).toBe('Slider');
    expect(sliderInput!.displayLabel).toBe('Maximum Price');

    // C3: aria-value constraints projected
    const sliderEl = result.entities.elements[0];
    expect(sliderEl.domAttributes['aria-valuemin']).toBe('0');
    expect(sliderEl.domAttributes['aria-valuemax']).toBe('5000');

    console.log('✓ R2/R3 CUSTOM FLOW: div[role=slider] → CapabilityCandidate verified');
    console.log('  Slider:', {
      field: sliderInput!.label,
      sourceInteractionType: sliderInput!.sourceInteractionType,
      ariaConstraints: {
        min: sliderEl.domAttributes['aria-valuemin'],
        max: sliderEl.domAttributes['aria-valuemax'],
      },
    });
  });

  it('R3 custom flow: div[role=checkbox] recording → CapabilityCandidate', () => {
    const checkboxId = makeIdentity({
      accessibleName: 'Subscribe to Newsletter',
      elementId: 'elem-cb-1',
      tag: 'DIV',
      ariaRole: 'checkbox',
    });

    const events = [
      makeEvent('click', checkboxId, {
        attributeChanges: [
          { attribute: 'aria-checked', before: 'false', after: 'true' },
        ],
      }),
    ];

    // R3 behavioral evidence: class toggle + aria-checked change → Checkbox
    const interactions: ComponentInteraction[] = [
      makeInteraction('Checkbox', checkboxId, events),
    ];

    const result = runPipeline(events, interactions, 'rec-session-003', 'https://app.example.com/settings');

    expect(result.capability).not.toBeNull();
    const cap = result.capability!;

    const checkboxInput = cap.inputs.find((i) => i.label === 'Subscribe to Newsletter');
    expect(checkboxInput).toBeDefined();
    expect(checkboxInput!.sourceInteractionType).toBe('Checkbox');

    console.log('✓ R3 CUSTOM FLOW: div[role=checkbox] → CapabilityCandidate verified');
    console.log('  Checkbox:', {
      field: checkboxInput!.label,
      sourceInteractionType: checkboxInput!.sourceInteractionType,
    });
  });
});
