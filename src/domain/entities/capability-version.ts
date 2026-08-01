/**
 * Capability Version — an immutable snapshot of an approved capability.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §3.1
 *
 * Each version is created when a capability is approved or edited.
 * Versions are immutable — once created, they never change.
 * P2/P3 reference specific versionIds for reproducibility.
 *
 * Provenance: each version carries sourceSessionId linking it to the
 * recording that justified its approval. This enables version diffing,
 * audit trails, and re-derivation from source data.
 */

import type { DataRequirement } from './data-requirement';
import type { SuccessCriterion } from './success-criterion';

/** A decision made during the review process. */
export type ReviewDecision = 'approved' | 'rejected' | 'superseded';

/**
 * The immutable snapshot of capability data at a specific version.
 */
export interface CapabilitySnapshot {
  readonly name: string;
  readonly purpose: string;
  readonly dataRequirements: DataRequirement[];
  readonly successCriteria: SuccessCriterion[];
  /** Validation rules carried from the candidate. */
  readonly validationRules: readonly { field: string; type: string; description: string; constraint: string }[];
  /** Observed outcomes carried from the candidate. */
  readonly observedOutcomes: readonly { outcomeId: string; description: string; terminalUrl: string | null }[];
}

/**
 * An immutable version snapshot of an approved capability.
 *
 * Created when a CapabilityReview is approved. Never modified after creation.
 */
export interface CapabilityVersion {
  /** Unique version identifier: `{capabilityId}-v{number}`. */
  readonly versionId: string;
  /** The capability this version belongs to. */
  readonly capabilityId: string;
  /** Sequential version number (1, 2, 3, ...). */
  readonly versionNumber: number;
  /** When this version was created (ISO timestamp). */
  readonly createdAt: string;
  /** Who approved this version (user identity or 'system'). */
  readonly createdBy: string;
  /** The review decision that produced this version. */
  readonly reviewDecision: ReviewDecision;
  /** Optional review note from the reviewer. */
  readonly reviewNote: string | null;
  /**
   * Provenance — the recording session that justified this version.
   * Links to RecordingSession in Dexie for full traceability.
   */
  readonly sourceSessionId: string;
  /** The capability data snapshot at this version. */
  readonly snapshot: CapabilitySnapshot;
}
