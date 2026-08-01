/**
 * Shared types for the validation harness.
 *
 * Used by all four expanded validation areas to record raw observations
 * in a uniform shape so they can be consolidated into a single report.
 *
 * Architecture: .drytis/EXPANDED_VALIDATION_DESIGN.md §8.4
 */

/** Quality dimensions Q1–Q8. */
export interface QualityScores {
  q1_intent: number;        // Intent accuracy: does the captured type reflect what the user intended?
  q2_abstraction: number;   // Abstraction fidelity: does the IR action generalize correctly?
  q3_locator: number;       // Locator quality: are the locators robust and readable?
  q4_description: number;   // Semantic descriptions: are human-readable labels meaningful?
  q5_replay: number;        // Replay reliability: would Playwright code regenerate and replay?
  q6_confidence: number;    // Confidence calibration: is the confidence score appropriate?
  q7_evidence: number;      // Evidence trail quality: is the semantic evidence trail rich?
  q8_assertion: number;     // Assertion value: are assertions meaningful and actionable?
}

/** Support level for a capability. */
export type SupportLevel = 'full' | 'partial' | 'unsupported';

/** Validation area identifier. */
export type ValidationArea = 'locator' | 'framework' | 'workflow' | 'compound';

/** Finding category. */
export type FindingCategory =
  | 'implementation-gap'
  | 'missing-definition'
  | 'locator-weakness'
  | 'framework-pattern-gap'
  | 'semantic-gap';

/** Severity (P0 = blocker, P3 = nit). */
export type Severity = 'P0' | 'P1' | 'P2' | 'P3';

/** Confidence in the observation. */
export type ObservationConfidence = 'VERIFIED' | 'SIMULATED' | 'INFERRED';

/**
 * A single raw observation from validation.
 * Every observation is preserved even when multiple share a root cause.
 */
export interface RawObservation {
  /** Unique ID within the area (e.g. "LQ-01", "FW-MUI-01"). */
  observationId: string;
  /** Which validation area produced this observation. */
  area: ValidationArea;
  /** The capability being tested (e.g. "native-select", "mui-dropdown"). */
  capabilityId: string;
  /** Framework if applicable (null for non-framework tests). */
  framework: string | null;
  /** Scores across 8 quality dimensions. */
  scores: QualityScores;
  /** Overall support level for this capability. */
  support: SupportLevel;
  /** What was actually observed (concrete, not "works fine"). */
  observed: string;
  /** Root cause if known. */
  rootCause: string;
  /** Finding category. */
  category: FindingCategory;
  /** Severity. */
  severity: Severity;
  /** Which subsystem this relates to. */
  subsystem: string;
  /** Confidence level of the observation itself. */
  confidence: ObservationConfidence;
  /** Emitted interactions if applicable. */
  emittedInteractions?: unknown[];
  /** Generated Playwright code if applicable. */
  playwrightCode?: string | null;
}
