/**
 * Evidence classifier: the orchestrator that ties the full pipeline together.
 *
 * Pipeline:
 *   FeatureView → Evidence Generators → Intent Inference → Type Derivation
 *
 * Phase 2: Rewired to accept ObservedEvent (Component Runtime type) instead
 * of ElementRecordedEvent (V1 type). The core pipeline is unchanged.
 *
 * R3: Signature changed from (target, event) to accept the full
 * ComponentInteraction. This gives buildFeatureView access to attribute
 * transitions stored in metadata by the Click lifecycle (R3.4), enabling
 * behavioral generators to reason about post-handler state changes.
 */

import type { ComponentInteraction, AttributeChange } from '../../shared/component-types';
import type { SemanticIntent, IntentVote } from './types';
import { buildFeatureView } from './feature-view';
import { EVIDENCE_GENERATORS } from './generators';
import { fuseEvidence } from './intent-inference';
import { deriveType, deriveMetadata } from './type-deriver';

/**
 * The result of evidence-based classification.
 * The caller assembles this into a ComponentInteraction annotation.
 */
export interface EvidenceClassification {
  /** The derived interaction type string (e.g. 'Checkbox', 'ToggleSwitch', 'Link'). */
  type: string;
  /** Metadata for the interaction (checked state, accessible name, etc.). */
  metadata: { checked?: boolean; accessibleName?: string; inputValue?: string; selectedValue?: string };
  /** Confidence from evidence fusion (0.0–1.0). */
  confidence: number;
  /** The winning semantic intent. */
  intent: SemanticIntent;
  /** Full evidence audit trail. */
  evidence: IntentVote[];
}

/**
 * Classify an interaction using evidence-based intent inference.
 *
 * R3: Accepts the full ComponentInteraction instead of just (target, event).
 * This allows buildFeatureView to receive attribute transitions from the
 * Click lifecycle's post-handler re-snapshot (stored in metadata by buildResult).
 *
 * @param interaction  The ComponentInteraction to classify
 * @returns Evidence classification result (type + metadata + confidence + audit trail)
 */
export function classifyByEvidence(
  interaction: ComponentInteraction,
): EvidenceClassification {
  // R3.4: Extract attribute transitions from metadata (set by Click buildResult)
  const attributeChanges: AttributeChange[] | undefined =
    interaction.metadata.attributeChanges as AttributeChange[] | undefined;

  // Step 1: Build the normalized feature view
  const features = buildFeatureView(
    interaction.trigger,
    interaction.triggerEvent,
    attributeChanges,
  );

  // Step 2: Run all evidence generators
  const allEvidence = EVIDENCE_GENERATORS.flatMap((gen) => gen.generate(features));

  // Step 3: Fuse evidence into intent classification
  const intentResult = fuseEvidence(allEvidence);

  // Step 4: Derive backward-compatible InteractionType
  const type = deriveType(intentResult.intent, features);

  // Step 5: Derive metadata
  const derivedMeta = deriveMetadata(intentResult.intent, features);

  return {
    type,
    metadata: derivedMeta,
    confidence: intentResult.confidence,
    intent: intentResult.intent,
    evidence: intentResult.evidence,
  };
}
