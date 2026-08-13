/**
 * DexieBehavioralEvidenceRepository — Dexie implementation of
 * BehavioralEvidenceRepository.
 *
 * Persists finalized behavioral evidence to the `behavioral_evidence` table
 * (Dexie V4). Uses windowId as primary key for idempotent puts.
 *
 * M8.1: Introduced in Dexie V4 schema migration.
 */

import type { BehavioralEvidenceRow } from './dexie-database';
import type { BehavioralEvidenceRepository } from '../interfaces/behavioral-evidence-repository';
import type { Table } from 'dexie';

export class DexieBehavioralEvidenceRepository implements BehavioralEvidenceRepository {
  constructor(
    private readonly evidence: Table<BehavioralEvidenceRow, string>,
  ) {}

  async save(evidence: BehavioralEvidenceRow): Promise<BehavioralEvidenceRow> {
    // put() — idempotent by windowId primary key.
    // If the row already exists (same windowId), it is overwritten.
    // This is critical for exactly-once persistence (M8.5).
    await this.evidence.put(evidence);
    return evidence;
  }

  async getByInteraction(interactionId: string): Promise<BehavioralEvidenceRow[]> {
    return this.evidence
      .where('interactionId')
      .equals(interactionId)
      .toArray();
  }

  async getBySession(recordingSessionId: string): Promise<BehavioralEvidenceRow[]> {
    return this.evidence
      .where('recordingSessionId')
      .equals(recordingSessionId)
      .toArray();
  }

  async deleteBySession(recordingSessionId: string): Promise<void> {
    const rows = await this.evidence
      .where('recordingSessionId')
      .equals(recordingSessionId)
      .toArray();
    const keys = rows.map((r) => r.windowId);
    await this.evidence.bulkDelete(keys);
  }
}
