/**
 * Tests for the Domain Adapter (Milestone 6.2).
 *
 * Verifies that RecordedEvent[] + DetectedInteraction[] are correctly
 * transformed into UiElement[] + ObservedTransition[].
 */

import { describe, it, expect } from 'vitest';
import { adaptToDomainEntities } from '../src/recorder/pipeline/domain-adapter';
import type { RecordedEvent, ElementRecordedEvent, NavigationRecordedEvent } from '../src/recorder/recorded-event';
import type { DetectedInteraction } from '../src/classifier/interaction-types';
import type { ElementIdentity } from '../src/shared/types';
import { TransitionOperation, RelevanceLevel, TransitionEvidenceType, IntrinsicCapability } from '../src/domain/enums';

// ── Test helpers ────────────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: null,
    name: null,
    stableId: 'test-btn',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'button#test-btn',
    xPath: '//button[@id=\'test-btn\']',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeClickEvent(overrides: Partial<ElementRecordedEvent> = {}): ElementRecordedEvent {
  return {
    eventId: 'evt-001',
    eventType: 'click',
    timestamp: '2026-07-21T12:00:00.000Z',
    target: makeElementIdentity(),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

function makeInputEvent(overrides: Partial<ElementRecordedEvent> = {}): ElementRecordedEvent {
  return {
    eventId: 'evt-002',
    eventType: 'input',
    timestamp: '2026-07-21T12:00:01.000Z',
    target: makeElementIdentity({
      elementId: 'elem-0002',
      tag: 'INPUT',
      ariaRole: 'textbox',
      accessibleName: 'Email',
      cssSelector: 'input#email',
      xPath: '//input[@id=\'email\']',
      stableId: 'email',
    }),
    valueBefore: '',
    valueAfter: 'test@example.com',
    checkedBefore: null,
    checkedAfter: null,
    domContext: {
      inputType: 'email',
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      domAttributes: { type: 'email', required: '', minlength: '5', maxlength: '100' },
    },
    ...overrides,
  };
}

function makeCheckboxEvent(overrides: Partial<ElementRecordedEvent> = {}): ElementRecordedEvent {
  return {
    eventId: 'evt-003',
    eventType: 'click',
    timestamp: '2026-07-21T12:00:02.000Z',
    target: makeElementIdentity({
      elementId: 'elem-0003',
      tag: 'INPUT',
      ariaRole: 'checkbox',
      accessibleName: 'Subscribe',
      cssSelector: 'input#subscribe',
      xPath: '//input[@id=\'subscribe\']',
      stableId: 'subscribe',
    }),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: false,
    checkedAfter: true,
    domContext: {
      inputType: 'checkbox',
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
    },
    ...overrides,
  };
}

function makeNavigationEvent(overrides: Partial<NavigationRecordedEvent> = {}): NavigationRecordedEvent {
  return {
    eventId: 'evt-nav-001',
    eventType: 'navigation',
    timestamp: '2026-07-21T12:00:03.000Z',
    url: 'https://example.com/page2',
    title: 'Page 2',
    ...overrides,
  };
}

function makeInteraction(
  type: string,
  eventIds: string[],
  target?: ElementIdentity,
  confidence = 0.95,
): DetectedInteraction {
  return {
    interactionId: `interaction-${eventIds[0]}`,
    type: type as any,
    eventIds,
    rawEventTypes: [],
    target,
    metadata: {},
    confidence,
    engine: 'v2',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('Milestone 6.2 — Domain Adapter', () => {
  describe('UiElement creation', () => {
    it('should create a UiElement for each unique element', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events);
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].elementId).toBe('elem-0001');
    });

    it('should deduplicate elements by elementId', () => {
      const identity = makeElementIdentity();
      const event1 = makeClickEvent({ eventId: 'evt-001' });
      const event2 = makeClickEvent({ eventId: 'evt-002', target: identity });
      const result = adaptToDomainEntities([event1, event2]);
      expect(result.elements).toHaveLength(1);
    });

    it('should populate identity from RecordedEvent.target', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events);
      const el = result.elements[0];
      expect(el.identity.elementId).toBe('elem-0001');
      expect(el.identity.tag).toBe('BUTTON');
      expect(el.identity.ariaRole).toBe('button');
      expect(el.identity.cssSelector).toBe('button#test-btn');
    });

    it('should populate domAttributes from DomContext', () => {
      const events = [makeInputEvent()];
      const result = adaptToDomainEntities(events);
      const el = result.elements[0];
      expect(el.domAttributes['type']).toBe('email');
      expect(el.domAttributes['required']).toBe('');
      expect(el.domAttributes['minlength']).toBe('5');
      expect(el.domAttributes['maxlength']).toBe('100');
    });

    it('should default domAttributes to empty object when no DomContext', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events);
      const el = result.elements[0];
      expect(el.domAttributes).toEqual({});
    });

    it('should populate sourceUrl from the provided argument', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events, [], 'https://example.com');
      expect(result.elements[0].sourceUrl).toBe('https://example.com');
    });

    it('should use fallback sourceUrl when not provided', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events);
      expect(result.elements[0].sourceUrl).toBe('about:blank');
    });

    it('should populate domTreePath from cssSelector', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events);
      expect(result.elements[0].domTreePath).toBe('button#test-btn');
    });

    it('should fall back to xPath when cssSelector is empty', () => {
      const event = makeClickEvent({
        target: makeElementIdentity({
          cssSelector: '',
          xPath: '//button[@id=\'test-btn\']',
        }),
      });
      const result = adaptToDomainEntities([event]);
      expect(result.elements[0].domTreePath).toBe('//button[@id=\'test-btn\']');
    });

    it('should derive intrinsicCapabilities from tag + role + inputType', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events);
      const caps = result.elements[0].intrinsicCapabilities;
      // Button should have CLICK, FOCUS, HOVER
      expect(caps).toContain(IntrinsicCapability.CLICK);
      expect(caps).toContain(IntrinsicCapability.FOCUS);
      expect(caps).toContain(IntrinsicCapability.HOVER);
    });

    it('should derive capabilities for text input from domAttributes type', () => {
      const events = [makeInputEvent()];
      const result = adaptToDomainEntities(events);
      const caps = result.elements[0].intrinsicCapabilities;
      // Input with type=email should have ACCEPT_TEXT, FOCUS, HOVER
      expect(caps).toContain(IntrinsicCapability.ACCEPT_TEXT);
      expect(caps).toContain(IntrinsicCapability.FOCUS);
    });

    it('should set componentId and componentRole to null for ungrouped elements', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events);
      expect(result.elements[0].componentId).toBeNull();
      expect(result.elements[0].componentRole).toBeNull();
    });
  });

  describe('ObservedTransition creation', () => {
    it('should create a transition for each classified event', () => {
      const events = [makeClickEvent()];
      const interactions = [makeInteraction('Click', ['evt-001'])];
      const result = adaptToDomainEntities(events, interactions);
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0].transitionId).toBe('evt-001');
    });

    it('should create a transition even without DetectedInteractions', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events, []);
      expect(result.transitions).toHaveLength(1);
    });

    it('should map Click interaction to CLICK operation', () => {
      const events = [makeClickEvent()];
      const interactions = [makeInteraction('Click', ['evt-001'])];
      const result = adaptToDomainEntities(events, interactions);
      expect(result.transitions[0].operation).toBe(TransitionOperation.CLICK);
    });

    it('should map TextEntry interaction to FILL operation', () => {
      const events = [makeInputEvent()];
      const interactions = [makeInteraction('TextEntry', ['evt-002'])];
      const result = adaptToDomainEntities(events, interactions);
      expect(result.transitions[0].operation).toBe(TransitionOperation.FILL);
    });

    it('should map Checkbox interaction to TOGGLE operation', () => {
      const events = [makeCheckboxEvent()];
      const interactions = [makeInteraction('Checkbox', ['evt-003'])];
      const result = adaptToDomainEntities(events, interactions);
      expect(result.transitions[0].operation).toBe(TransitionOperation.TOGGLE);
    });

    it('should map NativeDropdown interaction to SELECT operation', () => {
      const identity = makeElementIdentity({ elementId: 'elem-004', tag: 'SELECT', ariaRole: 'combobox' });
      const event = makeClickEvent({
        eventId: 'evt-004',
        target: identity,
        valueBefore: 'option1',
        valueAfter: 'option2',
      });
      const interactions = [makeInteraction('NativeDropdown', ['evt-004'], identity)];
      const result = adaptToDomainEntities([event], interactions);
      expect(result.transitions[0].operation).toBe(TransitionOperation.SELECT);
    });

    it('should map DatePicker interaction to SELECT_DATE operation', () => {
      const identity = makeElementIdentity({ elementId: 'elem-005', tag: 'INPUT', ariaRole: null });
      const event = makeClickEvent({
        eventId: 'evt-005',
        target: identity,
      });
      const interactions = [makeInteraction('DatePicker', ['evt-005'], identity)];
      const result = adaptToDomainEntities([event], interactions);
      expect(result.transitions[0].operation).toBe(TransitionOperation.SELECT_DATE);
    });

    it('should map Hover interaction to HOVER operation', () => {
      const event = makeClickEvent({ eventId: 'evt-006', eventType: 'mouseenter' });
      const interactions = [makeInteraction('Hover', ['evt-006'])];
      const result = adaptToDomainEntities([event], interactions);
      expect(result.transitions[0].operation).toBe(TransitionOperation.HOVER);
    });

    it('should map PageNavigation interaction to NAVIGATE operation', () => {
      const navEvent = makeNavigationEvent();
      const result = adaptToDomainEntities([navEvent]);
      expect(result.transitions[0].operation).toBe(TransitionOperation.NAVIGATE);
    });

    it('should infer FILL from raw input event when no interaction classified', () => {
      const event = makeInputEvent();
      const result = adaptToDomainEntities([event], []);
      expect(result.transitions[0].operation).toBe(TransitionOperation.FILL);
    });

    it('should default to CLICK for unclassified events', () => {
      const event = makeClickEvent();
      const result = adaptToDomainEntities([event], []);
      expect(result.transitions[0].operation).toBe(TransitionOperation.CLICK);
    });
  });

  describe('Relevance classification', () => {
    it('should mark classified events as DELIBERATE', () => {
      const events = [makeClickEvent()];
      const interactions = [makeInteraction('Click', ['evt-001'])];
      const result = adaptToDomainEntities(events, interactions);
      expect(result.transitions[0].relevance).toBe(RelevanceLevel.DELIBERATE);
    });

    it('should mark unclassified click events as SUPPORTING', () => {
      const events = [makeClickEvent()];
      const result = adaptToDomainEntities(events, []);
      expect(result.transitions[0].relevance).toBe(RelevanceLevel.SUPPORTING);
    });

    it('should mark scroll events as NOISE and skip them', () => {
      const event = makeClickEvent({ eventId: 'evt-scroll', eventType: 'scroll' });
      const result = adaptToDomainEntities([event], []);
      expect(result.transitions).toHaveLength(0);
    });

    it('should mark focus events as NOISE and skip them', () => {
      const event = makeClickEvent({ eventId: 'evt-focus', eventType: 'focus' });
      const result = adaptToDomainEntities([event], []);
      expect(result.transitions).toHaveLength(0);
    });

    it('should mark blur events as NOISE and skip them', () => {
      const event = makeClickEvent({ eventId: 'evt-blur', eventType: 'blur' });
      const result = adaptToDomainEntities([event], []);
      expect(result.transitions).toHaveLength(0);
    });
  });

  describe('Element state', () => {
    it('should populate stateBefore and stateAfter from value snapshots', () => {
      const event = makeInputEvent({ valueBefore: '', valueAfter: 'hello' });
      const result = adaptToDomainEntities([event], []);
      const t = result.transitions[0];
      expect(t.stateBefore.value).toBe('');
      expect(t.stateAfter.value).toBe('hello');
    });

    it('should populate checked state in transitions', () => {
      const event = makeCheckboxEvent();
      const result = adaptToDomainEntities([event], []);
      const t = result.transitions[0];
      expect(t.stateBefore.checked).toBe(false);
      expect(t.stateAfter.checked).toBe(true);
    });

    it('should populate expanded state from domContext.ariaExpanded', () => {
      const event = makeClickEvent({
        domContext: {
          inputType: null,
          ariaExpanded: true,
          ariaHasPopup: 'listbox',
          isContentEditable: false,
        },
      });
      const result = adaptToDomainEntities([event], []);
      const t = result.transitions[0];
      expect(t.stateBefore.expanded).toBe(true);
      expect(t.stateAfter.expanded).toBeNull();
    });

    it('should have null selected state (not captured by recorder)', () => {
      const event = makeClickEvent();
      const result = adaptToDomainEntities([event], []);
      const t = result.transitions[0];
      expect(t.stateBefore.selected).toBeNull();
      expect(t.stateAfter.selected).toBeNull();
    });
  });

  describe('Evidence', () => {
    it('should create VALUE_CHANGE evidence for value changes', () => {
      const event = makeInputEvent({ valueBefore: 'old', valueAfter: 'new' });
      const result = adaptToDomainEntities([event], []);
      const evidence = result.transitions[0].evidence;
      const valueEvidence = evidence.find(e => e.type === TransitionEvidenceType.VALUE_CHANGE);
      expect(valueEvidence).toBeDefined();
      expect(valueEvidence!.before).toBe('old');
      expect(valueEvidence!.after).toBe('new');
    });

    it('should create STATE_CHANGE evidence for checked changes', () => {
      const event = makeCheckboxEvent();
      const result = adaptToDomainEntities([event], []);
      const evidence = result.transitions[0].evidence;
      const stateEvidence = evidence.find(e => e.type === TransitionEvidenceType.STATE_CHANGE);
      expect(stateEvidence).toBeDefined();
      expect(stateEvidence!.before).toBe('false');
      expect(stateEvidence!.after).toBe('true');
    });

    it('should have empty evidence for plain clicks with no state change', () => {
      const event = makeClickEvent();
      const result = adaptToDomainEntities([event], []);
      expect(result.transitions[0].evidence).toHaveLength(0);
    });

    it('should have empty cascadeEffects (not captured by recorder)', () => {
      const event = makeClickEvent();
      const result = adaptToDomainEntities([event], []);
      expect(result.transitions[0].cascadeEffects).toHaveLength(0);
    });

    it('should have null validationResult (not captured by recorder)', () => {
      const event = makeClickEvent();
      const result = adaptToDomainEntities([event], []);
      expect(result.transitions[0].validationResult).toBeNull();
    });
  });

  describe('Navigation events', () => {
    it('should create a navigation transition with NAVIGATE operation', () => {
      const navEvent = makeNavigationEvent();
      const result = adaptToDomainEntities([navEvent]);
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0].operation).toBe(TransitionOperation.NAVIGATE);
      expect(result.transitions[0].elementId).toBe('__page__');
    });

    it('should create navigation evidence with the target URL', () => {
      const navEvent = makeNavigationEvent();
      const result = adaptToDomainEntities([navEvent]);
      const evidence = result.transitions[0].evidence;
      expect(evidence).toHaveLength(1);
      expect(evidence[0].type).toBe(TransitionEvidenceType.NAVIGATION);
      expect(evidence[0].after).toBe('https://example.com/page2');
    });

    it('should not create a UiElement for navigation events', () => {
      const navEvent = makeNavigationEvent();
      const result = adaptToDomainEntities([navEvent]);
      expect(result.elements).toHaveLength(0);
    });
  });

  describe('Mixed scenarios', () => {
    it('should handle a mixed session with clicks, inputs, and navigation', () => {
      const events: RecordedEvent[] = [
        makeClickEvent({ eventId: 'evt-001' }),
        makeInputEvent({ eventId: 'evt-002' }),
        makeCheckboxEvent({ eventId: 'evt-003' }),
        makeNavigationEvent({ eventId: 'evt-004' }),
      ];
      const interactions: DetectedInteraction[] = [
        makeInteraction('Click', ['evt-001']),
        makeInteraction('TextEntry', ['evt-002']),
        makeInteraction('Checkbox', ['evt-003']),
      ];
      const result = adaptToDomainEntities(events, interactions, 'https://example.com');

      // 3 elements (click target, input target, checkbox target) — no element for navigation
      expect(result.elements).toHaveLength(3);
      // 4 transitions (3 element + 1 navigation)
      expect(result.transitions).toHaveLength(4);

      // Verify operations
      expect(result.transitions[0].operation).toBe(TransitionOperation.CLICK);
      expect(result.transitions[1].operation).toBe(TransitionOperation.FILL);
      expect(result.transitions[2].operation).toBe(TransitionOperation.TOGGLE);
      expect(result.transitions[3].operation).toBe(TransitionOperation.NAVIGATE);

      // All element sources should use the provided URL
      for (const el of result.elements) {
        expect(el.sourceUrl).toBe('https://example.com');
      }
    });

    it('should handle an empty session gracefully', () => {
      const result = adaptToDomainEntities([], []);
      expect(result.elements).toHaveLength(0);
      expect(result.transitions).toHaveLength(0);
    });

    it('should handle events with no interactions provided', () => {
      const events: RecordedEvent[] = [
        makeClickEvent({ eventId: 'evt-001' }),
        makeInputEvent({ eventId: 'evt-002' }),
      ];
      const result = adaptToDomainEntities(events, []);
      expect(result.elements).toHaveLength(2);
      expect(result.transitions).toHaveLength(2);
      // Without interactions, click is SUPPORTING, input is FILL (inferred)
      expect(result.transitions[0].relevance).toBe(RelevanceLevel.SUPPORTING);
      expect(result.transitions[1].operation).toBe(TransitionOperation.FILL);
    });

    it('should handle multiple events on the same element (deduplication)', () => {
      const identity = makeElementIdentity({ elementId: 'elem-001' });
      const events: RecordedEvent[] = [
        makeClickEvent({ eventId: 'evt-001', target: identity }),
        makeClickEvent({ eventId: 'evt-002', target: identity, eventType: 'click' }),
        makeClickEvent({ eventId: 'evt-003', target: identity, eventType: 'click' }),
      ];
      const result = adaptToDomainEntities(events, []);
      expect(result.elements).toHaveLength(1);
      expect(result.transitions).toHaveLength(3);
    });

    it('should preserve timestamp ordering from events', () => {
      const events: RecordedEvent[] = [
        makeClickEvent({ eventId: 'evt-001', timestamp: '2026-07-21T12:00:00.000Z' }),
        makeInputEvent({ eventId: 'evt-002', timestamp: '2026-07-21T12:00:01.000Z' }),
        makeCheckboxEvent({ eventId: 'evt-003', timestamp: '2026-07-21T12:00:02.000Z' }),
      ];
      const result = adaptToDomainEntities(events, []);
      expect(result.transitions[0].timestamp).toBeLessThan(result.transitions[1].timestamp);
      expect(result.transitions[1].timestamp).toBeLessThan(result.transitions[2].timestamp);
    });
  });

  describe('Interaction-to-operation mapping coverage', () => {
    const mappingCases: [string, TransitionOperation][] = [
      ['Click', TransitionOperation.CLICK],
      ['DoubleClick', TransitionOperation.CLICK],
      ['RightClick', TransitionOperation.CLICK],
      ['TextEntry', TransitionOperation.FILL],
      ['Checkbox', TransitionOperation.TOGGLE],
      ['ToggleSwitch', TransitionOperation.TOGGLE],
      ['RadioButton', TransitionOperation.TOGGLE],
      ['NativeDropdown', TransitionOperation.SELECT],
      ['CustomDropdown', TransitionOperation.SELECT],
      ['Autocomplete', TransitionOperation.SELECT],
      ['MultiSelect', TransitionOperation.SELECT],
      ['DatePicker', TransitionOperation.SELECT_DATE],
      ['TimePicker', TransitionOperation.SELECT_DATE],
      ['DateTimePicker', TransitionOperation.SELECT_DATE],
      ['Hover', TransitionOperation.HOVER],
      ['PageNavigation', TransitionOperation.NAVIGATE],
      ['Back', TransitionOperation.NAVIGATE],
      ['Forward', TransitionOperation.NAVIGATE],
      ['Refresh', TransitionOperation.NAVIGATE],
      ['Link', TransitionOperation.CLICK],
      ['Tab', TransitionOperation.CLICK],
      ['Menu', TransitionOperation.CLICK],
      ['Breadcrumb', TransitionOperation.CLICK],
      ['DragDrop', TransitionOperation.CLICK],
      ['FileUpload', TransitionOperation.CLICK],
      ['DragDropUpload', TransitionOperation.CLICK],
      ['Slider', TransitionOperation.CLICK],
      ['BrowserAlert', TransitionOperation.CLICK],
      ['Modal', TransitionOperation.CLICK],
      ['Drawer', TransitionOperation.CLICK],
      ['Popover', TransitionOperation.CLICK],
      ['Tooltip', TransitionOperation.CLICK],
      ['NewTab', TransitionOperation.CLICK],
      ['NewWindow', TransitionOperation.CLICK],
      ['Iframe', TransitionOperation.CLICK],
    ];

    for (const [interactionType, expectedOp] of mappingCases) {
      it(`should map ${interactionType} to ${expectedOp}`, () => {
        const event = makeClickEvent({ eventId: `evt-${interactionType}` });
        const interaction = makeInteraction(interactionType, [`evt-${interactionType}`]);
        const result = adaptToDomainEntities([event], [interaction]);
        expect(result.transitions[0].operation).toBe(expectedOp);
      });
    }
  });

  describe('Edge cases', () => {
    it('should handle events where domContext is undefined', () => {
      const event = makeClickEvent();
      // No domContext set
      expect(event.domContext).toBeUndefined();
      const result = adaptToDomainEntities([event], []);
      expect(result.elements[0].domAttributes).toEqual({});
      expect(result.transitions[0].stateBefore.expanded).toBeNull();
    });

    it('should handle events with null values for before/after', () => {
      const event = makeClickEvent({ valueBefore: null, valueAfter: null });
      const result = adaptToDomainEntities([event], []);
      const t = result.transitions[0];
      expect(t.stateBefore.value).toBeNull();
      expect(t.stateAfter.value).toBeNull();
      expect(t.evidence).toHaveLength(0);
    });

    it('should handle same valueBefore and valueAfter (no change)', () => {
      const event = makeInputEvent({ valueBefore: 'same', valueAfter: 'same' });
      const result = adaptToDomainEntities([event], []);
      const valueEvidence = result.transitions[0].evidence.find(
        e => e.type === TransitionEvidenceType.VALUE_CHANGE,
      );
      expect(valueEvidence).toBeUndefined();
    });

    it('should handle contextmenu events', () => {
      const event = makeClickEvent({ eventId: 'evt-ctx', eventType: 'contextmenu' });
      const interactions = [makeInteraction('RightClick', ['evt-ctx'])];
      const result = adaptToDomainEntities([event], interactions);
      expect(result.transitions[0].operation).toBe(TransitionOperation.CLICK);
      expect(result.transitions[0].relevance).toBe(RelevanceLevel.DELIBERATE);
    });
  });
});
