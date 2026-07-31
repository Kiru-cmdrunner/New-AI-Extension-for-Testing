/**
 * Evidence classifier: the orchestrator that ties the full pipeline together.
 *
 * Pipeline:
 *   FeatureView → Evidence Generators → Intent Inference → Type Derivation
 *
 * Phase 2: Rewired to accept ObservedEvent (Component Runtime type) instead
 * of ElementRecordedEvent (V1 type). The core pipeline is unchanged.
 */

import type { InteractionType, InteractionMetadata } from '../interaction-types';
import type { ElementIdentity } from '../../shared/types';
import type { ObservedEvent } from '../../shared/component-types';
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
  /** The derived InteractionType (backward compatible). */
  type: InteractionType;
  /** Metadata for the interaction (checked state, accessible name). */
  metadata: InteractionMetadata;
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
 * Phase 2: Called by the semantic annotation layer for ambiguous Click
 * interactions. The caller passes the trigger element identity and the
 * trigger observed event from the ComponentInteraction.
 *
 * @param target  The element identity from the observed event
 * @param event   The trigger observed event from the ComponentInteraction
 * @returns Evidence classification result (type + metadata + confidence + audit trail)
 */
export function classifyByEvidence(
  target: ElementIdentity,
  event: ObservedEvent,
): EvidenceClassification {
  // Step 1: Build the normalized feature view
  const features = buildFeatureView(target, event);

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
