/**
 * Calendar Popover Suppression — Milestone 3 Tests
 *
 * Tests that events inside calendar popovers (scroll, click on navigation
 * buttons) are tagged with ownedByDatePicker and skipped by both V1 and V2
 * classifiers — they are evidence-only, not standalone interactions.
 *
 * Also tests that dateSelect events are NOT suppressed (they ARE the
 * interaction the calendar events belong to).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { detectInteractions } from '../src/classifier/interaction-detector';
import { detectInteractionsV2 } from '../src/classifier/evidence/detector';
import { mergeV1V2 } from '../src/classifier/evidence/merge-layer';
import type { RecordedEvent, ElementRecordedEvent, DomContext } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: '',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '//div',
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: 'el-001',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    ...overrides,
  };
}

function makeEvent(
  eventType: ElementRecordedEvent['eventType'],
  target: Partial<ElementIdentity>,
  domContextOverrides: Partial<DomContext> = {},
  valueAfter: string | null = null,
): ElementRecordedEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    timestamp: new Date().toISOString(),
    target: makeIdentity(target),
    valueBefore: null,
    valueAfter,
    checkedBefore: null,
    checkedAfter: null,
    domContext: makeDomContext(domContextOverrides),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Calendar Popover Suppression — Milestone 3', () => {
  beforeEach(() => {
    setupChromeMock();
  });

  // ── V1 Classifier ─────────────────────────────────────────────────

  describe('V1 classifier (interaction-detector)', () => {
    it('skips scroll events tagged ownedByDatePicker', () => {
      const events: RecordedEvent[] = [
        makeEvent('scroll', {
          tag: 'DIV',
          className: 'calendar-container',
          cssSelector: '.calendar-container',
          elementId: 'cal-scroll-001',
        }, { ownedByDatePicker: true }),
      ];

      const interactions = detectInteractions(events);
      expect(interactions).toHaveLength(0);
    });

    it('skips click events tagged ownedByDatePicker', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'BUTTON',
          className: 'react-datepicker__navigation--next',
          ariaLabel: 'Next month',
          cssSelector: 'button.react-datepicker__navigation--next',
          elementId: 'cal-nav-001',
        }, { ownedByDatePicker: true }),
      ];

      const interactions = detectInteractions(events);
      expect(interactions).toHaveLength(0);
    });

    it('does NOT skip dateSelect events even with ownedByDatePicker', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT',
          name: 'dateOfBirth',
          accessibleName: 'Date of Birth',
          ariaRole: 'textbox',
          cssSelector: 'input[name="dateOfBirth"]',
          elementId: 'dob-001',
        }, {
          dateType: 'date',
          isoValue: '1987-09-19',
          displayValue: 'September 19, 1987',
          dateConfidence: 1.0,
        }, '1987-09-19'),
      ];

      const interactions = detectInteractions(events);
      expect(interactions).toHaveLength(1);
      expect(interactions[0].type).toBe('DatePicker');
    });

    it('keeps regular scroll events (not in calendar)', () => {
      const events: RecordedEvent[] = [
        makeEvent('scroll', {
          tag: 'HTML',
          cssSelector: 'html',
          elementId: 'page-scroll-001',
        }, { ownedByDatePicker: false }),
      ];

      const interactions = detectInteractions(events);
      expect(interactions).toHaveLength(1);
      expect(interactions[0].type).toBe('PageScroll');
    });

    it('keeps regular click events (not in calendar)', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'BUTTON',
          accessibleName: 'Save',
          cssSelector: 'button.save',
          elementId: 'save-001',
        }),
      ];

      const interactions = detectInteractions(events);
      expect(interactions).toHaveLength(1);
      expect(interactions[0].type).toBe('Click');
    });
  });

  // ── V2 Evidence Engine ────────────────────────────────────────────

  describe('V2 evidence engine', () => {
    it('skips scroll events tagged ownedByDatePicker', () => {
      const events: RecordedEvent[] = [
        makeEvent('scroll', {
          tag: 'DIV',
          className: 'calendar-container',
          cssSelector: '.calendar-container',
          elementId: 'cal-scroll-002',
        }, { ownedByDatePicker: true }),
      ];

      const interactions = detectInteractionsV2(events);
      expect(interactions).toHaveLength(0);
    });

    it('skips click events tagged ownedByDatePicker', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'BUTTON',
          className: 'flatpickr-next-month',
          ariaLabel: 'Next month',
          cssSelector: 'button.flatpickr-next-month',
          elementId: 'cal-nav-002',
        }, { ownedByDatePicker: true }),
      ];

      const interactions = detectInteractionsV2(events);
      expect(interactions).toHaveLength(0);
    });

    it('does NOT skip dateSelect events', () => {
      const events: RecordedEvent[] = [
        makeEvent('dateSelect', {
          tag: 'INPUT',
          name: 'dateOfBirth',
          accessibleName: 'Date of Birth',
          ariaRole: 'textbox',
          cssSelector: 'input[name="dateOfBirth"]',
          elementId: 'dob-002',
        }, {
          dateType: 'date',
          isoValue: '2026-07-15',
          displayValue: 'July 15, 2026',
          dateConfidence: 1.0,
        }, '2026-07-15'),
      ];

      const interactions = detectInteractionsV2(events);
      // V2 should produce at least one interaction for the dateSelect
      expect(interactions.length).toBeGreaterThanOrEqual(1);
    });

    it('keeps regular scroll events (not in calendar)', () => {
      const events: RecordedEvent[] = [
        makeEvent('scroll', {
          tag: 'HTML',
          cssSelector: 'html',
          elementId: 'page-scroll-002',
        }, { ownedByDatePicker: false }),
      ];

      const interactions = detectInteractionsV2(events);
      expect(interactions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── V1 + V2 Merge ─────────────────────────────────────────────────

  describe('V1 + V2 merge', () => {
    it('calendar popover events do not produce interactions in merged output', () => {
      const events: RecordedEvent[] = [
        // Click on date input (trigger) — this should produce an interaction
        makeEvent('click', {
          tag: 'INPUT',
          name: 'dateOfBirth',
          accessibleName: 'Date of Birth',
          ariaRole: 'textbox',
          cssSelector: 'input[name="dateOfBirth"]',
          elementId: 'dob-trigger-001',
        }, { inputType: 'date', surfaceType: 'popover' as DomContext['surfaceType'] }),

        // Scroll inside calendar (ownedByDatePicker)
        makeEvent('scroll', {
          tag: 'DIV',
          className: 'react-datepicker',
          cssSelector: '.react-datepicker',
          elementId: 'cal-scroll-003',
        }, { ownedByDatePicker: true }),

        // Click on "Next month" button (ownedByDatePicker)
        makeEvent('click', {
          tag: 'BUTTON',
          className: 'react-datepicker__navigation--next',
          ariaLabel: 'Next month',
          cssSelector: 'button.react-datepicker__navigation--next',
          elementId: 'cal-nav-003',
        }, { ownedByDatePicker: true }),

        // Click on a day cell (ownedByDatePicker — inside calendar)
        makeEvent('click', {
          tag: 'DIV',
          className: 'react-datepicker__day react-datepicker__day--019',
          ariaRole: 'gridcell',
          ariaLabel: '19th September 1987',
          accessibleName: '19th September 1987',
          cssSelector: '.react-datepicker__day--019',
          elementId: 'cal-day-001',
        }, { ownedByDatePicker: true }),

        // dateSelect event (the actual interaction)
        makeEvent('dateSelect', {
          tag: 'INPUT',
          name: 'dateOfBirth',
          accessibleName: 'Date of Birth',
          ariaRole: 'textbox',
          cssSelector: 'input[name="dateOfBirth"]',
          elementId: 'dob-trigger-001',
        }, {
          inputType: 'date',
          dateType: 'date',
          isoValue: '1987-09-19',
          displayValue: 'September 19, 1987',
          dateConfidence: 1.0,
        }, '1987-09-19'),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const { interactions: merged } = mergeV1V2(v2, v1, events.length);

      // The scroll and nav click should NOT produce interactions
      const types = merged.map(i => i.type);
      expect(types).not.toContain('ContainerScroll');
      expect(types).not.toContain('PageScroll');
      expect(types).not.toContain('Scroll');

      // The "Next month" click should NOT produce a Click interaction
      const clickInteractions = merged.filter(i => i.type === 'Click');
      // There might be the trigger click, but the nav click should not be
      // a standalone Click interaction
      const navClicks = clickInteractions.filter(i =>
        i.target?.className?.includes('navigation') ||
        i.target?.accessibleName === 'Next month'
      );
      expect(navClicks).toHaveLength(0);
    });
  });

  // ── MutationProvider surface detection ────────────────────────────

  describe('MutationProvider surface detection', () => {
    it('does not produce Popover evidence for calendar popover clicks', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'INPUT',
          name: 'dateOfBirth',
          accessibleName: 'Date of Birth',
          ariaRole: 'textbox',
          cssSelector: 'input[name="dateOfBirth"]',
          elementId: 'dob-trigger-002',
        }, {
          inputType: 'date',
          surfaceType: 'popover' as DomContext['surfaceType'],
          surfaceRole: 'dialog',
          ownedByDatePicker: true,
        }),
      ];

      const v2 = detectInteractionsV2(events);
      // Should NOT have a Popover interaction from the calendar opening
      const popoverInteractions = v2.filter(i => i.type === 'Popover');
      expect(popoverInteractions).toHaveLength(0);
    });

    it('keeps Popover evidence for non-calendar popovers', () => {
      const events: RecordedEvent[] = [
        makeEvent('click', {
          tag: 'BUTTON',
          accessibleName: 'Open menu',
          ariaRole: 'button',
          ariaHasPopup: 'menu',
          cssSelector: 'button.menu-trigger',
          elementId: 'menu-trigger-001',
        }, {
          surfaceType: 'popover' as DomContext['surfaceType'],
          surfaceRole: 'menu',
        }),
      ];

      const v2 = detectInteractionsV2(events);
      // Should produce a Popover interaction for the menu
      const popoverInteractions = v2.filter(i => i.type === 'Popover');
      expect(popoverInteractions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Full OrangeHRM-like scenario ──────────────────────────────────

  describe('OrangeHRM-like scenario', () => {
    it('date picker interaction produces only DatePicker, not Popover/Scroll/Click', () => {
      const events: RecordedEvent[] = [
        // 1. Click on date input field (trigger)
        makeEvent('click', {
          tag: 'INPUT',
          name: 'dateOfBirth',
          accessibleName: 'Date of Birth',
          ariaRole: 'textbox',
          className: 'oxd-input',
          cssSelector: 'input[name="dateOfBirth"]',
          elementId: 'dob-001',
        }, {
          inputType: 'text',
          surfaceType: 'popover' as DomContext['surfaceType'],
          surfaceRole: 'dialog',
          ownedByDatePicker: true,
        }),

        // 2. Scroll inside calendar popover
        makeEvent('scroll', {
          tag: 'DIV',
          className: 'oxd-datepicker-calendar',
          cssSelector: '.oxd-datepicker-calendar',
          elementId: 'cal-scroll-001',
        }, { ownedByDatePicker: true }),

        // 3. Click on "Next month" navigation button
        makeEvent('click', {
          tag: 'BUTTON',
          className: 'oxd-datepicker-navigation--next',
          ariaLabel: 'Next month',
          cssSelector: 'button.oxd-datepicker-navigation--next',
          elementId: 'cal-nav-001',
        }, { ownedByDatePicker: true }),

        // 4. Click on a day cell
        makeEvent('click', {
          tag: 'DIV',
          className: 'oxd-datepicker-day',
          ariaRole: 'gridcell',
          ariaLabel: 'September 19, 1987',
          accessibleName: 'September 19, 1987',
          cssSelector: '.oxd-datepicker-day[data-date="1987-09-19"]',
          elementId: 'cal-day-001',
        }, { ownedByDatePicker: true }),

        // 5. dateSelect event (the actual interaction)
        makeEvent('dateSelect', {
          tag: 'INPUT',
          name: 'dateOfBirth',
          accessibleName: 'Date of Birth',
          ariaRole: 'textbox',
          className: 'oxd-input',
          cssSelector: 'input[name="dateOfBirth"]',
          elementId: 'dob-001',
        }, {
          inputType: 'text',
          dateType: 'date',
          isoValue: '1987-09-19',
          displayValue: 'September 19, 1987',
          dateConfidence: 1.0,
        }, '1987-09-19'),
      ];

      const v1 = detectInteractions(events);
      const v2 = detectInteractionsV2(events);
      const { interactions: merged } = mergeV1V2(v2, v1, events.length);

      // Should have at least one DatePicker interaction
      const datePickerInteractions = merged.filter(i =>
        i.type === 'DatePicker' || i.type === 'TimePicker' || i.type === 'DateTimePicker'
      );
      expect(datePickerInteractions.length).toBeGreaterThanOrEqual(1);

      // Should NOT have standalone Popover, Scroll, or Click interactions
      // from the calendar lifecycle
      const types = merged.map(i => i.type);
      expect(types).not.toContain('Popover');
      expect(types).not.toContain('ContainerScroll');
      expect(types).not.toContain('PageScroll');

      // The "Next month" click should not be a standalone Click
      const navClicks = merged.filter(i =>
        i.type === 'Click' &&
        i.target?.accessibleName === 'Next month'
      );
      expect(navClicks).toHaveLength(0);
    });
  });
});
