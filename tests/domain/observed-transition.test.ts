/**
 * ObservedTransition entity tests.
 *
 * Tests factory validation, value object creation, observable outcome detection,
 * and component assignment helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  createObservedTransition,
  createTransitionEvidence,
  createCascadeEffect,
  hasObservableOutcome,
  assignTransitionToComponent,
  emptyElementState,
} from '../../src/domain/entities/observed-transition';
import {
  TransitionOperation,
  RelevanceLevel,
  TransitionEvidenceType,
  CascadeEffectType,
} from '../../src/domain/enums';
import { MissingFieldError, ValueObjectError } from '../../src/domain/errors/invariant-errors';

describe('createObservedTransition', () => {
  it('creates transition with minimal required fields', () => {
    const t = createObservedTransition({
      transitionId: 't-001',
      elementId: 'elem-001',
      operation: TransitionOperation.CLICK,
      timestamp: 1720000000000,
      relevance: RelevanceLevel.DELIBERATE,
      stateBefore: emptyElementState(),
      stateAfter: emptyElementState(),
    });
    expect(t.transitionId).toBe('t-001');
    expect(t.elementId).toBe('elem-001');
    expect(t.operation).toBe(TransitionOperation.CLICK);
    expect(t.componentId).toBeNull();
    expect(t.evidence).toEqual([]);
    expect(t.cascadeEffects).toEqual([]);
    expect(t.validationResult).toBeNull();
  });

  it('creates transition with full evidence, cascades, and validation', () => {
    const t = createObservedTransition({
      transitionId: 't-001',
      elementId: 'elem-001',
      operation: TransitionOperation.FILL,
      timestamp: 1720000000000,
      relevance: RelevanceLevel.DELIBERATE,
      stateBefore: { value: '', checked: null, expanded: null, selected: null },
      stateAfter: { value: 'test@example.com', checked: null, expanded: null, selected: null },
      evidence: [
        { type: TransitionEvidenceType.VALUE_CHANGE, description: 'Input value changed', before: '', after: 'test@example.com' },
      ],
      cascadeEffects: [
        { elementId: 'elem-002', effect: CascadeEffectType.VISIBILITY, detail: 'Error message hidden' },
      ],
      validationResult: { triggered: false, responseType: null, message: null, clearedOn: null },
    });
    expect(t.evidence).toHaveLength(1);
    expect(t.evidence[0].type).toBe(TransitionEvidenceType.VALUE_CHANGE);
    expect(t.cascadeEffects).toHaveLength(1);
    expect(t.cascadeEffects[0].effect).toBe(CascadeEffectType.VISIBILITY);
    expect(t.validationResult?.triggered).toBe(false);
  });

  it('throws MissingFieldError when transitionId is empty', () => {
    expect(() =>
      createObservedTransition({
        transitionId: '',
        elementId: 'elem-001',
        operation: TransitionOperation.CLICK,
        timestamp: 1720000000000,
        relevance: RelevanceLevel.DELIBERATE,
        stateBefore: emptyElementState(),
        stateAfter: emptyElementState(),
      }),
    ).toThrow(MissingFieldError);
  });

  it('throws MissingFieldError when elementId is empty', () => {
    expect(() =>
      createObservedTransition({
        transitionId: 't-001',
        elementId: '',
        operation: TransitionOperation.CLICK,
        timestamp: 1720000000000,
        relevance: RelevanceLevel.DELIBERATE,
        stateBefore: emptyElementState(),
        stateAfter: emptyElementState(),
      }),
    ).toThrow(MissingFieldError);
  });

  it('throws ValueObjectError for negative timestamp', () => {
    expect(() =>
      createObservedTransition({
        transitionId: 't-001',
        elementId: 'elem-001',
        operation: TransitionOperation.CLICK,
        timestamp: -1,
        relevance: RelevanceLevel.DELIBERATE,
        stateBefore: emptyElementState(),
        stateAfter: emptyElementState(),
      }),
    ).toThrow(ValueObjectError);
  });
});

describe('createTransitionEvidence', () => {
  it('creates evidence with all fields', () => {
    const ev = createTransitionEvidence({
      type: TransitionEvidenceType.VALUE_CHANGE,
      description: 'Value changed from A to B',
      before: 'A',
      after: 'B',
    });
    expect(ev.type).toBe(TransitionEvidenceType.VALUE_CHANGE);
    expect(ev.description).toBe('Value changed from A to B');
    expect(ev.before).toBe('A');
    expect(ev.after).toBe('B');
  });

  it('throws ValueObjectError when description is empty', () => {
    expect(() =>
      createTransitionEvidence({
        type: TransitionEvidenceType.VALUE_CHANGE,
        description: '',
      }),
    ).toThrow(ValueObjectError);
  });
});

describe('createCascadeEffect', () => {
  it('creates cascade with all fields', () => {
    const c = createCascadeEffect({
      elementId: 'elem-002',
      effect: CascadeEffectType.VISIBILITY,
      detail: 'Section became visible',
    });
    expect(c.elementId).toBe('elem-002');
    expect(c.effect).toBe(CascadeEffectType.VISIBILITY);
    expect(c.detail).toBe('Section became visible');
  });
});

describe('hasObservableOutcome', () => {
  it('returns true when transition has evidence', () => {
    const t = createObservedTransition({
      transitionId: 't-001',
      elementId: 'elem-001',
      operation: TransitionOperation.CLICK,
      timestamp: 1720000000000,
      relevance: RelevanceLevel.DELIBERATE,
      stateBefore: emptyElementState(),
      stateAfter: emptyElementState(),
      evidence: [
        { type: TransitionEvidenceType.STATE_CHANGE, description: 'Checked changed' },
      ],
    });
    expect(hasObservableOutcome(t)).toBe(true);
  });

  it('returns true when transition has cascade effects', () => {
    const t = createObservedTransition({
      transitionId: 't-001',
      elementId: 'elem-001',
      operation: TransitionOperation.CLICK,
      timestamp: 1720000000000,
      relevance: RelevanceLevel.DELIBERATE,
      stateBefore: emptyElementState(),
      stateAfter: emptyElementState(),
      cascadeEffects: [
        { elementId: 'elem-002', effect: CascadeEffectType.CONTENT, detail: 'Text updated' },
      ],
    });
    expect(hasObservableOutcome(t)).toBe(true);
  });

  it('returns true for navigation operations even without evidence', () => {
    const t = createObservedTransition({
      transitionId: 't-001',
      elementId: 'elem-001',
      operation: TransitionOperation.NAVIGATE,
      timestamp: 1720000000000,
      relevance: RelevanceLevel.DELIBERATE,
      stateBefore: emptyElementState(),
      stateAfter: emptyElementState(),
    });
    expect(hasObservableOutcome(t)).toBe(true);
  });

  it('returns false when transition has no evidence, cascades, or navigation', () => {
    const t = createObservedTransition({
      transitionId: 't-001',
      elementId: 'elem-001',
      operation: TransitionOperation.CLICK,
      timestamp: 1720000000000,
      relevance: RelevanceLevel.NOISE,
      stateBefore: emptyElementState(),
      stateAfter: emptyElementState(),
    });
    expect(hasObservableOutcome(t)).toBe(false);
  });
});

describe('assignTransitionToComponent', () => {
  it('assigns component ID to transition', () => {
    const t = createObservedTransition({
      transitionId: 't-001',
      elementId: 'elem-001',
      operation: TransitionOperation.CLICK,
      timestamp: 1720000000000,
      relevance: RelevanceLevel.DELIBERATE,
      stateBefore: emptyElementState(),
      stateAfter: emptyElementState(),
    });
    const updated = assignTransitionToComponent(t, 'comp-001');
    expect(updated.componentId).toBe('comp-001');
    expect(updated.transitionId).toBe('t-001');
  });
});

describe('emptyElementState', () => {
  it('returns state with all null fields', () => {
    const s = emptyElementState();
    expect(s.value).toBeNull();
    expect(s.checked).toBeNull();
    expect(s.expanded).toBeNull();
    expect(s.selected).toBeNull();
  });
});
