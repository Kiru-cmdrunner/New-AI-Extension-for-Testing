/**
 * Semantic Effect Types — Implementation-independent descriptions of
 * what a user interaction accomplished in the DOM.
 *
 * These are the v1 fixed taxonomy. Future versions may extend;
 * 'unclassified' is the escape hatch for patterns not yet covered.
 *
 * Architecture: .drytis/specs/semantic-effect-interpretation.md
 */

/** v1 fixed effect categories. */
export type EffectCategory =
  | 'state-toggle'          // checked, aria-checked, aria-pressed changed
  | 'expand-collapse'       // aria-expanded changed
  | 'enable-disable'        // disabled property changed
  | 'content-change'        // childList, characterData, childCount, textContent delta
  | 'visibility-change'     // element removed from DOM (endReason='element-removed')
  | 'no-observable-effect'  // completed window, zero deltas, zero mutations
  | 'unclassified';         // mutations exist but no rule matched

/** Confidence level assigned by the rule + confidence engine. */
export type Confidence = 'high' | 'medium' | 'low';

/**
 * Why this confidence was assigned — for auditability and downstream reasoning.
 * A capability engine can use this to weight or filter effects.
 */
export type ConfidenceBasis =
  | 'direct-property'        // aria*/checked/disabled delta — always high
  | 'structural-inference'   // childList/characterData — medium baseline
  | 'noise-degraded'         // structural + performanceCondition present
  | 'early-close'            // any non-direct inference + window ended early
  | 'incomplete-observation' // no-observable-effect on an early-closed window
  | 'no-match';              // mutations exist but no rule fired

/**
 * The semantic identity of the element affected by the effect.
 * Derived from the interaction context (for trigger element) or
 * from the mutation target path (for structural effects).
 */
export interface AffectedTarget {
  /** ARIA role of the affected element, if known. */
  role: string | null;
  /** Accessible name / label of the affected element, if known. */
  label: string | null;
  /** CSS selector path used as the identity anchor. */
  cssPath: string;
}

/**
 * One semantic effect — an implementation-independent description of
 * what one observation window captured.
 *
 * An observation window may produce zero, one, or many SemanticEffects.
 */
export interface SemanticEffect {
  /** v1 fixed category. */
  category: EffectCategory;
  /**
   * Human-readable description of what happened.
   * E.g., 'unchecked → checked', 'child elements: 12 → 2',
   *       'element removed from DOM'.
   */
  description: string;
  /** Identity of the element affected by this effect. */
  affectedTarget: AffectedTarget;
  /** Confidence in this interpretation. */
  confidence: Confidence;
  /** Why this confidence level was assigned. */
  confidenceBasis: ConfidenceBasis;
  /** Back-pointer to raw evidence for audit trail. */
  evidenceRef: {
    windowId: string;
    sourceEventId: string;
  };
}
