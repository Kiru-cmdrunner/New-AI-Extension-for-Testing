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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Intent-based evidence types
//
// These types extend the evidence subsystem with a semantic-intent layer.
// They are additive — the Phase 2+ provider-based types above are unchanged.
//
// Architecture:
//   FeatureView → IntentVote[] → IntentClassification → InteractionType
//
// To avoid name collisions with the provider-based Evidence type above,
// Phase 1 uses distinct names: IntentVote, EvidenceGenerator, etc.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The six fundamental things a user can intend to do with a web page.
 *
 * This is a closed, stable set — new UI patterns map to existing intents,
 * they don't require new intent values. Physical actions (click, type, drag)
 * describe HOW the user interacts; intents describe WHAT they're trying to
 * achieve.
 *
 * - toggle:   Change a binary state (on↔off)
 * - select:   Choose one option from a group
 * - input:    Provide a value
 * - navigate: Go to a different page or view
 * - trigger:  Fire an action with no persistent state change
 * - explore:  Discover content without committing (hover, expand)
 */
export type SemanticIntent =
  | 'toggle'
  | 'select'
  | 'input'
  | 'navigate'
  | 'trigger'
  | 'explore';

/**
 * A single piece of evidence: one signal source voting for one intent.
 *
 * This is distinct from the provider-based Evidence interface above.
 * IntentVote votes for a SEMANTIC INTENT, not a specific InteractionType.
 *
 * Weight range: -1.0 to +1.0.
 *   Positive = supports this intent.
 *   Negative = suppresses this intent (useful for contextual signals,
 *   e.g. "sidebar context suppresses navigate intent").
 *
 * Each IntentVote is independently testable. The `source` and `reason` fields
 * form a full audit trail — consumers can show WHY an interaction was
 * classified a certain way.
 */
export interface IntentVote {
  /** Which intent this evidence votes for or against. */
  intent: SemanticIntent;
  /** Strength of the vote: +1.0 (strong support) to -1.0 (strong suppression). */
  weight: number;
  /** Generator ID for debugging, e.g. 'aria-checked', 'checked-transition'. */
  source: string;
  /** Human-readable explanation for the audit trail. */
  reason: string;
}

/**
 * The result of fusing all intent votes for one interaction.
 *
 * The `confidence` is derived from the fused score (not a separate heuristic).
 * The `evidence` array is the complete audit trail showing every vote.
 */
export interface IntentClassification {
  /** The winning intent. */
  intent: SemanticIntent;
  /** Fused confidence: 0.0–1.0, derived from evidence scores. */
  confidence: number;
  /** Full audit trail: every evidence vote that was considered. */
  evidence: IntentVote[];
  /** The runner-up intent and its score, if there was meaningful competition. */
  runnerUp?: { intent: SemanticIntent; score: number };
}

/**
 * A function that reads the normalized feature view and produces intent votes.
 *
 * Each generator is:
 *   - Independent: doesn't read other generators' output
 *   - Stateless: pure function of the features
 *   - Single-responsibility: one signal source per generator
 *   - Independently testable: can be tested without the full pipeline
 *
 * To add a new signal source: create a new EvidenceGenerator, add it to
 * the EVIDENCE_GENERATORS registry in generators.ts. No existing code changes.
 */
export interface EvidenceGenerator {
  /** Unique ID for debugging and test identification. */
  id: string;
  /** Read features, produce zero or more intent votes. */
  generate(features: FeatureViewInput): IntentVote[];
}

/**
 * The input shape evidence generators receive.
 *
 * This is intentionally a subset of FeatureView — generators only need
 * read access to the computed helpers and the raw data references.
 * This interface is what makes generators testable in isolation.
 */
export interface FeatureViewInput {
  // Element semantics
  readonly tag: string;
  readonly ariaRole: string | null;
  readonly accessibleName: string | null;
  readonly classNameLower: string;

  // Computed behavioral helpers
  readonly hasAriaChecked: boolean;
  readonly hasAriaPressed: boolean;
  readonly hasCheckedTransition: boolean;
  readonly checkedBefore: boolean | null;
  readonly checkedAfter: boolean | null;

  // Structural signals
  readonly surfaceType: string | null;
  readonly ancestorRoles: string[];

  // Navigation signals
  readonly opensNewTab: boolean;
  readonly opensNewWindow: boolean;

  // Element type checks
  readonly isLink: boolean;
}
