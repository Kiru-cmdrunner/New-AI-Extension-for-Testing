/**
 * Stage 3b → Stage 4 Bridge: CanonicalStep to SemanticInteraction.
 *
 * Phase 3 Integration Step 2.
 *
 * Derives a SemanticInteraction from each CanonicalStep so the Execution JSON
 * Generator can look up the execution verb via the frozen verb-mapping-table.ts
 * instead of the inline mapActionType() if-chain.
 *
 * This module also provides normalizeToCanonical() — a mapping from any
 * actionType string (legacy or canonical) to the CanonicalType. This handles
 * backward compatibility for timelines that were recorded before Stage 3a
 * classification was integrated (Step 1).
 */

import type { CanonicalType } from '../../shared/architecture-types';
import type { SemanticInteraction } from '../../shared/architecture-types';
import type { CanonicalStep } from '../types';

// ── Legacy → Canonical Normalization ───────────────────────

/**
 * Mapping from legacy action types (raw event.type values) to canonical types.
 *
 * Types that are already canonical (click, select, hover) map to themselves.
 * Types that only exist in the legacy system (navigation, text, checkbox,
 * radio, dateSelect) are normalized to their canonical equivalents.
 */
const LEGACY_TO_CANONICAL: Readonly<Record<string, CanonicalType>> = Object.freeze({
  // Canonical types — identity mapping
  navigate: 'navigate',
  click: 'click',
  fill: 'fill',
  select: 'select',
  toggle: 'toggle',
  selectDate: 'selectDate',
  hover: 'hover',
  pressKey: 'pressKey',
  upload: 'upload',
  drag: 'drag',

  // Legacy types → canonical equivalents
  navigation: 'navigate',
  text: 'fill',
  checkbox: 'toggle',
  radio: 'select',
  dateSelect: 'selectDate',
});

/**
 * Normalize any actionType string to a CanonicalType.
 *
 * Handles both canonical types (from Stage 3a) and legacy types (raw event.type).
 * Unknown types default to 'click' (L5: click is always valid).
 *
 * @param actionType - The actionType from a CanonicalStep or SessionEvent.
 * @returns The corresponding CanonicalType.
 */
export function normalizeToCanonical(actionType: string): CanonicalType {
  return LEGACY_TO_CANONICAL[actionType] ?? 'click';
}

// ── CanonicalStep → SemanticInteraction ────────────────────

/**
 * Derive a SemanticInteraction from a CanonicalStep.
 *
 * Extracts the canonical type (normalizing if the step still carries a legacy
 * actionType) and the execution-relevant fields (value, checked).
 *
 * @param step - A CanonicalStep from Stage 3b.
 * @returns A SemanticInteraction for Stage 4 (Execution JSON Generator).
 */
export function stepToSemanticInteraction(step: CanonicalStep): SemanticInteraction {
  return {
    canonicalType: normalizeToCanonical(step.actionType),
    actionId: step.linkedInteractionId,
    stepId: step.stepId,
    value: step.value,
    checked: step.checked,
  };
}

/**
 * Derive SemanticInteractions from an array of CanonicalSteps.
 *
 * Convenience wrapper for batch processing.
 */
export function stepsToSemanticInteractions(
  steps: CanonicalStep[],
): SemanticInteraction[] {
  return steps.map(stepToSemanticInteraction);
}
