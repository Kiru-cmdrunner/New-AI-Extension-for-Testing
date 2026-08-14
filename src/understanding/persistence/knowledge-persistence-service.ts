/**
 * M9.5 - Knowledge Persistence Service
 *
 * Translates in-memory M9.2/M9.3/M9.4 application state into persisted
 * knowledge rows. Called at recording-session end (stopRecording).
 *
 * Key responsibility: convert the in-memory ApplicationState (Maps, typed
 * unions) into flat row types suitable for Dexie, accumulate knowledge
 * across sessions, and enforce bounded growth.
 *
 * Architecture: .drytis/specs/m9-5-knowledge-persistence.md
 */

import type { KnowledgeRepository } from './knowledge-repository';
import type {
  KnowledgeCounterEntry,
} from './knowledge-types';
import type { ApplicationState } from '../state-builder/types';
import type { ActionOutcome } from '../outcome/outcome-types';
import type { StateTransition } from '../state-builder/types';

/**
 * Input for persisting a session's knowledge.
 */
export interface KnowledgePersistenceInput {
  /** App origin (e.g., 'https://www.amazon.com'). */
  origin: string;
  /** Project ID (soft reference). */
  projectId: string;
  /** Recording session ID. */
  recordingSessionId: string;
  /** Final accumulated application state from StateBuilder. */
  applicationState: ApplicationState;
  /** All state transitions from the session. */
  transitions: StateTransition[];
  /** All determined outcomes from the session. */
  outcomes: ActionOutcome[];
}

/**
 * Derives a stable appId from origin using a simple hash.
 */
export function deriveAppId(origin: string): string {
  let hash = 0;
  for (let i = 0; i < origin.length; i++) {
    hash = ((hash << 5) - hash + origin.charCodeAt(i)) | 0;
  }
  return `app-${Math.abs(hash).toString(36)}`;
}

export class KnowledgePersistenceService {
  /** Transitions from the current persist() call — available to helper methods. */
  private sessionTransitions: StateTransition[] = [];

  constructor(private readonly repo: KnowledgeRepository) {}

  /**
   * Persist all knowledge from a recording session.
   * This is the main entry point, called at stopRecording.
   */
  async persist(input: KnowledgePersistenceInput): Promise<void> {
    const appId = deriveAppId(input.origin);
    const now = Date.now();
    this.sessionTransitions = input.transitions;

    // 1. Application row
    await this.upsertApplication(appId, input.origin, input.recordingSessionId, now);

    // 2. Views
    await this.persistViews(appId, input.applicationState, input.recordingSessionId, now);

    // 3. View transitions (from state transitions)
    await this.persistViewTransitions(appId, input.transitions, input.recordingSessionId, now);

    // 4. Entities
    await this.persistEntities(appId, input.applicationState, input.recordingSessionId, now);

    // 5. Collections
    await this.persistCollections(appId, input.applicationState, input.recordingSessionId, now);

    // 6. Counters
    await this.persistCounters(appId, input.applicationState, input.recordingSessionId, now);

    // 7. Notifications
    await this.persistNotifications(appId, input.applicationState, input.recordingSessionId, now);

    // 8. Outcomes
    await this.persistOutcomes(appId, input.outcomes, input.recordingSessionId, now);

    // 9. State transitions
    await this.persistStateTransitions(appId, input.transitions, input.recordingSessionId, now);
  }

  // -- Application --

  private async upsertApplication(
    appId: string,
    origin: string,
    sessionId: string,
    now: number,
  ): Promise<void> {
    const existing = await this.repo.getApplication(appId);
    const label = origin.replace(/^https?:\/\//, '').split('/')[0];
    await this.repo.upsertApplication({
      appId,
      origin,
      label,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastActiveAt: now,
      sessionCount: 0,
      lastSessionId: sessionId,
    });
  }

  // -- Views --

  private async persistViews(
    appId: string,
    state: ApplicationState,
    sessionId: string,
    now: number,
  ): Promise<void> {
    // Collect all views seen: current + all views referenced in transitions
    const views = new Map<string, { id: string; label: string; detectedFrom: string }>();
    if (state.currentView) {
      views.set(state.currentView.id, {
        id: state.currentView.id,
        label: state.currentView.label,
        detectedFrom: state.currentView.detectedFrom,
      });
    }
    for (const t of this.sessionTransitions) {
      for (const v of [t.before.currentView, t.after.currentView]) {
        if (v && !views.has(v.id)) {
          views.set(v.id, { id: v.id, label: v.label, detectedFrom: v.detectedFrom });
        }
      }
    }
    for (const view of views.values()) {
      await this.repo.upsertView({
        key: `${appId}:${view.id}`,
        appId,
        viewId: view.id,
        label: view.label,
        detectedFrom: view.detectedFrom,
        firstSeenAt: now,
        lastSeenAt: now,
        visitCount: 1,
        lastSessionId: sessionId,
      });
    }
  }

  // -- View Transitions --

  private async persistViewTransitions(
    appId: string,
    transitions: StateTransition[],
    sessionId: string,
    now: number,
  ): Promise<void> {
    for (const t of transitions) {
      const fromViewId = t.before.currentView?.id;
      const toViewId = t.after.currentView?.id;
      if (!fromViewId || !toViewId || fromViewId === toViewId) continue;

      await this.repo.upsertViewTransition({
        key: `${appId}:${fromViewId}->${toViewId}`,
        appId,
        fromViewId,
        toViewId,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        lastSessionId: sessionId,
      });
    }
  }

  // -- Entities --

  private async persistEntities(
    appId: string,
    state: ApplicationState,
    sessionId: string,
    now: number,
  ): Promise<void> {
    for (const entity of state.entities.values()) {
      await this.repo.upsertEntity({
        key: `${appId}:${entity.id}`,
        appId,
        entityId: entity.id,
        type: entity.type,
        attributes: { ...entity.attributes },
        source: entity.source,
        firstSeenAt: now,
        lastSeenAt: now,
        revision: 1,
        lastSessionId: sessionId,
        currentState: entity.currentState,
        stateHistory: entity.stateHistory?.map((h) => ({
          from: h.from,
          to: h.to,
          changedAt: h.changedAt,
          evidence: h.evidence,
        })),
        viewIds: entity.viewIds,
      });
    }
  }

  // -- Collections --

  private async persistCollections(
    appId: string,
    state: ApplicationState,
    sessionId: string,
    now: number,
  ): Promise<void> {
    for (const coll of state.collections.values()) {
      const count = coll.count ?? 0;
      await this.repo.upsertCollection({
        key: `${appId}:${coll.id}`,
        appId,
        collectionId: coll.id,
        entityType: coll.entityType,
        currentCount: count,
        maxCount: count,
        lastUpdated: now,
        lastSessionId: sessionId,
      });
    }
  }

  // -- Counters --

  private async persistCounters(
    appId: string,
    state: ApplicationState,
    sessionId: string,
    now: number,
  ): Promise<void> {
    for (const counter of state.counters.values()) {
      for (const valueEntry of counter.values) {
        const entry: KnowledgeCounterEntry = {
          value: valueEntry.value,
          observedAt: now,
          sessionId,
          delta: valueEntry.delta,
        };
        await this.repo.appendCounter(
          appId,
          counter.id,
          counter.label,
          counter.elementPath,
          entry,
        );
      }
    }
  }

  // -- Notifications --

  private async persistNotifications(
    appId: string,
    state: ApplicationState,
    sessionId: string,
    now: number,
  ): Promise<void> {
    for (const notif of state.notifications) {
      const key = `${appId}:${notif.id}`;
      await this.repo.addNotification({
        key,
        appId,
        text: notif.text,
        severity: notif.severity,
        elementPath: notif.elementPath,
        appearedAt: now,
        sessionId,
      });
    }
  }

  // -- Outcomes --

  private async persistOutcomes(
    appId: string,
    outcomes: ActionOutcome[],
    sessionId: string,
    now: number,
  ): Promise<void> {
    for (const outcome of outcomes) {
      await this.repo.putOutcome({
        key: `${sessionId}:${outcome.interactionId}`,
        appId,
        sessionId,
        interactionId: outcome.interactionId,
        actionType: outcome.actionType,
        actionTarget: outcome.actionTarget,
        outcome: outcome.outcome,
        confidence: outcome.confidence,
        confidenceLevel: outcome.confidenceLevel,
        evidence: outcome.supportingEvidence.map((e) => ({
          kind: e.kind,
          result: e.result,
          weight: e.weight,
          detail: e.detail,
        })),
        resultingEntities: outcome.resultingEntities,
        persistedAt: now,
      });
    }
  }

  // -- State Transitions --

  private async persistStateTransitions(
    appId: string,
    transitions: StateTransition[],
    sessionId: string,
    now: number,
  ): Promise<void> {
    for (const t of transitions) {
      const affectedEntities: string[] = [];
      for (const [id, entity] of t.after.entities) {
        if (!t.before.entities.has(id)) {
          affectedEntities.push(id);
        } else if (t.before.entities.get(id)?.lastUpdated !== entity.lastUpdated) {
          affectedEntities.push(id);
        }
      }

      await this.repo.addStateTransition({
        key: `${sessionId}:${t.interactionId}`,
        appId,
        sessionId,
        interactionId: t.interactionId,
        changes: [...t.changes],
        fromViewId: t.before.currentView?.id ?? null,
        toViewId: t.after.currentView?.id ?? null,
        affectedEntities,
        timestamp: now,
      });
    }
  }
}
