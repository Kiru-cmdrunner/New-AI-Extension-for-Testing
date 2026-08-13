/**
 * M9.3 - Outcome Types
 *
 * Types for action/outcome relationships. An ActionOutcome correlates
 * a user interaction with the resulting application changes and
 * records the semantic determination + supporting evidence.
 *
 * Architecture: .drytis/specs/m9-3-outcome-determination.md
 */

import type { SignalSet } from '../types';
import type { StateTransition } from '../state-builder/types';
import type { InteractionType } from '../../shared/component-types';

// ── Outcome categories ──────────────────────────────────────────────────

/**
 * The determined outcome category for an interaction.
 */
export type OutcomeCategory = 'success' | 'failure' | 'ambiguous' | 'incomplete';

/**
 * Confidence level buckets for human-readable interpretation.
 */
export type ConfidenceLevel = 'inconclusive' | 'possible' | 'likely' | 'confirmed';

// ── Evidence ────────────────────────────────────────────────────────────

/**
 * A single piece of evidence that contributed to the outcome determination.
 */
export interface OutcomeEvidence {
  /** What kind of evidence this is. */
  kind:
    | 'api-operation'
    | 'notification'
    | 'counter-change'
    | 'view-change'
    | 'list-change'
    | 'no-evidence';
  /** The result this evidence suggests. */
  result: 'success' | 'failure' | 'unknown';
  /** Weight contribution (0-1). */
  weight: number;
  /** Human-readable detail. */
  detail: string;
  /** Interaction ID this evidence came from. */
  interactionId: string;
}

// ── Vote ────────────────────────────────────────────────────────────────

/**
 * Internal weighted vote used by the determiner.
 */
export interface OutcomeVote {
  result: 'success' | 'failure';
  weight: number;
  evidence: OutcomeEvidence;
}

// ── Action Outcome ──────────────────────────────────────────────────────

/**
 * The determined outcome for one user interaction.
 */
export interface ActionOutcome {
  /** The interaction this outcome is for. */
  interactionId: string;
  /** What the user did. */
  actionType: InteractionType;
  /** Accessible name / label of the target element. */
  actionTarget: string;
  /** The determined outcome. */
  outcome: OutcomeCategory;
  /** Confidence score 0-1. */
  confidence: number;
  /** Human-readable confidence level. */
  confidenceLevel: ConfidenceLevel;
  /** All evidence that contributed to this determination. */
  supportingEvidence: OutcomeEvidence[];
  /** Entity IDs created or updated as a result of this action. */
  resultingEntities: string[];
  /** Human-readable list of state changes caused by this action. */
  stateChanges: string[];
}

// ── Determiner Input ────────────────────────────────────────────────────

/**
 * Input for the outcome determiner.
 */
export interface OutcomeDeterminerInput {
  /** The interaction ID. */
  interactionId: string;
  /** Interaction type (Click, TextEntry, etc). */
  actionType: InteractionType;
  /** Accessible name or label of the target element. */
  actionTarget: string;
  /** Signals extracted for this interaction. */
  signals: SignalSet;
  /** State transition (before -> after) for this interaction. Null if no state builder. */
  transition: StateTransition | null;
}

// ── Confidence helpers ──────────────────────────────────────────────────

/**
 * Map a confidence score to a human-readable level.
 */
export function confidenceToLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 0.85) return 'confirmed';
  if (confidence >= 0.7) return 'likely';
  if (confidence >= 0.5) return 'possible';
  return 'inconclusive';
}

/**
 * Views that indicate a successful confirmation flow.
 */
export const CONFIRMATION_VIEWS = new Set([
  'cart-confirmation',
  'order-confirmation',
  'checkout-confirmation',
  'payment-confirmation',
  'registration-confirmation',
  'login-success',
]);
