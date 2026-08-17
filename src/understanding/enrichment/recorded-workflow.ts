/**
 * M9.7 — Recorded Workflow Enrichment
 *
 * Aggregates SemanticWorkflow instances across sessions into recurring
 * RecordedWorkflow patterns. Two workflows share a pattern if their
 * canonical step sequence matches after D7 canonicalization.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type {
  SemanticWorkflow,
  RecordedWorkflow,
} from './semantic-types';
import { AMBIENT_API_INTENTS } from './intent-labeler';

/**
 * Canonicalize one workflow step label for identity purposes (D7).
 *
 * Identity must be stable across recordings of the same user workflow even
 * when ambient, non-user activity (background polling/heartbeat requests,
 * unattributed fetches) leaks a "Fetch data"-style API-operation intent in
 * for some sessions but not others, or when two steps carry the same
 * literal label differing only by whitespace or case.
 *
 * Rules (identity-only — raw session steps are preserved verbatim elsewhere):
 *   1. Ambient API-operation labels are dropped ("Fetch data",
 *      "Submit form", "Update resource", "Delete resource"). They describe
 *      network noise attributed to whichever step happened to precede the
 *      request, not the user's action, so they must never affect identity.
 *   2. Exact consecutive duplicates collapse to one ("search" → "search"
 *      after step 1 becomes one "search" step).
 *   3. Whitespace is trimmed/collapsed and case is normalized, so literal
 *      label differences ("Go " vs "go") don't split patterns.
 *   4. Absolute URLs collapse to their origin-agnostic path shape
 *      ("/product.html?id=P100" and "/product.html?id=P200" are distinct
 *      because the path+query is the navigation identity, but the scheme,
 *      host and port — which differ per environment — are stripped).
 *   5. Anything left with no content after normalization is dropped.
 *
 * No intent or semantic vocabulary is introduced: every surviving token is
 * a label the capture pipeline already produced.
 */
export function canonicalizeSteps(steps: string[]): string[] {
  const normalized: string[] = [];
  for (const raw of steps) {
    if (!raw) continue;

    // 1. Ambient API-operation intents never affect identity.
    if (AMBIENT_API_INTENTS.has(raw)) continue;

    // 3. Whitespace/case normalization.
    let token = String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!token) continue;

    // 4. Absolute URLs → path (+query) shape.
    if (/^https?:\/\//i.test(token)) {
      try {
        const u = new URL(token);
        token = (u.pathname || '/') + (u.search || '');
      } catch {
        // Malformed URL literal — keep the trimmed text.
      }
    }

    // 2. Collapse exact consecutive duplicates.
    if (normalized.length > 0 && normalized[normalized.length - 1] === token) {
      continue;
    }
    normalized.push(token);
  }
  return normalized;
}

/**
 * Aggregate workflows into recorded (recurring) patterns.
 * Returns patterns that appeared 2+ times across sessions.
 *
 * Prior recorded workflows are merged by recomputing the pattern hash
 * from their canonicalSteps. If the hash matches a new workflow, they
 * are merged; otherwise the prior pattern is preserved as-is.
 *
 * D7: pattern identity is derived from canonicalizeSteps(stepIntents),
 * so heartbeat/polling noise and literal label differences no longer
 * split one user workflow into distinct patternIds.
 */
export function aggregateRecordedWorkflows(
  workflows: SemanticWorkflow[],
  priorRecorded: RecordedWorkflow[] = [],
): RecordedWorkflow[] {
  const patternMap = new Map<string, RecordedWorkflow>();

  // Seed with prior patterns — recompute hash from canonicalized steps
  for (const prior of priorRecorded) {
    const patternId = hashPattern(prior.canonicalSteps);
    const existing = patternMap.get(patternId);
    if (existing) {
      // D7: two legacy priors collapse onto the same canonical pattern —
      // merge rather than silently drop (occurrence counts are preserved).
      existing.sessionIds = [...new Set([...existing.sessionIds, ...prior.sessionIds])];
      existing.instances = mergeInstances(existing.instances, prior.instances);
      existing.occurrenceCount += prior.occurrenceCount;
    } else {
      patternMap.set(patternId, {
        ...prior,
        patternId,
        // D7: store canonical identity steps (legacy rows re-canonicalize
        // here so re-persisted patterns converge on the canonical form).
        canonicalSteps: canonicalizeSteps(prior.canonicalSteps),
        instances: [...prior.instances],
        sessionIds: [...prior.sessionIds],
      });
    }
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
        // D7: persist the canonical identity sequence; raw session steps
        // stay untouched on the SemanticWorkflow itself (stepIntents).
        canonicalSteps: canonicalizeSteps(wf.stepIntents),
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

/** Bound the merged instance list (keeps the most recent entries). */
function mergeInstances(a: string[], b: string[]): string[] {
  const MAX = 50;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...a, ...b]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out.slice(-MAX);
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
 * Compute a stable hash for a step sequence (D7: canonicalized).
 * Uses a simple string hash (djb2) — deterministic across runs.
 */
export function hashPattern(steps: string[]): string {
  const canonical = canonicalizeSteps(steps).join('→');
  let hash = 5381;
  for (let i = 0; i < canonical.length; i++) {
    hash = ((hash << 5) + hash) + canonical.charCodeAt(i);
    hash = hash & 0xffffffff; // keep 32-bit
  }
  return `wf-pattern-${(hash >>> 0).toString(16)}`;
}
