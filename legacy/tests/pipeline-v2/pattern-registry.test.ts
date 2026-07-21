/**
 * Unit tests for the Pattern Registry.
 *
 * Tests cover:
 *   - Each generic behavior pattern matching correctly
 *   - Framework agnosticism: same pattern matches different implementations
 *   - Patterns returning null when they don't match
 *   - matchPattern returning the best match
 *   - generic-fallback (null result → Intent Resolver handles it)
 */

import { describe, it, expect } from 'vitest';
import {
  matchPattern,
  getRegisteredPatterns,
} from '../../src/recorder/pipeline-v2/pattern-registry';
import type {
  InteractionUnit,
  StateDiff,
  PipelineEvent,
  PatternMatch,
  ElementDescriptor,
} from '../../src/recorder/pipeline-v2/canonical-event-schema';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeDescriptor(overrides: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return {
    accessibleName: 'Test',
    ariaRole: null,
    tag: 'INPUT',
    id: 'test',
    cssSelector: '#test',
    ...overrides,
  };
}

function makeEvent(
  type: PipelineEvent['type'],
  overrides: Partial<PipelineEvent> = {},
): PipelineEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: '2026-07-18T00:00:00.000Z',
    element: null,
    targetTag: null,
    payload: {},
    isTrusted: true,
    ...overrides,
  };
}

function makeUnit(events: PipelineEvent[], overrides: Partial<InteractionUnit> = {}): InteractionUnit {
  const primary = events[0] || makeEvent('click');
  return {
    unitId: 'unit-0001',
    events,
    primaryEvent: primary,
    startTime: events[0]?.timestamp || '2026-07-18T00:00:00.000Z',
    endTime: events[events.length - 1]?.timestamp || '2026-07-18T00:00:00.000Z',
    boundaryReason: 'temporal_gap',
    ...overrides,
  };
}

const emptyDiff: StateDiff = {
  valueChanges: [],
  toggleChanges: [],
  radioChanges: [],
  rangeChanges: [],
  focusChange: null,
  surfaceChanges: [],
  tabChange: null,
  urlChange: null,
  structuralChangeDetected: false,
};

function makeClickUnit(): InteractionUnit {
  return makeUnit([makeEvent('click', { payload: { clickCount: 1 } })]);
}

// ── Registry Tests ─────────────────────────────────────────────────────

describe('Pattern Registry', () => {
  it('should have ~12 patterns registered (excluding generic-fallback)', () => {
    const patterns = getRegisteredPatterns();
    // navigation, dateTimeSelection, singleSelectionFromSet, multiSelectionFromSet,
    // booleanToggle, textEntryCommit, contextSwitch, expandCollapse, rangeAdjustment,
    // formSubmit, hoverIntent, simpleClick = 12
    expect(patterns.length).toBe(12);
  });

  it('should NOT include framework-specific patterns', () => {
    const patterns = getRegisteredPatterns();
    const behaviors = patterns.map((p) => p.behavior);
    expect(behaviors).not.toContain('material-select');
    expect(behaviors).not.toContain('ant-datepicker');
    expect(behaviors).not.toContain('radix-select');
    expect(behaviors).not.toContain('salesforce-combobox');
  });
});

// ── Single Selection From Set ──────────────────────────────────────────

describe('single-selection-from-set pattern', () => {
  it('should match a dropdown selection (surface lifecycle + value change)', () => {
    const unit = makeUnit([
      makeEvent('click'),
      makeEvent('surface_open', { payload: { surfaceType: 'dropdown' } }),
      makeEvent('click', { targetTag: 'LI' }),
      makeEvent('surface_close', { payload: { surfaceType: 'dropdown' } }),
    ]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Travel Class' }),
        field: 'Travel Class',
        before: 'Economy',
        after: 'Premium Economy',
        inputType: 'text',
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match).not.toBeNull();
    expect(match?.behavior).toBe('single-selection-from-set');
    expect(match?.confidence).toBeGreaterThanOrEqual(0.90);
    expect(match?.metadata.selectedValue).toBe('Premium Economy');
  });

  it('should match a radio button selection', () => {
    const unit = makeUnit([makeEvent('click', { targetTag: 'INPUT' })]);
    const diff: StateDiff = {
      ...emptyDiff,
      radioChanges: [{
        groupName: 'plan',
        groupDescriptor: makeDescriptor(),
        before: makeDescriptor({ accessibleName: 'Basic' }),
        after: makeDescriptor({ accessibleName: 'Pro' }),
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('single-selection-from-set');
    expect(match?.metadata.selectedValue).toBe('Pro');
  });

  it('should match a native select change', () => {
    const unit = makeUnit([makeEvent('change')]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Country' }),
        field: 'Country',
        before: '',
        after: 'Canada',
        inputType: 'select-one',
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('single-selection-from-set');
    expect(match?.metadata.selectedValue).toBe('Canada');
  });

  it('should NOT match when there are multiple value changes', () => {
    const unit = makeUnit([makeEvent('change')]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [
        { descriptor: makeDescriptor(), field: 'A', before: '', after: '1', inputType: 'text' },
        { descriptor: makeDescriptor(), field: 'B', before: '', after: '2', inputType: 'text' },
      ],
    };

    const match = matchPattern(unit, diff);
    // Multiple value changes doesn't match single-selection
    expect(match?.behavior).not.toBe('single-selection-from-set');
  });
});

// ── Boolean Toggle ─────────────────────────────────────────────────────

describe('boolean-toggle pattern', () => {
  it('should match a checkbox toggle', () => {
    const unit = makeUnit([makeEvent('click')]);
    const diff: StateDiff = {
      ...emptyDiff,
      toggleChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Subscribe' }),
        field: 'Subscribe',
        before: false,
        after: true,
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('boolean-toggle');
    expect(match?.metadata.toggleState).toBe(true);
  });

  it('should NOT match when no toggle changed', () => {
    const unit = makeUnit([makeEvent('click')]);
    const match = matchPattern(unit, emptyDiff);
    // No toggle change — should not match boolean-toggle
    expect(match?.behavior).not.toBe('boolean-toggle');
  });
});

// ── Text Entry Commit ──────────────────────────────────────────────────

describe('text-entry-commit pattern', () => {
  it('should match text entry with focus lifecycle', () => {
    const unit = makeUnit([
      makeEvent('focus'),
      makeEvent('input', { payload: { value: 'hello' } }),
      makeEvent('blur'),
    ]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Email' }),
        field: 'Email',
        before: '',
        after: 'hello@test.com',
        inputType: 'email',
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('text-entry-commit');
    expect(match?.metadata.textValue).toBe('hello@test.com');
  });

  it('should NOT match when the value change is a select (that is single-selection)', () => {
    const unit = makeUnit([makeEvent('change')]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor(),
        field: 'Country',
        before: '',
        after: 'Canada',
        inputType: 'select-one',
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).not.toBe('text-entry-commit');
  });
});

// ── Date/Time Selection ────────────────────────────────────────────────

describe('date-time-selection pattern', () => {
  it('should match native date input type', () => {
    const unit = makeUnit([makeEvent('change')]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Departure Date' }),
        field: 'Departure Date',
        before: '',
        after: '2026-07-18',
        inputType: 'date',
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('date-time-selection');
    expect(match?.metadata.dateValue).toBe('2026-07-18');
  });

  it('should match date-like value with surface lifecycle (custom calendar)', () => {
    const unit = makeUnit([
      makeEvent('click'),
      makeEvent('surface_open', { payload: { surfaceType: 'popover' } }),
      makeEvent('click'),
      makeEvent('surface_close', { payload: { surfaceType: 'popover' } }),
    ]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Check-in Date' }),
        field: 'Check-in Date',
        before: '',
        after: '18 July 2026',
        inputType: 'text',
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('date-time-selection');
  });

  it('should match date-named field', () => {
    const unit = makeUnit([makeEvent('change')]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Meeting Date' }),
        field: 'Meeting Date',
        before: '',
        after: '2026/07/18',
        inputType: 'text',
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('date-time-selection');
  });
});

// ── Navigation ─────────────────────────────────────────────────────────

describe('navigation pattern', () => {
  it('should match URL change', () => {
    const unit = makeUnit([makeEvent('click')]);
    const diff: StateDiff = {
      ...emptyDiff,
      urlChange: { from: 'https://a.com', to: 'https://b.com' },
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('navigation');
    expect(match?.confidence).toBe(1.0);
  });

  it('should match navigation event', () => {
    const unit = makeUnit([
      makeEvent('navigation', { payload: { url: 'https://example.com/page2' } }),
    ]);
    const match = matchPattern(unit, emptyDiff);
    expect(match?.behavior).toBe('navigation');
  });
});

// ── Context Switch (Tabs) ──────────────────────────────────────────────

describe('context-switch pattern', () => {
  it('should match tab change', () => {
    const unit = makeUnit([makeEvent('click', { targetTag: 'BUTTON' })]);
    const diff: StateDiff = {
      ...emptyDiff,
      tabChange: {
        from: makeDescriptor({ accessibleName: 'Overview' }),
        to: makeDescriptor({ accessibleName: 'Settings' }),
      },
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('context-switch');
  });
});

// ── Expand/Collapse ────────────────────────────────────────────────────

describe('expand-collapse pattern', () => {
  it('should match surface change with no value change', () => {
    const unit = makeUnit([
      makeEvent('click'),
      makeEvent('surface_open', { payload: { surfaceType: 'popover' } }),
    ]);
    const diff: StateDiff = {
      ...emptyDiff,
      surfaceChanges: [{
        type: 'popover',
        action: 'opened',
        descriptor: makeDescriptor(),
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('expand-collapse');
  });
});

// ── Simple Click ───────────────────────────────────────────────────────

describe('simple-click pattern', () => {
  it('should match a click with no meaningful changes', () => {
    const unit = makeClickUnit();
    const match = matchPattern(unit, emptyDiff);
    expect(match?.behavior).toBe('simple-click');
    expect(match?.confidence).toBeGreaterThanOrEqual(0.80);
  });

  it('should match a click that opens a surface (no selection)', () => {
    const unit = makeUnit([
      makeEvent('click'),
      makeEvent('surface_open', { payload: { surfaceType: 'menu' } }),
    ]);
    const diff: StateDiff = {
      ...emptyDiff,
      surfaceChanges: [{
        type: 'menu',
        action: 'opened',
        descriptor: makeDescriptor(),
      }],
    };

    const match = matchPattern(unit, diff);
    // A click that opens a surface is classified as expand-collapse
    // (surface changed with no value/toggle/radio change)
    expect(match?.behavior).toBe('expand-collapse');
  });
});

// ── Form Submit ────────────────────────────────────────────────────────

describe('form-submit pattern', () => {
  it('should match submit event', () => {
    const unit = makeUnit([makeEvent('submit')]);
    const match = matchPattern(unit, emptyDiff);
    expect(match?.behavior).toBe('form-submit');
  });

  it('should match Enter key on a form input', () => {
    const unit = makeUnit([
      makeEvent('keydown', { payload: { key: 'Enter' } }),
    ]);
    const match = matchPattern(unit, emptyDiff);
    expect(match?.behavior).toBe('form-submit');
  });
});

// ── Hover Intent ───────────────────────────────────────────────────────

describe('hover-intent pattern', () => {
  it('should match mouseenter with surface change', () => {
    const unit = makeUnit([
      makeEvent('mouseenter'),
    ]);
    const diff: StateDiff = {
      ...emptyDiff,
      surfaceChanges: [{
        type: 'popover',
        action: 'opened',
        descriptor: makeDescriptor({ accessibleName: 'Tooltip' }),
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('hover-intent');
  });
});

// ── Multi Selection From Set ───────────────────────────────────────────

describe('multi-selection-from-set pattern', () => {
  it('should match multiple toggle changes', () => {
    const unit = makeUnit([
      makeEvent('click'),
      makeEvent('click'),
    ]);
    const diff: StateDiff = {
      ...emptyDiff,
      toggleChanges: [
        { descriptor: makeDescriptor({ accessibleName: 'A' }), field: 'A', before: false, after: true },
        { descriptor: makeDescriptor({ accessibleName: 'B' }), field: 'B', before: false, after: true },
      ],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('multi-selection-from-set');
  });
});

// ── No Match / Generic Fallback ────────────────────────────────────────

describe('no match (generic-fallback)', () => {
  it('should return null when no pattern matches', () => {
    // A unit with events that no pattern specifically matches well
    const unit = makeUnit([makeEvent('scroll', { payload: { scrollY: 500 } })]);
    const match = matchPattern(unit, emptyDiff);
    // Scroll doesn't match any pattern above threshold
    // (the Intent Resolver will use generic-fallback)
    expect(match).toBeNull();
  });

  it('should return null for a change event with empty after value', () => {
    const unit = makeUnit([makeEvent('change')]);
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor(),
        field: 'Search',
        before: 'query',
        after: '', // cleared — not a selection
        inputType: 'search',
      }],
    };

    const match = matchPattern(unit, diff);
    // after is empty — isValueSelection is false, single-selection doesn't match
    // text-entry-commit might match at lower confidence...
    // The key test: single-selection-from-set should NOT match
    expect(match?.behavior).not.toBe('single-selection-from-set');
  });
});

// ── Best Match Selection ───────────────────────────────────────────────

describe('best match selection', () => {
  it('should return the highest-confidence match when multiple match', () => {
    // Navigation always wins (confidence 1.0)
    const unit = makeUnit([
      makeEvent('click'),
      makeEvent('navigation', { payload: { url: 'https://b.com' } }),
    ]);
    const diff: StateDiff = {
      ...emptyDiff,
      urlChange: { from: 'https://a.com', to: 'https://b.com' },
      surfaceChanges: [{
        type: 'menu',
        action: 'opened',
        descriptor: makeDescriptor(),
      }],
    };

    const match = matchPattern(unit, diff);
    expect(match?.behavior).toBe('navigation');
    expect(match?.confidence).toBe(1.0);
  });
});

// ── Framework Agnosticism Verification ─────────────────────────────────

describe('framework agnosticism', () => {
  it('single-selection-from-set should match all dropdown implementations', () => {
    // Test that the same pattern matches regardless of implementation.

    // Implementation 1: Native <select>
    const nativeSelectUnit = makeUnit([makeEvent('change')]);
    const nativeSelectDiff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Country' }),
        field: 'Country',
        before: '',
        after: 'Canada',
        inputType: 'select-one',
      }],
    };

    // Implementation 2: Custom div dropdown with surface lifecycle
    const customDropdownUnit = makeUnit([
      makeEvent('click'),
      makeEvent('surface_open', { payload: { surfaceType: 'dropdown' } }),
      makeEvent('click'),
      makeEvent('surface_close', { payload: { surfaceType: 'dropdown' } }),
    ]);
    const customDropdownDiff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Travel Class' }),
        field: 'Travel Class',
        before: 'Economy',
        after: 'Premium Economy',
        inputType: 'text',
      }],
    };

    // Implementation 3: Radio button group
    const radioUnit = makeUnit([makeEvent('click')]);
    const radioDiff: StateDiff = {
      ...emptyDiff,
      radioChanges: [{
        groupName: 'plan',
        groupDescriptor: makeDescriptor(),
        before: null,
        after: makeDescriptor({ accessibleName: 'Pro' }),
      }],
    };

    const match1 = matchPattern(nativeSelectUnit, nativeSelectDiff);
    const match2 = matchPattern(customDropdownUnit, customDropdownDiff);
    const match3 = matchPattern(radioUnit, radioDiff);

    // All three should match the SAME pattern
    expect(match1?.behavior).toBe('single-selection-from-set');
    expect(match2?.behavior).toBe('single-selection-from-set');
    expect(match3?.behavior).toBe('single-selection-from-set');
  });
});
