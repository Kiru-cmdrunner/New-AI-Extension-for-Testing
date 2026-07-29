/**
 * Stage 4e: Composite Control Lifecycle — Pending Buffer Architecture
 *
 * Tests that the V2 evidence engine holds composite control interactions in a
 * pending state until the semantic completion event arrives, then emits a single
 * semantic interaction instead of fragmented pieces.
 *
 * Key scenario: a scroll or other standalone event arrives between the trigger
 * click and the completion event. Before this fix, the engine would flush the
 * trigger buffer prematurely. After the fix, the trigger is held in a pending
 * buffer until the option/cell/suggestion click arrives.
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
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: '', name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'div', xPath: '//div',
    inIframe: false, shadowDom: false, elementId: 'el-001', ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return { inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false, ...overrides };
}

let eventCounter = 0;
function makeEvent(
  eventType: ElementRecordedEvent['eventType'],
  target: Partial<ElementIdentity>,
  domContextOverrides: Partial<DomContext> = {},
  valueAfter: string | null = null,
): ElementRecordedEvent {
  const ts = new Date(Date.now() + eventCounter++ * 500).toISOString();
  return {
    eventId: `evt-${eventCounter}`,
    eventType,
    timestamp: ts,
    target: makeIdentity(target),
    valueBefore: null,
    valueAfter,
    checkedBefore: null,
    checkedAfter: null,
    domContext: makeDomContext(domContextOverrides),
  };
}

function resetCounter() { eventCounter = 0; }

// ── Tests ──────────────────────────────────────────────────────────────

describe('Stage 4e: Pending Buffer — Dropdown Lifecycle', () => {
  beforeEach(() => { setupChromeMock(); resetCounter(); });

  it('dropdown trigger + scroll + option click → ONE CustomDropdown (not split)', () => {
    const events: RecordedEvent[] = [
      // 1. Click dropdown trigger
      makeEvent('click', {
        tag: 'DIV',
        className: 'oxd-select-text',
        accessibleName: 'Nationality',
        ariaRole: 'combobox',
        cssSelector: 'div.oxd-select-text',
        elementId: 'nat-dd-001',
      }, {
        ariaExpanded: 'false',
        ariaHasPopup: 'listbox',
      }),

      // 2. Scroll event (would normally flush the buffer!)
      makeEvent('scroll', {
        tag: 'DIV',
        className: 'oxd-select-dropdown',
        accessibleName: '',
        ariaRole: null,
        cssSelector: '.oxd-select-dropdown',
        elementId: 'dd-scroll-001',
      }),

      // 3. Click on option
      makeEvent('click', {
        tag: 'DIV',
        className: 'oxd-select-option',
        accessibleName: 'Dutch',
        ariaRole: 'option',
        cssSelector: 'div.oxd-select-option',
        elementId: 'nat-opt-001',
      }),
    ];

    const v2 = detectInteractionsV2(events);
    const types = v2.map(i => i.type);

    // Should be ONE CustomDropdown containing both trigger and option
    const customDropdowns = v2.filter(i => i.type === 'CustomDropdown');
    expect(customDropdowns.length).toBe(1);

    // Should NOT have a separate standalone Click for the trigger
    const clicks = v2.filter(i => i.type === 'Click');
    expect(clicks.length).toBe(0);
  });

  it('dropdown trigger + option click (no intervening scroll) → ONE CustomDropdown', () => {
    // This should still work (no regression from the lifecycle change)
    const events: RecordedEvent[] = [
      makeEvent('click', {
        tag: 'DIV', className: 'oxd-select-text', accessibleName: 'Blood Type',
        ariaRole: 'combobox', cssSelector: 'div.oxd-select-text', elementId: 'bt-dd-001',
      }, { ariaExpanded: 'true', ariaHasPopup: 'listbox' }),
      makeEvent('click', {
        tag: 'DIV', className: 'oxd-select-option', accessibleName: 'A+',
        ariaRole: 'option', cssSelector: 'div.oxd-select-option', elementId: 'bt-opt-001',
      }),
    ];

    const v2 = detectInteractionsV2(events);
    const customDropdowns = v2.filter(i => i.type === 'CustomDropdown');
    expect(customDropdowns.length).toBe(1);
  });

  it('stale pending dropdown (10s no completion) is committed as-is', () => {
    const baseTime = Date.now();
    const events: RecordedEvent[] = [
      {
        eventId: 'evt-stale-1', eventType: 'click',
        timestamp: new Date(baseTime).toISOString(),
        target: makeIdentity({
          tag: 'DIV', className: 'oxd-select-text', accessibleName: 'Nationality',
          ariaRole: 'combobox', cssSelector: 'div.oxd-select-text', elementId: 'stale-dd-001',
        }),
        valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
        domContext: makeDomContext({ ariaExpanded: 'true', ariaHasPopup: 'listbox' }),
      } as ElementRecordedEvent,
      // Next event is 15 seconds later — exceeds 10s stale timeout
      {
        eventId: 'evt-stale-2', eventType: 'click',
        timestamp: new Date(baseTime + 15_000).toISOString(),
        target: makeIdentity({
          tag: 'BUTTON', accessibleName: 'Save', ariaRole: 'button',
          cssSelector: 'button.save', elementId: 'stale-save-001',
        }),
        valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
        domContext: makeDomContext(),
      } as ElementRecordedEvent,
    ];

    const v2 = detectInteractionsV2(events);
    // The stale dropdown should have been committed (either CustomDropdown or Click)
    expect(v2.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Stage 4e: Pending Buffer — Date Picker Lifecycle', () => {
  beforeEach(() => { setupChromeMock(); resetCounter(); });

  it('date trigger click + scroll + dateSelect → ONE DatePicker', () => {
    const events: RecordedEvent[] = [
      // 1. Click on date trigger
      makeEvent('click', {
        tag: 'INPUT', className: 'oxd-input oxd-date-input',
        accessibleName: 'yyyy-mm-dd', placeholder: 'yyyy-mm-dd',
        ariaRole: 'combobox', name: 'empDateOfBirth',
        cssSelector: 'input[name="empDateOfBirth"]', elementId: 'dob-001',
      }, {
        inputType: 'text',
        surfaceType: 'popover' as DomContext['surfaceType'],
        ownedByDatePicker: true,
      }),

      // 2. Scroll event (would normally flush!)
      // Note: this scroll has ownedByDatePicker=true, so it's skipped by the engine
      // We use a different scroll that doesn't have ownedByDatePicker
      makeEvent('scroll', {
        tag: 'DIV', className: 'page-content',
        accessibleName: '', ariaRole: null,
        cssSelector: '.page-content', elementId: 'page-scroll-001',
      }),

      // 3. dateSelect event
      makeEvent('dateSelect', {
        tag: 'INPUT', className: 'oxd-input oxd-date-input',
        accessibleName: 'yyyy-mm-dd', placeholder: 'yyyy-mm-dd',
        ariaRole: 'combobox', name: 'empDateOfBirth',
        cssSelector: 'input[name="empDateOfBirth"]', elementId: 'dob-001',
      }, {
        inputType: 'text', dateType: 'date', isoValue: '2005-10-17',
        displayValue: 'October 17, 2005', dateConfidence: 0.8,
      }, '2005-10-17'),
    ];

    const v2 = detectInteractionsV2(events);
    const datePickers = v2.filter(i => i.type === 'DatePicker');
    expect(datePickers.length).toBe(1);

    // No standalone Click from the trigger
    const clicks = v2.filter(i => i.type === 'Click');
    expect(clicks.length).toBe(0);
  });
});

describe('Stage 4e: Pending Buffer — Non-Composite Controls Unaffected', () => {
  beforeEach(() => { setupChromeMock(); resetCounter(); });

  it('two unrelated clicks still produce two interactions (not held pending)', () => {
    const events: RecordedEvent[] = [
      makeEvent('click', {
        tag: 'BUTTON', accessibleName: 'Cancel', ariaRole: 'button',
        cssSelector: 'button.cancel', elementId: 'cancel-001',
      }),
      makeEvent('click', {
        tag: 'BUTTON', accessibleName: 'Save', ariaRole: 'button',
        cssSelector: 'button.save', elementId: 'save-001',
      }),
    ];

    const v2 = detectInteractionsV2(events);
    expect(v2.length).toBe(2);
    expect(v2[0].type).toBe('Click');
    expect(v2[1].type).toBe('Click');
  });

  it('checkbox + scroll + button → checkbox and button (not held)', () => {
    const events: RecordedEvent[] = [
      makeEvent('click', {
        tag: 'INPUT', accessibleName: 'Subscribe', ariaRole: 'checkbox',
        cssSelector: 'input.subscribe', elementId: 'sub-cb-001',
      }),
      makeEvent('scroll', {
        tag: 'DIV', className: 'page', accessibleName: '',
        ariaRole: null, cssSelector: '.page', elementId: 'pg-scroll-001',
      }),
      makeEvent('click', {
        tag: 'BUTTON', accessibleName: 'Submit', ariaRole: 'button',
        cssSelector: 'button.submit', elementId: 'submit-001',
      }),
    ];

    const v2 = detectInteractionsV2(events);
    // Should have: Checkbox + Scroll + Click (or merge Scroll with something)
    const types = v2.map(i => i.type);
    expect(types).toContain('Checkbox');
  });

  it('text entry + scroll + button → text entry and button', () => {
    const baseTime = Date.now();
    const events: RecordedEvent[] = [
      {
        eventId: 'te-fn-1', eventType: 'focus',
        timestamp: new Date(baseTime).toISOString(),
        target: makeIdentity({
          tag: 'INPUT', accessibleName: 'First Name', ariaRole: 'textbox',
          cssSelector: 'input.firstName', elementId: 'fn-001',
        }),
        valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
        domContext: makeDomContext({ inputType: 'text' }),
      } as ElementRecordedEvent,
      {
        eventId: 'te-fn-2', eventType: 'change',
        timestamp: new Date(baseTime + 500).toISOString(),
        target: makeIdentity({
          tag: 'INPUT', accessibleName: 'First Name', ariaRole: 'textbox',
          cssSelector: 'input.firstName', elementId: 'fn-001',
        }),
        valueBefore: null, valueAfter: 'John', checkedBefore: null, checkedAfter: null,
        domContext: makeDomContext({ inputType: 'text' }),
      } as ElementRecordedEvent,
      {
        eventId: 'te-sc-1', eventType: 'scroll',
        timestamp: new Date(baseTime + 1000).toISOString(),
        target: makeIdentity({
          tag: 'DIV', className: 'page', accessibleName: '',
          ariaRole: null, cssSelector: '.page', elementId: 'pg-scroll-002',
        }),
        valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
        domContext: makeDomContext(),
      } as ElementRecordedEvent,
      {
        eventId: 'te-sv-1', eventType: 'click',
        timestamp: new Date(baseTime + 1500).toISOString(),
        target: makeIdentity({
          tag: 'BUTTON', accessibleName: 'Save', ariaRole: 'button',
          cssSelector: 'button.save', elementId: 'save-002',
        }),
        valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
        domContext: makeDomContext(),
      } as ElementRecordedEvent,
    ];

    const v2 = detectInteractionsV2(events);
    const types = v2.map(i => i.type);
    expect(types).toContain('TextEntry');
  });
});

describe('Stage 4e: Pending Buffer — Full Merge Pipeline', () => {
  beforeEach(() => { setupChromeMock(); resetCounter(); });

  it('full pipeline: dropdown trigger + scroll + option → ONE CustomDropdown in merge', () => {
    const events: RecordedEvent[] = [
      makeEvent('click', {
        tag: 'DIV', className: 'oxd-select-text', accessibleName: 'Marital Status',
        ariaRole: 'combobox', cssSelector: 'div.oxd-select-text', elementId: 'ms-dd-001',
      }, { ariaExpanded: 'true', ariaHasPopup: 'listbox' }),
      makeEvent('scroll', {
        tag: 'DIV', className: 'oxd-select-dropdown', accessibleName: '',
        ariaRole: null, cssSelector: '.oxd-select-dropdown', elementId: 'dd-scroll-002',
      }),
      makeEvent('click', {
        tag: 'DIV', className: 'oxd-select-option', accessibleName: 'Married',
        ariaRole: 'option', cssSelector: 'div.oxd-select-option', elementId: 'ms-opt-001',
      }),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);
    const { interactions: merged } = mergeV1V2(v2, v1, events.length);

    // V2 should produce one CustomDropdown
    const customDropdowns = merged.filter(i => i.type === 'CustomDropdown');
    expect(customDropdowns.length).toBe(1);
  });
});
