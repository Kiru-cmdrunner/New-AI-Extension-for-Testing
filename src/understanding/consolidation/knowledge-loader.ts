/**
 * M9.6 — Knowledge Loader
 *
 * Assembles persisted M9.5 rows into a coherent ApplicationKnowledge
 * read model with deterministic confidence scoring.
 *
 * READ-ONLY: queries KnowledgeRepository, writes nothing.
 *
 * Architecture: .drytis/specs/m9-6-knowledge-consolidation.md
 */

import type { KnowledgeRepository } from '../persistence/knowledge-repository';
import type {
  KnowledgeCollectionRow,
  KnowledgeCounterRow,
  KnowledgeEntityRow,
  KnowledgeNotificationRow,
  KnowledgeOutcomeRow,
  KnowledgeStateTransitionRow,
  KnowledgeViewRow,
  KnowledgeViewTransitionRow,
} from '../persistence/knowledge-types';
import type {
  ApplicationKnowledge,
  ConsolidatedCollection,
  ConsolidatedCounter,
  ConsolidatedEntity,
  ConsolidatedView,
  KnowledgeConfidence,
  OutcomePattern,
  ViewGraph,
} from './application-knowledge';

// ── Confidence scoring (deterministic, configurable) ───────────────────

export interface ConfidenceConfig {
  /** Revision/visit count at which observationScore saturates. Default 5. */
  saturationCount: number;
  /** Recency decay per session since last seen. Default 0.15. */
  recencyDecay: number;
  /** Minimum recency score. Default 0.1. */
  minRecency: number;
  /** Distinct entity sources at which sourceScore saturates. Default 4. */
  maxSources: number;
}

export const DEFAULT_CONFIDENCE_CONFIG: ConfidenceConfig = {
  saturationCount: 5,
  recencyDecay: 0.15,
  minRecency: 0.1,
  maxSources: 4,
};

/**
 * Score a knowledge item deterministically.
 *
 * observationScore = min(count / saturationCount, 1)
 * recencyScore     = max(1 - sessionsSinceSeen * recencyDecay, minRecency)
 * sourceScore      = distinctSources / maxSources (entities) or 1 (views)
 * final            = (observation + recency + source) / 3
 */
export function scoreConfidence(
  observationCount: number,
  sessionsSinceSeen: number,
  distinctSources: number,
  config: ConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG,
): KnowledgeConfidence {
  const observationScore = Math.min(observationCount / config.saturationCount, 1);
  const recencyScore = Math.max(
    1 - sessionsSinceSeen * config.recencyDecay,
    config.minRecency,
  );
  const sourceScore = Math.min(distinctSources / config.maxSources, 1);
  const score = (observationScore + recencyScore + sourceScore) / 3;

  return {
    score: round3(score),
    observationScore: round3(observationScore),
    recencyScore: round3(recencyScore),
    sourceScore: round3(sourceScore),
    level: scoreToLevel(score),
  };
}

function scoreToLevel(score: number): KnowledgeConfidence['level'] {
  if (score >= 0.75) return 'very-high';
  if (score >= 0.55) return 'high';
  if (score >= 0.35) return 'medium';
  return 'low';
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ── Loader ─────────────────────────────────────────────────────────────

export class KnowledgeLoader {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly config: ConfidenceConfig = DEFAULT_CONFIDENCE_CONFIG,
  ) {}

  /**
   * Load and consolidate all knowledge for an app.
   * Returns null if the app has never been recorded.
   */
  async load(appId: string): Promise<ApplicationKnowledge | null> {
    const app = await this.repo.getApplication(appId);
    if (!app) return null;

    // Fan out all reads in parallel — all use indexed queries.
    const [entityRows, viewRows, viewTransitionRows, collectionRows, counterRows, notificationRows, outcomeRows, transitionRows] =
      await Promise.all([
        this.repo.getEntities(appId),
        this.repo.getViews(appId),
        this.repo.getViewTransitions(appId),
        this.repo.getCollections(appId),
        this.repo.getCounters(appId),
        this.repo.getNotifications(appId),
        this.repo.getOutcomesByApp(appId),
        this.getStateTransitionsByApp(appId),
      ]);

    // Sessions that produced knowledge, ordered by recency rank.
    // lastActiveAt/sessionCount gives us the latest session rank.
    const observedSessions = collectObservedSessions(
      entityRows,
      outcomeRows,
      transitionRows,
    );

    const entities = this.consolidateEntities(entityRows, observedSessions, app.lastActiveAt);
    const views = this.consolidateViews(viewRows);
    const viewGraph = buildViewGraph(views, viewTransitionRows);
    const collections = consolidateCollections(collectionRows);
    const counters = consolidateCounters(counterRows);
    const notifications = consolidateNotifications(notificationRows);
    const outcomePattern = aggregateOutcomes(outcomeRows);

    return {
      appId: app.appId,
      origin: app.origin,
      label: app.label,
      sessionCount: app.sessionCount,
      firstSeenAt: app.firstSeenAt,
      lastActiveAt: app.lastActiveAt,

      entities,
      views,
      viewGraph,
      collections,
      counters,
      notifications,
      outcomePattern,

      totalRows:
        entityRows.length +
        viewRows.length +
        viewTransitionRows.length +
        collectionRows.length +
        counterRows.length +
        notificationRows.length +
        outcomeRows.length +
        transitionRows.length,
    };
  }

  /**
   * KnowledgeRepository exposes state transitions by sessionId only.
   * For by-app reads we scan sessions observed in outcomes, which is
   * the authoritative session list.
   */
  private async getStateTransitionsByApp(appId: string): Promise<KnowledgeStateTransitionRow[]> {
    const outcomes = await this.repo.getOutcomesByApp(appId);
    const sessionIds = [...new Set(outcomes.map((o) => o.sessionId))];
    const perSession = await Promise.all(
      sessionIds.map((sid) => this.repo.getStateTransitions(sid)),
    );
    return perSession.flat();
  }

  private consolidateEntities(
    entityRows: KnowledgeEntityRow[],
    _observedSessions: string[],
    appLastActiveAt: number,
  ): ConsolidatedEntity[] {
    return entityRows.map((row) => {
      const sessions = [row.lastSessionId];

      // Recency: estimate sessions since seen from timestamp distance.
      // M9.5 timestamps use Date.now() at persist time.
      const dayMs = 24 * 60 * 60 * 1000;
      const daysSinceSeen = Math.max(0, Math.floor((appLastActiveAt - row.lastSeenAt) / dayMs));
      const sessionsSinceSeen = Math.min(daysSinceSeen, 100);

      return {
        entityId: row.entityId,
        type: row.type,
        attributes: row.attributes,
        source: row.source,
        revision: row.revision,
        confidence: scoreConfidence(
          row.revision,
          sessionsSinceSeen,
          1,
          this.config,
        ),
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        observedInSessions: sessions,
        currentState: row.currentState,
        stateHistory: row.stateHistory,
        viewIds: row.viewIds,
      };
    });
  }

  private consolidateViews(
    viewRows: KnowledgeViewRow[],
  ): ConsolidatedView[] {
    const latestSeen = viewRows.reduce((max, v) => Math.max(max, v.lastSeenAt), 0);
    return viewRows.map((row) => {
      // Views get sourceScore 1.0 (single detection dimension).
      const confidence = scoreConfidence(
        row.visitCount,
        estimateSessionsSinceSeen(row.lastSeenAt, latestSeen, viewRows),
        1,
        // Views saturate source at 1 → scale maxSources accordingly
        { ...this.config, maxSources: 1 },
      );
      return {
        viewId: row.viewId,
        label: row.label,
        detectedFrom: row.detectedFrom,
        visitCount: row.visitCount,
        confidence,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
      };
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Collect all sessionIds referenced by any knowledge row.
 */
function collectObservedSessions(
  entityRows: { lastSessionId: string }[],
  outcomeRows: { sessionId: string }[],
  transitionRows: { sessionId: string }[],
): string[] {
  const sessions = new Set<string>();
  for (const e of entityRows) sessions.add(e.lastSessionId);
  for (const o of outcomeRows) sessions.add(o.sessionId);
  for (const t of transitionRows) sessions.add(t.sessionId);
  return [...sessions];
}

/**
 * Views do not carry session ranks; approximate sessions-since-seen by
 * timestamp distance to the newest observation.
 */
function estimateSessionsSinceSeen(
  lastSeenAt: number,
  latestSeenAt: number,
  _allViews: unknown[],
): number {
  if (latestSeenAt <= 0) return 0;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.floor((latestSeenAt - lastSeenAt) / dayMs);
  // Approximate one session per day of staleness (conservative).
  return Math.min(Math.floor(days / 7), 10);
}

function buildViewGraph(
  views: ConsolidatedView[],
  transitionRows: KnowledgeViewTransitionRow[],
): ViewGraph {
  return {
    nodes: views,
    edges: transitionRows.map((t) => ({
      fromViewId: t.fromViewId,
      toViewId: t.toViewId,
      count: t.count,
    })),
  };
}

function consolidateCollections(
  rows: KnowledgeCollectionRow[],
): ConsolidatedCollection[] {
  return rows.map((r) => ({
    collectionId: r.collectionId,
    entityType: r.entityType,
    currentCount: r.currentCount,
    maxCount: r.maxCount,
    lastUpdated: r.lastUpdated,
  }));
}

function consolidateCounters(
  rows: KnowledgeCounterRow[],
): ConsolidatedCounter[] {
  return rows.map((r) => ({
    counterId: r.counterId,
    label: r.label,
    elementPath: r.elementPath,
    currentValue: r.currentValue,
    historyLength: r.history.length,
    lastUpdated: r.lastUpdated,
  }));
}

function consolidateNotifications(
  rows: KnowledgeNotificationRow[],
): { text: string; severity: string; count: number }[] {
  // Group by text+severity, count occurrences.
  const grouped = new Map<string, { text: string; severity: string; count: number }>();
  for (const r of rows) {
    const key = `${r.severity}::${r.text}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count++;
    } else {
      grouped.set(key, { text: r.text, severity: r.severity, count: 1 });
    }
  }
  return [...grouped.values()];
}

function aggregateOutcomes(outcomeRows: KnowledgeOutcomeRow[]): OutcomePattern {
  const pattern: OutcomePattern = {
    totalActions: outcomeRows.length,
    successCount: 0,
    failureCount: 0,
    ambiguousCount: 0,
    incompleteCount: 0,
    topActionTypes: [],
  };

  const actionTypeCounts = new Map<string, number>();
  for (const o of outcomeRows) {
    if (o.outcome === 'success') pattern.successCount++;
    else if (o.outcome === 'failure') pattern.failureCount++;
    else if (o.outcome === 'ambiguous') pattern.ambiguousCount++;
    else if (o.outcome === 'incomplete') pattern.incompleteCount++;

    actionTypeCounts.set(o.actionType, (actionTypeCounts.get(o.actionType) ?? 0) + 1);
  }

  pattern.topActionTypes = [...actionTypeCounts.entries()]
    .map(([actionType, count]) => ({ actionType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return pattern;
}
