/**
 * Capability Review Service — orchestrates the review workflow.
 *
 * P1 Design: .drytis/specs/p1-capability-lifecycle-management.md §11 Step 3
 *
 * This service creates reviews from recording sessions and processes review
 * decisions (approve, reject, override). It is the ONLY path through which a
 * CapabilityCandidate becomes an approved Capability.
 *
 * Boundary invariants:
 *   - Never calls ir-bridge, code generators, or evidence engine (INV-P1-B1/B2)
 *   - Never modifies ComponentInteraction objects (INV-P1-B3)
 *   - createReview() and processDecision() are pure functions that return
 *     new objects — callers are responsible for persistence.
 */

import type { CapabilityCandidate, CapabilityInput } from '../entities/capability-candidate';
import type { CapabilityReview, CapabilityReviewEdits, MatchSuggestionSummary } from '../entities/capability-review';
import type { Capability } from '../entities/capability';
import type { CapabilityVersion } from '../entities/capability-version';
import type { P2CapabilityContract } from '../entities/p2-capability-contract';
import type { DataRequirement } from '../entities/data-requirement';
import type { SuccessCriterion } from '../entities/success-criterion';
import type { CapabilityMatchResult } from '../../repository/services/capability-matching-service';
import type { OutcomeDescriptor, ValidationRule } from '../entities/capability-candidate';
import type {
  CapabilityInput as EntityCapabilityInput,
  CapabilityValidationRule,
  CapabilityOutcome,
} from '../entities/capability';

import { createCapability, enrichCapability } from '../entities/capability';
import {
  candidateToDataRequirements,
  successIndicatorsToCriteria,
  capabilityToVersion,
  capabilityToContract,
} from '../mappings/capability-mappers';
import type { SuccessIndicator } from '../entities/application-knowledge';

// ── Types ─────────────────────────────────────────────────

/**
 * The result of processing a review decision.
 */
export interface ReviewDecisionResult {
  /** The created/enriched capability (null if rejected). */
  readonly capability: Capability | null;
  /** The version snapshot created on approval (null if rejected). */
  readonly version: CapabilityVersion | null;
  /** The P2/P3 contract (null if rejected). */
  readonly contract: P2CapabilityContract | null;
  /** The updated review entity. */
  readonly review: CapabilityReview;
}

// ── createReview ──────────────────────────────────────────

/**
 * Create a CapabilityReview from a derived candidate + match result.
 *
 * The review starts in 'pending' state. The caller persists it in Dexie
 * and surfaces it in the side panel for the reviewer.
 */
export function createReview(
  candidate: CapabilityCandidate,
  matchResult: CapabilityMatchResult,
  sessionId: string,
): CapabilityReview {
  const suggestion: MatchSuggestionSummary = {
    decision: matchResult.decision,
    bestMatchId: matchResult.bestMatch?.capabilityId ?? null,
    bestMatchName: matchResult.bestMatch?.capabilityId ?? null, // name not available in score
    bestMatchScore: matchResult.bestMatch?.totalScore ?? null,
  };

  return {
    reviewId: crypto.randomUUID(),
    capabilityCandidateId: candidate.capabilityId,
    sessionId,
    matchSuggestion: suggestion,
    state: 'pending',
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    edits: createEmptyEdits(),
    resultCapabilityId: null,
    resultVersionId: null,
  };
}

// ── processDecision ───────────────────────────────────────

/**
 * Process a review decision (approve or reject).
 *
 * On approve:
 *   - If existingCapability is provided → enrich it with the candidate's data
 *   - If existingCapability is null → create a new capability
 *   - A CapabilityVersion snapshot is created
 *   - A P2CapabilityContract is published
 *
 * On reject:
 *   - No capability is created/enriched
 *   - The review is marked 'rejected'
 *
 * @param review - The review being decided
 * @param decision - 'approve' or 'reject'
 * @param edits - Reviewer's edits (name, purpose, data requirements, success criteria)
 * @param reviewer - Reviewer identity (email or 'system')
 * @param candidate - The original CapabilityCandidate
 * @param existingCapability - The existing capability to merge into (for auto-merge), or null for new
 * @param entryPointUrl - The starting URL for this capability (from recording)
 * @param successIndicators - Raw indicators from the fragment (for mapping to SuccessCriterion)
 */
export function processDecision(
  review: CapabilityReview,
  decision: 'approve' | 'reject',
  edits: CapabilityReviewEdits,
  reviewer: string,
  candidate: CapabilityCandidate,
  existingCapability: Capability | null,
  entryPointUrl: string,
  successIndicators: SuccessIndicator[],
): ReviewDecisionResult {
  const now = new Date().toISOString();

  // Apply edits to review
  const updatedReview: CapabilityReview = {
    ...review,
    state: decision === 'approve' ? 'approved' : 'rejected',
    reviewedAt: now,
    reviewedBy: reviewer,
    edits,
  };

  if (decision === 'reject') {
    return {
      capability: null,
      version: null,
      contract: null,
      review: updatedReview,
    };
  }

  // ── Approve path ──

  // Derive data requirements (apply reviewer edits if present)
  const dataRequirements: DataRequirement[] = edits.inputsEdited && edits.editedDataRequirements
    ? [...edits.editedDataRequirements]
    : candidateToDataRequirements(candidate.inputs);

  // Derive success criteria (apply reviewer edits if present)
  const successCriteria: SuccessCriterion[] = edits.successCriteriaEdited && edits.editedSuccessCriteria
    ? [...edits.editedSuccessCriteria]
    : successIndicatorsToCriteria(successIndicators);

  // Determine effective name/purpose
  const effectiveName = edits.nameChanged && edits.editedName
    ? edits.editedName
    : candidate.name;
  const effectivePurpose = edits.purposeChanged && edits.editedPurpose
    ? edits.editedPurpose
    : candidate.purpose;

  // Build or enrich the capability
  let capability: Capability;

  if (existingCapability) {
    // Merge into existing capability
    capability = enrichCapability(existingCapability, {
      inputs: mapToEntityInputs(candidate.inputs),
      validationRules: mapToEntityValidationRules(candidate.validationRules, candidate.inputs),
      observedOutcomes: mapToEntityOutcomes([candidate.observedOutcome]),
      sourceSessionId: candidate.sourceSessionId,
      consistentObservation: true,
    });
  } else {
    // Create new capability
    capability = createCapability({
      projectId: 'default',
      name: effectiveName,
      purpose: effectivePurpose,
      inputs: mapToEntityInputs(candidate.inputs),
      validationRules: mapToEntityValidationRules(candidate.validationRules, candidate.inputs),
      observedOutcomes: mapToEntityOutcomes([candidate.observedOutcome]),
      sourceSessionId: candidate.sourceSessionId,
    });
  }

  // Set P1 lifecycle fields on the capability (typed fields on Capability interface)
  const nextVersionNumber = existingCapability?.currentVersion
    ? existingCapability.currentVersion + 1
    : 1;

  const capabilityWithP1: Capability = {
    ...capability,
    reviewState: 'approved',
    currentVersion: nextVersionNumber,
    dataRequirements,
    successCriteria,
    name: effectiveName,
    purpose: effectivePurpose,
  };

  // Create version snapshot
  const version = capabilityToVersion(capabilityWithP1, updatedReview, nextVersionNumber);

  // Update review with results
  const finalReview: CapabilityReview = {
    ...updatedReview,
    resultCapabilityId: capabilityWithP1.id,
    resultVersionId: version.versionId,
  };

  // Build P2/P3 contract
  const entryPointElementName = candidate.entryElement?.accessibleName ?? null;
  const contract = capabilityToContract(
    capabilityWithP1,
    version,
    entryPointUrl,
    entryPointElementName,
  );

  return {
    capability: capabilityWithP1,
    version,
    contract,
    review: finalReview,
  };
}

// ── Helpers ───────────────────────────────────────────────

function createEmptyEdits(): CapabilityReviewEdits {
  return {
    nameChanged: false,
    purposeChanged: false,
    inputsEdited: false,
    successCriteriaEdited: false,
    editedName: null,
    editedPurpose: null,
    editedDataRequirements: null,
    editedSuccessCriteria: null,
  };
}

/**
 * Map candidate CapabilityInputs to entity CapabilityInputs.
 */
function mapToEntityInputs(inputs: CapabilityInput[]): EntityCapabilityInput[] {
  return inputs.map((inp) => ({
    label: inp.label,
    fieldType: inp.inputType ?? 'text',
    required: inp.required,
    validationConstraints: buildValidationConstraintStrings(inp),
  }));
}

function buildValidationConstraintStrings(input: CapabilityInput): string[] {
  const constraints: string[] = [];
  if (input.required) constraints.push('required');
  if (input.format) constraints.push(`format:${input.format.regex}`);
  if (input.valueRange) constraints.push(`range:${input.valueRange.min}-${input.valueRange.max}`);
  if (input.lengthRange) constraints.push(`length:${input.lengthRange.minLength}-${input.lengthRange.maxLength}`);
  if (input.validOptions) constraints.push(`options:${input.validOptions.join(',')}`);
  return constraints;
}

/**
 * Map candidate ValidationRules to entity CapabilityValidationRules.
 */
function mapToEntityValidationRules(
  rules: ValidationRule[],
  _inputs: CapabilityInput[],
): CapabilityValidationRule[] {
  return rules.map((r) => ({
    fieldLabel: r.field,
    ruleType: r.type,
    constraint: r.constraint,
    source: 'observed' as const,
  }));
}

/**
 * Map candidate OutcomeDescriptors to entity CapabilityOutcomes.
 */
function mapToEntityOutcomes(outcomes: OutcomeDescriptor[]): CapabilityOutcome[] {
  return outcomes.map((o, i) => ({
    outcomeId: `outcome-${i}`,
    terminalUrl: o.terminalUrl,
    successIndicators: o.successSignals,
    description: `Observed outcome: ${o.terminalUrl ?? 'unknown'}`,
    firstObservedAt: new Date().toISOString(),
  }));
}
