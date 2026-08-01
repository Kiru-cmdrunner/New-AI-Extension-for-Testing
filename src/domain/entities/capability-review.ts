/**
 * Capability Review — the review workflow entity.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §3.1
 *
 * Created when a recording session is persisted (instead of auto-creating
 * or auto-merging a capability). The reviewer sees the candidate + match
 * suggestion and decides: approve, reject, edit, or override the match.
 *
 * Lifecycle: pending → approved | rejected
 */

/** The state of a capability review. */
export type CapabilityReviewState = 'pending' | 'approved' | 'rejected';

/**
 * Summary of the matching service's suggestion.
 * Produced by matchCapability() but acted upon only after review.
 */
export interface MatchSuggestionSummary {
  /** What the matching service suggested. */
  readonly decision: 'auto-merge' | 'ambiguous' | 'new-capability';
  /** ID of the best-matching existing capability (if any). */
  readonly bestMatchId: string | null;
  /** Name of the best-matching existing capability (if any). */
  readonly bestMatchName: string | null;
  /** Match score (0-1) of the best match. */
  readonly bestMatchScore: number | null;
}

/**
 * The reviewer's edits to the derived candidate data.
 * All fields are null/empty if the reviewer made no edits.
 */
export interface CapabilityReviewEdits {
  readonly nameChanged: boolean;
  readonly purposeChanged: boolean;
  readonly inputsEdited: boolean;
  readonly successCriteriaEdited: boolean;
  readonly editedName: string | null;
  readonly editedPurpose: string | null;
  /** If inputsEdited, the reviewer's full set of data requirements. */
  readonly editedDataRequirements: readonly import('./data-requirement').DataRequirement[] | null;
  /** If successCriteriaEdited, the reviewer's full set of success criteria. */
  readonly editedSuccessCriteria: readonly import('./success-criterion').SuccessCriterion[] | null;
}

/**
 * A capability review — the review entity created after recording.
 *
 * Created by the SessionPersistenceService when a session is persisted.
 * The reviewer interacts with it through the side panel review UI.
 */
export interface CapabilityReview {
  /** Unique review identifier. */
  readonly reviewId: string;
  /** The candidate capability ID being reviewed. */
  readonly capabilityCandidateId: string;
  /** The recording session that produced this candidate. */
  readonly sessionId: string;
  /** The matching service's suggestion. */
  readonly matchSuggestion: MatchSuggestionSummary;
  /** Current review state. */
  readonly state: CapabilityReviewState;
  /** When the review was acted upon (null if pending). */
  readonly reviewedAt: string | null;
  /** Who acted on the review (null if pending). */
  readonly reviewedBy: string | null;
  /** Optional reviewer note. */
  readonly reviewNote: string | null;
  /** The reviewer's edits (empty if no edits were made). */
  readonly edits: CapabilityReviewEdits;
  /** ID of the capability created/enriched after approval (null if not yet approved). */
  readonly resultCapabilityId: string | null;
  /** ID of the version created after approval (null if not yet approved). */
  readonly resultVersionId: string | null;
}
