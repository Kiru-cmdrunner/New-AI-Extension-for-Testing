/**
 * ComponentGrouping entity tests.
 *
 * Tests factory validation, lifecycle transitions, and mutation helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  createComponentGrouping,
  addConstituent,
  addObservedTransition,
  promoteToConfirmed,
  rejectComponent,
  setBusinessField,
  setOptionSet,
  isConfirmed,
  isActive,
  createOptionEntry,
} from '../../src/domain/entities/component-grouping';
import {
  PatternType,
  RecognitionSource,
  ComponentLifecycleState,
  ComponentRole,
} from '../../src/domain/enums';
import { MissingFieldError, ValueObjectError } from '../../src/domain/errors/invariant-errors';

function makeBaseInput() {
  return {
    groupingId: 'comp-0001',
    patternType: PatternType.DROPDOWN,
    rootElementId: 'elem-0001',
    constituents: [{ elementId: 'elem-0001', role: ComponentRole.TRIGGER }],
    recognitionSource: RecognitionSource.STRUCTURAL,
    recognitionConfidence: 0.85,
  };
}

describe('createComponentGrouping', () => {
  it('creates component with initial TENTATIVE state', () => {
    const c = createComponentGrouping(makeBaseInput());
    expect(c.groupingId).toBe('comp-0001');
    expect(c.patternType).toBe(PatternType.DROPDOWN);
    expect(c.lifecycleState).toBe(ComponentLifecycleState.TENTATIVE);
    expect(c.businessField).toBeNull();
    expect(c.optionSet).toBeNull();
    expect(c.observedTransitionIds).toEqual([]);
  });

  it('throws MissingFieldError when groupingId is empty', () => {
    expect(() =>
      createComponentGrouping({ ...makeBaseInput(), groupingId: '' }),
    ).toThrow(MissingFieldError);
  });

  it('throws MissingFieldError when rootElementId is empty', () => {
    expect(() =>
      createComponentGrouping({ ...makeBaseInput(), rootElementId: '' }),
    ).toThrow(MissingFieldError);
  });

  it('throws ValueObjectError when constituents is empty', () => {
    expect(() =>
      createComponentGrouping({ ...makeBaseInput(), constituents: [] }),
    ).toThrow(ValueObjectError);
  });

  it('throws ValueObjectError when confidence is below 0.05', () => {
    expect(() =>
      createComponentGrouping({ ...makeBaseInput(), recognitionConfidence: 0.04 }),
    ).toThrow(ValueObjectError);
  });

  it('throws ValueObjectError when confidence is above 0.95', () => {
    expect(() =>
      createComponentGrouping({ ...makeBaseInput(), recognitionConfidence: 0.96 }),
    ).toThrow(ValueObjectError);
  });

  it('accepts confidence at boundaries (0.05 and 0.95)', () => {
    expect(() =>
      createComponentGrouping({ ...makeBaseInput(), recognitionConfidence: 0.05 }),
    ).not.toThrow();
    expect(() =>
      createComponentGrouping({ ...makeBaseInput(), recognitionConfidence: 0.95 }),
    ).not.toThrow();
  });
});

describe('addConstituent', () => {
  it('adds a new constituent', () => {
    const c = createComponentGrouping(makeBaseInput());
    const updated = addConstituent(c, 'elem-0002', ComponentRole.OPTION);
    expect(updated.constituents).toHaveLength(2);
    expect(updated.constituents[1].elementId).toBe('elem-0002');
  });

  it('is idempotent for existing constituents', () => {
    const c = createComponentGrouping(makeBaseInput());
    const updated = addConstituent(c, 'elem-0001', ComponentRole.TRIGGER);
    expect(updated.constituents).toHaveLength(1);
  });
});

describe('addObservedTransition', () => {
  it('records transition and advances lifecycle from tentative to developing', () => {
    const c = createComponentGrouping(makeBaseInput());
    expect(c.lifecycleState).toBe(ComponentLifecycleState.TENTATIVE);

    const updated = addObservedTransition(c, 'trans-0001');
    expect(updated.observedTransitionIds).toContain('trans-0001');
    expect(updated.lifecycleState).toBe(ComponentLifecycleState.DEVELOPING);
  });

  it('does not change state from developing on second transition', () => {
    const c = createComponentGrouping(makeBaseInput());
    const developing = addObservedTransition(c, 'trans-0001');
    const stillDeveloping = addObservedTransition(developing, 'trans-0002');
    expect(stillDeveloping.lifecycleState).toBe(ComponentLifecycleState.DEVELOPING);
  });

  it('is idempotent for existing transitions', () => {
    const c = createComponentGrouping(makeBaseInput());
    const updated = addObservedTransition(c, 'trans-0001');
    const unchanged = addObservedTransition(updated, 'trans-0001');
    expect(unchanged.observedTransitionIds).toHaveLength(1);
  });
});

describe('promoteToConfirmed', () => {
  it('promotes developing component to confirmed', () => {
    const c = createComponentGrouping(makeBaseInput());
    const developing = addObservedTransition(c, 'trans-0001');
    const confirmed = promoteToConfirmed(developing);
    expect(confirmed.lifecycleState).toBe(ComponentLifecycleState.CONFIRMED);
  });

  it('throws when trying to promote a rejected component', () => {
    const c = createComponentGrouping(makeBaseInput());
    const rejected = rejectComponent(c);
    expect(() => promoteToConfirmed(rejected)).toThrow(ValueObjectError);
  });
});

describe('rejectComponent', () => {
  it('sets lifecycle to rejected', () => {
    const c = createComponentGrouping(makeBaseInput());
    const rejected = rejectComponent(c);
    expect(rejected.lifecycleState).toBe(ComponentLifecycleState.REJECTED);
  });
});

describe('setBusinessField', () => {
  it('sets the business field name', () => {
    const c = createComponentGrouping(makeBaseInput());
    const updated = setBusinessField(c, 'Travel Class');
    expect(updated.businessField).toBe('Travel Class');
  });

  it('throws on empty business field', () => {
    const c = createComponentGrouping(makeBaseInput());
    expect(() => setBusinessField(c, '')).toThrow(ValueObjectError);
  });
});

describe('setOptionSet', () => {
  it('sets the option set', () => {
    const c = createComponentGrouping(makeBaseInput());
    const updated = setOptionSet(c, [
      { value: 'economy', label: 'Economy' },
      { value: 'premium', label: 'Premium Economy', selected: true },
    ]);
    expect(updated.optionSet).not.toBeNull();
    expect(updated.optionSet).toHaveLength(2);
    expect(updated.optionSet![1].selected).toBe(true);
  });

  it('throws on empty option set', () => {
    const c = createComponentGrouping(makeBaseInput());
    expect(() => setOptionSet(c, [])).toThrow(ValueObjectError);
  });
});

describe('createOptionEntry', () => {
  it('defaults selected and disabled to false', () => {
    const o = createOptionEntry({ value: 'eco', label: 'Economy' });
    expect(o.selected).toBe(false);
    expect(o.disabled).toBe(false);
  });

  it('uses value as label when label is empty', () => {
    const o = createOptionEntry({ value: 'eco', label: '' });
    expect(o.label).toBe('eco');
  });
});

describe('isConfirmed', () => {
  it('returns true for confirmed components', () => {
    const c = createComponentGrouping(makeBaseInput());
    const confirmed = promoteToConfirmed(c);
    expect(isConfirmed(confirmed)).toBe(true);
  });

  it('returns false for tentative components', () => {
    const c = createComponentGrouping(makeBaseInput());
    expect(isConfirmed(c)).toBe(false);
  });
});

describe('isActive', () => {
  it('returns true for tentative, developing, confirmed', () => {
    expect(isActive(createComponentGrouping(makeBaseInput()))).toBe(true);
    const dev = addObservedTransition(createComponentGrouping(makeBaseInput()), 't1');
    expect(isActive(dev)).toBe(true);
    const confirmed = promoteToConfirmed(dev);
    expect(isActive(confirmed)).toBe(true);
  });

  it('returns false for rejected', () => {
    const c = createComponentGrouping(makeBaseInput());
    expect(isActive(rejectComponent(c))).toBe(false);
  });
});
