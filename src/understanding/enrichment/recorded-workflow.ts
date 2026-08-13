/**
 * M9.7 — Recorded Workflow Enrichment
 *
 * Aggregates SemanticWorkflow instances across sessions into recurring
 * RecordedWorkflow patterns. Two workflows share a pattern if their
 * canonical step sequence (intent names) matches.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type {
  SemanticWorkflow,
  RecordedWorkflow,
} from './semantic-types';

/**
 * Aggregate workflows into recorded (recurring) patterns.
 * Returns patterns that appeared 2+ times across sessions.
 *
 * Prior recorded workflows are merged by recomputing the pattern hash
 * from their canonicalSteps. If the hash matches a new workflow, they
 * are merged; otherwise the prior pattern is preserved as-is.
 */
export function aggregateRecordedWorkflows(
  workflows: SemanticWorkflow[],
  priorRecorded: RecordedWorkflow[] = [],
): RecordedWorkflow[] {
  const patternMap = new Map<string, RecordedWorkflow>();

  // Seed with prior patterns — recompute hash from canonicalSteps
  for (const prior of priorRecorded) {
    const patternId = hashPattern(prior.canonicalSteps);
    patternMap.set(patternId, {
      ...prior,
      patternId,
      instances: [...prior.instances],
      sessionIds: [...prior.sessionIds],
    });
  }

  // Process new workflows
  for (const wf of workflows) {
    const patternId = hashPattern(wf.stepIntents);

    const existing = patternMap.get(patternId);
    if (existing) {
      // Merge into existing pattern
      if (!existing.sessionIds.includes(wf.sessionId)) {
        existing.sessionIds.push(wf.sessionId);
      }
      existing.instances.push(wf.workflowId);
      existing.occurrenceCount++;
    } else {
      patternMap.set(patternId, {
        patternId,
        label: wf.label,
        canonicalSteps: [...wf.stepIntents],
        viewSequence: [...wf.viewIds],
        sessionIds: [wf.sessionId],
        occurrenceCount: 1,
        instances: [wf.workflowId],
      });
    }
  }

  // Return patterns sorted by occurrence count (descending)
  return [...patternMap.values()]
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}

/**
 * Filter to only recurring patterns (appeared 2+ times).
 */
export function getRecurringPatterns(
  workflows: RecordedWorkflow[],
): RecordedWorkflow[] {
  return workflows.filter((w) => w.occurrenceCount >= 2);
}

/**
 * Compute a stable hash for a step sequence.
 * Uses a simple string hash (djb2) — deterministic across runs.
 */
function hashPattern(steps: string[]): string {
  const canonical = steps.join('→');
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash) + canonical.charCodeAt(i);
    hash = hash & 0xffffffff; // keep 32-bit
  }
  return `wf-pattern-${(hash >>> 0).toString(16)}`;
}
