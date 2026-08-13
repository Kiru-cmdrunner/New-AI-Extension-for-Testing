/**
 * M9.6 — Conflict Detector
 *
 * Analyzes an ApplicationKnowledge read model to detect duplicate entities,
 * stale knowledge, evolving entities, and orphaned transitions.
 *
 * REPORT ONLY: never deletes, overwrites, merges, or downgrades persisted
 * knowledge. Returns structured findings for the caller to review.
 *
 * Architecture: .drytis/specs/m9-6-knowledge-consolidation.md
 */

import type { ApplicationKnowledge } from './application-knowledge';
import type {
  ConflictReport,
  DuplicateEntityFinding,
  EvolvingEntityFinding,
  KnowledgeFinding,
  OrphanedTransitionFinding,
  StaleKnowledgeFinding,
} from './application-knowledge';

// ── Config ─────────────────────────────────────────────────────────────

export interface ConflictDetectionConfig {
  /** Jaccard similarity threshold for duplicate entity detection. Default 0.5. */
  duplicateSimilarityThreshold: number;
  /** Sessions behind latest before entity is considered stale. Default 5. */
  staleSessionThreshold: number;
}

export const DEFAULT_CONFLICT_CONFIG: ConflictDetectionConfig = {
  duplicateSimilarityThreshold: 0.5,
  staleSessionThreshold: 5,
};

// ── Detector ───────────────────────────────────────────────────────────

export class ConflictDetector {
  constructor(
    private readonly knowledge: ApplicationKnowledge,
    private readonly config: ConflictDetectionConfig = DEFAULT_CONFLICT_CONFIG,
  ) {}

  /**
   * Run all checks and produce a combined report.
   */
  check(): ConflictReport {
    const duplicates = this.detectDuplicates();
    const stale = this.detectStale();
    const evolving = this.detectEvolving();
    const orphaned = this.detectOrphaned();

    const findings: KnowledgeFinding[] = [
      ...duplicates,
      ...stale,
      ...evolving,
      ...orphaned,
    ];

    return {
      findings,
      duplicateCount: duplicates.length,
      staleCount: stale.length,
      evolvingCount: evolving.length,
      orphanedCount: orphaned.length,
    };
  }

  // ── Duplicate entity detection ──────────────────────────────────────

  /**
   * Detect entities of the same type with overlapping attribute keys.
   * Uses Jaccard similarity on attribute key sets.
   */
  detectDuplicates(): DuplicateEntityFinding[] {
    const findings: DuplicateEntityFinding[] = [];
    const entities = this.knowledge.entities;

    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        const a = entities[i];
        const b = entities[j];

        if (a.type !== b.type) continue;

        const keysA = Object.keys(a.attributes);
        const keysB = Object.keys(b.attributes);
        const overlap = keysA.filter((k) => keysB.includes(k));
        const union = new Set([...keysA, ...keysB]);
        const similarity = overlap.length / union.size;

        if (similarity >= this.config.duplicateSimilarityThreshold) {
          findings.push({
            kind: 'duplicate-entity',
            severity: similarity >= 0.75 ? 'warning' : 'info',
            entityIdA: a.entityId,
            entityIdB: b.entityId,
            type: a.type,
            overlappingKeys: overlap,
            similarity: Math.round(similarity * 1000) / 1000,
            detail: `Entities "${a.entityId}" and "${b.entityId}" (type: ${a.type}) ` +
              `share ${overlap.length}/${union.size} attribute keys ` +
              `(Jaccard ${Math.round(similarity * 100)}%).`,
          });
        }
      }
    }

    return findings;
  }

  // ── Stale knowledge detection ───────────────────────────────────────

  /**
   * Detect entities not seen in the last N sessions.
   */
  detectStale(): StaleKnowledgeFinding[] {
    const findings: StaleKnowledgeFinding[] = [];
    const threshold = this.config.staleSessionThreshold;

    for (const entity of this.knowledge.entities) {
      // Use observedInSessions length as a proxy for how recently active.
      // If an entity was only seen in early sessions and sessionCount has
      // grown significantly, it's stale.
      const lastSeenRank = entity.observedInSessions.length;
      const sessionsSinceLastSeen = Math.max(0, this.knowledge.sessionCount - lastSeenRank);

      if (sessionsSinceLastSeen >= threshold) {
        findings.push({
          kind: 'stale-knowledge',
          severity: sessionsSinceLastSeen >= threshold * 2 ? 'warning' : 'info',
          entityId: entity.entityId,
          type: entity.type,
          sessionsSinceLastSeen,
          lastSeenAt: entity.lastSeenAt,
          detail: `Entity "${entity.entityId}" (type: ${entity.type}) was last seen ` +
            `${sessionsSinceLastSeen} sessions ago ` +
            `(threshold: ${threshold}). Consider whether this knowledge is still relevant.`,
        });
      }
    }

    return findings;
  }

  // ── Evolving entity detection ───────────────────────────────────────

  /**
   * Detect entities whose attributes have changed across sessions.
   * revision > 1 means attributes were merged from multiple sessions.
   */
  detectEvolving(): EvolvingEntityFinding[] {
    const findings: EvolvingEntityFinding[] = [];

    for (const entity of this.knowledge.entities) {
      if (entity.revision > 1) {
        // The specific changed attributes are not stored per-revision
        // in M9.5; we report all current keys as potentially changed.
        findings.push({
          kind: 'evolving-entity',
          severity: entity.revision > 3 ? 'info' : 'info',
          entityId: entity.entityId,
          type: entity.type,
          revision: entity.revision,
          changedAttributes: Object.keys(entity.attributes),
          detail: `Entity "${entity.entityId}" (type: ${entity.type}) has ` +
            `revision ${entity.revision}, indicating attributes were updated ` +
            `across ${entity.revision} sessions.`,
        });
      }
    }

    return findings;
  }

  // ── Orphaned transition detection ───────────────────────────────────

  /**
   * Detect state transitions that reference views or entities not
   * present in the current knowledge base.
   */
  detectOrphaned(): OrphanedTransitionFinding[] {
    const findings: OrphanedTransitionFinding[] = [];

    const knownViewIds = new Set(this.knowledge.views.map((v) => v.viewId));

    // Check view-graph edges for unknown views.
    for (const edge of this.knowledge.viewGraph.edges) {
      if (!knownViewIds.has(edge.fromViewId)) {
        findings.push({
          kind: 'orphaned-transition',
          severity: 'warning',
          transitionKey: `${edge.fromViewId}->${edge.toViewId}`,
          missingRefType: 'view',
          missingRefId: edge.fromViewId,
          detail: `View transition "${edge.fromViewId}→${edge.toViewId}" ` +
            `references unknown view "${edge.fromViewId}".`,
        });
      }
      if (!knownViewIds.has(edge.toViewId)) {
        findings.push({
          kind: 'orphaned-transition',
          severity: 'warning',
          transitionKey: `${edge.fromViewId}->${edge.toViewId}`,
          missingRefType: 'view',
          missingRefId: edge.toViewId,
          detail: `View transition "${edge.fromViewId}→${edge.toViewId}" ` +
            `references unknown view "${edge.toViewId}".`,
        });
      }
    }

    return findings;
  }
}
