/**
 * Evidence Classifier — Core Types
 *
 * The intent-based evidence model: independent generators observe the
 * normalized feature view and vote for semantic intents. The intent
 * inference function fuses all votes into a single classification.
 *
 * Architecture:
 *   FeatureView → IntentVote[] → IntentClassification → InteractionType
 *
 * To extend: add a new EvidenceGenerator to the registry in generators.ts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Semantic Intent — the six fundamental things a user can intend to do
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

// ─────────────────────────────────────────────────────────────────────────────
// IntentVote — one signal source voting for one intent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single piece of evidence: one signal source voting for one intent.
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

// ─────────────────────────────────────────────────────────────────────────────
// IntentClassification — the result of fusing all votes
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// EvidenceGenerator — the extension point
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// FeatureViewInput — the normalized input generators receive
// ─────────────────────────────────────────────────────────────────────────────

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
