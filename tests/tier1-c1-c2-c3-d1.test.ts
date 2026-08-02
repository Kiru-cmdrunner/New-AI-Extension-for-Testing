/**
 * Tier 1 focused tests: C1, C2, C3, D1
 *
 * Validates that the four Tier 1 corrections restore designed data flows:
 * - C1: sourceInteractionType carries through from ComponentInteraction.type
 * - C2: businessField = accessibleName for standalone data-input interactions
 * - C3: domAttributes Record populated from typed DomContext fields
 * - D1: buildStandaloneAction uses elements map + C1/C2 outputs
 */
import { describe, it, expect } from 'vitest';
import { adaptToDomainEntitiesV2 } from '../src/recorder/pipeline/domain-adapter-v2';
import { aggregateActions } from '../src/recorder/enrichment/semantic-aggregator';
import type { ComponentInteraction } from '../src/shared/component-types';
import type { ElementIdentity } from '../src/shared/types';
import type { RecordedEvent } from '../src/recorder/recorded-event';
import type { ObservedTransition } from '../src/domain/entities/observed-transition';
import { createObservedTransition, emptyElementState } from '../src/domain/entities/observed-transition';
import { TransitionOperation, RelevanceLevel } from '../src/domain/enums';

// ── Helpers ──────────────────────────────────────────────

let idCounter = 1000;
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
  overrides: Partial<RecordedEvent> = {},
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
      ...overrides.domContext,
    } as RecordedEvent['domContext'],
    ...overrides,
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

// ── C1: sourceInteractionType ────────────────────────────

describe('C1: sourceInteractionType on ObservedTransition', () => {
  it('adapter populates sourceInteractionType from ci.type', () => {
    const identity = makeIdentity({ accessibleName: 'Email' });
    const events: RecordedEvent[] = [makeEvent('click', identity)];
    const interaction = makeInteraction('TextEntry', identity, events);

    const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0].sourceInteractionType).toBe('TextEntry');
  });

  it('adapter populates sourceInteractionType for all data-input types', () => {
    const types = ['TextEntry', 'Checkbox', 'Slider', 'DatePicker', 'FileUpload', 'RadioButton'];

    for (const type of types) {
      const identity = makeIdentity({ accessibleName: `${type} Field`, elementId: nextId('elem') });
      const events: RecordedEvent[] = [makeEvent('click', identity)];
      const interaction = makeInteraction(type, identity, events);

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].sourceInteractionType).toBe(type);
    }
  });

  it('createObservedTransition defaults sourceInteractionType to null when not provided', () => {
    const t = createObservedTransition({
      transitionId: 't1',
      elementId: 'e1',
      operation: TransitionOperation.CLICK,
      timestamp: 1,
      relevance: RelevanceLevel.DELIBERATE,
      stateBefore: emptyElementState(),
      stateAfter: emptyElementState(),
      evidence: [],
    });
    expect(t.sourceInteractionType).toBeNull();
  });
});

// ── C2 + D1: businessField from accessibleName in standalone actions ─

describe('C2/D1: businessField resolution in standalone actions', () => {
  it('buildStandaloneAction resolves businessField from elements map', () => {
    const identity = makeIdentity({ accessibleName: 'Email Address' });
    const events: RecordedEvent[] = [makeEvent('input', identity)];
    const interaction = makeInteraction('TextEntry', identity, events);

    const domainResult = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    const actions = aggregateActions({
      components: [],
      transitions: domainResult.transitions,
      patterns: new Map(),
      elements: domainResult.elements,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0].componentId).toBeNull();
    expect(actions[0].businessField).toBe('Email Address');
    expect(actions[0].displayLabel).toBe('Email Address');
    expect(actions[0].sourceInteractionType).toBe('TextEntry');
  });

  it('businessField is null for elements with empty accessibleName', () => {
    const identity = makeIdentity({ accessibleName: '' });
    const events: RecordedEvent[] = [makeEvent('click', identity)];
    const interaction = makeInteraction('Click', identity, events);

    const domainResult = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    const actions = aggregateActions({
      components: [],
      transitions: domainResult.transitions,
      patterns: new Map(),
      elements: domainResult.elements,
    });

    expect(actions).toHaveLength(1);
    expect(actions[0].businessField).toBeNull();
  });

  it('multiple standalone actions each get their own businessField', () => {
    const identity1 = makeIdentity({ accessibleName: 'Username', elementId: 'elem-u' });
    const identity2 = makeIdentity({ accessibleName: 'Password', elementId: 'elem-p' });
    const events1: RecordedEvent[] = [makeEvent('input', identity1)];
    const events2: RecordedEvent[] = [makeEvent('input', identity2)];
    const interaction1 = makeInteraction('TextEntry', identity1, events1);
    const interaction2 = makeInteraction('TextEntry', identity2, events2);

    const domainResult = adaptToDomainEntitiesV2(
      [...events1, ...events2],
      [interaction1, interaction2],
      'https://example.com',
    );

    const actions = aggregateActions({
      components: [],
      transitions: domainResult.transitions,
      patterns: new Map(),
      elements: domainResult.elements,
    });

    expect(actions).toHaveLength(2);
    const fields = actions.map((a) => a.businessField).sort();
    expect(fields).toEqual(['Password', 'Username']);
  });
});

// ── C3: domAttributes from typed DomContext fields ───────

describe('C3: domAttributes Record from typed DomContext fields', () => {
  it('projects required field into domAttributes', () => {
    const identity = makeIdentity();
    const events: RecordedEvent[] = [
      makeEvent('click', identity, {
        domContext: { inputType: 'text', required: true, isContentEditable: false } as RecordedEvent['domContext'],
      }),
    ];
    const interaction = makeInteraction('TextEntry', identity, events);

    const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    expect(result.elements[0].domAttributes['required']).toBe('');
  });

  it('projects inputType as type into domAttributes', () => {
    const identity = makeIdentity();
    const events: RecordedEvent[] = [
      makeEvent('click', identity, {
        domContext: { inputType: 'email', required: false, isContentEditable: false } as RecordedEvent['domContext'],
      }),
    ];
    const interaction = makeInteraction('TextEntry', identity, events);

    const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    expect(result.elements[0].domAttributes['type']).toBe('email');
  });

  it('projects validation constraints (pattern, minLength, maxLength)', () => {
    const identity = makeIdentity();
    const events: RecordedEvent[] = [
      makeEvent('click', identity, {
        domContext: {
          inputType: 'text',
          required: true,
          pattern: '^[A-Z].*',
          minLength: 3,
          maxLength: 50,
          isContentEditable: false,
        } as RecordedEvent['domContext'],
      }),
    ];
    const interaction = makeInteraction('TextEntry', identity, events);

    const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    const attrs = result.elements[0].domAttributes;
    expect(attrs['pattern']).toBe('^[A-Z].*');
    expect(attrs['minlength']).toBe('3');
    expect(attrs['maxlength']).toBe('50');
  });

  it('projects numeric range constraints (min, max, step)', () => {
    const identity = makeIdentity({ tag: 'INPUT', ariaRole: 'slider' });
    const events: RecordedEvent[] = [
      makeEvent('click', identity, {
        domContext: {
          inputType: 'range',
          min: '0',
          max: '100',
          step: '5',
          isContentEditable: false,
        } as RecordedEvent['domContext'],
      }),
    ];
    const interaction = makeInteraction('Slider', identity, events);

    const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    const attrs = result.elements[0].domAttributes;
    expect(attrs['min']).toBe('0');
    expect(attrs['max']).toBe('100');
    expect(attrs['step']).toBe('5');
  });

  it('projects aria-value constraints for custom sliders', () => {
    const identity = makeIdentity({ tag: 'DIV', ariaRole: 'slider' });
    const events: RecordedEvent[] = [
      makeEvent('click', identity, {
        domContext: {
          ariaValueMin: '0',
          ariaValueMax: '1000',
          ariaValueNow: '250',
          ariaValueText: '250',
          isContentEditable: false,
        } as RecordedEvent['domContext'],
      }),
    ];
    const interaction = makeInteraction('Slider', identity, events);

    const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    const attrs = result.elements[0].domAttributes;
    expect(attrs['aria-valuemin']).toBe('0');
    expect(attrs['aria-valuemax']).toBe('1000');
    expect(attrs['aria-valuenow']).toBe('250');
  });

  it('preserves backward compat with existing domAttributes Record on event', () => {
    const identity = makeIdentity();
    const events: RecordedEvent[] = [
      makeEvent('click', identity, {
        domContext: {
          domAttributes: { 'data-testid': 'login-email' },
          inputType: 'email',
          required: true,
          isContentEditable: false,
        } as RecordedEvent['domContext'],
      }),
    ];
    const interaction = makeInteraction('TextEntry', identity, events);

    const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    const attrs = result.elements[0].domAttributes;
    // Backward compat: existing Record preserved
    expect(attrs['data-testid']).toBe('login-email');
    // C3: typed fields also projected
    expect(attrs['type']).toBe('email');
    expect('required' in attrs).toBe(true);
  });

  it('domAttributes is empty for navigation events', () => {
    const identity = makeIdentity();
    const events: RecordedEvent[] = [
      makeEvent('navigation', identity),
    ];
    const interaction = makeInteraction('PageNavigation', identity, events);

    const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');

    expect(Object.keys(result.elements[0].domAttributes)).toHaveLength(0);
  });
});
