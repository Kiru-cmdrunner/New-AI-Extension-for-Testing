/**
 * Workflow Normalizer — Semantic Refinement Layer
 *
 * Removes Unclassified interactions whose semantic content is fully subsumed
 * by a recognized interaction on the same element within a temporal gesture
 * window.
 *
 * The first application: eliminating Unclassified(mousedown) noise that
 * appears alongside every recognized Click/Link/Checkbox interaction on the
 * same element.
 *
 * Contract:
 *   Each interaction in the output represents exactly one distinct user
 *   intention. Interactions whose semantic content is fully subsumed by
 *   another interaction on the same element within the same gesture window
 *   are removed.
 *
 * This is a VIEW FILTER. Subsumed interactions remain in liveInteractions
 * and the Evidence Ledger. The M4 Verification Mode compares raw output
 * BEFORE normalization. No evidence is deleted.
 *
 * Architecture: `.drytis/specs/workflow-normalizer.md`
 */

import type { ComponentInteraction } from '../shared/component-types';
import { elementKey } from '../definitions/patterns';

/**
 * Maximum time (ms) between an Unclassified interaction and the recognized
 * interaction that subsumes it. Browser fires click within ~80ms of mousedown
 * for a normal gesture. 500ms provides a 6x safety margin for slow rendering,
 * event dispatch delays, or SW processing latency.
 */
export const GESTURE_WINDOW_MS = 500;

/**
 * Remove Unclassified interactions that are fully subsumed by a recognized
 * interaction on the same element within a temporal gesture window.
 *
 * Subsumption conditions (ALL must hold):
 * 1. Candidate is Unclassified
 * 2. Temporal precedence: 0 ≤ (recognized.startTime - unclassified.startTime) ≤ GESTURE_WINDOW_MS
 * 3. Target affinity: same elementKey
 * 4. Subsumer is recognized (type !== 'Unclassified')
 *
 * @param interactions - Complete interaction list from stopRecording / projection
 * @returns Refined list where each interaction represents one distinct user intention
 */
export function normalizeWorkflow(
  interactions: ComponentInteraction[],
): ComponentInteraction[] {
  if (interactions.length === 0) return [];

  // Build an index of recognized interactions by elementKey.
  // Map<elementKey, Array of recognized interactions>
  const recognizedByKey = new Map<string, ComponentInteraction[]>();

  for (const interaction of interactions) {
    if (interaction.type === 'Unclassified') continue;
    const key = elementKey(interaction.trigger);
    const list = recognizedByKey.get(key);
    if (list) {
      list.push(interaction);
    } else {
      recognizedByKey.set(key, [interaction]);
    }
  }

  // For each Unclassified interaction, check if it's subsumed.
  const subsumedIds = new Set<string>();

  for (const candidate of interactions) {
    if (candidate.type !== 'Unclassified') continue;

    const key = elementKey(candidate.trigger);
    const candidates = recognizedByKey.get(key);
    if (!candidates) continue; // No recognized interaction on this element

    // Check temporal proximity — find the nearest recognized interaction
    for (const recognized of candidates) {
      const delta = recognized.startTime - candidate.startTime;

      // Unclassified must precede or be simultaneous with the recognized
      // interaction, within the gesture window.
      if (delta >= 0 && delta <= GESTURE_WINDOW_MS) {
        subsumedIds.add(candidate.interactionId);
        break; // Subsumed by the first qualifying match
      }
    }
  }

  // If nothing was subsumed, return the original array (avoid unnecessary copy)
  if (subsumedIds.size === 0) return interactions;

  return interactions.filter(
    (i) => !subsumedIds.has(i.interactionId),
  );
}
