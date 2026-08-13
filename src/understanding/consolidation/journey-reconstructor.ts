/**
 * M9.6 — Journey Reconstructor
 *
 * Reconstructs an ordered user-journey timeline from persisted state
 * transitions and outcome rows. Groups by session, orders by timestamp,
 * detects gaps, and computes outcome coverage.
 *
 * READ-ONLY: queries KnowledgeRepository, writes nothing.
 *
 * Architecture: .drytis/specs/m9-6-knowledge-consolidation.md
 */

import type { KnowledgeRepository } from '../persistence/knowledge-repository';
import type {
  KnowledgeOutcomeRow,
  KnowledgeStateTransitionRow,
} from '../persistence/knowledge-types';
import type { JourneyGap, JourneyStep, JourneyTimeline } from './application-knowledge';

// ── Config ─────────────────────────────────────────────────────────────

export interface JourneyConfig {
  /** Minimum gap between consecutive steps (ms) to flag as a gap. Default 60_000 (1 min). */
  gapThresholdMs: number;
}

export const DEFAULT_JOURNEY_CONFIG: JourneyConfig = {
  gapThresholdMs: 60_000,
};

// ── Reconstructor ──────────────────────────────────────────────────────

export class JourneyReconstructor {
  constructor(
    private readonly repo: KnowledgeRepository,
    private readonly config: JourneyConfig = DEFAULT_JOURNEY_CONFIG,
  ) {}

  /**
   * Reconstruct the full journey timeline for an app across all sessions.
   */
  async reconstruct(appId: string): Promise<JourneyTimeline> {
    const outcomes = await this.repo.getOutcomesByApp(appId);

    // Gather state transitions from all sessions that produced outcomes.
    const sessionIds = [...new Set(outcomes.map((o) => o.sessionId))];
    const transitionResults = await Promise.all(
      sessionIds.map((sid) => this.repo.getStateTransitions(sid)),
    );
    const transitions = transitionResults.flat();

    // Build merged steps by matching transitions with outcomes on interactionId.
    const stepMap = this.buildSteps(transitions, outcomes);
    const steps = [...stepMap.values()].sort((a, b) => {
      // Sort by session (natural string order), then by timestamp.
      if (a.sessionId !== b.sessionId) return a.sessionId.localeCompare(b.sessionId);
      return a.timestamp - b.timestamp;
    });

    const gaps = this.detectGaps(steps);
    const outcomeCoverage = this.computeCoverage(transitions, outcomes);

    return {
      steps,
      gaps,
      outcomeCoverage,
      sessionCount: new Set(steps.map((s) => s.sessionId)).size,
      totalInteractions: steps.length,
    };
  }

  /**
   * Reconstruct the journey for a single session only.
   */
  async reconstructSession(sessionId: string): Promise<JourneyTimeline> {
    const [transitions, outcomes] = await Promise.all([
      this.repo.getStateTransitions(sessionId),
      this.repo.getOutcomes(sessionId),
    ]);

    const stepMap = this.buildSteps(transitions, outcomes);
    const steps = [...stepMap.values()].sort((a, b) => a.timestamp - b.timestamp);
    const gaps = this.detectGaps(steps);
    const outcomeCoverage = this.computeCoverage(transitions, outcomes);

    return {
      steps,
      gaps,
      outcomeCoverage,
      sessionCount: 1,
      totalInteractions: steps.length,
    };
  }

  // ── Step building ───────────────────────────────────────────────────

  /**
   * Merge transitions and outcomes into steps keyed by interactionId.
   * Each step carries data from whichever source(s) reference the interaction.
   */
  private buildSteps(
    transitions: KnowledgeStateTransitionRow[],
    outcomes: KnowledgeOutcomeRow[],
  ): Map<string, JourneyStep> {
    const steps = new Map<string, JourneyStep>();

    // Seed from transitions.
    for (const t of transitions) {
      steps.set(t.interactionId, {
        sessionId: t.sessionId,
        interactionId: t.interactionId,
        timestamp: t.timestamp,
        fromViewId: t.fromViewId,
        toViewId: t.toViewId,
        actionType: null,
        actionTarget: null,
        outcome: null,
        changes: [...t.changes],
        affectedEntities: [...t.affectedEntities],
      });
    }

    // Enrich with outcomes.
    for (const o of outcomes) {
      const existing = steps.get(o.interactionId);
      if (existing) {
        existing.actionType = o.actionType;
        existing.actionTarget = o.actionTarget;
        existing.outcome = o.outcome;
      } else {
        // Outcome with no matching transition — still include it.
        steps.set(o.interactionId, {
          sessionId: o.sessionId,
          interactionId: o.interactionId,
          timestamp: o.persistedAt,
          fromViewId: null,
          toViewId: null,
          actionType: o.actionType,
          actionTarget: o.actionTarget,
          outcome: o.outcome,
          changes: [],
          affectedEntities: [...o.resultingEntities],
        });
      }
    }

    return steps;
  }

  // ── Gap detection ───────────────────────────────────────────────────

  private detectGaps(sortedSteps: JourneyStep[]): JourneyGap[] {
    const gaps: JourneyGap[] = [];

    for (let i = 1; i < sortedSteps.length; i++) {
      const prev = sortedSteps[i - 1];
      const curr = sortedSteps[i];

      // Only detect gaps within the same session.
      if (prev.sessionId !== curr.sessionId) continue;

      const gapMs = curr.timestamp - prev.timestamp;
      if (gapMs > this.config.gapThresholdMs) {
        gaps.push({
          sessionId: curr.sessionId,
          afterTimestamp: prev.timestamp,
          beforeTimestamp: curr.timestamp,
          gapMs,
          detail: `Gap of ${Math.round(gapMs / 1000)}s between interaction ` +
            `"${prev.interactionId}" and "${curr.interactionId}" in session ${curr.sessionId}.`,
        });
      }
    }

    return gaps;
  }

  // ── Coverage computation ────────────────────────────────────────────

  /**
   * Percentage of transitions that have a matching outcome.
   * Low coverage indicates incomplete journey data.
   */
  private computeCoverage(
    transitions: KnowledgeStateTransitionRow[],
    outcomes: KnowledgeOutcomeRow[],
  ): number {
    if (transitions.length === 0 && outcomes.length === 0) return 100;
    if (transitions.length === 0) return 100; // outcomes without transitions is fine

    const outcomeInteractionIds = new Set(outcomes.map((o) => o.interactionId));
    const matched = transitions.filter((t) => outcomeInteractionIds.has(t.interactionId)).length;
    return Math.round((matched / transitions.length) * 100);
  }
}
