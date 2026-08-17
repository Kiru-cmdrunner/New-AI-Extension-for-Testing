/**
 * D7 — recorded-workflow identity migration at the persistence layer.
 *
 * Verifies that when a pattern arrives under the NEW canonical patternId
 * but a legacy row (stored under an old identity) exists for the same
 * physical workflow, the repository merges into the canonical key and
 * deletes the legacy row instead of leaving two occurrenceCount=1 rows.
 *
 * NOTE (test isolation): fake-indexeddb/auto shares one backing DB under
 * the fixed name 'cmdrunner_knowledge'; each test MUST use a distinct
 * appId or residual data bleeds between tests (db.close() does not clear).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'fake-indexeddb/auto';
import {
  KnowledgeDatabase,
  createKnowledgeDatabase,
} from '../../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../../src/understanding/persistence/knowledge-repository';
import type { KnowledgeRecordedWorkflowRow } from '../../../src/understanding/persistence/knowledge-types';
import { hashPattern } from '../../../src/understanding/enrichment/recorded-workflow';

describe('D7 identity migration (knowledge repository)', () => {
  let db: KnowledgeDatabase;

  beforeAll(() => {
    db = createKnowledgeDatabase();
  });
  afterAll(async () => {
    await db.close();
  });

  function row(appId: string, patternId: string, steps: string[], sessions: string[]): KnowledgeRecordedWorkflowRow {
    return {
      key: `${appId}:${patternId}`,
      appId,
      patternId,
      label: 'Search products',
      canonicalSteps: steps,
      viewSequence: ['search-results'],
      sessionIds: sessions,
      occurrenceCount: sessions.length,
      instances: sessions.map((s) => `wf-${s}-0`),
      firstSeenAt: 1,
      lastSeenAt: 1,
    };
  }

  it('merges a legacy row into the canonical key when canonicalSteps re-hash to the new patternId', async () => {
    const appId = 'app-d7-migration-a';
    // Legacy row: stored under an OLD patternId, with pre-canonicalization
    // steps that included ambient noise. Those stored steps re-canonicalize
    // (current rules) to exactly the incoming row's canonical form — that
    // is the migration trigger.
    const legacySteps = ['Search products', 'Fetch data', 'Go', 'Submit form', '/product.html?id=P100', 'Add to cart'];
    await db.knowledgeRecordedWorkflows.put(row(appId, 'wf-pattern-legacy-1', legacySteps, ['session-old']));

    const repo = new KnowledgeRepository(db);
    // New-form row for the same physical workflow: the clean canonical
    // steps, with the patternId the CURRENT canonicalization computes
    // (same as knowledge-persistence-service writes at persist time).
    const canonicalSteps = ['search products', 'go', '/product.html?id=p100', 'add to cart'];
    const newPatternId = hashPattern(canonicalSteps);
    // Sanity: the legacy row's stored steps re-hash to the same id.
    expect(hashPattern(legacySteps)).toBe(newPatternId);
    await repo.upsertRecordedWorkflow(row(appId, newPatternId, canonicalSteps, ['session-new']));

    const rows = await db.knowledgeRecordedWorkflows.where('appId').equals(appId).toArray();
    // Exactly one row, under the canonical key, accumulated.
    expect(rows).toHaveLength(1);
    expect(rows[0].patternId).toBe(newPatternId);
    expect(rows[0].occurrenceCount).toBe(2);
    expect(rows[0].sessionIds.sort()).toEqual(['session-new', 'session-old']);
    // The legacy row was deleted.
    expect(await db.knowledgeRecordedWorkflows.get(`${appId}:wf-pattern-legacy-1`)).toBeUndefined();
  });

  it('keeps genuinely different patterns separate (no false merge)', async () => {
    const appId = 'app-d7-migration-b';
    await db.knowledgeRecordedWorkflows.put(
      row(appId, 'wf-pattern-other', ['search products', 'go'], ['session-old']),
    );
    const repo = new KnowledgeRepository(db);
    await repo.upsertRecordedWorkflow(
      row(appId, 'wf-pattern-different', ['search products', 'go', '/product.html?id=p100', 'add to cart'], ['session-new']),
    );

    const rows = await db.knowledgeRecordedWorkflows.where('appId').equals(appId).toArray();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.occurrenceCount === 1)).toBe(true);
  });

  it('third session of the same canonical pattern accumulates to occ=3', async () => {
    const appId = 'app-d7-migration-c';
    const steps = ['search products', 'go', '/product.html?id=p100', 'add to cart'];
    const repo = new KnowledgeRepository(db);
    const patternId = 'wf-pattern-canon-c';
    await repo.upsertRecordedWorkflow(row(appId, patternId, steps, ['session-1']));
    await repo.upsertRecordedWorkflow(row(appId, patternId, steps, ['session-2']));
    await repo.upsertRecordedWorkflow(row(appId, patternId, steps, ['session-3']));

    const rows = await db.knowledgeRecordedWorkflows.where('appId').equals(appId).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].occurrenceCount).toBe(3);
    expect(rows[0].sessionIds).toHaveLength(3);
  });

  it('re-persist of the same session does not double-count (sessionIds union)', async () => {
    const appId = 'app-d7-migration-d';
    const steps = ['search products', 'go'];
    const repo = new KnowledgeRepository(db);
    const patternId = 'wf-pattern-canon-d';
    await repo.upsertRecordedWorkflow(row(appId, patternId, steps, ['session-1']));
    await repo.upsertRecordedWorkflow(row(appId, patternId, steps, ['session-1']));

    const rows = await db.knowledgeRecordedWorkflows.where('appId').equals(appId).toArray();
    // occurrenceCount is additive by contract (row counts observations of
    // this call), but sessionIds union — the dedup guard for identity.
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionIds).toEqual(['session-1']);
  });
});
