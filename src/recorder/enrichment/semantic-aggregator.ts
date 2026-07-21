/**
 * Semantic Aggregator — groups observed transitions into logical user actions.
 *
 * THE KEY CONCERN of Phase 5. This module transforms a stream of low-level
 * transitions (click, select, toggle) into higher-level semantic actions by
 * leveraging the knowledge model.
 *
 * ARCHITECTURAL PRINCIPLES (inviolate):
 *
 * 1. GENERIC — zero pattern-specific logic. The algorithm never asks "is this
 *    a dropdown?" or references any PatternType. All pattern knowledge comes
 *    from `PatternDefinition.expectedLifecycle` in the catalogue. Adding a
 *    new pattern is handled automatically.
 *
 * 2. DERIVED COMPUTATION — LogicalAction references foundational entities by ID
 *    (componentId, transitionIds) but creates no new persisted data. It can be
 *    recomputed at any time from the same inputs.
 *
 * 3. STRUCTURAL DESCRIPTION — no actionType enum. A logical action is described
 *    by {component, transitions, business field, resulting change, completeness}.
 *    Consumers derive classifications from this structural data.
 *
 * ALGORITHM — Lifecycle Occurrence Segmentation:
 *
 * Instead of naive set-membership (which discards ordering and count), the
 * algorithm segments the transition stream into discrete lifecycle OCCURRENCES
 * before checking completeness. Three boundary rules control segmentation:
 *
 *   Rule A — Restart: for multi-operation lifecycles, reappearance of the
 *            initial operation (after the occurrence is non-empty) closes
 *            the current occurrence and starts a new one.
 *            Does NOT apply to single-operation lifecycles (consecutive
 *            same-ops aggregate — incremental typing is one action).
 *
 *   Rule B — Gap: a transition whose operation is NOT in the expected lifecycle
 *            closes the current occurrence and records a gap. The next
 *            expected operation starts a new occurrence.
 *
 *   Rule C — Temporal gap: configurable time threshold between transitions
 *            within the same occurrence. Disabled by default.
 *
 * After segmentation, completeness is checked per-occurrence:
 *   observedOps = set(t.operation for t in occurrence)
 *   lifecycleComplete = expectedOps ⊆ observedOps
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §4
 *           docs/architecture-review.md, docs/architecture-walkthrough.md
 */

import type { ComponentGrouping } from '../../domain/entities/component-grouping';
import type { ObservedTransition } from '../../domain/entities/observed-transition';
import type { LogicalAction, ResultingChange } from '../../domain/entities/application-knowledge';
import type { PatternDefinition } from '../recognition/pattern-catalogue';
import { TransitionOperation, RelevanceLevel } from '../../domain/enums';

/**
 * Options for the semantic aggregator.
 */
export interface AggregationOptions {
  /**
   * Rule C — temporal gap threshold in milliseconds.
   * If the time between consecutive transitions within the same occurrence
   * exceeds this value, the current occurrence is closed.
   *
   * Set to 0 (or omit) to disable Rule C — the default.
   */
  readonly temporalGapMs?: number;
}

/**
 * Input for the semantic aggregator.
 */
export interface AggregationInput {
  /** All confirmed components. */
  readonly components: ComponentGrouping[];
  /** All observed transitions (will be ordered by timestamp internally). */
  readonly transitions: ObservedTransition[];
  /** Pattern definitions keyed by pattern type. */
  readonly patterns: ReadonlyMap<string, PatternDefinition>;
  /** Optional configuration (Rule C temporal gap, etc.). */
  readonly options?: AggregationOptions;
}

// ── Internal types ───────────────────────────────────────

/**
 * A lifecycle occurrence — a group of transitions on the same component that
 * form one semantic interaction attempt (complete or incomplete).
 */
interface LifecycleOccurrence {
  readonly transitions: ObservedTransition[];
  readonly lifecycleComplete: boolean;
}

// ── Public API ───────────────────────────────────────────

/**
 * Group observed transitions into semantic logical actions.
 *
 * The algorithm is fully generic — it operates on componentId, lifecycle
 * expectations, state changes, and timestamps. It never references any
 * specific pattern type.
 *
 * @param input Components, transitions, pattern catalogue, and optional config.
 * @returns Ordered LogicalAction[] (by timestamp).
 */
export function aggregateActions(input: AggregationInput): LogicalAction[] {
  const { components, transitions, patterns, options } = input;
  const temporalGapMs = options?.temporalGapMs ?? 0;

  // Sort transitions chronologically for consistent processing
  const sorted = [...transitions].sort((a, b) => a.timestamp - b.timestamp);

  // Step 1: Partition by component boundaries
  const componentTransitions = new Map<string, ObservedTransition[]>();
  const standalone: ObservedTransition[] = [];

  for (const t of sorted) {
    if (t.componentId) {
      const list = componentTransitions.get(t.componentId);
      if (list) {
        list.push(t);
      } else {
        componentTransitions.set(t.componentId, [t]);
      }
    } else {
      standalone.push(t);
    }
  }

  const actions: LogicalAction[] = [];

  // Step 2: For each component, segment transitions into lifecycle occurrences
  for (const component of components) {
    const compTransitions = componentTransitions.get(component.groupingId);
    if (!compTransitions) continue;

    const pattern = patterns.get(component.patternType);
    const expectedLifecycle = pattern?.expectedLifecycle;

    const occurrences = segmentIntoOccurrences(
      compTransitions,
      expectedLifecycle,
      temporalGapMs,
    );

    for (const occ of occurrences) {
      actions.push(buildComponentAction(component, occ));
    }
  }

  // Step 3: Standalone transitions each become their own action
  for (const t of standalone) {
    actions.push(buildStandaloneAction(t));
  }

  // Step 4: Sort all actions by their first transition timestamp
  actions.sort((a, b) => a.timestamp - b.timestamp);

  return actions;
}

// ── Lifecycle Occurrence Segmentation ────────────────────

/**
 * Segment a component's transitions into discrete lifecycle occurrences
 * using Rules A, B, and C.
 *
 * This is the core of the algorithm — it replaces naive set-membership with
 * proper temporal segmentation so independent user actions are never merged.
 */
function segmentIntoOccurrences(
  transitions: ObservedTransition[],
  expectedLifecycle: readonly TransitionOperation[] | undefined,
  temporalGapMs: number,
): LifecycleOccurrence[] {
  // No lifecycle defined — each transition is its own complete occurrence
  if (!expectedLifecycle || expectedLifecycle.length === 0) {
    return transitions.map((t) => ({
      transitions: [t],
      lifecycleComplete: true,
    }));
  }

  const expectedSet = new Set(expectedLifecycle);
  const isMultiOp = expectedLifecycle.length > 1;
  const initialOp = expectedLifecycle[0];

  const occurrences: LifecycleOccurrence[] = [];
  let current: ObservedTransition[] = [];

  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];
    const prev = i > 0 ? transitions[i - 1] : null;

    // ── Rule C: Temporal gap ──
    if (
      temporalGapMs > 0 &&
      prev &&
      current.length > 0 &&
      t.timestamp - prev.timestamp > temporalGapMs
    ) {
      // Close current occurrence on temporal gap
      occurrences.push(finalizeOccurrence(current, expectedSet));
      current = [];
    }

    // ── Rule B: Gap (intervening operation not in expected lifecycle) ──
    if (current.length > 0 && !expectedSet.has(t.operation)) {
      // Close current occurrence, this transition starts a gap
      occurrences.push(finalizeOccurrence(current, expectedSet));
      current = [];
      // Skip non-expected transitions — they form a gap, not a new occurrence.
      // The next expected operation will start a new occurrence.
      continue;
    }

    // ── Rule A: Restart (multi-operation lifecycles only) ──
    if (
      isMultiOp &&
      current.length > 0 &&
      t.operation === initialOp
    ) {
      // The initial operation reappeared — close current, start new
      occurrences.push(finalizeOccurrence(current, expectedSet));
      current = [];
    }

    // Add transition to current occurrence
    current.push(t);
  }

  // Remaining transitions form a final occurrence (complete or incomplete)
  if (current.length > 0) {
    occurrences.push(finalizeOccurrence(current, expectedSet));
  }

  return occurrences;
}

/**
 * Finalize a batch of transitions into a LifecycleOccurrence.
 * Computes lifecycle completeness from the expected operation set.
 */
function finalizeOccurrence(
  batch: ObservedTransition[],
  expectedSet: Set<TransitionOperation>,
): LifecycleOccurrence {
  const observedOps = new Set(batch.map((t) => t.operation));
  return {
    transitions: batch,
    lifecycleComplete: isSuperset(observedOps, expectedSet),
  };
}

let actionCounter = 0;

/**
 * Build a LogicalAction for a component from a lifecycle occurrence.
 *
 * - lifecycleComplete: pre-computed during segmentation (expected ops ⊆ observed ops).
 * - resultingChange: net state delta from first stateBefore → last stateAfter.
 * - businessField: from the enriched component (null if not enriched).
 */
function buildComponentAction(
  component: ComponentGrouping,
  occurrence: LifecycleOccurrence,
): LogicalAction {
  return {
    actionId: `action-${++actionCounter}`,
    componentId: component.groupingId,
    businessField: component.businessField,
    transitionIds: occurrence.transitions.map((t) => t.transitionId),
    lifecycleComplete: occurrence.lifecycleComplete,
    resultingChange: deriveResultingChange(occurrence.transitions),
    timestamp: occurrence.transitions[0].timestamp,
  };
}

/**
 * Build a LogicalAction for a standalone transition (no component).
 */
function buildStandaloneAction(t: ObservedTransition): LogicalAction {
  return {
    actionId: `action-${++actionCounter}`,
    componentId: null,
    businessField: null,
    transitionIds: [t.transitionId],
    lifecycleComplete: true,
    resultingChange: deriveResultingChange([t]),
    timestamp: t.timestamp,
  };
}

/**
 * Derive the net state change from a batch of transitions.
 *
 * Reads the first transition's stateBefore and the last transition's stateAfter.
 * Identifies which field (value, checked, expanded, selected) changed and captures
 * the from→to delta. This is pure observation — no inference.
 *
 * @returns ResultingChange, or null if no observable state change in the batch.
 */
function deriveResultingChange(batch: ObservedTransition[]): ResultingChange | null {
  if (batch.length === 0) return null;

  const first = batch[0];
  const last = batch[batch.length - 1];

  const targetElementId = last.elementId;

  // Check each state field for a change from first.stateBefore → last.stateAfter
  // Priority: value > checked > expanded > selected

  if (first.stateBefore.value !== last.stateAfter.value) {
    return {
      targetElementId,
      field: 'value',
      from: first.stateBefore.value,
      to: last.stateAfter.value,
    };
  }

  if (first.stateBefore.checked !== last.stateAfter.checked) {
    return {
      targetElementId,
      field: 'checked',
      from: first.stateBefore.checked,
      to: last.stateAfter.checked,
    };
  }

  if (first.stateBefore.expanded !== last.stateAfter.expanded) {
    return {
      targetElementId,
      field: 'expanded',
      from: first.stateBefore.expanded,
      to: last.stateAfter.expanded,
    };
  }

  if (first.stateBefore.selected !== last.stateAfter.selected) {
    return {
      targetElementId,
      field: 'selected',
      from: first.stateBefore.selected,
      to: last.stateAfter.selected,
    };
  }

  // No observable state change
  return null;
}

/**
 * Check if observed set covers all expected operations.
 * Generic set containment — no pattern-specific logic.
 */
function isSuperset(
  observed: Set<TransitionOperation>,
  expected: Set<TransitionOperation>,
): boolean {
  for (const op of expected) {
    if (!observed.has(op)) {
      return false;
    }
  }
  return true;
}

/**
 * Reset the action ID counter. For testing only.
 */
export function _resetActionCounter(): void {
  actionCounter = 0;
}

/**
 * Check if a transition is a navigation boundary.
 * Used by the workflow deriver but defined here for reuse.
 */
export function isNavigationTransition(t: ObservedTransition): boolean {
  return t.operation === TransitionOperation.NAVIGATE;
}

/**
 * Check if a transition is a supporting (optional) step.
 */
export function isSupportingTransition(t: ObservedTransition): boolean {
  return t.relevance === RelevanceLevel.SUPPORTING;
}
