/**
 * D6 — Workflow ↔ Signature Linkage — REPOSITORY MIGRATION & PERSISTENCE
 *
 * fake-indexeddb + the production KnowledgeRepository. Pre-D6 rows lack the
 * linkage fields; upserts carrying linkage must converge (union, monotone
 * linkageState, bounded instance map) without disturbing D7 identity
 * migration, and must never mutate signature rows.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

import { KnowledgeDatabase } from '../../../src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../../src/understanding/persistence/knowledge-repository';
import { hashPattern } from '../../../src/understanding/enrichment/recorded-workflow';
import type { KnowledgeRecordedWorkflowRow } from '../../../src/understanding/persistence/knowledge-types';

const CHECKOUT = ['search products', 'navigate', 'add to cart'];

function row(
  appId: string,
  patternId: string,
  opts: Partial<KnowledgeRecordedWorkflowRow> = {},
): KnowledgeRecordedWorkflowRow {
  const steps = opts.canonicalSteps ?? CHECKOUT;
  return {
    key: `${appId}:${patternId}`,
    appId,
    patternId,
    label: 'Checkout flow',
    canonicalSteps: steps,
    viewSequence: ['search-results', 'product', 'cart'],
    sessionIds: ['s1'],
    occurrenceCount: 1,
    instances: ['wf-s1-0'],
    firstSeenAt: 1000,
    lastSeenAt: 1000,
    ...opts,
  };
}

describe('D6 linkage repository migration', () => {
  let db: KnowledgeDatabase;
  let repo: KnowledgeRepository;
  let APP: string;
  // fake-indexeddb shares ONE backing DB across tests — every test needs a
  // distinct appId or rows leak between tests (same isolation as the D7 suite).
  let nextApp = 0;

  beforeEach(async () => {
    APP = `app-d6-mig-${nextApp++}`;
    db = new KnowledgeDatabase();
    await db.open();
    repo = new KnowledgeRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('pre-D6 row (no linkage fields) converges when a linked upsert arrives', async () => {
    const pid = hashPattern(CHECKOUT);
    // Seed a literal pre-D6 row: exactly the fields D6 shipped without.
    await db.knowledgeRecordedWorkflows.put({
      key: `${APP}:${pid}`,
      appId: APP,
      patternId: pid,
      label: 'Checkout flow',
      canonicalSteps: [...CHECKOUT],
      viewSequence: ['search-results', 'product', 'cart'],
      sessionIds: ['s0'],
      occurrenceCount: 1,
      instances: ['wf-s0-0'],
      firstSeenAt: 900,
      lastSeenAt: 900,
    });

    await repo.upsertRecordedWorkflow(row(APP, pid, {
      sessionIds: ['s1'],
      instances: ['wf-s1-0'],
      lastSeenAt: 2000,
      signatureIds: ['app-x:sig:aaa', 'app-x:sig:bbb'],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-s1-0': ['app-x:sig:aaa', 'app-x:sig:bbb'] },
    }));

    const rows = await repo.getRecordedWorkflows(APP);
    expect(rows).toHaveLength(1);
    const merged = rows[0];
    expect(merged.occurrenceCount).toBe(2);
    expect(merged.sessionIds).toEqual(['s0', 's1']);
    expect(merged.signatureIds).toEqual(['app-x:sig:aaa', 'app-x:sig:bbb']);
    expect(merged.linkageState).toBe('linked');
    expect(merged.instanceSignatureIds).toEqual({
      'wf-s0-0': [],
      'wf-s1-0': ['app-x:sig:aaa', 'app-x:sig:bbb'],
    });
    expect(merged.patternId).toBe(pid);
    expect(merged.key).toBe(`${APP}:${pid}`);
  });

  it('repeated upserts union-merge: sorted, deduped, no data loss', async () => {
    const pid = hashPattern(CHECKOUT);
    await repo.upsertRecordedWorkflow(row(APP, pid, {
      signatureIds: ['app-x:sig:bbb', 'app-x:sig:aaa'],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-s1-0': ['app-x:sig:bbb', 'app-x:sig:aaa'] },
    }));
    await repo.upsertRecordedWorkflow(row(APP, pid, {
      sessionIds: ['s2'],
      instances: ['wf-s2-0'],
      signatureIds: ['app-x:sig:aaa', 'app-x:sig:ccc'],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-s2-0': ['app-x:sig:aaa'] },
    }));
    await repo.upsertRecordedWorkflow(row(APP, pid, {
      sessionIds: ['s3'],
      instances: ['wf-s3-0'],
      signatureIds: ['app-x:sig:aaa'],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-s3-0': ['app-x:sig:aaa'] },
    }));

    const rows = await repo.getRecordedWorkflows(APP);
    expect(rows).toHaveLength(1);
    const m = rows[0];
    expect(m.occurrenceCount).toBe(3);
    expect(m.signatureIds).toEqual(['app-x:sig:aaa', 'app-x:sig:bbb', 'app-x:sig:ccc']);
    expect(m.instanceSignatureIds).toEqual({
      'wf-s1-0': ['app-x:sig:aaa', 'app-x:sig:bbb'],
      'wf-s2-0': ['app-x:sig:aaa'],
      'wf-s3-0': ['app-x:sig:aaa'],
    });
    expect(m.linkageState).toBe('linked');
  });

  it('linkageState is monotone: never demoted from linked', async () => {
    const pid = hashPattern(['search products']);
    const base = { canonicalSteps: ['search products'] };
    await repo.upsertRecordedWorkflow(row(APP, pid, {
      ...base,
      signatureIds: ['app-x:sig:aaa'],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-s1-0': ['app-x:sig:aaa'] },
    }));
    // Later upsert with NO linkage data (pre-D6-shaped caller).
    await repo.upsertRecordedWorkflow(row(APP, pid, {
      ...base,
      sessionIds: ['s2'],
      instances: ['wf-s2-0'],
    }));
    const m = (await repo.getRecordedWorkflows(APP))[0];
    expect(m.linkageState).toBe('linked');
    expect(m.signatureIds).toEqual(['app-x:sig:aaa']);
    expect(m.instanceSignatureIds!['wf-s2-0']).toEqual([]);
  });

  it('instanceSignatureIds pruned to the bounded instance list', async () => {
    const pid = hashPattern(['search products']);
    const instances: string[] = [];
    const map: Record<string, string[]> = {};
    for (let i = 0; i < 55; i++) {
      instances.push(`wf-s9-${i}`);
      map[`wf-s9-${i}`] = ['app-x:sig:aaa'];
    }
    await repo.upsertRecordedWorkflow(row(APP, pid, {
      canonicalSteps: ['search products'],
      sessionIds: ['s9'],
      instances,
      occurrenceCount: instances.length,
      signatureIds: ['app-x:sig:aaa'],
      linkageState: 'linked',
      instanceSignatureIds: map,
    }));
    const m = (await repo.getRecordedWorkflows(APP))[0];
    expect(m.instances).toHaveLength(55);
    expect(Object.keys(m.instanceSignatureIds!)).toHaveLength(m.instances.length);
    for (const k of Object.keys(m.instanceSignatureIds!)) {
      expect(m.instances).toContain(k);
    }
    // Exceed the bound (200) — map keys must follow the pruned instances.
    const many: string[] = [];
    const bigMap: Record<string, string[]> = {};
    for (let i = 0; i < 230; i++) {
      many.push(`wf-s10-${i}`);
      bigMap[`wf-s10-${i}`] = ['app-x:sig:zzz'];
    }
    const pid2 = hashPattern(['search products', 'navigate']);
    await repo.upsertRecordedWorkflow(row(APP, pid2, {
      canonicalSteps: ['search products', 'navigate'],
      sessionIds: ['s10'],
      instances: many,
      occurrenceCount: many.length,
      signatureIds: ['app-x:sig:zzz'],
      linkageState: 'linked',
      instanceSignatureIds: bigMap,
    }));
    const m2 = (await repo.getRecordedWorkflows(APP)).find((r) => r.patternId === pid2)!;
    expect(m2.instances.length).toBeLessThanOrEqual(200);
    expect(m2.instances).toHaveLength(200);
    for (const k of Object.keys(m2.instanceSignatureIds!)) {
      expect(m2.instances).toContain(k);
    }
    expect(m2.instanceSignatureIds!['wf-s10-0']).toBeUndefined();
    expect(m2.instanceSignatureIds!['wf-s10-229']).toEqual(['app-x:sig:zzz']);
  });

  it('workflow upsert never creates signature rows (observation, not evidence)', async () => {
    const pid = hashPattern(['search products']);
    await repo.upsertRecordedWorkflow(row(APP, pid, {
      canonicalSteps: ['search products'],
      signatureIds: ['app-x:sig:nonexistent'],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-s1-0': ['app-x:sig:nonexistent'] },
    }));
    expect(await repo.getSignatures(APP)).toEqual([]);
    expect(await repo.getSignature('app-x:sig:nonexistent')).toBeUndefined();
  });

  it('D7 legacy-key migration path carries linkage through', async () => {
    const legacyPid = 'wf-pattern-deadbeef';
    await db.knowledgeRecordedWorkflows.put({
      key: `${APP}:${legacyPid}`,
      appId: APP,
      patternId: legacyPid,
      label: 'Checkout flow',
      canonicalSteps: [...CHECKOUT],
      viewSequence: ['search-results', 'product', 'cart'],
      sessionIds: ['s0'],
      occurrenceCount: 1,
      instances: ['wf-s0-0'],
      firstSeenAt: 500,
      lastSeenAt: 500,
    });
    const canonicalPid = hashPattern(CHECKOUT);
    expect(canonicalPid).not.toBe(legacyPid);

    await repo.upsertRecordedWorkflow(row(APP, canonicalPid, {
      signatureIds: ['app-x:sig:aaa'],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-s1-0': ['app-x:sig:aaa'] },
    }));

    const rows = await repo.getRecordedWorkflows(APP);
    expect(rows).toHaveLength(1);
    const m = rows[0];
    expect(m.key).toBe(`${APP}:${canonicalPid}`);
    expect(m.patternId).toBe(canonicalPid);
    expect(m.occurrenceCount).toBe(2);
    expect(m.signatureIds).toEqual(['app-x:sig:aaa']);
    expect(m.instanceSignatureIds).toEqual({
      'wf-s0-0': [],
      'wf-s1-0': ['app-x:sig:aaa'],
    });
    expect(m.linkageState).toBe('linked');
  });
});
