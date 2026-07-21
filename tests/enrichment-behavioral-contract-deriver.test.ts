/**
 * Tests for BehavioralContract Deriver
 *
 * Verifies that deriveBehavioralContract correctly synthesizes state machines,
 * validation behavior, cascade effects, and success indicators from observed
 * transitions.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §2
 */

import { describe, it, expect } from 'vitest';
import { deriveBehavioralContract } from '../src/recorder/enrichment/behavioral-contract-deriver';
import type { ComponentGrouping } from '../src/domain/entities/component-grouping';
import type { ObservedTransition, ElementState } from '../src/domain/entities/observed-transition';
import { ComponentRole, PatternType, RecognitionSource, ComponentLifecycleState, TransitionOperation, RelevanceLevel, TransitionEvidenceType, CascadeEffectType } from '../src/domain/enums';

// ── Fixtures ─────────────────────────────────────────────

function makeComponent(groupingId = 'comp-1', rootElementId = 'trigger-1'): ComponentGrouping {
  return {
    groupingId,
    patternType: PatternType.DROPDOWN,
    rootElementId,
    constituents: [
      { elementId: rootElementId, role: ComponentRole.TRIGGER },
      { elementId: 'opt-1', role: ComponentRole.OPTION },
    ],
    businessField: 'Travel Class',
    recognitionSource: RecognitionSource.STRUCTURAL,
    recognitionConfidence: 0.85,
    lifecycleState: ComponentLifecycleState.CONFIRMED,
    optionSet: null,
    observedTransitionIds: [],
  };
}

function makeState(partial: Partial<ElementState> = {}): ElementState {
  return { value: null, checked: null, expanded: null, selected: null, ...partial };
}

function makeTransition(
  id: string,
  overrides: Partial<ObservedTransition> = {},
): ObservedTransition {
  return {
    transitionId: id,
    elementId: 'trigger-1',
    componentId: 'comp-1',
    operation: TransitionOperation.CLICK,
    timestamp: 1000,
    relevance: RelevanceLevel.DELIBERATE,
    stateBefore: makeState(),
    stateAfter: makeState(),
    evidence: [],
    cascadeEffects: [],
    validationResult: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

describe('deriveBehavioralContract', () => {
  it('sets appliesTo to component type and id', () => {
    const component = makeComponent('comp-99');
    const contract = deriveBehavioralContract(component, []);
    expect(contract.appliesTo).toEqual({ type: 'component', id: 'comp-99' });
  });

  // ── State Machine Synthesis ──

  describe('stateMachine synthesis', () => {
    it('creates states from stateBefore and stateAfter of transitions', () => {
      const transitions = [
        makeTransition('t1', {
          stateBefore: makeState({ expanded: false }),
          stateAfter: makeState({ expanded: true }),
        }),
      ];
      const component = makeComponent();
      const contract = deriveBehavioralContract(component, transitions);

      expect(contract.stateMachine.states).toHaveLength(2);
      const stateNames = contract.stateMachine.states.map((s) => s.name);
      expect(stateNames).toContain('e:false');
      expect(stateNames).toContain('e:true');
    });

    it('creates transition defs with from→to→operation', () => {
      const transitions = [
        makeTransition('t1', {
          operation: TransitionOperation.CLICK,
          stateBefore: makeState({ expanded: false }),
          stateAfter: makeState({ expanded: true }),
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      expect(contract.stateMachine.transitions).toHaveLength(1);
      expect(contract.stateMachine.transitions[0].from).toBe('e:false');
      expect(contract.stateMachine.transitions[0].to).toBe('e:true');
      expect(contract.stateMachine.transitions[0].operation).toBe('click');
      expect(contract.stateMachine.transitions[0].observed).toBe(true);
    });

    it('deduplicates identical states across transitions', () => {
      // Two transitions that share the same before/after states
      const transitions = [
        makeTransition('t1', {
          stateBefore: makeState({ checked: false }),
          stateAfter: makeState({ checked: true }),
        }),
        makeTransition('t2', {
          stateBefore: makeState({ checked: true }),
          stateAfter: makeState({ checked: false }),
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      // c:true and c:false should be unique states (2 not 4)
      expect(contract.stateMachine.states).toHaveLength(2);
    });

    it('sets terminal state to last transition stateAfter', () => {
      const transitions = [
        makeTransition('t1', {
          stateBefore: makeState({ expanded: false }),
          stateAfter: makeState({ expanded: true }),
        }),
        makeTransition('t2', {
          stateBefore: makeState({ expanded: true }),
          stateAfter: makeState({ expanded: false }),
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      expect(contract.stateMachine.terminalStates).toHaveLength(1);
      expect(contract.stateMachine.terminalStates[0]).toBe('e:false');
    });

    it('handles multiple state fields in a single state key', () => {
      const transitions = [
        makeTransition('t1', {
          stateBefore: makeState({ value: 'a', expanded: false }),
          stateAfter: makeState({ value: 'b', expanded: true }),
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      // Both fields should appear in the key
      const stateNames = contract.stateMachine.states.map((s) => s.name);
      expect(stateNames).toContain('v:a|e:false');
      expect(stateNames).toContain('v:b|e:true');
    });

    it('uses "initial" for empty state (all fields null)', () => {
      const transitions = [
        makeTransition('t1', {
          stateBefore: makeState(), // all null
          stateAfter: makeState({ value: 'hello' }),
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      const stateNames = contract.stateMachine.states.map((s) => s.name);
      expect(stateNames).toContain('initial');
      expect(stateNames).toContain('v:hello');
    });

    it('returns empty states and transitions for no transitions', () => {
      const contract = deriveBehavioralContract(makeComponent(), []);
      expect(contract.stateMachine.states).toHaveLength(0);
      expect(contract.stateMachine.transitions).toHaveLength(0);
      expect(contract.stateMachine.terminalStates).toHaveLength(0);
    });

    it('includes evidence descriptions in transition defs', () => {
      const transitions = [
        makeTransition('t1', {
          evidence: [{
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'aria-expanded changed',
            before: 'false',
            after: 'true',
          }],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);
      expect(contract.stateMachine.transitions[0].evidence).toContain('aria-expanded changed');
    });
  });

  // ── Validation Behavior ──

  describe('validationBehavior', () => {
    it('returns null when no validation triggered', () => {
      const contract = deriveBehavioralContract(makeComponent(), []);
      expect(contract.validationBehavior).toBeNull();
    });

    it('detects triggered validation and extracts trigger timing', () => {
      const transitions = [
        makeTransition('t1', {
          validationResult: { triggered: true, responseType: 'inline', message: 'Required', clearedOn: null },
          evidence: [{
            type: TransitionEvidenceType.VALUE_CHANGE,
            description: 'value changed on blur',
            before: null,
            after: null,
          }],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      expect(contract.validationBehavior).not.toBeNull();
      expect(contract.validationBehavior!.triggerTiming).toBe('onBlur');
      expect(contract.validationBehavior!.observed).toBe(true);
    });

    it('infers onChange timing from change/input evidence', () => {
      const transitions = [
        makeTransition('t1', {
          validationResult: { triggered: true, responseType: 'inline', message: 'Invalid', clearedOn: null },
          evidence: [{
            type: TransitionEvidenceType.VALUE_CHANGE,
            description: 'input changed',
            before: null,
            after: null,
          }],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);
      expect(contract.validationBehavior!.triggerTiming).toBe('onChange');
    });

    it('defaults to onSubmit timing when no blur/change evidence', () => {
      const transitions = [
        makeTransition('t1', {
          validationResult: { triggered: true, responseType: 'modal', message: 'Error', clearedOn: null },
          evidence: [],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);
      expect(contract.validationBehavior!.triggerTiming).toBe('onSubmit');
    });

    it('extracts error messages from validation results', () => {
      const transitions = [
        makeTransition('t1', {
          operation: TransitionOperation.FILL,
          validationResult: { triggered: true, responseType: 'inline', message: 'Email required', clearedOn: null },
          evidence: [],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      expect(contract.validationBehavior!.errorMessages).toHaveLength(1);
      expect(contract.validationBehavior!.errorMessages[0].messageText).toBe('Email required');
      expect(contract.validationBehavior!.errorMessages[0].condition).toContain('fill');
    });

    it('extracts responseType from validation results', () => {
      const transitions = [
        makeTransition('t1', {
          validationResult: { triggered: true, responseType: 'toast', message: 'Error', clearedOn: null },
          evidence: [],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);
      expect(contract.validationBehavior!.responseType).toBe('toast');
    });
  });

  // ── Cascade Effects ──

  describe('cascadeEffects', () => {
    it('summarizes cascade effects from transitions', () => {
      const transitions = [
        makeTransition('t1', {
          cascadeEffects: [
            { elementId: 'price-1', effect: CascadeEffectType.VALUE, detail: 'Price updated' },
            { elementId: 'summary-1', effect: CascadeEffectType.VISIBILITY, detail: 'Summary became visible' },
          ],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      expect(contract.cascadeEffects).toHaveLength(2);
      expect(contract.cascadeEffects[0].affectsEntityId).toBe('price-1');
      expect(contract.cascadeEffects[0].effect).toBe('value');
      expect(contract.cascadeEffects[1].affectsEntityId).toBe('summary-1');
    });

    it('returns empty array when no cascade effects', () => {
      const contract = deriveBehavioralContract(makeComponent(), []);
      expect(contract.cascadeEffects).toEqual([]);
    });

    it('includes trigger description in cascade summary', () => {
      const transitions = [
        makeTransition('t1', {
          elementId: 'trigger-1',
          operation: TransitionOperation.SELECT,
          cascadeEffects: [
            { elementId: 'price-1', effect: CascadeEffectType.VALUE, detail: 'Updated' },
          ],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      expect(contract.cascadeEffects[0].trigger).toContain('select');
      expect(contract.cascadeEffects[0].trigger).toContain('trigger-1');
    });
  });

  // ── Success Indicators ──

  describe('successIndicators', () => {
    it('derives valueDisplay indicator from value change', () => {
      const transitions = [
        makeTransition('t1', {
          stateBefore: makeState({ value: null }),
          stateAfter: makeState({ value: 'John' }),
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      const valueIndicators = contract.successIndicators.filter((i) => i.type === 'valueDisplay');
      expect(valueIndicators).toHaveLength(1);
      expect(valueIndicators[0].signal).toContain('John');
    });

    it('derives navigation indicator from navigation evidence', () => {
      const transitions = [
        makeTransition('t1', {
          evidence: [{
            type: TransitionEvidenceType.NAVIGATION,
            description: 'Page navigated to /results',
            before: null,
            after: null,
          }],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      const navIndicators = contract.successIndicators.filter((i) => i.type === 'navigation');
      expect(navIndicators).toHaveLength(1);
    });

    it('derives visibility indicator from visibility cascade effect', () => {
      const transitions = [
        makeTransition('t1', {
          cascadeEffects: [
            { elementId: 'tooltip-1', effect: CascadeEffectType.VISIBILITY, detail: 'Tooltip appeared' },
          ],
        }),
      ];
      const contract = deriveBehavioralContract(makeComponent(), transitions);

      const visibilityIndicators = contract.successIndicators.filter((i) => i.type === 'visibility');
      expect(visibilityIndicators).toHaveLength(1);
      expect(visibilityIndicators[0].description).toBe('Tooltip appeared');
    });

    it('returns empty array when no state changes or cascades', () => {
      const contract = deriveBehavioralContract(makeComponent(), [
        makeTransition('t1', {
          stateBefore: makeState({ value: 'a' }),
          stateAfter: makeState({ value: 'a' }), // no change
        }),
      ]);
      expect(contract.successIndicators).toHaveLength(0);
    });
  });
});
