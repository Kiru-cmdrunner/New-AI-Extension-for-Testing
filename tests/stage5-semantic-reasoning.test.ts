/**
 * Stage 5: Semantic Reasoning Engine — Comprehensive Tests
 *
 * Tests the SemanticReasoner's ability to:
 * 1. Collapse multi-interaction dropdown sequences into single SELECT
 * 2. Collapse date picker sequences into single SELECT_DATE
 * 3. Collapse autocomplete sequences into single SELECT
 * 4. Merge navigation clicks with subsequent PageNavigation
 * 5. Absorb internal noise (scrolls, internal clicks)
 * 6. Pass through non-component interactions unchanged
 * 7. Handle cancellations (Escape, outside clicks, stale sessions)
 * 8. Flush on end-of-stream
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { reasonAboutInteractions, resetSessionCounter } from '../src/classifier/semantic';
import type { DetectedInteraction, InteractionMetadata } from '../src/classifier/interaction-types';
import type { SessionEvent, ElementIdentity } from '../src/shared/types';

// ── Test Helpers ──────────────────────────────────────────────────────────

let eventCounter = 0;
let interactionCounter = 0;

function resetCounters(): void {
  eventCounter = 0;
  interactionCounter = 0;
}

function makeEvent(type: string, ts: string): SessionEvent {
  const actionId = `evt-${String(++eventCounter).padStart(4, '0')}`;
  const base: any = {
    actionId,
    type,
    timestamp: ts,
    elementIdentity: {
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
      cssSelector: '',
      xPath: '',
      inIframe: false,
      shadowDom: false,
      elementId: `elem-${eventCounter}`,
    },
  };
  return base as SessionEvent;
}

function makeInteraction(
  type: DetectedInteraction['type'],
  eventIds: string[],
  metadata: Partial<InteractionMetadata> = {},
  target?: Partial<ElementIdentity>,
): DetectedInteraction {
  return {
    interactionId: `int-${String(++interactionCounter).padStart(4, '0')}`,
    type,
    eventIds,
    rawEventTypes: type === 'PageNavigation' ? ['navigation'] : ['click'],
    target: {
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
      cssSelector: '',
      xPath: '',
      inIframe: false,
      shadowDom: false,
      elementId: `elem-${interactionCounter}`,
      ...target,
    },
    metadata: metadata as InteractionMetadata,
    confidence: 0.9,
    engine: 'test',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Semantic Reasoner', () => {
  beforeEach(() => {
    resetCounters();
    resetSessionCounter();
  });

  // ── Dropdown ─────────────────────────────────────────────────────────

  describe('Dropdown sessions', () => {
    it('collapses click-trigger + scroll + click-option into one SELECT', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';
      const ts4 = '2025-01-01T00:00:04.000Z';

      const triggerEvent = makeEvent('click', ts1);
      const triggerClick = makeInteraction('Click', [triggerEvent.actionId], {
        accessibleName: 'Nationality',
      }, {
        tag: 'DIV',
        className: 'oxd-select-text',
        accessibleName: 'Nationality',
        ariaRole: 'combobox',
      });

      const scrollEvent = makeEvent('scroll', ts2);
      const scroll = makeInteraction('PageScroll', [scrollEvent.actionId], {}, {});

      const optionEvent = makeEvent('click', ts3);
      const optionClick = makeInteraction('Click', [optionEvent.actionId], {
        accessibleName: 'Belgian',
      }, {
        tag: 'LI',
        ariaRole: 'option',
        accessibleName: 'Belgian',
      });

      const finalEvent = makeEvent('click', ts4);
      const finalClick = makeInteraction('Click', [finalEvent.actionId], {
        accessibleName: 'Save',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Save',
      });

      const events: SessionEvent[] = [triggerEvent, scrollEvent, optionEvent, finalEvent];
      const interactions: DetectedInteraction[] = [triggerClick, scroll, optionClick, finalClick];

      const result = reasonAboutInteractions(interactions, events);

      // Should produce: 1 dropdown select + 1 save click (scroll absorbed)
      expect(result.interactions.length).toBe(2);
      expect(result.interactions[0]!.type).toBe('NativeDropdown');
      expect(result.interactions[0]!.metadata.selectedValue).toBe('Belgian');
      expect(result.interactions[1]!.type).toBe('Click');

      // Stats
      expect(result.sessionsActivated).toBe(1);
      expect(result.sessionsCompleted).toBe(1);
      expect(result.interactionsAbsorbed).toBe(1);
    });

    it('passes through trigger click when user dismisses without selecting', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:17.000Z'; // 16s later → timeout

      const triggerEvent = makeEvent('click', ts1);
      const triggerClick = makeInteraction('Click', [triggerEvent.actionId], {
        accessibleName: 'Nationality',
      }, {
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      const otherEvent = makeEvent('click', ts2);
      const otherClick = makeInteraction('Click', [otherEvent.actionId], {
        accessibleName: 'Other Button',
      }, {
        tag: 'BUTTON',
      });

      const events: SessionEvent[] = [triggerEvent, otherEvent];
      const interactions: DetectedInteraction[] = [triggerClick, otherClick];

      const result = reasonAboutInteractions(interactions, events);

      // Trigger should pass through on cancel (no absorbed events)
      // The other click is outside the dropdown scope → cancel
      expect(result.sessionsCancelled).toBe(1);
      // Both interactions should appear in output
      expect(result.interactions.length).toBe(2);
    });

    it('uses selectedValue metadata when available', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      const triggerEvent = makeEvent('click', ts1);
      const triggerClick = makeInteraction('Click', [triggerEvent.actionId], {}, {
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      const selectEvent = makeEvent('change', ts2);
      const select = makeInteraction('NativeDropdown', [selectEvent.actionId], {
        selectedValue: 'Indian',
      });

      const events: SessionEvent[] = [triggerEvent, selectEvent];
      const interactions: DetectedInteraction[] = [triggerClick, select];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions[0]!.type).toBe('NativeDropdown');
      expect(result.interactions[0]!.metadata.selectedValue).toBe('Indian');
    });
  });

  // ── Date Picker ──────────────────────────────────────────────────────

  describe('Date Picker sessions', () => {
    it('collapses click-trigger + cell-click into one DatePicker', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:03.000Z';

      const triggerEvent = makeEvent('click', ts1);
      const triggerClick = makeInteraction('Click', [triggerEvent.actionId], {}, {
        tag: 'INPUT',
        className: 'oxd-date-input',
        placeholder: 'yyyy-mm-dd',
      });

      const cellEvent = makeEvent('click', ts2);
      const cellClick = makeInteraction('Click', [cellEvent.actionId], {
        accessibleName: '15',
      }, {
        tag: 'TD',
        ariaRole: 'gridcell',
        accessibleName: '15',
      });

      const events: SessionEvent[] = [triggerEvent, cellEvent];
      const interactions: DetectedInteraction[] = [triggerClick, cellClick];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('DatePicker');
      expect(result.interactions[0]!.metadata.dateValue).toBe('15');
    });

    it('absorbs month navigation clicks inside date picker', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';

      const triggerEvent = makeEvent('click', ts1);
      const triggerClick = makeInteraction('Click', [triggerEvent.actionId], {}, {
        tag: 'INPUT',
        className: 'oxd-date-input',
        placeholder: 'yyyy-mm-dd',
      });

      const nextMonthEvent = makeEvent('click', ts2);
      const nextMonthClick = makeInteraction('Click', [nextMonthEvent.actionId], {
        accessibleName: 'Next Month',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Next Month',
      });

      const cellEvent = makeEvent('click', ts3);
      const cellClick = makeInteraction('Click', [cellEvent.actionId], {
        accessibleName: '20',
      }, {
        tag: 'TD',
        ariaRole: 'gridcell',
        accessibleName: '20',
      });

      const events: SessionEvent[] = [triggerEvent, nextMonthEvent, cellEvent];
      const interactions: DetectedInteraction[] = [triggerClick, nextMonthClick, cellClick];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('DatePicker');
      expect(result.interactionsAbsorbed).toBe(1);
    });

    it('uses DatePicker interaction metadata when it is the completion', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      const triggerEvent = makeEvent('click', ts1);
      const triggerClick = makeInteraction('Click', [triggerEvent.actionId], {}, {
        tag: 'INPUT',
        className: 'oxd-date-input',
        placeholder: 'yyyy-mm-dd',
      });

      const dateEvent = makeEvent('change', ts2);
      const dateSelect = makeInteraction('DatePicker', [dateEvent.actionId], {
        dateValue: '2005-10-27',
        displayValue: '27 October 2005',
      });

      const events: SessionEvent[] = [triggerEvent, dateEvent];
      const interactions: DetectedInteraction[] = [triggerClick, dateSelect];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('DatePicker');
      expect(result.interactions[0]!.metadata.dateValue).toBe('2005-10-27');
      expect(result.interactions[0]!.metadata.displayValue).toBe('27 October 2005');
    });
  });

  // ── Navigation ───────────────────────────────────────────────────────

  describe('Navigation sessions', () => {
    it('merges submit-click + PageNavigation into one Navigate', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      const clickEvent = makeEvent('click', ts1);
      const loginClick = makeInteraction('Click', [clickEvent.actionId], {
        accessibleName: 'Login',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Login',
      });

      const navEvent = makeEvent('navigation', ts2);
      const nav = makeInteraction('PageNavigation', [navEvent.actionId], {
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
      });

      const events: SessionEvent[] = [clickEvent, navEvent];
      const interactions: DetectedInteraction[] = [loginClick, nav];

      const result = reasonAboutInteractions(interactions, events);

      // Should be one navigation interaction
      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('PageNavigation');
      expect(result.interactions[0]!.metadata.url).toBe('https://example.com/dashboard');
      expect(result.interactions[0]!.metadata.accessibleName).toBe('Login');
    });

    it('passes through click if no navigation follows within 3s', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:05.000Z'; // 4s later → timeout

      const clickEvent = makeEvent('click', ts1);
      const saveClick = makeInteraction('Click', [clickEvent.actionId], {
        accessibleName: 'Save',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Save',
      });

      const otherEvent = makeEvent('click', ts2);
      const otherClick = makeInteraction('Click', [otherEvent.actionId], {
        accessibleName: 'Edit',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Edit',
      });

      const events: SessionEvent[] = [clickEvent, otherEvent];
      const interactions: DetectedInteraction[] = [saveClick, otherClick];

      const result = reasonAboutInteractions(interactions, events);

      // With lookback merge, no navigation session is created. Both clicks
      // pass through unchanged (no navigation event follows to merge with).
      expect(result.sessionsActivated).toBe(0);
      // Both should be in output
      expect(result.interactions.length).toBe(2);
      expect(result.interactions[0]!.type).toBe('Click');
      expect(result.interactions[1]!.type).toBe('Click');
    });

    it('merges link click + navigation', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      const clickEvent = makeEvent('click', ts1);
      const linkClick = makeInteraction('Link', [clickEvent.actionId], {
        accessibleName: 'Dashboard',
      }, {
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Dashboard',
      });

      const navEvent = makeEvent('navigation', ts2);
      const nav = makeInteraction('PageNavigation', [navEvent.actionId], {
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
      });

      const events: SessionEvent[] = [clickEvent, navEvent];
      const interactions: DetectedInteraction[] = [linkClick, nav];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('PageNavigation');
    });
  });

  // ── Autocomplete ─────────────────────────────────────────────────────

  describe('Autocomplete sessions', () => {
    it('collapses focus + type + click-suggestion into one SELECT', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';

      const focusEvent = makeEvent('click', ts1);
      const focusClick = makeInteraction('Click', [focusEvent.actionId], {}, {
        tag: 'INPUT',
        className: 'autocomplete-input',
        ariaRole: 'combobox',
      });

      const typeEvent = makeEvent('text', ts2);
      const typeEntry = makeInteraction('TextEntry', [typeEvent.actionId], {
        textValue: 'ind',
      }, {
        tag: 'INPUT',
        className: 'autocomplete-input',
      });

      const suggestionEvent = makeEvent('click', ts3);
      const suggestionClick = makeInteraction('Click', [suggestionEvent.actionId], {
        accessibleName: 'India',
      }, {
        tag: 'LI',
        ariaRole: 'option',
        accessibleName: 'India',
      });

      const events: SessionEvent[] = [focusEvent, typeEvent, suggestionEvent];
      const interactions: DetectedInteraction[] = [focusClick, typeEntry, suggestionClick];

      const result = reasonAboutInteractions(interactions, events);

      // Should be one autocomplete select
      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('Autocomplete');
      expect(result.interactions[0]!.metadata.selectedValue).toBe('India');
      expect(result.interactionsAbsorbed).toBe(1); // TextEntry absorbed
    });

    it('emits TextEntry with typed value when autocomplete expires without selection', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      const focusEvent = makeEvent('click', ts1);
      const focusClick = makeInteraction('Click', [focusEvent.actionId], {}, {
        tag: 'INPUT',
        className: 'autocomplete-input',
        ariaRole: 'combobox',
      });

      const typeEvent = makeEvent('text', ts2);
      const typeEntry = makeInteraction('TextEntry', [typeEvent.actionId], {
        textValue: 'india',
      }, {
        tag: 'INPUT',
        className: 'autocomplete-input',
      });

      // No suggestion click — session will expire at end-of-stream
      const events: SessionEvent[] = [focusEvent, typeEvent];
      const interactions: DetectedInteraction[] = [focusClick, typeEntry];

      const result = reasonAboutInteractions(interactions, events);

      // Should emit a TextEntry with the typed value (not Autocomplete)
      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('TextEntry');
      expect(result.interactions[0]!.metadata.textValue).toBe('india');
    });
  });

  describe('Pass-through', () => {
    it('passes through plain click interactions unchanged', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';

      const event = makeEvent('click', ts1);
      const click = makeInteraction('Click', [event.actionId], {
        accessibleName: 'Save',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Save',
      });

      const events: SessionEvent[] = [event];
      const interactions: DetectedInteraction[] = [click];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('Click');
      expect(result.interactions[0]!.metadata.accessibleName).toBe('Save');
      expect(result.interactionsPassedThrough).toBe(1);
    });

    it('passes through text entry interactions unchanged', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';

      const event = makeEvent('text', ts1);
      const text = makeInteraction('TextEntry', [event.actionId], {
        textValue: 'John',
      }, {
        tag: 'INPUT',
        accessibleName: 'First Name',
      });

      const events: SessionEvent[] = [event];
      const interactions: DetectedInteraction[] = [text];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('TextEntry');
      expect(result.interactions[0]!.metadata.textValue).toBe('John');
    });

    it('passes through checkbox interactions unchanged', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';

      const event = makeEvent('click', ts1);
      const checkbox = makeInteraction('Checkbox', [event.actionId], {
        checked: true,
        accessibleName: 'Remember me',
      }, {
        tag: 'INPUT',
        accessibleName: 'Remember me',
      });

      const events: SessionEvent[] = [event];
      const interactions: DetectedInteraction[] = [checkbox];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('Checkbox');
    });

    it('passes through radio button interactions unchanged', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';

      const event = makeEvent('click', ts1);
      const radio = makeInteraction('RadioButton', [event.actionId], {
        accessibleName: 'Male',
      }, {
        tag: 'INPUT',
        accessibleName: 'Male',
      });

      const events: SessionEvent[] = [event];
      const interactions: DetectedInteraction[] = [radio];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('RadioButton');
    });
  });

  // ── Edge Cases ───────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('handles empty interaction list', () => {
      const result = reasonAboutInteractions([], []);
      expect(result.interactions.length).toBe(0);
      expect(result.sessionsActivated).toBe(0);
    });

    it('handles null/undefined input defensively', () => {
      // @ts-expect-error testing null input
      const result = reasonAboutInteractions(null, []);
      expect(result.interactions.length).toBe(0);
    });

    it('flushes remaining sessions at end-of-stream', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';

      const triggerEvent = makeEvent('click', ts1);
      const triggerClick = makeInteraction('Click', [triggerEvent.actionId], {}, {
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      const events: SessionEvent[] = [triggerEvent];
      const interactions: DetectedInteraction[] = [triggerClick];

      const result = reasonAboutInteractions(interactions, events);

      // No completion → trigger passes through
      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('Click');
      expect(result.sessionsActivated).toBe(1);
      expect(result.sessionsCancelled).toBe(1);
    });

    it('handles multiple consecutive dropdown sessions', () => {
      // First dropdown
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';
      const ts4 = '2025-01-01T00:00:04.000Z';

      const trigger1Event = makeEvent('click', ts1);
      const trigger1 = makeInteraction('Click', [trigger1Event.actionId], {
        accessibleName: 'Nationality',
      }, {
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      const option1Event = makeEvent('click', ts2);
      const option1 = makeInteraction('Click', [option1Event.actionId], {
        accessibleName: 'Belgian',
      }, {
        tag: 'LI',
        ariaRole: 'option',
        accessibleName: 'Belgian',
      });

      // Second dropdown
      const trigger2Event = makeEvent('click', ts3);
      const trigger2 = makeInteraction('Click', [trigger2Event.actionId], {
        accessibleName: 'Marital Status',
      }, {
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      const option2Event = makeEvent('click', ts4);
      const option2 = makeInteraction('Click', [option2Event.actionId], {
        accessibleName: 'Single',
      }, {
        tag: 'LI',
        ariaRole: 'option',
        accessibleName: 'Single',
      });

      const events = [trigger1Event, option1Event, trigger2Event, option2Event];
      const interactions = [trigger1, option1, trigger2, option2];

      const result = reasonAboutInteractions(interactions, events);

      // Both dropdowns completed
      expect(result.interactions.length).toBe(2);
      expect(result.interactions[0]!.type).toBe('NativeDropdown');
      expect(result.interactions[0]!.metadata.selectedValue).toBe('Belgian');
      expect(result.interactions[1]!.type).toBe('NativeDropdown');
      expect(result.interactions[1]!.metadata.selectedValue).toBe('Single');
      expect(result.sessionsCompleted).toBe(2);
    });

    it('absorbs hover events inside active sessions', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';

      const triggerEvent = makeEvent('click', ts1);
      const trigger = makeInteraction('Click', [triggerEvent.actionId], {}, {
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      const hoverEvent = makeEvent('hover', ts2);
      const hover = makeInteraction('Hover', [hoverEvent.actionId], {}, {});

      const optionEvent = makeEvent('click', ts3);
      const option = makeInteraction('Click', [optionEvent.actionId], {
        accessibleName: 'Belgian',
      }, {
        tag: 'LI',
        ariaRole: 'option',
        accessibleName: 'Belgian',
      });

      const events = [triggerEvent, hoverEvent, optionEvent];
      const interactions = [trigger, hover, option];

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactionsAbsorbed).toBe(1);
    });

    it('preserves trigger target in completed interaction for locator resolution', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';

      const triggerEvent = makeEvent('click', ts1);
      const trigger = makeInteraction('Click', [triggerEvent.actionId], {}, {
        tag: 'DIV',
        className: 'oxd-select-text',
        accessibleName: 'Nationality',
        ariaRole: 'combobox',
        testId: 'nationality-select',
      });

      const optionEvent = makeEvent('click', ts2);
      const option = makeInteraction('Click', [optionEvent.actionId], {
        accessibleName: 'Belgian',
      }, {
        tag: 'LI',
        ariaRole: 'option',
        accessibleName: 'Belgian',
      });

      const events = [triggerEvent, optionEvent];
      const interactions = [trigger, option];

      const result = reasonAboutInteractions(interactions, events);

      // The refined interaction should use the TRIGGER's target (with testId)
      expect(result.interactions[0]!.target!.testId).toBe('nationality-select');
      expect(result.interactions[0]!.target!.accessibleName).toBe('Nationality');
    });

    it('does not activate nested sessions of the same type', () => {
      const ts1 = '2025-01-01T00:00:01.000Z';
      const ts2 = '2025-01-01T00:00:02.000Z';
      const ts3 = '2025-01-01T00:00:03.000Z';

      // Two consecutive dropdown trigger without completion
      const trigger1Event = makeEvent('click', ts1);
      const trigger1 = makeInteraction('Click', [trigger1Event.actionId], {}, {
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      const trigger2Event = makeEvent('click', ts2);
      const trigger2 = makeInteraction('Click', [trigger2Event.actionId], {}, {
        className: 'oxd-select-text',
        ariaRole: 'combobox',
      });

      // Non-dropdown click
      const otherEvent = makeEvent('click', ts3);
      const other = makeInteraction('Click', [otherEvent.actionId], {
        accessibleName: 'Save',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Save',
      });

      const events = [trigger1Event, trigger2Event, otherEvent];
      const interactions = [trigger1, trigger2, other];

      const result = reasonAboutInteractions(interactions, events);

      // Only one dropdown session should be activated
      expect(result.sessionsActivated).toBe(1);
    });
  });

  // ── Real-World OrangeHRM Scenarios ───────────────────────────────────

  describe('OrangeHRM real-world scenarios', () => {
    it('records nationality dropdown selection end-to-end', () => {
      const events: SessionEvent[] = [];
      const interactions: DetectedInteraction[] = [];

      // Click on Nationality dropdown
      const e1 = makeEvent('click', '2025-01-01T00:00:01.000Z');
      events.push(e1);
      interactions.push(makeInteraction('Click', [e1.actionId], {
        accessibleName: 'Nationality',
      }, {
        tag: 'DIV',
        className: 'oxd-select-text--active',
        accessibleName: 'Nationality',
        ariaRole: 'combobox',
      }));

      // Scroll inside dropdown
      const e2 = makeEvent('scroll', '2025-01-01T00:00:02.000Z');
      events.push(e2);
      interactions.push(makeInteraction('PageScroll', [e2.actionId], {}, {}));

      // Click "Belgian" option
      const e3 = makeEvent('click', '2025-01-01T00:00:03.000Z');
      events.push(e3);
      interactions.push(makeInteraction('Click', [e3.actionId], {
        accessibleName: 'Belgian',
      }, {
        tag: 'LI',
        className: 'oxd-select-option',
        ariaRole: 'option',
        accessibleName: 'Belgian',
      }));

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('NativeDropdown');
      expect(result.interactions[0]!.metadata.selectedValue).toBe('Belgian');
      expect(result.interactions[0]!.target!.accessibleName).toBe('Nationality');
    });

    it('records date picker selection end-to-end', () => {
      const events: SessionEvent[] = [];
      const interactions: DetectedInteraction[] = [];

      // Click on date field
      const e1 = makeEvent('click', '2025-01-01T00:00:01.000Z');
      events.push(e1);
      interactions.push(makeInteraction('Click', [e1.actionId], {}, {
        tag: 'INPUT',
        className: 'oxd-date-input',
        placeholder: 'yyyy-dd-mm',
      }));

      // Click "Next Month" navigation
      const e2 = makeEvent('click', '2025-01-01T00:00:02.000Z');
      events.push(e2);
      interactions.push(makeInteraction('Click', [e2.actionId], {
        accessibleName: 'Next Month',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Next Month',
      }));

      // Click date cell "27"
      const e3 = makeEvent('click', '2025-01-01T00:00:03.000Z');
      events.push(e3);
      interactions.push(makeInteraction('Click', [e3.actionId], {
        accessibleName: '27',
      }, {
        tag: 'TD',
        className: 'oxd-date-day',
        ariaRole: 'gridcell',
        accessibleName: '27',
      }));

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('DatePicker');
      expect(result.interactions[0]!.metadata.dateValue).toBe('27');
    });

    it('records login click + navigation as one interaction', () => {
      const events: SessionEvent[] = [];
      const interactions: DetectedInteraction[] = [];

      // Click Login button
      const e1 = makeEvent('click', '2025-01-01T00:00:01.000Z');
      events.push(e1);
      interactions.push(makeInteraction('Click', [e1.actionId], {
        accessibleName: 'Login',
      }, {
        tag: 'BUTTON',
        accessibleName: 'Login',
      }));

      // Page navigates to dashboard
      const e2 = makeEvent('navigation', '2025-01-01T00:00:02.000Z');
      events.push(e2);
      interactions.push(makeInteraction('PageNavigation', [e2.actionId], {
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
      }));

      const result = reasonAboutInteractions(interactions, events);

      expect(result.interactions.length).toBe(1);
      expect(result.interactions[0]!.type).toBe('PageNavigation');
      expect(result.interactions[0]!.metadata.url).toBe('https://example.com/dashboard');
    });
  });
});
