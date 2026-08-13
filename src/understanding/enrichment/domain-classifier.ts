/**
 * M9.7 — Domain Classifier
 *
 * Deterministic weighted scoring of application knowledge against
 * domain signatures. Pure function — no side effects, no I/O.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type { ApplicationKnowledge } from '../consolidation/application-knowledge';
import type {
  DomainClassification,
  DomainEvidence,
  DomainType,
} from './semantic-types';
import {
  getDomainSignatures,
  type DomainSignature,
} from './domain-signatures';

/**
 * Classify the application domain from consolidated knowledge.
 *
 * Scoring: for each domain signature, sum weights for every matching
 * view ID, entity type, API operation, notification keyword, and URL
 * fragment. Normalize by dividing by the maximum possible score
 * (sum of all weights in the signature). Highest normalized score wins.
 */
export function classifyDomain(
  knowledge: ApplicationKnowledge,
): DomainClassification {
  const signatures = getDomainSignatures();
  const scores: { domain: DomainType; rawScore: number; maxScore: number; evidence: DomainEvidence }[] = [];

  for (const sig of signatures) {
    const result = scoreSignature(knowledge, sig);
    scores.push({ domain: sig.domain, ...result });
  }

  // Sort by normalized score descending.
  scores.sort((a, b) =>
    (b.rawScore / Math.max(b.maxScore, 1)) - (a.rawScore / Math.max(a.maxScore, 1)),
  );

  const winner = scores[0];
  const alternative = scores.length > 1 ? scores[1] : null;

  const confidence = Math.min(winner.rawScore / Math.max(winner.maxScore, 1), 1);
  const altConfidence = alternative
    ? Math.min(alternative.rawScore / Math.max(alternative.maxScore, 1), 1)
    : 0;

  return {
    domain: winner.rawScore > 0 ? winner.domain : 'unknown',
    confidence: Math.round(confidence * 1000) / 1000,
    evidence: winner.evidence,
    alternative: alternative && alternative.rawScore > 0 ? alternative.domain : null,
    margin: Math.round((confidence - altConfidence) * 1000) / 1000,
  };
}
function scoreSignature(
  knowledge: ApplicationKnowledge,
  sig: DomainSignature,
): { rawScore: number; maxScore: number; evidence: DomainEvidence } {
  let viewScore = 0;
  let entityScore = 0;
  let apiScore = 0;
  let notificationScore = 0;
  let urlScore = 0;
  const matched: string[] = [];

  // View patterns
  for (const view of knowledge.views) {
    if (sig.viewWeights[view.viewId]) {
      viewScore += sig.viewWeights[view.viewId];
      matched.push(`view:${view.viewId}`);
    }
  }

  // Entity types
  for (const entity of knowledge.entities) {
    if (sig.entityWeights[entity.type]) {
      entityScore += sig.entityWeights[entity.type];
      matched.push(`entity:${entity.type}`);
    }
  }

  // API operations: outcome pattern topActionTypes contains *interaction*
  // types (Click, TextEntry...), NOT API operations — mapping them would
  // fabricate signal. Only score when the action type string itself is a
  // key in the signature's apiOperationWeights (defensive; normally
  // populated from M9.1 network signals downstream).
  for (const actionType of knowledge.outcomePattern.topActionTypes) {
    const opType = actionType.actionType;
    if (sig.apiOperationWeights[opType]) {
      apiScore += sig.apiOperationWeights[opType];
      matched.push(`api:${opType}`);
    }
  }

  // Notification keywords
  for (const notif of knowledge.notifications) {
    const text = notif.text.toLowerCase();
    for (const [keyword, weight] of Object.entries(sig.notificationKeywords)) {
      if (text.includes(keyword)) {
        notificationScore += weight * notif.count;
        matched.push(`notif:${keyword}`);
      }
    }
  }

  // URL fragments
  const origin = knowledge.origin.toLowerCase();
  for (const [fragment, weight] of Object.entries(sig.urlFragments)) {
    if (origin.includes(fragment)) {
      urlScore += weight;
      matched.push(`url:${fragment}`);
    }
  }

  const maxScore =
    sumValues(sig.viewWeights) +
    sumValues(sig.entityWeights) +
    sumValues(sig.apiOperationWeights) +
    sumValues(sig.notificationKeywords) +
    sumValues(sig.urlFragments);

  return {
    rawScore: viewScore + entityScore + apiScore + notificationScore + urlScore,
    maxScore,
    evidence: {
      viewPatternScore: viewScore,
      entityTypeScore: entityScore,
      apiOperationScore: apiScore,
      notificationKeywordScore: notificationScore,
      urlStructureScore: urlScore,
      matchedSignals: [...new Set(matched)],
    },
  };
}

function sumValues(obj: Record<string, number>): number {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}
