/**
 * M9.5 - Knowledge Repository
 *
 * Provides CRUD + accumulation operations for all knowledge tables.
 * All operations are idempotent or merge-based.
 *
 * Architecture: .drytis/specs/m9-5-knowledge-persistence.md
 */

import type { KnowledgeDatabase } from './knowledge-database';
import type {
  ApplicationRow,
  KnowledgeEntityRow,
  KnowledgeEntityStateChange,
  KnowledgeViewRow,
  KnowledgeViewTransitionRow,
  KnowledgeCollectionRow,
  KnowledgeCounterRow,
  KnowledgeNotificationRow,
  KnowledgeOutcomeRow,
  KnowledgeStateTransitionRow,
  KnowledgeCounterEntry,
  KnowledgeRecordedWorkflowRow,
} from './knowledge-types';
import {
  MAX_COUNTER_HISTORY,
  MAX_NOTIFICATIONS_PER_APP,
  MAX_TRANSITIONS_PER_SESSION,
  MAX_WORKFLOW_INSTANCES,
} from './knowledge-types';

// -- Helpers --

function hashKey(...parts: string[]): string {
  // Simple hash for composite keys
  return parts.join(':');
}

// -- Repository --

export class KnowledgeRepository {
  constructor(private readonly db: KnowledgeDatabase) {}

  // -- Applications --

  /**
   * Upsert application. Session-guarded: re-persist of the SAME session
   * does not increment sessionCount.
   */
  async upsertApplication(app: ApplicationRow): Promise<void> {
    const existing = await this.db.applications.get(app.appId);
    if (existing) {
      const sameSession = existing.lastSessionId === app.lastSessionId;
      await this.db.applications.put({
        ...existing,
        lastActiveAt: app.lastActiveAt,
        lastSessionId: app.lastSessionId,
        sessionCount: sameSession ? existing.sessionCount : existing.sessionCount + 1,
      });
    } else {
      await this.db.applications.put({
        ...app,
        sessionCount: 1,
      });
    }
  }

  async getApplication(appId: string): Promise<ApplicationRow | undefined> {
    return this.db.applications.get(appId);
  }

  async getApplicationByOrigin(origin: string): Promise<ApplicationRow | undefined> {
    return this.db.applications.where('origin').equals(origin).first();
  }

  // -- Entities --

  /**
   * Upsert entity: merge attributes, bump revision, update lastSeenAt.
   * Session-guarded: re-persist of the SAME session never re-merges.
   */
  async upsertEntity(entity: KnowledgeEntityRow): Promise<void> {
    const existing = await this.db.knowledgeEntities.get(entity.key);
    if (existing) {
      const sameSession = existing.lastSessionId === entity.lastSessionId;
      await this.db.knowledgeEntities.put({
        ...existing,
        attributes: sameSession
          ? existing.attributes
          : { ...existing.attributes, ...entity.attributes },
        lastSeenAt: sameSession ? existing.lastSeenAt : entity.lastSeenAt,
        lastSessionId: entity.lastSessionId,
        revision: sameSession ? existing.revision : existing.revision + 1,
        // M9.9: carry through lifecycle state from the new observation.
        // When sameSession, keep the existing state (already current for this session).
        // Otherwise take the new entity's state if provided.
        currentState: sameSession
          ? existing.currentState
          : (entity.currentState ?? existing.currentState),
        stateHistory: sameSession
          ? existing.stateHistory
          : mergeStateHistory(existing.stateHistory, entity.stateHistory),
        // D5: merge viewIds across sessions
        viewIds: sameSession
          ? existing.viewIds
          : mergeStringArrays(existing.viewIds, entity.viewIds),
      });
    } else {
      await this.db.knowledgeEntities.put(entity);
    }
  }

  async getEntities(appId: string): Promise<KnowledgeEntityRow[]> {
    return this.db.knowledgeEntities.where('appId').equals(appId).toArray();
  }

  async getEntitiesByType(appId: string, type: string): Promise<KnowledgeEntityRow[]> {
    return this.db.knowledgeEntities
      .where('[appId+type]')
      .equals([appId, type])
      .toArray();
  }

  // -- Views --

  async upsertView(view: KnowledgeViewRow): Promise<void> {
    const existing = await this.db.knowledgeViews.get(view.key);
    if (existing) {
      const sameSession = existing.lastSessionId === view.lastSessionId;
      await this.db.knowledgeViews.put({
        ...existing,
        visitCount: sameSession ? existing.visitCount : existing.visitCount + 1,
        lastSeenAt: view.lastSeenAt,
        lastSessionId: view.lastSessionId,
      });
    } else {
      await this.db.knowledgeViews.put(view);
    }
  }

  async getViews(appId: string): Promise<KnowledgeViewRow[]> {
    return this.db.knowledgeViews.where('appId').equals(appId).toArray();
  }

  // -- View Transitions --

  async upsertViewTransition(transition: KnowledgeViewTransitionRow): Promise<void> {
    const existing = await this.db.knowledgeViewTransitions.get(transition.key);
    if (existing) {
      const sameSession = existing.lastSessionId === transition.lastSessionId;
      await this.db.knowledgeViewTransitions.put({
        ...existing,
        count: sameSession ? existing.count : existing.count + 1,
        lastSeenAt: transition.lastSeenAt,
        lastSessionId: transition.lastSessionId,
      });
    } else {
      await this.db.knowledgeViewTransitions.put(transition);
    }
  }

  async getViewTransitions(appId: string): Promise<KnowledgeViewTransitionRow[]> {
    return this.db.knowledgeViewTransitions.where('appId').equals(appId).toArray();
  }

  // -- Collections --

  async upsertCollection(coll: KnowledgeCollectionRow): Promise<void> {
    const existing = await this.db.knowledgeCollections.get(coll.key);
    if (existing) {
      await this.db.knowledgeCollections.put({
        ...existing,
        currentCount: coll.currentCount,
        maxCount: Math.max(existing.maxCount, coll.currentCount),
        lastUpdated: coll.lastUpdated,
        lastSessionId: coll.lastSessionId,
      });
    } else {
      await this.db.knowledgeCollections.put(coll);
    }
  }

  async getCollections(appId: string): Promise<KnowledgeCollectionRow[]> {
    return this.db.knowledgeCollections.where('appId').equals(appId).toArray();
  }

  // -- Counters --

  /**
   * Append a counter observation to its history.
   * Bounded: keep last MAX_COUNTER_HISTORY values.
   * Session-guarded: re-persist of the SAME session-value never duplicates.
   */
  async appendCounter(
    appId: string,
    counterId: string,
    label: string,
    elementPath: string,
    entry: KnowledgeCounterEntry,
  ): Promise<void> {
    const key = hashKey(appId, counterId);
    const existing = await this.db.knowledgeCounters.get(key);

    if (existing && existing.lastSessionId === entry.sessionId && existing.currentValue === entry.value) {
      // Same session + same value already persisted — skip.
      return;
    }

    const history = existing ? [...existing.history] : [];

    // Session-guarded dedup: only append if (sessionId, value) not already in history.
    const alreadyLogged = history.some(
      (h) => h.sessionId === entry.sessionId && h.value === entry.value,
    );
    if (!alreadyLogged) {
      history.push(entry);
      // Bound: trim from front
      if (history.length > MAX_COUNTER_HISTORY) {
        history.splice(0, history.length - MAX_COUNTER_HISTORY);
      }
    }

    await this.db.knowledgeCounters.put({
      key,
      appId,
      counterId,
      label,
      elementPath,
      currentValue: entry.value,
      history,
      lastUpdated: entry.observedAt,
      lastSessionId: entry.sessionId,
    });
  }

  async getCounters(appId: string): Promise<KnowledgeCounterRow[]> {
    return this.db.knowledgeCounters.where('appId').equals(appId).toArray();
  }

  // -- Notifications --

  /**
   * Add a notification if not already present (dedup by hash).
   * Bounded: cap at MAX_NOTIFICATIONS_PER_APP per app.
   */
  async addNotification(notif: KnowledgeNotificationRow): Promise<void> {
    // Dedup: check if this exact notification exists
    const existing = await this.db.knowledgeNotifications.get(notif.key);
    if (existing) return;

    // Enforce cap: if at limit, remove oldest
    const appNotifs = await this.db.knowledgeNotifications
      .where('appId')
      .equals(notif.appId)
      .toArray();

    if (appNotifs.length >= MAX_NOTIFICATIONS_PER_APP) {
      // Sort by appearedAt ascending, remove oldest
      appNotifs.sort((a, b) => a.appearedAt - b.appearedAt);
      const toRemove = appNotifs.slice(0, appNotifs.length - MAX_NOTIFICATIONS_PER_APP + 1);
      await this.db.knowledgeNotifications.bulkDelete(toRemove.map((n) => n.key));
    }

    await this.db.knowledgeNotifications.put(notif);
  }

  async getNotifications(appId: string): Promise<KnowledgeNotificationRow[]> {
    return this.db.knowledgeNotifications.where('appId').equals(appId).toArray();
  }

  // -- Outcomes --

  /**
   * Put an outcome. Idempotent by (sessionId:interactionId) key.
   * Recompute replaces the previous outcome for that interaction.
   */
  async putOutcome(outcome: KnowledgeOutcomeRow): Promise<void> {
    await this.db.knowledgeOutcomes.put(outcome);
  }

  async getOutcomes(sessionId: string): Promise<KnowledgeOutcomeRow[]> {
    const all = await this.db.knowledgeOutcomes.toArray();
    return all.filter((o) => o.sessionId === sessionId);
  }

  async getOutcomesByApp(appId: string): Promise<KnowledgeOutcomeRow[]> {
    return this.db.knowledgeOutcomes.where('appId').equals(appId).toArray();
  }

  // -- State Transitions --

  /**
   * Add a state transition. Bounded: keep last MAX_TRANSITIONS_PER_SESSION.
   */
  async addStateTransition(transition: KnowledgeStateTransitionRow): Promise<void> {
    const sessionTransitions = await this.db.knowledgeStateTransitions
      .where('sessionId')
      .equals(transition.sessionId)
      .toArray();

    if (sessionTransitions.length >= MAX_TRANSITIONS_PER_SESSION) {
      // Remove oldest beyond cap
      sessionTransitions.sort((a, b) => a.timestamp - b.timestamp);
      const toRemove = sessionTransitions.slice(0, sessionTransitions.length - MAX_TRANSITIONS_PER_SESSION + 1);
      await this.db.knowledgeStateTransitions.bulkDelete(toRemove.map((t) => t.key));
    }

    await this.db.knowledgeStateTransitions.put(transition);
  }

  async getStateTransitions(sessionId: string): Promise<KnowledgeStateTransitionRow[]> {
    return this.db.knowledgeStateTransitions.where('sessionId').equals(sessionId).toArray();
  }

  // -- Recorded Workflows (DDC-4) --

  /**
   * Upsert a recorded workflow pattern (merge by patternId).
   * Merge semantics: union sessionIds, union instances (bounded),
   * occurrenceCount = existing + new occurrences observed THIS call
   * (row.occurrenceCount counts THIS call's observations), keep newer
   * label/steps.
   */
  async upsertRecordedWorkflow(row: KnowledgeRecordedWorkflowRow): Promise<void> {
    const existing = await this.db.knowledgeRecordedWorkflows.get(row.key);
    if (existing) {
      const sessionIds = [...new Set([...existing.sessionIds, ...row.sessionIds])];
      const instances = [...existing.instances, ...row.instances]
        .filter((v, i, a) => a.indexOf(v) === i) // dedup instances
        .slice(-MAX_WORKFLOW_INSTANCES);
      await this.db.knowledgeRecordedWorkflows.put({
        ...existing,
        label: row.label || existing.label,
        canonicalSteps: row.canonicalSteps.length > 0 ? row.canonicalSteps : existing.canonicalSteps,
        viewSequence: row.viewSequence.length > 0 ? row.viewSequence : existing.viewSequence,
        sessionIds,
        occurrenceCount: existing.occurrenceCount + row.occurrenceCount,
        instances,
        lastSeenAt: Math.max(existing.lastSeenAt, row.lastSeenAt),
      });
    } else {
      await this.db.knowledgeRecordedWorkflows.put({
        ...row,
        instances: [...new Set(row.instances)].slice(-MAX_WORKFLOW_INSTANCES),
      });
    }
  }

  async getRecordedWorkflows(appId: string): Promise<KnowledgeRecordedWorkflowRow[]> {
    return this.db.knowledgeRecordedWorkflows.where('appId').equals(appId).toArray();
  }

  // -- Cleanup --

  /**
   * Delete all outcomes and state transitions for a session.
   * Accumulated knowledge (entities, views, counters) SURVIVES.
   */
  async deleteBySession(sessionId: string): Promise<void> {
    const outcomes = await this.db.knowledgeOutcomes.toArray();
    const sessionOutcomes = outcomes.filter((o) => o.sessionId === sessionId);
    await this.db.knowledgeOutcomes.bulkDelete(sessionOutcomes.map((o) => o.key));

    const transitions = await this.db.knowledgeStateTransitions
      .where('sessionId')
      .equals(sessionId)
      .toArray();
    await this.db.knowledgeStateTransitions.bulkDelete(transitions.map((t) => t.key));
  }

  /**
   * Delete ALL knowledge for an app (full teardown).
   */
  async deleteByApp(appId: string): Promise<void> {
    await Promise.all([
      this.db.knowledgeEntities.where('appId').equals(appId).delete(),
      this.db.knowledgeViews.where('appId').equals(appId).delete(),
      this.db.knowledgeViewTransitions.where('appId').equals(appId).delete(),
      this.db.knowledgeCollections.where('appId').equals(appId).delete(),
      this.db.knowledgeCounters.where('appId').equals(appId).delete(),
      this.db.knowledgeNotifications.where('appId').equals(appId).delete(),
      this.db.knowledgeOutcomes.where('appId').equals(appId).delete(),
      this.db.knowledgeStateTransitions.where('appId').equals(appId).delete(),
      this.db.knowledgeRecordedWorkflows.where('appId').equals(appId).delete(),
      this.db.applications.where('appId').equals(appId).delete(),
    ]);
  }

  /**
   * Get a summary of stored knowledge for an app.
   */
  async getAppSummary(appId: string): Promise<{
    entities: number;
    views: number;
    transitions: number;
    collections: number;
    counters: number;
    notifications: number;
    outcomes: number;
  }> {
    const [entities, views, transitions, collections, counters, notifications, outcomes] = await Promise.all([
      this.db.knowledgeEntities.where('appId').equals(appId).count(),
      this.db.knowledgeViews.where('appId').equals(appId).count(),
      this.db.knowledgeViewTransitions.where('appId').equals(appId).count(),
      this.db.knowledgeCollections.where('appId').equals(appId).count(),
      this.db.knowledgeCounters.where('appId').equals(appId).count(),
      this.db.knowledgeNotifications.where('appId').equals(appId).count(),
      this.db.knowledgeOutcomes.where('appId').equals(appId).count(),
    ]);

    return { entities, views, transitions, collections, counters, notifications, outcomes };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Merge two state histories, appending only transitions from `incoming`
 * whose `to` differs from the last transition in `existing`.
 * Deduplicates by (from → to) pair when identical evidence text.
 *
 * M9.9
 */
function mergeStateHistory(
  existing: KnowledgeEntityStateChange[] | undefined,
  incoming: KnowledgeEntityStateChange[] | undefined,
): KnowledgeEntityStateChange[] | undefined {
  if (!incoming || incoming.length === 0) return existing;
  if (!existing || existing.length === 0) return incoming;

  const merged = [...existing];
  for (const change of incoming) {
    const last = merged[merged.length - 1];
    if (last && last.to === change.to && last.from === change.from) {
      // Skip duplicate of the last transition.
      continue;
    }
    merged.push(change);
  }
  return merged;
}

/**
 * Merge two string arrays, deduplicating the result. D5.
 */
function mergeStringArrays(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] | undefined {
  if (!incoming || incoming.length === 0) return existing;
  if (!existing || existing.length === 0) return incoming;
  const merged = new Set([...existing, ...incoming]);
  return Array.from(merged);
}
