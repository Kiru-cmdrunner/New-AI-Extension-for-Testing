/**
 * Capability Engine — orchestrates the batch post-recording inference.
 *
 * For each interaction in a recording:
 * 1. Extract evidence (PhysicalEvidence + BehavioralEvidence + SequenceContext + Keywords).
 * 2. Run all registered rules.
 * 3. Collect non-null claims.
 * 4. Delegate to conflict resolver.
 * 5. Produce a CapabilityRecord.
 *
 * Runs AFTER the recording session. No real-time cost. No DOM access.
 * Pure deterministic computation.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (§9, Phase 1)
 */

import type { ComponentInteraction } from '../shared/component-types';
import type { SemanticEffect } from '../semantics/effect-types';
import type {
  CapabilityRecord,
  CapabilityClaim,
  CapabilityEvidence,
  CapabilityParameters,
  CapabilityAlternative,
} from './capability-types';
import type { CapabilityRule } from './capability-rule';
import type { ExtractedEvidence } from './evidence-extractor';
import { extractEvidence } from './evidence-extractor';
import { resolveClaims, NO_CLAIM_REASON, ONLY_LOW_CLAIMS_REASON } from './conflict-resolver';

// ── Effects Map ───────────────────────────────────────────────────────

/**
 * Maps interactionId → SemanticEffects for that interaction.
 * Built from M2's interpretation output.
 */
export type EffectsMap = Map<string, SemanticEffect[]>;

// ── Engine ────────────────────────────────────────────────────────────

/**
 * The Capability Engine. Stateless after construction — rules are registered
 * once at startup, then inferCapabilities runs as a pure batch function.
 *
 * Usage:
 *   const engine = new CapabilityEngine();
 *   engine.registerRule(new ToggleControlRule());
 *   engine.registerRule(new FilterSelectionRule());
 *   const records = engine.inferCapabilities(interactions, effectsMap);
 */
export class CapabilityEngine {
  private readonly rules: CapabilityRule[] = [];

  /**
   * Register a capability rule. Rules are evaluated in parallel for each
   * interaction; the conflict resolver selects the winner.
   */
  registerRule(rule: CapabilityRule): void {
    this.rules.push(rule);
  }

  /**
   * Infer capabilities for all interactions in a recording session.
   *
   * Batch post-recording inference:
   * - Iterates all interactions with full sequence context.
   * - Runs all registered rules for each interaction.
   * - Collects claims, resolves conflicts, produces CapabilityRecords.
   *
   * @param interactions - All ComponentInteractions from the recording.
   * @param effectsMap - Map of interactionId → SemanticEffects (from M2).
   * @returns One CapabilityRecord per interaction (1:1 cardinality).
   */
  inferCapabilities(
    interactions: ComponentInteraction[],
    effectsMap: EffectsMap,
  ): CapabilityRecord[] {
    if (interactions.length === 0) return [];

    return interactions.map((interaction, index) => {
      return this.inferOne(interaction, interactions, index, effectsMap);
    });
  }

  /**
   * Infer capability for a single interaction.
   * Internal — called by inferCapabilities for each interaction.
   */
  private inferOne(
    interaction: ComponentInteraction,
    interactions: ComponentInteraction[],
    index: number,
    effectsMap: EffectsMap,
  ): CapabilityRecord {
    const interactionId = interaction.interactionId;
    const effects = effectsMap.get(interactionId) ?? [];

    // 1. Extract evidence
    const evidence = extractEvidence(interaction, effects, interactions, index);

    // 2. Run all rules, collect claims
    const claims: CapabilityClaim[] = [];
    for (const rule of this.rules) {
      const claim = rule.evaluate(evidence);
      if (claim !== null) {
        claims.push(claim);
      }
    }

    // 3. Resolve conflicts
    const resolution = resolveClaims(claims);

    // 4. Build the CapabilityRecord
    return this.buildRecord(
      interactionId,
      evidence,
      resolution.primary,
      resolution.alternatives,
    );
  }

  /**
   * Build the final CapabilityRecord from the resolution result.
   */
  private buildRecord(
    interactionId: string,
    evidence: ExtractedEvidence,
    primary: CapabilityClaim | null,
    alternatives: CapabilityAlternative[],
  ): CapabilityRecord {
    const capabilityId = `cap-${interactionId}`;

    // Build evidence trail
    const evidenceTrail: CapabilityEvidence = {
      physicalType: evidence.physical.interactionType,
      targetLabel: evidence.physical.accessibleName || null,
      semanticEffects: evidence.behavioral.effects.map((e) => e.category),
      matchedKeywords: evidence.keywords.matches.flatMap((m) => m.matched),
      structuralContext: [
        ...evidence.physical.ancestorRoles.map((r) => `ancestor:${r}`),
      ],
      sequenceNotes: this.buildSequenceNotes(evidence),
    };

    // If no primary claim, produce Unclassified
    if (primary === null) {
      const reason = alternatives.length > 0
        ? ONLY_LOW_CLAIMS_REASON
        : NO_CLAIM_REASON;

      return {
        capabilityId,
        interactionId,
        capability: 'Unclassified',
        confidence: 'low',
        parameters: {},
        evidence: evidenceTrail,
        alternatives,
        unclassifiedReason: reason,
      };
    }

    return {
      capabilityId,
      interactionId,
      capability: primary.capability,
      confidence: primary.confidence,
      parameters: primary.parameters ?? {},
      evidence: evidenceTrail,
      alternatives,
    };
  }

  /**
   * Build human-readable sequence notes for the evidence trail.
   */
  private buildSequenceNotes(evidence: ExtractedEvidence): string[] {
    const notes: string[] = [];
    if (evidence.sequence.precededByTextEntryOnSameForm) {
      notes.push('preceded by TextEntry on same page');
    }
    if (evidence.sequence.urlChanged) {
      notes.push('URL changed from previous interaction');
    }
    if (evidence.sequence.urlChangedAfter) {
      notes.push('URL changed after this interaction');
    }
    if (evidence.behavioral.hasRemoteEffect) {
      notes.push('effect on different element than trigger');
    }
    return notes;
  }
}
