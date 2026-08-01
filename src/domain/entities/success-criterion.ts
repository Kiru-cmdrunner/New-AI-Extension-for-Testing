/**
 * Success Criterion — formal pass/fail criteria for capability execution.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §3.1
 *
 * Derived from BehavioralContract.successIndicators in the
 * ApplicationKnowledgeFragment. Tells P2/P3 what to verify after
 * executing a capability.
 */

/**
 * The type of success check to perform.
 */
export type SuccessType =
  | 'navigation'     // URL matches pattern
  | 'elementVisible' // element is visible on page
  | 'elementAbsent'  // element is not on page (e.g., error message gone)
  | 'valueEquals'    // element has expected value
  | 'textPresent'    // page or element contains text
  | 'custom';        // free-form description for complex criteria

/**
 * The target of the success check.
 */
export interface SuccessTarget {
  readonly kind: 'url' | 'element' | 'page';
  /** For url kind: glob pattern to match. */
  readonly urlPattern: string | null;
  /** For element kind: CSS selector or accessible name. */
  readonly elementLocator: string | null;
}

/**
 * A formal pass/fail criterion for capability execution.
 *
 * Inferred from BehavioralContract.successIndicators during P1 mapping.
 * Editable by the reviewer.
 */
export interface SuccessCriterion {
  /** Unique identifier within the capability. */
  readonly id: string;
  /** Human-readable description of what success looks like. */
  readonly description: string;
  /** The type of check to perform. */
  readonly type: SuccessType;
  /** What to check. */
  readonly target: SuccessTarget;
  /** Expected value for valueEquals/textPresent types. */
  readonly expectedValue: string | null;
  /** Maximum time for criterion to be met (ms). */
  readonly timeout: number;
  /** Whether this was auto-derived or manually added. */
  readonly source: 'inferred' | 'manual';
}
