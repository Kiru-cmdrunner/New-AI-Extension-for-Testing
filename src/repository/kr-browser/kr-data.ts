/**
 * MS-U4 — read-only data assembly for the KR browser.
 *
 * Every read goes through the EXISTING KnowledgeRepository methods (no new
 * repository methods, no schema change, no writes). Scoping is by appId
 * ONLY — cross-session by design (this is the repository-wide knowledge
 * view). The repository-v2 session UUID key is deliberately absent from
 * this file: it belongs to a different key domain and never matches
 * knowledge rows (see MS-U3 join-key RCA, beb237f).
 *
 * Spec: .drytis/specs/phase-6-u4-kr-browser.md §3, §6 P8/P10/P11.
 */

import type {
  ApplicationRow,
  KnowledgeActionSignatureRow,
  KnowledgeBehaviorSessionRow,
  KnowledgeCollectionRow,
  KnowledgeCounterRow,
  KnowledgeEntityRow,
  KnowledgeEpisodeRow,
  KnowledgeEdgeRow,
  KnowledgeGapRow,
  KnowledgeNotificationRow,
  KnowledgeOutcomeRow,
  KnowledgeRecordedWorkflowRow,
  KnowledgeViewRow,
  KnowledgeViewTransitionRow,
} from '../../understanding/persistence/knowledge-types';
import type {
  KnowledgeRepository,
} from '../../understanding/persistence/knowledge-repository';
import type { SeedEvidenceAccess, SeedEvidenceRow } from '../../understanding/contract/api-seed-derivation';
import type { ApiTestSeed } from '../../understanding/contract/contract-types';
import type { BehavioralEvidenceRow } from '../v2/dexie/dexie-database';
import { KR_CAPS } from './kr-sort';

// ── assembly types ──────────────────────────────────────────────────────

export interface SessionDetail {
  episodes: KnowledgeEpisodeRow[];
  edges: KnowledgeEdgeRow[];
}

export interface AppKnowledge {
  signatures: KnowledgeActionSignatureRow[];
  workflows: KnowledgeRecordedWorkflowRow[];
  views: KnowledgeViewRow[];
  viewEdges: KnowledgeViewTransitionRow[];
  behaviorSessions: KnowledgeBehaviorSessionRow[];
  sessionDetails: Record<string, SessionDetail>;
  gaps: KnowledgeGapRow[];
  apiSeeds: ApiTestSeed[];
  outcomes: KnowledgeOutcomeRow[];
  entities: KnowledgeEntityRow[];
  collections: KnowledgeCollectionRow[];
  counters: KnowledgeCounterRow[];
  notifications: KnowledgeNotificationRow[];
}

// ── lazy handle ─────────────────────────────────────────────────────────

let repoHandle: KnowledgeRepository | null = null;

async function getRepo(): Promise<KnowledgeRepository> {
  if (!repoHandle) {
    const { createKnowledgeDatabase } = await import(
      '../../understanding/persistence/knowledge-database'
    );
    const { KnowledgeRepository: Repo } = await import(
      '../../understanding/persistence/knowledge-repository'
    );
    repoHandle = new Repo(createKnowledgeDatabase());
  }
  return repoHandle;
}

// ── applications ────────────────────────────────────────────────────────

export async function loadApplications(): Promise<ApplicationRow[]> {
  try {
    return await (await getRepo()).listApplications();
  } catch {
    return []; // honest absence — caller renders the empty state
  }
}

// ── per-app knowledge (bounded reads via existing repository methods) ───

export async function loadAppKnowledge(appId: string): Promise<AppKnowledge> {
  const empty: AppKnowledge = {
    signatures: [], workflows: [], views: [], viewEdges: [],
    behaviorSessions: [], sessionDetails: {}, gaps: [], apiSeeds: [],
    outcomes: [], entities: [], collections: [], counters: [], notifications: [],
  };
  try {
    const repo = await getRepo();
    const [signatures, workflows, views, viewEdges, gaps, outcomes, entities, collections, counters, notifications] =
      await Promise.all([
        repo.getSignatures(appId),
        repo.getRecordedWorkflows(appId),
        repo.getViews(appId),
        repo.getViewTransitions(appId),
        repo.getGaps(appId),
        repo.getOutcomesByApp(appId),
        repo.getEntities(appId),
        repo.getCollections(appId),
        repo.getCounters(appId),
        repo.getNotifications(appId),
      ]);
    return { ...empty, signatures, workflows, views, viewEdges, gaps, outcomes, entities, collections, counters, notifications };
  } catch {
    return empty; // honest absence — sections render their empty states
  }
}

// ── behavior sessions (lazy per-expand; bounded) ────────────────────────

export async function loadBehaviorSessions(appId: string): Promise<KnowledgeBehaviorSessionRow[]> {
  try {
    const repo = await getRepo();
    // Existing service method: seq-desc, capped — exactly §2.2.4's
    // newest-first ordering. No direct db access (spec §0; reviewer F-2).
    return await repo.getRecentBehaviorSessions(appId, KR_CAPS.behaviorSessions);
  } catch {
    return [];
  }
}

export async function loadSessionDetail(
  appId: string,
  sessionId: string,
): Promise<SessionDetail> {
  try {
    const repo = await getRepo();
    const [episodes, edges] = await Promise.all([
      repo.getEpisodesBySession(appId, sessionId),
      repo.getEdgesBySession(appId, sessionId),
    ]);
    return { episodes, edges };
  } catch {
    return { episodes: [], edges: [] };
  }
}

// ── API seeds (frozen contract query + read-only evidence adapter) ──────

/**
 * Read behavioral-evidence rows for a session through the EXISTING V2
 * repository (no new repository methods, no schema reads). Both adapter
 * methods share this read so they can never disagree about the join domain.
 */
async function readBehavioralEvidenceRows(sessionId: string): Promise<BehavioralEvidenceRow[]> {
  const { DexieBehavioralEvidenceRepository } = await import(
    '../v2/dexie/dexie-behavioral-evidence-repository'
  );
  const { createDatabase } = await import('../v2/dexie/dexie-database');
  const db = createDatabase();
  const bev = new DexieBehavioralEvidenceRepository(db.behavioralEvidence);
  return bev.getBySession(sessionId);
}

/**
 * Map one behavioral-evidence row to the frozen derivation's input shape —
 * FULLY: networkActivity (the derivation's primary input — dropping it
 * would fabricate an empty section), interactionEventIds (stamp
 * attribution), sourceEventId, and resultingState (post-conditions).
 * Zero mutation, zero new derivation.
 *
 * Join-domain note: BehavioralEvidence carries exactly one event link —
 * sourceEventId (the trigger; M8/M9 capture contract). The exact-event
 * join set per interaction is therefore [sourceEventId] — the same
 * semantics the frozen derivation applies at api-seed-derivation.ts:330/:351.
 */
function rowToSeedEvidence(r: BehavioralEvidenceRow): SeedEvidenceRow {
  const appEv = r.applicationEvidence;
  return {
    windowId: r.windowId,
    interactionId: r.interactionId,
    recordingSessionId: r.recordingSessionId,
    sourceEventId: r.sourceEventId,
    interactionEventIds: [r.sourceEventId].filter(Boolean),
    networkActivity: appEv?.networkActivity ?? [],
    resultingState: appEv?.resultingState as SeedEvidenceRow['resultingState'],
  };
}

/**
 * Read-only SeedEvidenceAccess. Behavioral evidence rows live in the
 * SEPARATE cmdrunner repository DB (table `behavioralEvidence`, PK
 * windowId). Zero mutation, zero new derivation.
 */
export function buildSeedEvidenceAccess(): SeedEvidenceAccess {
  return {
    async getBySession(sessionId: string): Promise<readonly SeedEvidenceRow[]> {
      try {
        const rows = await readBehavioralEvidenceRows(sessionId);
        return rows.map(rowToSeedEvidence);
      } catch {
        return [];
      }
    },
    async getInteractionEventIds(
      appId: string,
      sessionId: string,
    ): Promise<Map<string, string[]>> {
      // Evidence-domain join set: interactionId → event ids its evidence
      // rows actually carry ([sourceEventId] — see rowToSeedEvidence).
      // Episodes are deliberately NOT used here: episode anchor/member ids
      // are interaction-domain keys; an episode-keyed map valued by EVENT
      // ids would be a category error — vacuous values leave `stamped`
      // permanently false and silently degrade every seed to
      // window-inferred with suppressed post-conditions (MS-U4 review
      // round-2 FAIL). appId is accepted for interface compatibility; the
      // evidence DB is scoped by the recording sessionId alone.
      try {
        void appId;
        const rows = await readBehavioralEvidenceRows(sessionId);
        const map = new Map<string, string[]>();
        for (const row of rows) {
          const seed = rowToSeedEvidence(row);
          const existing = map.get(seed.interactionId) ?? [];
          map.set(seed.interactionId, [...existing, ...seed.interactionEventIds]);
        }
        return map;
      } catch {
        return new Map();
      }
    },
  };
}

export async function loadApiSeeds(appId: string): Promise<ApiTestSeed[]> {
  try {
    const { listApiSeeds } = await import(
      '../../understanding/contract/contract-queries'
    );
    const repo = await getRepo();
    return await listApiSeeds(repo, appId, buildSeedEvidenceAccess());
  } catch {
    return []; // honest absence — section renders its empty state
  }
}
