/**
 * Evidence Engine — Core Types
 *
 * The evidence model: multiple independent providers observe the event stream
 * and contribute evidence (observations with confidence). The interaction engine
 * combines all evidence to determine the final interaction type.
 *
 * This file is the shared vocabulary for the entire evidence subsystem.
 */

import type { InteractionType, InteractionMetadata } from '../interaction-types.ts';
import type { RecordedEvent } from '../../recorder/recorded-event.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Evidence — a single observation from a single provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One observation from one evidence provider.
 *
 * @param provider     - Name of the provider that produced this evidence
 * @param suggestedType - What interaction type this evidence supports, or null if
 *                        the provider has no type opinion (e.g., "I see a combobox
 *                        but I'm not saying what interaction happened")
 * @param confidence   - How sure the provider is that THIS observation is correct
 *                        (0.0–1.0). "I see role=combobox" → 0.95
 * @param weight       - How authoritative this provider's opinion is for this kind
 *                        of signal (0.0–1.0). ARIA roles are highly authoritative
 *                        for component type but weak for interaction completion.
 * @param metadata     - Partial metadata this evidence contributes (value, checked, etc.)
 * @param reason       - Human-readable explanation for debugging
 */
export interface Evidence {
  provider: string;
  suggestedType: InteractionType | null;
  confidence: number;
  weight: number;
  metadata?: Partial<InteractionMetadata>;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence Provider — an independent signal source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An evidence provider observes the event stream and contributes evidence.
 *
 * Each provider is independent — it doesn't know about other providers and
 * doesn't make the final classification decision. It only reports what it sees.
 *
 * Lifecycle:
 *   onEvent()   — called for every raw event (real-time, in order)
 *   onCommit()  — called once when the engine decides to commit a buffer
 *                  (providers can do final analysis with full event history)
 */
export interface EvidenceProvider {
  /** Unique provider name for debugging and evidence trails */
  name: string;

  /**
   * Called for every raw event as it arrives.
   * Returns evidence that this event triggered, or empty array.
   *
   * @param event   - The raw event
   * @param buffer  - The current interaction buffer (all events so far on this element)
   * @returns Evidence array (may be empty)
   */
  onEvent(event: RecordedEvent, buffer: InteractionBuffer): Evidence[];

  /**
   * Called once when the engine commits a buffer.
   * This is the provider's last chance to contribute evidence with the
   * full event history available.
   *
   * @param buffer - The buffer being committed
   * @returns Final evidence to add before combination
   */
  onCommit?(buffer: InteractionBuffer): Evidence[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction Buffer — per-element event accumulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A buffer accumulates events on a single element until a commit signal fires.
 *
 * The engine maintains at most one active buffer at a time (the element the
 * user is currently interacting with). When the user moves to a different
 * element, or a navigation occurs, or a standalone event arrives, the buffer
 * is committed.
 */
export interface InteractionBuffer {
  /** Element identity key (tag|stableId|cssSelector) */
  elementKey: string;

  /** All raw events accumulated for this element, in order */
  events: RecordedEvent[];

  /** All evidence accumulated from all providers */
  evidence: Evidence[];

  /** Timestamp of the first event in the buffer */
  startTime: string;

  /** Timestamp of the most recent event in the buffer */
  lastEventTime: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interaction Hypothesis — the engine's running assessment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A hypothesis is the engine's current belief about what interaction is happening.
 * It aggregates evidence by suggestedType and tracks the leading candidate.
 */
export interface InteractionHypothesis {
  /** The type with the highest weighted score */
  type: InteractionType;
  /** Combined confidence score (0.0–1.0) */
  score: number;
  /** All evidence grouped by type */
  evidenceByType: Map<InteractionType, Evidence[]>;
}

/**
 * The result of combining all evidence in a buffer.
 */
export interface CombinationResult {
  /** The winning interaction type */
  type: InteractionType;
  /** Final confidence score (0.0–1.0) */
  confidence: number;
  /** All evidence that contributed to this result */
  evidence: Evidence[];
  /** Per-type score breakdown for debugging */
  scores: Array<{ type: InteractionType; score: number; evidenceCount: number }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Element Identity Key — used to group events by element
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a stable identity key for an element from its ElementIdentity.
 * This mirrors the grouping key used in the existing classifier.
 *
 * Two events target the "same element" if their identity keys match.
 */
export function elementKeyFromTarget(target: {
  tag: string;
  stableId: string | null;
  cssSelector: string;
}): string {
  return `${target.tag}|${target.stableId ?? ''}|${target.cssSelector ?? ''}`;
}

/**
 * Compute the element identity key for a recorded event.
 */
export function elementKey(event: RecordedEvent): string {
  if (event.eventType === 'navigation') {
    return `navigation|${event.url}`;
  }
  return elementKeyFromTarget(event.target);
}
