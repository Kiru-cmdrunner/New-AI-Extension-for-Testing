/**
 * CP8 contract probe — real production code over the real extension DB.
 * Bundled from /workspace/src via esbuild (dexie inlined), then inlined as
 * an async IIFE string and evaluated by the D6 harness inside the
 * SIDEPANEL context (extension origin → IndexedDB accessible; CSP-safe
 * because Runtime.evaluate is not a fetch).
 *
 * Verifies: listActions linkage output (linked + pattern ids, drag
 * isolation), determinism across calls, and store immutability (byte
 * comparison before/after all reads).
 */
import { KnowledgeDatabase } from '../../workspace/src/understanding/persistence/knowledge-database';
import { KnowledgeRepository } from '../../workspace/src/understanding/persistence/knowledge-repository';
import { KnowledgeLoader } from '../../workspace/src/understanding/consolidation/knowledge-loader';
import { KnowledgeContract } from '../../workspace/src/understanding/contract/knowledge-contract';

export async function run(): Promise<string> {
  const db = new KnowledgeDatabase();
  await db.open();
  const repo = new KnowledgeRepository(db);
  const loader = new KnowledgeLoader(repo, db);
  const contract = new KnowledgeContract(repo, loader);

  const snapshotStores = async (): Promise<string> => {
    const names = [
      'knowledgeRecordedWorkflows', 'knowledgeSignatures',
      'knowledgeBehaviorSessions', 'knowledgeEpisodes',
    ];
    const parts: string[] = [];
    for (const n of names) {
      const rows = await (db as never as Record<string, { toArray: () => Promise<unknown[]> }>)[n].toArray();
      parts.push(n + '=' + JSON.stringify(rows));
    }
    return parts.join('§');
  };

  const apps = await contract.listApplications();
  const appId = apps.data[0]?.appId ?? null;
  if (!appId) return JSON.stringify({ error: 'no app' });

  const before = await snapshotStores();
  const actions1 = await contract.listActions(appId);
  const actions2 = await contract.listActions(appId);
  const after = await snapshotStores();

  const descriptors = actions1.data.map((a) => ({
    target: a.normalizedTarget,
    actionType: a.actionType,
    anchorViewId: a.anchorViewId,
    workflowPatternIds: a.workflowPatternIds,
    workflowPatternAbsence: a.workflowPatternAbsence,
    occurrenceCount: a.occurrenceCount,
  }));

  return JSON.stringify({
    appId,
    contractVersion: actions1.contractVersion,
    deterministic:
      JSON.stringify(actions1.data.map((a) => [a.signatureKey, a.workflowPatternIds, a.workflowPatternAbsence]))
      === JSON.stringify(actions2.data.map((a) => [a.signatureKey, a.workflowPatternIds, a.workflowPatternAbsence])),
    readOnly: before === after,
    actions: descriptors,
  });
}
