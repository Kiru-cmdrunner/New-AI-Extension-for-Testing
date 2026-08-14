/**
 * M9.6 — Knowledge Preloader
 *
 * Converts persisted ApplicationKnowledge into a StateBuilderSeed that
 * StateBuilder can consume at session start, enabling cross-session
 * entity recognition and view continuity.
 *
 * READ-ONLY: reads ApplicationKnowledge, writes nothing.
 *
 * Architecture: .drytis/specs/m9-6-knowledge-consolidation.md
 */

import type {
  PriorSessionCounter,
  PriorSessionEntity,
  PriorSessionView,
  StateBuilderSeed,
} from './application-knowledge';
import type { KnowledgeLoader } from './knowledge-loader';

export class KnowledgePreloader {
  constructor(private readonly loader: KnowledgeLoader) {}

  /**
   * Build a seed from prior-session knowledge for an app.
   * Returns an empty seed (hasPriorKnowledge=false) if no prior knowledge exists.
   *
   * Only high-confidence entities/views are preloaded to avoid seeding
   * stale or tentative knowledge.
   */
  async buildSeed(appId: string): Promise<StateBuilderSeed> {
    const knowledge = await this.loader.load(appId);
    if (!knowledge || knowledge.entities.length === 0 && knowledge.views.length === 0) {
      return {
        entities: new Map(),
        views: new Map(),
        counters: new Map(),
        hasPriorKnowledge: false,
      };
    }

    const entities = new Map<string, PriorSessionEntity>();
    const views = new Map<string, PriorSessionView>();
    const counters = new Map<string, PriorSessionCounter>();

    // Preload entities with confidence >= medium.
    for (const entity of knowledge.entities) {
      if (entity.confidence.level === 'low') continue;
      entities.set(entity.entityId, {
        id: entity.entityId,
        type: entity.type,
        attributes: { ...entity.attributes },
        source: entity.source,
        provenance: 'prior-session',
        viewIds: entity.viewIds,
      });
    }

    // Preload views with confidence >= low (views are more stable).
    for (const view of knowledge.views) {
      views.set(view.viewId, {
        id: view.viewId,
        label: view.label,
        detectedFrom: view.detectedFrom as 'url-pattern' | 'dom-signature',
        provenance: 'prior-session',
      });
    }

    // Preload counters with their latest known value.
    for (const counter of knowledge.counters) {
      counters.set(counter.counterId, {
        id: counter.counterId,
        label: counter.label,
        elementPath: counter.elementPath,
        lastKnownValue: counter.currentValue,
        provenance: 'prior-session',
      });
    }

    return {
      entities,
      views,
      counters,
      hasPriorKnowledge: entities.size > 0 || views.size > 0 || counters.size > 0,
    };
  }
}
