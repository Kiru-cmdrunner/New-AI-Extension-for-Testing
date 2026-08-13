/**
 * M9 — Application Understanding: Type Definitions
 *
 * Defines the semantic signal types produced by the signal extraction pipeline.
 * Signals are deterministic derivations from M1–M8 BehavioralEvidence — no
 * inference, no LLM, no probability beyond explicit confidence weights.
 *
 * Architecture: .drytis/specs/m9-design.md §4–§5
 */

import type { ComponentInteraction } from '../shared/component-types';

// ── Signal Base ────────────────────────────────────────────────────────

/**
 * Base shape for all signals. Every signal is derived from one interaction's
 * behavioral evidence and carries provenance back to that interaction.
 */
export interface Signal {
  /** Signal type discriminator. */
  type: string;
  /** Interaction ID this signal was extracted from. */
  interactionId: string;
  /** How this signal was derived. */
  source: SignalSource;
  /** Confidence weight 0–1. Deterministic — not a probability. */
  /** Represents how reliably this signal type maps to its semantic claim. */
  confidence: number;
}

/**
 * How a signal was derived from evidence.
 */
export type SignalSource =
  | 'navigation-url'      // Derived from NavigationEvidence URL pattern
  | 'network-url'         // Derived from NetworkActivity URL pattern
  | 'network-status'      // Derived from NetworkActivity HTTP status code
  | 'dom-mutation'        // Derived from DomChangeSummary
  | 'surface'             // Derived from SurfaceChange
  | 'target-state'        // Derived from TargetEvidence before/after
  | 'visibility'          // Derived from VisibilityChange
  | 'page-content';       // Derived from PageContentSnapshot (M9.4 — future)

// ── View / Page Concepts ───────────────────────────────────────────────

/**
 * A recognized application view (page/screen).
 */
export interface ViewDescriptor {
  /** Stable identifier (e.g., 'product-detail', 'search-results'). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** How the view was identified. */
  detectedFrom: 'url-pattern' | 'dom-signature';
  /** Confidence 0–1. */
  confidence: number;
}

/**
 * A URL pattern that maps to a view. Patterns are regex strings tested
 * against the full URL (including query string).
 */
export interface ViewPattern {
  /** View ID this pattern matches. */
  viewId: string;
  /** Human-readable label for this view. */
  viewLabel: string;
  /** Regex pattern (string form) tested against the full URL. */
  pattern: string;
  /** Confidence weight when this pattern matches (0–1). */
  confidence: number;
}

// ── Concrete Signal Types ──────────────────────────────────────────────

/**
 * Signal: the user navigated to a different application view.
 * Produced by NavigationSignalExtractor from NavigationEvidence URLs.
 */
export interface ViewChangeSignal extends Signal {
  type: 'view-change';
  source: 'navigation-url';
  /** The view the user navigated TO. */
  toView: ViewDescriptor;
  /** The view the user navigated FROM (if identifiable). */
  fromView: ViewDescriptor | null;
  /** Raw URL navigated to. */
  toUrl: string;
  /** Raw URL navigated from. */
  fromUrl: string;
  /** Navigation type from evidence. */
  navigationType: 'pushState' | 'replaceState' | 'hashchange' | 'popstate' | 'full-reload';
}

/**
 * Classification of an API operation observed in network activity.
 */
export type ApiOperationType =
  | 'search'
  | 'search-autocomplete'
  | 'add-to-cart'
  | 'remove-from-cart'
  | 'update-cart'
  | 'checkout'
  | 'login'
  | 'logout'
  | 'register'
  | 'submit-form'
  | 'analytics'
  | 'resource'
  | 'unknown';

/**
 * Signal: a network request represents a semantic API operation.
 * Produced by NetworkSignalExtractor from NetworkActivity URLs.
 */
export interface ApiOperationSignal extends Signal {
  type: 'api-operation';
  source: 'network-url' | 'network-status';
  /** Classified operation type. */
  operation: ApiOperationType;
  /** HTTP method. */
  method: string;
  /** HTTP status code (null if not yet completed). */
  status: number | null;
  /** Whether the request completed successfully (2xx). */
  succeeded: boolean | null;
  /** Raw request URL. */
  url: string;
  /** Outcome hint derived from status code. */
  outcomeHint: OutcomeHint | null;
}

/**
 * Outcome hint extracted from a signal. Used by the outcome determiner
 * (M9.3) as a weighted vote.
 */
export interface OutcomeHint {
  result: 'success' | 'failure' | 'unknown';
  /** Weight contribution to outcome determination (0–1). */
  weight: number;
  /** Human-readable detail. */
  detail: string;
}

// ── Signal Set (per interaction) ───────────────────────────────────────

/**
 * All signals extracted from a single interaction's behavioral evidence.
 */
export interface SignalSet {
  /** Interaction ID these signals belong to. */
  interactionId: string;
  /** View change signals (0 or 1 per interaction typically). */
  viewChanges: ViewChangeSignal[];
  /** API operation signals (0+ per interaction). */
  apiOperations: ApiOperationSignal[];
  // Future M9.2+ signal types will be added here:
  //   notifications: NotificationSignal[];
  //   counterChanges: CounterChangeSignal[];
  //   listChanges: ListChangeSignal[];
  //   inputChanges: InputValueChangeSignal[];
}

/**
 * Result of running the full signal extraction pipeline over a set of interactions.
 */
export interface SignalExtractionResult {
  /** Signals per interaction, keyed by interactionId. */
  signals: Map<string, SignalSet>;
  /** Number of interactions processed. */
  interactionCount: number;
  /** Number of interactions skipped (no behavioral evidence). */
  skippedCount: number;
}

// ── Signal Extractor Interface ─────────────────────────────────────────

/**
 * Interface for signal extractors. Each extractor reads one aspect of
 * behavioral evidence and produces zero or more signals.
 *
 * Extractors are pure functions — they do not mutate the interaction or
 * maintain state between calls.
 */
export interface SignalExtractor {
  /** Extractor name (for debugging/logging). */
  readonly name: string;
  /**
   * Extract signals from an interaction's behavioral evidence.
   * Returns an empty array if the interaction has no evidence or the
   * extractor finds nothing relevant.
   */
  extract(interaction: ComponentInteraction): Signal[];
}
