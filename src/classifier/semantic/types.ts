/**
 * Semantic Reasoning Types — Stage 5
 *
 * Component-aware interaction session types for semantic reasoning.
 *
 * The SemanticReasoner transforms a stream of DetectedInteractions into
 * a refined sequence where composite UI components (dropdowns, date pickers,
 * autocomplete, navigation) are collapsed into single semantic interactions.
 *
 * Core concept: ComponentSession — a lifecycle-tracked interaction with a
 * composite UI component. While a session is active, internal events are
 * absorbed. When the session completes, one semantic interaction is emitted
 * carrying the full result (selected value, configured fields, etc.).
 */

import type { DetectedInteraction } from '../interaction-types';

// ── Component Session Types ──────────────────────────────────────────────

/**
 * The type of composite UI component a session tracks.
 *
 * Navigation is NOT a session type — it's handled by a retroactive
 * lookback merge (when a PageNavigation arrives, the reasoner checks
 * if the last click is mergeable).
 *
 * multiConfig: multi-field panels (AdaniOne flight options, filter panels)
 *   where the user adjusts several controls then clicks Done/Apply.
 *
 * formSubmit: a form submission workflow (login, registration) where
 *   form fields are enriched with submit context.
 */
export type ComponentType =
  | 'dropdown'
  | 'datePicker'
  | 'autocomplete'
  | 'multiConfig'
  | 'formSubmit';

/**
 * The lifecycle phase of a component session.
 *
 *   PENDING → COMPLETED (terminal, emits semantic interaction)
 *          ↘ CANCELLED  (terminal, trigger passes through)
 */
export type SessionPhase = 'pending' | 'completed' | 'cancelled';

/**
 * A component interaction session — tracks a user's interaction with a
 * composite UI component from activation through completion.
 *
 * While the session is PENDING, subsequent interactions are checked against
 * the session's completion/cancellation/absorption rules. When the session
 * reaches a terminal phase, a single SemanticInteraction is emitted (or the
 * trigger is passed through on cancel).
 */
export interface ComponentSession {
  /** Unique session ID. */
  id: string;
  /** The component type. */
  componentType: ComponentType;
  /** Current lifecycle phase. */
  phase: SessionPhase;
  /** The interaction that activated this session (trigger click, etc.). */
  triggerInteraction: DetectedInteraction;
  /** Interactions absorbed during the session (scrolls, internal clicks). */
  absorbed: DetectedInteraction[];
  /** The interaction that completed the session, if any. */
  completionInteraction: DetectedInteraction | null;
  /** Timestamp (ms) when the session was activated. */
  startedAt: number;
  /** Timestamp (ms) of the last event seen by this session. */
  lastEventAt: number;
  /** Maximum duration before the session times out (ms). */
  maxDurationMs: number;
  /** The extracted result value (selected option, date, etc.). */
  resultValue: string | null;
  /** Additional metadata from the completion interaction. */
  resultMetadata: Record<string, unknown>;
  /**
   * For multiConfig sessions: accumulated field-value pairs from
   * interactions inside the panel.
   */
  configuredFields: Record<string, string>;
  /**
   * For multiConfig sessions: the panel label (from trigger accessibleName).
   */
  panelLabel: string | null;
  /**
   * For formSubmit sessions: the list of TextEntry interaction IDs that
   * were part of this form, for enrichment.
   */
  formFieldIds: string[];
}

// ── Semantic Reasoning Result ────────────────────────────────────────────

/**
 * Result of semantic reasoning over an interaction stream.
 */
export interface SemanticReasoningResult {
  /** Refined interactions — semantically correct DetectedInteraction[]. */
  interactions: DetectedInteraction[];
  /** Number of sessions activated. */
  sessionsActivated: number;
  /** Number of sessions completed (emitted semantic interactions). */
  sessionsCompleted: number;
  /** Number of sessions cancelled (trigger passed through). */
  sessionsCancelled: number;
  /** Number of interactions absorbed into sessions. */
  interactionsAbsorbed: number;
  /** Number of interactions passed through unchanged. */
  interactionsPassedThrough: number;
}
