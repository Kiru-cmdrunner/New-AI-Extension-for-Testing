/**
 * Component-Aware Semantic Reasoning — Integration Tests
 *
 * Validates that the recorder produces semantically correct interactions
 * for real-world workflows on OrangeHRM and AdaniOne.
 *
 * These tests exercise the full pipeline:
 *   RecordedEvent[] → V1/V2 classify → merge → SemanticReasoner → output
 *
 * The goal: the output describes what the user ACCOMPLISHED, not which
 * browser events fired.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reasonAboutInteractions, resetSessionCounter } from '../src/classifier/semantic';
import type { DetectedInteraction } from '../src/classifier/interaction-types';
import type { SessionEvent } from '../src/shared/types';
import type { ElementIdentity } from '../src/shared/types';

// ── Test Helpers ─────────────────────────────────────────────────────────────

let eventCounter = 0;
let interactionCounter = 0;
let timeCounter = 0;

function resetCounters() {
  eventCounter = 0;
  interactionCounter = 0;
  timeCounter = 1000000; // base timestamp
}

const baseTarget: ElementIdentity = {
  accessibleName: '', ariaRole: '', ariaLabel: '', ariaLabelledBy: '',
  placeholder: '', tag: 'DIV', className: '', name: '', stableId: null,
  testId: null, dataCy: null, dataQa: null, cssSelector: '', xPath: '',
  inIframe: false, shadowDom: false, elementId: 'el-0',
};

function makeEvent(
  eventType: string,
  overrides: Partial<SessionEvent> = {},
): SessionEvent {
  const id = `evt-${String(++eventCounter).padStart(4, '0')}`;
  const ts = new Date(timeCounter).toISOString();
  timeCounter += 500; // 500ms between events
  return {
    actionId: id,
    eventType: eventType as SessionEvent['eventType'],
    timestamp: ts,
    ...overrides,
  } as SessionEvent;
}

function makeInteraction(
  overrides: Partial<DetectedInteraction> = {},
): DetectedInteraction {
  const id = `int-${String(++interactionCounter).padStart(4, '0')}`;
  return {
    interactionId: id,
    type: 'Click',
    eventIds: [],
    rawEventTypes: ['click'],
    target: { ...baseTarget },
    metadata: {},
    confidence: 0.9,
    engine: 'v2',
    ...overrides,
  };
}

function reason(
  interactions: DetectedInteraction[],
  events?: SessionEvent[],
): DetectedInteraction[] {
  const result = reasonAboutInteractions(interactions, events ?? []);
  return result.interactions;
}

// Get the output types as a simple string array for assertion
function types(output: DetectedInteraction[]): string[] {
  return output.map(i => i.type);
}

// ── OrangeHRM Tests ─────────────────────────────────────────────────────────

describe('OrangeHRM — Real-World Workflows', () => {

  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  describe('Login Workflow (FormSubmit enrichment)', () => {
    it('merges submit click + navigation into single PageNavigation', () => {
      const events = [
        makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
        makeEvent('navigation', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
      ];

      const interactions = [
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          rawEventTypes: ['click'],
          target: {
            ...baseTarget,
            tag: 'BUTTON',
            accessibleName: 'Login',
            ariaRole: 'button',
            typeAttribute: 'submit',
          },
          metadata: {},
        }),
        makeInteraction({
          type: 'PageNavigation',
          eventIds: ['evt-0002'],
          rawEventTypes: ['navigation'],
          metadata: {
            url: 'https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index',
            title: 'Dashboard',
          },
        }),
      ];

      const output = reason(interactions, events);

      // Login click should be merged with navigation
      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('PageNavigation');
      expect(output[0]!.metadata.url).toContain('/dashboard/index');
    });

    it('does not merge click + navigation when >3s apart', () => {
      const events = [
        makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
        makeEvent('navigation', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:05.000Z' }),
      ];

      const interactions = [
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: { ...baseTarget, tag: 'BUTTON', accessibleName: 'Login' },
        }),
        makeInteraction({
          type: 'PageNavigation',
          eventIds: ['evt-0002'],
          metadata: { url: 'https://example.com/dashboard' },
        }),
      ];

      const output = reason(interactions, events);

      // Should NOT merge — too far apart
      expect(output).toHaveLength(2);
      expect(output[0]!.type).toBe('Click');
      expect(output[1]!.type).toBe('PageNavigation');
    });
  });

  describe('Nationality Dropdown (component session)', () => {
    it('collapses trigger click + scroll + option click into one Select', () => {
      const events = [
        makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
        makeEvent('scroll', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
        makeEvent('click', { actionId: 'evt-0003', timestamp: '2026-07-28T10:00:02.000Z' }),
      ];

      const interactions = [
        // Click on dropdown trigger
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'DIV',
            className: 'oxd-select-text-input',
            accessibleName: '-- Select --',
            ariaRole: 'combobox',
          },
        }),
        // Scroll inside the dropdown
        makeInteraction({
          type: 'ContainerScroll',
          eventIds: ['evt-0002'],
          metadata: { scrollPosition: { x: 0, y: 100 } },
        }),
        // Click on "Belgian" option
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0003'],
          target: {
            ...baseTarget,
            tag: 'DIV',
            ariaRole: 'option',
            accessibleName: 'Belgian',
          },
        }),
      ];

      const output = reason(interactions, events);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('NativeDropdown');
      expect(output[0]!.metadata.selectedValue).toBe('Belgian');
      // Trigger target preserved for locator purposes
      expect(output[0]!.target?.accessibleName).toBe('-- Select --');
      // Scroll absorbed (not emitted)
      expect(types(output)).not.toContain('ContainerScroll');
    });

    it('passes trigger through when user dismisses without selecting', () => {
      const events = [
        makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
        makeEvent('click', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
      ];

      const interactions = [
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            className: 'oxd-select-text-input',
            ariaRole: 'combobox',
            accessibleName: '-- Select --',
          },
        }),
        // Click elsewhere (not an option)
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0002'],
          target: {
            ...baseTarget,
            tag: 'DIV',
            accessibleName: 'Personal Details',
          },
        }),
      ];

      const output = reason(interactions, events);

      // Trigger click should pass through (session times out or doesn't complete)
      // The second click is not an option, so the dropdown session stays pending
      // and eventually times out. In the test, we see both pass through.
      expect(output.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Date of Birth (date picker session)', () => {
    it('collapses date trigger + month nav + cell click into one DatePicker', () => {
      const events = [
        makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
        makeEvent('click', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
        makeEvent('click', { actionId: 'evt-0003', timestamp: '2026-07-28T10:00:02.000Z' }),
      ];

      const interactions = [
        // Click on date input (trigger)
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            className: 'oxd-date-input',
            placeholder: 'yyyy-dd-mm',
            accessibleName: 'yyyy-dd-mm',
          },
        }),
        // Click next month button (internal navigation)
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0002'],
          target: {
            ...baseTarget,
            tag: 'BUTTON',
            accessibleName: 'Next Month',
            className: 'oxd-date-calendar',
          },
        }),
        // Click day cell
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0003'],
          target: {
            ...baseTarget,
            ariaRole: 'gridcell',
            accessibleName: '2023-10-21',
          },
        }),
      ];

      const output = reason(interactions, events);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('DatePicker');
      expect(output[0]!.metadata.dateValue).toBe('2023-10-21');
      // Month nav absorbed
      expect(types(output)).not.toContain('Click');
    });

    it('handles dateSelect event as completion', () => {
      const interactions = [
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            className: 'oxd-date-input',
            placeholder: 'yyyy-dd-mm',
          },
        }),
        makeInteraction({
          type: 'DatePicker',
          eventIds: ['evt-0002'],
          metadata: { dateValue: '2023-10-21', displayValue: 'October 21, 2023' },
        }),
      ];

      const output = reason(interactions);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('DatePicker');
      expect(output[0]!.metadata.dateValue).toBe('2023-10-21');
    });
  });

  describe('Gender Radio Button (passthrough)', () => {
    it('passes radio button selection through unchanged', () => {
      const interactions = [
        makeInteraction({
          type: 'RadioButton',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            accessibleName: 'Female',
            ariaRole: 'radio',
          },
          metadata: { checked: true },
        }),
      ];

      const output = reason(interactions);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('RadioButton');
      expect(output[0]!.metadata.checked).toBe(true);
    });
  });

  describe('Text Entry (passthrough)', () => {
    it('passes text entry through with value', () => {
      const interactions = [
        makeInteraction({
          type: 'TextEntry',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            accessibleName: 'First Name',
            name: 'firstName',
          },
          metadata: { textValue: 'Kirubakaran' },
        }),
      ];

      const output = reason(interactions);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('TextEntry');
      expect(output[0]!.metadata.textValue).toBe('Kirubakaran');
    });
  });

  describe('Save Button (click passthrough)', () => {
    it('passes Save button click through unchanged', () => {
      const interactions = [
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'BUTTON',
            accessibleName: 'Save',
            typeAttribute: 'submit',
            className: 'oxd-button',
          },
        }),
      ];

      const output = reason(interactions);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('Click');
      expect(output[0]!.target?.accessibleName).toBe('Save');
    });
  });

  describe('Full My Info Workflow (end-to-end)', () => {
    it('produces semantically correct sequence for the full OrangeHRM workflow', () => {
      const events: SessionEvent[] = [];
      let t = 0;
      const ev = (eventType: string): SessionEvent => {
        const id = `evt-${String(eventCounter + 1).padStart(4, '0')}`;
        eventCounter++;
        const event = {
          actionId: id,
          eventType,
          timestamp: new Date(1000000 + t).toISOString(),
        } as SessionEvent;
        t += 1000;
        events.push(event);
        return event;
      };

      ev('navigation'); // 1: navigate to login page
      ev('focus');      // 2: username
      ev('blur');       // 3: username
      ev('focus');      // 4: password
      ev('blur');       // 5: password
      ev('click');      // 6: login
      ev('navigation'); // 7: dashboard
      ev('click');      // 8: My Info
      ev('navigation'); // 9: personal details
      ev('focus');      // 10: first name
      ev('blur');       // 11: first name
      ev('click');      // 12: nationality dropdown trigger
      ev('click');      // 13: nationality option
      ev('click');      // 14: date input
      ev('click');      // 15: calendar cell
      ev('click');      // 16: Save

      const interactions: DetectedInteraction[] = [
        makeInteraction({
          type: 'PageNavigation',
          eventIds: ['evt-0001'],
          metadata: { url: 'https://opensource-demo.orangehrmlive.com/web/index.php/auth/login' },
        }),
        makeInteraction({
          type: 'TextEntry',
          eventIds: ['evt-0002', 'evt-0003'],
          target: { ...baseTarget, tag: 'INPUT', accessibleName: 'Username', name: 'username' },
          metadata: { textValue: 'Admin' },
        }),
        makeInteraction({
          type: 'TextEntry',
          eventIds: ['evt-0004', 'evt-0005'],
          target: { ...baseTarget, tag: 'INPUT', accessibleName: 'Password', name: 'password', inputType: 'password' },
          metadata: { textValue: 'admin123' },
        }),
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0006'],
          target: { ...baseTarget, tag: 'BUTTON', accessibleName: 'Login', typeAttribute: 'submit' },
        }),
        makeInteraction({
          type: 'PageNavigation',
          eventIds: ['evt-0007'],
          metadata: { url: 'https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index' },
        }),
        makeInteraction({
          type: 'Link',
          eventIds: ['evt-0008'],
          target: { ...baseTarget, tag: 'A', accessibleName: 'My Info' },
        }),
        makeInteraction({
          type: 'PageNavigation',
          eventIds: ['evt-0009'],
          metadata: { url: 'https://opensource-demo.orangehrmlive.com/web/index.php/pim/viewPersonalDetails/empNumber/7' },
        }),
        makeInteraction({
          type: 'TextEntry',
          eventIds: ['evt-0010', 'evt-0011'],
          target: { ...baseTarget, tag: 'INPUT', accessibleName: 'First Name', name: 'firstName' },
          metadata: { textValue: 'Kirubakaran' },
        }),
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0012'],
          target: { ...baseTarget, tag: 'DIV', className: 'oxd-select-text-input', ariaRole: 'combobox', accessibleName: '-- Select --' },
        }),
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0013'],
          target: { ...baseTarget, tag: 'DIV', ariaRole: 'option', accessibleName: 'Belgian' },
        }),
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0014'],
          target: { ...baseTarget, tag: 'INPUT', className: 'oxd-date-input', placeholder: 'yyyy-dd-mm', accessibleName: 'yyyy-dd-mm' },
        }),
        makeInteraction({
          type: 'DatePicker',
          eventIds: ['evt-0015'],
          metadata: { dateValue: '2023-10-21' },
        }),
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0016'],
          target: { ...baseTarget, tag: 'BUTTON', accessibleName: 'Save', typeAttribute: 'submit' },
        }),
      ];

      const output = reason(interactions, events);

      // The semantic output should be significantly shorter than 13 raw interactions
      // due to session collapsing (dropdown, date picker, navigation merges)
      const semanticTypes = types(output);

      // Login click should merge with dashboard navigation
      expect(semanticTypes).not.toContain('Link'); // "My Info" link merged with nav

      // Dropdown collapsed to one NativeDropdown
      const dropdowns = output.filter(i => i.type === 'NativeDropdown');
      expect(dropdowns).toHaveLength(1);
      expect(dropdowns[0]!.metadata.selectedValue).toBe('Belgian');

      // Date picker collapsed to one DatePicker
      const datePickers = output.filter(i => i.type === 'DatePicker');
      expect(datePickers).toHaveLength(1);
      expect(datePickers[0]!.metadata.dateValue).toBe('2023-10-21');

      // Text entries passed through
      const textEntries = output.filter(i => i.type === 'TextEntry');
      expect(textEntries.length).toBeGreaterThanOrEqual(1);
      expect(textEntries.some(t => t.metadata.textValue === 'Kirubakaran')).toBe(true);
    });
  });
});

// ── AdaniOne Tests ──────────────────────────────────────────────────────────

describe('AdaniOne — Real-World Workflows', () => {

  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  describe('Flight Search — Basic Navigation', () => {
    it('merges link clicks with navigation', () => {
      const events = [
        makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
        makeEvent('navigation', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
      ];

      const interactions = [
        makeInteraction({
          type: 'Link',
          eventIds: ['evt-0001'],
          target: { ...baseTarget, tag: 'A', accessibleName: 'Book Flight' },
        }),
        makeInteraction({
          type: 'PageNavigation',
          eventIds: ['evt-0002'],
          metadata: { url: 'https://www.adanione.com/flight/search' },
        }),
      ];

      const output = reason(interactions, events);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('PageNavigation');
      expect(output[0]!.metadata.url).toContain('/flight/search');
    });
  });

  describe('Cabin Class Radio Selection', () => {
    it('passes radio button selection through', () => {
      const interactions = [
        makeInteraction({
          type: 'RadioButton',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            accessibleName: 'Economy',
            ariaRole: 'radio',
            className: 'cabin-class-option',
          },
          metadata: { checked: true },
        }),
      ];

      const output = reason(interactions);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('RadioButton');
      expect(output[0]!.metadata.checked).toBe(true);
    });
  });

  describe('Autocomplete — Airport Selection', () => {
    it('collapses focus + type + click suggestion into one Autocomplete', () => {
      const interactions = [
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            className: 'autocomplete search-input',
            ariaAutoComplete: 'list',
            accessibleName: 'From',
          },
        }),
        makeInteraction({
          type: 'TextEntry',
          eventIds: ['evt-0002'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            className: 'autocomplete search-input',
            accessibleName: 'From',
          },
          metadata: { textValue: 'Mum' },
        }),
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0003'],
          target: {
            ...baseTarget,
            tag: 'DIV',
            ariaRole: 'option',
            accessibleName: 'Mumbai (BOM)',
            className: 'autocomplete-item',
          },
        }),
      ];

      const output = reason(interactions);

      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe('Autocomplete');
      expect(output[0]!.metadata.selectedValue).toBe('Mumbai (BOM)');
    });
  });

  describe('Flight Options — MultiConfig Panel', () => {
    it('collapses multiple field adjustments into one configure interaction', () => {
      const interactions = [
        // Click opens flight options panel
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'DIV',
            className: 'flight-options-trigger',
            accessibleName: 'Flight Options',
            ariaRole: 'button',
          },
        }),
        // Click Economy radio
        makeInteraction({
          type: 'RadioButton',
          eventIds: ['evt-0002'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            accessibleName: 'Economy',
            ariaRole: 'radio',
            className: 'cabin-class-option',
          },
          metadata: { checked: true },
        }),
        // Click + to increase Adults
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0003'],
          target: {
            ...baseTarget,
            tag: 'BUTTON',
            accessibleName: '+',
            className: 'stepper-increment',
          },
        }),
        // Click Premium Economy radio
        makeInteraction({
          type: 'RadioButton',
          eventIds: ['evt-0004'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            accessibleName: 'Premium Economy',
            ariaRole: 'radio',
            className: 'cabin-class-option',
          },
          metadata: { checked: true },
        }),
        // Click Done
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0005'],
          target: {
            ...baseTarget,
            tag: 'BUTTON',
            accessibleName: 'Done',
            className: 'flight-options-done',
          },
        }),
      ];

      const output = reason(interactions);

      // Should collapse to ONE interaction
      expect(output).toHaveLength(1);
      expect(output[0]!.metadata.semanticAction).toBe('configure');
      expect(output[0]!.metadata.configuredFields).toBeDefined();
      const fields = output[0]!.metadata.configuredFields!;
      // Latest radio selection should be reflected (Premium Economy overwrites Economy)
      expect(fields['Premium Economy']).toBe('Selected');
      // Stepper increment recorded
      expect(fields['+']).toBe('+1');
    });

    it('commits accumulated fields on outside-click cancellation', () => {
      const interactions = [
        // Click opens flight options panel
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0001'],
          target: {
            ...baseTarget,
            tag: 'DIV',
            className: 'flight-options-trigger',
            accessibleName: 'Flight Options',
          },
        }),
        // Click Economy radio (inside panel)
        makeInteraction({
          type: 'RadioButton',
          eventIds: ['evt-0002'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            accessibleName: 'Economy',
            ariaRole: 'radio',
          },
          metadata: { checked: true },
        }),
        // Click OUTSIDE the panel (different element, not a completion keyword)
        makeInteraction({
          type: 'Click',
          eventIds: ['evt-0003'],
          target: {
            ...baseTarget,
            tag: 'INPUT',
            accessibleName: 'Departure Date',
            className: 'date-input',
          },
        }),
      ];

      const output = reason(interactions);

      // MultiConfig should commit with accumulated fields (Economy)
      const configures = output.filter(i => i.metadata.semanticAction === 'configure');
      expect(configures.length).toBe(1);
      expect(configures[0]!.metadata.configuredFields!['Economy']).toBe('Selected');

      // The outside-click itself should also pass through
      const searchClicks = output.filter(i => i.type === 'Click' && i.metadata.semanticAction !== 'configure');
      expect(searchClicks.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ── FormSubmit Tests ─────────────────────────────────────────────────────

describe('FormSubmit — Login Workflow', () => {

  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  it('activates on password field and enriches submit with authenticate action', () => {
    const interactions = [
      makeInteraction({
        type: 'TextEntry',
        eventIds: ['evt-0001'],
        target: {
          ...baseTarget,
          tag: 'INPUT',
          accessibleName: 'Username',
          name: 'username',
        },
        metadata: { textValue: 'Admin' },
      }),
      makeInteraction({
        type: 'TextEntry',
        eventIds: ['evt-0002'],
        target: {
          ...baseTarget,
          tag: 'INPUT',
          accessibleName: 'Password',
          name: 'password',
        },
        metadata: { textValue: 'admin123' },
      }),
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0003'],
        target: {
          ...baseTarget,
          tag: 'BUTTON',
          accessibleName: 'Login',
          typeAttribute: 'submit',
        },
      }),
    ];

    const output = reason(interactions);

    // Form fields should pass through enriched
    const textEntries = output.filter(i => i.type === 'TextEntry');
    expect(textEntries.length).toBeGreaterThanOrEqual(1);

    // The Login click should be enriched with authenticate semantic action
    const loginClick = output.find(i => i.metadata.semanticAction === 'authenticate');
    expect(loginClick).toBeDefined();
    expect(loginClick!.metadata.formSubmitAction).toBe('Login');
  });

  it('merges submit click + navigation preserving authenticate context', () => {
    const events = [
      makeEvent('focus', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
      makeEvent('focus', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
      makeEvent('click', { actionId: 'evt-0003', timestamp: '2026-07-28T10:00:02.000Z' }),
      makeEvent('navigation', { actionId: 'evt-0004', timestamp: '2026-07-28T10:00:03.000Z' }),
    ];

    const interactions = [
      makeInteraction({
        type: 'TextEntry',
        eventIds: ['evt-0001'],
        target: { ...baseTarget, tag: 'INPUT', accessibleName: 'Username', name: 'username' },
        metadata: { textValue: 'Admin' },
      }),
      makeInteraction({
        type: 'TextEntry',
        eventIds: ['evt-0002'],
        target: { ...baseTarget, tag: 'INPUT', accessibleName: 'Password', name: 'password' },
        metadata: { textValue: 'admin123' },
      }),
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0003'],
        target: { ...baseTarget, tag: 'BUTTON', accessibleName: 'Login', typeAttribute: 'submit' },
      }),
      makeInteraction({
        type: 'PageNavigation',
        eventIds: ['evt-0004'],
        metadata: { url: 'https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index' },
      }),
    ];

    const output = reason(interactions, events);

    // Submit click should merge with navigation into PageNavigation
    const navs = output.filter(i => i.type === 'PageNavigation');
    expect(navs).toHaveLength(1);
    // Should carry authenticate semantic action from the merged click
    expect(navs[0]!.metadata.semanticAction).toBe('authenticate');
    expect(navs[0]!.metadata.formSubmitAction).toBe('Login');
    expect(navs[0]!.metadata.url).toContain('/dashboard/index');
  });
});

// ── Component Session Stats ─────────────────────────────────────────────────

describe('Semantic Reasoning Stats', () => {

  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  it('reports correct session counts', () => {
    const events = [
      makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
      makeEvent('click', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
    ];

    const interactions = [
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0001'],
        target: {
          ...baseTarget,
          tag: 'DIV',
          className: 'oxd-select-text-input',
          ariaRole: 'combobox',
        },
      }),
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0002'],
        target: {
          ...baseTarget,
          tag: 'DIV',
          ariaRole: 'option',
          accessibleName: 'American',
        },
      }),
    ];

    const result = reasonAboutInteractions(interactions, events);

    expect(result.sessionsActivated).toBe(1);
    expect(result.sessionsCompleted).toBe(1);
    expect(result.sessionsCancelled).toBe(0);
    expect(result.interactionsAbsorbed).toBe(0);
  });

  it('reports cancellation when navigation interrupts session', () => {
    const events = [
      makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
      makeEvent('navigation', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
    ];

    const interactions = [
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0001'],
        target: {
          ...baseTarget,
          tag: 'DIV',
          className: 'oxd-select-text-input',
          ariaRole: 'combobox',
        },
      }),
      // Navigation cancels the pending dropdown session
      makeInteraction({
        type: 'PageNavigation',
        eventIds: ['evt-0002'],
        metadata: { url: 'https://example.com/other' },
      }),
    ];

    const result = reasonAboutInteractions(interactions, events);

    expect(result.sessionsActivated).toBe(1);
    // Session cancelled by navigation
    expect(result.sessionsCancelled).toBeGreaterThanOrEqual(1);
  });
});

// ── Edge Cases ──────────────────────────────────────────────────────────────

describe('Edge Cases', () => {

  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  it('handles empty interaction list', () => {
    const result = reasonAboutInteractions([], []);
    expect(result.interactions).toHaveLength(0);
  });

  it('handles null/undefined input', () => {
    const result = reasonAboutInteractions(null as any, []);
    expect(result.interactions).toHaveLength(0);
  });

  it('passes through all non-component interactions unchanged', () => {
    const interactions = [
      makeInteraction({ type: 'Click', target: { ...baseTarget, accessibleName: 'Button A' } }),
      makeInteraction({ type: 'Checkbox', target: { ...baseTarget, accessibleName: 'Agree' }, metadata: { checked: true } }),
      makeInteraction({ type: 'Slider', target: { ...baseTarget, accessibleName: 'Volume' }, metadata: { sliderValue: '50' } }),
    ];

    const output = reason(interactions);

    expect(output).toHaveLength(3);
    expect(types(output)).toEqual(['Click', 'Checkbox', 'Slider']);
  });

  it('handles consecutive dropdown sessions without interference', () => {
    const events = [
      makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
      makeEvent('click', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
      makeEvent('click', { actionId: 'evt-0003', timestamp: '2026-07-28T10:00:02.000Z' }),
      makeEvent('click', { actionId: 'evt-0004', timestamp: '2026-07-28T10:00:03.000Z' }),
    ];

    const interactions = [
      // First dropdown
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0001'],
        target: { ...baseTarget, className: 'oxd-select-text-input', ariaRole: 'combobox', accessibleName: 'Nationality' },
      }),
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0002'],
        target: { ...baseTarget, ariaRole: 'option', accessibleName: 'Belgian' },
      }),
      // Second dropdown
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0003'],
        target: { ...baseTarget, className: 'oxd-select-text-input', ariaRole: 'combobox', accessibleName: 'Marital Status' },
      }),
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0004'],
        target: { ...baseTarget, ariaRole: 'option', accessibleName: 'Single' },
      }),
    ];

    const output = reason(interactions, events);

    const dropdowns = output.filter(i => i.type === 'NativeDropdown');
    expect(dropdowns).toHaveLength(2);
    expect(dropdowns[0]!.metadata.selectedValue).toBe('Belgian');
    expect(dropdowns[1]!.metadata.selectedValue).toBe('Single');
  });

  it('flushes pending sessions at end of stream', () => {
    const interactions = [
      makeInteraction({
        type: 'Click',
        eventIds: ['evt-0001'],
        target: { ...baseTarget, className: 'oxd-select-text-input', ariaRole: 'combobox', accessibleName: 'Nationality' },
      }),
      // No option click — session stays pending at end of stream
      makeInteraction({
        type: 'ContainerScroll',
        eventIds: ['evt-0002'],
        metadata: { scrollPosition: { x: 0, y: 100 } },
      }),
    ];

    const events = [
      makeEvent('click', { actionId: 'evt-0001', timestamp: '2026-07-28T10:00:00.000Z' }),
      makeEvent('scroll', { actionId: 'evt-0002', timestamp: '2026-07-28T10:00:01.000Z' }),
    ];

    const output = reason(interactions, events);

    // Session expires — scroll absorbed (not in output)
    // Trigger may pass through as Click or be committed with no value
    expect(types(output)).not.toContain('ContainerScroll');
    expect(output.length).toBeGreaterThanOrEqual(1);
  });
});
