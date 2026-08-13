/**
 * M9.6 — Consistency Checker
 *
 * Validates consistency between in-memory ApplicationState (M9.2) and
 * persisted knowledge (M9.5) for the same app/session.
 *
 * READ-ONLY: compares two read models, writes nothing.
 *
 * Architecture: .drytis/specs/m9-6-knowledge-consolidation.md
 */

import type { ApplicationState } from '../state-builder/types';
import type { ApplicationKnowledge } from './application-knowledge';
import type { ConsistencyGap } from './application-knowledge';

export class ConsistencyChecker {
  /**
   * Compare in-memory ApplicationState entity/view IDs against the
   * persisted knowledge. Reports new items (in state but not persisted)
   * and missing items (persisted but not in state).
   *
   * @param state Current in-memory ApplicationState.
   * @param knowledge Persisted ApplicationKnowledge (from KnowledgeLoader).
   */
  check(
    state: ApplicationState,
    knowledge: ApplicationKnowledge | null,
  ): ConsistencyGap {
    if (!knowledge) {
      return {
        newEntities: [...state.entities.keys()],
        missingEntities: [],
        newViews: state.currentView ? [state.currentView.id] : [],
        missingViews: [],
        isConsistent: false,
        detail: 'No persisted knowledge to compare against.',
      };
    }

    const stateEntityIds = new Set(state.entities.keys());
    const persistedEntityIds = new Set(knowledge.entities.map((e) => e.entityId));

    const newEntities = [...stateEntityIds].filter((id) => !persistedEntityIds.has(id));
    const missingEntities = [...persistedEntityIds].filter((id) => !stateEntityIds.has(id));

    const stateViewIds = new Set<string>();
    if (state.currentView) stateViewIds.add(state.currentView.id);
    const persistedViewIds = new Set(knowledge.views.map((v) => v.viewId));

    const newViews = [...stateViewIds].filter((id) => !persistedViewIds.has(id));
    const missingViews = [...persistedViewIds].filter((id) => !stateViewIds.has(id));

    const isConsistent =
      newEntities.length === 0 &&
      missingEntities.length === 0 &&
      newViews.length === 0 &&
      missingViews.length === 0;

    const parts: string[] = [];
    if (newEntities.length > 0) parts.push(`${newEntities.length} new entities in state`);
    if (missingEntities.length > 0) parts.push(`${missingEntities.length} persisted entities not in state`);
    if (newViews.length > 0) parts.push(`${newViews.length} new views in state`);
    if (missingViews.length > 0) parts.push(`${missingViews.length} persisted views not in state`);

    return {
      newEntities,
      missingEntities,
      newViews,
      missingViews,
      isConsistent,
      detail: isConsistent
        ? 'In-memory state is consistent with persisted knowledge.'
        : `Inconsistencies: ${parts.join(', ')}.`,
    };
  }
}
