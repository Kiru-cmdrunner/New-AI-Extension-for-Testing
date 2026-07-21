/**
 * Tests for Semantic Aggregator — the KEY concern of Phase 5.
 *
 * Verifies the lifecycle occurrence segmentation algorithm:
 *   Rule A (restart), Rule B (gap), Rule C (temporal gap)
 *   plus completeness checking, resulting change derivation,
 *   standalone transitions, and temporal ordering.
 *
 * Tests the "representative scenarios" from the spec directly.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  aggregateActions,
  _resetActionCounter,
} from '../src/recorder/enrichment/semantic-aggregator';
import type { AggregationInput } from '../src/recorder/enrichment/semantic-aggregator';
import type { ComponentGrouping } from '../src/domain/entities/component-grouping';
import type { ObservedTransition, ElementState } from '../src/domain/entities/observed-transition';
import type { PatternDefinition } from '../src/recorder/recognition/pattern-catalogue';
import {
  ComponentRole,
  PatternType,
  RecognitionSource,
  ComponentLifecycleState,
  TransitionOperation,
  RelevanceLevel,
} from '../src/domain/enums';

// ── Fixtures ─────────────────────────────────────────────

function makeState(partial: Partial<ElementState> = {}): ElementState {
  return { value: null, checked: null, expanded: null, selected: null, ...partial };
}

/**
 * Create a transition. The componentId defaults to 'comp-1' — override it
 * when testing multi-component scenarios.
 */
function makeTransition(
  id: string,
  op: TransitionOperation,
  timestamp: number,
  overrides: Partial<ObservedTransition> = {},
): ObservedTransition {
  return {
    transitionId: id,
    elementId: 'trigger-1',
    componentId: 'comp-1',
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

/**
 * Create a confirmed component. Defaults to comp-1 / DROPDOWN.
 * Always uses comp-1 as groupingId unless overridden — transitions default to comp-1 too.
 */
function makeConfirmedComponent(
  groupingId = 'comp-1',
  patternType = PatternType.DROPDOWN,
  rootElementId = 'trigger-1',
  businessField: string | null = 'Travel Class',
): ComponentGrouping {
  return {
    groupingId,
    patternType,
    rootElementId,
    constituents: [
      { elementId: rootElementId, role: ComponentRole.TRIGGER },
      { elementId: 'opt-1', role: ComponentRole.OPTION },
    ],
    businessField,
    recognitionSource: RecognitionSource.STRUCTURAL,
    recognitionConfidence: 0.85,
    lifecycleState: ComponentLifecycleState.CONFIRMED,
    optionSet: null,
    observedTransitionIds: [],
  };
}

function makePattern(
  patternType: string,
  lifecycle: TransitionOperation[],
): PatternDefinition {
  return {
    patternType: patternType as PatternType,
    rootAriaRoles: [],
    constituentRoles: {},
    affordances: [],
    hasOptionSet: false,
    minConstituents: 1,
    description: 'test pattern',
    expectedLifecycle: lifecycle,
  };
}

function makeInput(
  components: ComponentGrouping[],
  transitions: ObservedTransition[],
  patterns: Map<string, PatternDefinition>,
  options?: { temporalGapMs?: number },
): AggregationInput {
  return { components, transitions, patterns, options };
}

/**
 * Helper: create component + pattern + transitions all aligned on componentId.
 */
function setupScenario(
  compId: string,
  patternType: string,
  lifecycle: TransitionOperation[],
  transitionSpecs: [string, TransitionOperation, number, Partial<ObservedTransition>?][],
): {
  component: ComponentGrouping;
  pattern: PatternDefinition;
  transitions: ObservedTransition[];
  patterns: Map<string, PatternDefinition>;
} {
  const component = makeConfirmedComponent(compId, patternType as PatternType);
  const pattern = makePattern(patternType, lifecycle);
  const transitions = transitionSpecs.map(([id, op, ts, overrides]) =>
    makeTransition(id, op, ts, { componentId: compId, ...(overrides ?? {}) }),
  );
  return {
    component,
    pattern,
    transitions,
    patterns: new Map([[patternType, pattern]]),
  };
}

// ── Tests ────────────────────────────────────────────────

describe('aggregateActions', () => {
  beforeEach(() => {
    _resetActionCounter();
  });

  // ── Generic behavior (zero pattern-specific logic) ──

  describe('generic behavior', () => {
    it('produces LogicalAction[] from confirmed components', () => {
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK, TransitionOperation.SELECT]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, {
          stateBefore: makeState({ expanded: false }),
          stateAfter: makeState({ expanded: true }),
        }),
        makeTransition('t2', TransitionOperation.SELECT, 2000, {
          stateBefore: makeState({ value: null }),
          stateAfter: makeState({ value: 'economy' }),
        }),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions).toHaveLength(1);
      expect(actions[0].componentId).toBe('comp-1');
      expect(actions[0].transitionIds).toEqual(['t1', 't2']);
    });

    it('works for checkbox (TOGGLE lifecycle) with same algorithm', () => {
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'checkbox', [TransitionOperation.TOGGLE],
        [
          ['t1', TransitionOperation.TOGGLE, 1000, {
            stateBefore: makeState({ checked: false }),
            stateAfter: makeState({ checked: true }),
          }],
        ],
      );

      const actions = aggregateActions(makeInput([component], transitions, patterns));

      expect(actions).toHaveLength(1);
      expect(actions[0].lifecycleComplete).toBe(true);
    });

    it('works for accordion (CLICK+TOGGLE lifecycle) with same algorithm', () => {
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'accordion', [TransitionOperation.CLICK, TransitionOperation.TOGGLE],
        [
          ['t1', TransitionOperation.CLICK, 1000],
          ['t2', TransitionOperation.TOGGLE, 2000],
        ],
      );

      const actions = aggregateActions(makeInput([component], transitions, patterns));

      expect(actions).toHaveLength(1);
      expect(actions[0].lifecycleComplete).toBe(true);
    });

    it('never references PatternType constants in its output', () => {
      // The output only has structural data — no pattern type classification
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK]);
      const transitions = [makeTransition('t1', TransitionOperation.CLICK, 1000)];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      const actionJson = JSON.stringify(actions[0]);
      // No pattern type string should appear in the LogicalAction
      expect(actionJson).not.toContain('dropdown');
      expect(actionJson).not.toContain('checkbox');
      expect(actionJson).not.toContain('PatternType');
    });
  });

  // ── Derived computation (references IDs, not copies) ──

  describe('derived computation', () => {
    it('LogicalAction references transition IDs, not copies of transition data', () => {
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK]);
      const transitions = [
        makeTransition('t-unique', TransitionOperation.CLICK, 1000, {
          stateBefore: makeState({ value: 'initial' }),
          stateAfter: makeState({ value: 'final' }),
          evidence: [{
            type: 'valueChange' as any,
            description: 'SECRET_EVIDENCE_TEXT',
            before: null,
            after: null,
          }],
          cascadeEffects: [{
            elementId: 'cascade-target',
            effect: 'visibility' as any,
            detail: 'SECRET_CASCADE_DETAIL',
          }],
        }),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions[0].transitionIds).toEqual(['t-unique']);
      // The action should NOT contain full transition objects — only IDs + derived summary
      const actionJson = JSON.stringify(actions[0]);
      expect(actionJson).not.toContain('SECRET_EVIDENCE_TEXT');
      expect(actionJson).not.toContain('SECRET_CASCADE_DETAIL');
      expect(actionJson).not.toContain('cascade-target');
    });

    it('carries businessField from enriched component', () => {
      const component = makeConfirmedComponent('comp-1', PatternType.DROPDOWN, 'trigger-1', 'Departure City');
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK]);
      const transitions = [makeTransition('t1', TransitionOperation.CLICK, 1000)];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions[0].businessField).toBe('Departure City');
    });

    it('sets businessField to null when component has no businessField', () => {
      const component = makeConfirmedComponent('comp-1', PatternType.DROPDOWN, 'trigger-1', null);
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK]);
      const transitions = [makeTransition('t1', TransitionOperation.CLICK, 1000)];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions[0].businessField).toBeNull();
    });
  });

  // ── Rule A: Restart (multi-operation lifecycles) ──

  describe('Rule A — restart', () => {
    it('splits multi-op lifecycle on initial-operation reappearance', () => {
      // CLICK, SELECT, CLICK, SELECT with expectedLifecycle=[CLICK, SELECT]
      // → Rule A splits at 2nd CLICK → TWO complete occurrences
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK, TransitionOperation.SELECT]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000),
        makeTransition('t2', TransitionOperation.SELECT, 2000),
        makeTransition('t3', TransitionOperation.CLICK, 3000), // restart!
        makeTransition('t4', TransitionOperation.SELECT, 4000),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions).toHaveLength(2);
      // First action: t1, t2
      expect(actions[0].transitionIds).toEqual(['t1', 't2']);
      expect(actions[0].lifecycleComplete).toBe(true);
      // Second action: t3, t4
      expect(actions[1].transitionIds).toEqual(['t3', 't4']);
      expect(actions[1].lifecycleComplete).toBe(true);
    });

    it('does NOT apply Rule A to single-operation lifecycles', () => {
      // TYPE, TYPE, TYPE with expectedLifecycle=[FILL]
      // → Rule A doesn't apply (length 1) → ONE occurrence
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'custom', [TransitionOperation.FILL],
        [
          ['t1', TransitionOperation.FILL, 1000, {
            stateBefore: makeState({ value: null }),
            stateAfter: makeState({ value: 'jo' }),
          }],
          ['t2', TransitionOperation.FILL, 2000, {
            stateBefore: makeState({ value: 'jo' }),
            stateAfter: makeState({ value: 'john' }),
          }],
          ['t3', TransitionOperation.FILL, 3000, {
            stateBefore: makeState({ value: 'john' }),
            stateAfter: makeState({ value: 'john@example.com' }),
          }],
        ],
      );

      const actions = aggregateActions(makeInput([component], transitions, patterns));

      expect(actions).toHaveLength(1);
      expect(actions[0].transitionIds).toEqual(['t1', 't2', 't3']);
      expect(actions[0].lifecycleComplete).toBe(true);
    });

    it('Rule A does not trigger on first transition (empty occurrence)', () => {
      // First CLICK should NOT split — occurrence is empty when it arrives
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK, TransitionOperation.SELECT]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000),
        makeTransition('t2', TransitionOperation.SELECT, 2000),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions).toHaveLength(1);
    });
  });

  // ── Rule B: Gap (intervening operation) ──

  describe('Rule B — gap', () => {
    it('closes occurrence when intervening non-lifecycle operation appears', () => {
      // FILL, CLICK-elsewhere, FILL with expectedLifecycle=[FILL]
      // → Rule B (CLICK ∉ {FILL}) closes occ #1, then occ #2 starts
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'custom', [TransitionOperation.FILL],
        [
          ['t1', TransitionOperation.FILL, 1000, {
            stateBefore: makeState({ value: null }),
            stateAfter: makeState({ value: 'partial' }),
          }],
          // Intervening click — NOT in expected lifecycle
          ['t2', TransitionOperation.CLICK, 2000, {
            stateBefore: makeState(),
            stateAfter: makeState(),
          }],
          ['t3', TransitionOperation.FILL, 3000, {
            stateBefore: makeState({ value: null }),
            stateAfter: makeState({ value: 'final' }),
          }],
        ],
      );

      const actions = aggregateActions(makeInput([component], transitions, patterns));

      // Rule B closes at t2 (click not in lifecycle), t2 is skipped.
      // t3 starts a new occurrence.
      expect(actions).toHaveLength(2);
      expect(actions[0].transitionIds).toEqual(['t1']);
      expect(actions[1].transitionIds).toEqual(['t3']);
    });
  });

  // ── Rule C: Temporal gap ──

  describe('Rule C — temporal gap', () => {
    it('is disabled by default (temporalGapMs=0)', () => {
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'dropdown', [TransitionOperation.CLICK],
        [
          ['t1', TransitionOperation.CLICK, 1000],
          ['t2', TransitionOperation.CLICK, 100000], // 99s gap
        ],
      );

      const actions = aggregateActions(makeInput([component], transitions, patterns));

      // Single-op lifecycle → both aggregate into one occurrence
      expect(actions).toHaveLength(1);
    });

    it('splits occurrences when temporal gap exceeds threshold', () => {
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'custom', [TransitionOperation.FILL],
        [
          ['t1', TransitionOperation.FILL, 1000],
          ['t2', TransitionOperation.FILL, 6000], // 5s gap > 3000ms threshold
        ],
      );

      const actions = aggregateActions(
        makeInput([component], transitions, patterns, { temporalGapMs: 3000 }),
      );

      expect(actions).toHaveLength(2);
      expect(actions[0].transitionIds).toEqual(['t1']);
      expect(actions[1].transitionIds).toEqual(['t2']);
    });
  });

  // ── Lifecycle completeness ──

  describe('lifecycle completeness', () => {
    it('marks complete when all expected ops observed', () => {
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK, TransitionOperation.SELECT]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000),
        makeTransition('t2', TransitionOperation.SELECT, 2000),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions[0].lifecycleComplete).toBe(true);
    });

    it('marks incomplete when expected ops missing', () => {
      // CLICK only, expectedLifecycle=[CLICK, SELECT]
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK, TransitionOperation.SELECT]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000),
        // SELECT never happened
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions).toHaveLength(1);
      expect(actions[0].lifecycleComplete).toBe(false);
    });

    it('handles abandoned re-open: one complete + one incomplete', () => {
      // CLICK, SELECT, CLICK with expectedLifecycle=[CLICK, SELECT]
      // Rule A splits at 3rd CLICK → occ #1 complete, occ #2 incomplete
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK, TransitionOperation.SELECT]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000),
        makeTransition('t2', TransitionOperation.SELECT, 2000),
        makeTransition('t3', TransitionOperation.CLICK, 3000), // reopen
        // No SELECT for the reopened dropdown
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions).toHaveLength(2);
      expect(actions[0].lifecycleComplete).toBe(true);
      expect(actions[1].lifecycleComplete).toBe(false);
    });
  });

  // ── Resulting change derivation ──

  describe('resultingChange', () => {
    it('captures value change from first stateBefore → last stateAfter', () => {
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'custom', [TransitionOperation.FILL],
        [
          ['t1', TransitionOperation.FILL, 1000, {
            stateBefore: makeState({ value: null }),
            stateAfter: makeState({ value: 'jo' }),
          }],
          ['t2', TransitionOperation.FILL, 2000, {
            stateBefore: makeState({ value: 'jo' }),
            stateAfter: makeState({ value: 'john' }),
          }],
        ],
      );

      const actions = aggregateActions(makeInput([component], transitions, patterns));

      expect(actions[0].resultingChange).not.toBeNull();
      expect(actions[0].resultingChange!.field).toBe('value');
      expect(actions[0].resultingChange!.from).toBeNull();
      expect(actions[0].resultingChange!.to).toBe('john');
    });

    it('captures checked change', () => {
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'checkbox', [TransitionOperation.TOGGLE],
        [
          ['t1', TransitionOperation.TOGGLE, 1000, {
            stateBefore: makeState({ checked: false }),
            stateAfter: makeState({ checked: true }),
          }],
        ],
      );

      const actions = aggregateActions(makeInput([component], transitions, patterns));

      expect(actions[0].resultingChange!.field).toBe('checked');
      expect(actions[0].resultingChange!.from).toBe(false);
      expect(actions[0].resultingChange!.to).toBe(true);
    });

    it('captures expanded change', () => {
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, {
          stateBefore: makeState({ expanded: false }),
          stateAfter: makeState({ expanded: true }),
        }),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions[0].resultingChange!.field).toBe('expanded');
      expect(actions[0].resultingChange!.from).toBe(false);
      expect(actions[0].resultingChange!.to).toBe(true);
    });

    it('returns null when no observable state change', () => {
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, {
          stateBefore: makeState({ value: 'same' }),
          stateAfter: makeState({ value: 'same' }),
        }),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions[0].resultingChange).toBeNull();
    });

    it('sets targetElementId to the last transition element', () => {
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK, TransitionOperation.SELECT]);
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, {
          elementId: 'trigger-1',
          stateBefore: makeState({ value: null }),
          stateAfter: makeState({ value: null }),
        }),
        makeTransition('t2', TransitionOperation.SELECT, 2000, {
          elementId: 'opt-3',
          stateBefore: makeState({ value: null }),
          stateAfter: makeState({ value: 'first' }),
        }),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      expect(actions[0].resultingChange!.targetElementId).toBe('opt-3');
    });
  });

  // ── Standalone transitions ──

  describe('standalone transitions', () => {
    it('each standalone transition gets its own action', () => {
      const transitions = [
        makeTransition('s1', TransitionOperation.CLICK, 1000, { componentId: null }),
        makeTransition('s2', TransitionOperation.NAVIGATE, 2000, { componentId: null }),
      ];

      const actions = aggregateActions(
        makeInput([], transitions, new Map()),
      );

      expect(actions).toHaveLength(2);
      expect(actions[0].componentId).toBeNull();
      expect(actions[1].componentId).toBeNull();
      expect(actions[0].transitionIds).toEqual(['s1']);
      expect(actions[1].transitionIds).toEqual(['s2']);
    });

    it('standalone actions have lifecycleComplete=true', () => {
      const transitions = [
        makeTransition('s1', TransitionOperation.CLICK, 1000, { componentId: null }),
      ];

      const actions = aggregateActions(
        makeInput([], transitions, new Map()),
      );

      expect(actions[0].lifecycleComplete).toBe(true);
    });

    it('standalone actions have null businessField', () => {
      const transitions = [
        makeTransition('s1', TransitionOperation.CLICK, 1000, { componentId: null }),
      ];

      const actions = aggregateActions(
        makeInput([], transitions, new Map()),
      );

      expect(actions[0].businessField).toBeNull();
    });
  });

  // ── Temporal ordering ──

  describe('temporal ordering', () => {
    it('orders actions by first transition timestamp', () => {
      const component = makeConfirmedComponent();
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK]);
      // Transitions given out of order
      const transitions = [
        makeTransition('t2', TransitionOperation.CLICK, 3000),
        makeTransition('t1', TransitionOperation.CLICK, 1000),
        makeTransition('t3', TransitionOperation.CLICK, 2000),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['dropdown', pattern]])),
      );

      // Single-op lifecycle → one action with all three transitions
      // Timestamp should be the first (1000)
      expect(actions).toHaveLength(1);
      expect(actions[0].timestamp).toBe(1000);
    });

    it('orders standalone actions by timestamp', () => {
      const transitions = [
        makeTransition('late', TransitionOperation.CLICK, 5000, { componentId: null }),
        makeTransition('early', TransitionOperation.CLICK, 1000, { componentId: null }),
      ];

      const actions = aggregateActions(
        makeInput([], transitions, new Map()),
      );

      expect(actions[0].transitionIds).toEqual(['early']);
      expect(actions[1].transitionIds).toEqual(['late']);
    });
  });

  // ── Interleaved components ──

  describe('interleaved components', () => {
    it('does not cross-merge transitions from different components', () => {
      const compA = makeConfirmedComponent('comp-a', PatternType.DROPDOWN, 'trigger-a');
      const compB = makeConfirmedComponent('comp-b', PatternType.DROPDOWN, 'trigger-b');
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK, TransitionOperation.SELECT]);
      const patterns = new Map([['dropdown', pattern]]);

      // Interleaved: CLICK-A, CLICK-B, SELECT-B, SELECT-A
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, { componentId: 'comp-a', elementId: 'trigger-a' }),
        makeTransition('t2', TransitionOperation.CLICK, 2000, { componentId: 'comp-b', elementId: 'trigger-b' }),
        makeTransition('t3', TransitionOperation.SELECT, 3000, { componentId: 'comp-b', elementId: 'trigger-b' }),
        makeTransition('t4', TransitionOperation.SELECT, 4000, { componentId: 'comp-a', elementId: 'trigger-a' }),
      ];

      const actions = aggregateActions(
        makeInput([compA, compB], transitions, patterns),
      );

      // Each component should have its own action
      expect(actions).toHaveLength(2);

      const actionA = actions.find((a) => a.componentId === 'comp-a')!;
      const actionB = actions.find((a) => a.componentId === 'comp-b')!;

      // Comp A: t1, t4 (CLICK then SELECT — interleaved with B but not merged)
      expect(actionA.transitionIds).toContain('t1');
      expect(actionA.transitionIds).toContain('t4');
      expect(actionA.transitionIds).not.toContain('t2');
      expect(actionA.transitionIds).not.toContain('t3');

      // Comp B: t2, t3
      expect(actionB.transitionIds).toContain('t2');
      expect(actionB.transitionIds).toContain('t3');
    });
  });

  // ── Checkbox toggled multiple times ──

  describe('single-operation lifecycle: multiple toggles', () => {
    it('checkbox toggled 3x produces ONE action with final state', () => {
      // TOGGLE, TOGGLE, TOGGLE with expectedLifecycle=[TOGGLE]
      // Rule A doesn't apply (length 1) → one occurrence
      const { component, transitions, patterns } = setupScenario(
        'comp-1', 'checkbox', [TransitionOperation.TOGGLE],
        [
          ['t1', TransitionOperation.TOGGLE, 1000, {
            stateBefore: makeState({ checked: false }),
            stateAfter: makeState({ checked: true }),
          }],
          ['t2', TransitionOperation.TOGGLE, 2000, {
            stateBefore: makeState({ checked: true }),
            stateAfter: makeState({ checked: false }),
          }],
          ['t3', TransitionOperation.TOGGLE, 3000, {
            stateBefore: makeState({ checked: false }),
            stateAfter: makeState({ checked: true }),
          }],
        ],
      );

      const actions = aggregateActions(makeInput([component], transitions, patterns));

      expect(actions).toHaveLength(1);
      expect(actions[0].transitionIds).toHaveLength(3);
      // Net change: false → true (first stateBefore → last stateAfter)
      expect(actions[0].resultingChange!.from).toBe(false);
      expect(actions[0].resultingChange!.to).toBe(true);
    });
  });

  // ── No lifecycle defined ──

  describe('no expected lifecycle', () => {
    it('each transition becomes its own complete occurrence', () => {
      const component = makeConfirmedComponent('comp-1', PatternType.CUSTOM);
      const pattern: PatternDefinition = {
        patternType: PatternType.CUSTOM,
        rootAriaRoles: [],
        constituentRoles: {},
        affordances: [],
        hasOptionSet: false,
        minConstituents: 1,
        description: 'no lifecycle',
        // expectedLifecycle omitted
      };

      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000),
        makeTransition('t2', TransitionOperation.FILL, 2000),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map([['custom', pattern]])),
      );

      expect(actions).toHaveLength(2);
      expect(actions[0].lifecycleComplete).toBe(true);
      expect(actions[1].lifecycleComplete).toBe(true);
    });
  });

  // ── Edge cases ──

  describe('edge cases', () => {
    it('returns empty array when no transitions and no components', () => {
      const actions = aggregateActions(makeInput([], [], new Map()));
      expect(actions).toEqual([]);
    });

    it('skips components with no transitions', () => {
      const comp1 = makeConfirmedComponent('comp-1');
      const comp2 = makeConfirmedComponent('comp-2', PatternType.DROPDOWN, 'trigger-2');
      const pattern = makePattern('dropdown', [TransitionOperation.CLICK]);
      // Only comp-2 has transitions
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, { componentId: 'comp-2' }),
      ];

      const actions = aggregateActions(
        makeInput([comp1, comp2], transitions, new Map([['dropdown', pattern]])),
      );

      // Only comp-2 should produce an action
      expect(actions).toHaveLength(1);
      expect(actions[0].componentId).toBe('comp-2');
    });

    it('handles pattern not found in map', () => {
      const component = makeConfirmedComponent('comp-1', PatternType.CUSTOM);
      // No pattern in map for 'custom'
      const transitions = [
        makeTransition('t1', TransitionOperation.CLICK, 1000, { componentId: 'comp-1' }),
      ];

      const actions = aggregateActions(
        makeInput([component], transitions, new Map()),
      );

      // No lifecycle → each transition is its own complete occurrence
      expect(actions).toHaveLength(1);
      expect(actions[0].lifecycleComplete).toBe(true);
    });
  });

  // ── Action ID generation ──

  describe('action IDs', () => {
    it('generates unique sequential action IDs', () => {
      const transitions = [
        makeTransition('s1', TransitionOperation.CLICK, 1000, { componentId: null }),
        makeTransition('s2', TransitionOperation.CLICK, 2000, { componentId: null }),
      ];

      const actions = aggregateActions(makeInput([], transitions, new Map()));

      expect(actions[0].actionId).not.toBe(actions[1].actionId);
      expect(actions[0].actionId).toMatch(/^action-\d+$/);
    });
  });
});
