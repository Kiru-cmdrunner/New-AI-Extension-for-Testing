/**
 * M9.7 — Workflow Discoverer
 *
 * Groups interactions into semantic workflows based on temporal proximity
 * and view containment. A workflow is a sequence of interactions that
 * achieves a user goal within a single session.
 *
 * Algorithm:
 *   1. Sort interactions by timestamp.
 *   2. Walk forward, starting a new workflow when:
 *      a) A view-change occurs after at least one interaction in the current
 *         candidate group, AND
 *      b) The gap since the last interaction exceeds WORKFLOW_GAP_MS,
 *         OR the view-change signals a distinct "page" boundary.
 *   3. For each workflow, compute WorkflowEffects by aggregating outcomes.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { ActionOutcome } from '../outcome/outcome-types';
import type { StateTransition } from '../state-builder/types';
import type { IntentLabel } from './semantic-types';
import type { SemanticWorkflow, WorkflowEffects } from './semantic-types';

/** Gap threshold: interactions more than this apart are separate workflows. */
const WORKFLOW_GAP_MS = 60_000; // 60 seconds

/**
 * Discover workflows from a list of interactions, their outcomes,
 * state transitions, and intent labels.
 */
export function discoverWorkflows(
  interactions: ComponentInteraction[],
  outcomes: Map<string, ActionOutcome>,
  transitions: StateTransition[],
  intents: Map<string, IntentLabel>,
  sessionId: string,
): SemanticWorkflow[] {
  if (interactions.length === 0) return [];

  // Sort by start time
  const sorted = [...interactions].sort((a, b) => a.startTime - b.startTime);
  const transitionMap = new Map(transitions.map((t) => [t.interactionId, t]));

  // Group into raw workflow segments
  const groups: ComponentInteraction[][] = [];
  let current: ComponentInteraction[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = curr.startTime - prev.endTime;

    const prevTransition = transitionMap.get(prev.interactionId);
    const viewChanged =
      prevTransition &&
      prevTransition.changes.some(
        (c) => c.includes('view') || c.includes('View'),
      );

    // Split if gap too large, or view changed after at least 1 interaction
    const shouldSplit =
      gap > WORKFLOW_GAP_MS ||
      (viewChanged && current.length >= 1 && isWorkflowBoundary(prevTransition));

    if (shouldSplit) {
      groups.push(current);
      current = [curr];
    } else {
      current.push(curr);
    }
  }
  groups.push(current);

  // Convert groups to SemanticWorkflow
  return groups
    .filter((g) => g.length > 0)
    .map((g, idx) =>
      buildWorkflow(g, idx, outcomes, transitionMap, intents, sessionId),
    );
}

/**
 * A view change is a workflow boundary if it's to a different "page"
 * (not just a sub-section change). We use the view ID prefix.
 */
function isWorkflowBoundary(
  transition: StateTransition | undefined,
): boolean {
  if (!transition) return false;
  const before = transition.before.currentView?.id ?? '';
  const after = transition.after.currentView?.id ?? '';
  if (!before || !after) return false;
  return before !== after;
}

/**
 * Build a SemanticWorkflow from a group of interactions.
 */
function buildWorkflow(
  group: ComponentInteraction[],
  index: number,
  outcomes: Map<string, ActionOutcome>,
  transitionMap: Map<string, StateTransition>,
  intents: Map<string, IntentLabel>,
  sessionId: string,
): SemanticWorkflow {
  const stepIds = group.map((i) => i.interactionId);
  const stepIntents = stepIds.map(
    (id) => intents.get(id)?.intent ?? 'Unknown',
  );

  const viewIds: string[] = [];
  for (const interaction of group) {
    const transition = transitionMap.get(interaction.interactionId);
    const beforeView = transition?.before.currentView?.id;
    const afterView = transition?.after.currentView?.id;
    if (beforeView && !viewIds.includes(beforeView)) viewIds.push(beforeView);
    if (afterView && !viewIds.includes(afterView)) viewIds.push(afterView);
  }

  const effects = computeEffects(group, outcomes, transitionMap);
  const overallOutcome = computeOverallOutcome(group, outcomes);
  const label = deriveWorkflowLabel(stepIntents);

  return {
    workflowId: `wf-${sessionId}-${index}`,
    sessionId,
    label,
    stepIds,
    stepIntents,
    viewIds,
    overallOutcome,
    effects,
  };
}

/**
 * Compute aggregated workflow effects from outcomes + transitions.
 *
 * D10: now reads from structured state (before/after Maps) instead of
 * regex-matching free-form change strings. This fixes counterDeltas,
 * collectionChanges, entitiesModified, and view transitions, all of
 * which were previously always empty or mis-detected.
 */
function computeEffects(
  group: ComponentInteraction[],
  outcomes: Map<string, ActionOutcome>,
  transitionMap: Map<string, StateTransition>,
): WorkflowEffects {
  const entitiesCreated: string[] = [];
  const entitiesModified: string[] = [];
  const counterDeltas: { counterId: string; delta: number }[] = [];
  const collectionChanges: { collectionId: string; netChange: number }[] = [];
  const notificationsEmitted: { text: string; severity: string }[] = [];
  const viewTransitions: { from: string; to: string }[] = [];

  for (const interaction of group) {
    const outcome = outcomes.get(interaction.interactionId);
    const transition = transitionMap.get(interaction.interactionId);

    // Resulting entities (structured — already worked before D10)
    if (outcome?.resultingEntities) {
      for (const entityId of outcome.resultingEntities) {
        if (!entitiesCreated.includes(entityId)) {
          entitiesCreated.push(entityId);
        }
      }
    }

    if (!transition) continue;

    // D10: Counter deltas — diff before/after counter value maps.
    const beforeCounters = transition.before.counters;
    const afterCounters = transition.after.counters;
    for (const [counterId, afterCounter] of afterCounters) {
      const beforeCounter = beforeCounters.get(counterId);
      const afterValues = afterCounter.values;
      const beforeValues = beforeCounter?.values ?? [];
      if (afterValues.length === 0) continue;

      const afterVal = Number(afterValues[afterValues.length - 1].value);
      const beforeVal = beforeValues.length > 0
        ? Number(beforeValues[beforeValues.length - 1].value)
        : NaN;

      if (!Number.isFinite(afterVal)) continue;
      const delta = Number.isFinite(beforeVal) ? afterVal - beforeVal : afterVal;
      if (delta === 0 && beforeValues.length > 0) continue;

      counterDeltas.push({ counterId, delta });
    }

    // D10: Collection changes — diff before/after collection counts.
    const beforeColls = transition.before.collections;
    const afterColls = transition.after.collections;
    for (const [collId, afterColl] of afterColls) {
      const beforeColl = beforeColls.get(collId);
      const afterCount = afterColl.count ?? 0;
      const beforeCount = beforeColl?.count ?? null;

      // New collection or changed count
      if (!beforeColl || beforeCount !== afterCount) {
        const netChange = beforeCount !== null ? afterCount - beforeCount : afterCount;
        if (netChange !== 0 || !beforeColl) {
          collectionChanges.push({ collectionId: collId, netChange });
        }
      }
    }

    // D10: Entities modified — detect entities whose attributes changed
    // or whose state changed between before and after.
    const beforeEnts = transition.before.entities;
    const afterEnts = transition.after.entities;
    for (const [entId, afterEnt] of afterEnts) {
      const beforeEnt = beforeEnts.get(entId);
      if (!beforeEnt) continue; // new entity → already in entitiesCreated

      // Check if attributes changed
      const beforeKeys = Object.keys(beforeEnt.attributes);
      const afterKeys = Object.keys(afterEnt.attributes);
      const keysChanged = beforeKeys.length !== afterKeys.length
        || beforeKeys.some((k) => beforeEnt.attributes[k] !== afterEnt.attributes[k]);

      // Check if lifecycle state changed
      const stateChanged = beforeEnt.currentState !== afterEnt.currentState;

      if (keysChanged || stateChanged) {
        if (!entitiesModified.includes(entId)) {
          entitiesModified.push(entId);
        }
      }
    }

    // D10: View transitions — use structured before/after view IDs.
    const fromView = transition.before.currentView?.id;
    const toView = transition.after.currentView?.id;
    if (fromView && toView && fromView !== toView) {
      // Avoid duplicates
      const exists = viewTransitions.some(
        (vt) => vt.from === fromView && vt.to === toView,
      );
      if (!exists) {
        viewTransitions.push({ from: fromView, to: toView });
      }
    }

    // Notifications (structured — already worked before D10)
    for (const notif of transition.after.notifications) {
      if (notif.appearedAt === interaction.interactionId) {
        notificationsEmitted.push({
          text: notif.text,
          severity: notif.severity,
        });
      }
    }
  }

  return {
    entitiesCreated,
    entitiesModified,
    counterDeltas,
    collectionChanges,
    notificationsEmitted,
    viewTransitions,
  };
}

/**
 * Determine overall outcome: if any failure and no success → failure;
 * if all success → success; mixed → mixed; otherwise unknown.
 */
function computeOverallOutcome(
  group: ComponentInteraction[],
  outcomes: Map<string, ActionOutcome>,
): SemanticWorkflow['overallOutcome'] {
  let hasSuccess = false;
  let hasFailure = false;

  for (const interaction of group) {
    const outcome = outcomes.get(interaction.interactionId);
    if (!outcome) continue;
    if (outcome.outcome === 'success') hasSuccess = true;
    if (outcome.outcome === 'failure') hasFailure = true;
  }

  if (hasSuccess && !hasFailure) return 'success';
  if (hasFailure && !hasSuccess) return 'failure';
  if (hasSuccess && hasFailure) return 'mixed';
  return 'unknown';
}

/**
 * Derive a human-readable label from the dominant intent.
 */
function deriveWorkflowLabel(stepIntents: string[]): string {
  if (stepIntents.length === 0) return 'Empty workflow';

  // Pick the most specific non-generic intent
  const genericIntents = new Set(['Unknown', 'Navigate', 'Submit form']);
  const specific = stepIntents.filter((i) => !genericIntents.has(i));

  if (specific.length > 0) {
    // Count occurrences
    const counts = new Map<string, number>();
    for (const intent of specific) {
      counts.set(intent, (counts.get(intent) ?? 0) + 1);
    }
    // Most frequent
    let best = specific[0];
    let bestCount = 0;
    for (const [intent, count] of counts) {
      if (count > bestCount) {
        best = intent;
        bestCount = count;
    }
    }
    return best;
  }

  return stepIntents[0];
}
