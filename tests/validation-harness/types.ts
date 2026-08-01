/**
 * Shared types for the expanded validation harness.
 *
 * Architecture: .drytis/EXPANDED_VALIDATION_DESIGN.md §8.4
 */

export interface RawObservation {
  /** Unique ID: e.g., "FW-MUI-01", "LQ-03", "WF-05" */
  observationId: string;
  /** Area: framework | locator | workflow | compound */
  area: 'framework' | 'locator' | 'workflow' | 'compound';
  /** The capability being tested: e.g., "A5 CustomDropdown" */
  capabilityId: string;
  /** The framework variant: e.g., "MUI", or null for non-framework tests */
  framework: string | null;
  /** Quality scores Q1-Q8 */
  scores: {
    q1_intent: number;
    q2_abstraction: number;
    q3_locator: number;
    q4_description: number;
    q5_replay: number;
    q6_confidence: number;
    q7_evidence: number;
    q8_assertion: number;
  };
  /** Support level */
  support: 'full' | 'partial' | 'unsupported' | 'crash';
  /** What went wrong (concrete observation, not diagnosis) */
  observed: string;
  /** Root cause diagnosis (may be shared across observations) */
  rootCause: string;
  /** Category */
  category: 'implementation-gap' | 'capability-gap' | 'architectural-limitation' | 'framework-gap' | 'browser-limitation';
  /** Severity */
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  /** Subsystem */
  subsystem: string;
  /** Confidence marker */
  confidence: 'SIMULATED' | 'VERIFIED';
  /** Emitted interactions (optional) */
  emittedInteractions?: unknown[];
  /** Generated Playwright code (optional) */
  playwrightCode?: string | null;
}
