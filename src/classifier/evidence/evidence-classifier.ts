/**
 * Evidence classifier: the orchestrator that ties the full pipeline together.
 *
 * Pipeline:
 *   FeatureView → Evidence Generators → Intent Inference → Type Derivation
 *
 * This module is called by the existing classifier's ambiguous-case branch
 * (Link/Checkbox/Click/ToggleSwitch decision). It returns a classification
 * result that the caller assembles into a DetectedInteraction.
 */

import type { InteractionType, InteractionMetadata } from '../interaction-types';
import type { ElementIdentity } from '../../shared/types';
import type { ElementRecordedEvent } from '../../recorder/recorded-event';
import type { SemanticIntent, IntentVote } from './types';
import { buildFeatureView } from './feature-view';
import { EVIDENCE_GENERATORS } from './generators';
import { fuseEvidence } from './intent-inference';
import { deriveType, deriveMetadata } from './type-deriver';

/**
 * The result of evidence-based classification.
 * The caller assembles this into a DetectedInteraction.
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
 * Called by the existing classifier when the ambiguous decision is reached
 * (Link vs Checkbox vs Click vs ToggleSwitch). The caller passes the target
 * element identity and the click event from the event group.
 *
 * @param target  The element identity from the recorded event
 * @param clickEvent  The click event from the event group
 * @returns Evidence classification result (type + metadata + confidence + audit trail)
 */
export function classifyByEvidence(
  target: ElementIdentity,
  clickEvent: ElementRecordedEvent,
): EvidenceClassification {
  // Step 1: Build the normalized feature view
  const features = buildFeatureView(target, clickEvent);

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
