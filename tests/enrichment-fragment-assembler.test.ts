/**
 * Tests for Fragment Assembler
 *
 * Verifies that assembleFragment correctly combines all foundations
 * and derived views into a complete ApplicationKnowledgeFragment with
 * compact summaries.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §7
 */

import { describe, it, expect } from 'vitest';
import { assembleFragment, FRAGMENT_SCHEMA_VERSION } from '../src/recorder/enrichment/fragment-assembler';
import type { AssemblyInput } from '../src/recorder/enrichment/fragment-assembler';
import type { UiElement } from '../src/domain/entities/ui-element';
import type { ObservedTransition, ElementState } from '../src/domain/entities/observed-transition';
import type { ComponentGrouping } from '../src/domain/entities/component-grouping';
import type {
  InteractionContract,
  BehavioralContract,
  LogicalAction,
  RecordedWorkflow,
  ApplicationSurface,
} from '../src/domain/entities/application-knowledge';
import {
  ComponentRole,
  PatternType,
  RecognitionSource,
  ComponentLifecycleState,
  TransitionOperation,
  RelevanceLevel,
  IntrinsicCapability,
} from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';

// ── Fixtures ─────────────────────────────────────────────

function makeIdentity(name: string, tag = 'div'): ElementIdentity {
  return {
    cssPath: tag, xpath: `//${tag}`, ariaRole: 'button', ariaLevel: null,
    accessibleName: name, tag, type: null, testId: null,
    text: null, childText: null, href: null, title: null, label: null,
    classes: [], attributes: {}, domPosition: 1, rect: null,
  } as unknown as ElementIdentity;
}

function makeElement(
  elementId: string,
  overrides: Partial<UiElement> = {},
): UiElement {
  return {
    elementId,
    identity: makeIdentity(elementId),
    domAttributes: {},
    sourceUrl: 'https://app.com/page',
    domTreePath: 'html>body',
    intrinsicCapabilities: [IntrinsicCapability.CLICK],
    componentId: null,
    componentRole: null,
    ...overrides,
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
    elementId: 'elem-1',
    componentId: null,
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

function makeComponent(groupingId: string): ComponentGrouping {
  return {
    groupingId,
    patternType: PatternType.DROPDOWN,
    rootElementId: 'elem-1',
    constituents: [{ elementId: 'elem-1', role: ComponentRole.TRIGGER }],
    businessField: 'Test Field',
    recognitionSource: RecognitionSource.STRUCTURAL,
    recognitionConfidence: 0.85,
    lifecycleState: ComponentLifecycleState.CONFIRMED,
    optionSet: null,
    observedTransitionIds: [],
  };
}

function makeInteractionContract(id: string): InteractionContract {
  return {
    appliesTo: { type: 'element', id },
    affordances: ['click'],
    constraints: {
      required: null,
      inputType: null,
      valueRange: null,
      lengthRange: null,
      format: null,
      validOptions: null,
      dateFormat: null,
    },
  };
}

function makeBehavioralContract(id: string): BehavioralContract {
  return {
    appliesTo: { type: 'component', id },
    stateMachine: { states: [], transitions: [], terminalStates: [] },
    validationBehavior: null,
    cascadeEffects: [],
    successIndicators: [],
  };
}

function makeLogicalAction(id: string): LogicalAction {
  return {
    actionId: id,
    componentId: null,
    businessField: null,
    transitionIds: ['t1'],
    lifecycleComplete: true,
    resultingChange: null,
    timestamp: 1000,
  };
}

function makeRecordedWorkflow(): RecordedWorkflow {
  return {
    surfaceTransitions: [],
    logicalActions: [makeLogicalAction('a1')],
    branchPoints: [],
    optionalSteps: [],
  };
}

function makeApplicationSurface(): ApplicationSurface {
  return {
    url: 'https://app.com/page',
    elementIds: ['elem-1'],
    componentIds: [],
  };
}

function makeFullInput(overrides: Partial<AssemblyInput> = {}): AssemblyInput {
  return {
    sessionId: 'session-001',
    elements: [makeElement('elem-1')],
    transitions: [makeTransition('t1')],
    components: [makeComponent('comp-1')],
    interactionContracts: [makeInteractionContract('elem-1')],
    behavioralContracts: [makeBehavioralContract('comp-1')],
    logicalActions: [makeLogicalAction('a1')],
    recordedWorkflow: makeRecordedWorkflow(),
    applicationSurfaces: [makeApplicationSurface()],
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

describe('assembleFragment', () => {
  describe('top-level fields', () => {
    it('sets sessionId', () => {
      const fragment = assembleFragment(makeFullInput({ sessionId: 'test-42' }));
      expect(fragment.sessionId).toBe('test-42');
    });

    it('sets generatedAt as ISO string', () => {
      const fragment = assembleFragment(makeFullInput());
      expect(fragment.generatedAt).toBeTruthy();
      expect(() => new Date(fragment.generatedAt).toISOString()).not.toThrow();
    });

    it('sets schemaVersion', () => {
      const fragment = assembleFragment(makeFullInput());
      expect(fragment.schemaVersion).toBe(FRAGMENT_SCHEMA_VERSION);
    });
  });

  describe('element summaries', () => {
    it('converts UiElement to UiElementSummary', () => {
      const el = makeElement('elem-42', {
        componentId: 'comp-1',
        componentRole: ComponentRole.TRIGGER,
        sourceUrl: 'https://app.com/form',
      });
      const fragment = assembleFragment(makeFullInput({ elements: [el] }));

      expect(fragment.elements).toHaveLength(1);
      expect(fragment.elements[0]).toEqual({
        elementId: 'elem-42',
        tag: 'div',
        role: 'button',
        accessibleName: 'elem-42',
        capabilities: [IntrinsicCapability.CLICK],
        componentId: 'comp-1',
        componentRole: ComponentRole.TRIGGER,
        sourceUrl: 'https://app.com/form',
      });
    });

    it('handles null componentId and componentRole', () => {
      const el = makeElement('elem-1');
      const fragment = assembleFragment(makeFullInput({ elements: [el] }));
      expect(fragment.elements[0].componentId).toBeNull();
      expect(fragment.elements[0].componentRole).toBeNull();
    });

    it('handles missing identity (falls back to defaults)', () => {
      const el = makeElement('elem-1');
      el.identity = undefined as any;
      const fragment = assembleFragment(makeFullInput({ elements: [el] }));
      expect(fragment.elements[0].tag).toBe('unknown');
      expect(fragment.elements[0].role).toBeNull();
    });
  });

  describe('transition summaries', () => {
    it('converts ObservedTransition to TransitionSummary', () => {
      const t = makeTransition('t-99', {
        elementId: 'elem-1',
        componentId: 'comp-1',
        operation: TransitionOperation.SELECT,
        timestamp: 5000,
        relevance: RelevanceLevel.DELIBERATE,
      });
      const fragment = assembleFragment(makeFullInput({ transitions: [t] }));

      expect(fragment.transitions).toHaveLength(1);
      expect(fragment.transitions[0]).toEqual({
        transitionId: 't-99',
        elementId: 'elem-1',
        componentId: 'comp-1',
        operation: 'select',
        timestamp: 5000,
        relevance: 'deliberate',
      });
    });

    it('handles null componentId', () => {
      const t = makeTransition('t1', { componentId: null });
      const fragment = assembleFragment(makeFullInput({ transitions: [t] }));
      expect(fragment.transitions[0].componentId).toBeNull();
    });
  });

  describe('component summaries', () => {
    it('converts ComponentGrouping to ComponentSummary', () => {
      const comp = makeComponent('comp-42');
      comp.constituents = [
        { elementId: 'elem-1', role: ComponentRole.TRIGGER },
        { elementId: 'elem-2', role: ComponentRole.OPTION },
        { elementId: 'elem-3', role: ComponentRole.CONTAINER },
      ];
      comp.optionSet = [
        { value: 'a', label: 'A', selected: false, disabled: false },
        { value: 'b', label: 'B', selected: true, disabled: false },
      ];
      const fragment = assembleFragment(makeFullInput({ components: [comp] }));

      expect(fragment.components).toHaveLength(1);
      expect(fragment.components[0]).toEqual({
        groupingId: 'comp-42',
        patternType: 'dropdown',
        rootElementId: 'elem-1',
        constituentCount: 3,
        businessField: 'Test Field',
        lifecycleState: 'confirmed',
        optionCount: 2,
      });
    });

    it('handles null optionSet', () => {
      const comp = makeComponent('comp-1');
      comp.optionSet = null;
      const fragment = assembleFragment(makeFullInput({ components: [comp] }));
      expect(fragment.components[0].optionCount).toBeNull();
    });
  });

  describe('derived views passthrough', () => {
    it('passes interactionContracts through unchanged', () => {
      const contracts = [makeInteractionContract('e1'), makeInteractionContract('e2')];
      const fragment = assembleFragment(makeFullInput({ interactionContracts: contracts }));
      expect(fragment.interactionContracts).toBe(contracts);
    });

    it('passes behavioralContracts through unchanged', () => {
      const contracts = [makeBehavioralContract('c1')];
      const fragment = assembleFragment(makeFullInput({ behavioralContracts: contracts }));
      expect(fragment.behavioralContracts).toBe(contracts);
    });

    it('passes logicalActions through unchanged', () => {
      const actions = [makeLogicalAction('a1'), makeLogicalAction('a2')];
      const fragment = assembleFragment(makeFullInput({ logicalActions: actions }));
      expect(fragment.logicalActions).toBe(actions);
    });

    it('passes recordedWorkflow through unchanged', () => {
      const workflow = makeRecordedWorkflow();
      const fragment = assembleFragment(makeFullInput({ recordedWorkflow: workflow }));
      expect(fragment.recordedWorkflow).toBe(workflow);
    });

    it('passes applicationSurfaces through unchanged', () => {
      const surfaces = [makeApplicationSurface()];
      const fragment = assembleFragment(makeFullInput({ applicationSurfaces: surfaces }));
      expect(fragment.applicationSurfaces).toBe(surfaces);
    });
  });

  describe('empty inputs', () => {
    it('assembles fragment with empty arrays', () => {
      const fragment = assembleFragment({
        sessionId: 'empty',
        elements: [],
        transitions: [],
        components: [],
        interactionContracts: [],
        behavioralContracts: [],
        logicalActions: [],
        recordedWorkflow: {
          surfaceTransitions: [],
          logicalActions: [],
          branchPoints: [],
          optionalSteps: [],
        },
        applicationSurfaces: [],
      });

      expect(fragment.elements).toEqual([]);
      expect(fragment.transitions).toEqual([]);
      expect(fragment.components).toEqual([]);
      expect(fragment.interactionContracts).toEqual([]);
      expect(fragment.behavioralContracts).toEqual([]);
      expect(fragment.logicalActions).toEqual([]);
      expect(fragment.applicationSurfaces).toEqual([]);
    });
  });
});
