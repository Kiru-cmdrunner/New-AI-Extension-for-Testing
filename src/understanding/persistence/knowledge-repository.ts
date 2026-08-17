/**
 * M9.5 - Knowledge Repository
 *
 * Provides CRUD + accumulation operations for all knowledge tables.
 * All operations are idempotent or merge-based.
 *
 * Architecture: .drytis/specs/m9-5-knowledge-persistence.md
 */

import type { KnowledgeDatabase } from './knowledge-database';
import Dexie from 'dexie';
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
  KnowledgeBehaviorSessionRow,
  KnowledgeEpisodeRow,
  KnowledgeEdgeRow,
  KnowledgeGapRow,
  KnowledgeActionSignatureRow,
} from './knowledge-types';
import {
  MAX_COUNTER_HISTORY,
  MAX_NOTIFICATIONS_PER_APP,
  MAX_TRANSITIONS_PER_SESSION,
  MAX_WORKFLOW_INSTANCES,
  MAX_BEHAVIOR_SESSIONS_PER_APP,
  STALE_AFTER_SESSIONS,
} from './knowledge-types';
import { mergeSignature } from './behavior-knowledge-merge';
import type { MappedBehaviorRows } from './behavior-knowledge-mapper';
import { hashPattern } from '../enrichment/recorded-workflow';

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

  /**
   * CP8 — list all known applications (contract app discovery).
   * Deterministic order: appId asc. Additive read-only method.
   */
  async listApplications(): Promise<ApplicationRow[]> {
    const rows = await this.db.applications.toArray();
    return rows.sort((a, b) => (a.appId < b.appId ? -1 : 1));
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
    let existing = await this.db.knowledgeRecordedWorkflows.get(row.key);

    // D7 identity migration: if the incoming key is absent, a legacy row
    // for the SAME app may still hold the old (pre-canonicalization)
    // identity for this workflow — its stored canonicalSteps re-hash (under
    // the CURRENT canonicalization) to the incoming patternId. Merge into
    // that row under the canonical key and delete the legacy one so the
    // pattern converges instead of splitting into occurrenceCount=1 rows.
    if (!existing) {
      const legacy = await this.findLegacyPatternRow(row);
      if (legacy) {
        await this.db.knowledgeRecordedWorkflows.delete(legacy.key);
        existing = legacy;
      }
    }

    if (existing) {
      const sessionIds = [...new Set([...existing.sessionIds, ...row.sessionIds])];
      const instances = [...existing.instances, ...row.instances]
        .filter((v, i, a) => a.indexOf(v) === i) // dedup instances
        .slice(-MAX_WORKFLOW_INSTANCES);
      await this.db.knowledgeRecordedWorkflows.put({
        ...existing,
        // D7: the canonical key wins so the row converges on the new id.
        key: row.key,
        patternId: row.patternId,
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

  /**
   * D7 identity migration: find a same-app row whose stored canonicalSteps
   * re-hash (current canonicalization) to the incoming patternId but whose
   * key differs — i.e. the same physical workflow recorded before the
   * canonicalization change. Returns undefined when no such row exists.
   */
  private async findLegacyPatternRow(
    row: KnowledgeRecordedWorkflowRow,
  ): Promise<KnowledgeRecordedWorkflowRow | undefined> {
    const appRows = await this.db.knowledgeRecordedWorkflows
      .where('appId')
      .equals(row.appId)
      .toArray();
    for (const r of appRows) {
      if (r.key === row.key) continue;
      // Re-hash the stored identity steps under the current rules.
      const reHashed = hashPattern(r.canonicalSteps);
      // The legacy row belongs to this pattern if either its re-hashed
      // identity or its own patternId matches the incoming one.
      if (reHashed === row.patternId || r.patternId === row.patternId) {
        return r;
      }
    }
    return undefined;
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

    // CP6: cascade behavior-knowledge rows for this session (signatures
    // survive — accumulated knowledge is demoted, not destroyed).
    const sessions = await this.db.knowledgeBehaviorSessions
      .where('sessionId')
      .equals(sessionId)
      .toArray();
    for (const s of sessions) {
      await this.deleteBehaviorSession(s.appId, s.sessionId);
    }
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
      // CP6: behavior-knowledge stores (full teardown includes signatures).
      this.db.knowledgeBehaviorSessions.where('appId').equals(appId).delete(),
      this.db.knowledgeEpisodes.where('appId').equals(appId).delete(),
      this.db.knowledgeEdges.where('appId').equals(appId).delete(),
      this.db.knowledgeGaps.where('appId').equals(appId).delete(),
      this.db.knowledgeSignatures.where('appId').equals(appId).delete(),
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

// ── CP6: Behavior knowledge stores (Dexie v3) ─────────────────────────

/**
 * CP6 — write one session's mapped behavior knowledge atomically.
 *
 * CP6 — write one session's mapped behavior knowledge atomically.
 *
 * ONE rw transaction over exactly the five new stores:
 *   1. Manifest idempotency gate — if this sessionId already exists,
 *      the write is a full NO-OP (replay-safe by construction).
 *   2. seq assignment INSIDE the transaction ([appId+seq].last() + 1).
 *   3. put manifest; bulkPut stratum-1 rows.
 *   4. Load touched signature rows → pure mergeSignature folds, in
 *      deterministic episode order → bulkPut.
 *   5. FIFO eviction beyond MAX_BEHAVIOR_SESSIONS_PER_APP (cascade).
 *
 * Failure of this transaction cannot roll back persist() steps 1–10
 * (they run in their own implicit transactions, exactly as today).
 */
async upsertBehaviorKnowledge(
  mapped: MappedBehaviorRows,
  generatedAtMs: number,
): Promise<void> {
  await this.db.transaction(
    'rw',
    [
      this.db.knowledgeBehaviorSessions,
      this.db.knowledgeEpisodes,
      this.db.knowledgeEdges,
      this.db.knowledgeGaps,
      this.db.knowledgeSignatures,
    ],
    async () => {
      const { session, episodes, edges, gaps, signatureInputs } = mapped;

      // 1. Idempotency gate — replay of a session is a no-op.
      const manifest = await this.db.knowledgeBehaviorSessions.get(session.key);
      if (manifest) return;

      // 2. seq assignment INSIDE the transaction: highest existing seq
      //    for this app, via the compound index range query, +1.
      const sessionsForApp = await this.db.knowledgeBehaviorSessions
        .where('[appId+seq]')
        .between([session.appId, Dexie.minKey], [session.appId, Dexie.maxKey])
        .toArray();
      const seq = sessionsForApp.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
      const finalSession = { ...session, seq, generatedAtMs };

      // 3. Manifest + stratum-1 rows.
      await this.db.knowledgeBehaviorSessions.put(finalSession);
      await this.db.knowledgeEpisodes.bulkPut(episodes);
      await this.db.knowledgeEdges.bulkPut(edges);
      await this.db.knowledgeGaps.bulkPut(gaps);

      // 4. Stratum-2 merge (episode order = mapper output order). Seq and
      //    timestamp are injected here — inside the transaction — so
      //    signature rows never carry a stale sequence number.
      const sigRows = new Map<string, KnowledgeActionSignatureRow>();
      for (const input of signatureInputs) {
        const existing =
          sigRows.get(input.key) ??
          (await this.db.knowledgeSignatures.get(input.key));
        const merged = mergeSignature(existing, {
          ...input,
          sessionSeq: seq,
          generatedAtMs,
        });
        sigRows.set(input.key, merged);
      }
      await this.db.knowledgeSignatures.bulkPut([...sigRows.values()]);

      // 5. FIFO eviction (cascade) beyond the bound.
      await this.evictOldestBehaviorSessions(session.appId);
    },
  );
}

/** CP6 — read one behavior session manifest. */
async getBehaviorSession(
  appId: string,
  sessionId: string,
): Promise<KnowledgeBehaviorSessionRow | undefined> {
  return this.db.knowledgeBehaviorSessions.get(`${appId}:${sessionId}`);
}

/** CP6 — recent behavior sessions, newest seq first. */
async getRecentBehaviorSessions(
  appId: string,
  limit = 10,
): Promise<KnowledgeBehaviorSessionRow[]> {
  const rows = await this.db.knowledgeBehaviorSessions
    .where('appId')
    .equals(appId)
    .toArray();
  return rows.sort((a, b) => b.seq - a.seq).slice(0, limit);
}

/** CP6 — episodes of one session. */
async getEpisodesBySession(
  appId: string,
  sessionId: string,
): Promise<KnowledgeEpisodeRow[]> {
  return this.db.knowledgeEpisodes
    .where('[appId+sessionId]')
    .equals([appId, sessionId])
    .toArray();
}

/** CP6 — edges of one session. */
async getEdgesBySession(
  appId: string,
  sessionId: string,
): Promise<KnowledgeEdgeRow[]> {
  return this.db.knowledgeEdges
    .where('[appId+sessionId]')
    .equals([appId, sessionId])
    .toArray();
}

/** CP6 — gaps, optionally filtered by session and/or reason. */
async getGaps(
  appId: string,
  query: { sessionId?: string; reason?: string } = {},
): Promise<KnowledgeGapRow[]> {
  if (query.sessionId) {
    const rows = await this.db.knowledgeGaps
      .where('[appId+sessionId]')
      .equals([appId, query.sessionId])
      .toArray();
    return query.reason ? rows.filter((r) => r.reason === query.reason) : rows;
  }
  if (query.reason) {
    return this.db.knowledgeGaps
      .where('[appId+reason]')
      .equals([appId, query.reason])
      .toArray();
  }
  const rows = await this.db.knowledgeGaps.where('appId').equals(appId).toArray();
  return rows.sort((a, b) => a.observedAtMs - b.observedAtMs);
}

/** CP6 — one signature row. */
async getSignature(key: string): Promise<KnowledgeActionSignatureRow | undefined> {
  return this.db.knowledgeSignatures.get(key);
}

/** CP6 — all signatures for an app, most recently seen first. */
async getSignatures(appId: string): Promise<KnowledgeActionSignatureRow[]> {
  const rows = await this.db.knowledgeSignatures
    .where('appId')
    .equals(appId)
    .toArray();
  return rows.sort(
    (a, b) =>
      b.lastSeenSeq - a.lastSeenSeq ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * CP6 — signature search (index + in-memory filter; documented R5 — no
 * substring index in Dexie, fine at knowledge-layer scale).
 *
 * `status` semantics (CP7 P1): the stored `status`/`sessionsSinceSeen`
 * mean "as of LAST observation" — a merge always writes 'active' because
 * the folding session observed the signature. The EFFECTIVE status is
 * relative to the app's current seq (which advances via other
 * signatures' sessions) and is therefore computed read-time, using the
 * loader's exact formula. Stored status is never trusted here.
 *
 * Seq monotonicity: eviction is FIFO (oldest first), so the max-seq
 * manifest is never evicted while newer ones exist — the in-transaction
 * `max+1` assignment can never reuse a seq.
 */
async searchSignatures(
  appId: string,
  filter: { actionType?: string; targetIncludes?: string; status?: 'active' | 'stale' },
): Promise<KnowledgeActionSignatureRow[]> {
  let rows: KnowledgeActionSignatureRow[];
  if (filter.actionType) {
    rows = await this.db.knowledgeSignatures
      .where('[appId+actionType]')
      .equals([appId, filter.actionType])
      .toArray();
  } else {
    rows = await this.db.knowledgeSignatures.where('appId').equals(appId).toArray();
  }
  let filtered = rows;
  if (filter.status) {
    // Read-time effective status (loader formula): 'stale' once the
    // signature's last observed seq trails the app's current seq by more
    // than STALE_AFTER_SESSIONS. currentSeq = max retained manifest seq.
    const sessions = await this.db.knowledgeBehaviorSessions
      .where('appId')
      .equals(appId)
      .toArray();
    if (sessions.length === 0) return [];
    const currentSeq = Math.max(...sessions.map((s) => s.seq));
    filtered = filtered.filter((r) => {
      const effective: 'active' | 'stale' =
        currentSeq - r.lastSeenSeq > STALE_AFTER_SESSIONS ? 'stale' : 'active';
      return effective === filter.status;
    });
  }
  if (filter.targetIncludes) {
    const needle = filter.targetIncludes.toLowerCase();
    filtered = filtered.filter((r) => r.normalizedTarget.includes(needle));
  }
  return filtered.sort(
    (a, b) =>
      b.lastSeenSeq - a.lastSeenSeq ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * CP6 — FIFO eviction with cascade: delete the oldest session's manifest +
 * episodes + edges + gaps. Signatures are NEVER deleted (knowledge is
 * demoted, not destroyed); evicted sessions' evidence samples degrade at
 * read time (R7).
 */
async evictOldestBehaviorSessions(
  appId: string,
  keep = MAX_BEHAVIOR_SESSIONS_PER_APP,
): Promise<void> {
  const sessions = await this.db.knowledgeBehaviorSessions
    .where('appId')
    .equals(appId)
    .toArray();
  const excess = sessions
    .sort((a, b) => a.seq - b.seq)
    .slice(0, Math.max(0, sessions.length - keep));
  for (const s of excess) {
    await this.db.knowledgeBehaviorSessions.delete(s.key);
    await this.db.knowledgeEpisodes
      .where('[appId+sessionId]')
      .equals([s.appId, s.sessionId])
      .delete();
    await this.db.knowledgeEdges
      .where('[appId+sessionId]')
      .equals([s.appId, s.sessionId])
      .delete();
    await this.db.knowledgeGaps
      .where('[appId+sessionId]')
      .equals([s.appId, s.sessionId])
      .delete();
  }
}

/**
 * CP6 — read-repair: delete stratum-1 rows whose session manifest is
 * missing (orphaned writes from a torn transaction). Bounded query.
 * Signatures untouched — knowledge outlives its evidence (R7).
 */
async sweepOrphans(appId: string): Promise<number> {
  const manifests = await this.db.knowledgeBehaviorSessions
    .where('appId')
    .equals(appId)
    .toArray();
  const known = new Set(manifests.map((m) => m.sessionId));
  let removed = 0;
  for (const table of [
    this.db.knowledgeEpisodes,
    this.db.knowledgeEdges,
    this.db.knowledgeGaps,
  ] as const) {
    const rows = await table.where('appId').equals(appId).toArray();
    const orphans = rows.filter((r) => !known.has(r.sessionId));
    for (const o of orphans) {
      await table.delete(o.key);
      removed++;
    }
  }
  return removed;
}

/**
 * CP6 — cascade session delete: remove manifest + episodes + edges + gaps
 * for one session. Signatures survive (accumulated knowledge, R2).
 */
async deleteBehaviorSession(appId: string, sessionId: string): Promise<void> {
  await this.db.knowledgeBehaviorSessions.delete(`${appId}:${sessionId}`);
  await this.db.knowledgeEpisodes
    .where('[appId+sessionId]')
    .equals([appId, sessionId])
    .delete();
  await this.db.knowledgeEdges
    .where('[appId+sessionId]')
    .equals([appId, sessionId])
    .delete();
  await this.db.knowledgeGaps
    .where('[appId+sessionId]')
    .equals([appId, sessionId])
    .delete();
}

}

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
