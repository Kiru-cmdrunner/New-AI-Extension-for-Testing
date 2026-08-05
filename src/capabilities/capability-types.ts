/**
 * Capability Types — V1 Taxonomy, Output Schema, and Claim Types
 *
 * The Capability Model identifies what application/UI capability was exercised
 * based on observable recording evidence. These types define the vocabulary,
 * the output format, and the intermediate claim structure used during inference.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md
 */

import type { InteractionType } from '../shared/component-types';

// ── V1 Taxonomy ────────────────────────────────────────────────────────

/**
 * The 12 V1 capability types plus the Unclassified fallback.
 *
 * Each type describes a category of user-meaningful action, not a physical
 * control type. One ComponentInteraction maps to exactly one capability
 * (1:1 cardinality). Co-occurring capabilities are tracked in `alternatives`.
 */
export type CapabilityType =
  | 'FilterSelection'   // Narrow a result set by a criterion
  | 'SortSelection'     // Change ordering of a result set
  | 'Search'            // Enter query text to find matching content
  | 'Navigate'          // Move to a different page/view
  | 'SubmitForm'        // Submit form data to the application
  | 'SelectOption'      // Choose a value from a list of options
  | 'ToggleControl'     // Switch a binary state on/off
  | 'ExpandCollapse'    // Show/hide content in place
  | 'OpenDetail'        // Drill into a specific item's details
  | 'UploadFile'        // Provide a file to the application
  | 'Paginate'          // Move to next/previous page of results
  | 'AdjustValue'       // Set a numeric/range value (slider, spinbutton)
  | 'Unclassified';     // Insufficient evidence to classify

/**
 * All capability types in a fixed array (for validation, iteration).
 */
export const ALL_CAPABILITY_TYPES: readonly CapabilityType[] = [
  'FilterSelection',
  'SortSelection',
  'Search',
  'Navigate',
  'SubmitForm',
  'SelectOption',
  'ToggleControl',
  'ExpandCollapse',
  'OpenDetail',
  'UploadFile',
  'Paginate',
  'AdjustValue',
  'Unclassified',
] as const;

// ── Confidence ────────────────────────────────────────────────────────

/**
 * Confidence tier assigned by a capability rule.
 *
 * HIGH: Required signals met + 2+ supporting (at least 1 non-keyword)
 * MEDIUM: Required signals met + 1 supporting, OR direct-property M2 evidence
 * LOW: Required signals met + 0 supporting signals
 */
export type CapabilityConfidence = 'high' | 'medium' | 'low';

// ── Evidence Trail ────────────────────────────────────────────────────

/**
 * The evidence trail attached to every CapabilityRecord.
 * Provides full auditability: what physical type was the control,
 * what semantic effects were observed, what keywords matched,
 * what structural context was present, and what sequence context existed.
 */
export interface CapabilityEvidence {
  /** The physical interaction type (Click, Checkbox, TextEntry, etc.). */
  physicalType: InteractionType;
  /** Accessible name / label of the trigger element. */
  targetLabel: string | null;
  /** Summary of semantic effects observed (e.g., 'state-toggle', 'content-change'). */
  semanticEffects: string[];
  /** Keywords that matched the trigger label, ancestors, or context. */
  matchedKeywords: string[];
  /** Structural context signals (ancestor roles, results-container detection). */
  structuralContext: string[];
  /** Sequence context notes (preceded by TextEntry, same-form, etc.). */
  sequenceNotes: string[];
}

// ── Capability Parameters ────────────────────────────────────────────

/**
 * Parameters describing what the capability operated on.
 * Populated differently by each capability type.
 */
export interface CapabilityParameters {
  /** The target of the capability (e.g., "Sony" for filter, "Price: Low to High" for sort). */
  target?: string;
  /** The scope/category (e.g., "Brand", "Price", "Search Results"). */
  scope?: string;
  /** The value set (e.g., "on"/"off" for toggle, "5" for slider). */
  value?: string;
}

// ── Alternatives ──────────────────────────────────────────────────────

/**
 * A competing capability claim that lost during conflict resolution.
 * Preserved for auditability and potential future re-evaluation.
 */
export interface CapabilityAlternative {
  /** The capability type this alternative claims. */
  capability: CapabilityType;
  /** Confidence the alternative claimed. */
  confidence: CapabilityConfidence;
  /** Why this alternative was not selected as primary. */
  reason: string;
}

// ── Capability Record (Final Output) ──────────────────────────────────

/**
 * The complete capability inference result for one ComponentInteraction.
 *
 * One ComponentInteraction → exactly one CapabilityRecord.
 * The primary capability is in `capability`. Competing claims are in `alternatives`.
 *
 * Serialized and stored alongside the interaction after recording stops.
 */
export interface CapabilityRecord {
  /** Unique ID for this capability record: `cap-{interactionId}`. */
  capabilityId: string;
  /** FK to the ComponentInteraction this capability describes. */
  interactionId: string;
  /** The primary capability classification. */
  capability: CapabilityType;
  /** Confidence in this classification. */
  confidence: CapabilityConfidence;
  /** Parameters describing what the capability operated on. */
  parameters: CapabilityParameters;
  /** Full evidence trail for auditability. */
  evidence: CapabilityEvidence;
  /** Competing claims that lost during conflict resolution. */
  alternatives: CapabilityAlternative[];
  /** Only set when capability='Unclassified': explains why classification failed. */
  unclassifiedReason?: string;
}

// ── Capability Claim (Intermediate) ──────────────────────────────────

/**
 * The type of stream a supporting signal came from.
 * Used by conflict resolution to weight multi-stream evidence higher
 * than multiple signals from the same stream.
 */
export type SignalStream = 'keyword' | 'physical-type' | 'behavioral' | 'structural' | 'sequence';

/**
 * An intermediate claim produced by a capability rule during inference.
 * The conflict resolver selects the primary claim and demotes the rest.
 */
export interface CapabilityClaim {
  /** The capability type this rule claims. */
  capability: CapabilityType;
  /** Confidence in this claim. */
  confidence: CapabilityConfidence;
  /**
   * Priority number from the rule (lower = more specific).
   * Used as tiebreaker when confidence and supporting-signal count are equal.
   */
  priority: number;
  /**
   * Count of DISTINCT streams that contributed supporting signals.
   * E.g., keyword + physical-type = 2 distinct streams.
   * Multi-stream evidence counts more than same-stream evidence.
   */
  supportingSignalCount: number;
  /** Set of distinct streams that provided supporting signals. */
  signalStreams: Set<SignalStream>;
  /** Parameters extracted by the rule (if any). */
  parameters?: CapabilityParameters;
  /** Human-readable reason for this claim (for alternatives trail). */
  reason: string;
  /** Whether this claim has direct-property M2 evidence (never downgraded). */
  hasDirectProperty: boolean;
}
