/**
 * Confidence Engine — 5-track weighted confidence model.
 *
 * Phase 3 Task 7 (G6).
 *
 * Implements the confidence calculation algorithm specified in Phase 2
 * Engineering Specifications §10.4, following AI Philosophy P5.
 *
 * 5 tracks with frozen weights:
 *   intent:   0.35  (user's likely goal)
 *   workflow: 0.25  (workflow progression)
 *   appFocus: 0.15  (application identity)
 *   uiFocus:  0.15  (current UI element focus)
 *   change:   0.10  (change analysis)
 *
 * P5 Bounds:
 *   Ceiling: 0.95 (never absolute certainty)
 *   Floor:   0.05 (never absolute zero)
 *
 * The engine is deterministic: AI provides raw evidence (confidenceScore,
 * intent classification), and the engine computes calibrated scores.
 */

import type { ConfidenceState } from '../../shared/architecture-types';

// ── Frozen Constants ───────────────────────────────────────

/**
 * Domain weights frozen by AI Philosophy P5.
 * Object.frozen for runtime safety.
 */
export const CONFIDENCE_WEIGHTS = Object.freeze({
  intent: 0.35,
  workflow: 0.25,
  appFocus: 0.15,
  uiFocus: 0.15,
  change: 0.10,
} as const);

/** P5 ceiling — confidence can never exceed this. */
export const CONFIDENCE_CEILING = 0.95;

/** P5 floor — confidence can never go below this. */
export const CONFIDENCE_FLOOR = 0.05;

/** Default starting confidence for all tracks. */
export const DEFAULT_CONFIDENCE = 0.30;

/**
 * Growth factor for supporting evidence (diminishing returns).
 * Higher = faster approach toward ceiling.
 */
const GROWTH_FACTOR = 0.30;

/**
 * Decline factor for contradicting evidence (sharper decline).
 * Higher = faster drop.
 */
const DECLINE_FACTOR = 0.50;

// ── Utilities ──────────────────────────────────────────────

/**
 * Clamp a number between floor and ceiling.
 * P5: confidence is always in [0.05, 0.95].
 */
export function clampConfidence(value: number): number {
  return Math.min(CONFIDENCE_CEILING, Math.max(CONFIDENCE_FLOOR, value));
}

/**
 * Create a default ConfidenceState with all tracks at the default level.
 */
export function createDefaultConfidence(): ConfidenceState {
  const c = DEFAULT_CONFIDENCE;
  return {
    intent: c,
    workflow: c,
    appFocus: c,
    uiFocus: c,
    change: c,
    composite: c,
  };
}

// ── Track Update Algorithm ─────────────────────────────────

/**
 * Update a single confidence track using the P5 algorithm.
 *
 * When evidence supports the current hypothesis:
 *   delta = evidenceStrength × (1 - current) × GROWTH_FACTOR
 *   (diminishing returns — harder to move near ceiling)
 *
 * When evidence contradicts:
 *   delta = -evidenceStrength × current × DECLINE_FACTOR
 *   (sharper decline — easier to lose confidence)
 *
 * @param current     - Current track value [0.05, 0.95].
 * @param evidenceStrength - How strong the evidence is [0, 1].
 * @param supports    - Whether the evidence supports or contradicts.
 * @returns Updated track value, clamped to [0.05, 0.95].
 */
export function updateTrack(
  current: number,
  evidenceStrength: number,
  supports: boolean,
): number {
  const strength = Math.min(1, Math.max(0, evidenceStrength));
  if (supports) {
    const delta = strength * (1 - current) * GROWTH_FACTOR;
    return clampConfidence(current + delta);
  }
  const delta = -strength * current * DECLINE_FACTOR;
  return clampConfidence(current + delta);
}

// ── Confidence Engine ──────────────────────────────────────

/**
 * Input for a single confidence update.
 */
export interface ConfidenceUpdateInput {
  /** Previous confidence state. */
  previous: ConfidenceState;
  /** AI confidence score for the current interaction [0, 1]. */
  aiConfidence: number;
  /** Whether the AI understanding supports the intent hypothesis. */
  evidenceSupportsIntent: boolean;
  /** How well the action fits the current workflow [0, 1]. */
  workflowFit: number;
  /** Whether the action fits the current workflow. */
  actionFitsWorkflow: boolean;
  /** Whether the element matches the identified application [0, 1]. */
  elementMatchesApp: number;
  /** Whether the element matches the identified UI focus [0, 1]. */
  elementMatchesUI: number;
  /** Whether the observed change matches expectations [0, 1]. */
  changeIsExpected: number;
  /** Whether the change matches the expected outcome. */
  changeMatchesExpected: boolean;
}

/**
 * Update the full confidence state with new evidence.
 *
 * Implements the Phase 2 §10.4 algorithm.
 *
 * @param input - Evidence from the current interaction.
 * @returns Updated ConfidenceState.
 */
export function updateConfidence(input: ConfidenceUpdateInput): ConfidenceState {
  const { previous } = input;

  // Update each track using the P5 updateTrack algorithm
  const intent = updateTrack(
    previous.intent,
    input.aiConfidence,
    input.evidenceSupportsIntent,
  );

  const workflow = updateTrack(
    previous.workflow,
    input.workflowFit,
    input.actionFitsWorkflow,
  );

  const appFocus = updateTrack(
    previous.appFocus,
    input.elementMatchesApp,
    input.elementMatchesApp > 0.5,
  );

  const uiFocus = updateTrack(
    previous.uiFocus,
    input.elementMatchesUI,
    input.elementMatchesUI > 0.5,
  );

  const change = updateTrack(
    previous.change,
    input.changeIsExpected,
    input.changeMatchesExpected,
  );

  // Composite: weighted sum
  const composite = clampConfidence(
    intent * CONFIDENCE_WEIGHTS.intent +
    workflow * CONFIDENCE_WEIGHTS.workflow +
    appFocus * CONFIDENCE_WEIGHTS.appFocus +
    uiFocus * CONFIDENCE_WEIGHTS.uiFocus +
    change * CONFIDENCE_WEIGHTS.change,
  );

  return { intent, workflow, appFocus, uiFocus, change, composite };
}

/**
 * Create a simplified confidence update from just an AI confidence score.
 *
 * This is the common case for per-interaction AI updates where we only
 * have the AI's confidence score and a general "supports" flag.
 *
 * @param previous       - Previous confidence state.
 * @param aiConfidence   - AI confidence [0, 1].
 * @param supports       - Whether the evidence supports current understanding.
 * @returns Updated confidence state (simplified — uses AI confidence for all tracks).
 */
export function quickUpdate(
  previous: ConfidenceState,
  aiConfidence: number,
  supports: boolean,
): ConfidenceState {
  return updateConfidence({
    previous,
    aiConfidence,
    evidenceSupportsIntent: supports,
    workflowFit: aiConfidence,
    actionFitsWorkflow: supports,
    elementMatchesApp: aiConfidence,
    elementMatchesUI: aiConfidence,
    changeIsExpected: aiConfidence,
    changeMatchesExpected: supports,
  });
}
