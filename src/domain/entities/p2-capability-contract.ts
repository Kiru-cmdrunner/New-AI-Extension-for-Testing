/**
 * P2 Capability Contract — the read-only interface P2/P3 consume.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §3.3
 *
 * This is the minimal interface that P2 (capability-derived IR generation)
 * and P3 (AI test generation) read from approved capabilities.
 *
 * P2 uses dataRequirements (especially inputMethod) to generate
 * parameterized execution plans with the correct interaction strategy.
 * P3 uses dataRequirements + successCriteria to generate test variants
 * with different data and verify outcomes.
 */

import type { DataRequirement } from './data-requirement';
import type { SuccessCriterion } from './success-criterion';

/**
 * The read-only contract published when a capability is approved.
 *
 * P2/P3 always reference a specific versionId for reproducibility.
 */
export interface P2CapabilityContract {
  /** The capability ID. */
  readonly capabilityId: string;
  /** The version number of this contract. */
  readonly versionNumber: number;
  /** The immutable version ID (for P2/P3 to reference). */
  readonly versionId: string;
  /** Human-readable capability name. */
  readonly name: string;
  /** What the capability does. */
  readonly purpose: string;
  /** Formal data requirements with kind + inputMethod per field. */
  readonly dataRequirements: DataRequirement[];
  /** Formal pass/fail criteria. */
  readonly successCriteria: SuccessCriterion[];
  /** Starting point for executing this capability. */
  readonly entryPoint: {
    readonly url: string;
    readonly elementName: string | null;
  };
  /** Provenance — the recording session that justified this version. */
  readonly sourceSessionId: string;
  /** When this version was approved (ISO timestamp). */
  readonly approvedAt: string;
}
