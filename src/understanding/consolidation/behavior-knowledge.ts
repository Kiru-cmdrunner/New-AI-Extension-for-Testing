/**
 * CP6 — Behavior Knowledge read model
 *
 * The query surface for future consumers (Playwright generation, API/DB
 * testing, Agents/Assistants): a typed, deterministic, evidence-cited view
 * over Stratum 2 (signatures) + Stratum 1 (sessions) rows.
 *
 * Read-only. Computed by KnowledgeLoader.loadBehaviorKnowledge().
 */

import type {
  KnowledgeActionSignatureRow,
  KnowledgeBehaviorSessionRow,
  KnowledgeConsequence,
  KnowledgeGapRow,
} from '../persistence/knowledge-types';

/** One merged consequence in the read model. */
export interface BehaviorKnowledgeConsequence extends KnowledgeConsequence {
  /** Evidence samples with read-time existence check applied. */
  evidenceSamples: Array<{
    sessionId: string;
    edgeKey: string;
    /** False when the sample's session was FIFO-evicted (R7) — the
     *  sample degrades to a citation, never disappears silently. */
    resolvable: boolean;
  }>;
}

/** One action signature with consequence profile, ready for consumers. */
export interface BehaviorKnowledgeSignature {
  key: string;
  appId: string;
  actionType: string;
  normalizedTarget: string;
  anchorViewId: string | null;
  occurrenceCount: number;
  sessionsSinceSeen: number;
  status: 'active' | 'stale';
  firstSeenAtSession: string;
  lastSeenAtSession: string;
  lastSeenSeq: number;
  consequenceProfile: BehaviorKnowledgeConsequence[];
  divergenceFlags: string[];
}

/** Session manifest summary in the read model. */
export interface BehaviorKnowledgeSession {
  sessionId: string;
  seq: number;
  generatedAtMs: number;
  episodeCount: number;
  edgeCount: number;
  gapCount: number;
  signatureSetHash: string;
  viewSetHash: string;
}

/** Aggregated gap summary — the autonomous-testing work queue. */
export interface BehaviorKnowledgeGapSummary {
  total: number;
  byReason: Array<{ reason: string; count: number }>;
  recent: Array<{
    sessionId: string;
    gapId: string;
    observedKind: string;
    reason: string;
    detail: string;
    observedAtMs: number;
  }>;
}

/** Full read model for one app. */
export interface BehaviorKnowledge {
  appId: string;
  /** Number of hash changes of signatureSetHash over the session seq —
   *  increments when the observed behavior surface changed. */
  behaviorVersion: number;
  currentSeq: number;
  sessions: BehaviorKnowledgeSession[];
  signatures: BehaviorKnowledgeSignature[];
  gapSummary: BehaviorKnowledgeGapSummary;
}

/** Row types re-exported for consumer convenience. */
export type {
  KnowledgeActionSignatureRow,
  KnowledgeBehaviorSessionRow,
  KnowledgeGapRow,
};
