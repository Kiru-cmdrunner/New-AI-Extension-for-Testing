/**
 * Tests for Workflow Deriver
 *
 * Verifies that deriveWorkflow correctly detects:
 *   - Surface transitions (navigation boundaries)
 *   - Branch points (from option sets)
 *   - Optional steps (from supporting transitions)
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §5
 */

import { describe, it, expect } from 'vitest';
import { deriveWorkflow } from '../src/recorder/enrichment/workflow-deriver';
import type { ComponentGrouping } from '../src/domain/entities/component-grouping';
import type { ObservedTransition, ElementState } from '../src/domain/entities/observed-transition';
import type { UiElement } from '../src/domain/entities/ui-element';
import type { LogicalAction } from '../src/domain/entities/application-knowledge';
import {
  ComponentRole,
  PatternType,
  RecognitionSource,
  ComponentLifecycleState,
  TransitionOperation,
  RelevanceLevel,
  TransitionEvidenceType,
} from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';

// ── Fixtures ─────────────────────────────────────────────

function makeIdentity(name: string): ElementIdentity {
  return {
    cssPath: 'div', xpath: '//div', ariaRole: null, ariaLevel: null,
    accessibleName: name, tag: 'div', type: null, testId: null,
    text: null, childText: null, href: null, title: null, label: null,
    classes: [], attributes: {}, domPosition: 1, rect: null,
  } as unknown as ElementIdentity;
}

function makeElement(elementId: string, sourceUrl: string): UiElement {
  return {
    elementId,
    identity: makeIdentity(elementId),
    domAttributes: {},
    sourceUrl,
    domTreePath: 'html>body',
    intrinsicCapabilities: [],
    componentId: null,
    componentRole: null,
  };
}

function makeState(partial: Partial<ElementState> = {}): ElementState {
  return { value: null, checked: null, expanded: null, selected: null, ...partial };
}

function makeTransition(
  id: string,
  op: TransitionOperation,
  timestamp: number,
  overrides: Partial<ObservedTransition> = {},
): ObservedTransition {
  return {
    transitionId: id,
    elementId: 'trigger-1',
    componentId: null,
    operation: op,
    timestamp,
    relevance: RelevanceLevel.DELIBERATE,
    stateBefore: makeState(),
    stateAfter: makeState(),
    evidence: [],
    cascadeEffects: [],
    validationResult: null,
    ...overrides,
  };
}

function makeComponent(
  groupingId: string,
  optionSet: { value: string; label: string; selected: boolean; disabled: boolean }[] | null,
): ComponentGrouping {
  return {
    groupingId,
    patternType: PatternType.DROPDOWN,
    rootElementId: 'trigger-1',
    constituents: [{ elementId: 'trigger-1', role: ComponentRole.TRIGGER }],
    businessField: 'Test Field',
    recognitionSource: RecognitionSource.STRUCTURAL,
    recognitionConfidence: 0.85,
    lifecycleState: ComponentLifecycleState.CONFIRMED,
    optionSet,
    observedTransitionIds: [],
  };
}

function makeAction(id: string, transitionIds: string[], timestamp: number): LogicalAction {
  return {
    actionId: id,
    componentId: null,
    businessField: null,
    transitionIds,
    lifecycleComplete: true,
    resultingChange: null,
    timestamp,
  };
}

// ── Tests ────────────────────────────────────────────────

describe('deriveWorkflow', () => {
  it('passes through logical actions unchanged', () => {
    const actions = [
      makeAction('a1', ['t1'], 1000),
      makeAction('a2', ['t2'], 2000),
    ];

    const workflow = deriveWorkflow(actions, [], [], new Map());

    expect(workflow.logicalActions).toEqual(actions);
  });

  // ── Surface Transitions ──

  describe('surfaceTransitions (navigation boundaries)', () => {
    it('detects NAVIGATE operations as boundaries', () => {
      const elements = new Map([
        ['link-1', makeElement('link-1', 'https://app.com/home')],
        ['link-2', makeElement('link-2', 'https://app.com/search')],
      ]);

      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, { elementId: 'link-1' }),
        makeTransition('nav1', TransitionOperation.NAVIGATE, 2000, {
          elementId: 'link-1',
          evidence: [{
            type: TransitionEvidenceType.NAVIGATION,
            description: 'Navigated to search',
            before: null,
            after: 'https://app.com/search',
          }],
        }),
        makeTransition('t3', TransitionOperation.CLICK, 3000, { elementId: 'link-2' }),
      ];

      const workflow = deriveWorkflow([], transitions, [], elements);

      expect(workflow.surfaceTransitions).toHaveLength(1);
      expect(workflow.surfaceTransitions[0].triggeredByTransitionId).toBe('nav1');
      expect(workflow.surfaceTransitions[0].toUrl).toBe('https://app.com/search');
    });

    it('derives fromUrl from navigate transition element sourceUrl', () => {
      const elements = new Map([
        ['link-1', makeElement('link-1', 'https://app.com/home')],
      ]);

      const transitions = [
        makeTransition('nav1', TransitionOperation.NAVIGATE, 1000, {
          elementId: 'link-1',
        }),
      ];

      const workflow = deriveWorkflow([], transitions, [], elements);

      expect(workflow.surfaceTransitions[0].fromUrl).toBe('https://app.com/home');
    });

    it('derives toUrl from next transition element when no navigation evidence URL', () => {
      const elements = new Map([
        ['link-1', makeElement('link-1', 'https://app.com/home')],
        ['content-1', makeElement('content-1', 'https://app.com/results')],
      ]);

      const transitions = [
        makeTransition('nav1', TransitionOperation.NAVIGATE, 1000, {
          elementId: 'link-1',
          evidence: [], // no URL in evidence
        }),
        makeTransition('t2', TransitionOperation.CLICK, 2000, { elementId: 'content-1' }),
      ];

      const workflow = deriveWorkflow([], transitions, [], elements);

      expect(workflow.surfaceTransitions[0].toUrl).toBe('https://app.com/results');
    });

    it('returns empty surfaceTransitions when no navigations', () => {
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000),
        makeTransition('t2', TransitionOperation.FILL, 2000),
      ];

      const workflow = deriveWorkflow([], transitions, [], new Map());
      expect(workflow.surfaceTransitions).toHaveLength(0);
    });

    it('uses "unknown" for URLs when element not found', () => {
      const transitions = [
        makeTransition('nav1', TransitionOperation.NAVIGATE, 1000, {
          elementId: 'missing-element',
          evidence: [],
        }),
      ];

      const workflow = deriveWorkflow([], transitions, [], new Map());

      expect(workflow.surfaceTransitions[0].fromUrl).toBe('unknown');
    });
  });

  // ── Branch Points ──

  describe('branchPoints', () => {
    it('detects branch points from components with option sets', () => {
      const component = makeComponent('comp-1', [
        { value: 'economy', label: 'Economy', selected: false, disabled: false },
        { value: 'business', label: 'Business', selected: true, disabled: false },
        { value: 'first', label: 'First Class', selected: false, disabled: false },
      ]);

      const workflow = deriveWorkflow([], [], [component], new Map());

      expect(workflow.branchPoints).toHaveLength(1);
      expect(workflow.branchPoints[0].componentId).toBe('comp-1');
      expect(workflow.branchPoints[0].chosenOption).toBe('Business');
      expect(workflow.branchPoints[0].availableOptions).toEqual([
        'Economy', 'Business', 'First Class',
      ]);
    });

    it('skips components with no option set', () => {
      const component = makeComponent('comp-1', null);
      const workflow = deriveWorkflow([], [], [component], new Map());
      expect(workflow.branchPoints).toHaveLength(0);
    });

    it('skips components with only one option', () => {
      const component = makeComponent('comp-1', [
        { value: 'only', label: 'Only Option', selected: true, disabled: false },
      ]);
      const workflow = deriveWorkflow([], [], [component], new Map());
      expect(workflow.branchPoints).toHaveLength(0);
    });

    it('skips components where no option is selected', () => {
      const component = makeComponent('comp-1', [
        { value: 'a', label: 'A', selected: false, disabled: false },
        { value: 'b', label: 'B', selected: false, disabled: false },
      ]);
      const workflow = deriveWorkflow([], [], [component], new Map());
      expect(workflow.branchPoints).toHaveLength(0);
    });

    it('detects multiple branch points from multiple components', () => {
      const comp1 = makeComponent('comp-1', [
        { value: 'a', label: 'A', selected: true, disabled: false },
        { value: 'b', label: 'B', selected: false, disabled: false },
      ]);
      const comp2 = makeComponent('comp-2', [
        { value: 'x', label: 'X', selected: false, disabled: false },
        { value: 'y', label: 'Y', selected: true, disabled: false },
      ]);

      const workflow = deriveWorkflow([], [], [comp1, comp2], new Map());
      expect(workflow.branchPoints).toHaveLength(2);
    });
  });

  // ── Optional Steps ──

  describe('optionalSteps', () => {
    it('identifies actions composed entirely of supporting transitions', () => {
      const actions = [
        makeAction('a1', ['t1'], 1000), // deliberate
        makeAction('a2', ['t2'], 2000), // supporting
      ];

      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, {
          relevance: RelevanceLevel.DELIBERATE,
        }),
        makeTransition('t2', TransitionOperation.HOVER, 2000, {
          relevance: RelevanceLevel.SUPPORTING,
        }),
      ];

      const workflow = deriveWorkflow(actions, transitions, [], new Map());

      expect(workflow.optionalSteps).toHaveLength(1);
      expect(workflow.optionalSteps[0].actionId).toBe('a2');
    });

    it('excludes actions with any deliberate transitions', () => {
      const actions = [
        makeAction('a1', ['t1', 't2'], 1000), // mixed
      ];

      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, {
          relevance: RelevanceLevel.DELIBERATE,
        }),
        makeTransition('t2', TransitionOperation.HOVER, 2000, {
          relevance: RelevanceLevel.SUPPORTING,
        }),
      ];

      const workflow = deriveWorkflow(actions, transitions, [], new Map());
      expect(workflow.optionalSteps).toHaveLength(0);
    });

    it('returns empty when all actions are deliberate', () => {
      const actions = [makeAction('a1', ['t1'], 1000)];
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, {
          relevance: RelevanceLevel.DELIBERATE,
        }),
      ];

      const workflow = deriveWorkflow(actions, transitions, [], new Map());
      expect(workflow.optionalSteps).toHaveLength(0);
    });
  });
});
