/**
 * BehavioralEvidenceRepository Interface — persists finalized behavioral
 * evidence separately from the interaction record.
 *
 * Evidence is persisted at the recording lifecycle point (stopRecording)
 * and linked to both the interaction it was captured for and the recording
 * session it belongs to.
 *
 * Key design: `windowId` (format `bev-{eventId}`) is used as the primary
 * key. This makes `save()` idempotent — re-persisting the same evidence
 * overwrites rather than duplicating. This is critical for:
 *   - Idempotent stopRecording (called once, but resilient to retries)
 *   - SW restart recovery (M8.3): re-persisting recovered evidence is safe
 *
 * M8.1: Introduced in Dexie V4 schema migration.
 */

import type { BehavioralEvidenceRow } from '../dexie/dexie-database';

export interface BehavioralEvidenceRepository {
  /**
   * Save (or overwrite) a behavioral evidence row.
   * Uses put() semantics — idempotent by windowId primary key.
   */
  save(evidence: BehavioralEvidenceRow): Promise<BehavioralEvidenceRow>;

  /**
   * Get all evidence for a specific interaction.
   * Returns an empty array if none found.
   */
  getByInteraction(interactionId: string): Promise<BehavioralEvidenceRow[]>;

  /**
   * Get all evidence for a specific recording session.
   * Returns an empty array if none found.
   */
  getBySession(recordingSessionId: string): Promise<BehavioralEvidenceRow[]>;

  /**
   * Delete all evidence for a recording session.
   * Used for cleanup when a session is discarded.
   */
  deleteBySession(recordingSessionId: string): Promise<void>;
}
