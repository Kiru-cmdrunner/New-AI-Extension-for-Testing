/**
 * Target State Signal Extractor — extracts input-value-change signals from
 * TargetEvidence before/after value diffs.
 *
 * The TargetEvidence captures a 14-property diff for the interacted element
 * only. This extractor focuses on the `value` field (input/textarea text)
 * and `checked` field (checkbox/radio toggle) changes.
 *
 * M9.2
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { SignalExtractor, Signal, InputValueChangeSignal } from '../types';

export class TargetStateSignalExtractor implements SignalExtractor {
  readonly name = 'TargetStateSignalExtractor';

  extract(interaction: ComponentInteraction): Signal[] {
    const evidence = interaction.behavioralEvidence;
    if (!evidence) return [];

    const target = evidence.targetEvidence;
    if (!target.before || !target.after) return [];

    const signals: InputValueChangeSignal[] = [];

    // Value change (input/textarea)
    const beforeValue = target.before.value;
    const afterValue = target.after.value;
    if (beforeValue !== afterValue) {
      // Get element label from identity
      const label = target.identity
        ? target.identity.accessibleName ?? target.identity.tag ?? null
        : null;

      signals.push({
        type: 'input-value-change',
        interactionId: interaction.interactionId,
        source: 'target-state',
        confidence: 0.95,
        field: target.identity?.cssSelector ?? target.identity?.elementId ?? 'unknown-field',
        oldValue: beforeValue,
        newValue: afterValue,
        elementLabel: label,
      });
    }

    return signals;
  }
}
