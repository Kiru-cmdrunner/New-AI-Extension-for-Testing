/**
 * M9.7 — Semantic Enricher (Main Orchestrator)
 *
 * Orchestrates the full enrichment pipeline:
 *   1. Domain classification (from M9.6 knowledge)
 *   2. Interaction contract extraction (from trigger identity)
 *   3. Component recognition (Tier 1 reuse + Tier 2 behavioral)
 *   4. Intent labeling (API operation → vocabulary → button text)
 *   5. Workflow discovery (temporal + view-containment grouping)
 *   6. Application surface enrichment (views + navigation + capabilities)
 *   7. Recorded workflow aggregation (cross-session patterns)
 *
 * Input: M9.6 ApplicationKnowledge + M1–M8 ComponentInteractions + M9.2/M9.3 data.
 * Output: SemanticKnowledge — the Application Understanding model.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { ActionOutcome } from '../outcome/outcome-types';
import type { ApplicationState, StateTransition } from '../state-builder/types';
import type { ApplicationKnowledge } from '../consolidation/application-knowledge';
import type { SemanticKnowledge, SemanticWorkflow, EnrichmentMetadata, EnrichmentCoverage } from './semantic-types';
import { classifyDomain } from './domain-classifier';
import { recognizeComponent } from './component-recognizer';
import { extractInteractionContract } from './interaction-contract';
import { labelAllIntents } from './intent-labeler';
import { discoverWorkflows } from './workflow-discoverer';
import { buildApplicationSurface, enrichSurfaceWithKnowledge } from './application-surface';
import { aggregateRecordedWorkflows, getRecurringPatterns } from './recorded-workflow';

const ENRICHER_VERSION = 'm9.7-deterministic-v1';

/**
 * Input for the enricher.
 */
export interface SemanticEnricherInput {
  appId: string;
  /** Current session interactions. */
  interactions: ComponentInteraction[];
  /** M9.3 determined outcomes, keyed by interactionId. */
  outcomes: Map<string, ActionOutcome>;
  /** M9.2 state transitions. */
  transitions: StateTransition[];
  /** Current application state (end of session). */
  currentState: ApplicationState | null;
  /** Cross-session knowledge from M9.6 (optional — available after ≥2 sessions). */
  priorKnowledge: ApplicationKnowledge | null;
  /** Prior recorded workflows from previous enrichment runs. */
  priorRecordedWorkflows?: SemanticWorkflow[] | null;
  /** Session ID. */
  sessionId: string;
}

/**
 * Run the full enrichment pipeline and produce SemanticKnowledge.
 */
export function enrichSemantically(input: SemanticEnricherInput): SemanticKnowledge {
  const {
    interactions,
    outcomes,
    transitions,
    currentState,
    priorKnowledge,
    sessionId,
  } = input;

  // 1. Domain classification
  const domain = priorKnowledge
    ? classifyDomain(priorKnowledge)
    : classifyDomainFromSession(interactions, currentState);

  // 2. Interaction contracts (for all interactions with trigger identity)
  const contracts = interactions.map(extractInteractionContract);

  // 3. Component recognition
  const components = interactions.map((i) => {
    const outcome = outcomes.get(i.interactionId);
    const transition = transitions.find((t) => t.interactionId === i.interactionId);
    const viewId = transition?.after.currentView?.id ?? currentState?.currentView?.id;
    return recognizeComponent(i, outcome, viewId);
  });

  // 4. Intent labeling
  const intentMap = labelAllIntents(interactions, outcomes);
  const intents = [...intentMap.values()];

  // 5. Workflow discovery
  const workflows = discoverWorkflows(
    interactions,
    outcomes,
    transitions,
    intentMap,
    sessionId,
  );

  // 6. Application surface
  let surface = buildApplicationSurface(
    currentState,
    interactions,
    components,
    contracts,
    intentMap,
    transitions,
  );

  if (priorKnowledge) {
    surface = enrichSurfaceWithKnowledge(surface, priorKnowledge);
  }

  // 7. Recorded workflow aggregation
  const allRecorded = aggregateRecordedWorkflows(
    workflows,
    // If priorKnowledge has recorded patterns, they'd come via priorRecordedWorkflows
    // For now, we don't have a stored format — use empty
  );
  const recordedWorkflows = getRecurringPatterns(allRecorded);

  // Metadata
  const metadata = computeMetadata(interactions, workflows, surface, intents, contracts);

  return {
    appId: input.appId,
    domain,
    surface,
    contracts,
    components,
    intents,
    workflows,
    recordedWorkflows,
    metadata,
  };
}

/**
 * Classify domain from current-session data when prior knowledge is absent.
 * Builds a minimal ApplicationKnowledge-like input.
 */
function classifyDomainFromSession(
  interactions: ComponentInteraction[],
  state: ApplicationState | null,
): SemanticKnowledge['domain'] {
  // Without prior knowledge, we can only guess from current interactions.
  // Use a lightweight heuristic: check interaction labels for domain keywords.
  const labels = interactions
    .map((i) => i.trigger.accessibleName ?? '')
    .join(' ')
    .toLowerCase();

  const ecommerceKeywords = ['cart', 'checkout', 'product', 'add to cart', 'buy', 'shop'];
  const authKeywords = ['sign in', 'login', 'register', 'sign up', 'password'];

  const ecommerceScore = ecommerceKeywords.filter((kw) => labels.includes(kw)).length;
  const authScore = authKeywords.filter((kw) => labels.includes(kw)).length;

  if (state?.currentView) {
    const viewId = state.currentView.id.toLowerCase();
    if (['cart', 'checkout', 'product'].some((kw) => viewId.includes(kw))) {
      return { domain: 'e-commerce', confidence: 0.6, evidence: emptyEvidence(), alternative: null, margin: 0 };
    }
    if (['login', 'register', 'account'].some((kw) => viewId.includes(kw))) {
      return { domain: 'authentication', confidence: 0.6, evidence: emptyEvidence(), alternative: null, margin: 0 };
    }
  }

  if (ecommerceScore >= 2 && ecommerceScore > authScore) {
    return { domain: 'e-commerce', confidence: 0.5, evidence: emptyEvidence(), alternative: null, margin: 0 };
  }
  if (authScore >= 2) {
    return { domain: 'authentication', confidence: 0.5, evidence: emptyEvidence(), alternative: null, margin: 0 };
  }

  return { domain: 'unknown', confidence: 0, evidence: emptyEvidence(), alternative: null, margin: 0 };
}

function emptyEvidence(): SemanticKnowledge['domain']['evidence'] {
  return {
    viewPatternScore: 0,
    entityTypeScore: 0,
    apiOperationScore: 0,
    notificationKeywordScore: 0,
    urlStructureScore: 0,
    matchedSignals: [],
  };
}

function computeMetadata(
  interactions: ComponentInteraction[],
  workflows: SemanticWorkflow[],
  surface: SemanticKnowledge['surface'],
  intents: { interactionId: string; confidence: number }[],
  contracts: { interactionId: string }[],
): EnrichmentMetadata {
  const inputCount = interactions.length;
  const contractCoverage = inputCount > 0
    ? contracts.length / inputCount
    : 0;
  const intentCoverage = inputCount > 0
    ? intents.filter((i) => i.confidence >= 0.5).length / inputCount
    : 0;
  const componentCoverage = inputCount > 0
    ? inputCount / Math.max(inputCount, 1)
    : 0;

  const coverage: EnrichmentCoverage = {
    intentCoverage: Math.round(intentCoverage * 1000) / 1000,
    componentCoverage: Math.round(componentCoverage * 1000) / 1000,
    contractCoverage: Math.round(contractCoverage * 1000) / 1000,
  };

  return {
    enricherVersion: ENRICHER_VERSION,
    generatedAt: Date.now(),
    interactionCount: inputCount,
    workflowCount: workflows.length,
    viewCount: surface.views.length,
    coverage,
  };
}
