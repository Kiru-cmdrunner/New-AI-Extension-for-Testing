/**
 * Capability Entity — accumulated cross-session understanding of what a
 * business capability does.
 *
 * A Capability is the Repository's accumulated representation of a business
 * capability. It is seeded by a CapabilityCandidate (the per-session snapshot
 * from the Understanding Layer) and enriched through:
 *   1. Cross-session matching — new recordings that match an existing Capability
 *   2. Test execution feedback — observed outcomes and failure modes from runs
 *
 * Unlike the immutable UnderstandingResult, the Capability is a mutable
 * Repository entity (single row, append-only enrichmentHistory). This is
 * consistent with the Element entity, which also mutates (heal history grows).
 *
 * Design decisions (see architecture discussion, Phase 9.5 + Phase 10):
 *   - Single mutable row, NOT versioned. No review workflow to justify versioning.
 *   - enrichmentHistory[] is append-only — every enrichment event is recorded
 *     with structured deltas for audit and rollback.
 *   - Confidence progresses: candidate → confirmed → established.
 *   - Additive merge: new inputs/outcomes are added, never removed.
 *   - Stricter constraint wins on conflicts (e.g., required=true beats required=false).
 *
 * Invariants:
 *   INV-CAP1: capabilityId is immutable and globally unique.
 *   INV-CAP2: enrichmentHistory is append-only — entries are never removed or edited.
 *   INV-CAP3: confidence can only increase through consistent observations or
 *             decrease through contradictory evidence. It never resets.
 *   INV-CAP4: sessionIds tracks every recording session that contributed to this
 *             capability. A session ID appears at most once.
 *   INV-CAP5: name is set on creation and never changes. The name is the stable
 *             identity label — renaming would break the accumulated context.
 */

import { MissingFieldError, ValueObjectError } from '../errors/invariant-errors';

// ── Sub-types ─────────────────────────────────────────────

/** Confidence level of the capability understanding. */
export type CapabilityConfidence = 'candidate' | 'confirmed' | 'established';

/** An input field the capability accepts. */
export interface CapabilityInput {
  readonly label: string;
  readonly fieldType: string;
  readonly required: boolean;
  readonly validationConstraints: readonly string[];
}

/** A validation rule the capability enforces. */
export interface CapabilityValidationRule {
  readonly fieldLabel: string;
  readonly ruleType: string;
  readonly constraint: string;
  readonly source: 'observed' | 'inferred';
}

/** An outcome observed when the capability is exercised. */
export interface CapabilityOutcome {
  readonly outcomeId: string;
  readonly terminalUrl: string | null;
  readonly successIndicators: readonly string[];
  readonly description: string;
  readonly firstObservedAt: string;
}

/** A business rule governing the capability. */
export interface CapabilityBusinessRule {
  readonly ruleId: string;
  readonly description: string;
  readonly source: 'observed' | 'inferred' | 'ai-suggested';
  readonly confirmed: boolean;
}

/** A known failure mode for the capability. */
export interface CapabilityFailureMode {
  readonly failureId: string;
  readonly description: string;
  readonly trigger: string;
  readonly firstObservedAt: string;
}

/** A structured change delta within an enrichment event. */
export interface EnrichmentChange {
  readonly added: {
    readonly inputs?: readonly string[];
    readonly validationRules?: readonly string[];
    readonly observedOutcomes?: readonly string[];
    readonly businessRules?: readonly string[];
    readonly failureModes?: readonly string[];
    readonly sessionIds?: readonly string[];
  };
  readonly modified: readonly {
    readonly field: string;
    readonly from: unknown;
    readonly to: unknown;
  }[];
  readonly conflicts: readonly {
    readonly field: string;
    readonly existing: unknown;
    readonly candidate: unknown;
    readonly resolution: string;
  }[];
}

/** An enrichment event in the capability's history (append-only). */
export interface EnrichmentEvent {
  readonly type:
    | 'initial-derivation'
    | 'cross-session-merge'
    | 'test-execution'
    | 'ai-enrichment'
    | 'human-correction';
  readonly timestamp: string;
  readonly sourceSessionId: string | null;
  readonly description: string;
  readonly changes: EnrichmentChange;
  readonly confidenceAfter: CapabilityConfidence;
}

// ── Capability entity ────────────────────────────────────

/** The accumulated, cross-session understanding of a business capability. */
export interface Capability {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly purpose: string;
  readonly confidence: CapabilityConfidence;

  // ── Accumulated understanding (grows over time) ──
  readonly inputs: CapabilityInput[];
  readonly validationRules: CapabilityValidationRule[];
  readonly observedOutcomes: CapabilityOutcome[];
  readonly businessRules: CapabilityBusinessRule[];
  readonly failureModes: CapabilityFailureMode[];

  // ── Provenance ──
  readonly sessionIds: string[];
  readonly enrichmentHistory: EnrichmentEvent[];

  // ── Timestamps ──
  readonly createdAt: string;
  readonly lastEnrichedAt: string;
}

// ── Factory ───────────────────────────────────────────────

/** Input for creating a new Capability from an initial CapabilityCandidate. */
export interface CreateCapabilityInput {
  projectId: string;
  name: string;
  purpose: string;
  inputs: CapabilityInput[];
  validationRules: CapabilityValidationRule[];
  observedOutcomes: CapabilityOutcome[];
  businessRules?: CapabilityBusinessRule[];
  failureModes?: CapabilityFailureMode[];
  sourceSessionId: string;
}

/**
 * Create a Capability entity from the initial derivation.
 *
 * The first CapabilityCandidate seeds the Capability. Subsequent enrichments
 * go through enrichCapability().
 *
 * @throws MissingFieldError if projectId, name, or sourceSessionId is empty
 */
export function createCapability(input: CreateCapabilityInput): Capability {
  if (!input.projectId?.trim()) {
    throw new MissingFieldError('Capability', 'projectId');
  }

  const name = input.name?.trim();
  if (!name) {
    throw new MissingFieldError('Capability', 'name');
  }

  if (!input.sourceSessionId?.trim()) {
    throw new MissingFieldError('Capability', 'sourceSessionId');
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    projectId: input.projectId.trim(),
    name,
    purpose: input.purpose?.trim() ?? '',
    confidence: 'candidate',
    inputs: [...input.inputs],
    validationRules: [...input.validationRules],
    observedOutcomes: [...input.observedOutcomes],
    businessRules: input.businessRules ? [...input.businessRules] : [],
    failureModes: input.failureModes ? [...input.failureModes] : [],
    sessionIds: [input.sourceSessionId],
    enrichmentHistory: [
      {
        type: 'initial-derivation',
        timestamp: now,
        sourceSessionId: input.sourceSessionId,
        description: `Initial capability derivation from session ${input.sourceSessionId}`,
        changes: {
          added: {
            inputs: input.inputs.map((i) => i.label),
            validationRules: input.validationRules.map((r) => `${r.fieldLabel}:${r.ruleType}`),
            observedOutcomes: input.observedOutcomes.map((o) => o.outcomeId),
            sessionIds: [input.sourceSessionId],
          },
          modified: [],
          conflicts: [],
        },
        confidenceAfter: 'candidate',
      },
    ],
    createdAt: now,
    lastEnrichedAt: now,
  };
}

// ── Enrichment ────────────────────────────────────────────

/** Input for enriching an existing Capability with new observations. */
export interface EnrichCapabilityInput {
  /** New inputs observed. Labels not already in the capability are added. */
  inputs: CapabilityInput[];
  /** New validation rules. Duplicates by (fieldLabel, ruleType) are skipped. */
  validationRules: CapabilityValidationRule[];
  /** New outcomes. Duplicates by outcomeId are skipped. */
  observedOutcomes: CapabilityOutcome[];
  /** New business rules. */
  businessRules?: CapabilityBusinessRule[];
  /** New failure modes. */
  failureModes?: CapabilityFailureMode[];
  /** Session that provided this enrichment. */
  sourceSessionId: string;
  /** Whether this enrichment comes from a consistent observation (same capability). */
  consistentObservation: boolean;
}

/**
 * Enrich an existing Capability with new observations.
 *
 * This is a PURE FUNCTION — it returns a new Capability object, never mutates
 * the existing one. The enrichment is additive:
 *   - New inputs/outcomes/rules are added; existing ones are never removed.
 *   - On constraint conflicts (same field, different required flag), the stricter
 *     constraint wins (required=true beats required=false).
 *   - Confidence progresses based on consistency and session count.
 *
 * The enrichment event is appended to enrichmentHistory (INV-CAP2: append-only).
 *
 * @throws MissingFieldError if sourceSessionId is empty
 */
export function enrichCapability(
  existing: Capability,
  input: EnrichCapabilityInput,
): Capability {
  if (!input.sourceSessionId?.trim()) {
    throw new MissingFieldError('Capability', 'sourceSessionId');
  }

  const now = new Date().toISOString();
  // Mutable builder — fields are read-only on EnrichmentChange but
  // need mutation during the enrichment algorithm, then frozen at return.
  const changes: {
    added: Record<string, unknown>;
    modified: { field: string; from: unknown; to: unknown }[];
    conflicts: { field: string; existing: unknown; candidate: unknown; resolution: string }[];
  } = {
    added: {},
    modified: [],
    conflicts: [],
  };

  // ── Merge inputs (additive, stricter constraint wins) ──
  const existingInputLabels = new Map(existing.inputs.map((i) => [i.label, i]));
  const newInputs: CapabilityInput[] = [];
  const addedInputLabels: string[] = [];

  for (const candidateInput of input.inputs) {
    const existingInput = existingInputLabels.get(candidateInput.label);
    if (!existingInput) {
      // New input — add it
      newInputs.push(candidateInput);
      addedInputLabels.push(candidateInput.label);
    } else {
      // Existing input — check for constraint conflicts
      if (existingInput.required !== candidateInput.required) {
        // Record the conflict (disagreement between sessions)
        const stricterRequired = existingInput.required || candidateInput.required;
        changes.conflicts.push({
          field: `inputs[${candidateInput.label}].required`,
          existing: existingInput.required,
          candidate: candidateInput.required,
          resolution: 'stricter constraint wins (required=true)',
        });
        // Only record a modification if the existing value actually changes
        if (stricterRequired !== existingInput.required) {
          changes.modified.push({
            field: `inputs[${candidateInput.label}].required`,
            from: existingInput.required,
            to: stricterRequired,
          });
        }
      }
    }
  }

  const mergedInputs = [...existing.inputs, ...newInputs];

  // ── Merge validation rules (additive, dedup by fieldLabel+ruleType) ──
  const existingRuleKeys = new Set(
    existing.validationRules.map((r) => `${r.fieldLabel}:${r.ruleType}`),
  );
  const newRules: CapabilityValidationRule[] = [];
  const addedRuleKeys: string[] = [];

  for (const candidateRule of input.validationRules) {
    const key = `${candidateRule.fieldLabel}:${candidateRule.ruleType}`;
    if (!existingRuleKeys.has(key)) {
      newRules.push(candidateRule);
      addedRuleKeys.push(key);
    }
  }

  const mergedValidationRules = [...existing.validationRules, ...newRules];

  // ── Merge observed outcomes (additive, dedup by outcomeId) ──
  const existingOutcomeIds = new Set(existing.observedOutcomes.map((o) => o.outcomeId));
  const newOutcomes: CapabilityOutcome[] = [];
  const addedOutcomeIds: string[] = [];

  for (const candidateOutcome of input.observedOutcomes) {
    if (!existingOutcomeIds.has(candidateOutcome.outcomeId)) {
      newOutcomes.push(candidateOutcome);
      addedOutcomeIds.push(candidateOutcome.outcomeId);
    }
  }

  const mergedOutcomes = [...existing.observedOutcomes, ...newOutcomes];

  // ── Merge business rules (additive) ──
  const mergedBusinessRules = input.businessRules
    ? [...existing.businessRules, ...input.businessRules]
    : existing.businessRules;

  // ── Merge failure modes (additive) ──
  const mergedFailureModes = input.failureModes
    ? [...existing.failureModes, ...input.failureModes]
    : existing.failureModes;

  // ── Merge session IDs (additive, dedup) ──
  const isNewSession = !existing.sessionIds.includes(input.sourceSessionId);
  const mergedSessionIds = isNewSession
    ? [...existing.sessionIds, input.sourceSessionId]
    : existing.sessionIds;

  // ── Determine new confidence ──
  const newConfidence = recomputeConfidence(
    existing.confidence,
    existing.sessionIds.length + (isNewSession ? 1 : 0),
    input.consistentObservation,
    changes.conflicts.length > 0,
  );

  // ── Build enrichment event ──
  const enrichmentEvent: EnrichmentEvent = {
    type: 'cross-session-merge',
    timestamp: now,
    sourceSessionId: input.sourceSessionId,
    description: `Merged observations from session ${input.sourceSessionId}`,
    changes: {
      added: {
        inputs: addedInputLabels.length > 0 ? addedInputLabels : undefined,
        validationRules: addedRuleKeys.length > 0 ? addedRuleKeys : undefined,
        observedOutcomes: addedOutcomeIds.length > 0 ? addedOutcomeIds : undefined,
        businessRules: input.businessRules?.map((r) => r.ruleId),
        failureModes: input.failureModes?.map((f) => f.failureId),
        sessionIds: isNewSession ? [input.sourceSessionId] : undefined,
      },
      modified: changes.modified,
      conflicts: changes.conflicts,
    },
    confidenceAfter: newConfidence,
  };

  return {
    ...existing,
    inputs: mergedInputs,
    validationRules: mergedValidationRules,
    observedOutcomes: mergedOutcomes,
    businessRules: mergedBusinessRules,
    failureModes: mergedFailureModes,
    sessionIds: mergedSessionIds,
    enrichmentHistory: [...existing.enrichmentHistory, enrichmentEvent],
    confidence: newConfidence,
    lastEnrichedAt: now,
  };
}

/**
 * Recompute confidence based on consistency and session count.
 *
 * Progression: candidate → confirmed → established
 *   - confirmed: 2+ sessions with consistent observations, no unresolved conflicts
 *   - established: 3+ sessions + consistent observations, no unresolved conflicts
 *
 * Confidence does NOT advance if there are unresolved conflicts.
 * Confidence drops one level on contradictory evidence (test execution failure).
 */
function recomputeConfidence(
  current: CapabilityConfidence,
  sessionCount: number,
  consistent: boolean,
  hasConflicts: boolean,
): CapabilityConfidence {
  // Conflicts stall advancement
  if (hasConflicts) {
    return current;
  }

  if (!consistent) {
    // Contradictory evidence — drop one level
    if (current === 'established') return 'confirmed';
    if (current === 'confirmed') return 'candidate';
    return 'candidate';
  }

  // Consistent observation — check progression thresholds
  if (sessionCount >= 3) return 'established';
  if (sessionCount >= 2) return 'confirmed';
  return 'candidate';
}
