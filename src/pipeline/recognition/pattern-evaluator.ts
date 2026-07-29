/**
 * Pattern Evaluator — Phase 4
 *
 * Generic engine that evaluates PatternConditions against an InteractionCandidate.
 *
 * The evaluator contains NO interaction-specific logic. It is a data-driven
 * matcher that applies the 9 PatternOperators to evidence values. Adding a new
 * interaction type = adding a new PatternDefinition, not changing this engine.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type {
  PatternDefinition,
  PatternCondition,
  PatternOperator,
  SignalType,
} from '../../types/foundation';
import type { InteractionCandidate } from './event-grouper';

// ── Evidence Lookup ──────────────────────────────────────────────────────

/**
 * Result of looking up evidence for a specific signal type.
 */
interface EvidenceLookup {
  /** Whether any evidence record for this signal type was found. */
  found: boolean;
  /** All values found for this signal type. */
  values: unknown[];
}

/**
 * Look up all evidence values for a given signal type in a candidate.
 *
 * Scans all EvidenceRecords across all batches in the candidate.
 */
function lookupEvidence(
  candidate: InteractionCandidate,
  signalType: SignalType,
): EvidenceLookup {
  const values: unknown[] = [];

  for (const batch of candidate.batches) {
    for (const record of batch.evidence) {
      if (record.signalType === signalType) {
        values.push(record.value);
      }
    }
  }

  // Also check structured fields on the batch (not just evidence records)
  augmentFromBatchFields(candidate, signalType, values);

  return {
    found: values.length > 0,
    values,
  };
}

/**
 * Augment evidence lookup with structured fields from EvidenceBatch.
 *
 * Many important signals are stored as typed fields on the batch (e.g.,
 * checkedTransition on domContext) rather than as EvidenceRecords. This
 * makes them available to pattern conditions.
 */
function augmentFromBatchFields(
  candidate: InteractionCandidate,
  signalType: SignalType,
  values: unknown[],
): void {
  // Avoid duplicates — if we already have evidence records for this signal,
  // the structured fields are redundant
  if (values.length > 0) return;

  for (const batch of candidate.batches) {
    const { target, domContext } = batch;

    switch (signalType) {
      case 'ariaRole':
        if (target.ariaRole) values.push(target.ariaRole);
        break;
      case 'tag':
        values.push(target.tag);
        break;
      case 'accessibleName':
        if (target.accessibleName) values.push(target.accessibleName);
        break;
      case 'valueTransition':
        if (domContext.valueTransition) {
          values.push(domContext.valueTransition);
        }
        break;
      case 'checkedTransition':
        if (domContext.checkedTransition) {
          values.push(domContext.checkedTransition);
        }
        break;
      case 'ariaState':
        if (target.ariaExpanded !== null) values.push({ expanded: target.ariaExpanded });
        if (target.ariaChecked !== null) values.push({ checked: target.ariaChecked });
        if (target.ariaPressed !== null) values.push({ pressed: target.ariaPressed });
        if (target.ariaSelected !== null) values.push({ selected: target.ariaSelected });
        break;
      case 'ariaAttribute':
        // Expose specific ARIA attributes as strings for pattern matching
        if (target.ariaHasPopup) values.push(`haspopup:${target.ariaHasPopup}`);
        if (target.ariaExpanded !== null) values.push(`expanded:${target.ariaExpanded}`);
        if (target.ariaChecked !== null) values.push(`checked:${target.ariaChecked}`);
        if (target.ariaPressed !== null) values.push(`pressed:${target.ariaPressed}`);
        if (target.ariaSelected !== null) values.push(`selected:${target.ariaSelected}`);
        // Expose inputType for compound element detection (checkbox/radio/date)
        if (target.inputType) values.push(`inputType:${target.inputType}`);
        break;
      case 'eventSequence':
        values.push(batch.eventSequence);
        break;
      case 'text':
        // Expose accessibleName as text signal for text-based matching
        if (target.accessibleName) values.push(target.accessibleName);
        break;
      case 'cssClass':
        // Look for cssClass evidence in Channel B records
        for (const rec of batch.evidence) {
          if (rec.signalType === 'cssClass') values.push(rec.value);
        }
        break;
      // inputType is available as a compound signal via tag+inputType
      // (see anyOf patterns for checkbox/radio)
      // Other signal types are only available via EvidenceRecords
    }
  }
}

// ── Operator Evaluation ──────────────────────────────────────────────────

/**
 * Evaluate a single operator against a value.
 *
 * @returns true if the operator matches, false otherwise.
 */
export function evaluateOperator(
  operator: PatternOperator,
  value: unknown,
  expected: unknown,
): boolean {
  switch (operator) {
    case 'equals':
      return value === expected;

    case 'notEquals':
      return value !== expected;

    case 'contains':
      if (typeof value === 'string' && typeof expected === 'string') {
        return value.includes(expected);
      }
      if (Array.isArray(value)) {
        if (Array.isArray(expected)) {
          return expected.every((e) => value.includes(e));
        }
        return value.includes(expected);
      }
      return false;

    case 'notContains':
      if (typeof value === 'string' && typeof expected === 'string') {
        return !value.includes(expected);
      }
      if (Array.isArray(value)) {
        if (Array.isArray(expected)) {
          return !expected.every((e) => value.includes(e));
        }
        return !value.includes(expected);
      }
      return true; // vacuously true for non-string/array

    case 'exists':
      return value !== null && value !== undefined;

    case 'notExists':
      return value === null || value === undefined;

    case 'matches':
      if (typeof value !== 'string') return false;
      try {
        // Support both RegExp objects and string patterns
        const re = expected instanceof RegExp ? expected : new RegExp(String(expected));
        return re.test(value);
      } catch {
        return false; // invalid regex
      }

    case 'greaterThan':
      if (typeof value !== 'number' || typeof expected !== 'number') return false;
      return value > expected;

    case 'lessThan':
      if (typeof value !== 'number' || typeof expected !== 'number') return false;
      return value < expected;

    case 'inRange':
      if (typeof value !== 'number' || !Array.isArray(expected)) return false;
      const [min, max] = expected as [number, number];
      return value >= min && value <= max;

    default:
      return false;
  }
}

// ── Condition Evaluation ─────────────────────────────────────────────────

/**
 * Result of evaluating a single pattern condition.
 */
export interface ConditionEvalResult {
  /** The condition that was evaluated. */
  condition: PatternCondition;
  /** Whether the condition was satisfied. */
  matched: boolean;
  /** The actual value found in the evidence (for tracing). */
  actualValue: unknown;
  /** Confidence contribution of this condition [0, 1]. */
  contribution: number;
}

/**
 * Evaluate a single condition against a candidate.
 *
 * A condition matches if at least one evidence value for the signal type
 * satisfies the operator.
 */
function evaluateCondition(
  condition: PatternCondition,
  candidate: InteractionCandidate,
): ConditionEvalResult {
  const lookup = lookupEvidence(candidate, condition.signalType);

  if (!lookup.found) {
    // No evidence for this signal type — try anyOf alternatives first
    if (condition.anyOf) {
      for (const alt of condition.anyOf) {
        const altLookup = lookupEvidence(candidate, alt.signalType);
        if (altLookup.found) {
          const altMatched = altLookup.values.some(
            (value) => evaluateOperator(alt.operator, value, alt.expected),
          );
          if (altMatched) {
            return {
              condition,
              matched: true,
              actualValue: `(anyOf: ${alt.signalType})`,
              contribution: condition.weight,
            };
          }
        }
      }
    }

    // No evidence for primary signal type or anyOf alternatives
    if (condition.operator === 'notExists') {
      return {
        condition,
        matched: true,
        actualValue: null,
        contribution: condition.weight,
      };
    }
    return {
      condition,
      matched: false,
      actualValue: null,
      contribution: 0,
    };
  }

  // Check if ANY value matches the primary condition
  let actualMatched: unknown = null;
  const matched = lookup.values.some((value) => {
    const result = evaluateOperator(condition.operator, value, condition.expected);
    if (result) actualMatched = value;
    return result;
  });

  // If primary didn't match but anyOf alternatives exist, try them
  if (!matched && condition.anyOf) {
    for (const alt of condition.anyOf) {
      const altLookup = lookupEvidence(candidate, alt.signalType);
      if (altLookup.found) {
        const altMatched = altLookup.values.some(
          (value) => evaluateOperator(alt.operator, value, alt.expected),
        );
        if (altMatched) {
          return {
            condition,
            matched: true,
            actualValue: `(anyOf: ${alt.signalType})`,
            contribution: condition.weight,
          };
        }
      }
    }
  }

  return {
    condition,
    matched,
    actualValue: actualMatched,
    contribution: matched ? condition.weight : 0,
  };
}

// ── Pattern Evaluation ───────────────────────────────────────────────────

/**
 * Result of evaluating a full pattern against a candidate.
 */
export interface PatternEvalResult {
  /** The pattern that was evaluated. */
  pattern: PatternDefinition;
  /** Whether all conditions matched. */
  allConditionsMet: boolean;
  /** Number of conditions that matched. */
  matchedCount: number;
  /** Total conditions. */
  totalConditions: number;
  /** Aggregate confidence [0, 1]. */
  confidence: number;
  /** Per-condition results for tracing. */
  conditionResults: ConditionEvalResult[];
}

/**
 * Evaluate a pattern against a candidate.
 *
 * A pattern matches if ALL conditions are satisfied. The aggregate confidence
 * is the weighted average of matched condition weights.
 *
 * @returns PatternEvalResult with match details and confidence
 */
export function evaluatePattern(
  pattern: PatternDefinition,
  candidate: InteractionCandidate,
): PatternEvalResult {
  const conditionResults: ConditionEvalResult[] = pattern.conditions.map(
    (condition) => evaluateCondition(condition, candidate),
  );

  const matchedCount = conditionResults.filter((r) => r.matched).length;
  const totalConditions = pattern.conditions.length;
  const allConditionsMet = matchedCount === totalConditions;

  // Confidence = weighted average of matched conditions
  const totalWeight = pattern.conditions.reduce((sum, c) => sum + c.weight, 0);
  const matchedWeight = conditionResults
    .filter((r) => r.matched)
    .reduce((sum, r) => sum + r.contribution, 0);

  const confidence = totalWeight > 0 ? matchedWeight / totalWeight : 0;

  return {
    pattern,
    allConditionsMet,
    matchedCount,
    totalConditions,
    confidence,
    conditionResults,
  };
}
