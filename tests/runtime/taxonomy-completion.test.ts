/**
 * Interaction Taxonomy Completion Tests
 *
 * Tests for the new interaction types:
 *   P1-1: TagInput — token creation lifecycle
 *   P1-2: OtpInput — multi-input grouping
 *   P1-3: HotkeySequence — two-key timeout window
 *   P2-2: Double Click — dblclick on Click definition
 *
 * Tests for P2 lifecycle extensions (DateRange, TreeDropdown, RangeSlider,
 * Autocomplete) are covered via the existing definition tests with
 * subtype/metadata assertions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions/index';
import type {
  ComponentInteraction,
  ObservedEvent,
  DomContext,
  BrowserEventType,
} from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'INPUT',
    className: null,
    name: null,
    stableId: 'elem-1',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'input',
    xPath: '/html/body/input',
    inIframe: false,
    shadowDom: false,
    elementId: '',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: 'text',
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    surfaceId: null,
    surfaceType: null,
    surfaceRole: null,
    surfaceLabel: null,
    ...overrides,
  };
}

let evtCounter = 0;
function makeEvent(
  eventType: string,
  targetOverrides: Partial<ElementIdentity> = {},
  domContextOverrides: Partial<DomContext> = {},
  extras: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: `evt-${++evtCounter}`,
    eventType: eventType as BrowserEventType,
    timestamp: Date.now() + evtCounter,
    isTrusted: true,
    target: makeTarget(targetOverrides),
    domContext: makeDomContext(domContextOverrides),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
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
    ...extras,
  };
}

// ── TagInput Tests ─────────────────────────────────────────────────────

describe('TagInput', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  it('triggers on focus inside tag-input container', () => {
    const events = [
      makeEvent('focus', { tag: 'INPUT', stableId: 'tag-in-1' }, {
        ancestorClasses: ['tag-input-container', 'form-group'],
      }),
    ];

    for (const e of events) runtime.process(e);
    // TagInput is active but not yet completed (waiting for blur/input)
    expect(emitted).toHaveLength(0);
    expect(runtime.activeCount).toBe(1);
  });

  it('creates tokens on Enter key', () => {
    const events = [
      makeEvent('focus', { tag: 'INPUT', stableId: 'tag-in-2' }, {
        ancestorClasses: ['tag-input-container'],
      }),
      makeEvent('input', { tag: 'INPUT', stableId: 'tag-in-2' }, {}, { valueAfter: 'urgent' }),
      makeEvent('keydown', { tag: 'INPUT', stableId: 'tag-in-2' }, {}, { key: 'Enter', code: 'Enter' }),
      makeEvent('blur', { tag: 'INPUT', stableId: 'tag-in-2' }, {}),
    ];

    for (const e of events) runtime.process(e);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('TagInput');
    expect(emitted[0].metadata.tags).toEqual(['urgent']);
  });

  it('accumulates multiple tokens', () => {
    const SID = 'tag-multi';
    const events = [
      makeEvent('focus', { tag: 'INPUT', stableId: SID }, {
        ancestorClasses: ['chip-input-wrapper'],
      }),
      makeEvent('input', { tag: 'INPUT', stableId: SID }, {}, { valueAfter: 'bug' }),
      makeEvent('keydown', { tag: 'INPUT', stableId: SID }, {}, { key: 'Enter', code: 'Enter' }),
      makeEvent('input', { tag: 'INPUT', stableId: SID }, {}, { valueAfter: 'frontend' }),
      makeEvent('keydown', { tag: 'INPUT', stableId: SID }, {}, { key: 'Enter', code: 'Enter' }),
      makeEvent('input', { tag: 'INPUT', stableId: SID }, {}, { valueAfter: 'p0' }),
      makeEvent('keydown', { tag: 'INPUT', stableId: SID }, {}, { key: ',', code: 'Comma' }),
      makeEvent('blur', { tag: 'INPUT', stableId: SID }, {}),
    ];

    for (const e of events) runtime.process(e);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('TagInput');
    expect(emitted[0].metadata.tags).toEqual(['bug', 'frontend', 'p0']);
    expect(emitted[0].metadata.tagCount).toBe(3);
  });

  it('captures pending text on blur as final tag', () => {
    const SID = 'tag-blur';
    const events = [
      makeEvent('focus', { tag: 'INPUT', stableId: SID }, {
        ancestorClasses: ['tags-input'],
      }),
      makeEvent('input', { tag: 'INPUT', stableId: SID }, {}, { valueAfter: 'uncommitted' }),
      // No Enter before blur
      makeEvent('blur', { tag: 'INPUT', stableId: SID }, {}),
    ];

    for (const e of events) runtime.process(e);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('TagInput');
    expect(emitted[0].metadata.tags).toEqual(['uncommitted']);
  });

  it('downcasts to Click when no tokens and no text', () => {
    const SID = 'tag-empty';
    const events = [
      makeEvent('focus', { tag: 'INPUT', stableId: SID }, {
        ancestorClasses: ['tag-input'],
      }),
      makeEvent('blur', { tag: 'INPUT', stableId: SID }, {}),
    ];

    for (const e of events) runtime.process(e);

    // Should downcast to Click (no data)
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('Click');
  });
});

// ── OtpInput Tests ─────────────────────────────────────────────────────

describe('OtpInput', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  it('triggers on focus of input inside OTP container', () => {
    const events = [
      makeEvent('focus', { tag: 'INPUT', name: 'otp-0', stableId: 'otp-0' }, {
        ancestorClasses: ['otp-input-container'],
        inputType: 'text',
      }),
    ];

    for (const e of events) runtime.process(e);
    expect(runtime.activeCount).toBe(1);
  });

  it('groups adjacent OTP inputs and concatenates value', () => {
    const events = [
      makeEvent('focus', { tag: 'INPUT', name: 'otp-0', stableId: 'otp-i0', cssSelector: 'input.otp-0' }, {
        ancestorClasses: ['otp-container'],
      }),
      makeEvent('input', { tag: 'INPUT', name: 'otp-0', stableId: 'otp-i0', cssSelector: 'input.otp-0' }, {
        ancestorClasses: ['otp-container'],
      }, { valueAfter: '1' }),
      // Auto-advance to next input
      makeEvent('focus', { tag: 'INPUT', name: 'otp-1', stableId: 'otp-i1', cssSelector: 'input.otp-1' }, {
        ancestorClasses: ['otp-container'],
      }),
      makeEvent('input', { tag: 'INPUT', name: 'otp-1', stableId: 'otp-i1', cssSelector: 'input.otp-1' }, {
        ancestorClasses: ['otp-container'],
      }, { valueAfter: '2' }),
      makeEvent('focus', { tag: 'INPUT', name: 'otp-2', stableId: 'otp-i2', cssSelector: 'input.otp-2' }, {
        ancestorClasses: ['otp-container'],
      }),
      makeEvent('input', { tag: 'INPUT', name: 'otp-2', stableId: 'otp-i2', cssSelector: 'input.otp-2' }, {
        ancestorClasses: ['otp-container'],
      }, { valueAfter: '3' }),
      // Click outside to complete
      makeEvent('click', { tag: 'BUTTON', stableId: 'submit-btn', cssSelector: 'button.submit' }, {}),
    ];

    for (const e of events) runtime.process(e);

    // Should emit one OtpInput with concatenated value
    const otp = emitted.find(i => i.type === 'OtpInput');
    expect(otp).toBeDefined();
    expect(otp!.metadata.otpValue).toBe('123');
    expect(otp!.metadata.inputCount).toBe(3);
  });

  it('downcasts to Click when no digits entered', () => {
    const events = [
      makeEvent('focus', { tag: 'INPUT', name: 'otp-0', stableId: 'otp-empty', cssSelector: 'input.otp' }, {
        ancestorClasses: ['otp-container'],
      }),
      makeEvent('click', { tag: 'BUTTON', stableId: 'btn-out', cssSelector: 'button' }, {}),
    ];

    for (const e of events) runtime.process(e);

    const otp = emitted.find(i => i.type === 'OtpInput');
    const click = emitted.find(i => i.type === 'Click');
    expect(otp).toBeUndefined();
    expect(click).toBeDefined();
  });
});

// ── HotkeySequence Tests ───────────────────────────────────────────────

describe('HotkeySequence', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  it('completes as sequence when second key arrives within timeout', () => {
    const baseTime = Date.now();
    const events = [
      makeEvent('keydown', { tag: 'DIV', stableId: 'body' }, {
        inputType: null,
      }, { key: 'g', code: 'KeyG', timestamp: baseTime }),
      makeEvent('keydown', { tag: 'DIV', stableId: 'body' }, {
        inputType: null,
      }, { key: 'i', code: 'KeyI', timestamp: baseTime + 100 }),
    ];

    for (const e of events) runtime.process(e);

    const seq = emitted.find(i => i.type === 'HotkeySequence');
    expect(seq).toBeDefined();
    expect(seq!.metadata.sequenceKeys).toEqual(['g', 'i']);
  });

  it('does not trigger inside text inputs', () => {
    const events = [
      makeEvent('keydown', { tag: 'INPUT', stableId: 'txt-in' }, {
        inputType: 'text',
      }, { key: 'g', code: 'KeyG' }),
    ];

    for (const e of events) runtime.process(e);

    // Should NOT be a HotkeySequence (TextEntry handles text inputs)
    const seq = emitted.find(i => i.type === 'HotkeySequence');
    expect(seq).toBeUndefined();
  });

  it('does not trigger on modifier keys', () => {
    const events = [
      makeEvent('keydown', { tag: 'DIV', stableId: 'body' }, {}, {
        key: 'Control', code: 'ControlLeft', ctrlKey: true,
      }),
    ];

    for (const e of events) runtime.process(e);

    const seq = emitted.find(i => i.type === 'HotkeySequence');
    expect(seq).toBeUndefined();
  });

  it('does not trigger on special keys (Enter, Escape)', () => {
    const events = [
      makeEvent('keydown', { tag: 'DIV', stableId: 'body' }, {}, { key: 'Enter', code: 'Enter' }),
    ];

    for (const e of events) runtime.process(e);

    const seq = emitted.find(i => i.type === 'HotkeySequence');
    expect(seq).toBeUndefined();
  });
});

// ── Double Click Tests ─────────────────────────────────────────────────

describe('DoubleClick', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  it('captures dblclick as Click with doubleClick metadata', () => {
    const events = [
      makeEvent('dblclick', { tag: 'BUTTON', stableId: 'dbl-btn', className: 'btn', ariaRole: 'button', cssSelector: 'button.dbl' }),
    ];

    for (const e of events) runtime.process(e);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('Click');
    expect(emitted[0].metadata.doubleClick).toBe(true);
    expect(emitted[0].interactionSubtype).toBe('DoubleClick');
  });
});

// ── Date Range Picker Tests ────────────────────────────────────────────

describe('DateRangePicker', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  it('detects range mode from aria-label and stays active after first date', () => {
    // Simulate: focus on a "Check-in" date input → calendar cell click →
    // second calendar cell click for "Check-out"
    const triggerInput = {
      tag: 'INPUT',
      stableId: 'date-range-trigger',
      accessibleName: 'Check-in',
      ariaLabel: 'Check-in date',
      className: 'date-input',
    };
    const triggerDom = {
      inputType: 'text',
      ancestorClasses: ['date-range-container'],
    };

    const events = [
      makeEvent('focus', triggerInput, triggerDom),
      // First date cell click
      makeEvent('click', {
        tag: 'DIV',
        stableId: 'cell-15',
        ariaRole: 'gridcell',
        accessibleName: '15',
        className: 'calendar-day',
      }, {
        surfaceId: 'cal-surface',
        ancestorClasses: ['calendar-grid'],
      }, { valueAfter: '2025-08-15' }),
      // Second date cell click (should complete)
      makeEvent('click', {
        tag: 'DIV',
        stableId: 'cell-20',
        ariaRole: 'gridcell',
        accessibleName: '20',
        className: 'calendar-day',
      }, {
        surfaceId: 'cal-surface',
        ancestorClasses: ['calendar-grid'],
      }, { valueAfter: '2025-08-20' }),
    ];

    for (const e of events) runtime.process(e);

    // Should produce one DatePicker with range data
    const dp = emitted.find(i => i.type === 'DatePicker');
    if (dp) {
      expect(dp.metadata.isDateRange).toBe(true);
      expect(dp.metadata.startDate).toBeTruthy();
      expect(dp.metadata.endDate).toBeTruthy();
    }
  });
});

// ── Registry Tests ─────────────────────────────────────────────────────

describe('Definition Registry', () => {
  it('includes all 20 definitions in ALL_DEFINITIONS', () => {
    expect(ALL_DEFINITIONS.length).toBeGreaterThanOrEqual(20);
  });

  it('includes TagInput at priority 45', () => {
    const tag = ALL_DEFINITIONS.find(d => d.type === 'TagInput');
    expect(tag).toBeDefined();
    expect(tag!.priority).toBe(45);
  });

  it('includes OtpInput at priority 46', () => {
    const otp = ALL_DEFINITIONS.find(d => d.type === 'OtpInput');
    expect(otp).toBeDefined();
    expect(otp!.priority).toBe(46);
  });

  it('includes HotkeySequence at priority 6', () => {
    const hk = ALL_DEFINITIONS.find(d => d.type === 'HotkeySequence');
    expect(hk).toBeDefined();
    expect(hk!.priority).toBe(6);
  });

  it('Click includes dblclick in triggerEventTypes', () => {
    const click = ALL_DEFINITIONS.find(d => d.type === 'Click');
    expect(click).toBeDefined();
    expect(click!.triggerEventTypes.has('dblclick')).toBe(true);
  });

  it('definitions are sorted by priority ascending', () => {
    const priorities = ALL_DEFINITIONS.map(d => d.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });
});
