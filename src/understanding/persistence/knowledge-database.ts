/**
 * M9.5 - Knowledge Database (cmdrunner_knowledge)
 *
 * A SEPARATE Dexie database for Application Knowledge persistence.
 * This does NOT touch the frozen cmdrunner_repository (V1-V4) database.
 * M1-M8 persistence continues to work unchanged.
 *
 * Architecture: .drytis/specs/m9-5-knowledge-persistence.md
 */

import Dexie, { type Table } from 'dexie';
import type {
  ApplicationRow,
  KnowledgeEntityRow,
  KnowledgeViewRow,
  KnowledgeViewTransitionRow,
  KnowledgeCollectionRow,
  KnowledgeCounterRow,
  KnowledgeNotificationRow,
  KnowledgeOutcomeRow,
  KnowledgeStateTransitionRow,
  KnowledgeRecordedWorkflowRow,
} from './knowledge-types';

/** Database name — separate from cmdrunner_repository. */
const KNOWLEDGE_DB_NAME = 'cmdrunner_knowledge';

/**
 * The Application Knowledge database.
 * V1: 9 tables. V2: + knowledgeRecordedWorkflows (DDC-4, additive).
 * cmdrunner_repository (M1–M8 frozen) is untouched.
 */
export class KnowledgeDatabase extends Dexie {
  applications!: Table<ApplicationRow, string>;
  knowledgeEntities!: Table<KnowledgeEntityRow, string>;
  knowledgeViews!: Table<KnowledgeViewRow, string>;
  knowledgeViewTransitions!: Table<KnowledgeViewTransitionRow, string>;
  knowledgeCollections!: Table<KnowledgeCollectionRow, string>;
  knowledgeCounters!: Table<KnowledgeCounterRow, string>;
  knowledgeNotifications!: Table<KnowledgeNotificationRow, string>;
  knowledgeOutcomes!: Table<KnowledgeOutcomeRow, string>;
  knowledgeStateTransitions!: Table<KnowledgeStateTransitionRow, string>;
  knowledgeRecordedWorkflows!: Table<KnowledgeRecordedWorkflowRow, string>;

  constructor() {
    super(KNOWLEDGE_DB_NAME);

    this.version(1).stores({
      applications: 'appId, origin',
      knowledgeEntities: 'key, appId, [appId+type], lastSeenAt',
      knowledgeViews: 'key, appId, [appId+lastSeenAt]',
      knowledgeViewTransitions: 'key, appId, lastSeenAt',
      knowledgeCollections: 'key, appId, [appId+entityType]',
      knowledgeCounters: 'key, appId',
      knowledgeNotifications: 'key, appId, [appId+severity]',
      knowledgeOutcomes: 'key, appId, [appId+outcome]',
      knowledgeStateTransitions: 'key, appId, sessionId',
    });

    // DDC-4: additive migration — new table only.
    this.version(2).stores({
      knowledgeRecordedWorkflows: 'key, appId, patternId, lastSeenAt',
    });
  }
}

/**
 * Create a new knowledge database instance.
 */
export function createKnowledgeDatabase(): KnowledgeDatabase {
  return new KnowledgeDatabase();
}
