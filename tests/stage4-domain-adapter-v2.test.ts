/**
 * Stage 4 — Domain Adapter V2 (Interaction-Centric) Tests
 *
 * Tests that the new domain adapter:
 * - Creates 1 transition per interaction (not per event)
 * - Maps interaction types to correct TransitionOperations
 * - Extracts state from interaction metadata
 * - Produces UiElements with correct identity
 * - Builds meaningful evidence descriptions
 * - Is compatible with the healing service (UiElement.identity)
 *
 * Migrated from DetectedInteraction → ComponentInteraction.
 */

import { describe, it, expect } from 'vitest';
import { adaptToDomainEntitiesV2 } from '../src/recorder/pipeline/domain-adapter-v2';
import type { ComponentInteraction } from '../src/shared/component-types';
import type { ObservedEvent } from '../src/shared/component-types';
import type { RecordedEvent, ElementRecordedEvent } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';
import { TransitionOperation, RelevanceLevel, TransitionEvidenceType } from '../src/domain/enums';

// ── Helpers ──────────────────────────────────────────────────────────────

let eventCounter = 0;

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
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
    elementId: `elem-${String(++eventCounter).padStart(4, '0')}`,
    ...overrides,
  };
}

function makeEvent(
  eventType: string,
  target: ElementIdentity,
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: eventType as ElementRecordedEvent['eventType'],
    timestamp: new Date(Date.now() + eventCounter * 1000).toISOString(),
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 0,
    clientY: 0,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test Page',
    domContext: {},
    isTrusted: true,
    ...overrides,
  };
}

/**
 * Build a minimal ObservedEvent with a specific event ID.
 * Used as memberEvents in ComponentInteraction.
 */
function makeObservedEventWithId(eventId: string, target: ElementIdentity): ObservedEvent {
  return {
    eventId,
    eventType: 'click',
    timestamp: Date.now(),
    isTrusted: true,
    target,
    domContext: {},
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 0,
    clientY: 0,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test Page',
  };
}

// ── Classifier type → Component type reverse mapping ────────────────────

const CLASSIFIER_TO_COMPONENT: Record<string, string> = {
  Click: 'Click', DoubleClick: 'Click', RightClick: 'Click',
  TextEntry: 'TextEntry',
  NativeDropdown: 'Dropdown', CustomDropdown: 'Dropdown',
  Autocomplete: 'Dropdown', MultiSelect: 'Dropdown',
  Checkbox: 'Checkbox', ToggleSwitch: 'Checkbox',
  RadioButton: 'RadioButton',
  DatePicker: 'DatePicker', TimePicker: 'DatePicker', DateTimePicker: 'DatePicker',
  Hover: 'Hover', Link: 'Link', FileUpload: 'FileUpload',
  Slider: 'Slider', PageNavigation: 'Navigation',
  DragDrop: 'DragDrop', Unknown: 'Click',
};

function makeInteraction(
  type: string,
  target: ElementIdentity | undefined,
  eventIds: string[],
  metadata: Record<string, unknown> = {},
): ComponentInteraction {
  const componentType = CLASSIFIER_TO_COMPONENT[type] ?? 'Click';
  const isSubtype = type !== componentType;
  const trigger = target ?? makeIdentity();
  const memberEvents: ObservedEvent[] = eventIds.map(id => makeObservedEventWithId(id, trigger));

  return {
    interactionId: `ctrl-${String(++eventCounter).padStart(4, '0')}`,
    type: componentType as ComponentInteraction['type'],
    ...(isSubtype ? { interactionSubtype: type } : {}),
    trigger,
    triggerEvent: memberEvents[0] ?? makeObservedEventWithId('evt-fallback', trigger),
    memberEvents,
    startTime: Date.now(),
    endTime: Date.now(),
    endState: 'completed',
    metadata,
  };
}

function resetCounter(): void {
  eventCounter = 0;
}

// ════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════

describe('DomainAdapterV2', () => {

  describe('Transition Count — 1 Per Interaction', () => {
    it('produces exactly 1 transition for a TextEntry interaction (not 4 for focus/input/change/blur)', () => {
      resetCounter();
      const input = makeIdentity({ accessibleName: 'First Name', ariaRole: 'textbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [
        makeEvent('focus', input, { valueBefore: '' }),
        makeEvent('input', input, { valueAfter: 'John' }),
        makeEvent('change', input, { valueAfter: 'John' }),
        makeEvent('blur', input, { valueAfter: 'John' }),
      ];
      const interaction = makeInteraction('TextEntry', input,
        events.map((e) => e.eventId),
        { textValue: 'John' },
      );

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions).toHaveLength(1);
      expect(result.elements).toHaveLength(1);
    });

    it('produces 1 transition for a Click interaction', () => {
      resetCounter();
      const btn = makeIdentity({ accessibleName: 'Save', ariaRole: 'button', tag: 'BUTTON' });
      const events: RecordedEvent[] = [makeEvent('click', btn)];
      const interaction = makeInteraction('Click', btn, events.map((e) => e.eventId), { accessibleName: 'Save' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions).toHaveLength(1);
    });

    it('produces correct count for multi-interaction session', () => {
      resetCounter();
      const input1 = makeIdentity({ accessibleName: 'Email', ariaRole: 'textbox', tag: 'INPUT' });
      const input2 = makeIdentity({ accessibleName: 'Password', ariaRole: 'textbox', tag: 'INPUT' });
      const btn = makeIdentity({ accessibleName: 'Login', ariaRole: 'button', tag: 'BUTTON' });

      const events: RecordedEvent[] = [
        makeEvent('focus', input1),
        makeEvent('input', input1, { valueAfter: 'test@test.com' }),
        makeEvent('blur', input1, { valueAfter: 'test@test.com' }),
        makeEvent('focus', input2),
        makeEvent('input', input2, { valueAfter: 'pass123' }),
        makeEvent('blur', input2, { valueAfter: 'pass123' }),
        makeEvent('click', btn),
      ];

      const interactions: ComponentInteraction[] = [
        makeInteraction('TextEntry', input1, events.slice(0, 3).map((e) => e.eventId), { textValue: 'test@test.com' }),
        makeInteraction('TextEntry', input2, events.slice(3, 6).map((e) => e.eventId), { textValue: 'pass123' }),
        makeInteraction('Click', btn, events.slice(6).map((e) => e.eventId)),
      ];

      const result = adaptToDomainEntitiesV2(events, interactions, 'https://example.com');
      expect(result.transitions).toHaveLength(3);
      expect(result.elements).toHaveLength(3); // email, password, login
    });
  });

  describe('Operation Mapping', () => {
    const testCases: Array<[string, TransitionOperation]> = [
      ['TextEntry', TransitionOperation.FILL],
      ['Checkbox', TransitionOperation.TOGGLE],
      ['ToggleSwitch', TransitionOperation.TOGGLE],
      ['RadioButton', TransitionOperation.TOGGLE],
      ['NativeDropdown', TransitionOperation.SELECT],
      ['CustomDropdown', TransitionOperation.SELECT],
      ['DatePicker', TransitionOperation.SELECT_DATE],
      ['TimePicker', TransitionOperation.SELECT_DATE],
      ['DateTimePicker', TransitionOperation.SELECT_DATE],
      ['Hover', TransitionOperation.HOVER],
      ['PageNavigation', TransitionOperation.NAVIGATE],
      ['Click', TransitionOperation.CLICK],
      ['Link', TransitionOperation.CLICK],
    ];

    for (const [type, expectedOp] of testCases) {
      it(`maps ${type} → ${expectedOp}`, () => {
        resetCounter();
        const target = makeIdentity({ tag: 'INPUT', ariaRole: 'textbox' });
        const events: RecordedEvent[] = [makeEvent('click', target)];
        const interaction = makeInteraction(type, target, events.map((e) => e.eventId));

        const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
        expect(result.transitions[0].operation).toBe(expectedOp);
      });
    }
  });

  describe('State Extraction', () => {
    it('extracts textValue as state after for TextEntry', () => {
      resetCounter();
      const input = makeIdentity({ accessibleName: 'Name', ariaRole: 'textbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [
        makeEvent('focus', input, { valueBefore: '' }),
        makeEvent('blur', input, { valueAfter: 'John' }),
      ];
      const interaction = makeInteraction('TextEntry', input, events.map((e) => e.eventId), { textValue: 'John' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].stateAfter.value).toBe('John');
    });

    it('extracts checked state for Checkbox', () => {
      resetCounter();
      const checkbox = makeIdentity({ accessibleName: 'Subscribe', ariaRole: 'checkbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [makeEvent('click', checkbox, { checkedBefore: false, checkedAfter: true })];
      const interaction = makeInteraction('Checkbox', checkbox, events.map((e) => e.eventId), { checked: true });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].stateAfter.checked).toBe(true);
    });

    it('extracts selectedValue as state after for dropdowns', () => {
      resetCounter();
      const select = makeIdentity({ accessibleName: 'Country', tag: 'SELECT', ariaRole: 'listbox' });
      const events: RecordedEvent[] = [makeEvent('change', select, { valueAfter: 'US' })];
      const interaction = makeInteraction('NativeDropdown', select, events.map((e) => e.eventId), { selectedValue: 'US' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].stateAfter.value).toBe('US');
    });

    it('extracts dateValue for DatePicker', () => {
      resetCounter();
      const dateInput = makeIdentity({ accessibleName: 'DOB', tag: 'INPUT' });
      const events: RecordedEvent[] = [makeEvent('change', dateInput, { valueAfter: '1990-05-15' })];
      const interaction = makeInteraction('DatePicker', dateInput, events.map((e) => e.eventId), { dateValue: '1990-05-15' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].stateAfter.value).toBe('1990-05-15');
    });

    it('extracts sliderValue for Slider', () => {
      resetCounter();
      const slider = makeIdentity({ accessibleName: 'Volume', ariaRole: 'slider', tag: 'INPUT' });
      const events: RecordedEvent[] = [makeEvent('change', slider, { valueAfter: '75' })];
      const interaction = makeInteraction('Slider', slider, events.map((e) => e.eventId), { sliderValue: '75' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].stateAfter.value).toBe('75');
    });

    it('extracts stateBefore from the first event', () => {
      resetCounter();
      const input = makeIdentity({ accessibleName: 'Name', ariaRole: 'textbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [
        makeEvent('focus', input, { valueBefore: 'OldValue' }),
        makeEvent('blur', input, { valueAfter: 'NewValue' }),
      ];
      const interaction = makeInteraction('TextEntry', input, events.map((e) => e.eventId), { textValue: 'NewValue' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].stateBefore.value).toBe('OldValue');
    });
  });

  describe('UiElement Creation', () => {
    it('creates UiElement with correct identity', () => {
      resetCounter();
      const target = makeIdentity({
        accessibleName: 'Email',
        ariaRole: 'textbox',
        tag: 'INPUT',
        cssSelector: 'input#email',
        stableId: 'email',
      });
      const events: RecordedEvent[] = [makeEvent('click', target)];
      const interaction = makeInteraction('Click', target, events.map((e) => e.eventId));

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.elements).toHaveLength(1);
      expect(result.elements[0].identity.accessibleName).toBe('Email');
      expect(result.elements[0].identity.ariaRole).toBe('textbox');
      expect(result.elements[0].elementId).toBe(target.elementId);
      expect(result.elements[0].sourceUrl).toBe('https://example.com');
    });

    it('deduplicates elements by elementId', () => {
      resetCounter();
      const target = makeIdentity({ accessibleName: 'Save', tag: 'BUTTON', ariaRole: 'button' });
      const events: RecordedEvent[] = [makeEvent('click', target), makeEvent('click', target)];
      const interactions: ComponentInteraction[] = [
        makeInteraction('Click', target, [events[0].eventId]),
        makeInteraction('Click', target, [events[1].eventId]),
      ];

      const result = adaptToDomainEntitiesV2(events, interactions, 'https://example.com');
      expect(result.elements).toHaveLength(1); // Deduplicated
      expect(result.transitions).toHaveLength(2); // Two separate clicks
    });

    it('sets domTreePath from cssSelector', () => {
      resetCounter();
      const target = makeIdentity({ tag: 'INPUT', cssSelector: 'div.form>input#name' });
      const events: RecordedEvent[] = [makeEvent('click', target)];
      const interaction = makeInteraction('Click', target, events.map((e) => e.eventId));

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.elements[0].domTreePath).toBe('div.form>input#name');
    });

    it('extracts domAttributes from events', () => {
      resetCounter();
      const target = makeIdentity({ tag: 'INPUT', ariaRole: 'textbox' });
      const events: RecordedEvent[] = [
        makeEvent('click', target, {
          domContext: {
            domAttributes: { type: 'email', required: 'true' },
            isContentEditable: false,
            inputType: 'email',
          },
        }),
      ];
      const interaction = makeInteraction('TextEntry', target, events.map((e) => e.eventId));

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.elements[0].domAttributes['type']).toBe('email');
      expect(result.elements[0].domAttributes['required']).toBe('true');
    });
  });

  describe('Evidence', () => {
    it('builds evidence with value change description', () => {
      resetCounter();
      const input = makeIdentity({ accessibleName: 'Name', ariaRole: 'textbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [
        makeEvent('focus', input, { valueBefore: '' }),
        makeEvent('blur', input, { valueAfter: 'John' }),
      ];
      const interaction = makeInteraction('TextEntry', input, events.map((e) => e.eventId), { textValue: 'John' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].evidence.length).toBeGreaterThanOrEqual(1);
      expect(result.transitions[0].evidence[0].type).toBe(TransitionEvidenceType.VALUE_CHANGE);
      expect(result.transitions[0].evidence[0].after).toBe('John');
    });

    it('builds evidence with checked state change', () => {
      resetCounter();
      const checkbox = makeIdentity({ accessibleName: 'Subscribe', ariaRole: 'checkbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [makeEvent('click', checkbox, { checkedBefore: false, checkedAfter: true })];
      const interaction = makeInteraction('Checkbox', checkbox, events.map((e) => e.eventId), { checked: true });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      const stateEvidence = result.transitions[0].evidence.find((e) => e.type === TransitionEvidenceType.STATE_CHANGE);
      expect(stateEvidence).toBeDefined();
      expect(stateEvidence?.after).toBe('true');
    });

    it('builds navigation evidence', () => {
      resetCounter();
      const navEvents: RecordedEvent[] = [{
        eventId: 'evt-0001',
        eventType: 'navigation',
        timestamp: new Date().toISOString(),
        url: 'https://example.com/page2',
        title: 'Page 2',
      } as RecordedEvent];
      const interaction = makeInteraction('PageNavigation', undefined, ['evt-0001'], { url: 'https://example.com/page2' });

      const result = adaptToDomainEntitiesV2(navEvents, [interaction], 'https://example.com');
      const navEvidence = result.transitions[0].evidence.find((e) => e.type === TransitionEvidenceType.NAVIGATION);
      expect(navEvidence).toBeDefined();
      expect(navEvidence?.after).toBe('https://example.com/page2');
    });

    it('always produces at least one evidence entry', () => {
      resetCounter();
      const btn = makeIdentity({ accessibleName: 'Submit', tag: 'BUTTON', ariaRole: 'button' });
      const events: RecordedEvent[] = [makeEvent('click', btn)];
      const interaction = makeInteraction('Click', btn, events.map((e) => e.eventId), { accessibleName: 'Submit' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].evidence.length).toBeGreaterThanOrEqual(1);
    });

    it('builds human-readable descriptions', () => {
      resetCounter();
      const input = makeIdentity({ accessibleName: 'First Name', ariaRole: 'textbox', tag: 'INPUT' });
      const events: RecordedEvent[] = [makeEvent('focus', input), makeEvent('blur', input, { valueAfter: 'John' })];
      const interaction = makeInteraction('TextEntry', input, events.map((e) => e.eventId), { textValue: 'John' });

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      const desc = result.transitions[0].evidence[0].description;
      expect(desc).toContain('John');
      expect(desc).toContain('First Name');
    });
  });

  describe('Navigation Interactions', () => {
    it('handles interactions without a target (navigation)', () => {
      resetCounter();
      const navEvents: RecordedEvent[] = [{
        eventId: 'evt-0001',
        eventType: 'navigation',
        timestamp: new Date().toISOString(),
        url: 'https://example.com/page2',
        title: 'Page 2',
      } as RecordedEvent];
      const interaction = makeInteraction('PageNavigation', undefined, ['evt-0001'], { url: 'https://example.com/page2' });

      const result = adaptToDomainEntitiesV2(navEvents, [interaction], 'https://example.com');
      expect(result.transitions).toHaveLength(1);
      expect(result.transitions[0].elementId).toBe('__page__');
      expect(result.transitions[0].operation).toBe(TransitionOperation.NAVIGATE);
      expect(result.elements).toHaveLength(0); // No element for navigation
    });
  });

  describe('Relevance', () => {
    it('marks all interactions as DELIBERATE', () => {
      resetCounter();
      const btn = makeIdentity({ accessibleName: 'Submit', tag: 'BUTTON', ariaRole: 'button' });
      const events: RecordedEvent[] = [makeEvent('click', btn)];
      const interaction = makeInteraction('Click', btn, events.map((e) => e.eventId));

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].relevance).toBe(RelevanceLevel.DELIBERATE);
    });
  });

  describe('Healing Service Compatibility', () => {
    it('produces UiElements with identity suitable for locator ranking', () => {
      resetCounter();
      const target = makeIdentity({
        accessibleName: 'Email',
        ariaRole: 'textbox',
        tag: 'INPUT',
        cssSelector: 'input#email',
        stableId: 'email',
        testId: 'email-field',
        dataCy: 'email-input',
        name: 'email',
        className: 'form-input',
        xPath: '/html/body/div/form/input[@id="email"]',
      });
      const events: RecordedEvent[] = [makeEvent('click', target)];
      const interaction = makeInteraction('Click', target, events.map((e) => e.eventId));

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      const element = result.elements[0];
      // The healing service uses extractCandidatesFromIdentity() which reads these fields
      expect(element.identity.cssSelector).toBeTruthy();
      expect(element.identity.xPath).toBeTruthy();
      expect(element.identity.stableId).toBeTruthy();
      expect(element.identity.testId).toBeTruthy();
      expect(element.identity.name).toBeTruthy();
      expect(element.identity.tag).toBeTruthy();
    });
  });

  describe('OrangeHRM 9-Step Workflow', () => {
    it('produces 9 domain transitions from the 9-step workflow', () => {
      resetCounter();
      const ts = Date.now();

      // Create events (simplified — just enough for "before" state lookup)
      const events: RecordedEvent[] = [];
      const interactions: ComponentInteraction[] = [];

      // 1. Navigation
      const navEvent = { eventId: `evt-${String(++eventCounter).padStart(4, '0')}`, eventType: 'navigation' as const, timestamp: new Date(ts).toISOString(), url: 'https://orange.test/dashboard', title: 'Dashboard' };
      events.push(navEvent as RecordedEvent);
      interactions.push(makeInteraction('PageNavigation', undefined, [navEvent.eventId], { url: navEvent.url }));

      // 2. Navigation
      const navEvent2 = { eventId: `evt-${String(++eventCounter).padStart(4, '0')}`, eventType: 'navigation' as const, timestamp: new Date(ts + 2000).toISOString(), url: 'https://orange.test/my-info', title: 'My Info' };
      events.push(navEvent2 as RecordedEvent);
      interactions.push(makeInteraction('PageNavigation', undefined, [navEvent2.eventId], { url: navEvent2.url }));

      // 3. Edit First Name
      const firstName = makeIdentity({ accessibleName: 'First Name', ariaRole: 'textbox', tag: 'INPUT', elementId: 'elem-001' });
      const fnEvent = makeEvent('focus', firstName, { valueBefore: 'John' });
      events.push(fnEvent);
      interactions.push(makeInteraction('TextEntry', firstName, [fnEvent.eventId], { textValue: 'Jonathan' }));

      // 4. Edit Last Name
      const lastName = makeIdentity({ accessibleName: 'Last Name', ariaRole: 'textbox', tag: 'INPUT', elementId: 'elem-002' });
      const lnEvent = makeEvent('focus', lastName, { valueBefore: 'Doe' });
      events.push(lnEvent);
      interactions.push(makeInteraction('TextEntry', lastName, [lnEvent.eventId], { textValue: 'Smith' }));

      // 5. Select Nationality
      const nationality = makeIdentity({ accessibleName: 'Nationality', tag: 'SELECT', ariaRole: 'listbox', elementId: 'elem-003' });
      const natEvent = makeEvent('change', nationality, { valueAfter: 'American' });
      events.push(natEvent);
      interactions.push(makeInteraction('NativeDropdown', nationality, [natEvent.eventId], { selectedValue: 'American' }));

      // 6. Select Marital Status
      const marital = makeIdentity({ accessibleName: 'Marital Status', ariaRole: 'combobox', tag: 'DIV', elementId: 'elem-004' });
      const msEvent = makeEvent('click', marital, { valueAfter: 'Single' });
      events.push(msEvent);
      interactions.push(makeInteraction('CustomDropdown', marital, [msEvent.eventId], { selectedValue: 'Single' }));

      // 7. Select Gender = Female
      const female = makeIdentity({ accessibleName: 'Female', ariaRole: 'radio', tag: 'INPUT', elementId: 'elem-005' });
      const fEvent = makeEvent('click', female, { checkedAfter: true });
      events.push(fEvent);
      interactions.push(makeInteraction('RadioButton', female, [fEvent.eventId], { checked: true, selectedValue: 'Female' }));

      // 8. Select DOB
      const dob = makeIdentity({ accessibleName: 'Date of Birth', ariaRole: 'textbox', tag: 'INPUT', elementId: 'elem-006' });
      const dobEvent = makeEvent('change', dob, { valueAfter: '1990-05-15' });
      events.push(dobEvent);
      interactions.push(makeInteraction('DatePicker', dob, [dobEvent.eventId], { dateValue: '1990-05-15' }));

      // 9. Click Save
      const save = makeIdentity({ accessibleName: 'Save', ariaRole: 'button', tag: 'BUTTON', elementId: 'elem-007' });
      const saveEvent = makeEvent('click', save);
      events.push(saveEvent);
      interactions.push(makeInteraction('Click', save, [saveEvent.eventId]));

      // Run adapter
      const result = adaptToDomainEntitiesV2(events, interactions, 'https://orange.test');

      // Should produce 9 transitions
      expect(result.transitions).toHaveLength(9);

      // Verify operations
      const ops = result.transitions.map((t) => t.operation);
      expect(ops[0]).toBe(TransitionOperation.NAVIGATE);
      expect(ops[1]).toBe(TransitionOperation.NAVIGATE);
      expect(ops[2]).toBe(TransitionOperation.FILL);
      expect(ops[3]).toBe(TransitionOperation.FILL);
      expect(ops[4]).toBe(TransitionOperation.SELECT);
      expect(ops[5]).toBe(TransitionOperation.SELECT);
      expect(ops[6]).toBe(TransitionOperation.TOGGLE);
      expect(ops[7]).toBe(TransitionOperation.SELECT_DATE);
      expect(ops[8]).toBe(TransitionOperation.CLICK);

      // Verify elements (7 unique elements — 2 navigations have no element)
      expect(result.elements).toHaveLength(7);
    });
  });

  describe('Edge Cases', () => {
    it('handles empty interactions', () => {
      const result = adaptToDomainEntitiesV2([], [], 'https://example.com');
      expect(result.elements).toEqual([]);
      expect(result.transitions).toEqual([]);
    });

    it('handles interaction with no events', () => {
      resetCounter();
      const target = makeIdentity({ tag: 'BUTTON', ariaRole: 'button' });
      const interaction = makeInteraction('Click', target, []);

      const result = adaptToDomainEntitiesV2([], [interaction], 'https://example.com');
      expect(result.transitions).toHaveLength(1);
      // Should still produce a transition with a default timestamp
      expect(result.transitions[0].timestamp).toBeGreaterThan(0);
    });

    it('handles Unknown interaction type', () => {
      resetCounter();
      const target = makeIdentity({ tag: 'DIV' });
      const events: RecordedEvent[] = [makeEvent('blur', target)];
      const interaction = makeInteraction('Unknown', target, events.map((e) => e.eventId));

      const result = adaptToDomainEntitiesV2(events, [interaction], 'https://example.com');
      expect(result.transitions[0].operation).toBe(TransitionOperation.CLICK); // Default
    });
  });
});
