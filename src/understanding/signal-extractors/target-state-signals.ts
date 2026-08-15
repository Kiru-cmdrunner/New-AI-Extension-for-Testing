/**
 * Target State Signal Extractor — extracts input-value-change and
 * control-state-change signals from TargetEvidence before/after diffs.
 *
 * The TargetEvidence captures a 14-property diff for the interacted element
 * only. This extractor diffs:
 *   - `value` (input/textarea text) → InputValueChangeSignal
 *   - `checked`, `ariaExpanded`, `ariaChecked`, `ariaPressed`,
 *     `selectedValues`, `controlledValue` (DDC-6) → ControlStateChangeSignal
 *
 * Scroll position (scrollTop/scrollLeft) is intentionally NOT diffed —
 * deferred as low-signal for application understanding.
 *
 * M9.2 + DDC-6
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type {
  SignalExtractor,
  Signal,
  InputValueChangeSignal,
  ControlStateChangeSignal,
} from '../types';

export class TargetStateSignalExtractor implements SignalExtractor {
  readonly name = 'TargetStateSignalExtractor';

  extract(interaction: ComponentInteraction): Signal[] {
    const evidence = interaction.behavioralEvidence;
    if (!evidence) return [];

    const target = evidence.targetEvidence;
    // G3-supplement safety (R12): network-only evidence supplements carry
    // targetEvidence: null (evidence-collector.ts scheduleLateNetworkReCollect).
    // The declared type is non-null, but runtime producers violate it — a
    // throw here discards the WHOLE Stage-1 batch (coordinator has no
    // per-extractor isolation), losing api-operation signals for every other
    // interaction. Guard the null instead of dereferencing it.
    if (!target || !target.before || !target.after) return [];

    const signals: (InputValueChangeSignal | ControlStateChangeSignal)[] = [];

    const field = target.identity?.cssSelector ?? target.identity?.elementId ?? 'unknown-field';
    const label = target.identity
      ? target.identity.accessibleName ?? target.identity.tag ?? null
      : null;

    // Value change (input/textarea)
    const beforeValue = target.before.value;
    const afterValue = target.after.value;
    if (beforeValue !== afterValue) {
      signals.push({
        type: 'input-value-change',
        interactionId: interaction.interactionId,
        source: 'target-state',
        confidence: 0.95,
        field,
        oldValue: beforeValue,
        newValue: afterValue,
        elementLabel: label,
      });
    }

    // ── DDC-6: control-state properties ──
    // All captured in TargetStateSnapshot since M6 but never diffed.
    const b = target.before;
    const a = target.after;

    // checked (checkbox/radio)
    if (b.checked !== null || a.checked !== null) {
      if (b.checked !== a.checked) {
        signals.push({
          type: 'control-state-change',
          interactionId: interaction.interactionId,
          source: 'target-state',
          confidence: 0.95,
          property: 'checked',
          field,
          oldValue: b.checked === null ? null : String(b.checked),
          newValue: a.checked === null ? null : String(a.checked),
          elementLabel: label,
        });
      }
    }

    // aria-expanded (accordions, menus, comboboxes)
    if (b.ariaExpanded !== null || a.ariaExpanded !== null) {
      if (b.ariaExpanded !== a.ariaExpanded) {
        signals.push({
          type: 'control-state-change',
          interactionId: interaction.interactionId,
          source: 'target-state',
          confidence: 0.9,
          property: 'expanded',
          field,
          oldValue: b.ariaExpanded === null ? null : String(b.ariaExpanded),
          newValue: a.ariaExpanded === null ? null : String(a.ariaExpanded),
          elementLabel: label,
        });
      }
    }

    // aria-checked (custom tri-state checkboxes)
    if (b.ariaChecked !== null || a.ariaChecked !== null) {
      if (b.ariaChecked !== a.ariaChecked) {
        signals.push({
          type: 'control-state-change',
          interactionId: interaction.interactionId,
          source: 'target-state',
          confidence: 0.9,
          property: 'checked-aria',
          field,
          oldValue: b.ariaChecked === null ? null : String(b.ariaChecked),
          newValue: a.ariaChecked === null ? null : String(a.ariaChecked),
          elementLabel: label,
        });
      }
    }
    // aria-pressed (toggle buttons)
    if (b.ariaPressed !== null || a.ariaPressed !== null) {
      if (b.ariaPressed !== a.ariaPressed) {
        signals.push({
          type: 'control-state-change',
          interactionId: interaction.interactionId,
          source: 'target-state',
          confidence: 0.9,
          property: 'pressed',
          field,
          oldValue: b.ariaPressed === null ? null : String(b.ariaPressed),
          newValue: a.ariaPressed === null ? null : String(a.ariaPressed),
          elementLabel: label,
        });
      }
    }

    // selectedValues (multi-select)
    if (b.selectedValues !== null || a.selectedValues !== null) {
      const beforeSel = b.selectedValues === null ? null : [...b.selectedValues].sort().join('|');
      const afterSel = a.selectedValues === null ? null : [...a.selectedValues].sort().join('|');
      if (beforeSel !== afterSel) {
        signals.push({
          type: 'control-state-change',
          interactionId: interaction.interactionId,
          source: 'target-state',
          confidence: 0.9,
          property: 'selection',
          field,
          oldValue: beforeSel,
          newValue: afterSel,
          elementLabel: label,
        });
      }
    }

    // controlledValue (date pickers, comboboxes with aria-controls)
    if (b.controlledValue !== null || a.controlledValue !== null) {
      if (b.controlledValue !== a.controlledValue) {
        signals.push({
          type: 'control-state-change',
          interactionId: interaction.interactionId,
          source: 'target-state',
          confidence: 0.85,
          property: 'controlled-value',
          field,
          oldValue: b.controlledValue,
          newValue: a.controlledValue,
          elementLabel: label,
        });
      }
    }

    return signals;
  }
}
