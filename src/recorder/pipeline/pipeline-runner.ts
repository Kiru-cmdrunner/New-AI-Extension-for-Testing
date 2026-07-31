/**
 * Pipeline Runner — orchestrates the post-recording analysis pipeline.
 *
 * Called from the service worker's STOP_RECORDING handler after V1/V2
 * classification completes. Runs the full pipeline:
 *
 *   1. Domain adapter: RecordedEvent[] + DetectedInteraction[] → UiElement[] + ObservedTransition[]
 *   2. Recognition orchestrator: processes each transition, produces ComponentGrouping[]
 *   3. Enrichment orchestrator: enriches entities into ApplicationKnowledgeFragment
 *   4. Persists results to chrome.storage
 *
 * The generation engine runs separately (it reads from storage and has its own
 * state machine). The pipeline runner focuses on the analysis layers.
 *
 * Milestone 6.3-6.4 — Phase 6 wiring.
 */

import { adaptToDomainEntities } from './domain-adapter';
import { adaptToDomainEntitiesV2 } from '../v2/domain-adapter-v2';
import type { DomainEntities } from './domain-adapter';
import { processInteraction, type OrchestratorInput } from '../recognition/orchestrator';
import type { ElementRoleInfo } from '../recognition/structural-recognizer';
import { ComponentRegistry } from '../recognition/component-registry';
import { enrichSession } from '../enrichment/enrichment-orchestrator';
import type { DomInspector } from '../enrichment/dom-inspector';
import type { UiElement } from '../../domain/entities/ui-element';
import type { ObservedTransition } from '../../domain/entities/observed-transition';
import type { ComponentGrouping } from '../../domain/entities/component-grouping';
import type { RecordedEvent } from '../recorded-event';
import type { ComponentInteraction } from '../../shared/component-types';
import type { ApplicationKnowledgeFragment } from '../../domain/entities/application-knowledge';
import type { CapabilityCandidate } from '../../domain/entities/capability-candidate';
import { deriveCapability } from '../enrichment/capability-deriver';

// ── Types ───────────────────────────────────────────────────────────────

export interface PipelineResult {
  entities: DomainEntities;
  components: ComponentGrouping[];
  fragment: ApplicationKnowledgeFragment | null;
  capability: CapabilityCandidate | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build an ElementRoleInfo from a UiElement's identity.
 */
function toRoleInfo(element: UiElement): ElementRoleInfo {
  return {
    elementId: element.elementId,
    ariaRole: element.identity.ariaRole,
    tag: element.identity.tag,
  };
}

/**
 * Create a no-op DomInspector for the service worker context.
 *
 * The enrichment pipeline's DomInspector is used for option set extraction
 * (reading options from the DOM at enrichment time). In the service worker,
 * we don't have access to the page DOM. The option-set-extractor gracefully
 * handles null returns from the inspector — it just skips option enrichment.
 *
 * A future enhancement could inject a content script to query the DOM,
 * but the pipeline produces valuable results without it.
 */
function createNoOpDomInspector(): DomInspector {
  return {
    querySelector: (_elementId: string) => null,
    querySelectorAll: (_parentId: string, _selector: string) => [],
  };
}

/**
 * Run the recognition orchestrator over all transitions.
 *
 * Processes each transition chronologically, feeding the orchestrator with
 * element info, ancestor chain, and accumulated transitions.
 */
function runRecognition(
  entities: DomainEntities,
): ComponentGrouping[] {
  const registry = new ComponentRegistry();
  const elementMap = new Map(entities.elements.map((e) => [e.elementId, e]));
  const transitionsByElement = new Map<string, ObservedTransition[]>();

  // Group transitions by element for behavioral recognition context
  for (const transition of entities.transitions) {
    const existing = transitionsByElement.get(transition.elementId) ?? [];
    existing.push(transition);
    transitionsByElement.set(transition.elementId, existing);
  }

  // Process each transition chronologically
  for (const transition of entities.transitions) {
    const element = elementMap.get(transition.elementId);
    if (!element) {
      // Navigation transitions have elementId '__page__' — skip recognition
      continue;
    }

    const roleInfo = toRoleInfo(element);

    // Collect related transitions for behavioral recognition
    const relatedTransitions = transitionsByElement.get(transition.elementId) ?? [];

    const input: OrchestratorInput = {
      element: roleInfo,
      ancestorRoles: [roleInfo], // At minimum, include the target itself
      relatedElementIds: [],
      transitions: relatedTransitions.filter((t) => t.transitionId !== transition.transitionId),
      currentTransition: transition,
    };

    try {
      processInteraction(input, registry);
    } catch {
      // Recognition failures are non-fatal — the transition is still valid
      // as a standalone interaction
    }
  }

  return registry.getActive();
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Run the full analysis pipeline on a recorded session.
 *
 * @param events - Recorded events from the deterministic recorder.
 * @param interactions - Detected interactions from the V1/V2 classifier.
 * @param sessionId - Session identifier for the fragment.
 * @param sourceUrl - URL of the recorded page.
 * @param engine - 'control' to use interaction-centric domain adapter, 'legacy' for event-centric
 * @returns Pipeline results including entities, components, and fragment.
 */
export function runPipeline(
  events: RecordedEvent[],
  interactions: ComponentInteraction[],
  sessionId: string,
  sourceUrl?: string,
  engine?: 'legacy' | 'control',
): PipelineResult {
  // ── Step 1: Domain Adapter ──
  const entities =
    engine === 'control'
      ? adaptToDomainEntitiesV2(events, interactions, sourceUrl ?? 'about:blank')
      : adaptToDomainEntities(events, interactions, sourceUrl);

  // ── Step 2: Recognition ──
  const components = runRecognition(entities);

  // ── Step 3: Enrichment ──
  let fragment: ApplicationKnowledgeFragment | null = null;
  try {
    fragment = enrichSession({
      sessionId,
      elements: entities.elements,
      transitions: entities.transitions,
      components,
      domInspector: createNoOpDomInspector(),
    });
  } catch {
    // Enrichment failures are non-fatal — entities and components are still valid
    fragment = null;
  }

  // ── Step 4: Capability Derivation ──
  let capability: CapabilityCandidate | null = null;
  if (fragment) {
    try {
      const result = deriveCapability({ fragment, sessionId });
      capability = result.capability;
    } catch {
      // Capability derivation failures are non-fatal
      capability = null;
    }
  }

  return {
    entities,
    components,
    fragment,
    capability,
  };
}
