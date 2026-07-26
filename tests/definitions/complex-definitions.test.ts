/**
 * Unit Tests: Complex Component Definitions
 *
 * Tests DatePicker, Scroll, Hover, and Navigation definitions —
 * including OrangeHRM-specific bug fix scenarios.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3, §4
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTarget(
  overrides: Partial<ElementIdentity> = {},
): ElementIdentity {
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
    elementId: '',
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<DomContext> = {},
): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    ...overrides,
  };
}

function makeEvent(
  eventId: string,
  eventType: string,
  target: Partial<ElementIdentity>,
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType: eventType as any,
    target: makeTarget(target),
    domContext: makeContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime() {
  let emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

// ── DatePicker Tests ─────────────────────────────────────────────────

describe('DatePicker Definition', () => {
  it('triggers on focus of native date input', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', stableId: 'dob', accessibleName: 'Date of Birth', name: 'date_of_birth' };

    runtime.process(makeEvent('f1', 'focus', target, { inputType: 'date' }));
    expect(runtime.activeCount).toBe(1);
    expect(emitted.length).toBe(0); // lifecycle started, not yet completed
  });

  it('triggers on click of OXD date input', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'DIV', stableId: 'oxd-date', className: 'oxd-date-input', accessibleName: 'Date of Birth' };

    runtime.process(makeEvent('c1', 'click', target, {}, { valueBefore: '1987-09-19' }));
    expect(runtime.activeCount).toBe(1);
  });

  it('completes on calendar cell click', () => {
    const { runtime, emitted } = setupRuntime();
    const trigger = { tag: 'DIV', stableId: 'oxd-date', className: 'oxd-date-input', accessibleName: 'Date of Birth' };

    // Open picker
    runtime.process(makeEvent('c1', 'click', trigger));

    // Click a calendar cell
    const cell = { tag: 'DIV', ariaRole: 'gridcell', className: 'oxd-date-day', accessibleName: '15' };
    runtime.process(
      makeEvent('c2', 'click', cell, {}, { valueAfter: '2026-07-15' }),
    );

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const dp = emitted.find((e) => e.type === 'DatePicker');
    expect(dp).toBeDefined();
    expect(dp!.metadata.selectedDate).toBe('15');
    expect(dp!.metadata.dateValue).toBe('2026-07-15');
  });

  // Bug 7: Navigation buttons must NOT complete the lifecycle
  it('does NOT complete on calendar navigation button click (Bug 7)', () => {
    const { runtime, emitted } = setupRuntime();
    const trigger = { tag: 'DIV', stableId: 'oxd-date', className: 'oxd-date-input', accessibleName: 'Date of Birth' };

    runtime.process(makeEvent('c1', 'click', trigger));

    // Click Next Month button
    const navBtn = { tag: 'BUTTON', ariaRole: 'button', className: 'oxd-calendar-switch-button', accessibleName: 'Next Month' };
    runtime.process(makeEvent('c2', 'click', navBtn));

    const dp = emitted.find((e) => e.type === 'DatePicker');
    expect(dp).toBeUndefined(); // not completed yet
    expect(runtime.activeCount).toBe(1); // still active
  });

  it('completes on native input change event', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'INPUT', stableId: 'native-date', accessibleName: 'Birthday', name: 'birthday' };

    runtime.process(makeEvent('f1', 'focus', target, { inputType: 'date' }));
    runtime.process(
      makeEvent('ch1', 'change', target, { inputType: 'date' }, { valueAfter: '1990-06-15' }),
    );

    const dp = emitted.find((e) => e.type === 'DatePicker');
    expect(dp).toBeDefined();
    expect(dp!.metadata.dateValue).toBe('1990-06-15');
  });

  // Empty date selection
  it('does NOT complete when dateValue is empty', () => {
    const { runtime, emitted } = setupRuntime();
    const trigger = { tag: 'DIV', stableId: 'oxd-date', className: 'oxd-date-input', accessibleName: 'Expiry Date' };

    runtime.process(makeEvent('c1', 'click', trigger));

    // Click a cell with no value
    const cell = { tag: 'DIV', ariaRole: 'gridcell', className: 'oxd-date-day', accessibleName: '' };
    runtime.process(makeEvent('c2', 'click', cell));

    const dp = emitted.find((e) => e.type === 'DatePicker');
    expect(dp).toBeUndefined(); // not completed because dateValue was empty
  });

  it('abandons when user clicks outside the datepicker', () => {
    const { runtime, emitted } = setupRuntime();
    const trigger = { tag: 'DIV', stableId: 'oxd-date', className: 'oxd-date-input', accessibleName: 'Date of Birth' };

    runtime.process(makeEvent('c1', 'click', trigger));

    // Click outside
    runtime.process(makeEvent('c2', 'click', { tag: 'BUTTON', accessibleName: 'Save', stableId: 'save-btn' }));

    const dp = emitted.find((e) => e.type === 'DatePicker');
    expect(dp).toBeDefined();
    expect(dp!.endState).toBe('abandoned');
  });
});

// ── Bug 3: DatePicker Dedup ─────────────────────────────────────────

describe('DatePicker Dedup (Bug 3)', () => {
  it('suppresses double-trigger from focus-back on input after cell click', () => {
    const { runtime, emitted } = setupRuntime();
    const trigger = { tag: 'DIV', stableId: 'oxd-date', className: 'oxd-date-input', accessibleName: 'Joining Date' };

    // Open picker
    runtime.process(makeEvent('c1', 'click', trigger, {}, { timestamp: 1000 }));

    // Select a date cell
    const cell = { tag: 'DIV', ariaRole: 'gridcell', className: 'oxd-date-day', accessibleName: '27' };
    runtime.process(makeEvent('c2', 'click', cell, {}, { valueAfter: '2026-07-27', timestamp: 1200 }));

    // OXD fires focus back on the input → triggers new lifecycle
    runtime.process(makeEvent('f3', 'focus', trigger, {}, { timestamp: 1300 }));

    // OXD fires change event → would complete lifecycle B
    runtime.process(makeEvent('ch4', 'change', trigger, {}, { valueAfter: '2026-07-27', timestamp: 1400 }));

    // Should have only ONE DatePicker interaction (dedup suppressed the second)
    const dps = emitted.filter((e) => e.type === 'DatePicker' && e.endState === 'completed');
    expect(dps.length).toBe(1);
  });
});

// ── Scroll Tests ─────────────────────────────────────────────────────

describe('Scroll Definition', () => {
  it('captures scroll events with non-zero delta', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('s1', 'scroll', { tag: 'DIV', stableId: 'page' }, {}, { scrollDeltaY: 100, scrollDeltaX: 0 }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Scroll');
    expect(emitted[0].metadata.hasDelta).toBe(true);
  });

  // Bug 5: Scroll 0px events
  it('captures scroll events with 0px delta but marks hasDelta=false (Bug 5)', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('s1', 'scroll', { tag: 'DIV', stableId: 'page' }, {}, { scrollDeltaY: 0, scrollDeltaX: 0 }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].metadata.hasDelta).toBe(false);
  });
});

// ── Hover Tests ──────────────────────────────────────────────────────

describe('Hover Definition', () => {
  it('captures hover on interactive element with dwell > 500ms', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'BUTTON', stableId: 'btn1', accessibleName: 'Settings' };

    runtime.process(makeEvent('me1', 'mouseenter', target, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', target, {}, { timestamp: 2000 })); // 1000ms dwell

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.metadata.dwellMs).toBe(1000);
  });

  it('discards hover when dwell < 500ms (transit)', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { tag: 'BUTTON', stableId: 'btn2', accessibleName: 'Menu' };

    runtime.process(makeEvent('me1', 'mouseenter', target, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', target, {}, { timestamp: 1300 })); // 300ms dwell

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('discarded');
  });
});

// ── Navigation Tests ─────────────────────────────────────────────────

describe('Navigation Definition', () => {
  it('captures navigation events', () => {
    const { runtime, emitted } = setupRuntime();
    runtime.process(
      makeEvent('n1', 'navigation', { tag: 'HTML', accessibleName: '' }, {}, { pageUrl: 'https://example.com/dashboard', pageTitle: 'Dashboard' }),
    );
    expect(emitted.length).toBeGreaterThanOrEqual(1);
    const nav = emitted.find((e) => e.type === 'Navigation');
    expect(nav).toBeDefined();
    expect(nav!.metadata.pageUrl).toBe('https://example.com/dashboard');
  });

  it('flushes active components on navigation', () => {
    const { runtime, emitted } = setupRuntime();
    // Start a text entry
    runtime.process(
      makeEvent('f1', 'focus', { tag: 'INPUT', ariaRole: 'textbox', stableId: 'search', accessibleName: 'Search' }, { inputType: 'text' }),
    );
    expect(runtime.activeCount).toBe(1);

    // Navigate
    runtime.process(
      makeEvent('n1', 'navigation', { tag: 'HTML', accessibleName: '' }, {}, { pageUrl: 'https://example.com/results', pageTitle: 'Results' }),
    );

    // TextEntry should be interrupted, Navigation captured
    const text = emitted.find((e) => e.type === 'TextEntry');
    expect(text).toBeDefined();
    expect(text!.endState).toBe('interrupted');
    expect(runtime.activeCount).toBe(0);
  });
});
